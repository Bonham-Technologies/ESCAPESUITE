// Audio extraction and mixing for the export pipeline.
//
// This used to have a Web Worker fast path (`extractAndMixAudioWithWorker`,
// `workers/exportWorker.ts`, `utils/workerSupport.ts`). ESCSUITE-99 deleted it:
// the worker's own audio mixer multiplied by `trackVolume` alone and never
// applied volume keyframes, and its support probe tests for
// `OfflineAudioContext` *inside* the worker — which real Chromium does not
// expose to a DedicatedWorker — so `getWorkerSupport()` always resolved
// `false` and the worker path never ran in production. This is now the only
// mixer; it runs on the main thread and applies `getAnimatedVolume` per
// sample, same as the preview.

import type { Clip, Track } from '../store/types';
import { getVideoBlob } from './storage';
import { getAnimatedVolume } from '../utils/animation';

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

    // Skip a clip whose track has been deleted, and skip muted tracks
    if (!track || track.muted) continue;

    // Get track volume (default to 1 if not set)
    const trackVolume = track.volume ?? 1;

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
