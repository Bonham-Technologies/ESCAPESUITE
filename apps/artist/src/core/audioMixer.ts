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
//
// Long recordings (ESCSUITE-367). Chromium refuses any single ArrayBuffer of
// 2 GiB or more, and this mixer used to hold three that grow with length: the
// whole timeline interleaved (2.76 GB for two hours, refused outright, even
// when a few seconds were exported), and for every clip the whole source file
// twice plus its whole decoded track (a CRAFT take passes 2 GiB at about 1 h
// 50 min, and the failed read was taken for "no audio", so the export went out
// silent). Now only the exported range is mixed, one array per channel, and
// each source is decoded once, a chunk at a time, straight into the clips that
// use it — the ESCSUITE-338 waveform pattern. The whole-file `decodeAudioData`
// is kept as the fallback for what the streamed path cannot read, for a file
// that fits in one buffer.

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import type { Clip, Track } from '../store/types';
import { isVisibleTrack } from '../store/trackVisibility';
import { getVideoBlob } from './storage';
import { getAnimatedVolume } from '../utils/animation';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

/**
 * The largest source the whole-file fallback reads into one ArrayBuffer.
 * Chromium 141 allocates 1.99 GiB and refuses 1.999 GiB; this stays under it
 * with room for the browser's own bookkeeping.
 */
export const WHOLE_FILE_DECODE_MAX_BYTES = Math.floor(1.9 * 1024 ** 3);

/**
 * A source whose sound exists but cannot be read: too large for the
 * whole-file fallback, or failing part-way through the streamed decode after
 * some of it was mixed. Fails the export by name rather than exporting it
 * silent or half-mixed.
 */
export class SourceAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceAudioError';
  }
}

/** One clip of a source, in output frames (relative to the mixed range) and source frames. */
interface Placement {
  clip: Clip;
  /** Output frame the clip's first source frame lands on; may be negative. */
  outStart: number;
  /** Source frame the clip reads from. */
  srcStart: number;
  /** Frames the clip covers. */
  frames: number;
  trackVolume: number;
  hasVolumeKeyframes: boolean;
}

/**
 * Extract audio from video files and mix it for export: planar stereo at
 * 48000 Hz (`[left, right]`), covering `range` when one is given and the whole
 * timeline otherwise, or `null` when no clip has decodable audio.
 *
 * Sample positions are the ones the interleaved whole-timeline mix always
 * used, sliced the way the exporters sliced it: a clip lands at
 * `floor(timelinePosition * 48000)`, reads from `floor(startTime * 48000)` for
 * `floor(duration * 48000)` frames, and a range runs from
 * `floor(start * 48000)` to `floor(end * 48000)`.
 */
