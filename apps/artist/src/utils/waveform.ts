/**
 * Audio waveform extraction utilities
 * Extracts peak envelope data from audio and video files for timeline visualization
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';
import type { WaveformPeak } from '../store/types';
import { PeakReducer, mixToMono, peakSecondsFor, peaksFromPcm } from './waveformPeaks';
import { PacketClock, TimestampPlacer, placeDecodedFile, placesByTimestamp } from './audioPlacement';

/**
 * Extract waveform peak data from a media file (audio or video)
 * Returns an array of min/max peak values suitable for visualization
 *
 * Two ways in, one result (ESCSUITE-338). The file's audio track is decoded a
 * chunk at a time through mediabunny (WebCodecs `AudioDecoder`, or mediabunny's
 * own PCM reader for a WAV) and reduced to peaks as it arrives, so the decoded
 * track is never held: memory stays at the peaks plus one decoder chunk, where
 * a whole-file `decodeAudioData` held every sample as Float32 (~23 MB a minute
 * of 48 kHz stereo). `PeakReducer` buckets exactly as the whole-buffer
 * algorithm does, so the peaks are the ones that path gives for the same PCM.
 *
 * The whole-file `decodeAudioData` is kept as the fallback for what the
 * streamed path cannot read: a container no mediabunny demuxer recognises, a
 * codec this browser has no `AudioDecoder` for (or no `AudioDecoder` at all),
 * MP3 (below), or a decode that fails part-way. A container mediabunny reads
 * and finds no audio track in answers `hasAudio: false` with no decode.
 *
 * Peaks come out at the track's own sample rate, where `decodeAudioData`
 * resampled to the AudioContext's (the output device's) rate; both bucket the
 * same hundredth of a second. Measured differences are in the "Audio Waveform
 * Visibility" reference doc.
 *
 * `secondsPerPeak` is how long each peak lasts (ESCSUITE-403): 1 /
 * samplesPerSecond at any rate since ESCSUITE-418 (`peakSecondsFor`), where
 * the bucketing before it made it a sample short of that. Absent when there
 * are no peaks. Callers store it beside the peaks as `SourceVideo.waveformSecondsPerPeak`.
 *
 * @param blob - The media file blob
 * @param samplesPerSecond - Number of peaks per second of audio (default: 100)
 * @returns Object containing peaks array, hasAudio flag and each peak's length
 */
export async function extractWaveformData(
  blob: Blob,
  samplesPerSecond: number = 100
): Promise<WaveformExtraction> {
  let streamed: { peaks: WaveformPeak[]; secondsPerPeak?: number } | null = null;
  try {
    streamed = await streamWaveformPeaks(blob, samplesPerSecond);
  } catch (error) {
    console.warn('Streamed waveform decode failed; decoding the whole file instead:', error);
  }
  if (streamed) return withTiming(streamed.peaks, hasAudibleContent(streamed.peaks), streamed.secondsPerPeak);
  return decodeWholeFileWaveform(blob, samplesPerSecond);
}

/** What `extractWaveformData` answers. */
export interface WaveformExtraction {
  peaks: WaveformPeak[];
  hasAudio: boolean;
  /** Seconds each peak covers; absent with no peaks. */
  secondsPerPeak?: number;
}

function withTiming(peaks: WaveformPeak[], hasAudio: boolean, secondsPerPeak: number | undefined): WaveformExtraction {
  return peaks.length > 0 && secondsPerPeak !== undefined ? { peaks, hasAudio, secondsPerPeak } : { peaks, hasAudio };
}

/** Whether any peak rises above silence (a heuristic `hasAudio` has always used). */
function hasAudibleContent(peaks: WaveformPeak[]): boolean {
  return peaks.some((peak) => Math.abs(peak.min) > 0.001 || Math.abs(peak.max) > 0.001);
}

/**
 * The streamed path: the peaks of the file's primary audio track, decoded and
 * reduced a chunk at a time, with how long each lasts. No peaks for a
 * container with no audio track (or one with no samples); `null` when this
 * path cannot read the file at all, so the caller falls back to the
 * whole-file decode.
 */
