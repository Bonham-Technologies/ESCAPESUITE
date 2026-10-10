/**
 * ESCSUITE-273: a source load the decode worker never answers.
 *
 * `exportMP4.ts` awaits every source's `loadSource` before its frame loop makes
 * a single frame request, so ESCSUITE-266's per-request deadline never armed
 * for a worker killed mid-load — where its memory peaks and an out-of-memory
 * kill is likeliest — and the export waited forever. Each load now has a
 * deadline scaled to the file's size; missing it terminates the worker,
 * presumed dead, through the same path a missed frame deadline takes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LOAD_DEADLINE_FLOOR_MS,
  LOAD_DEADLINE_PER_MIB_MS,
  VideoDecodeManager,
  loadDeadlineMs,
} from './videoDecodeManager';
import { FrameSourceFactory, HTMLVideoFrameSource, type IFrameSource } from './frameSource';
import type { DecodeWorkerResponse, VideoSourceInfo } from '../workers/decodeWorker.types';

const MIB = 1024 * 1024;

/**
 * A worker double whose `postMessage` honours its transfer list the way the
 * platform does: a transferred ArrayBuffer is detached (byteLength 0) on this
 * side once it is posted. So a deadline sized from the buffer after the post
 * would be sized for an empty file.
 */
class TransferringWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];

  constructor() {
    setTimeout(() => this.simulateMessage({ type: 'WORKER_READY' }), 0);
  }

  postMessage(data: unknown, transfer?: Transferable[]) {
    this.posted.push(data);
    if (transfer?.length) structuredClone(data, { transfer });
  }

  terminate() {
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }

  simulateMessage(data: DecodeWorkerResponse | { type: 'WORKER_READY' }) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  simulateError(message: string) {
    this.onerror?.(new ErrorEvent('error', { message }));
  }
}

let workers: TransferringWorker[] = [];
const latestWorker = () => workers[workers.length - 1];

const info = (sourceId: string): VideoSourceInfo => ({
  sourceId,
  duration: 10,
  width: 1280,
  height: 720,
  codec: 'avc1.64001f',
  frameCount: 300,
  keyframeCount: 10,
});

/** What a promise has settled to so far: 'pending', the value, or the error. */
function track<T>(promise: Promise<T>) {
  const state: { outcome: unknown } = { outcome: 'pending' };
  promise.then(
    (value) => { state.outcome = value; },
    (error: unknown) => { state.outcome = error; }
  );
  return state;
}

const messageOf = (outcome: unknown) => (outcome as Error).message;

/** A ready manager under fake timers, with its worker's terminate() spied on. */
async function readyManager() {
  const manager = new VideoDecodeManager();
  const init = manager.initialize();
  await vi.advanceTimersByTimeAsync(0);
  await init;
  const terminate = vi.spyOn(latestWorker(), 'terminate');
  return { manager, terminate };
}

/** Start a load and let it reach the worker (loadSource awaits initialize() first). */
async function startLoad(manager: VideoDecodeManager, sourceId: string, mib: number) {
  const load = track(manager.loadSource(sourceId, new ArrayBuffer(mib * MIB), 'video/mp4'));
  await vi.advanceTimersByTimeAsync(0);
  return load;
}