export async function extractAndMixAudio(
  clips: Clip[],
  tracks: Track[],
  totalDuration: number,
  onProgress: (percent: number) => void,
  range?: { start: number; end: number }
): Promise<Float32Array[] | null> {
  const timelineFrames = Math.ceil(totalDuration * SAMPLE_RATE);
  const first = range ? Math.floor(range.start * SAMPLE_RATE) : 0;
  const end = range ? Math.min(Math.floor(range.end * SAMPLE_RATE), timelineFrames) : timelineFrames;
  const frameCount = end - first;

  // Nothing to mix (ESCSUITE-257): a zero or negative length would make the
  // buffers below throw a raw browser error. `!(>= 1)` also catches NaN.
  if (!(frameCount >= 1)) return null;

  const output = Array.from({ length: CHANNELS }, () => new Float32Array(frameCount));

  // Every audible clip, grouped by source in timeline order, so a source cut
  // into many clips is decoded once.
  const bySource = new Map<string, Placement[]>();
  for (const clip of clips) {
    const track = tracks.find(t => t.id === clip.trackId);

    // Skip a clip whose track has been deleted, a muted track, and a hidden
    // track (ESCSUITE-127: the preview is already silent for a hidden track
    // — `getClipsAtTime` filters on it too — so an export agrees).
    if (!track || track.muted || !isVisibleTrack(track)) continue;

    const placement: Placement = {
      clip,
      outStart: Math.floor(clip.timelinePosition * SAMPLE_RATE) - first,
      srcStart: Math.floor(clip.startTime * SAMPLE_RATE),
      frames: Math.floor(clip.duration * SAMPLE_RATE),
      trackVolume: track.volume ?? 1,
      hasVolumeKeyframes: !!clip.animation?.keyframes?.volume && clip.animation.keyframes.volume.length > 0,
    };
    const list = bySource.get(clip.sourceVideoId);
    if (list) list.push(placement);
    else bySource.set(clip.sourceVideoId, [placement]);
  }

  // Built only if a source needs the whole-file fallback. Only its
  // decodeAudioData is used, never a render, so one frame is enough: a context
  // sized to a long range could itself fail to allocate.
  let offlineCtx: OfflineAudioContext | null = null;
  const getOfflineCtx = () => (offlineCtx ??= new OfflineAudioContext(CHANNELS, 1, SAMPLE_RATE));

  let hasAnyAudio = false;
  let done = 0;

  for (const [sourceId, placements] of bySource) {
    const name = placements[0].clip.name || sourceId;
    // Only the placements that reach into the range need any decoding; the
    // rest still count towards whether the timeline has audio at all, as they
    // did when the whole timeline was mixed and then sliced.
    const audible = placements.filter((p) => intersects(p, frameCount));
    try {
      const blob = await getVideoBlob(sourceId);
      if (blob) {
        let hasAudio = await streamSourceInto(blob, audible, output, name);
        // A file too large for the fallback whose clips all miss the range
        // adds nothing to the mix, so it need not be read at all.
        const skip = audible.length === 0 && blob.size > WHOLE_FILE_DECODE_MAX_BYTES;
        if (hasAudio === null && !skip) {
          hasAudio = await decodeWholeSourceInto(blob, audible, output, name, getOfflineCtx);
        }
        if (hasAudio) hasAnyAudio = true;
      }
    } catch (e) {
      if (e instanceof SourceAudioError) throw e;
      console.warn('Failed to extract audio from source:', e);
    }

    done++;
    onProgress(done / bySource.size * 100);
  }

  if (!hasAnyAudio) {
    return null;
  }

  // Normalize to prevent clipping
  let maxSample = 0;
  for (const channel of output) {
    for (let i = 0; i < channel.length; i++) {
      maxSample = Math.max(maxSample, Math.abs(channel[i]));
    }
  }

  if (maxSample > 1) {
    const scale = 0.95 / maxSample;
    for (const channel of output) {
      for (let i = 0; i < channel.length; i++) {
        channel[i] *= scale;
      }
    }
  }

  return output;
}

/** Whether any of a placement's frames land inside an output of `frameCount` frames. */
function intersects(p: Placement, frameCount: number): boolean {
  return p.frames > 0 && p.outStart < frameCount && p.outStart + p.frames > 0;
}

/**
 * Mix one run of decoded source frames — `planes` (one per channel, one plane
 * for mono, which feeds both outputs), `count` frames from source frame
 * `chunkStart` — into every placement that reads any of them.
 */
function mixChunk(
  planes: readonly Float32Array[],
  chunkStart: number,
  count: number,
  placements: readonly Placement[],
  output: readonly Float32Array[]
): void {
  const outLength = output[0].length;
  for (const p of placements) {
    // Source frames the clip reads, within this chunk, that land in the output.
    const lo = Math.max(p.srcStart, chunkStart, p.srcStart - p.outStart);
    const hi = Math.min(p.srcStart + p.frames, chunkStart + count, p.srcStart - p.outStart + outLength);
    for (let src = lo; src < hi; src++) {
      const s = src - p.srcStart;
      // Clip-relative time for this sample; animated volume only when the clip
      // has keyframes (computed once per clip, as before).
      const clipVolume = p.hasVolumeKeyframes ? getAnimatedVolume(s / SAMPLE_RATE, p.clip.animation, 1) : 1;
      // Mix audio with combined track and clip volume
      const combinedVolume = p.trackVolume * clipVolume;
      const at = p.outStart + s;
      const from = src - chunkStart;
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][at] += planes[Math.min(ch, planes.length - 1)][from] * combinedVolume;
      }
    }
  }
}

/** The source frame after the last one any placement reads. */
function neededEnd(placements: readonly Placement[]): number {
  let end = 0;
  for (const p of placements) end = Math.max(end, p.srcStart + p.frames);
  return end;
}

