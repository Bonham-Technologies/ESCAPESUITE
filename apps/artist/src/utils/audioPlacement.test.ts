// Placing decoded audio by its packets' timestamps (ESCSUITE-368).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncodedPacketSink } from 'mediabunny';
import {
  PLACEMENT_TOLERANCE_SECONDS,
  PacketClock,
  TimestampPlacer,
  placeDecodedFile,
  placeWholeBuffer,
} from './audioPlacement';
import { floatWav } from '../test/fixtures/wavFixture';

const RATE = 48000;
/** One 20 ms Opus frame. */
const FRAME = 960;

const MEDIA = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/media');

/** Place chunks of `frames` frames stamped `stamps` (s); `[at, skip]` for each. */
function placeAll(stamps: (number | null)[], frames: number | number[]): [number, number][] {
  const placer = new TimestampPlacer(RATE);
  return stamps.map((stamp, k) => {
    const { at, skip } = placer.place(stamp, Array.isArray(frames) ? frames[k] : frames);
    return [at, skip];
  });
}

describe('TimestampPlacer', () => {
  it('lays chunks whose timestamps tile end to end, exactly as before', () => {
    const stamps = [0, 0.02, 0.04, 0.06, 0.08];

    expect(placeAll(stamps, FRAME)).toEqual([[0, 0], [960, 0], [1920, 0], [2880, 0], [3840, 0]]);
  });

  it('fills a hole with silence: the chunk after it goes at its timestamp', () => {
    // 40 ms of audio lost between the third and fourth packet.
    const stamps = [0, 0.02, 0.04, 0.1, 0.12];

    expect(placeAll(stamps, FRAME)).toEqual([[0, 0], [960, 0], [1920, 0], [4800, 0], [5760, 0]]);
  });

  it('trims an overlap so samples never stack', () => {
    // The fourth packet starts 15 ms before the third one ends.
    const stamps = [0, 0.02, 0.04, 0.045, 0.065];

    expect(placeAll(stamps, FRAME)).toEqual([[0, 0], [960, 0], [1920, 0], [2880, 720], [3120, 0]]);
  });

  it('drops a chunk the overlap covers whole', () => {
    expect(placeAll([0, 0.02, 0.04, 0.02, 0.06], FRAME)).toEqual([
      [0, 0], [960, 0], [1920, 0], [2880, 960], [2880, 0],
    ]);
  });

  it('ignores jitter under the tolerance, and never lets it add up', () => {
    // Each packet 4 ms late or early against a steady 60 ms clock: a
    // MediaRecorder track's timestamp jitter, which cancels.
    const frames = 2880;
    const stamps = Array.from({ length: 200 }, (_, k) => k * 0.06 + (k % 2 ? 0.004 : -0.004) + 0.004);

    const placed = placeAll(stamps, frames);

    expect(placed).toEqual(stamps.map((_, k) => [k * frames, 0]));
    expect(PLACEMENT_TOLERANCE_SECONDS * RATE).toBe(480);
  });

  it('moves a chunk once the drift passes the tolerance, and only by the whole error', () => {
    // 6 ms holes: the first stays under 10 ms; the second takes the error to
    // 12 ms, so the third chunk moves by all 12 ms, back on the clock.
    const stamps = [0, 0.02, 0.046, 0.072, 0.092];

    expect(placeAll(stamps, FRAME)).toEqual([[0, 0], [960, 0], [1920, 0], [3456, 0], [4416, 0]]);
  });

  it('sets its clock from the second chunk, so a first chunk the decoder trimmed leaves no hole', () => {
    // Chromium trims Opus pre-skip (312 frames) from the first chunk.
    const stamps = [0, 0.02, 0.04, 0.06];

    expect(placeAll(stamps, [648, 960, 960, 960])).toEqual([[0, 0], [648, 0], [1608, 0], [2568, 0]]);
  });

  it('lays a chunk with no timestamp end to end', () => {
    expect(placeAll([0, 0.02, null, 0.1, null], FRAME)).toEqual([
      [0, 0], [960, 0], [1920, 0], [4800, 0], [5760, 0],
    ]);
  });
});

describe('PacketClock', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hands out the packets’ timestamps in order, then null', async () => {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(new Blob([floatWav([new Float32Array(8192)], RATE)])), formats: ALL_FORMATS });
    const track = (await input.getPrimaryAudioTrack())!;
    vi.spyOn(EncodedPacketSink.prototype, 'packets').mockImplementation(async function* () {
      yield* [{ timestamp: 0 }, { timestamp: 0.25 }] as never[];
    });

    const clock = new PacketClock(track);

    expect([await clock.next(), await clock.next(), await clock.next(), await clock.next()]).toEqual([0, 0.25, null, null]);
    await clock.close();
    input.dispose();
  });

  it('answers null for the rest when the packets cannot be read', async () => {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(new Blob([floatWav([new Float32Array(8192)], RATE)])), formats: ALL_FORMATS });
    const track = (await input.getPrimaryAudioTrack())!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(EncodedPacketSink.prototype, 'packets').mockImplementation(async function* () {
      yield { timestamp: 0 } as never;
      throw new Error('demux error');
    });

    const clock = new PacketClock(track);

    expect([await clock.next(), await clock.next(), await clock.next()]).toEqual([0, null, null]);
    expect(warn).toHaveBeenCalledTimes(1);
    await clock.close();
    input.dispose();
  });
});

describe('placeWholeBuffer', () => {
  it('answers null when the timestamps step by one frame throughout', () => {
    const stamps = Array.from({ length: 50 }, (_, k) => k * 0.06);

    expect(placeWholeBuffer(stamps, 50 * 2880, RATE)).toBeNull();
  });

  it('answers null for an AAC track whose priming decodeAudioData trimmed', () => {
    // 1024-frame packets from -2112 frames; the decode is 2112 frames shorter.
    const stamps = Array.from({ length: 100 }, (_, k) => (k * 1024 - 2112) / RATE);

    expect(placeWholeBuffer(stamps, 100 * 1024 - 2112, RATE)).toBeNull();
  });

  it('cuts the buffer into one run per packet and places each by its timestamp when there are holes', () => {
    // Four 60 ms packets with a 40 ms hole before the third.
    const stamps = [0, 0.06, 0.16, 0.22];

    expect(placeWholeBuffer(stamps, 4 * 2880, RATE)).toEqual([
      [0, 2880, 0],
      [2880, 2880, 2880],
      [5760, 2880, 7680],
      [8640, 2880, 10560],
    ]);
  });

  it('answers null for too few packets to tell a frame from a hole', () => {
    expect(placeWholeBuffer([0, 0.5], 4800, RATE)).toBeNull();
  });
});

describe('placeDecodedFile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('leaves an AAC file from another tool end to end', async () => {
    const blob = new Blob([new Uint8Array(readFileSync(resolve(MEDIA, 'video-with-aac.mp4')))]);

    expect(await placeDecodedFile(blob, 48000, RATE)).toBeNull();
  });

  it('leaves a codec whose packets are not one fixed frame long end to end', async () => {
    const packets = vi.spyOn(EncodedPacketSink.prototype, 'packets');

    expect(await placeDecodedFile(new Blob([floatWav([new Float32Array(4800)], RATE)]), 4800, RATE)).toBeNull();
    expect(packets).not.toHaveBeenCalled();
  });

  it('answers null for bytes no demuxer reads', async () => {
    expect(await placeDecodedFile(new Blob([new Uint8Array(64)]), 4800, RATE)).toBeNull();
  });
});
