import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VideoDecodeManager,
  getVideoDecodeManager,
  resetVideoDecodeManager,
} from './videoDecodeManager';
import type {
  DecodeWorkerResponse,
  VideoSourceInfo,
} from '../workers/decodeWorker.types';

// Mock Worker class
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private messageHandler: ((data: unknown) => void) | null = null;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    // Simulate worker ready after a tick
    setTimeout(() => {
      this.simulateMessage({ type: 'WORKER_READY' });
    }, 0);
  }

  postMessage(data: unknown, _transfer?: Transferable[]) {
    if (this.messageHandler) {
      this.messageHandler(data);
    }
  }

  terminate() {
    this.onmessage = null;
    this.onerror = null;
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
  beforeEach(() => {
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
    vi.unstubAllGlobals();
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
});
