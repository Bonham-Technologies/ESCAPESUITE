import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebCodecsFrameSource,
  HTMLVideoFrameSource,
  FrameSourceFactory,
  MAX_WORKER_SOURCE_BYTES,
  isWebCodecsAvailable,
  type IFrameSource,
} from './frameSource';
import { elementSeekTarget } from './elementSeek';
import { SourceNotSeekableError } from './seekWedge';

// A mutable slot a test can fill in before calling factory.initialize(), so
// the *next* MockVideoDecodeManager's initialize() rejects once (ESCSUITE-29
// Mechanism 2: the decode worker failing to start). vi.hoisted so the mock
// factory below — itself hoisted above this file's imports — can close over
// it, and the test body can reach it through the mocked class's own field.
const nextInitializeRejection = vi.hoisted(() => ({ error: null as Error | null }));

// Mock VideoDecodeManager - the factory must be self-contained
vi.mock('./videoDecodeManager', () => {
  // Define mock class inside factory to avoid hoisting issues
  const mockFn = vi.fn;

  class MockVideoDecodeManager {
    static isSupported = mockFn().mockReturnValue(true);
    static __nextInitializeRejection = nextInitializeRejection;

    initialize = mockFn().mockImplementation(() => {
      if (nextInitializeRejection.error) {
        const error = nextInitializeRejection.error;
        nextInitializeRejection.error = null;
        return Promise.reject(error);
      }
      return Promise.resolve(undefined);
    });
    loadSource = mockFn().mockResolvedValue({
      sourceId: 'test-source',
      duration: 10,
      width: 1920,
      height: 1080,
      codec: 'avc1.640028',
      frameCount: 300,
      keyframeCount: 10,
    });
    getFrame = mockFn().mockResolvedValue({
      displayWidth: 1920,
      displayHeight: 1080,
      close: mockFn(),
    });
    disposeSource = mockFn().mockResolvedValue(undefined);
    terminate = mockFn();
  }

  return {
    VideoDecodeManager: MockVideoDecodeManager,
  };
});

// Every factory in this file is built in an engine the worker is admitted in,
// unless a case says otherwise (jsdom's own user agent is not one).
const engine = vi.hoisted(() => ({ measured: true }));
vi.mock('./workerDecodeEngine', () => ({
  isMeasuredWorkerDecodeEngine: () => engine.measured,
}));

// Import after mock is set up
import { VideoDecodeManager } from './videoDecodeManager';

// Mock VideoFrame class
class MockVideoFrame {
  displayWidth = 1920;
  displayHeight = 1080;
  close = vi.fn();
}
vi.stubGlobal('VideoFrame', MockVideoFrame);

// Mock HTMLVideoElement
class MockHTMLVideoElement {
  playsInline = false;
  preload = '';
  crossOrigin = '';
  muted = false;
  src = '';
  currentTime = 0;
  duration = 10;
  videoWidth = 1920;
  videoHeight = 1080;
  readyState = 4;

  /** The last value assigned to each property handler, null included. */
  lastOnLoadedData: (() => void) | null = null;
  lastOnError: (() => void) | null = null;

  set onloadeddata(handler: (() => void) | null) {
    this.lastOnLoadedData = handler;
    if (handler) {
      setTimeout(() => handler(), 0);
    }
  }

  set onerror(handler: (() => void) | null) {
    this.lastOnError = handler;
  }

  addEventListener(event: string, handler: () => void) {
    if (event === 'seeked') {
      // Simulate immediate seek completion
      setTimeout(() => handler(), 0);
    } else if (event === 'canplay') {
      setTimeout(() => handler(), 0);
    }
  }

  removeEventListener(_event: string, _handler: () => void) {
    // Cleanup - not tracked in test
  }

  pause() {}
  load() {}
}

// A video element whose loading and seeking a test can script, for the paths
// the happy-path mock above cannot reach (load failure, stalled seek, a frame
// that is not decoded yet).
interface ScriptedVideoOptions {
  failLoad?: boolean;
  /** Never fire 'seeked' — models a seek the browser does not complete. */
  stallSeek?: boolean;
  /** Never fire 'canplay' — models frame data that never becomes ready. */
  stallCanPlay?: boolean;
  readyState?: number;
  /** What `seeking` reports — true with `stallSeek` is Firefox's seek wedge (ESCSUITE-305). */
  seeking?: boolean;
}

class ScriptedVideoElement {
  playsInline = false;
  preload = '';
  crossOrigin = '';
  muted = false;
  currentTime = 0;
  duration = 10;
  videoWidth = 1920;
  videoHeight = 1080;
  readyState: number;
  seeking: boolean;
  /** Event names the code under test removed listeners for, in order. */
  readonly removedListeners: string[] = [];
  options: ScriptedVideoOptions;
  private errorHandler: (() => void) | null = null;

  constructor(options: ScriptedVideoOptions = {}) {
    this.options = options;
    this.readyState = options.readyState ?? 4;
    this.seeking = options.seeking ?? false;
  }

  set src(_value: string) {
    if (this.options.failLoad) {
      setTimeout(() => this.errorHandler?.(), 0);
    }
  }

  set onloadeddata(handler: (() => void) | null) {
    if (handler && !this.options.failLoad) setTimeout(() => handler(), 0);
  }

