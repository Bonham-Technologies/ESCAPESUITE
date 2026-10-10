/**
 * MP4 demuxing for the video decode worker.
 *
 * Split out of `decodeWorker.ts` so the container half of the worker — which
 * needs nothing but mp4box and an ArrayBuffer — runs under vitest against real
 * MP4 bytes, instead of only inside a Web Worker.
 *
 * ## The ordering constraint (ESCSUITE-254)
 *
 * mp4box parses an in-memory file *inside* `appendBuffer()`: `onReady` fires
 * from within that call, and so does every `onSamples` delivery. Extraction
 * therefore has to be armed — `setExtractionOptions()` then `start()` — inside
 * `onReady`, before `appendBuffer()` returns. Armed any later, every sample has
 * already gone past the parser and none is ever delivered; that is exactly how
 * the worker shipped, threw "No keyframes found in video" for every source,
 * and left every MP4 export decoding in the page.
 *
 * ## What is refused
 *
 * The `<video>` element is the oracle the worker has to match, so anything
 * whose presentation this module cannot reproduce exactly is refused with a
 * named error rather than decoded differently: the factory then falls back to
 * the `<video>` path for that source, and the export says so. That covers a
 * codec other than H.264, a fragmented file, more than one sample description
 * or one with no avcC, non-square pixels (a VUI sample aspect ratio or a
 * `pasp` box other than 1:1), an edit list other than a single plain one, and
 * a display matrix other than the four right-angle rotations. All of it is
 * decided inside `onReady`, before extraction is armed, so a refused file has
 * none of its samples copied.
 */

import {
  createFile,
  DataStream,
  type MP4ArrayBuffer,
  type MP4Info,
  type MP4Sample,
  type MP4TrakBox,
  type MP4VideoTrack,
} from 'mp4box';
import { readAvcConfig } from './avcConfig';

/** A clockwise rotation, in degrees, as `VideoDecoderConfig.rotation` takes it. */
export type VideoRotation = 0 | 90 | 180 | 270;

/** One encoded video sample, in decode order. */
export interface DemuxedSample {
  /** Presentation time in whole microseconds, with the edit list applied (so the first shown frame is 0). */
  timestampUs: number;
  durationUs: number;
  isKeyframe: boolean;
  data: Uint8Array;
}

/**
 * Where the decoder's colour comes from (ESCSUITE-254 fix rounds 1 and 2). A
 * VideoDecoder sees only the bitstream, so:
 * - `bitstream`: the SPS VUI specifies primaries, transfer and matrix; the
 *   decoder keeps them, and so does `<video>`.
 * - `container`: the bitstream is untagged but the sample entry's `colr` box
 *   specifies all three; Chromium's `<video>` follows the box, so it is handed
 *   to the decoder as its colour space.
 * - `unspecified`: neither specifies all three; the decoder is given the
 *   size guess `<video>` makes, with the stream's own range when it says one.
 */
export type StreamColour =
  | { kind: 'bitstream' }
  | { kind: 'container'; colorSpace: VideoColorSpaceInit }
  | { kind: 'unspecified'; fullRange?: boolean };

/** H.264 / H.273 code point for "unspecified". */
const UNSPECIFIED = 2;

/** Everything the decoder needs about one MP4's first video track. */
export interface DemuxedVideo {
  /** The RFC 6381 codec string mp4box read from the sample description, e.g. `avc1.64001f`. */
  codec: string;
  codedWidth: number;
  codedHeight: number;
  /** Width and height as shown, after `rotation` — what `<video>`'s videoWidth/videoHeight report. */
  displayWidth: number;
  displayHeight: number;
  /** The avcC record without its box header. */
  description: Uint8Array;
  rotation: VideoRotation;
  colour: StreamColour;
  /** Movie duration in seconds. */
  duration: number;
  /** Every sample of the track, in decode order. The first is a keyframe. */
  samples: DemuxedSample[];
  keyframeCount: number;
}

export interface DemuxOptions {
  /**
   * How long to wait for the track's samples once the file has been parsed.
   * mp4box delivers an in-memory file's samples synchronously, so a complete
   * file never waits; a truncated one rejects with the counts once this runs
   * out, rather than hanging.
   */
  timeoutMs?: number;
}

/**
 * The four right-angle rotations, keyed by the display matrix's `a,b,c,d` in
 * 16.16 fixed point (`a = cos θ`, `b = sin θ`, `c = -sin θ`, `d = cos θ` for a
 * clockwise turn θ).
 */
const ROTATIONS: Readonly<Record<string, VideoRotation>> = {
  '65536,0,0,65536': 0,
  '0,65536,-65536,0': 90,
  '-65536,0,0,-65536': 180,
  '0,-65536,65536,0': 270,
};

