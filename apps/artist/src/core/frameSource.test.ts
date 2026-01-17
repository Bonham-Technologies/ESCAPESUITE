import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebCodecsFrameSource,
  HTMLVideoFrameSource,
  FrameSourceFactory,
  isWebCodecsAvailable,
  type IFrameSource,
} from './frameSource';

// Mock VideoDecodeManager - the factory must be self-contained
vi.mock('./videoDecodeManager', () => {
  // Define mock class inside factory to avoid hoisting issues
  const mockFn = vi.fn;

  class MockVideoDecodeManager {
    static isSupported = mockFn().mockReturnValue(true);

    initialize = mockFn().mockResolvedValue(undefined);
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

  set onloadeddata(handler: (() => void) | null) {
    if (handler) {
      setTimeout(() => handler(), 0);
    }
  }

  set onerror(_handler: (() => void) | null) {
    // Error handler - not used in tests
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

// Mock document.createElement for video elements
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
  if (tagName === 'video') {
    return new MockHTMLVideoElement() as unknown as HTMLVideoElement;
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

    it('releases frames by closing them', async () => {
      const manager = new VideoDecodeManager();
      await manager.initialize();

      const source = await WebCodecsFrameSource.create(
        manager,
        'test-source',
        new ArrayBuffer(1024),
        'video/mp4'
      );

      // Create a real instance of MockVideoFrame (which is stubbed as VideoFrame)
      const mockFrame = new MockVideoFrame() as unknown as VideoFrame;

      source.releaseFrame(mockFrame);
      expect(mockFrame.close).toHaveBeenCalled();
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

    it('disposes by revoking object URL', async () => {
      const blob = new Blob(['test'], { type: 'video/mp4' });
      const source = await HTMLVideoFrameSource.create('test-source', blob);

      await source.dispose();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
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
        expect(typeof source.releaseFrame).toBe('function');
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
