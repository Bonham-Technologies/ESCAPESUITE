/**
 * Frame-accurate decoding of one demuxed video track, for the decode worker.
 *
 * Split out of `decodeWorker.ts` (ESCSUITE-254) so the part that decides which
 * chunks to feed a `VideoDecoder`, and when a requested frame has arrived, can
 * run under vitest against a scripted decoder — the worker itself only runs in
 * a browser.
 *
 * ## Which frame a time asks for
 *
 * The `<video>` element is the oracle: seeked to `t`, it shows the last frame
 * whose presentation time is at or before `t`. `getFrame(t)` returns the same
 * one — the latest sample with `timestampUs <= t + TIME_TOLERANCE_US`, the
 * tolerance absorbing the rounding between a seconds float and whole
 * microseconds — or the first frame for a time before it.
 *
 * ## How it gets there
 *
 * A request is served from a small cache of decoded frames when it can be.
 * Otherwise decoding continues forward from where it is when the requested
 * frame is still ahead of it (the common case: an export asks for every frame
 * in order), and restarts from the requested frame's keyframe when it is not
 * (a seek backwards, or a jump past the end of what was fed). Chunks are fed in
 * decode order up to and including the requested sample, then one at a time —
 * a decoder that reorders B-frames holds a frame back until it has seen enough
 * of what follows — until the frame comes out. At the end of the stream the
 * decoder is flushed, which also forces the next chunk to be a keyframe.
 *
 * Every wait is bounded: a decoder that stops making progress for
 * `stallTimeoutMs` fails the request, and the decoder with it, with a named
 * error, so the caller falls back rather than hanging.
 */

import type { DemuxedSample } from './mp4Demux';

/** The parts of a `VideoFrame` this module touches. */
export interface FrameLike {
  readonly timestamp: number;
  clone(): FrameLike;
  close(): void;
}

/** The parts of a `VideoDecoder` this module touches. */
export interface DecoderLike {
  readonly decodeQueueSize: number;
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
  addEventListener(type: 'dequeue', listener: () => void): void;
}

export interface FrameDecoderOptions<F extends FrameLike> {
  /** The track's samples in decode order; the first is a keyframe. */
  samples: readonly DemuxedSample[];
  config: VideoDecoderConfig;
  /** Build the decoder; `output` and `error` are its init callbacks. */
  createDecoder: (output: (frame: F) => void, error: (error: Error) => void) => DecoderLike;
  /** Build an encoded chunk (`new EncodedVideoChunk(init)` in the worker). */
  createChunk: (init: EncodedVideoChunkInit) => EncodedVideoChunk;
  /** Decoded frames kept for reuse, least recently used first out. */
  maxCachedFrames?: number;
  /** How long without any decoder progress before a request fails. */
  stallTimeoutMs?: number;
}

/** Half a millisecond: a seconds float and a microsecond timestamp that agree to this are the same instant. */
export const TIME_TOLERANCE_US = 500;
/** Chunks fed but not yet output, beyond which no more are fed until something comes out. */
export const MAX_IN_FLIGHT = 16;
/** How often a wait re-checks the decoder when it fires no event (a browser without `dequeue`). */
const POLL_MS = 10;

export class FrameDecoder<F extends FrameLike> {
  private readonly samples: readonly DemuxedSample[];
  private readonly config: VideoDecoderConfig;
  private readonly createChunk: (init: EncodedVideoChunkInit) => EncodedVideoChunk;
  private readonly maxCachedFrames: number;
  private readonly stallTimeoutMs: number;
  private readonly decoder: DecoderLike;
  /** Indices into `samples`, sorted by presentation time. */
  private readonly presentation: number[];
  /** Indices into `samples` of the keyframes, ascending. */
  private readonly keyframes: number[];
  /** Decoded frames by timestamp, in least-recently-used order. */
  private readonly cache = new Map<number, F>();