/**
 * The clockwise rotation a `tkhd` display matrix describes, or a named error
 * when it is anything other than one of the four right-angle rotations (a
 * mirror, a scale, a shear).
 *
 * The matrix is nine fixed-point values `[a, b, u, c, d, v, x, y, w]`; only
 * `a, b, c, d` carry the rotation. All four were checked against Chromium
 * 153's own `<video>` element, drawing a `VideoFrame` decoded with the derived
 * `VideoDecoderConfig.rotation` beside it (ESCSUITE-254): `[0, -1, 1, 0]`,
 * which `ffmpeg -display_rotation 90` writes (ffmpeg counts
 * counter-clockwise), is shown turned 270° clockwise.
 */
export function rotationFromMatrix(matrix: ArrayLike<number>): VideoRotation {
  // `| 0` reads a Uint32Array's 0xFFFF0000 as the -65536 it encodes.
  const key = [matrix[0], matrix[1], matrix[3], matrix[4]].map((value) => value | 0).join(',');
  const rotation = ROTATIONS[key];
  if (rotation === undefined) {
    throw new Error(
      `Unsupported display matrix [${key}]: only the four right-angle rotations are decoded in the worker`
    );
  }
  return rotation;
}

interface EditListEntry {
  segment_duration: number;
  media_time: number;
  media_rate_integer: number;
}

/**
 * The media time (in the track's timescale) at which presentation starts, from
 * the track's edit list — what the `<video>` element shows as time 0.
 *
 * An encoder that writes B-frames typically gives the first frame a
 * composition time of two frame durations and an edit list that starts there;
 * ignoring it would put every worker frame two frames late against `<video>`.
 * Anything but no edit list or one plain edit is refused.
 */
export function presentationStart(edits: readonly EditListEntry[] | undefined): number {
  if (!edits || edits.length === 0) return 0;
  const [edit] = edits;
  if (edits.length > 1 || edit.media_time < 0 || edit.media_rate_integer !== 1) {
    throw new Error('Unsupported MP4 edit list: only a single plain edit is decoded in the worker');
  }
  return edit.media_time;
}

/** The avcC record, without its 8-byte box header. */
function avcDescription(entry: SampleEntry): Uint8Array {
  if (!entry.avcC) throw new Error('The H.264 sample description has no avcC record');
  const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
  entry.avcC.write(stream);
  return new Uint8Array(stream.buffer, 8);
}

type SampleEntry = MP4TrakBox['mdia']['minf']['stbl']['stsd']['entries'][number];

/**
 * H.273 code points VideoColorSpaceInit can name (the values TypeScript's DOM
 * lib carries; a wide-gamut or HDR box is refused to `<video>`).
 */
const PRIMARIES: Readonly<Record<number, VideoColorPrimaries>> = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m' };
const TRANSFER: Readonly<Record<number, VideoTransferCharacteristics>> = {
  1: 'bt709',
  6: 'smpte170m',
  13: 'iec61966-2-1',
};
const MATRIX: Readonly<Record<number, VideoMatrixCoefficients>> = {
  0: 'rgb',
  1: 'bt709',
  5: 'bt470bg',
  6: 'smpte170m',
};

const DISAGREEMENT =
  'The colr box and the H.264 stream describe its colour differently; the <video> path draws this source';

/** All three code points present and none of them "unspecified". */
function fullySpecified(codes: ReadonlyArray<number | undefined>): codes is number[] {
  return codes.every((code) => code !== undefined && code !== UNSPECIFIED);
}

/**
 * Where the decoder's colour comes from — see StreamColour. A `colr` box that
 * disagrees with a colour description in the bitstream is refused rather than
 * one of the two picked; so is one whose code points VideoDecoder cannot be
 * given.
 */
function streamColour(entry: SampleEntry, vui: ReturnType<typeof readAvcConfig>): StreamColour {
  const colr = entry.colr?.colour_type === 'nclx' || entry.colr?.colour_type === 'nclc' ? entry.colr : undefined;
  const colrCodes = colr && [colr.colour_primaries, colr.transfer_characteristics, colr.matrix_coefficients];
  const vuiCodes = vui.colour && [vui.colour.primaries, vui.colour.transfer, vui.colour.matrix];
  const colrSpecified = colrCodes && fullySpecified(colrCodes) ? colrCodes : undefined;
  if (colrSpecified && vuiCodes && colrSpecified.join() !== vuiCodes.join()) throw new Error(DISAGREEMENT);
  if (vuiCodes && fullySpecified(vuiCodes)) return { kind: 'bitstream' };
  const fullRange = colr?.colour_type === 'nclx' ? colr.full_range_flag === 1 : vui.fullRange;
  if (colrSpecified) {
    const [primaries, transfer, matrix] = colrSpecified;
    if (!(primaries in PRIMARIES && transfer in TRANSFER && matrix in MATRIX)) {
      throw new Error(
        `The colr box describes a colour space VideoDecoder cannot be given (${colrSpecified.join('/')}); the <video> path draws this source`
      );
    }
    return {
      kind: 'container',
      colorSpace: {
        primaries: PRIMARIES[primaries],
        transfer: TRANSFER[transfer],
        matrix: MATRIX[matrix],
        fullRange: fullRange ?? false,
      },
    };
  }
  return fullRange === undefined ? { kind: 'unspecified' } : { kind: 'unspecified', fullRange };
}