async function streamWaveformPeaks(
  blob: Blob,
  samplesPerSecond: number
): Promise<{ peaks: WaveformPeak[]; secondsPerPeak?: number } | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    let track: InputAudioTrack | null;
    try {
      track = await input.getPrimaryAudioTrack();
    } catch {
      // No demuxer recognises the bytes; decodeAudioData may still.
      return null;
    }
    if (!track) return { peaks: [] };
    // MP3 is left to decodeAudioData: mediabunny does not apply the encoder
    // delay and padding a LAME/Xing header declares, which decodeAudioData
    // trims, so streamed peaks would sit ~25 ms late against the old ones.
    const codec = await track.getCodec();
    if (codec === 'mp3') return null;
    if (!(await track.canDecode())) return null;

    let reducer: PeakReducer | null = null;
    let placer: TimestampPlacer | null = null;
    // Opus and AAC only: see `placesByTimestamp`.
    const clock = placesByTimestamp(codec) ? new PacketClock(track) : null;
    // Reused across chunks: one plane per channel the mix reads (at most two).
    const planes: Float32Array[] = [];
    try {
      for await (const sample of new AudioSampleSink(track).samples()) {
        try {
          // One decoded chunk per packet, in decode order: each chunk is
          // placed by its packet's timestamp (ESCSUITE-368), so a hole in a
          // MediaRecorder track shows as a silent stretch where it plays.
          const stamp = clock ? await clock.next() : null;
          // Frames before zero are codec priming (an MP4 edit list's, say),
          // which decodeAudioData drops too. Opus pre-skip in a WebM is not
          // skipped here: mediabunny's Matroska demuxer ignores it, but
          // Chromium's AudioDecoder trims it itself (a CRAFT take's first chunk
          // is 960 - 312 frames), so skipping it again would put peaks early.
          const priming = Math.min(
            sample.numberOfFrames,
            Math.max(0, Math.round(-sample.timestamp * sample.sampleRate))
          );
          if (sample.numberOfFrames - priming === 0) continue;
          reducer ??= new PeakReducer(sample.sampleRate, samplesPerSecond);
          placer ??= new TimestampPlacer(sample.sampleRate);
          const before = placer.position;
          const { at, skip } = placer.place(
            stamp === null ? null : stamp + priming / sample.sampleRate,
            sample.numberOfFrames - priming
          );
          pushSilence(reducer, at - before);
          const frames = sample.numberOfFrames - priming - skip;
          if (frames === 0) continue;
          const channels = Math.min(2, sample.numberOfChannels);
          const chunk: Float32Array[] = [];
          for (let c = 0; c < channels; c++) {
            if (!planes[c] || planes[c].length < frames) planes[c] = new Float32Array(frames);
            const plane = planes[c].subarray(0, frames);
            sample.copyTo(plane, { planeIndex: c, format: 'f32-planar', frameOffset: priming + skip, frameCount: frames });
            chunk.push(plane);
          }
          reducer.push(chunk);
        } finally {
          sample.close();
        }
      }
    } finally {
      await clock?.close();
    }
    if (!reducer) return { peaks: [] };
    const peaks = reducer.finish();
    return { peaks, secondsPerPeak: reducer.secondsPerPeak };
  } finally {
    input.dispose();
  }
}

/** Up to a second of zeros, shared by every hole {@link pushSilence} fills. */
let silence = new Float32Array(0);

/** Feed `frames` frames of silence to `reducer`: a hole in the track, placed by its timestamps. */
function pushSilence(reducer: PeakReducer, frames: number): void {
  if (frames <= 0) return;
  if (silence.length === 0) silence = new Float32Array(48_000);
  for (let left = frames; left > 0; left -= silence.length) {
    reducer.push([silence.subarray(0, Math.min(left, silence.length))]);
  }
}

/**
 * The fallback: the whole file through `decodeAudioData`, every sample in
 * memory at once. Never throws; a file with no decodable audio has no peaks.
 */
