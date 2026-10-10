import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FRAME_REQUEST_DEADLINE_MS,
  VideoDecodeManager,
  getVideoDecodeManager,
  resetVideoDecodeManager,
} from './videoDecodeManager';
import type {
  DecodeWorkerResponse,
  VideoSourceInfo,
} from '../workers/decodeWorker.types';

// Whether a newly constructed MockWorker auto-fires WORKER_READY on the next
// tick. Tests for ESCSUITE-153 / ESCSUITE-29 Mechanism 2 (a worker that never
// starts) turn this off so initialize() is left genuinely pending.
let autoReadyEnabled = true;

// Mock Worker class
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private messageHandler: ((data: unknown) => void) | null = null;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    if (autoReadyEnabled) {
      // Simulate worker ready after a tick
      setTimeout(() => {
        this.simulateMessage({ type: 'WORKER_READY' });
      }, 0);
    }
  }

  postMessage(data: unknown, _transfer?: Transferable[]) {
    if (this.messageHandler) {
      this.messageHandler(data);
    }
  }

  terminate() {
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }

  // Test helpers
  simulateMessage(data: DecodeWorkerResponse | { type: 'WORKER_READY' }) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  simulateError(message: string) {
    if (this.onerror) {
      this.onerror(new ErrorEvent('error', { message }));
    }
  }

  simulateMessageError() {
    if (this.onmessageerror) {
      this.onmessageerror(new MessageEvent('messageerror'));
    }
  }

  setMessageHandler(handler: (data: unknown) => void) {
    this.messageHandler = handler;
  }
}

// Store mock worker instance for test access
let mockWorkerInstance: MockWorker | null = null;

// Mock VideoDecoder
class MockVideoDecoder {
  static isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
}

