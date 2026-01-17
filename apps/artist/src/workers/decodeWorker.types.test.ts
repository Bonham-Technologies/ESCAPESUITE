import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DECODE_WORKER_CONFIG,
  type DecodeWorkerConfig,
  type DecodeWorkerRequest,
  type DecodeWorkerResponse,
  type InitSourceRequest,
  type RequestFrameRequest,
  type ReleaseFrameRequest,
  type DisposeSourceRequest,
  type FlushRequest,
  type GetStatusRequest,
  type SourceReadyResponse,
  type FrameReadyResponse,
  type StatusResponse,
  type ProgressResponse,
  type ErrorResponse,
  type VideoSourceInfo,
} from './decodeWorker.types';

describe('decodeWorker.types', () => {
  describe('DEFAULT_DECODE_WORKER_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_DECODE_WORKER_CONFIG.maxCachedFramesPerSource).toBe(60);
      expect(DEFAULT_DECODE_WORKER_CONFIG.lookAheadFrames).toBe(10);
      expect(DEFAULT_DECODE_WORKER_CONFIG.preferHardwareAcceleration).toBe(true);
    });

    it('can be used as a DecodeWorkerConfig', () => {
      const config: DecodeWorkerConfig = DEFAULT_DECODE_WORKER_CONFIG;
      expect(config).toBeDefined();
    });
  });

  describe('VideoSourceInfo', () => {
    it('accepts valid source info', () => {
      const info: VideoSourceInfo = {
        sourceId: 'test-source',
        duration: 10.5,
        width: 1920,
        height: 1080,
        codec: 'avc1.640028',
        frameCount: 315,
        keyframeCount: 10,
      };

      expect(info.sourceId).toBe('test-source');
      expect(info.duration).toBe(10.5);
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
      expect(info.codec).toBe('avc1.640028');
      expect(info.frameCount).toBe(315);
      expect(info.keyframeCount).toBe(10);
    });
  });

  describe('DecodeWorkerRequest types', () => {
    it('creates valid InitSourceRequest', () => {
      const request: InitSourceRequest = {
        type: 'INIT_SOURCE',
        sourceId: 'source1',
        data: new ArrayBuffer(1024),
        mimeType: 'video/mp4',
      };

      expect(request.type).toBe('INIT_SOURCE');
      expect(request.sourceId).toBe('source1');
      expect(request.data.byteLength).toBe(1024);
      expect(request.mimeType).toBe('video/mp4');
    });

    it('creates valid RequestFrameRequest', () => {
      const request: RequestFrameRequest = {
        type: 'REQUEST_FRAME',
        sourceId: 'source1',
        timestamp: 1.5,
        requestId: 42,
      };

      expect(request.type).toBe('REQUEST_FRAME');
      expect(request.timestamp).toBe(1.5);
      expect(request.requestId).toBe(42);
    });

    it('creates valid ReleaseFrameRequest', () => {
      const request: ReleaseFrameRequest = {
        type: 'RELEASE_FRAME',
        sourceId: 'source1',
        timestamp: 1.5,
      };

      expect(request.type).toBe('RELEASE_FRAME');
    });

    it('creates valid DisposeSourceRequest', () => {
      const request: DisposeSourceRequest = {
        type: 'DISPOSE_SOURCE',
        sourceId: 'source1',
      };

      expect(request.type).toBe('DISPOSE_SOURCE');
    });

    it('creates valid FlushRequest', () => {
      const request: FlushRequest = {
        type: 'FLUSH',
        sourceId: 'source1',
      };

      expect(request.type).toBe('FLUSH');
    });

    it('creates valid GetStatusRequest', () => {
      const request: GetStatusRequest = {
        type: 'GET_STATUS',
      };

      expect(request.type).toBe('GET_STATUS');
    });

    it('DecodeWorkerRequest union accepts all request types', () => {
      const requests: DecodeWorkerRequest[] = [
        { type: 'INIT_SOURCE', sourceId: 's1', data: new ArrayBuffer(0), mimeType: 'video/mp4' },
        { type: 'REQUEST_FRAME', sourceId: 's1', timestamp: 0, requestId: 1 },
        { type: 'RELEASE_FRAME', sourceId: 's1', timestamp: 0 },
        { type: 'DISPOSE_SOURCE', sourceId: 's1' },
        { type: 'FLUSH', sourceId: 's1' },
        { type: 'GET_STATUS' },
      ];

      expect(requests.length).toBe(6);
      expect(requests.map(r => r.type)).toEqual([
        'INIT_SOURCE',
        'REQUEST_FRAME',
        'RELEASE_FRAME',
        'DISPOSE_SOURCE',
        'FLUSH',
        'GET_STATUS',
      ]);
    });
  });

  describe('DecodeWorkerResponse types', () => {
    it('creates valid SourceReadyResponse', () => {
      const response: SourceReadyResponse = {
        type: 'SOURCE_READY',
        sourceId: 'source1',
        info: {
          sourceId: 'source1',
          duration: 10,
          width: 1920,
          height: 1080,
          codec: 'avc1',
          frameCount: 300,
          keyframeCount: 10,
        },
      };

      expect(response.type).toBe('SOURCE_READY');
      expect(response.info.frameCount).toBe(300);
    });

    it('creates valid FrameReadyResponse', () => {
      // Mock VideoFrame for testing
      const mockFrame = {} as VideoFrame;

      const response: FrameReadyResponse = {
        type: 'FRAME_READY',
        requestId: 42,
        sourceId: 'source1',
        timestamp: 1.5,
        frame: mockFrame,
      };

      expect(response.type).toBe('FRAME_READY');
      expect(response.requestId).toBe(42);
      expect(response.timestamp).toBe(1.5);
    });

    it('creates valid StatusResponse', () => {
      const response: StatusResponse = {
        type: 'STATUS',
        activeSources: ['source1', 'source2'],
        cachedFrameCount: 120,
        memoryUsage: 1024 * 1024 * 100,
      };

      expect(response.type).toBe('STATUS');
      expect(response.activeSources).toHaveLength(2);
      expect(response.cachedFrameCount).toBe(120);
    });

    it('creates valid ProgressResponse', () => {
      const response: ProgressResponse = {
        type: 'PROGRESS',
        sourceId: 'source1',
        phase: 'demuxing',
        progress: 50,
      };

      expect(response.type).toBe('PROGRESS');
      expect(response.phase).toBe('demuxing');
      expect(response.progress).toBe(50);
    });

    it('creates valid ErrorResponse', () => {
      const response: ErrorResponse = {
        type: 'ERROR',
        error: 'Something went wrong',
        fatal: true,
        sourceId: 'source1',
        requestId: 42,
      };

      expect(response.type).toBe('ERROR');
      expect(response.error).toBe('Something went wrong');
      expect(response.fatal).toBe(true);
    });

    it('ErrorResponse allows optional fields', () => {
      const response: ErrorResponse = {
        type: 'ERROR',
        error: 'General error',
        fatal: false,
      };

      expect(response.sourceId).toBeUndefined();
      expect(response.requestId).toBeUndefined();
    });

    it('DecodeWorkerResponse union accepts all response types', () => {
      const mockFrame = {} as VideoFrame;
      const responses: DecodeWorkerResponse[] = [
        {
          type: 'SOURCE_READY',
          sourceId: 's1',
          info: {
            sourceId: 's1',
            duration: 10,
            width: 1920,
            height: 1080,
            codec: 'avc1',
            frameCount: 300,
            keyframeCount: 10,
          },
        },
        {
          type: 'FRAME_READY',
          requestId: 1,
          sourceId: 's1',
          timestamp: 0,
          frame: mockFrame,
        },
        {
          type: 'STATUS',
          activeSources: [],
          cachedFrameCount: 0,
          memoryUsage: 0,
        },
        {
          type: 'PROGRESS',
          sourceId: 's1',
          phase: 'ready',
          progress: 100,
        },
        {
          type: 'ERROR',
          error: 'test',
          fatal: false,
        },
      ];

      expect(responses.length).toBe(5);
      expect(responses.map(r => r.type)).toEqual([
        'SOURCE_READY',
        'FRAME_READY',
        'STATUS',
        'PROGRESS',
        'ERROR',
      ]);
    });
  });

  describe('ProgressResponse phases', () => {
    it('accepts demuxing phase', () => {
      const response: ProgressResponse = {
        type: 'PROGRESS',
        sourceId: 's1',
        phase: 'demuxing',
        progress: 25,
      };
      expect(response.phase).toBe('demuxing');
    });

    it('accepts indexing phase', () => {
      const response: ProgressResponse = {
        type: 'PROGRESS',
        sourceId: 's1',
        phase: 'indexing',
        progress: 75,
      };
      expect(response.phase).toBe('indexing');
    });

    it('accepts ready phase', () => {
      const response: ProgressResponse = {
        type: 'PROGRESS',
        sourceId: 's1',
        phase: 'ready',
        progress: 100,
      };
      expect(response.phase).toBe('ready');
    });
  });
});
