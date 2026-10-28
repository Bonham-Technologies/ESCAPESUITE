/**
 * Placing decoded audio by its container timestamps (ESCSUITE-368).
 *
 * A MediaRecorder take's Opus track has holes: packets whose timestamps jump
 * 20–50 ms past the end of the one before, where the recorder lost audio.
 * Laying the decoded samples end to end, as `decodeAudioData` does, closes
 * each hole and pulls everything after it earlier, so a long take's sound
 * leads its picture by more and more (about 85 ms a minute, measured on a
 * loaded machine). A player honours the timestamps and plays such a file in
 * sync, and so must ESCAPEARTIST's export mix and waveforms.
 *
 * Neither mediabunny's `AudioSampleSink` nor Chromium's `AudioDecoder` passes
 * a packet's timestamp through exactly: both count decoded frames from the
 * first one (mediabunny resyncs only once they drift a whole chunk apart). So
 * the timestamps are read from the packets themselves ({@link PacketClock})
 * and paired with the decoded chunks in decode order, one chunk per packet,
 * and {@link TimestampPlacer} decides where each chunk goes.
 *
 * Differences under {@link PLACEMENT_TOLERANCE_SECONDS} are timestamp jitter
 * and are ignored, so a file whose packets tile (a CRAFT WebCodecs take, WAV,
 * MP3, AAC from other tools) comes out sample for sample as it did laid end
 * to end. See the "Audio placement" section of
 * `docs/reference/audio-waveform-visibility.md`.
 */

import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, type InputAudioTrack } from 'mediabunny';

/**
 * How far a chunk's timestamp may sit from where laying it end to end puts it
 * before it is moved: half a 20 ms Opus frame. Past it, a hole is filled with
 * silence or an overlap trimmed. A MediaRecorder take's per-packet jitter is a
 * few milliseconds either way and cancels; its holes are 20–50 ms.
 */
export const PLACEMENT_TOLERANCE_SECONDS = 0.01;

/**
 * Whether a track's codec is placed by timestamp at all: Opus and AAC, whose
 * every packet decodes to one chunk of one fixed frame, so chunk and packet
 * pair up in order. MediaRecorder writes only these. Anything else (Vorbis's
 * varying blocks and silent first packet, PCM, FLAC) is laid end to end as
 * before, since a pairing off by one there would move audio in a file with
 * no holes.
 */
export function placesByTimestamp(codec: string | null): boolean {
  return codec === 'opus' || codec === 'aac';
}

/** Where one decoded chunk goes, in frames of the placed stream. */
export interface Placement {
  /** Frame the chunk's first kept frame lands on; any frames between the previous chunk's end and this are silence. */
  at: number;
  /** Frames to drop from the chunk's start: they overlap what is already placed. */
  skip: number;
}

/**
 * Lays decoded chunks out by their timestamps. Each chunk goes straight after
 * the one before unless its timestamp says otherwise by more than the
 * tolerance: a later timestamp leaves a hole (silence) before it, an earlier
 * one trims the chunk's overlapping start so samples never stack. Measured
 * against the timestamps themselves, not chunk to chunk, so jitter never adds
 * up.
 *
 * The first chunk sits at frame 0, and the clock is set from the second: a
 * decoder may trim the first packet's start (Chromium drops Opus pre-skip from
 * it), so its timestamp says nothing about where its kept frames end.
 */
export class TimestampPlacer {
  private readonly tolerance: number;
  /** Timestamp, in frames, of the placed stream's frame 0; set by the second chunk. */
  private origin: number | null = null;
  private chunks = 0;
  /** The frame after the last one placed. */
  position = 0;

  constructor(
    private readonly sampleRate: number,
    toleranceSeconds = PLACEMENT_TOLERANCE_SECONDS
  ) {
    this.tolerance = Math.round(toleranceSeconds * sampleRate);
  }

  /**
   * Place a chunk of `frames` frames whose first frame's timestamp is
   * `timestamp` seconds, or end to end when it has none (`null`).
   */
  place(timestamp: number | null, frames: number): Placement {
    let at = this.position;
    let skip = 0;
    if (timestamp !== null && Number.isFinite(timestamp)) {
      const stamp = Math.round(timestamp * this.sampleRate);
      if (this.chunks === 1 && this.origin === null) {
        this.origin = stamp - this.position;
      } else if (this.origin !== null) {
        const error = stamp - this.origin - this.position;
        if (error > this.tolerance) at += error;
        else if (error < -this.tolerance) skip = Math.min(frames, -error);
      }
    }
    this.chunks++;
    this.position = at + frames - skip;
    return { at, skip };
  }
}