interface TrackHeader {
  video: MP4VideoTrack;
  rotation: VideoRotation;
  mediaTime: number;
  description: Uint8Array;
  colour: StreamColour;
  /** Movie duration in seconds. */
  duration: number;
}

/**
 * Validate a parsed file's first video track. Throws a named error for
 * anything the worker cannot present exactly as `<video>` would.
 */
function readTrackHeader(info: MP4Info, sampleEntries: (trackId: number) => SampleEntry[]): TrackHeader {
  const video = info.videoTracks[0];
  if (!video) throw new Error('No video tracks found in file');
  if (info.isFragmented) throw new Error('Fragmented MP4 is not decoded in the worker');
  // H.264 is the only codec the worker's output was compared against
  // <video>'s. Refused here, inside onReady, nothing of another codec's file
  // is copied before it is turned away (fix round 1, MD3).
  if (!/^avc[13]\./.test(video.codec)) {
    throw new Error(`Only H.264 is decoded in the worker; ${video.codec} needs the <video> path`);
  }
  const entries = sampleEntries(video.id);
  if (entries.length !== 1) {
    throw new Error(`MP4 video track has ${entries.length} sample descriptions; the worker decodes one`);
  }
  const description = avcDescription(entries[0]);
  const vui = readAvcConfig(description);
  // <video> draws a non-square pixel wider or narrower; whether a
  // VideoDecoder's frame is drawn the same was never measured (fix round 1).
  const pasp = entries[0].pasp;
  if (!vui.squarePixels || (pasp && pasp.hSpacing !== pasp.vSpacing)) {
    throw new Error('Non-square pixels are not decoded in the worker; the <video> path draws this source');
  }
  return {
    video,
    rotation: rotationFromMatrix(video.matrix),
    mediaTime: presentationStart(video.edits),
    description,
    colour: streamColour(entries[0], vui),
    duration: info.duration / info.timescale,
  };
}

/**
 * Demux an in-memory MP4 and index every sample of its first video track.
 */
export async function demuxVideoTrack(
  data: ArrayBuffer,
  { timeoutMs = 2000 }: DemuxOptions = {}
): Promise<DemuxedVideo> {
  const mp4File = createFile();
  // Written from mp4box's callbacks, which run inside appendBuffer().
  const parsed: { failure: Error | null; header: TrackHeader | null } = { failure: null, header: null };
  const samples: DemuxedSample[] = [];
  let markComplete!: () => void;
  const complete = new Promise<void>((resolve) => {
    markComplete = resolve;
  });

  mp4File.onError = (error: string) => {
    parsed.failure = new Error(`MP4 parsing error: ${error}`);
  };

  // Everything below runs from inside appendBuffer() — see the file comment.
  mp4File.onReady = (info: MP4Info) => {
    try {
      parsed.header = readTrackHeader(
        info,
        (trackId) => mp4File.getTrackById(trackId).mdia.minf.stbl.stsd.entries
      );
    } catch (error) {
      parsed.failure = error as Error;
      return;
    }
    mp4File.setExtractionOptions(parsed.header.video.id, null, { nbSamples: Infinity });
    mp4File.start();
  };

  mp4File.onSamples = (_trackId: number, _ref: unknown, received: MP4Sample[]) => {
    const { video, mediaTime } = parsed.header!;
    for (const sample of received) {
      samples.push({
        timestampUs: Math.round(((sample.cts - mediaTime) * 1_000_000) / sample.timescale),
        durationUs: Math.round((sample.duration * 1_000_000) / sample.timescale),
        isKeyframe: sample.is_sync,
        data: sample.data,
      });
    }
    if (samples.length === video.nb_samples) markComplete();
  };

  const buffer = data as MP4ArrayBuffer;
  buffer.fileStart = 0;
  mp4File.appendBuffer(buffer);
  mp4File.flush();

  if (parsed.failure) throw parsed.failure;
  if (!parsed.header) throw new Error('MP4 parsing incomplete: no movie header (moov box) found');
  const { video, rotation, description, colour, duration } = parsed.header;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      complete,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `MP4 demux incomplete: extracted ${samples.length} of ${video.nb_samples} video samples within ${timeoutMs}ms`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }

  if (!samples[0].isKeyframe) throw new Error('MP4 video track does not start with a keyframe');

  const quarterTurn = rotation === 90 || rotation === 270;
  return {
    codec: video.codec,
    codedWidth: video.video.width,
    codedHeight: video.video.height,
    displayWidth: quarterTurn ? video.video.height : video.video.width,
    displayHeight: quarterTurn ? video.video.width : video.video.height,
    description,
    rotation,
    colour,
    duration,
    samples,
    keyframeCount: samples.filter((sample) => sample.isKeyframe).length,
  };
}
