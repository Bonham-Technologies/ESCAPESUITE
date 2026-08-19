// MP4 export via WebCodecs + Mediabunny
// H.264 video + AAC audio, frame-by-frame encoding with WebCodecs decoding

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from 'mediabunny';
import type { Clip, SourceVideo, Track, ExportOptions } from '../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../store/types';
import { getVideoBlob } from './storage';
import { getClipsAtTime } from '../store/projectStore';
import { getAnimatedValuesCached, clearAnimationCache } from '../utils/animation';
import { isWebCodecsAvailable } from './frameSource';
import type { DrawableMediaSource, ProgressCallback } from './exportTypes';
import {
  checkAborted,
  isMP4ExportSupported,
  getQualitySettings,
  getResolution,
  loadImageElement,
  clearSeekPositions,
  yieldToMain,
  calculateTimelineDuration,
  getActiveTransition,
} from './exportTypes';
import {
  drawMediaWithFrame,
  drawTransitionWithFrames,
  drawTextOverlayToCanvasAnimated,
  drawShapeOverlayToCanvasAnimated,
} from './canvasRenderer';
import {
  createFrameManager,
  loadFrameSource,
  getFrameAtTime,
  cleanupIterationFrames,
  disposeFrameManager,
} from './frameManager';
import { extractAndMixAudioWithWorker } from './audioMixer';

/**
 * Structured log entry for export diagnostics
 */
export interface ExportLogEntry {
  phase: string;
  detail: string;
  timestamp: number;
}

/**
 * Error class that carries the export diagnostic log for debugging
 */
export class ExportError extends Error {
  public readonly exportLog: ExportLogEntry[];
  public readonly frameIndex: number | undefined;
  public readonly totalFrames: number | undefined;

  constructor(message: string, exportLog: ExportLogEntry[], frameIndex?: number, totalFrames?: number) {
    super(message);
    this.name = 'ExportError';
    this.exportLog = exportLog;
    this.frameIndex = frameIndex;
    this.totalFrames = totalFrames;
  }
}

/**
 * Export timeline to MP4 using WebCodecs + Mediabunny
 * Frame-by-frame encoding with H.264 video and AAC audio
 */
