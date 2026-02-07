// Audio extraction and mixing for the export pipeline
// Supports Web Worker offloading with main thread fallback

import type { Clip, Track } from '../store/types';
import { getVideoBlob } from './storage';
import { getAnimatedVolume } from '../utils/animation';
import { getWorkerSupport } from '../utils/workerSupport';
import type { WorkerRequest, WorkerResponse, AudioClipMeta } from '../workers/exportWorker';
import ExportWorker from '../workers/exportWorker?worker';

/**
 * Extract audio from video files and mix for export
 * Returns audio data as Float32Array stereo interleaved at 48000Hz
 */
export async function extractAndMixAudio(
  clips: Clip[],
  tracks: Track[],
  totalDuration: number,
  onProgress: (percent: number) => void
): Promise<Float32Array | null> {
  const sampleRate = 48000;
  const channels = 2;
  const totalSamples = Math.ceil(totalDuration * sampleRate);

  // Create output buffer (stereo interleaved)
  const outputBuffer = new Float32Array(totalSamples * channels);

  // Create offline audio context for decoding
  const offlineCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);

  // Track which clips have audio
  let hasAnyAudio = false;

  // Process each clip
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const track = tracks.find(t => t.id === clip.trackId);

    // Skip muted tracks
    if (track?.muted) continue;

    // Get track volume (default to 1 if not set)
    const trackVolume = track?.volume ?? 1;

    try {
      const blob = await getVideoBlob(clip.sourceVideoId);
      if (!blob) continue;

      // Decode audio from blob
      const arrayBuffer = await blob.arrayBuffer();
      let audioBuffer: AudioBuffer;

      try {
        audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0));
      } catch {
        // No audio in this video
        continue;
      }

      hasAnyAudio = true;

      // Calculate positions
      const clipStartInTimeline = clip.timelinePosition;
      const clipSourceStart = clip.startTime;
      const clipDuration = clip.duration;

      // Sample positions
      const outputStartSample = Math.floor(clipStartInTimeline * sampleRate);
      const sourceStartSample = Math.floor(clipSourceStart * sampleRate);
      const durationSamples = Math.floor(clipDuration * sampleRate);

      // Check if clip has volume keyframes (optimization: compute once per clip)
      const hasVolumeKeyframes = clip.animation?.keyframes?.volume && clip.animation.keyframes.volume.length > 0;

      // Get audio data from source
      for (let ch = 0; ch < Math.min(channels, audioBuffer.numberOfChannels); ch++) {
        const sourceData = audioBuffer.getChannelData(ch);

        for (let s = 0; s < durationSamples; s++) {
          const sourceIdx = sourceStartSample + s;
          const outputIdx = (outputStartSample + s) * channels + ch;

          if (sourceIdx >= 0 && sourceIdx < sourceData.length && outputIdx >= 0 && outputIdx < outputBuffer.length) {
            // Calculate clip-relative time for this sample
            const sampleClipTime = s / sampleRate;

            // Get animated volume (only compute if clip has keyframes)
            const clipVolume = hasVolumeKeyframes
              ? getAnimatedVolume(sampleClipTime, clip.animation, 1)
              : 1;

            // Mix audio with combined track and clip volume
            const combinedVolume = trackVolume * clipVolume;
            outputBuffer[outputIdx] += sourceData[sourceIdx] * combinedVolume;
          }
        }
      }

      // If mono source, copy to both channels
      if (audioBuffer.numberOfChannels === 1) {
        const sourceData = audioBuffer.getChannelData(0);
        for (let s = 0; s < durationSamples; s++) {
          const sourceIdx = sourceStartSample + s;
          const outputIdx = (outputStartSample + s) * channels + 1;

          if (sourceIdx >= 0 && sourceIdx < sourceData.length && outputIdx >= 0 && outputIdx < outputBuffer.length) {
            // Calculate clip-relative time for this sample
            const sampleClipTime = s / sampleRate;

            // Get animated volume (only compute if clip has keyframes)
            const clipVolume = hasVolumeKeyframes
              ? getAnimatedVolume(sampleClipTime, clip.animation, 1)
              : 1;

            // Mix audio with combined track and clip volume
            const combinedVolume = trackVolume * clipVolume;
            outputBuffer[outputIdx] += sourceData[sourceIdx] * combinedVolume;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to extract audio from clip:', e);
    }

    onProgress((i + 1) / clips.length * 100);
  }

  if (!hasAnyAudio) {
    return null;
  }

  // Normalize to prevent clipping
  let maxSample = 0;
  for (let i = 0; i < outputBuffer.length; i++) {
    maxSample = Math.max(maxSample, Math.abs(outputBuffer[i]));
  }

  if (maxSample > 1) {
    const scale = 0.95 / maxSample;
    for (let i = 0; i < outputBuffer.length; i++) {
      outputBuffer[i] *= scale;
    }
  }

  return outputBuffer;
}