async function decodeWholeFileWaveform(
  blob: Blob,
  samplesPerSecond: number
): Promise<WaveformExtraction> {
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

    // The first channel, or the average of the first two for stereo and wider
    const channels = [audioBuffer.getChannelData(0)];
    if (audioBuffer.numberOfChannels > 1) channels.push(audioBuffer.getChannelData(1));
    let audioData = mixToMono(channels, audioBuffer.length);
    // decodeAudioData lays the samples end to end; where the packets'
    // timestamps leave holes, place them by those instead (ESCSUITE-368).
    const runs = await placeDecodedFile(blob, audioBuffer.length, audioBuffer.sampleRate);
    if (runs) {
      const last = runs[runs.length - 1];
      const placed = new Float32Array(last[2] + last[1]);
      for (const [from, frames, at] of runs) placed.set(audioData.subarray(from, from + frames), at);
      audioData = placed;
    }
    const peaks = peaksFromPcm(audioData, audioBuffer.sampleRate, samplesPerSecond);

    await audioContext.close();

    // The rate decodeAudioData resampled to (the output device's), not the file's.
    return withTiming(peaks, hasAudibleContent(peaks), peakSecondsFor(audioData.length, audioBuffer.sampleRate, samplesPerSecond));
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
 * @param output - An array to reuse instead of allocating a fresh one
 *   (ESCSUITE-13 round 2, MAJOR-1(d)). When supplied, each `{min,max}` object
 *   already at an index is mutated in place rather than replaced, and the
 *   array is resized to exactly `targetSamples` — so a caller that resamples
 *   the same clip repeatedly (a scroll, a zoom) can hand back its own
 *   previous output and avoid allocating `targetSamples` new objects every
 *   time. Omitted, this allocates fresh, as before. Never aliases a source
 *   `peaks` element directly (the single-sample branch below used to): the
 *   output must be safe to mutate on a later call without corrupting the
 *   caller's source data.
 * @returns Resampled peak data — `output` itself when supplied
 */
export function resamplePeaks(
  peaks: WaveformPeak[],
  targetSamples: number,
  output?: WaveformPeak[]
): WaveformPeak[] {
  if (peaks.length === 0 || targetSamples <= 0) {
    if (output) {
      output.length = 0;
      return output;
    }
    return [];
  }

  if (peaks.length === targetSamples && !output) {
    return peaks;
  }

  const result = output ?? [];
  const ratio = peaks.length / targetSamples;

  for (let i = 0; i < targetSamples; i++) {
    const startIndex = Math.floor(i * ratio);
    const endIndex = Math.min(Math.floor((i + 1) * ratio), peaks.length);

    let min = 0;
    let max = 0;

    if (endIndex <= startIndex) {
      // Use single sample. peaks is dense (every index < peaks.length holds
      // a real element) by construction here, the same assumption the
      // multi-sample branch below already makes of peaks[j] — so this reads
      // it unconditionally rather than guarding against a hole no caller can
      // produce (ESCSUITE-13 coverage round: the guard's false side was only
      // reachable via a constructed sparse array, deleted per the
      // ESCSUITE-110 / 118 precedent of removing an operand nothing can
      // reach rather than testing it with one).
      const single = peaks[startIndex];
      min = single.min;
      max = single.max;
    } else {
      // Combine multiple samples - find overall min/max
      for (let j = startIndex; j < endIndex; j++) {
        const peak = peaks[j];
        if (peak.min < min) min = peak.min;
        if (peak.max > max) max = peak.max;
      }
    }

    const existing = result[i];
    if (existing) {
      existing.min = min;
      existing.max = max;
    } else {
      result[i] = { min, max };
    }
  }

  result.length = targetSamples;
  return result;
}

/**
 * Get peak data for a specific time range
 * Used when rendering clips with trim points
 *
 * The slice is drawn stretched across `[startTime, endTime]`, so each peak's
 * place in it must be its time. With `secondsPerPeak` (the source's own peak
 * timing, `peakTimingOf(source).estimate`, ESCSUITE-418) peak i is
 * `[i, i + 1) · secondsPerPeak` of source, whatever `duration` says; where
 * the range runs past the last peak (peaks bucketed before ESCSUITE-418
 * dropped the track's last ~0.2 %, and a container can outlast its audio) it
 * is filled with silent peaks, up to `duration`, rather than the peaks there
 * are being stretched over it. Without it the peaks are read as spread evenly
 * over `duration`, as they always were.
 *
 * @param peaks - Full peak data
 * @param duration - Total duration the peaks represent (seconds)
 * @param startTime - Start time of the range (seconds)
 * @param endTime - End time of the range (seconds)
 * @param secondsPerPeak - How long each peak lasts (seconds), when known
 * @returns Peak data for the specified range
 */
export function getPeaksForRange(
  peaks: WaveformPeak[],
  duration: number,
  startTime: number,
  endTime: number,
  secondsPerPeak?: number
): WaveformPeak[] {
  if (peaks.length === 0 || duration <= 0) {
    return [];
  }

  if (secondsPerPeak !== undefined && secondsPerPeak > 0 && Number.isFinite(secondsPerPeak)) {
    // A hair of slack either way, so a time on a peak boundary (290 / 0.01
    // is 28999.999…) is read as that boundary, not a peak to one side of it.
    const first = (time: number) => Math.floor(time / secondsPerPeak + 1e-9);
    const after = (time: number) => Math.ceil(time / secondsPerPeak - 1e-9);
    const last = Number.isFinite(duration) ? Math.max(peaks.length, after(duration)) : peaks.length;
    const startIndex = Math.max(0, first(startTime));
    const endIndex = Math.min(last, after(endTime));
    const slice = peaks.slice(startIndex, endIndex);
    for (let i = Math.max(startIndex, peaks.length); i < endIndex; i++) slice.push({ min: 0, max: 0 });
    return slice;
  }

  const peaksPerSecond = peaks.length / duration;
  const startIndex = Math.max(0, Math.floor(startTime * peaksPerSecond));
  const endIndex = Math.min(peaks.length, Math.ceil(endTime * peaksPerSecond));

  return peaks.slice(startIndex, endIndex);
}
