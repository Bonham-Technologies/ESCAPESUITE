// WebM export via WebCodecs + Mediabunny
// VP9 video + Opus audio, frame-by-frame encoding

import {
  Output,
  WebMOutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from 'mediabunny';
import type { Clip, SourceVideo, Track, ExportOptions } from '../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../store/types';
import { getVideoBlob } from './storage';
// The export error class lives beside the MP4 pipeline (it predates this one
// needing it at all) and is re-exported from `exporter.ts`'s barrel; WebM
// reaches for the same class rather than minting its own so both exporters'
// resolution guard (ESCSUITE-152) surfaces identically to `ExportDialog`.
import { ExportError } from './exportMP4';
import { getClipsAtTime } from '../store/projectStore';
import { getAnimatedValues } from '../utils/animation';
import type { MediaDrawOptions, ProgressCallback } from './exportTypes';
import { openOutputFrame, projectToOutputScale } from './outputTransform';
import {
  checkAborted,
  isWebMExportSupported,
  getQualitySettings,
  getResolution, getBaseDimensions,
  loadVideoElement,
  loadImageElement,
  yieldToMain,
  calculateTimelineDuration,
  getActiveTransition,
} from './exportTypes';
import {
  drawClipToCanvas,
  drawImageToCanvasWithModifiers,
  drawTransition,
  drawTextOverlayToCanvasAnimated,
  drawShapeOverlayToCanvasAnimated,
} from './canvasRenderer';
import { extractAndMixAudio } from './audioMixer';

/**
 * Export timeline to WebM using WebCodecs + webm-muxer
 * Frame-by-frame encoding with proper seeking support
 */
export async function exportToWebM(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  signal?: AbortSignal,
  projectResolution?: { width: number; height: number }
): Promise<Blob> {
  if (!isWebMExportSupported()) {
    throw new Error('WebM export requires WebCodecs API (Chrome/Edge)');
  }

  if (clips.length === 0) {
    throw new Error('No clips to export');
  }

  // Check for early abort
  checkAborted(signal);

  const exportTracks = tracks || [{ id: 'default', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }];

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  // Use the bottom-most track's source dimensions as the base
  const { width: baseWidth, height: baseHeight } = getBaseDimensions(clips, exportTracks, sourceVideos);
  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight, projectResolution);

  // Defensive guard at the door (ESCSUITE-152): see exportMP4.ts's twin
  // check for why — a hand-built `projectResolution` can still bypass
  // `parseProject`, and this is clearer than whatever WebCodecs would say.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new ExportError(
      `Cannot export at ${width}x${height}: resolved output resolution must be at least 2x2`,
      []
    );
  }

  const { videoBitrate, audioBitrate } = getQualitySettings(options.quality);
  const frameRate = 30;
  const sampleRate = 48000;

  // The space every draw call below is in, as against the raster they land on.
  // A caller with no project resolution (only the tests, today — both the editor
  // and the headless renderer always pass one) gets the base dimensions, which is
  // the same stand-in `getResolution` uses for 'project'.
  const projectSize = projectResolution && projectResolution.width > 0 && projectResolution.height > 0
    ? { width: projectResolution.width, height: projectResolution.height }
    : { width: baseWidth, height: baseHeight };
  // Hoisted out of the frame loop: both are constant for the whole export, and
  // neither should cost an allocation per frame.
  const outputSize = { width, height };
  const drawOptions: MediaDrawOptions = {
    filterScale: projectToOutputScale(projectSize, outputSize),
  };

  // Calculate total duration, respecting timeRange if specified
  const fullDuration = calculateTimelineDuration(clips);
  const rangeStart = options.timeRange?.start ?? 0;
  const rangeEnd = options.timeRange?.end ?? fullDuration;
  const totalDuration = rangeEnd - rangeStart;
  const totalFrames = Math.ceil(totalDuration * frameRate);

  // Extract and mix audio first, on the main thread
  // Note: we extract the full timeline audio, then slice it later
  onProgress({ phase: 'preparing', progress: 2, message: 'Extracting audio...' });

  const fullAudioData = await extractAndMixAudio(clips, exportTracks, fullDuration, (p) => {
    onProgress({ phase: 'preparing', progress: 2 + p * 0.08, message: 'Extracting audio...' });
  });

  // Slice audio to the selected time range
  // Audio is stereo interleaved (2 channels), so multiply sample indices by 2
  const audioChannels = 2;
  const audioData = fullAudioData && options.timeRange ? (() => {
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
  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  const videoElements: Map<string, HTMLVideoElement> = new Map();
  const imageElements: Map<string, HTMLImageElement> = new Map();

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
        // Load as video (skip audio-only files for visual rendering)
        try {
          const video = await loadVideoElement(blob);
          videoElements.set(sourceId, video);
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

  // Create Mediabunny output with WebM format
  const target = new BufferTarget();
  const output = new Output({
    format: new WebMOutputFormat(),
    target,
  });

  // Create video and audio packet sources
  const videoSource = new EncodedVideoPacketSource('vp9');
  output.addVideoTrack(videoSource, { frameRate });

  let audioSource: EncodedAudioPacketSource | null = null;
  if (audioData) {
    audioSource = new EncodedAudioPacketSource('opus');
    output.addAudioTrack(audioSource);
  }

  // Start the output
  await output.start();

  // Create video encoder
  const videoEncoder = new VideoEncoder({
    output: async (chunk, meta) => {
      await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
    },
    error: (e) => {
      console.error('Video encoder error:', e);
    },
  });

  await videoEncoder.configure({
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate: videoBitrate,
    framerate: frameRate,
    latencyMode: 'quality',
  });

  // Create audio encoder if we have audio
  let audioEncoder: AudioEncoder | null = null;
  if (audioData && audioSource) {
    audioEncoder = new AudioEncoder({
      output: async (chunk, meta) => {
        await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: (e) => {
        console.error('Audio encoder error:', e);
      },
    });

    await audioEncoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels: 2,
      bitrate: audioBitrate,
    });
  }

  onProgress({ phase: 'encoding', progress: 18, message: 'Encoding frames...' });

  // Use real-time playback approach for reliable frame capture
  // This plays videos at normal speed and captures frames, avoiding seek issues
  const frameDurationUs = Math.round((1 / frameRate) * 1_000_000);
  let frameCount = 0;

  // Track which videos are currently playing and their state
  const videoPlaybackState = new Map<string, { playing: boolean; targetTime: number }>();

  // Initialize all videos as paused
  for (const [sourceId, video] of videoElements) {
    video.pause();
    video.currentTime = 0;
    videoPlaybackState.set(sourceId, { playing: false, targetTime: 0 });
  }

  // Helper to sync a video to target time - uses playback for small forward movements
  const syncVideoToTime = async (video: HTMLVideoElement, _sourceId: string, targetTime: number): Promise<void> => {
    // Always seek to exact time for frame-accurate export.
    // Skip if already within half a frame of the target.
    const frameDuration = 1 / frameRate;
    if (Math.abs(video.currentTime - targetTime) > frameDuration * 0.4) {
      video.currentTime = targetTime;
      await new Promise<void>((resolve) => {
        video.addEventListener('seeked', () => resolve(), { once: true });
        setTimeout(resolve, 500);
      });
    }

    // Ensure frame data is decoded (readyState >= 2 = HAVE_CURRENT_DATA)
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (video.readyState >= 2) resolve();
          else requestAnimationFrame(check);
        };
        check();
        setTimeout(resolve, 300);
      });
    }
  };

  // Helper to clean up resources on abort or completion
  const cleanup = () => {
    videoElements.forEach((v) => {
      v.pause();
      URL.revokeObjectURL(v.src);
    });
    imageElements.forEach((img) => {
      URL.revokeObjectURL(img.src);
    });
  };

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // Check for abort at start of each frame
      checkAborted(signal);

      const currentTime = rangeStart + frameIndex / frameRate;

      // Check for active transition
      const activeTransition = getActiveTransition(clips, exportTracks, currentTime);

      // Get all clips at current time
      const activeClips = getClipsAtTime(clips, exportTracks, currentTime);

      // Clear the raster to black and put the context in project pixels: every
      // draw below is project-space, exactly as the preview's is.
      openOutputFrame(ctx, projectSize, outputSize);

      // Media clips need their source video synced to time (below) before
      // anything can be drawn; overlays don't. `activeClips` itself —
      // `getClipsAtTime`'s result — is already sorted by track index, and
      // stays the single source of composite order: see the draw loop below.
      const mediaClips: typeof activeClips = [];

      for (const clipData of activeClips) {
        if (!clipData.clip.overlayType) {
          mediaClips.push(clipData);
        }
      }

      // Sync all active videos to their target times
      const syncPromises: Promise<void>[] = [];
      const activeVideoIds = new Set<string>();

      for (const { clip, clipTime } of mediaClips) {
        const video = videoElements.get(clip.sourceVideoId);
        if (!video) continue;

        const sourceTime = clip.startTime + clipTime;
        activeVideoIds.add(clip.sourceVideoId);
        syncPromises.push(syncVideoToTime(video, clip.sourceVideoId, sourceTime));
      }

      // Also sync transition clips
      if (activeTransition) {
        const incomingVideo = videoElements.get(activeTransition.incomingClip.sourceVideoId);
        if (incomingVideo) {
          const clipEnd = activeTransition.outgoingClip.timelinePosition + activeTransition.outgoingClip.duration;
          const incomingClipTime = currentTime - clipEnd;
          const sourceTime = incomingClipTime >= 0
            ? activeTransition.incomingClip.startTime + incomingClipTime
            : activeTransition.incomingClip.startTime;
          activeVideoIds.add(activeTransition.incomingClip.sourceVideoId);
          syncPromises.push(syncVideoToTime(incomingVideo, activeTransition.incomingClip.sourceVideoId, sourceTime));
        }
      }

      // Pause videos that are no longer active
      for (const [sourceId, video] of videoElements) {
        if (!activeVideoIds.has(sourceId)) {
          const state = videoPlaybackState.get(sourceId)!;
          if (state.playing) {
            video.pause();
            state.playing = false;
          }
        }
      }

      await Promise.all(syncPromises);

      // Helper to calculate clip time
      const getClipTime = (clip: Clip) => currentTime - clip.timelinePosition;

      // Composite media and overlay clips in one pass, in `activeClips`' own
      // track order — the same single interleaved pass the preview draws
      // (`components/Preview/drawFrame.ts`), so an overlay on a lower track
      // than a media clip is exactly as hidden behind it here as it is on
      // screen, and a blur shape only reaches the content actually below it.
      for (const { clip } of activeClips) {
        // Skip clips that are part of an active transition
        if (activeTransition &&
            (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
          continue;
        }

        if (!clip.overlayType) {
          const clipTime = getClipTime(clip);

          // Try video first, then image - require readyState >= 2 (frame data available)
          const video = videoElements.get(clip.sourceVideoId);
          if (video && video.readyState >= 2) {
            drawClipToCanvas(
              ctx, video, clip, clipTime, projectSize.width, projectSize.height, undefined, drawOptions
            );
            continue;
          }

          const image = imageElements.get(clip.sourceVideoId);
          if (image) {
            drawImageToCanvasWithModifiers(
              ctx, image, clip, clipTime, projectSize.width, projectSize.height, undefined, drawOptions
            );
          }
          continue;
        }

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

        const animated = getAnimatedValues(
          overlayClipTime,
          clip.duration,
          clip.animation,
          baseTransform,
          clip.effects || DEFAULT_EFFECTS
        );

        if (clip.overlayType === 'shape' && clip.shapeData) {
          drawShapeOverlayToCanvasAnimated(
            ctx, clip.shapeData, projectSize.width, projectSize.height, animated, canvas,
            undefined, drawOptions.filterScale
          );
        } else if (clip.overlayType === 'text' && clip.textData) {
          drawTextOverlayToCanvasAnimated(
            ctx, clip.textData, projectSize.width, projectSize.height, animated, drawOptions.filterScale
          );
        }
      }

      // Draw transition if active
      if (activeTransition) {
        drawTransition(
          ctx, videoElements, imageElements, activeTransition, currentTime,
          projectSize.width, projectSize.height, drawOptions
        );
      }

      // Create VideoFrame from canvas — timestamp relative to export start (not timeline)
      const exportTime = currentTime - rangeStart;
      const timestamp = Math.round(exportTime * 1_000_000);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: frameDurationUs,
      });

      // Encode frame (keyframe every 2 seconds). ESCSUITE-131: close the frame
      // whether encode() succeeds or throws — mirroring exportMP4.ts's own
      // encode block, which closes the frame on both its success and its
      // fatal-retry paths — so a wedged encoder never leaves a decoded/rendered
      // frame for the GC to finalise on top of the error it just raised.
      const keyFrame = frameCount % frameRate === 0;
      try {
        videoEncoder.encode(frame, { keyFrame });
      } finally {
        frame.close();
      }

      frameCount++;

      // Backpressure: wait for encoder to catch up if queue is too large
      // This prevents memory exhaustion while allowing smooth encoding
      while (videoEncoder.encodeQueueSize > 20) {
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

    // Flush and finalize
    onProgress({ phase: 'muxing', progress: 92, message: 'Finalizing WebM...' });

    await videoEncoder.flush();
    videoEncoder.close();

    if (audioEncoder) {
      await audioEncoder.flush();
      audioEncoder.close();
    }

    await output.finalize();

    // A cancel that landed while we were muxing still counts: never hand back
    // an export the caller asked to stop. Thrown before the 'complete' report,
    // so the catch below does the cleanup and rethrows the abort as-is.
    checkAborted(signal);

    // Clean up media elements
    cleanup();

    onProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

    // Get the final buffer
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('Export failed: no data was written to buffer');
    }
    return new Blob([buffer], { type: 'video/webm' });
  } catch (error) {
    // Clean up resources on error
    cleanup();

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

    // Re-throw the error (including ExportAbortedError)
    throw error;
  }
}