/**
 * Extract and mix audio using Web Worker
 * Falls back to main thread if worker is unavailable
 */
export async function extractAndMixAudioWithWorker(
  clips: Clip[],
  tracks: Track[],
  totalDuration: number,
  onProgress: (percent: number) => void
): Promise<Float32Array | null> {
  // Check worker support
  const canUseWorker = await getWorkerSupport();

  if (!canUseWorker) {
    // Fall back to main thread extraction
    return extractAndMixAudio(clips, tracks, totalDuration, onProgress);
  }

  try {
    // Create worker using Vite's bundled worker
    const worker = new ExportWorker();

    // Collect audio blobs and metadata
    const audioBlobs: ArrayBuffer[] = [];
    const clipMeta: AudioClipMeta[] = [];
    const sourceIndexMap = new Map<string, number>();

    for (const clip of clips) {
      if (!clip.sourceVideoId) continue;

      const track = tracks.find((t) => t.id === clip.trackId);
      if (!track) continue;

      // Get blob if not already loaded
      if (!sourceIndexMap.has(clip.sourceVideoId)) {
        const blob = await getVideoBlob(clip.sourceVideoId);
        if (blob) {
          const arrayBuffer = await blob.arrayBuffer();
          sourceIndexMap.set(clip.sourceVideoId, audioBlobs.length);
          audioBlobs.push(arrayBuffer);
        }
      }

      const sourceIndex = sourceIndexMap.get(clip.sourceVideoId);
      if (sourceIndex === undefined) continue;

      clipMeta.push({
        sourceIndex,
        clipId: clip.id,
        trackId: clip.trackId,
        trackVolume: track.volume ?? 1,
        trackMuted: track.muted,
        sourceStartTime: clip.startTime,
        clipDuration: clip.duration,
        timelinePosition: clip.timelinePosition,
      });
    }

    // Initialize worker
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 5000);

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'INIT_COMPLETE') {
          clearTimeout(timeout);
          resolve();
        } else if (e.data.type === 'ERROR') {
          clearTimeout(timeout);
          reject(new Error(e.data.error));
        }
      };

      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`Worker error: ${e.message}`));
      };

      worker.postMessage({
        type: 'INIT',
        clips,
        tracks,
        totalDuration,
      } as WorkerRequest);
    });

    // Request audio extraction
    const audioResult = await new Promise<Float32Array | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio extraction timeout')), 60000);

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'AUDIO_READY') {
          clearTimeout(timeout);
          resolve(e.data.hasAudio ? e.data.audioBuffer : null);
        } else if (e.data.type === 'AUDIO_PROGRESS') {
          onProgress(e.data.progress);
        } else if (e.data.type === 'ERROR') {
          clearTimeout(timeout);
          reject(new Error(e.data.error));
        }
      };

      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`Worker error: ${e.message}`));
      };

      // Transfer audio blobs to worker
      worker.postMessage(
        {
          type: 'EXTRACT_AUDIO',
          audioBlobs,
          clipMeta,
        } as WorkerRequest,
        { transfer: audioBlobs }
      );
    });

    // Terminate worker
    worker.postMessage({ type: 'TERMINATE' } as WorkerRequest);
    worker.terminate();

    return audioResult;
  } catch (error) {
    console.warn('Worker audio extraction failed, falling back to main thread:', error);
    // Fall back to main thread extraction
    return extractAndMixAudio(clips, tracks, totalDuration, onProgress);
  }
}