describe('VideoDecodeManager', () => {
  let originalWorker: typeof globalThis.Worker;
  let originalVideoDecoder: typeof globalThis.VideoDecoder;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    originalVideoDecoder = globalThis.VideoDecoder;

    // Mock Worker constructor
    vi.stubGlobal('Worker', function(url: URL | string, options?: WorkerOptions) {
      mockWorkerInstance = new MockWorker(url, options);
      return mockWorkerInstance;
    });

    // Mock VideoDecoder
    vi.stubGlobal('VideoDecoder', MockVideoDecoder);
  });

  afterEach(() => {
    resetVideoDecodeManager();
    mockWorkerInstance = null;
    autoReadyEnabled = true;
    vi.stubGlobal('Worker', originalWorker);
    vi.stubGlobal('VideoDecoder', originalVideoDecoder);
    // Always real timers after this file's fake-timer cases — a test whose
    // body times out abandons its async function before a local try/finally
    // would run, which used to leak fake timers into every later test.
    vi.useRealTimers();
  });

  describe('isSupported', () => {
    it('returns true when VideoDecoder and Worker are available', () => {
      expect(VideoDecodeManager.isSupported()).toBe(true);
    });

    it('returns false when VideoDecoder is not available', () => {
      vi.stubGlobal('VideoDecoder', undefined);
      expect(VideoDecodeManager.isSupported()).toBe(false);
    });

    it('returns false when Worker is not available', () => {
      vi.stubGlobal('Worker', undefined);
      expect(VideoDecodeManager.isSupported()).toBe(false);
    });
  });

  describe('initialization', () => {
    it('initializes successfully', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      expect(manager.ready).toBe(true);
    });

    it('only creates one worker on multiple initialize calls', async () => {
      let workerCallCount = 0;

      // Create a proper constructor function that can be called with 'new'
      function MockWorkerCounted(this: MockWorker, url: URL | string, options?: WorkerOptions) {
        workerCallCount++;
        const worker = new MockWorker(url, options);
        mockWorkerInstance = worker;
        return worker;
      }
      MockWorkerCounted.prototype = MockWorker.prototype;

      vi.stubGlobal('Worker', MockWorkerCounted);

      const manager = new VideoDecodeManager();
      await manager.initialize();
      await manager.initialize();
      await manager.initialize();

      expect(workerCallCount).toBe(1);
    });

    it('throws error when not supported', async () => {
      vi.stubGlobal('VideoDecoder', undefined);

      const manager = new VideoDecodeManager();
      await expect(manager.initialize()).rejects.toThrow('WebCodecs VideoDecoder is not supported');
    });
  });

  // ESCSUITE-153 / ESCSUITE-29 Mechanism 2: a worker that fails to start used
  // to leave initialize()'s promise unsettled forever. These pin that it now
  // always settles — reject on the worker's own error/messageerror, reject on
  // a bounded timeout, reject when an abort signal fires during the wait —
  // and that a happy worker is unaffected.
  describe('initialize() settling when the worker fails to start', () => {
    it('rejects when the worker never reports ready (timed out)', async () => {
      vi.useFakeTimers();
      autoReadyEnabled = false;

      const manager = new VideoDecodeManager();
      const initPromise = manager.initialize();
      const assertion = expect(initPromise).rejects.toThrow(/did not become ready within 10000ms/);

      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;

      expect(manager.ready).toBe(false);
    });

    it('rejects immediately when the worker reports an error before becoming ready', async () => {
      autoReadyEnabled = false;

      const manager = new VideoDecodeManager();
      const initPromise = manager.initialize();

      mockWorkerInstance!.simulateError('decodeWorker-abc123.js failed to load');

      await expect(initPromise).rejects.toThrow('Decode worker failed to start: decodeWorker-abc123.js failed to load');
    });

    it('falls back to "unknown error" when the worker error carries no message', async () => {
      // The empty-message ErrorEvent is exactly what a cross-origin or opaque
      // worker load reports — the standalone/CSP case this ticket exists for
      // — so the fallback string is the one a real user would actually see.
      autoReadyEnabled = false;

      const manager = new VideoDecodeManager();
      const initPromise = manager.initialize();

      mockWorkerInstance!.simulateError('');

      await expect(initPromise).rejects.toThrow('Decode worker failed to start: unknown error');
    });

    it('rejects immediately when the worker reports a messageerror before becoming ready', async () => {
      autoReadyEnabled = false;

      const manager = new VideoDecodeManager();
      const initPromise = manager.initialize();

      mockWorkerInstance!.simulateMessageError();

      await expect(initPromise).rejects.toThrow('Decode worker failed to start: received an unparseable message');
    });

    it('rejects immediately when the given signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const manager = new VideoDecodeManager();
      await expect(manager.initialize(controller.signal)).rejects.toThrow(
        'Decode worker initialization was aborted'
      );
    });

    it('rejects when the signal aborts while still waiting for the worker', async () => {
      autoReadyEnabled = false;
      const controller = new AbortController();

      const manager = new VideoDecodeManager();
      const initPromise = manager.initialize(controller.signal);

      controller.abort();

      await expect(initPromise).rejects.toThrow('Decode worker initialization was aborted');
    });

    it('still resolves normally when a signal is provided and never aborts', async () => {
      const controller = new AbortController();

      const manager = new VideoDecodeManager();
      await manager.initialize(controller.signal);

      expect(manager.ready).toBe(true);
    });

    it('clears its timeout on a successful ready, leaving no stray timer behind', async () => {
      // A regression that left the timer armed would be silent in every other
      // test here — the surviving callback would find readyReject already
      // null and no-op — so this has to check the timer queue directly.
      vi.useFakeTimers();

      const manager = new VideoDecodeManager();
      const initPromise = manager.initialize();
      // MockWorker's own auto-ready is a real setTimeout(…, 0); fake timers
      // replace it too, so it needs advancing like the 10s timeout does.
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores a WORKER_READY that arrives after the wait already timed out', async () => {
      vi.useFakeTimers();
      autoReadyEnabled = false;

      const manager = new VideoDecodeManager();
      const initPromise = manager.initialize();
      const assertion = expect(initPromise).rejects.toThrow(/did not become ready/);

      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;

      // A late READY from the same worker must not throw, resurrect the
      // already-rejected promise, or report the manager ready — a manager
      // whose one readyPromise is permanently rejected must never claim to
      // be ready, since `initialize()` hands that same rejection to every
      // later caller for as long as `this.worker` is set.
      expect(() => mockWorkerInstance!.simulateMessage({ type: 'WORKER_READY' })).not.toThrow();
      expect(manager.ready).toBe(false);
    });

    it('does not reject a second time when the worker errors again after already rejecting', async () => {
      autoReadyEnabled = false;

      const manager = new VideoDecodeManager();
      const initPromise = manager.initialize();

      mockWorkerInstance!.simulateError('first failure');
      await expect(initPromise).rejects.toThrow('Decode worker failed to start: first failure');

      // A second error event (or the timeout, had it still been pending)
      // must not throw an unhandled rejection or otherwise blow up.
      expect(() => mockWorkerInstance!.simulateError('second failure')).not.toThrow();
    });

    it('ignores a messageerror that arrives after the wait already resolved', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      // readyReject is null once WORKER_READY has resolved; a late
      // messageerror must not throw and must not disturb the ready state.
      expect(() => mockWorkerInstance!.simulateMessageError()).not.toThrow();
      expect(manager.ready).toBe(true);
    });

    it('clears the timeout when the Worker constructor throws synchronously', async () => {
      // The literal file:// "SecurityError: Failed to construct 'Worker'"
      // case: nothing is listening for the timeout or the abort signal once
      // construction itself fails, so initialize() must clean both up on its
      // own rather than depending on a caller's terminate().
      vi.useFakeTimers();
      vi.stubGlobal('Worker', function () {
        throw new Error("Failed to construct 'Worker'");
      });

      const manager = new VideoDecodeManager();
      await expect(manager.initialize()).rejects.toThrow("Failed to construct 'Worker'");

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('loadSource', () => {
    it('loads a source successfully', async () => {
      const manager = new VideoDecodeManager();

      const sourceInfo: VideoSourceInfo = {
        sourceId: 'test-source',
        duration: 10,
        width: 1920,
        height: 1080,
        codec: 'avc1.640028',
        frameCount: 300,
        keyframeCount: 10,
      };

      // Set up mock worker to respond with source ready
      const loadPromise = manager.loadSource(
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      // Wait for worker to be ready
      await new Promise(resolve => setTimeout(resolve, 10));

      // Simulate source ready response
      mockWorkerInstance!.simulateMessage({
        type: 'SOURCE_READY',
        sourceId: 'test-source',
        info: sourceInfo,
      });

      const result = await loadPromise;
      expect(result).toEqual(sourceInfo);
    });

    it('calls progress callback during loading', async () => {
      const manager = new VideoDecodeManager();
      const progressCallback = vi.fn();

      const loadPromise = manager.loadSource(
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4',
        progressCallback
      );

      // Wait for worker to be ready
      await new Promise(resolve => setTimeout(resolve, 10));

      // Simulate progress updates
      mockWorkerInstance!.simulateMessage({
        type: 'PROGRESS',
        sourceId: 'test-source',
        phase: 'demuxing',
        progress: 50,
      });

      mockWorkerInstance!.simulateMessage({
        type: 'PROGRESS',
        sourceId: 'test-source',
        phase: 'indexing',
        progress: 75,
      });

      mockWorkerInstance!.simulateMessage({
        type: 'PROGRESS',
        sourceId: 'test-source',
        phase: 'ready',
        progress: 100,
      });

      // Complete the load
      mockWorkerInstance!.simulateMessage({
        type: 'SOURCE_READY',
        sourceId: 'test-source',
        info: {
          sourceId: 'test-source',
          duration: 10,
          width: 1920,
          height: 1080,
          codec: 'avc1',
          frameCount: 300,
          keyframeCount: 10,
        },
      });

      await loadPromise;

      expect(progressCallback).toHaveBeenCalledWith('demuxing', 50);
      expect(progressCallback).toHaveBeenCalledWith('indexing', 75);
      expect(progressCallback).toHaveBeenCalledWith('ready', 100);
    });

    it('rejects on error response', async () => {
      const manager = new VideoDecodeManager();

      const loadPromise = manager.loadSource(
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      // Wait for worker to be ready
      await new Promise(resolve => setTimeout(resolve, 10));

      // Simulate error response
      mockWorkerInstance!.simulateMessage({
        type: 'ERROR',
        sourceId: 'test-source',
        error: 'Failed to parse video',
        fatal: true,
      });

      await expect(loadPromise).rejects.toThrow('Failed to parse video');
    });
  });

  describe('getFrame', () => {
    it('throws when not initialized', async () => {
      const manager = new VideoDecodeManager();

      await expect(manager.getFrame('source1', 1.5)).rejects.toThrow('Manager not initialized');
    });

    it('requests and receives a frame', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      // Mock VideoFrame
      const mockFrame = {
        displayWidth: 1920,
        displayHeight: 1080,
        close: vi.fn(),
      } as unknown as VideoFrame;

      const framePromise = manager.getFrame('source1', 1.5);

      // Wait for message to be processed
      await new Promise(resolve => setTimeout(resolve, 10));

      // Simulate frame ready response
      mockWorkerInstance!.simulateMessage({
        type: 'FRAME_READY',
        requestId: 1,
        sourceId: 'source1',
        timestamp: 1.5,
        frame: mockFrame,
      });

      const frame = await framePromise;
      expect(frame).toBe(mockFrame);
    });

    it('rejects on error response with requestId', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const framePromise = manager.getFrame('source1', 1.5);

      // Wait for message to be processed
      await new Promise(resolve => setTimeout(resolve, 10));

      // Simulate error response
      mockWorkerInstance!.simulateMessage({
        type: 'ERROR',
        requestId: 1,
        sourceId: 'source1',
        error: 'Frame decode failed',
        fatal: false,
      });

      await expect(framePromise).rejects.toThrow('Frame decode failed');
    });
  });

  describe('getFrames generator', () => {
    it('yields frames in sequence', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const timestamps = [0, 0.5, 1.0];
      const frames: VideoFrame[] = [];

      // Create mock frames
      for (let i = 0; i < 3; i++) {
        frames.push({
          displayWidth: 1920,
          displayHeight: 1080,
          close: vi.fn(),
        } as unknown as VideoFrame);
      }

      let requestCount = 0;

      // Run the generator
      const generator = manager.getFrames('source1', timestamps);

      const results: VideoFrame[] = [];

      // Process each frame request
      for await (const _ of (async function*() {
        for (let i = 0; i < timestamps.length; i++) {
          const framePromise = generator.next();

          // Wait for message
          await new Promise(resolve => setTimeout(resolve, 10));

          // Simulate frame ready
          mockWorkerInstance!.simulateMessage({
            type: 'FRAME_READY',
            requestId: ++requestCount,
            sourceId: 'source1',
            timestamp: timestamps[i],
            frame: frames[i],
          });

          const result = await framePromise;
          if (!result.done) {
            yield result.value;
          }
        }
      })()) {
        results.push(_);
      }

      expect(results).toHaveLength(3);
    });
  });

  describe('releaseFrame', () => {
    it('sends release message to worker', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      let lastMessage: unknown = null;
      mockWorkerInstance!.setMessageHandler((data) => {
        lastMessage = data;
      });

      manager.releaseFrame('source1', 1.5);

      expect(lastMessage).toEqual({
        type: 'RELEASE_FRAME',
        sourceId: 'source1',
        timestamp: 1.5,
      });
    });

    it('does nothing when not initialized', () => {
      const manager = new VideoDecodeManager();

      // Should not throw
      manager.releaseFrame('source1', 1.5);
    });
  });

  describe('disposeSource', () => {
    it('sends dispose message to worker', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      let lastMessage: unknown = null;
      mockWorkerInstance!.setMessageHandler((data) => {
        lastMessage = data;
      });

      await manager.disposeSource('source1');

      expect(lastMessage).toEqual({
        type: 'DISPOSE_SOURCE',
        sourceId: 'source1',
      });
    });

    it('cancels pending requests for the source', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const framePromise = manager.getFrame('source1', 1.5);

      // Wait a tick
      await new Promise(resolve => setTimeout(resolve, 10));

      // Dispose the source - don't await since we want to test rejection
      const disposePromise = manager.disposeSource('source1');

      // Now await the rejection before dispose completes
      await expect(framePromise).rejects.toThrow('Source disposed');

      // Complete dispose
      await disposePromise;
    });
  });

  // ESCSUITE-254 fix round 1, M2: a mid-export handover disposes one source.
  // Rejecting every source's in-flight request cascaded the handover to every
  // active source, and the frames the worker still sent back for them were
  // dropped without close().
  describe('disposeSource with several sources in flight', () => {
    const frame = () => ({ close: vi.fn() }) as unknown as VideoFrame & { close: ReturnType<typeof vi.fn> };

    it("rejects only the disposed source's pending requests", async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();
      const fromA = manager.getFrame('a', 0.5);
      const fromB = manager.getFrame('b', 0.5);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const disposed = manager.disposeSource('a');
      await expect(fromA).rejects.toThrow('Source disposed');
      const answer = frame();
      mockWorkerInstance!.simulateMessage({ type: 'FRAME_READY', requestId: 2, sourceId: 'b', timestamp: 0.5, frame: answer });

      await expect(fromB).resolves.toBe(answer);
      await disposed;
    });

    it('closes a frame that arrives for a request already settled', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();
      const fromA = manager.getFrame('a', 0.5);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const disposed = manager.disposeSource('a');
      await expect(fromA).rejects.toThrow('Source disposed');

      const late = frame();
      mockWorkerInstance!.simulateMessage({ type: 'FRAME_READY', requestId: 1, sourceId: 'a', timestamp: 0.5, frame: late });

      expect(late.close).toHaveBeenCalledTimes(1);
      await disposed;
    });
  });

  // Fix round 1, MINOR 1: once the worker is up, a worker error or an
  // unreadable message settles every request in flight; an export must never
  // wait for an answer that is not coming.
  describe('a worker that fails after it is ready', () => {
    it('rejects every pending request on an error', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();
      const requests = [manager.getFrame('a', 0.5), manager.getFrame('b', 0.5)];
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockWorkerInstance!.simulateError('Worker crashed');

      for (const request of requests) await expect(request).rejects.toThrow('Decode worker failed: Worker crashed');
    });

    // Fix round 2, MINOR 5: a source still loading is waited on too.
    it('rejects a source load in flight on an error', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();
      const load = manager.loadSource('a', new ArrayBuffer(8), 'video/mp4');
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockWorkerInstance!.simulateError('Worker crashed');

      await expect(load).rejects.toThrow('Decode worker failed: Worker crashed');
    });

    it('rejects a source load in flight on a messageerror', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();
      const load = manager.loadSource('a', new ArrayBuffer(8), 'video/mp4');
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockWorkerInstance!.simulateMessageError();

      await expect(load).rejects.toThrow('Decode worker failed: received an unparseable message');
    });

    it('rejects every pending request on a messageerror', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();
      const requests = [manager.getFrame('a', 0.5), manager.getFrame('b', 0.5)];
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockWorkerInstance!.simulateMessageError();

      for (const request of requests) {
        await expect(request).rejects.toThrow('Decode worker failed: received an unparseable message');
      }
    });
  });

  // ESCSUITE-266: a worker the browser kills outright (an out-of-memory kill
  // of a dedicated worker, say) may fire neither `error` nor `messageerror`,
  // and the worker's own 5 s stall bound dies with it — so a frame request it
  // never answers used to leave the export waiting forever. Each request now
  // has a main-thread deadline; missing it fails that request and, the worker
  // presumed dead, everything else in flight with it.
  describe('a frame request the worker never answers (ESCSUITE-266)', () => {
    const DEADLINE_REASON = 'Decode worker did not answer within 15 s for a';

    /** A ready manager under fake timers, with the worker's terminate() spied on. */
    async function readyManager() {
      vi.useFakeTimers();
      const manager = new VideoDecodeManager();
      const init = manager.initialize();
      await vi.advanceTimersByTimeAsync(0);
      await init;
      const terminate = vi.spyOn(mockWorkerInstance!, 'terminate');
      return { manager, terminate };
    }

    /** What a promise has settled to so far: 'pending', the value, or the error. */
    function track<T>(promise: Promise<T>) {
      const state: { outcome: unknown } = { outcome: 'pending' };
      promise.then(
        (value) => { state.outcome = value; },
        (error: unknown) => { state.outcome = error; }
      );
      return state;
    }

    it('is fifteen seconds, three times the worker\'s own 5 s stall bound', () => {
      expect(FRAME_REQUEST_DEADLINE_MS).toBe(15_000);
    });

    it('rejects the request at 15 s with the named reason, and terminates the worker', async () => {
      const { manager, terminate } = await readyManager();
      const request = track(manager.getFrame('a', 0.5));

      await vi.advanceTimersByTimeAsync(14_999);
      expect(request.outcome).toBe('pending');
      expect(terminate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(request.outcome).toBeInstanceOf(Error);
      expect((request.outcome as Error).message).toBe(DEADLINE_REASON);
      expect(terminate).toHaveBeenCalledTimes(1);
      // As after any terminate: not ready, and a later request is refused
      // rather than sent to a worker that is gone.
      expect(manager.ready).toBe(false);
      await expect(manager.getFrame('a', 0.6)).rejects.toThrow('Manager not initialized');
      expect(vi.getTimerCount()).toBe(0);
    });

    it("fails every other source's request, and a source load, at once with the deadline's reason", async () => {
      const { manager } = await readyManager();
      const fromA = track(manager.getFrame('a', 0.5));
      await vi.advanceTimersByTimeAsync(5_000);
      const fromB = track(manager.getFrame('b', 0.5));
      const load = track(manager.loadSource('c', new ArrayBuffer(8), 'video/mp4'));
      await vi.advanceTimersByTimeAsync(0);

      // A's deadline, 10 s into B's own: B does not wait out its own 15 s.
      await vi.advanceTimersByTimeAsync(10_000);

      for (const settled of [fromA, fromB, load]) {
        expect(settled.outcome).toBeInstanceOf(Error);
        expect((settled.outcome as Error).message).toBe(DEADLINE_REASON);
      }
      // B's own timer went with it: nothing fires at 20 s.
      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the deadline of a request answered at 14.9 s: no late rejection, no terminate', async () => {
      const { manager, terminate } = await readyManager();
      const request = track(manager.getFrame('a', 0.5));
      await vi.advanceTimersByTimeAsync(14_900);

      const answer = { close: vi.fn() } as unknown as VideoFrame;
      mockWorkerInstance!.simulateMessage({ type: 'FRAME_READY', requestId: 1, sourceId: 'a', timestamp: 0.5, frame: answer });
      await vi.advanceTimersByTimeAsync(0);

      expect(request.outcome).toBe(answer);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(FRAME_REQUEST_DEADLINE_MS);
      expect(request.outcome).toBe(answer);
      expect(terminate).not.toHaveBeenCalled();
      expect(manager.ready).toBe(true);
    });

    it("clears the deadline of a request the worker answers with an error", async () => {
      const { manager, terminate } = await readyManager();
      const request = track(manager.getFrame('a', 0.5));

      mockWorkerInstance!.simulateMessage({ type: 'ERROR', requestId: 1, sourceId: 'a', error: 'Decoder stalled: no output for 5000ms', fatal: false });
      await vi.advanceTimersByTimeAsync(0);

      expect((request.outcome as Error).message).toBe('Decoder stalled: no output for 5000ms');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(FRAME_REQUEST_DEADLINE_MS);
      expect(terminate).not.toHaveBeenCalled();
    });

    it("clears the deadline of a request its source's dispose cancels", async () => {
      const { manager, terminate } = await readyManager();
      const request = track(manager.getFrame('a', 0.5));

      const disposed = manager.disposeSource('a');
      await vi.advanceTimersByTimeAsync(50);
      await disposed;

      expect((request.outcome as Error).message).toBe('Source disposed');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(FRAME_REQUEST_DEADLINE_MS);
      expect(terminate).not.toHaveBeenCalled();
    });

    it('clears the deadlines of the requests a worker error rejects', async () => {
      const { manager } = await readyManager();
      const requests = [track(manager.getFrame('a', 0.5)), track(manager.getFrame('b', 0.5))];

      mockWorkerInstance!.simulateError('Worker crashed');
      await vi.advanceTimersByTimeAsync(0);

      for (const request of requests) expect((request.outcome as Error).message).toBe('Decode worker failed: Worker crashed');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the deadline of a request terminate() rejects', async () => {
      const { manager } = await readyManager();
      const request = track(manager.getFrame('a', 0.5));

      manager.terminate();
      await vi.advanceTimersByTimeAsync(0);

      expect((request.outcome as Error).message).toBe('Manager terminated');
      expect(vi.getTimerCount()).toBe(0);
    });

    // ESCSUITE-272: the deadline measures silence, not age. A live worker
    // still decoding one hard request — a long keyframe gap on a slow machine,
    // a transition bouncing one decoder between two positions — reports each
    // decoder output for it as FRAME_PROGRESS, and each one re-arms that
    // request's deadline (and only that request's).
    describe('a request the worker reports progress on (ESCSUITE-272)', () => {
      function progress(requestId: number) {
        mockWorkerInstance!.simulateMessage({ type: 'FRAME_PROGRESS', requestId });
      }

      it('is not terminated at 15 s when the worker reported progress at 10 s, and resolves at 20 s', async () => {
        const { manager, terminate } = await readyManager();
        const request = track(manager.getFrame('a', 0.5));

        await vi.advanceTimersByTimeAsync(10_000);
        progress(1);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(request.outcome).toBe('pending');
        expect(terminate).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(5_000);
        const answer = { close: vi.fn() } as unknown as VideoFrame;
        mockWorkerInstance!.simulateMessage({ type: 'FRAME_READY', requestId: 1, sourceId: 'a', timestamp: 0.5, frame: answer });
        await vi.advanceTimersByTimeAsync(0);

        expect(request.outcome).toBe(answer);
        expect(answer.close).not.toHaveBeenCalled();
        expect(terminate).not.toHaveBeenCalled();
        expect(manager.ready).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      });

      it('re-arms the whole 15 s from the progress: silent after it, the request fails at 25 s, one timer throughout', async () => {
        const { manager, terminate } = await readyManager();
        const request = track(manager.getFrame('a', 0.5));

        await vi.advanceTimersByTimeAsync(10_000);
        progress(1);
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(14_999);
        expect(request.outcome).toBe('pending');
        expect(terminate).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect((request.outcome as Error).message).toBe(DEADLINE_REASON);
        expect(terminate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      });

      it("does not keep a silent request alive: progress on a's request, b's still fails at its own 15 s", async () => {
        const { manager, terminate } = await readyManager();
        const fromA = track(manager.getFrame('a', 0.5));
        const fromB = track(manager.getFrame('b', 0.5));

        await vi.advanceTimersByTimeAsync(10_000);
        progress(1);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(fromB.outcome).toBe('pending');

        await vi.advanceTimersByTimeAsync(1);
        // B's deadline, not A's: the reason names b, and A goes with it.
        expect((fromB.outcome as Error).message).toBe('Decode worker did not answer within 15 s for b');
        expect((fromA.outcome as Error).message).toBe('Decode worker did not answer within 15 s for b');
        expect(terminate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      });

      it('ignores progress for a request id it never issued: nothing re-armed, nothing thrown', async () => {
        const { manager, terminate } = await readyManager();
        const request = track(manager.getFrame('a', 0.5));

        await vi.advanceTimersByTimeAsync(10_000);
        expect(() => progress(99)).not.toThrow();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(5_000);
        expect((request.outcome as Error).message).toBe(DEADLINE_REASON);
        expect(terminate).toHaveBeenCalledTimes(1);
      });

      it('ignores progress for a request already answered: no timer comes back', async () => {
        const { manager, terminate } = await readyManager();
        const request = track(manager.getFrame('a', 0.5));
        const answer = { close: vi.fn() } as unknown as VideoFrame;
        mockWorkerInstance!.simulateMessage({ type: 'FRAME_READY', requestId: 1, sourceId: 'a', timestamp: 0.5, frame: answer });
        await vi.advanceTimersByTimeAsync(0);

        expect(() => progress(1)).not.toThrow();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(FRAME_REQUEST_DEADLINE_MS);
        expect(request.outcome).toBe(answer);
        expect(terminate).not.toHaveBeenCalled();
      });

      it("ignores progress for a request its source's dispose cancelled", async () => {
        const { manager, terminate } = await readyManager();
        const request = track(manager.getFrame('a', 0.5));
        const disposed = manager.disposeSource('a');
        await vi.advanceTimersByTimeAsync(50);
        await disposed;

        expect(() => progress(1)).not.toThrow();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(FRAME_REQUEST_DEADLINE_MS);
        expect((request.outcome as Error).message).toBe('Source disposed');
        expect(terminate).not.toHaveBeenCalled();
      });

      it('ignores progress that reaches it after terminate()', async () => {
        const { manager } = await readyManager();
        const request = track(manager.getFrame('a', 0.5));
        // Held before terminate() detaches it, as a message already queued
        // on this thread would still be dispatched.
        const deliver = mockWorkerInstance!.onmessage!;
        manager.terminate();
        await vi.advanceTimersByTimeAsync(0);

        expect(() => deliver(new MessageEvent('message', { data: { type: 'FRAME_PROGRESS', requestId: 1 } }))).not.toThrow();
        expect(vi.getTimerCount()).toBe(0);
        expect((request.outcome as Error).message).toBe('Manager terminated');
      });
    });
  });

  describe('terminate', () => {
    it('terminates the worker', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      expect(manager.ready).toBe(true);

      manager.terminate();

      expect(manager.ready).toBe(false);
    });

    it('rejects all pending requests', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const framePromise = manager.getFrame('source1', 1.5);

      // Wait a tick
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.terminate();

      await expect(framePromise).rejects.toThrow('Manager terminated');
    });

    it('rejects pending source loads', async () => {
      const manager = new VideoDecodeManager();

      const loadPromise = manager.loadSource(
        'source1',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      // Wait for worker to start
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.terminate();

      await expect(loadPromise).rejects.toThrow('Manager terminated');
    });
  });

  describe('error handling', () => {
    it('calls error callback on worker error', async () => {
      const manager = new VideoDecodeManager();
      const errorCallback = vi.fn();
      manager.onError(errorCallback);

      await manager.initialize();

      mockWorkerInstance!.simulateError('Worker crashed');

      expect(errorCallback).toHaveBeenCalledWith(
        expect.stringContaining('Worker error'),
        true
      );
    });

    it('calls error callback on unhandled error response', async () => {
      const manager = new VideoDecodeManager();
      const errorCallback = vi.fn();
      manager.onError(errorCallback);

      await manager.initialize();

      // Simulate error without requestId or sourceId
      mockWorkerInstance!.simulateMessage({
        type: 'ERROR',
        error: 'General worker error',
        fatal: false,
      });

      expect(errorCallback).toHaveBeenCalledWith('General worker error', false);
    });
  });

  describe('STATUS responses', () => {
    it('ignores them: they are answered by whoever asked, not the dispatcher', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();
      const onError = vi.fn();
      manager.onError(onError);

      let request: { requestId: number } | null = null;
      mockWorkerInstance!.setMessageHandler((data) => {
        request = data as { requestId: number };
      });

      // A pending frame request must not be disturbed by a STATUS message.
      const framePromise = manager.getFrame('source1', 1);
      mockWorkerInstance!.simulateMessage({
        type: 'STATUS',
        sourceId: 'source1',
      } as unknown as DecodeWorkerResponse);

      expect(onError).not.toHaveBeenCalled();

      // The request is still outstanding and still resolvable.
      const mockFrame = { close: vi.fn() } as unknown as VideoFrame;
      mockWorkerInstance!.simulateMessage({
        type: 'FRAME_READY',
        requestId: request!.requestId,
        sourceId: 'source1',
        timestamp: 1,
        frame: mockFrame,
      });

      await expect(framePromise).resolves.toBe(mockFrame);
    });
  });

  describe('singleton instance', () => {
    it('getVideoDecodeManager returns same instance', () => {
      const manager1 = getVideoDecodeManager();
      const manager2 = getVideoDecodeManager();

      expect(manager1).toBe(manager2);
    });

    it('resetVideoDecodeManager terminates and clears instance', async () => {
      const manager1 = getVideoDecodeManager();
      await manager1.initialize();

      expect(manager1.ready).toBe(true);

      resetVideoDecodeManager();

      const manager2 = getVideoDecodeManager();
      expect(manager2).not.toBe(manager1);
      expect(manager2.ready).toBe(false);
    });
  });

  describe('flush', () => {
    it('sends flush message to worker', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      let lastMessage: unknown = null;
      mockWorkerInstance!.setMessageHandler((data) => {
        lastMessage = data;
      });

      await manager.flush('source1');

      expect(lastMessage).toEqual({
        type: 'FLUSH',
        sourceId: 'source1',
      });
    });
  });

  describe('keeps the suite\'s global stubs (ESCSUITE-119)', () => {
    it('leaves src/test/setup.ts\'s URL stub in place for the tests after it', () => {
      expect(vi.isMockFunction(URL.createObjectURL)).toBe(true);
      expect(vi.isMockFunction(URL.revokeObjectURL)).toBe(true);
    });
  });
});