  /** Index of the next sample to feed. */
  private nextFeed = 0;
  /** The next chunk must be a keyframe: nothing fed yet, or just flushed. */
  private needKeyframe = true;
  /** Chunks fed since the last reset or flush that have not come out. */
  private inFlight = 0;
  /** Timestamp of the latest frame out of the decoder in this run. */
  private lastOutputUs = -Infinity;
  /** The frame the current request is waiting for; never evicted. */
  private pendingUs: number | null = null;
  /** Timestamp of the frame most recently handed out. */
  private playheadUs = -Infinity;
  private lastProgress = 0;
  private wake: (() => void) | null = null;
  private failure: Error | null = null;
  private disposed = false;
  /** Requests run one at a time, in arrival order. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FrameDecoderOptions<F>) {
    this.samples = options.samples;
    this.config = options.config;
    this.createChunk = options.createChunk;
    this.maxCachedFrames = options.maxCachedFrames ?? 8;
    this.stallTimeoutMs = options.stallTimeoutMs ?? 5000;
    this.presentation = this.samples
      .map((_sample, index) => index)
      .sort((a, b) => this.samples[a].timestampUs - this.samples[b].timestampUs);
    this.keyframes = [];
    this.samples.forEach((sample, index) => {
      if (sample.isKeyframe) this.keyframes.push(index);
    });
    this.decoder = options.createDecoder(
      (frame) => this.onOutput(frame),
      (error) => this.fail(new Error(`Decoder error: ${error.message}`))
    );
    this.decoder.addEventListener('dequeue', () => this.progress());
    this.decoder.configure(this.config);
  }

  /** Decoded frames currently held, for status reporting. */
  get cachedFrames(): readonly F[] {
    return [...this.cache.values()];
  }

  /**
   * The frame shown at `seconds`, as a clone the caller owns and must close.
   * Rejects, rather than waiting forever, when the decoder fails or stalls.
   */
  getFrame(seconds: number): Promise<F> {
    return this.enqueue(() => this.produce(seconds));
  }

  /** Drop the cached frame shown at `seconds`, if one is held. */
  release(seconds: number): void {
    const timestampUs = this.samples[this.lookup(seconds)].timestampUs;
    const frame = this.cache.get(timestampUs);
    if (frame) {
      frame.close();
      this.cache.delete(timestampUs);
    }
  }

  /** Drain the decoder, after any queued requests. */
  flush(): Promise<void> {
    return this.enqueue(() => this.drain());
  }

  /** Run `task` after every queued one; a failure is the caller's, never the queue's. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Close every held frame and the decoder. Queued and later requests reject. */
  dispose(): void {
    this.disposed = true;
    for (const frame of this.cache.values()) frame.close();
    this.cache.clear();
    try {
      this.decoder.close();
    } catch {
      // Already closed by a decoder error.
    }
    this.fail(new Error('Source disposed'));
  }

  private async produce(seconds: number): Promise<F> {
    if (this.failure) throw this.failure;
    const target = this.lookup(seconds);
    const timestampUs = this.samples[target].timestampUs;
    if (!this.cache.has(timestampUs)) {
      this.pendingUs = timestampUs;
      try {
        this.position(target, timestampUs);
        await this.decodeUntil(target, timestampUs);
      } finally {
        this.pendingUs = null;
      }
    }
    const frame = this.cache.get(timestampUs)!;
    // Most recently used goes last.
    this.cache.delete(timestampUs);
    this.cache.set(timestampUs, frame);
    this.playheadUs = timestampUs;
    return frame.clone() as F;
  }