describe('a source load the decode worker never answers (ESCSUITE-273)', () => {
  // Restore exactly what was replaced, never vi.unstubAllGlobals(): that would
  // also drop src/test/setup.ts's Blob and URL stubs for every later case in
  // this file (ESCSUITE-119).
  let originalWorker: typeof globalThis.Worker;
  let originalVideoDecoder: typeof globalThis.VideoDecoder;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    originalWorker = globalThis.Worker;
    originalVideoDecoder = globalThis.VideoDecoder;
    vi.stubGlobal('Worker', function StubWorker() {
      const worker = new TransferringWorker();
      workers.push(worker);
      return worker;
    });
    vi.stubGlobal('VideoDecoder', class {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('Worker', originalWorker);
    vi.stubGlobal('VideoDecoder', originalVideoDecoder);
    vi.restoreAllMocks();
  });

  describe('loadDeadlineMs', () => {
    it('is a 30 s floor plus 250 ms per MiB', () => {
      expect(LOAD_DEADLINE_FLOOR_MS).toBe(30_000);
      expect(LOAD_DEADLINE_PER_MIB_MS).toBe(250);
    });

    it('gives an empty file the floor alone', () => {
      expect(loadDeadlineMs(0)).toBe(30_000);
    });

    it('gives a 20 MiB ESCAPECRAFT take 35 s', () => {
      expect(loadDeadlineMs(20 * MIB)).toBe(35_000);
    });

    it("gives a 512 MiB source — the whole per-export budget — 158 s", () => {
      expect(loadDeadlineMs(512 * MIB)).toBe(158_000);
    });
  });

  it('rejects the load at its deadline with the named reason, and terminates the worker', async () => {
    const { manager, terminate } = await readyManager();
    const load = await startLoad(manager, 'a', 20);

    await vi.advanceTimersByTimeAsync(34_999);
    expect(load.outcome).toBe('pending');
    expect(terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(load.outcome).toBeInstanceOf(Error);
    expect(messageOf(load.outcome)).toBe('Decode worker did not finish loading a (20 MiB) within 35 s');
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(manager.ready).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sizes the deadline from the file before the post detaches its buffer', async () => {
    const { manager } = await readyManager();
    const data = new ArrayBuffer(4 * MIB);
    const load = track(manager.loadSource('a', data, 'video/mp4'));
    await vi.advanceTimersByTimeAsync(0);
    expect(data.byteLength).toBe(0); // transferred, as a real worker's post does

    await vi.advanceTimersByTimeAsync(30_999);
    expect(load.outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(messageOf(load.outcome)).toBe('Decode worker did not finish loading a (4 MiB) within 31 s');
  });

  it('clears the deadline of a load answered at 90 % of its budget: no late rejection, no terminate', async () => {
    const { manager, terminate } = await readyManager();
    const load = await startLoad(manager, 'a', 20);
    await vi.advanceTimersByTimeAsync(31_500);

    latestWorker().simulateMessage({ type: 'SOURCE_READY', sourceId: 'a', info: info('a') });
    await vi.advanceTimersByTimeAsync(0);

    expect(load.outcome).toEqual(info('a'));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(loadDeadlineMs(20 * MIB));
    expect(terminate).not.toHaveBeenCalled();
    expect(manager.ready).toBe(true);
  });

  it("fails a second source's load, and a frame request, at once with the first load's reason", async () => {
    const { manager } = await readyManager();
    const fromA = await startLoad(manager, 'a', 4); // 31 s
    const fromB = await startLoad(manager, 'b', 20); // 35 s of its own
    await vi.advanceTimersByTimeAsync(20_000);
    const frame = track(manager.getFrame('c', 0.5)); // 15 s of its own: 35 s

    await vi.advanceTimersByTimeAsync(11_000); // 31 s: A's deadline

    for (const settled of [fromA, fromB, frame]) {
      expect(settled.outcome).toBeInstanceOf(Error);
      expect(messageOf(settled.outcome)).toBe('Decode worker did not finish loading a (4 MiB) within 31 s');
    }
    // B's own deadline and the frame request's went with it: nothing fires later.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline of a load the worker answers with an error', async () => {
    const { manager, terminate } = await readyManager();
    const load = await startLoad(manager, 'a', 1);

    latestWorker().simulateMessage({ type: 'ERROR', sourceId: 'a', error: 'No keyframes found', fatal: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(messageOf(load.outcome)).toBe('No keyframes found');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(loadDeadlineMs(1 * MIB));
    expect(terminate).not.toHaveBeenCalled();
  });

  it('clears the deadline of a load a worker error rejects', async () => {
    const { manager } = await readyManager();
    const load = await startLoad(manager, 'a', 1);

    latestWorker().simulateError('Worker crashed');
    await vi.advanceTimersByTimeAsync(0);

    expect(messageOf(load.outcome)).toBe('Decode worker failed: Worker crashed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline of a load terminate() rejects', async () => {
    const { manager } = await readyManager();
    const load = await startLoad(manager, 'a', 1);

    manager.terminate();
    await vi.advanceTimersByTimeAsync(0);

    expect(messageOf(load.outcome)).toBe('Manager terminated');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects, and clears the deadline of, a load its source's dispose cancels: no late terminate", async () => {
    const { manager, terminate } = await readyManager();
    const load = await startLoad(manager, 'a', 1);
    const other = await startLoad(manager, 'b', 1);

    const disposed = manager.disposeSource('a');
    await vi.advanceTimersByTimeAsync(50);
    await disposed;

    expect(messageOf(load.outcome)).toBe('Source disposed');
    expect(other.outcome).toBe('pending'); // only its own source's load
    latestWorker().simulateMessage({ type: 'SOURCE_READY', sourceId: 'b', info: info('b') });
    await vi.advanceTimersByTimeAsync(0);
    expect(other.outcome).toEqual(info('b'));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(loadDeadlineMs(1 * MIB));
    expect(terminate).not.toHaveBeenCalled();
    // A late answer for the disposed load settles nothing and throws nothing.
    latestWorker().simulateMessage({ type: 'SOURCE_READY', sourceId: 'a', info: info('a') });
    expect(messageOf(load.outcome)).toBe('Source disposed');
  });

  it('refuses a later load with the same reason instead of starting another worker', async () => {
    const { manager } = await readyManager();
    const first = await startLoad(manager, 'a', 4);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(messageOf(first.outcome)).toBe('Decode worker did not finish loading a (4 MiB) within 31 s');

    await expect(manager.loadSource('b', new ArrayBuffer(8), 'video/mp4')).rejects.toThrow(
      'Decode worker did not finish loading a (4 MiB) within 31 s'
    );
    expect(workers).toHaveLength(1);
  });

  it('still starts a worker again after a plain terminate()', async () => {
    const { manager } = await readyManager();
    manager.terminate();

    const load = await startLoad(manager, 'b', 1);
    await vi.advanceTimersByTimeAsync(0);

    expect(workers).toHaveLength(2);
    expect(load.outcome).toBe('pending');
    manager.terminate();
  });

  // Ruling 2: a rejected load already hands its source to <video> in
  // FrameSourceFactory.createSource, with the reason; the terminate makes every
  // source the worker held, and every source after it, do the same.
  describe('through FrameSourceFactory', () => {
    const fakeVideoSource = (sourceId: string): IFrameSource => ({
      getFrame: vi.fn().mockResolvedValue({} as HTMLVideoElement),
      getInfo: () => ({ sourceId, duration: 10, width: 1280, height: 720 }),
      requiresCleanup: () => false,
      dispose: vi.fn().mockResolvedValue(undefined),
    });

    it('falls every source back to <video> when one load misses its deadline', async () => {
      const createVideo = vi
        .spyOn(HTMLVideoFrameSource, 'create')
        .mockImplementation(async (sourceId: string) => fakeVideoSource(sourceId) as HTMLVideoFrameSource);
      const onFallback = vi.fn();
      const factory = new FrameSourceFactory(true, { measuredEngine: true });
      const init = factory.initialize();
      await vi.advanceTimersByTimeAsync(0);
      await init;
      const mp4 = (mib: number) => new Blob([new Uint8Array(mib * MIB)], { type: 'video/mp4' });

      // A loads in the worker.
      const sourceA = track(factory.createSource('a', mp4(1), 'video/mp4', undefined, onFallback));
      await vi.advanceTimersByTimeAsync(0);
      latestWorker().simulateMessage({ type: 'SOURCE_READY', sourceId: 'a', info: info('a') });
      await vi.advanceTimersByTimeAsync(0);
      expect((sourceA.outcome as IFrameSource).requiresCleanup()).toBe(true);

      // B's load is never answered.
      const sourceB = track(factory.createSource('b', mp4(4), 'video/mp4', undefined, onFallback));
      await vi.advanceTimersByTimeAsync(31_000);
      const reason = 'Decode worker did not finish loading b (4 MiB) within 31 s';
      expect(onFallback).toHaveBeenCalledWith('b', reason);
      expect((sourceB.outcome as IFrameSource).requiresCleanup()).toBe(false);

      // C, loaded after, goes straight to <video> without a second worker.
      const sourceC = await factory.createSource('c', mp4(1), 'video/mp4', undefined, onFallback);
      expect(onFallback).toHaveBeenCalledWith('c', reason);
      expect(sourceC.requiresCleanup()).toBe(false);
      expect(workers).toHaveLength(1);

      // A, which the worker held, hands itself over at its next frame.
      await (sourceA.outcome as IFrameSource).getFrame(0);
      expect(onFallback).toHaveBeenCalledWith('a', 'Manager not initialized');
      expect(createVideo.mock.calls.map(([sourceId]) => sourceId)).toEqual(['b', 'c', 'a']);
      factory.dispose();
    });
  });

  // Last in the file, after every case's afterEach has run (ESCSUITE-119).
  it("leaves src/test/setup.ts's URL stub in place", () => {
    expect(vi.isMockFunction(URL.createObjectURL)).toBe(true);
  });
});