/**
 * The timestamps of a track's packets, in decode order, read as the decode
 * asks for them: one call per decoded chunk. `null` once the packets run out
 * (more chunks than packets; the rest go end to end) or when the packets
 * cannot be read.
 */
export class PacketClock {
  private readonly packets: AsyncGenerator<{ timestamp: number }, void, unknown>;
  private done = false;

  constructor(track: InputAudioTrack) {
    this.packets = new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true });
  }

  async next(): Promise<number | null> {
    if (this.done) return null;
    try {
      const result = await this.packets.next();
      if (!result.done) return result.value.timestamp;
    } catch (error) {
      console.warn('Could not read the audio packets’ timestamps; laying the rest end to end:', error);
    }
    this.done = true;
    return null;
  }

  async close(): Promise<void> {
    this.done = true;
    await this.packets.return(undefined).catch(() => undefined);
  }
}

/**
 * Where a whole decoded buffer's frames go when only the packets' timestamps
 * are known, not each packet's decoded length (`decodeAudioData`). The
 * packets must be one codec frame long each, as an Opus or AAC track's are
 * (MediaRecorder codes every packet the same length), so the frame is the
 * median step between timestamps. `null` when the timestamps leave no hole —
 * they step by that frame to within the tolerance overall — so the buffer
 * goes end to end, as before. Otherwise the buffer is cut into one equal run
 * per packet, each placed by {@link TimestampPlacer}: `[source frame, frames,
 * at]`.
 */
export function placeWholeBuffer(
  timestamps: readonly number[],
  length: number,
  sampleRate: number
): [number, number, number][] | null {
  const count = timestamps.length;
  if (count < 3 || length <= 0) return null;
  const steps: number[] = [];
  for (let k = 1; k < count; k++) steps.push(timestamps[k] - timestamps[k - 1]);
  steps.sort((a, b) => a - b);
  const frame = steps[Math.floor(steps.length / 2)];
  // One fixed frame: most steps within 30% of it (a MediaRecorder track's
  // jitter is about 15%, its holes a few percent of packets). A track that
  // mixes frame sizes is left end to end rather than cut into equal runs.
  const regular = steps.filter((step) => Math.abs(step - frame) <= 0.3 * frame).length;
  if (!(frame > 0) || regular < 0.8 * steps.length) return null;
  const holes = timestamps[count - 1] - timestamps[0] - (count - 1) * frame;
  if (Math.abs(holes) <= PLACEMENT_TOLERANCE_SECONDS) return null;

  // Priming the decode dropped (packets stamped before zero, an AAC edit
  // list's) belongs to the first packets' runs, not spread over all of them.
  const priming = Math.round(Math.max(0, -timestamps[0]) * sampleRate);
  const total = length + priming;
  const placer = new TimestampPlacer(sampleRate);
  const runs: [number, number, number][] = [];
  for (let k = 0; k < count; k++) {
    const start = Math.round((k * total) / count) - priming;
    const to = Math.round(((k + 1) * total) / count) - priming;
    if (to <= 0) continue;
    const from = Math.max(0, start);
    const { at, skip } = placer.place(timestamps[k] + (from - start) / sampleRate, to - from);
    if (to - from - skip > 0) runs.push([from + skip, to - from - skip, at]);
  }
  return runs.length > 0 ? runs : null;
}

/**
 * {@link placeWholeBuffer} for `blob`'s primary audio track, decoded whole to
 * `length` frames at `sampleRate`: `null` to keep the decode end to end — a
 * track with no holes, a codec whose packets are not one fixed frame long
 * (only Opus and AAC are placed), or bytes no demuxer reads.
 */
export async function placeDecodedFile(
  blob: Blob,
  length: number,
  sampleRate: number
): Promise<[number, number, number][] | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    if (!placesByTimestamp(await track.getCodec())) return null;
    const timestamps: number[] = [];
    for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      timestamps.push(packet.timestamp);
    }
    return placeWholeBuffer(timestamps, length, sampleRate);
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