  /** Index of the sample shown at `seconds`. */
  private lookup(seconds: number): number {
    const limit = seconds * 1_000_000 + TIME_TOLERANCE_US;
    let low = 0;
    let high = this.presentation.length - 1;
    let found = this.presentation[0];
    while (low <= high) {
      const mid = (low + high) >> 1;
      const index = this.presentation[mid];
      if (this.samples[index].timestampUs <= limit) {
        found = index;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  /** Index of the keyframe a decode of sample `target` has to start from. */
  private keyframeFor(target: number): number {
    let found = this.keyframes[0];
    for (const index of this.keyframes) {
      if (index > target) break;
      found = index;
    }
    return found;
  }

  /** Point `nextFeed` where decoding has to go on from to reach `target`. */
  private position(target: number, timestampUs: number): void {
    const keyframe = this.keyframeFor(target);
    const fedPastKeyframe = !this.needKeyframe && this.nextFeed > keyframe;
    if (fedPastKeyframe && timestampUs > this.lastOutputUs) return; // still ahead: carry on
    if (fedPastKeyframe) {
      // Behind what has come out: start over from its keyframe.
      this.decoder.reset();
      this.decoder.configure(this.config);
      this.inFlight = 0;
    }
    this.nextFeed = keyframe;
    this.needKeyframe = false;
    this.lastOutputUs = -Infinity;
  }

  private async decodeUntil(target: number, timestampUs: number): Promise<void> {
    this.lastProgress = Date.now();
    while (!this.cache.has(timestampUs)) {
      if (this.nextFeed <= target) {
        // Everything up to the requested chunk has to go in regardless.
        this.feed();
      } else if (this.decoder.decodeQueueSize > 0 || this.inFlight >= MAX_IN_FLIGHT) {
        // Still decoding what it has, or as far ahead as it may go: wait.
        await this.waitForProgress();
      } else if (this.nextFeed < this.samples.length) {
        // It has decoded everything and is holding the frame back for
        // reordering: one more chunk pushes it out.
        this.feed();
        await this.waitForProgress();
      } else {
        // End of the stream: only a flush brings the held frames out.
        await this.drain();
        if (!this.cache.has(timestampUs)) {
          throw this.fail(
            new Error(`Decoder produced no frame at ${timestampUs / 1_000_000}s`)
          );
        }
      }
    }
  }

  private feed(): void {
    const sample = this.samples[this.nextFeed++];
    this.decoder.decode(
      this.createChunk({
        type: sample.isKeyframe ? 'key' : 'delta',
        timestamp: sample.timestampUs,
        duration: sample.durationUs,
        data: sample.data,
      })
    );
    this.inFlight++;
  }

  /** Resolve on the decoder's next output or dequeue, or a poll tick; reject once it has stalled. */
  private async waitForProgress(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wake = resolve;
      setTimeout(resolve, POLL_MS);
    });
    this.wake = null;
    if (this.failure) throw this.failure;
    if (Date.now() - this.lastProgress > this.stallTimeoutMs) {
      throw this.fail(
        new Error(`Decoder stalled: no output for ${this.stallTimeoutMs}ms`)
      );
    }
  }

  /** Flush the decoder (bounded by the stall timeout); every fed chunk is then out. */
  private async drain(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.decoder.flush(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Decoder stalled: flush did not finish within ${this.stallTimeoutMs}ms`)),
            this.stallTimeoutMs
          );
        }),
      ]);
    } catch (error) {
      throw this.fail(this.failure ?? (error as Error));
    } finally {
      clearTimeout(timer);
    }
    this.inFlight = 0;
    this.needKeyframe = true;
  }

  private onOutput(frame: F): void {
    if (this.disposed) {
      frame.close();
      return;
    }
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.lastOutputUs = frame.timestamp;
    this.cache.get(frame.timestamp)?.close();
    this.cache.delete(frame.timestamp);
    this.cache.set(frame.timestamp, frame);
    this.evict();
    this.progress();
  }

  /**
   * Keep the cache within bounds without throwing away a frame an export is
   * about to ask for.
   *
   * Frames behind the one being waited for (or, between requests, behind the
   * one last handed out) go, least recently used first, down to
   * `maxCachedFrames`. Frames ahead of it stay: they are what an in-order
   * export asks for next, closing one would mean decoding its whole group
   * again from the keyframe, and there are never more of them than chunks
   * were in flight (`MAX_IN_FLIGHT`) — they fall behind, and out, as the
   * export moves on.
   */
  private evict(): void {
    const reference = this.pendingUs ?? this.playheadUs;
    for (const [timestampUs, frame] of this.cache) {
      if (this.cache.size <= this.maxCachedFrames) return;
      if (timestampUs < reference) {
        frame.close();
        this.cache.delete(timestampUs);
      }
    }
  }

  private progress(): void {
    this.lastProgress = Date.now();
    this.wake?.();
  }

  /** Record the first failure, wake any wait, and hand the failure back for throwing. */
  private fail(error: Error): Error {
    this.failure ??= error;
    this.wake?.();
    return this.failure;
  }
}