  set onerror(handler: (() => void) | null) {
    this.errorHandler = handler;
  }

  addEventListener(event: string, handler: () => void) {
    if (event === 'seeked' && !this.options.stallSeek) setTimeout(() => handler(), 0);
    if (event === 'canplay' && !this.options.stallCanPlay) setTimeout(() => handler(), 0);
  }

  removeEventListener(event: string, _handler: () => void) {
    this.removedListeners.push(event);
  }

  pause() {}
  load() {}
}

// Mock document.createElement for video elements. The factory is swappable so a
// test can hand the code under test a scripted element instead.
let videoFactory: () => unknown = () => new MockHTMLVideoElement();
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
  if (tagName === 'video') {
    return videoFactory() as HTMLVideoElement;
  }
  return originalCreateElement(tagName);
});

// Mock URL.createObjectURL and revokeObjectURL
vi.stubGlobal('URL', {
  createObjectURL: vi.fn().mockReturnValue('blob:test-url'),
  revokeObjectURL: vi.fn(),
});

describe('frameSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    videoFactory = () => new MockHTMLVideoElement();
    nextInitializeRejection.error = null;
    engine.measured = true;
  });

  describe('WebCodecsFrameSource', () => {
    it('creates a source and returns info', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const source = await WebCodecsFrameSource.create(
        manager,
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      const info = source.getInfo();
      expect(info.sourceId).toBe('test-source');
      expect(info.duration).toBe(10);
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
      expect(info.codec).toBe('avc1.640028');
    });

    it('gets frames at specified timestamps', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const source = await WebCodecsFrameSource.create(
        manager,
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      const frame = await source.getFrame(1.5);
      expect(frame).toBeDefined();
      expect(manager.getFrame).toHaveBeenCalledWith('test-source', 1.5);
    });

    it('requires cleanup for VideoFrame objects', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const source = await WebCodecsFrameSource.create(
        manager,
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      expect(source.requiresCleanup()).toBe(true);
    });

    it('disposes the source', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const source = await WebCodecsFrameSource.create(
        manager,
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      await source.dispose();
      expect(manager.disposeSource).toHaveBeenCalledWith('test-source');
    });

    it('throws error when getting frame after dispose', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const source = await WebCodecsFrameSource.create(
        manager,
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      await source.dispose();

      await expect(source.getFrame(1.0)).rejects.toThrow('Source has been disposed');
    });
  });

  describe('HTMLVideoFrameSource', () => {
    it('creates a source from blob', async () => {
      const blob = new Blob(['test'], { type: 'video/mp4' });
      const source = await HTMLVideoFrameSource.create('test-source', blob);

      const info = source.getInfo();
      expect(info.sourceId).toBe('test-source');
      expect(info.duration).toBe(10);
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
    });

    it('creates a source from existing element', () => {
      const video = new MockHTMLVideoElement() as unknown as HTMLVideoElement;
      const source = HTMLVideoFrameSource.fromElement('test-source', video);

      expect(source.getInfo().sourceId).toBe('test-source');
    });

    it('does not require cleanup for HTMLVideoElement', async () => {
      const blob = new Blob(['test'], { type: 'video/mp4' });
      const source = await HTMLVideoFrameSource.create('test-source', blob);

      expect(source.requiresCleanup()).toBe(false);
    });

    it('gets frames by seeking the video element', async () => {
      const blob = new Blob(['test'], { type: 'video/mp4' });
      const source = await HTMLVideoFrameSource.create('test-source', blob);

      const frame = await source.getFrame(5.0);
      expect(frame).toBeDefined();
      // The mock video element should be returned
      expect((frame as HTMLVideoElement).duration).toBe(10);
    });

    it('rejects and revokes the object URL when the element fails to load', async () => {
      videoFactory = () => new ScriptedVideoElement({ failLoad: true });

      await expect(
        HTMLVideoFrameSource.create('bad-source', new Blob(['x'], { type: 'video/mp4' }))
      ).rejects.toThrow('Failed to load video');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });

    it('throws when a frame is requested after dispose', async () => {
      const source = HTMLVideoFrameSource.fromElement(
        'disposed',
        new ScriptedVideoElement() as unknown as HTMLVideoElement
      );
      await source.dispose();

      await expect(source.getFrame(1)).rejects.toThrow('Source has been disposed');
    });

    it('does not seek when the request is within one frame of the current time', async () => {
      const element = new ScriptedVideoElement({ stallSeek: true });
      element.currentTime = 5;
      const source = HTMLVideoFrameSource.fromElement('near', element as unknown as HTMLVideoElement);

      // 0.01s away, under the half-frame (1/60s) fallback tolerance: no seek, so the stalled
      // seek never matters and the call resolves immediately.
      await expect(source.getFrame(5.01)).resolves.toBe(element);
      expect(element.currentTime).toBe(5);
    });

    it('gives up on a stalled seek after 500ms and returns the element anyway', async () => {
      vi.useFakeTimers();
      try {
        const element = new ScriptedVideoElement({ stallSeek: true });
        const source = HTMLVideoFrameSource.fromElement('stalled', element as unknown as HTMLVideoElement);

        const framePromise = source.getFrame(5);
        await vi.advanceTimersByTimeAsync(500);

        await expect(framePromise).resolves.toBe(element);
        expect(element.currentTime).toBe(elementSeekTarget(5));
        expect(element.removedListeners).toContain('seeked');
      } finally {
        vi.useRealTimers();
      }
    });

    it('waits for canplay when the seeked frame is not decoded yet', async () => {
      const element = new ScriptedVideoElement({ readyState: 1 });
      const source = HTMLVideoFrameSource.fromElement('cold', element as unknown as HTMLVideoElement);

      await expect(source.getFrame(5)).resolves.toBe(element);
      expect(element.removedListeners).toEqual(['seeked', 'canplay']);
    });

    it('stops waiting for canplay after 100ms', async () => {
      vi.useFakeTimers();
      try {
        const element = new ScriptedVideoElement({ readyState: 1, stallCanPlay: true });
        const source = HTMLVideoFrameSource.fromElement('cold', element as unknown as HTMLVideoElement);

        const framePromise = source.getFrame(5);
        await vi.advanceTimersByTimeAsync(100);

        await expect(framePromise).resolves.toBe(element);
      } finally {
        vi.useRealTimers();
      }
    });

    // ESCSUITE-305: Firefox's seek wedge on a Cues-less WebM. Every request sat
    // out the 500 ms seek fallback and the 100 ms readiness fallback and was
    // handed back an element with no frame in it — a black clip in the export.
    describe('a seek that never completes', () => {
      /** Firefox's wedge: no 'seeked', no 'canplay', `seeking` true, HAVE_METADATA. */
      const wedged = () =>
        new ScriptedVideoElement({ stallSeek: true, stallCanPlay: true, readyState: 1, seeking: true });

      /** Ask for the frame at `time`, sitting out every fallback the request waits on. */
      async function request(source: HTMLVideoFrameSource, time: number): Promise<unknown> {
        const pending = source.getFrame(time).then(
          (frame) => frame,
          (error: unknown) => error
        );
        await vi.advanceTimersByTimeAsync(600);
        return pending;
      }

      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('fails by name on the third consecutive wedged seek', async () => {
        const element = wedged();
        const source = HTMLVideoFrameSource.fromElement(
          'take-1',
          element as unknown as HTMLVideoElement,
          30,
          'recording_2026-10-17.webm'
        );

        expect(await request(source, 1)).toBe(element);
        expect(await request(source, 2)).toBe(element);
        const thrown = await request(source, 3);

        expect(thrown).toBeInstanceOf(SourceNotSeekableError);
        expect(thrown).toMatchObject({
          code: 'SOURCE_NOT_SEEKABLE',
          message:
            'This browser cannot read "recording_2026-10-17.webm" frame by frame (its seeks never completed). Re-save the recording in ESCAPECRAFT, or export in Chrome or Edge.',
        });
      });

      it('names the source by its id when it was given no name', async () => {
        const source = HTMLVideoFrameSource.fromElement('take-1', wedged() as unknown as HTMLVideoElement);

        await request(source, 1);
        await request(source, 2);

        expect(await request(source, 3)).toMatchObject({ message: expect.stringContaining('"take-1"') });
      });

      it('starts the count again after a seek that completes', async () => {
        const element = wedged();
        const source = HTMLVideoFrameSource.fromElement('take-1', element as unknown as HTMLVideoElement);

        await request(source, 1);
        await request(source, 2);
        // One seek lands: the element has its frame.
        element.options = {};
        element.seeking = false;
        element.readyState = 4;
        expect(await request(source, 3)).toBe(element);
        element.options = { stallSeek: true, stallCanPlay: true };
        element.seeking = true;
        element.readyState = 1;

        expect(await request(source, 4)).toBe(element);
        expect(await request(source, 5)).toBe(element);
      });

      // Review round 1, MINOR 3: a request for the time the element was last
      // seeked to issues no seek; if that seek never completed, the request
      // still counts — an incoming transition clip held at one time used to
      // reset the run on every frame and finish black.
      it('fails by name when the same time is asked for again over a seek that never completed', async () => {
        const element = wedged();
        const source = HTMLVideoFrameSource.fromElement('held', element as unknown as HTMLVideoElement, 30, 'incoming.webm');

        expect(await request(source, 1)).toBe(element);
        expect(await request(source, 1)).toBe(element);

        expect(await request(source, 1)).toMatchObject({ code: 'SOURCE_NOT_SEEKABLE', message: expect.stringContaining('"incoming.webm"') });
      });

      /**
       * A healthy element on a slow machine: every seek reports `seeking` with
       * no frame until it lands, 900 ms later — after the 500 ms seek fallback
       * and the 100 ms readiness wait (re-review round 1, F1).
       */
      class LateSeekVideo {
        readyState = 4;
        seeking = false;
        duration = 10;
        videoWidth = 1920;
        videoHeight = 1080;
        private time = 0;
        private readonly listeners = new Set<() => void>();
        get currentTime() {
          return this.time;
        }
        set currentTime(next: number) {
          this.time = next;
          this.seeking = true;
          this.readyState = 1;
          setTimeout(() => {
            this.seeking = false;
            this.readyState = 4;
            for (const listener of [...this.listeners]) listener();
          }, 900);
        }
        addEventListener(event: string, handler: () => void) {
          if (event === 'seeked') this.listeners.add(handler);
        }
        removeEventListener(event: string, handler: () => void) {
          this.listeners.delete(handler);
        }
        pause() {}
        load() {}
      }

      /** Ask for `time`, then let `idleMs` pass in all before the next request. */
      async function requestThenIdle(source: HTMLVideoFrameSource, time: number, idleMs: number): Promise<unknown> {
        const pending = source.getFrame(time).then(
          (frame) => frame,
          (error: unknown) => error
        );
        await vi.advanceTimersByTimeAsync(idleMs);
        return pending;
      }

      it('never refuses a source whose every seek lands late, between requests', async () => {
        const element = new LateSeekVideo();
        const source = HTMLVideoFrameSource.fromElement('slow', element as unknown as HTMLVideoElement);

        for (let t = 1; t <= 10; t++) expect(await requestThenIdle(source, t, 1_000)).toBe(element);
      });

      it('gives a request held at one time the same wait for a seek still in flight', async () => {
        const element = new LateSeekVideo();
        const source = HTMLVideoFrameSource.fromElement('held-slow', element as unknown as HTMLVideoElement);

        // One seek, whose waits run out with it still in flight; then the same
        // time asked for twice more at once — the transition's outgoing clip is
        // fetched twice a frame. Neither may be counted before the seek has had
        // the wait a seeking request gets; it lands at 900 ms, inside it.
        expect(await requestThenIdle(source, 1, 600)).toBe(element);
        const again = [source.getFrame(1), source.getFrame(1)].map((p) =>
          p.then(
            (frame) => frame,
            (error: unknown) => error
          )
        );
        await vi.advanceTimersByTimeAsync(600);

        const [first, second] = await Promise.all(again);
        expect(first).toBe(element);
        expect(second).toBe(element);
      });

      it('does not count a seek that runs slow but settles (`seeking` false)', async () => {
        const element = new ScriptedVideoElement({ stallSeek: true, stallCanPlay: true, readyState: 1 });
        const source = HTMLVideoFrameSource.fromElement('slow', element as unknown as HTMLVideoElement);

        for (let t = 1; t <= 5; t++) expect(await request(source, t)).toBe(element);
      });

      it('does not count a seek still in flight over a frame it can already draw', async () => {
        const element = new ScriptedVideoElement({ stallSeek: true, seeking: true });
        const source = HTMLVideoFrameSource.fromElement('drawable', element as unknown as HTMLVideoElement);

        for (let t = 1; t <= 5; t++) expect(await request(source, t)).toBe(element);
      });
    });

    it('reports the element dimensions, falling back to 1080p and zero duration', () => {
      const element = new ScriptedVideoElement();
      element.duration = 0;
      element.videoWidth = 0;
      element.videoHeight = 0;
      const source = HTMLVideoFrameSource.fromElement('blank', element as unknown as HTMLVideoElement);

      expect(source.getInfo()).toEqual({
        sourceId: 'blank',
        duration: 0,
        width: 1920,
        height: 1080,
      });
    });

    it('disposes by revoking object URL', async () => {
      const blob = new Blob(['test'], { type: 'video/mp4' });
      const source = await HTMLVideoFrameSource.create('test-source', blob);

      await source.dispose();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });

    it('detaches its handlers on dispose, before it empties src', async () => {
      // create() leaves onloadeddata and onerror attached for the element's
      // whole life, and dispose() empties `src` — which the platform answers
      // with an `error` event. Handing that back to a live handler is how
      // ESCAPECRAFT's thumbnailGenerator ended up spinning
      // error -> cleanup -> error for the life of the page (ESCSUITE-55). It
      // does not loop here, because this handler does not rewrite `src`; the
      // handlers come off anyway, so it cannot start to.
      let element!: MockHTMLVideoElement;
      videoFactory = () => (element = new MockHTMLVideoElement());
      const source = await HTMLVideoFrameSource.create(
        'test-source',
        new Blob(['test'], { type: 'video/mp4' })
      );

      await source.dispose();

      expect(element.lastOnError).toBeNull();
      expect(element.lastOnLoadedData).toBeNull();
    });
  });

  describe('FrameSourceFactory', () => {
    it('initializes with WebCodecs when supported', async () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);

      const factory = new FrameSourceFactory(true);
      expect(factory.isWebCodecsEnabled()).toBe(true);

      // Initialize should not throw
      await factory.initialize();
      // Factory should still be enabled after init
      expect(factory.isWebCodecsEnabled()).toBe(true);
    });

    // ESCSUITE-153 / ESCSUITE-29 Mechanism 2: a decode worker that fails to
    // start (missing from a standalone download, blocked by CSP, timed out)
    // must not fail or hang the whole export — it should degrade to the
    // <video>-element path, the same fallback createSource() already takes
    // per-source for an unsupported codec.
    it('falls back to the element path when the decode worker will not start', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);
      nextInitializeRejection.error = new Error('Decode worker did not become ready within 10000ms');

      const factory = new FrameSourceFactory(true);
      await factory.initialize();

      expect(factory.isWebCodecsEnabled()).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('falling back to HTMLVideoElement'),
        expect.any(Error)
      );

      // mp4 would normally take the WebCodecs branch; with the worker down it
      // must still produce a usable (HTMLVideoElement) source instead of
      // throwing or hanging.
      const source = await factory.createSource('mp4-source', new Blob(['x'], { type: 'video/mp4' }), 'video/mp4');
      expect(source.requiresCleanup()).toBe(false);

      warn.mockRestore();
    });

    it('initializing twice after the worker failed to start does not retry it', async () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);
      nextInitializeRejection.error = new Error('Decode worker did not become ready within 10000ms');
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const factory = new FrameSourceFactory(true);
      await factory.initialize();
      expect(factory.isWebCodecsEnabled()).toBe(false);

      // A second initialize() call must not try to stand the worker back up
      // mid-export; useWebCodecs is now false, same as "disabled explicitly".
      await factory.initialize();
      expect(factory.isWebCodecsEnabled()).toBe(false);
    });

    // ESCSUITE-254 fix round 1, B1: the worker is admitted only in an engine
    // whose output was measured against its own <video>; the decision is made
    // here, on the main thread, before any source is read into memory.
    it('never starts the worker in an engine whose worker decode was not measured', async () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);
      const factory = new FrameSourceFactory(true, { measuredEngine: false });
      await factory.initialize();
      const blob = new Blob(['x'], { type: 'video/mp4' });
      const read = vi.spyOn(blob, 'arrayBuffer');

      const source = await factory.createSource('a', blob, 'video/mp4');

      expect(factory.isWebCodecsEnabled()).toBe(false);
      expect((factory as unknown as { manager: unknown }).manager).toBeNull();
      expect(source.requiresCleanup()).toBe(false);
      expect(read).not.toHaveBeenCalled();
    });

    it('starts the worker in an engine whose worker decode was measured', async () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);
      const factory = new FrameSourceFactory(true, { measuredEngine: true });
      await factory.initialize();

      expect(factory.isWebCodecsEnabled()).toBe(true);
    });

    it('asks the engine predicate when the caller does not say', () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);
      engine.measured = false;
      expect(new FrameSourceFactory(true).isWebCodecsEnabled()).toBe(false);
      engine.measured = true;
      expect(new FrameSourceFactory(true).isWebCodecsEnabled()).toBe(true);
    });

    it('falls back when WebCodecs not supported', () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(false);

      const factory = new FrameSourceFactory(true);
      expect(factory.isWebCodecsEnabled()).toBe(false);
    });

    it('can be disabled explicitly', () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);

      const factory = new FrameSourceFactory(false);
      expect(factory.isWebCodecsEnabled()).toBe(false);
    });

    it('creates HTMLVideoElement source when WebCodecs disabled', async () => {
      const factory = new FrameSourceFactory(false);
      await factory.initialize();

      const blob = new Blob(['test'], { type: 'video/mp4' });
      const source = await factory.createSource('test-source', blob, 'video/mp4');

      // Should be HTMLVideoFrameSource, which doesn't require cleanup
      expect(source.requiresCleanup()).toBe(false);
    });

    it('creates source from existing element', () => {
      const factory = new FrameSourceFactory(false);
      const video = new MockHTMLVideoElement() as unknown as HTMLVideoElement;

      const source = factory.createFromElement('test-source', video);
      expect(source.getInfo().sourceId).toBe('test-source');
    });

    it('disposes manager on factory dispose', async () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);

      const factory = new FrameSourceFactory(true);
      await factory.initialize();

      // Dispose should not throw
      factory.dispose();

      // After dispose, factory should still report WebCodecs enabled (the setting doesn't change)
      // but the internal manager is null (tested implicitly by not throwing on double-dispose)
      factory.dispose(); // Should not throw on second call
    });

    it('uses WebCodecs for MP4 when it is enabled', async () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);

      const factory = new FrameSourceFactory(true);
      await factory.initialize();

      const source = await factory.createSource('mp4-source', new Blob(['x'], { type: 'video/mp4' }), 'video/mp4');

      expect(source.requiresCleanup()).toBe(true);
      expect(source.getInfo().codec).toBe('avc1.640028');
    });

    it('warns and falls back to HTMLVideoElement when WebCodecs cannot load the MP4', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);

      const factory = new FrameSourceFactory(true);
      await factory.initialize();
      const manager = (factory as unknown as { manager: { loadSource: ReturnType<typeof vi.fn> } }).manager;
      manager.loadSource.mockRejectedValueOnce(new Error('unsupported codec'));

      const source = await factory.createSource('mp4-source', new Blob(['x'], { type: 'video/mp4' }), 'video/mp4');

      expect(source.requiresCleanup()).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        'WebCodecs failed for mp4-source, falling back to HTMLVideoElement:',
        expect.any(Error)
      );
      warn.mockRestore();
    });

    // ESCSUITE-254: the decode worker threw on every source for nine months
    // and the only trace was this warning. A source that falls back is now
    // reported to the caller, so the export can tell the user it is
    // decoding in the page.
    describe('reporting a source that falls back to the <video> path', () => {
      type ManagerDouble = {
        loadSource: ReturnType<typeof vi.fn>;
        getFrame: ReturnType<typeof vi.fn>;
        disposeSource: ReturnType<typeof vi.fn>;
      };
      const managerOf = (factory: FrameSourceFactory) =>
        (factory as unknown as { manager: ManagerDouble }).manager;
      const mp4 = () => new Blob(['x'], { type: 'video/mp4' });

      async function factoryWithWorker() {
        (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);
        const factory = new FrameSourceFactory(true);
        await factory.initialize();
        return factory;
      }

      it('reports each source the worker refuses, with the reason', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const factory = await factoryWithWorker();
        managerOf(factory).loadSource.mockRejectedValue(new Error('Unsupported display matrix'));
        const onFallback = vi.fn();

        await factory.createSource('a', mp4(), 'video/mp4', undefined, onFallback);
        await factory.createSource('b', mp4(), 'video/mp4', undefined, onFallback);

        expect(onFallback.mock.calls).toEqual([
          ['a', 'Unsupported display matrix'],
          ['b', 'Unsupported display matrix'],
        ]);
        warn.mockRestore();
      });

      it('reports a refusal that was not an Error in its own words', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const factory = await factoryWithWorker();
        managerOf(factory).loadSource.mockRejectedValue('NotReadableError');
        const onFallback = vi.fn();

        await factory.createSource('a', mp4(), 'video/mp4', undefined, onFallback);

        expect(onFallback).toHaveBeenCalledWith('a', 'NotReadableError');
        warn.mockRestore();
      });

      it('falls back without complaint when nobody asked to be told', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const factory = await factoryWithWorker();
        const manager = managerOf(factory);
        manager.loadSource.mockRejectedValueOnce(new Error('refused'));

        const refused = await factory.createSource('a', mp4(), 'video/mp4');
        const later = await factory.createSource('b', mp4(), 'video/mp4');
        manager.getFrame.mockRejectedValue(new Error('stalled'));

        expect(refused.requiresCleanup()).toBe(false);
        await expect(later.getFrame(0.1)).resolves.toBeInstanceOf(MockHTMLVideoElement);
        warn.mockRestore();
      });

      it('keeps a source too large to hold in the worker on the <video> path, without reading it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const factory = await factoryWithWorker();
        const onFallback = vi.fn();
        const huge = mp4();
        Object.defineProperty(huge, 'size', { value: MAX_WORKER_SOURCE_BYTES + 1 });
        const read = vi.spyOn(huge, 'arrayBuffer');

        const source = await factory.createSource('a', huge, 'video/mp4', undefined, onFallback);

        expect(source.requiresCleanup()).toBe(false);
        expect(read).not.toHaveBeenCalled();
        expect(managerOf(factory).loadSource).not.toHaveBeenCalled();
        expect(onFallback).toHaveBeenCalledWith(
          'a',
          "This export's sources would hold more than the 512 MB the decode worker keeps in memory"
        );
        warn.mockRestore();
      });

      // Fix round 1, MD3: the budget is the export's, not each source's —
      // every source the worker takes is held until the export ends.
      it('refuses a source that would take the export past the budget, and takes one that fits', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const factory = await factoryWithWorker();
        const sized = (bytes: number) => {
          const blob = mp4();
          Object.defineProperty(blob, 'size', { value: bytes });
          return blob;
        };
        const onFallback = vi.fn();
        const third = MAX_WORKER_SOURCE_BYTES / 3;

        const first = await factory.createSource('a', sized(2 * third), 'video/mp4', undefined, onFallback);
        const second = await factory.createSource('b', sized(2 * third), 'video/mp4', undefined, onFallback);
        const third_ = await factory.createSource('c', sized(third), 'video/mp4', undefined, onFallback);

        expect([first, second, third_].map((source) => source.requiresCleanup())).toEqual([true, false, true]);
        expect(onFallback).toHaveBeenCalledWith(
          'b',
          "This export's sources would hold more than the 512 MB the decode worker keeps in memory"
        );
        warn.mockRestore();
      });

      it('hands a source of exactly the limit to the worker', async () => {
        const factory = await factoryWithWorker();
        const atLimit = mp4();
        Object.defineProperty(atLimit, 'size', { value: MAX_WORKER_SOURCE_BYTES });

        const source = await factory.createSource('a', atLimit, 'video/mp4', undefined, vi.fn());

        expect(source.requiresCleanup()).toBe(true);
        expect(managerOf(factory).loadSource).toHaveBeenCalled();
      });

      it('reports nothing when the worker takes the source', async () => {
        const factory = await factoryWithWorker();
        const onFallback = vi.fn();

        const source = await factory.createSource('a', mp4(), 'video/mp4', undefined, onFallback);
        await source.getFrame(0.5);

        expect(onFallback).not.toHaveBeenCalled();
      });

      it('hands a source over to the <video> path, once, when the worker fails a frame mid-export', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const factory = await factoryWithWorker();
        const manager = managerOf(factory);
        const onFallback = vi.fn();
        const source = await factory.createSource('a', mp4(), 'video/mp4', undefined, onFallback);
        await source.getFrame(0.1);
        manager.getFrame.mockRejectedValue(new Error('Decoder stalled: no output for 5000ms'));

        // Two requests in flight when it fails, and one after.
        const frames = await Promise.all([source.getFrame(0.2), source.getFrame(0.3)]);
        const later = await source.getFrame(0.4);

        expect(frames.every((frame) => frame instanceof MockHTMLVideoElement)).toBe(true);
        expect(later).toBeInstanceOf(MockHTMLVideoElement);
        expect(onFallback.mock.calls).toEqual([['a', 'Decoder stalled: no output for 5000ms']]);
        expect(manager.disposeSource).toHaveBeenCalledWith('a');
        expect(warn).toHaveBeenCalledWith(
          'WebCodecs failed for a mid-export, falling back to HTMLVideoElement:',
          expect.any(Error)
        );
        // The worker is not asked again once the source has been handed over.
        expect(manager.getFrame).toHaveBeenCalledTimes(3);
        // It still reports the worker's own description of the source.
        expect(source.getInfo().codec).toBe('avc1.640028');
        expect(source.requiresCleanup()).toBe(true);

        await source.dispose();
        warn.mockRestore();
      });

      // Fix round 1, MD2: when the <video> the source was handed to cannot
      // load either, the clip is skipped (the frame request rejects, as the
      // oracle's would) and disposing the source does not throw — a finished
      // export must not turn into a failure at cleanup.
      // ESCSUITE-305: the <video> a source was handed to is the last path there
      // is. When its seeks wedge, the export fails by name — the handover must
      // not swallow the refusal and serve a black clip.
      it('lets a wedged <video> fail the export after a mid-export handover', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers();
        try {
          const factory = await factoryWithWorker();
          const pendingSource = factory.createSource('a', mp4(), 'video/mp4', undefined, vi.fn(), 30, 'take.webm');
          await vi.advanceTimersByTimeAsync(0);
          const source = await pendingSource;
          managerOf(factory).getFrame.mockRejectedValue(new Error('Decoder stalled'));
          videoFactory = () =>
            new ScriptedVideoElement({ stallSeek: true, stallCanPlay: true, readyState: 1, seeking: true });

          const outcomes: unknown[] = [];
          for (let t = 1; t <= 3; t++) {
            const pending = source.getFrame(t).then(
              () => 'frame',
              (error: unknown) => error
            );
            await vi.advanceTimersByTimeAsync(600);
            outcomes.push(await pending);
          }

          expect(outcomes.slice(0, 2)).toEqual(['frame', 'frame']);
          expect(outcomes[2]).toBeInstanceOf(SourceNotSeekableError);
          expect(outcomes[2]).toMatchObject({ message: expect.stringContaining('"take.webm"') });
        } finally {
          vi.useRealTimers();
          warn.mockRestore();
        }
      });

      it('disposes cleanly after a handover whose <video> never loaded', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const factory = await factoryWithWorker();
        const source = await factory.createSource('a', mp4(), 'video/mp4', undefined, vi.fn());
        managerOf(factory).getFrame.mockRejectedValue(new Error('Decoder stalled'));
        videoFactory = () => new ScriptedVideoElement({ failLoad: true });

        await expect(source.getFrame(0.2)).rejects.toThrow('Failed to load video');
        await expect(source.dispose()).resolves.toBeUndefined();

        expect(managerOf(factory).disposeSource).toHaveBeenCalledWith('a');
        expect(warn).toHaveBeenCalledWith('The <video> fallback for a never loaded:', expect.any(Error));
        warn.mockRestore();
      });

      // Fix round 1, MINOR 7: the <video> is asked for the very time the
      // worker failed on, so the source resumes where it stopped.
      it('asks the <video> it hands over to for the failing request\'s own time', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const factory = await factoryWithWorker();
        const source = await factory.createSource('a', mp4(), 'video/mp4', undefined, vi.fn());
        managerOf(factory).getFrame.mockRejectedValue(new Error('Decoder stalled'));
        const created: MockHTMLVideoElement[] = [];
        videoFactory = () => {
          const element = new MockHTMLVideoElement();
          created.push(element);
          return element;
        };

        const frame = await source.getFrame(0.25);

        expect(frame).toBe(created[0]);
        expect(created[0].currentTime).toBe(elementSeekTarget(0.25));
        await source.dispose();
        warn.mockRestore();
      });

      it('disposes a source that never needed the <video> path without creating one', async () => {
        const factory = await factoryWithWorker();
        const source = await factory.createSource('a', mp4(), 'video/mp4', undefined, vi.fn());
        const created = vi.mocked(document.createElement).mock.calls.filter(([tag]) => tag === 'video').length;

        await source.dispose();

        expect(managerOf(factory).disposeSource).toHaveBeenCalledWith('a');
        expect(vi.mocked(document.createElement).mock.calls.filter(([tag]) => tag === 'video')).toHaveLength(created);
      });
    });

    // ESCSUITE-266: a worker the browser kills outright may fire no `error`
    // at all, and the stall bound inside it dies with it. Behind the REAL
    // decode manager (this file mocks it everywhere else), a worker that
    // takes the sources and then never answers a frame request must still
    // hand each source to <video> — at the manager's 15 s deadline, every
    // source at once — instead of leaving the export waiting forever.
    describe('a worker that stops answering without an error (ESCSUITE-266)', () => {
      /** Answers INIT_SOURCE, then never answers a frame and never fires `error`. */
      class SilentDecodeWorker {
        static last: SilentDecodeWorker | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        onmessageerror: ((event: MessageEvent) => void) | null = null;
        terminated = false;

        constructor() {
          SilentDecodeWorker.last = this;
          setTimeout(() => this.reply({ type: 'WORKER_READY' }), 0);
        }

        postMessage(request: { type: string; sourceId: string }) {
          if (request.type !== 'INIT_SOURCE') return;
          const info = { sourceId: request.sourceId, duration: 10, width: 1920, height: 1080, codec: 'avc1.640028', frameCount: 300, keyframeCount: 10 };
          this.reply({ type: 'SOURCE_READY', sourceId: request.sourceId, info });
        }

        terminate() {
          this.terminated = true;
        }

        private reply(data: unknown) {
          this.onmessage?.(new MessageEvent('message', { data }));
        }
      }

      // Restored by hand, not with vi.unstubAllGlobals(), which would drop
      // this file's own URL and VideoFrame stubs too (ESCSUITE-119).
      const saved = { Worker: globalThis.Worker, VideoDecoder: globalThis.VideoDecoder, URL: globalThis.URL };

      beforeEach(() => {
        const stubbedURL = saved.URL;
        // The real manager builds its worker from `new URL(...)`, which this
        // file's object-literal URL stub cannot construct.
        class ConstructibleURL {
          static createObjectURL = stubbedURL.createObjectURL;
          static revokeObjectURL = stubbedURL.revokeObjectURL;
          constructor(readonly href: string) {}
        }
        globalThis.URL = ConstructibleURL as unknown as typeof URL;
        globalThis.Worker = SilentDecodeWorker as unknown as typeof Worker;
        globalThis.VideoDecoder = class {} as unknown as typeof VideoDecoder;
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
        globalThis.URL = saved.URL;
        globalThis.Worker = saved.Worker;
        globalThis.VideoDecoder = saved.VideoDecoder;
        SilentDecodeWorker.last = null;
      });

      it('hands every waiting source to <video> at the 15 s deadline, each reported once with the reason', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { VideoDecodeManager: RealManager } =
          await vi.importActual<typeof import('./videoDecodeManager')>('./videoDecodeManager');
        const manager = new RealManager();
        const ready = manager.initialize();
        await vi.advanceTimersByTimeAsync(0);
        await ready;
        (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);
        const factory = new FrameSourceFactory(true);
        (factory as unknown as { manager: unknown }).manager = manager;
        const onFallback = vi.fn();
        const mp4 = () => new Blob(['x'], { type: 'video/mp4' });
        const a = await factory.createSource('a', mp4(), 'video/mp4', undefined, onFallback);
        const b = await factory.createSource('b', mp4(), 'video/mp4', undefined, onFallback);

        const frames: Record<string, unknown> = { a: 'pending', b: 'pending' };
        void a.getFrame(0.5).then((frame) => { frames.a = frame; });
        await vi.advanceTimersByTimeAsync(5_000);
        void b.getFrame(0.5).then((frame) => { frames.b = frame; });

        await vi.advanceTimersByTimeAsync(9_999);
        expect(frames).toEqual({ a: 'pending', b: 'pending' });
        expect(onFallback).not.toHaveBeenCalled();

        // A's deadline: A falls back, and B with it, 10 s short of its own.
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(10);

        expect(frames.a).toBeInstanceOf(MockHTMLVideoElement);
        expect(frames.b).toBeInstanceOf(MockHTMLVideoElement);
        expect(onFallback.mock.calls).toEqual([
          ['a', 'Decode worker did not answer within 15 s for a'],
          ['b', 'Decode worker did not answer within 15 s for a'],
        ]);
        expect(SilentDecodeWorker.last!.terminated).toBe(true);
        // Later frames come from <video> without asking the dead worker again.
        const later = a.getFrame(1);
        await vi.advanceTimersByTimeAsync(10);
        await expect(later).resolves.toBeInstanceOf(MockHTMLVideoElement);
        expect(onFallback).toHaveBeenCalledTimes(2);

        const disposed = Promise.all([a.dispose(), b.dispose()]);
        await vi.advanceTimersByTimeAsync(50);
        await disposed;
        factory.dispose();
        warn.mockRestore();
      });
    });

    it('uses HTMLVideoElement for non-MP4 formats', async () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);

      const factory = new FrameSourceFactory(true);
      await factory.initialize();

      const blob = new Blob(['test'], { type: 'video/webm' });
      const source = await factory.createSource('test-source', blob, 'video/webm');

      // Should fall back to HTMLVideoElement for WebM
      expect(source.requiresCleanup()).toBe(false);
    });
  });

  describe('isWebCodecsAvailable', () => {
    it('returns VideoDecodeManager.isSupported result', () => {
      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(true);
      expect(isWebCodecsAvailable()).toBe(true);

      (VideoDecodeManager as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported.mockReturnValue(false);
      expect(isWebCodecsAvailable()).toBe(false);
    });
  });

  describe('IFrameSource interface', () => {
    it('both implementations satisfy the interface', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const sources: IFrameSource[] = [];

      // WebCodecs source
      const webCodecsSource = await WebCodecsFrameSource.create(
        manager,
        'wc-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );
      sources.push(webCodecsSource);

      // HTMLVideoElement source
      const blob = new Blob(['test'], { type: 'video/mp4' });
      const htmlSource = await HTMLVideoFrameSource.create('html-source', blob);
      sources.push(htmlSource);

      // All sources should implement the same interface
      for (const source of sources) {
        expect(typeof source.getFrame).toBe('function');
        expect(typeof source.getInfo).toBe('function');
        expect(typeof source.requiresCleanup).toBe('function');
        expect(typeof source.dispose).toBe('function');
      }

      // Cleanup
      for (const source of sources) {
        await source.dispose();
      }
    });
  });
});