export async function exportToMP4(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  signal?: AbortSignal,
  projectResolution?: { width: number; height: number }
): Promise<Blob> {
  if (!isMP4ExportSupported()) {
    throw new Error('MP4 export requires WebCodecs API (Chrome/Edge)');
  }

  if (clips.length === 0) {
    throw new Error('No clips to export');
  }

  // Check for early abort
  checkAborted(signal);

  // Diagnostic logging for debugging export failures
  const exportLog: ExportLogEntry[] = [];
  const log = (phase: string, detail: string) => {
    exportLog.push({ phase, detail, timestamp: performance.now() });
  };

  log('init', `Starting MP4 export with ${clips.length} clips`);

  const exportTracks = tracks || [{ id: 'default', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }];

  // Clear optimization caches at start of export
  clearSeekPositions();
  clearAnimationCache();

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing MP4 export...' });

  // Use the bottom-most track's source dimensions as the base
  // Lower track index = base layer, typically the main video content
  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  let baseWidth = 1920; // Default resolution for overlay-only exports
  let baseHeight = 1080;

  // Sort clips by track index (lower = base/bottom) and find the bottom-most media clip with dimensions
  const sortedClips = [...clips].sort((a, b) => {
    const trackA = exportTracks.find(t => t.id === a.trackId);
    const trackB = exportTracks.find(t => t.id === b.trackId);
    return (trackA?.index ?? 0) - (trackB?.index ?? 0); // Lower index first
  });

  for (const clip of sortedClips) {
    if (clip.overlayType) continue; // Skip overlay clips
    const source = sourceMap.get(clip.sourceVideoId);
    if (source && source.width && source.height) {
      baseWidth = source.width;
      baseHeight = source.height;
      break; // Use bottom-most source with dimensions
    }
  }

  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight, projectResolution);
  const { videoBitrate, audioBitrate } = getQualitySettings(options.quality);
  const frameRate = 30;
  const sampleRate = 48000;

  // Calculate total duration, respecting timeRange if specified
  const fullDuration = calculateTimelineDuration(clips);
  const rangeStart = options.timeRange?.start ?? 0;
  const rangeEnd = options.timeRange?.end ?? fullDuration;
  const totalDuration = rangeEnd - rangeStart;
  const totalFrames = Math.ceil(totalDuration * frameRate);

  // Extract and mix audio first (uses Web Worker if available, falls back to main thread)
  // Note: we extract the full timeline audio, then slice it later
  onProgress({ phase: 'preparing', progress: 2, message: 'Extracting audio...' });

  log('audio', 'Starting audio extraction');
  const fullAudioData: Float32Array | null = await extractAndMixAudioWithWorker(clips, exportTracks, fullDuration, (p) => {
    onProgress({ phase: 'preparing', progress: 2 + p * 0.08, message: 'Extracting audio...' });
  });
  log('audio', fullAudioData ? `Audio extracted: ${fullAudioData.length} samples` : 'No audio data');

  // Slice audio to the selected time range
  // Audio is stereo interleaved (2 channels), so multiply sample indices by 2
  const audioChannels = 2;
  let audioData: Float32Array | null = fullAudioData && options.timeRange ? (() => {
    const startSample = Math.floor(rangeStart * sampleRate) * audioChannels;
    const endSample = Math.floor(rangeEnd * sampleRate) * audioChannels;
    return fullAudioData.slice(startSample, endSample);
  })() : fullAudioData;

  // Create canvas for frame rendering
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Load all unique source media (videos and images)
  // Use WebCodecs-based frame decoding when available for background-capable export
  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  // Create frame manager - uses WebCodecs when available, falls back to HTMLVideoElement
  const frameManager = await createFrameManager(isWebCodecsAvailable());
  const imageElements: Map<string, HTMLImageElement> = new Map();

  // Log which mode we're using
  if (frameManager.useWebCodecs) {
    console.log('[MP4 Export] Using WebCodecs for video decoding (background-capable)');
  } else {
    console.log('[MP4 Export] Using HTMLVideoElement for video decoding (standard mode)');
  }

  // Get unique source IDs, filtering out empty ones (overlay clips have no sourceVideoId)
  const uniqueSourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id && id.length > 0))];

  for (const sourceId of uniqueSourceIds) {
    const source = sourceMap.get(sourceId);
    const blob = await getVideoBlob(sourceId);

    if (blob) {
      if (source?.mediaType === 'image') {
        // Load as image
        const img = await loadImageElement(blob);
        imageElements.set(sourceId, img);
      } else if (source?.mediaType !== 'audio') {
        // Load as video using frame manager (supports WebCodecs or HTMLVideoElement)
        try {
          await loadFrameSource(frameManager, sourceId, blob, blob.type || 'video/mp4');
        } catch (e) {
          console.warn(`Failed to load video ${sourceId}, trying as image:`, e);
          // Try loading as image as fallback
          try {
            const img = await loadImageElement(blob);
            imageElements.set(sourceId, img);
          } catch {
            console.warn(`Failed to load media ${sourceId}`);
          }
        }
      }
    }
  }

  onProgress({ phase: 'encoding', progress: 15, message: 'Initializing encoder...' });

  // Create Mediabunny output with MP4 format
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({
      fastStart: 'in-memory',
    }),
    target,
  });

  // Create video packet source
  const videoSource = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(videoSource, { frameRate });

  // Create audio packet source if we have audio
  let audioSource: EncodedAudioPacketSource | null = null;
  if (audioData) {
    // Check if AAC is supported with the requested bitrate
    const aacConfig = {
      codec: 'mp4a.40.2', // AAC-LC
      sampleRate,
      numberOfChannels: 2,
      bitrate: audioBitrate, // Use quality-based bitrate (128k/192k/256k)
    };

    try {
      const support = await AudioEncoder.isConfigSupported(aacConfig);
      if (!support.supported) {
        console.warn('AAC not supported, exporting without audio');
        audioData = null;
      } else {
        audioSource = new EncodedAudioPacketSource('aac');
        output.addAudioTrack(audioSource);
      }
    } catch (e) {
      console.warn('Failed to check AAC support, exporting without audio:', e);
      audioData = null;
    }
  }

  // Start the output
  await output.start();

  // H.264 codec profiles to try, in order of preference (quality -> compatibility).
  // We try two passes: prefer-hardware first (GPU acceleration), then no-preference
  // (allows software encoding). The second pass ensures the headless / CI path works
  // even without a GPU (e.g. Playwright Chromium, Docker).
  const h264Codecs = [
    'avc1.640028', // High Profile Level 4.0 - best quality
    'avc1.4d0028', // Main Profile Level 4.0 - good compatibility
    'avc1.42001f', // Baseline Profile Level 3.1 - maximum compatibility
  ];

  // Find a supported H.264 codec configuration
  let videoConfig: VideoEncoderConfig | null = null;
  const hwModes: VideoEncoderConfig['hardwareAcceleration'][] = ['prefer-hardware', 'no-preference'];
  outer: for (const hwMode of hwModes) {
    for (const codec of h264Codecs) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate: videoBitrate,
        framerate: frameRate,
        latencyMode: 'quality',
        hardwareAcceleration: hwMode,
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) {
          videoConfig = support.config || config;
          log('codec', `Selected H.264 codec: ${codec} hw=${hwMode} (${width}x${height} @ ${videoBitrate}bps)`);
          console.log(`[MP4 Export] Using H.264 codec: ${codec} (${hwMode})`);
          break outer;
        }
      } catch {
        // This codec not supported, try next
      }
    }
  }

  if (!videoConfig) {
    throw new Error('No supported H.264 codec found. MP4 export requires H.264 support.');
  }

  // Create video encoder with error tracking
  let videoEncoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: async (chunk, meta) => {
      await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
    },
    error: (e) => {
      console.error('Video encoder error:', e);
      videoEncoderError = e instanceof Error ? e : new Error(String(e));
    },
  });

  await videoEncoder.configure(videoConfig);

  // Create audio encoder if we have audio
  let audioEncoder: AudioEncoder | null = null;
  let audioEncoderError: Error | null = null;
  if (audioData && audioSource) {
    const aacConfig = {
      codec: 'mp4a.40.2', // AAC-LC
      sampleRate,
      numberOfChannels: 2,
      bitrate: audioBitrate, // Use quality-based bitrate
    };

    audioEncoder = new AudioEncoder({
      output: async (chunk, meta) => {
        await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: (e) => {
        console.error('Audio encoder error:', e);
        audioEncoderError = e instanceof Error ? e : new Error(String(e));
      },
    });

    await audioEncoder.configure(aacConfig);
  }

  // WebCodecs-based frame fetching runs at full speed (no browser throttling)
  const frameDurationUs = Math.round((1 / frameRate) * 1_000_000);
  let frameCount = 0;

  // Helper to clean up resources on abort or completion
  const cleanup = async () => {
    // Clean up any remaining iteration frames
    cleanupIterationFrames(frameManager);

    // Dispose frame manager (closes VideoFrames and frame sources)
    await disposeFrameManager(frameManager);

    // Clean up image elements
    imageElements.forEach((img) => {
      URL.revokeObjectURL(img.src);
    });
  };

  onProgress({ phase: 'encoding', progress: 18, message: 'Encoding frames...' });
  log('frames', `Starting frame loop: ${totalFrames} total frames at ${frameRate}fps`);

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // Check for abort at start of each frame
      checkAborted(signal);

      // Clean up frames from previous iteration before starting new one
      cleanupIterationFrames(frameManager);

      // Check for encoder errors at start of each frame
      if (videoEncoderError) {
        throw videoEncoderError;
      }

      const currentTime = rangeStart + frameIndex / frameRate;

      // Check for active transition
      const activeTransition = getActiveTransition(clips, exportTracks, currentTime);

      // Get all clips at current time
      const activeClips = getClipsAtTime(clips, exportTracks, currentTime);

      // Clear canvas to black
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // Separate media clips from overlay clips
      const mediaClips: typeof activeClips = [];
      const overlayClips: typeof activeClips = [];

      for (const clipData of activeClips) {
        if (clipData.clip.overlayType) {
          overlayClips.push(clipData);
        } else {
          mediaClips.push(clipData);
        }
      }

      // Helper to calculate clip time
      const getClipTime = (clip: Clip) => currentTime - clip.timelinePosition;

      // Fetch frames for all active media clips (runs at full speed with WebCodecs)
      const framePromises: Array<{ clip: Clip; clipTime: number; framePromise: Promise<DrawableMediaSource | null> }> = [];

      for (const { clip, clipTime } of mediaClips) {
        // Check if this is a video source (in frameManager.sources)
        const sourceTime = clip.startTime + clipTime;
        if (frameManager.sources.has(clip.sourceVideoId)) {
          framePromises.push({
            clip,
            clipTime,
            framePromise: getFrameAtTime(frameManager, clip.sourceVideoId, sourceTime),
          });
        } else if (imageElements.has(clip.sourceVideoId)) {
          // Image - resolve immediately
          const img = imageElements.get(clip.sourceVideoId)!;
          framePromises.push({
            clip,
            clipTime,
            framePromise: Promise.resolve(img),
          });
        }
      }

      // Also fetch frames for transition clips if active
      let outgoingFrame: DrawableMediaSource | null = null;
      let incomingFrame: DrawableMediaSource | null = null;

      if (activeTransition) {
        const outClipTime = currentTime - activeTransition.outgoingClip.timelinePosition;
        const outSourceTime = activeTransition.outgoingClip.startTime + outClipTime;

        const clipEnd = activeTransition.outgoingClip.timelinePosition + activeTransition.outgoingClip.duration;
        const inClipTime = currentTime - clipEnd;
        const inSourceTime = inClipTime >= 0
          ? activeTransition.incomingClip.startTime + inClipTime
          : activeTransition.incomingClip.startTime;

        // Fetch outgoing frame
        if (frameManager.sources.has(activeTransition.outgoingClip.sourceVideoId)) {
          outgoingFrame = await getFrameAtTime(frameManager, activeTransition.outgoingClip.sourceVideoId, outSourceTime);
        } else if (imageElements.has(activeTransition.outgoingClip.sourceVideoId)) {
          outgoingFrame = imageElements.get(activeTransition.outgoingClip.sourceVideoId)!;
        }

        // Fetch incoming frame
        if (frameManager.sources.has(activeTransition.incomingClip.sourceVideoId)) {
          incomingFrame = await getFrameAtTime(frameManager, activeTransition.incomingClip.sourceVideoId, inSourceTime);
        } else if (imageElements.has(activeTransition.incomingClip.sourceVideoId)) {
          incomingFrame = imageElements.get(activeTransition.incomingClip.sourceVideoId)!;
        }
      }

      // Wait for all regular clip frames
      const frames = await Promise.all(
        framePromises.map(async ({ clip, clipTime, framePromise }) => ({
          clip,
          clipTime,
          frame: await framePromise,
        }))
      );

      // Composite each media clip (bottom to top by track index)
      for (const { clip, clipTime, frame } of frames) {
        // Skip clips that are part of an active transition
        if (activeTransition &&
            (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
          continue;
        }

        if (frame) {
          drawMediaWithFrame(ctx, frame, clip, clipTime, width, height);
        }
      }

      // Draw transition if active
      if (activeTransition) {
        drawTransitionWithFrames(ctx, outgoingFrame, incomingFrame, activeTransition, currentTime, width, height);
      }

      // Draw overlay clips in track order (lower index = rendered first = behind)
      // This ensures blur overlays on higher tracks can blur content on lower tracks
      const sortedOverlayClips = [...overlayClips].sort((a, b) => {
        return (a.track?.index || 0) - (b.track?.index || 0);
      });

      for (const { clip } of sortedOverlayClips) {
        const overlayClipTime = getClipTime(clip);

        // Build base transform from overlay's own properties
        let baseTransform = clip.transform || DEFAULT_TRANSFORM;

        if (clip.overlayType === 'text' && clip.textData) {
          baseTransform = {
            ...DEFAULT_TRANSFORM,
            ...clip.transform,
            x: clip.textData.x,
            y: clip.textData.y,
            scaleX: clip.textData.scale ?? 1,
            scaleY: clip.textData.scale ?? 1,
            rotation: clip.textData.rotation ?? 0,
          };
        } else if (clip.overlayType === 'shape' && clip.shapeData) {
          baseTransform = {
            ...DEFAULT_TRANSFORM,
            ...clip.transform,
            x: clip.shapeData.x,
            y: clip.shapeData.y,
            rotation: clip.shapeData.rotation,
          };
        }

        // Use cached version for export performance
        const cacheKey = `${clip.id}:${overlayClipTime.toFixed(3)}`;
        const animated = getAnimatedValuesCached(
          cacheKey,
          overlayClipTime,
          clip.duration,
          clip.animation,
          baseTransform,
          clip.effects || DEFAULT_EFFECTS
        );

        if (clip.overlayType === 'shape' && clip.shapeData) {
          drawShapeOverlayToCanvasAnimated(ctx, clip.shapeData, width, height, animated, canvas);
        } else if (clip.overlayType === 'text' && clip.textData) {
          drawTextOverlayToCanvasAnimated(ctx, clip.textData, width, height, animated);
        }
      }

      // Create VideoFrame from canvas — timestamp relative to export start (not timeline)
      const exportTime = currentTime - rangeStart;
      const timestamp = Math.round(exportTime * 1_000_000);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: frameDurationUs,
      });

      // Encode frame (keyframe every 2 seconds) with single retry
      const keyFrame = frameCount % (frameRate * 2) === 0;
      try {
        videoEncoder.encode(frame, { keyFrame });
      } catch (encodeErr) {
        log('retry', `Frame ${frameIndex} encode failed, retrying as keyframe: ${encodeErr}`);
        try {
          videoEncoder.encode(frame, { keyFrame: true });
        } catch (retryErr) {
          frame.close();
          log('fatal', `Frame ${frameIndex} retry failed: ${retryErr}`);
          throw new ExportError(
            `Export failed at frame ${frameIndex}/${totalFrames}`,
            exportLog,
            frameIndex,
            totalFrames
          );
        }
      }
      frame.close();

      frameCount++;

      // Log progress every 10th frame
      if (frameCount % 10 === 0) {
        log('progress', `Encoded frame ${frameCount}/${totalFrames}`);
      }

      // Backpressure: wait for encoder to catch up if queue is too large
      // This prevents memory exhaustion while allowing smooth encoding
      const backpressureStart = Date.now();
      const backpressureTimeout = 30000; // 30 second timeout
      while (videoEncoder.encodeQueueSize > 5) {
        // Check for encoder errors during backpressure wait
        if (videoEncoderError) {
          log('error', `Encoder error during backpressure: ${videoEncoderError.message}`);
          throw videoEncoderError;
        }
        // Check for timeout (encoder might be stuck)
        if (Date.now() - backpressureStart > backpressureTimeout) {
          log('fatal', `Backpressure timeout at frame ${frameIndex}, queue size: ${videoEncoder.encodeQueueSize}`);
          throw new ExportError(
            'Video encoder backpressure timeout - encoder may be stuck',
            exportLog,
            frameIndex,
            totalFrames
          );
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // Update progress periodically
      if (frameCount % 5 === 0 || frameCount === totalFrames) {
        const progress = 18 + (frameCount / totalFrames) * 70;
        onProgress({
          phase: 'encoding',
          progress: Math.min(progress, 88),
          message: `Encoding frame ${frameCount}/${totalFrames}...`,
        });

        // Yield to prevent UI blocking (uses MessageChannel to avoid background tab throttling)
        await yieldToMain();
      }
    }

    // Encode audio in chunks if available
    if (audioEncoder && audioData) {
      onProgress({ phase: 'encoding', progress: 89, message: 'Encoding audio...' });

      const samplesPerChunk = sampleRate; // 1 second chunks
      const totalSamples = audioData.length / 2; // audioData is interleaved stereo
      const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

      for (let i = 0; i < totalChunks; i++) {
        // Check for abort during audio encoding
        checkAborted(signal);

        const startSample = i * samplesPerChunk;
        const endSample = Math.min((i + 1) * samplesPerChunk, totalSamples);
        const chunkSamples = endSample - startSample;

        // Create planar audio data (left channel first, then right channel)
        const chunkData = new Float32Array(chunkSamples * 2);

        // Left channel (first half)
        for (let s = 0; s < chunkSamples; s++) {
          chunkData[s] = audioData[(startSample + s) * 2]; // Left from interleaved
        }
        // Right channel (second half)
        for (let s = 0; s < chunkSamples; s++) {
          chunkData[chunkSamples + s] = audioData[(startSample + s) * 2 + 1]; // Right from interleaved
        }

        const audioDataObj = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: chunkSamples,
          numberOfChannels: 2,
          timestamp: Math.round((startSample / sampleRate) * 1_000_000),
          data: chunkData,
        });

        audioEncoder.encode(audioDataObj);
        audioDataObj.close();
      }
    }

    log('frames', `Frame loop complete: ${frameCount} frames encoded`);

    // Check for any encoder errors before finalizing
    if (videoEncoderError) {
      log('error', `Video encoder error before finalize: ${(videoEncoderError as Error).message}`);
      throw videoEncoderError;
    }
    if (audioEncoderError) {
      log('error', `Audio encoder error before finalize: ${(audioEncoderError as Error).message}`);
      throw audioEncoderError;
    }

    // Flush and finalize
    onProgress({ phase: 'muxing', progress: 92, message: 'Finalizing MP4...' });

    await videoEncoder.flush();
    videoEncoder.close();

    if (audioEncoder) {
      await audioEncoder.flush();
      audioEncoder.close();
    }

    await output.finalize();

    // Clean up media elements
    await cleanup();

    onProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

    // Get the final buffer
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('Export failed: no data was written to buffer');
    }
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (error) {
    // Clean up resources on error
    await cleanup();

    // Close encoders if they exist
    try {
      if (videoEncoder.state !== 'closed') {
        videoEncoder.close();
      }
    } catch { /* ignore */ }

    try {
      if (audioEncoder && audioEncoder.state !== 'closed') {
        audioEncoder.close();
      }
    } catch { /* ignore */ }

    // Re-throw ExportAbortedError and ExportError as-is
    if (error instanceof ExportError || (error instanceof Error && error.name === 'ExportAbortedError')) {
      throw error;
    }

    // Wrap other errors in ExportError to carry the diagnostic log
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Export failed: ${message}`);
    throw new ExportError(message, exportLog, frameCount, totalFrames);
  }
}