/**
 * The streamed path: the source's primary audio track decoded a chunk at a
 * time and mixed as it arrives, so neither the file nor its decoded track is
 * ever held whole. Frames are counted from the first one at or after time
 * zero, end to end, which is how `decodeAudioData` lays a track out.
 *
 * `true` when the source has audio (mixed), `false` when it has none, and
 * `null` when this path cannot read it at all — no demuxer, no decoder, MP3,
 * a rate other than 48 kHz (which `decodeAudioData` resamples), or a decode
 * that failed before anything was mixed — so the caller falls back.
 */
async function streamSourceInto(
  blob: Blob,
  placements: readonly Placement[],
  output: readonly Float32Array[],
  name: string
): Promise<boolean | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    let track;
    try {
      track = await input.getPrimaryAudioTrack();
      if (!track) return false;
      // MP3 is left to decodeAudioData: mediabunny does not apply the encoder
      // delay and padding a LAME/Xing header declares, which decodeAudioData
      // trims (see `utils/waveform.ts`).
      if ((await track.getCodec()) === 'mp3') return null;
      if (track.sampleRate !== SAMPLE_RATE) return null;
      if (!(await track.canDecode())) return null;
    } catch {
      // No demuxer recognises the bytes, or no decoder answers for them;
      // decodeAudioData may still read them.
      return null;
    }

    const stopAt = neededEnd(placements);
    if (stopAt <= 0) return true;

    let position = 0;
    // Reused across chunks: one plane per channel the mix reads (at most two).
    const planes: Float32Array[] = [];
    try {
      for await (const sample of new AudioSampleSink(track).samples()) {
        try {
          if (sample.sampleRate !== SAMPLE_RATE) {
            throw new Error(`decoded at ${sample.sampleRate} Hz`);
          }
          // Frames before zero are codec priming (an MP4 edit list's, say),
          // which decodeAudioData drops too. Opus pre-skip in a WebM is not
          // skipped here: Chromium's AudioDecoder trims it itself (see
          // `utils/waveform.ts`).
          const skip = Math.min(
            sample.numberOfFrames,
            Math.max(0, Math.round(-sample.timestamp * sample.sampleRate))
          );
          const frames = sample.numberOfFrames - skip;
          if (frames === 0) continue;
          const channels = Math.min(CHANNELS, sample.numberOfChannels);
          const chunk: Float32Array[] = [];
          for (let c = 0; c < channels; c++) {
            if (!planes[c] || planes[c].length < frames) planes[c] = new Float32Array(frames);
            const plane = planes[c].subarray(0, frames);
            sample.copyTo(plane, { planeIndex: c, format: 'f32-planar', frameOffset: skip, frameCount: frames });
            chunk.push(plane);
          }
          mixChunk(chunk, position, frames, placements, output);
          position += frames;
        } finally {
          sample.close();
        }
        // Nothing past the last frame any clip reads is needed.
        if (position >= stopAt) break;
      }
    } catch (error) {
      // Nothing mixed yet: the whole-file path may still read it.
      if (position === 0) return null;
      throw new SourceAudioError(
        `Could not read the sound of ${name}: its audio stopped decoding ${formatSeconds(position)} in (${messageOf(error)})`
      );
    }
    return true;
  } finally {
    input.dispose();
  }
}

/**
 * The fallback: the whole file through `decodeAudioData`, every sample in
 * memory at once. `false` for a file with no decodable audio; refuses a file
 * too large to read into one buffer, since that read can only fail.
 */
async function decodeWholeSourceInto(
  blob: Blob,
  placements: readonly Placement[],
  output: readonly Float32Array[],
  name: string,
  getOfflineCtx: () => OfflineAudioContext
): Promise<boolean> {
  if (blob.size > WHOLE_FILE_DECODE_MAX_BYTES) {
    throw new SourceAudioError(
      `Could not read the sound of ${name}: this browser cannot decode its audio, and the file is too large to decode in one piece`
    );
  }

  const arrayBuffer = await blob.arrayBuffer();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await getOfflineCtx().decodeAudioData(arrayBuffer);
  } catch {
    // No audio in this video
    return false;
  }

  const planes: Float32Array[] = [];
  for (let ch = 0; ch < Math.min(CHANNELS, audioBuffer.numberOfChannels); ch++) {
    planes.push(audioBuffer.getChannelData(ch));
  }
  if (planes.length > 0) mixChunk(planes, 0, audioBuffer.length, placements, output);
  return true;
}

function formatSeconds(frames: number): string {
  return `${Math.floor(frames / SAMPLE_RATE)} s`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
