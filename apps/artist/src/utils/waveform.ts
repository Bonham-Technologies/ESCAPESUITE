/**
 * Audio waveform extraction utilities
 * Extracts peak envelope data from audio and video files for timeline visualization
 */

import type { WaveformPeak } from '../store/types';

/**
 * Extract waveform peak data from a media file (audio or video)
 * Returns an array of min/max peak values suitable for visualization
 *
 * @param blob - The media file blob
 * @param samplesPerSecond - Number of peaks per second of audio (default: 100)
 * @returns Object containing peaks array and hasAudio flag
 */
export async function extractWaveformData(
  blob: Blob,
  samplesPerSecond: number = 100
): Promise<{ peaks: WaveformPeak[]; hasAudio: boolean }> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext();

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch {
      // Media file has no decodable audio
      await audioContext.close();
      return { peaks: [], hasAudio: false };
    }

    // Get audio data from first channel (mono or left channel of stereo)
    const channelData = audioBuffer.getChannelData(0);

    // If stereo, average both channels for better representation
    let audioData = channelData;
    if (audioBuffer.numberOfChannels > 1) {
      const rightChannel = audioBuffer.getChannelData(1);
      audioData = new Float32Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        audioData[i] = (channelData[i] + rightChannel[i]) / 2;
      }
    }

    // Calculate number of samples to output
    const totalSamples = Math.ceil(audioBuffer.duration * samplesPerSecond);
    const samplesPerPeak = Math.floor(audioData.length / totalSamples);

    const peaks: WaveformPeak[] = [];

    for (let i = 0; i < totalSamples; i++) {
      const startSample = i * samplesPerPeak;
      const endSample = Math.min(startSample + samplesPerPeak, audioData.length);

      // Find min and max in this segment
      let min = 0;
      let max = 0;

      for (let j = startSample; j < endSample; j++) {
        const sample = audioData[j];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }

      peaks.push({ min, max });
    }

    await audioContext.close();

    // Check if there's actual audio content (not just silence)
    const hasAudioContent = peaks.some(
      (peak) => Math.abs(peak.min) > 0.001 || Math.abs(peak.max) > 0.001
    );

    return { peaks, hasAudio: hasAudioContent };
  } catch (error) {
    console.warn('Failed to extract waveform data:', error);
    return { peaks: [], hasAudio: false };
  }
}

/**
 * Resample waveform peaks to fit a target number of samples
 * Used when rendering waveforms at different zoom levels
 *
 * @param peaks - Original peak data
 * @param targetSamples - Number of samples to output
 * @returns Resampled peak data
 */
export function resamplePeaks(
  peaks: WaveformPeak[],
  targetSamples: number
): WaveformPeak[] {
  if (peaks.length === 0 || targetSamples <= 0) {
    return [];
  }

  if (peaks.length === targetSamples) {
    return peaks;
  }

  const result: WaveformPeak[] = [];
  const ratio = peaks.length / targetSamples;

  for (let i = 0; i < targetSamples; i++) {
    const startIndex = Math.floor(i * ratio);
    const endIndex = Math.min(Math.floor((i + 1) * ratio), peaks.length);

    if (endIndex <= startIndex) {
      // Use single sample
      result.push(peaks[startIndex] || { min: 0, max: 0 });
    } else {
      // Combine multiple samples - find overall min/max
      let min = 0;
      let max = 0;

      for (let j = startIndex; j < endIndex; j++) {
        const peak = peaks[j];
        if (peak.min < min) min = peak.min;
        if (peak.max > max) max = peak.max;
      }

      result.push({ min, max });
    }
  }

  return result;
}

/**
 * Get peak data for a specific time range
 * Used when rendering clips with trim points
 *
 * @param peaks - Full peak data
 * @param duration - Total duration the peaks represent (seconds)
 * @param startTime - Start time of the range (seconds)
 * @param endTime - End time of the range (seconds)
 * @returns Peak data for the specified range
 */
export function getPeaksForRange(
  peaks: WaveformPeak[],
  duration: number,
  startTime: number,
  endTime: number
): WaveformPeak[] {
  if (peaks.length === 0 || duration <= 0) {
    return [];
  }

  const peaksPerSecond = peaks.length / duration;
  const startIndex = Math.max(0, Math.floor(startTime * peaksPerSecond));
  const endIndex = Math.min(peaks.length, Math.ceil(endTime * peaksPerSecond));

  return peaks.slice(startIndex, endIndex);
}
