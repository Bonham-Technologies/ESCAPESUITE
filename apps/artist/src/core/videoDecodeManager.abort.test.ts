/**
 * ESCSUITE-314: the export's Cancel reaches the decode worker.
 *
 * `initialize(signal)` used to read the export's signal for the startup wait
 * alone (ESCSUITE-153), so a Cancel that landed while a source was loading or a
 * frame request was pending waited for the worker to answer — and a worker
 * that keeps posting FRAME_PROGRESS (ESCSUITE-272) re-arms its deadline, so a
 * cancelled request on a healthy slow decode waited as long as the decode took,
 * holding up to 512 MB of samples. The signal now governs the manager for its
 * whole life: an abort runs the terminate path a missed deadline runs, and
 * everything in flight rejects with the export's own ExportAbortedError, which
 * the dialog reads as a cancel rather than a failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoDecodeManager, FRAME_REQUEST_DEADLINE_MS, loadDeadlineMs } from './videoDecodeManager';
import { ExportAbortedError } from './exportTypes';
import type { DecodeWorkerResponse, VideoSourceInfo } from '../workers/decodeWorker.types';

const MIB = 1024 * 1024;

/** A worker double that never answers anything but WORKER_READY unless told to. */
class SilentWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: Array<{ type: string; sourceId?: string; requestId?: number }> = [];

  constructor() {
    setTimeout(() => this.simulateMessage({ type: 'WORKER_READY' }), 0);
  }

  postMessage(data: { type: string; sourceId?: string; requestId?: number }) {
    this.posted.push(data);
  }

  terminate() {
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }

  simulateMessage(data: DecodeWorkerResponse | { type: 'WORKER_READY' }) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

let workers: SilentWorker[] = [];
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

/** A ready manager bound to `controller`'s signal, its worker's terminate() spied on. */
async function readyManager(controller: AbortController) {
  const manager = new VideoDecodeManager();
  const init = manager.initialize(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  await init;
  const terminate = vi.spyOn(latestWorker(), 'terminate');
  return { manager, terminate };
}

/** A ready manager with source `sourceId` loaded. */
async function loadedManager(controller: AbortController, sourceId = 'a') {
  const ready = await readyManager(controller);
  const load = ready.manager.loadSource(sourceId, new ArrayBuffer(MIB), 'video/mp4');
  await vi.advanceTimersByTimeAsync(0);
  latestWorker().simulateMessage({ type: 'SOURCE_READY', sourceId, info: info(sourceId) });
  await load;
  return ready;
}

describe('the export signal reaches the decode worker (ESCSUITE-314)', () => {
  // Restore exactly what was replaced, never vi.unstubAllGlobals() (ESCSUITE-119).
  let originalWorker: typeof globalThis.Worker;
  let originalVideoDecoder: typeof globalThis.VideoDecoder;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    originalWorker = globalThis.Worker;
    originalVideoDecoder = globalThis.VideoDecoder;
    vi.stubGlobal('Worker', function StubWorker() {
      const worker = new SilentWorker();
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

  it('an abort during a frame request terminates the worker within one tick and rejects the request with ExportAbortedError', async () => {
    const controller = new AbortController();
    const { manager, terminate } = await loadedManager(controller);
    const frame = track(manager.getFrame('a', 1));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(frame.outcome).toBe('pending');

    controller.abort();
    // Synchronously, in the abort's own dispatch: no tick has passed.
    expect(terminate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(0);
    expect(frame.outcome).toBeInstanceOf(ExportAbortedError);
    expect(manager.ready).toBe(false);
    // The request's deadline went with it: nothing fires at 15 s.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a worker still reporting progress on the request is terminated all the same', async () => {
    const controller = new AbortController();
    const { manager, terminate } = await loadedManager(controller);
    const frame = track(manager.getFrame('a', 1));
    await vi.advanceTimersByTimeAsync(0);
    const requestId = latestWorker().posted.find((m) => m.type === 'REQUEST_FRAME')!.requestId!;
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(FRAME_REQUEST_DEADLINE_MS - 1);
      latestWorker().simulateMessage({ type: 'FRAME_PROGRESS', requestId } as DecodeWorkerResponse);
    }
    expect(frame.outcome).toBe('pending');

    controller.abort();

    expect(terminate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.outcome).toBeInstanceOf(ExportAbortedError);
  });

  it('an abort during a source load rejects it, and every other request in flight, with ExportAbortedError — and arms no later deadline', async () => {
    const controller = new AbortController();
    const { manager, terminate } = await loadedManager(controller, 'a');
    const frame = track(manager.getFrame('a', 2));
    const load = track(manager.loadSource('b', new ArrayBuffer(20 * MIB), 'video/mp4'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load.outcome).toBe('pending');

    controller.abort();

    expect(terminate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(load.outcome).toBeInstanceOf(ExportAbortedError);
    expect(frame.outcome).toBeInstanceOf(ExportAbortedError);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(loadDeadlineMs(20 * MIB));
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('refuses a load after the abort with ExportAbortedError, starting no new worker', async () => {
    const controller = new AbortController();
    const { manager } = await readyManager(controller);
    controller.abort();

    const load = track(manager.loadSource('b', new ArrayBuffer(MIB), 'video/mp4'));
    await vi.advanceTimersByTimeAsync(0);

    expect(load.outcome).toBeInstanceOf(ExportAbortedError);
    expect(workers).toHaveLength(1);
  });

  it('refuses a frame request after the abort with ExportAbortedError', async () => {
    const controller = new AbortController();
    const { manager } = await loadedManager(controller);
    controller.abort();

    const frame = track(manager.getFrame('a', 1));
    await vi.advanceTimersByTimeAsync(0);

    expect(frame.outcome).toBeInstanceOf(ExportAbortedError);
  });

  it('takes its abort listener off the signal when terminated', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const { manager, terminate } = await readyManager(controller);
    // The startup wait's own listener came off when the wait settled.
    expect(remove).toHaveBeenCalledTimes(1);

    manager.terminate();

    expect(remove).toHaveBeenCalledTimes(2);
    controller.abort();
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
