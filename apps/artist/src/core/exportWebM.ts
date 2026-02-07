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
import { getClipsAtTime } from '../store/projectStore';
import { getAnimatedValuesCached, clearAnimationCache } from '../utils/animation';
import { drawWatermark, type WatermarkConfig } from '../utils/watermark';
import type { ProgressCallback } from './exportTypes';
import {
  checkAborted,
  isWebMExportSupported,
  getQualitySettings,
  getResolution,
  loadVideoElement,
  loadImageElement,
  clearSeekPositions,
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
import { extractAndMixAudioWithWorker } from './audioMixer';

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
  watermark?: WatermarkConfig | null,
  signal?: AbortSignal
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

  // Clear optimization caches at start of export
  clearSeekPositions();
  clearAnimationCache();

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

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

  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight);
  const { videoBitrate, audioBitrate } = getQualitySettings(options.quality);
  const frameRate = 30;
  const sampleRate = 48000;

  // Calculate total duration
  const totalDuration = calculateTimelineDuration(clips);
  const totalFrames = Math.ceil(totalDuration * frameRate);

  // Extract and mix audio first (uses Web Worker if available, falls back to main thread)
  onProgress({ phase: 'preparing', progress: 2, message: 'Extracting audio...' });

  const audioData = await extractAndMixAudioWithWorker(clips, exportTracks, totalDuration, (p) => {
    onProgress({ phase: 'preparing', progress: 2 + p * 0.08, message: 'Extracting audio...' });
  });

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
  const frameDurationMs = 1000 / frameRate;
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
  const syncVideoToTime = async (video: HTMLVideoElement, sourceId: string, targetTime: number): Promise<void> => {
    const state = videoPlaybackState.get(sourceId)!;
    const currentPos = video.currentTime;
    const diff = targetTime - currentPos;

    // If we need to go backwards or jump more than 0.5s forward, seek
    if (diff < -0.05 || diff > 0.5) {
      video.pause();
      video.currentTime = targetTime;
      state.playing = false;
      // Wait for seek to complete
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        // Timeout fallback
        setTimeout(resolve, 200);
      });
    } else if (diff > 0.05) {
      // Small forward movement - let video play to catch up
      if (!state.playing) {
        video.play().catch(() => {});
        state.playing = true;
      }
    }
    // If diff is very small (-0.05 to 0.05), we're close enough - do nothing

    state.targetTime = targetTime;
  };

  // Process frames using requestAnimationFrame for smooth timing
  const exportStartTime = performance.now();

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

      const currentTime = frameIndex / frameRate;

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

      // Wait for the real-time frame interval to maintain proper pacing
      const targetRealTime = exportStartTime + (frameIndex * frameDurationMs);
      const now = performance.now();
      if (now < targetRealTime) {
        await new Promise(resolve => setTimeout(resolve, targetRealTime - now));
      }

      // Helper to calculate clip time
      const getClipTime = (clip: Clip) => currentTime - clip.timelinePosition;

      // Draw each media clip (bottom to top by track index)
      for (const { clip } of mediaClips) {
        // Skip clips that are part of an active transition
        if (activeTransition &&
            (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
          continue;
        }

        const clipTime = getClipTime(clip);

        // Try video first, then image - use readyState >= 1 (like preview player)
        const video = videoElements.get(clip.sourceVideoId);
        if (video && video.readyState >= 1) {
          drawClipToCanvas(ctx, video, clip, clipTime, width, height);
          continue;
        }

        const image = imageElements.get(clip.sourceVideoId);
        if (image) {
          drawImageToCanvasWithModifiers(ctx, image, clip, clipTime, width, height);
        }
      }

      // Draw transition if active
      if (activeTransition) {
        drawTransition(ctx, videoElements, imageElements, activeTransition, currentTime, width, height);
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

      // Draw watermark if enabled (for trial users)
      if (watermark) {
        drawWatermark(ctx, width, height, watermark);
      }

      // Create VideoFrame from canvas
      const timestamp = Math.round(currentTime * 1_000_000);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: frameDurationUs,
      });

      // Encode frame (keyframe every 2 seconds)
      const keyFrame = frameCount % (frameRate * 2) === 0;
      videoEncoder.encode(frame, { keyFrame });
      frame.close();

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
