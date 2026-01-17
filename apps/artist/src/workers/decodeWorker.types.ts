/**
 * Type definitions for the video decode worker message protocol.
 *
 * This worker handles video decoding using WebCodecs VideoDecoder,
 * enabling full-speed exports even in background browser tabs.
 */

/**
 * Video source metadata returned after initialization
 */
export interface VideoSourceInfo {
  sourceId: string;
  duration: number;
  width: number;
  height: number;
  codec: string;
  frameCount: number;
  keyframeCount: number;
}

/**
 * Request to initialize a video source for decoding
 */
export interface InitSourceRequest {
  type: 'INIT_SOURCE';
  sourceId: string;
  data: ArrayBuffer;
  mimeType: string;
}

/**
 * Request to decode a frame at a specific timestamp
 */
export interface RequestFrameRequest {
  type: 'REQUEST_FRAME';
  sourceId: string;
  timestamp: number; // in seconds
  requestId: number;
}

/**
 * Request to release a frame (allow garbage collection)
 */
export interface ReleaseFrameRequest {
  type: 'RELEASE_FRAME';
  sourceId: string;
  timestamp: number;
}

/**
 * Request to dispose of a video source and free resources
 */
export interface DisposeSourceRequest {
  type: 'DISPOSE_SOURCE';
  sourceId: string;
}

/**
 * Request to flush all pending decode operations
 */
export interface FlushRequest {
  type: 'FLUSH';
  sourceId: string;
}

/**
 * Request to get the current status of the decoder
 */
export interface GetStatusRequest {
  type: 'GET_STATUS';
}

/**
 * All possible worker request types
 */
export type DecodeWorkerRequest =
  | InitSourceRequest
  | RequestFrameRequest
  | ReleaseFrameRequest
  | DisposeSourceRequest
  | FlushRequest
  | GetStatusRequest;

/**
 * Response when a source is ready for decoding
 */
export interface SourceReadyResponse {
  type: 'SOURCE_READY';
  sourceId: string;
  info: VideoSourceInfo;
}

/**
 * Response when a frame is decoded and ready
 * The frame is transferred (not copied) for zero-copy performance
 */
export interface FrameReadyResponse {
  type: 'FRAME_READY';
  requestId: number;
  sourceId: string;
  timestamp: number;
  frame: VideoFrame;
}

/**
 * Response when the decoder status is requested
 */
export interface StatusResponse {
  type: 'STATUS';
  activeSources: string[];
  cachedFrameCount: number;
  memoryUsage: number;
}

/**
 * Response for progress updates during initialization
 */
export interface ProgressResponse {
  type: 'PROGRESS';
  sourceId: string;
  phase: 'demuxing' | 'indexing' | 'ready';
  progress: number; // 0-100
}

/**
 * Response for errors
 */
export interface ErrorResponse {
  type: 'ERROR';
  requestId?: number;
  sourceId?: string;
  error: string;
  fatal: boolean;
}

/**
 * All possible worker response types
 */
export type DecodeWorkerResponse =
  | SourceReadyResponse
  | FrameReadyResponse
  | StatusResponse
  | ProgressResponse
  | ErrorResponse;

/**
 * Configuration for the decode worker
 */
export interface DecodeWorkerConfig {
  /** Maximum number of frames to cache per source */
  maxCachedFramesPerSource: number;
  /** Number of frames to decode ahead of current request */
  lookAheadFrames: number;
  /** Whether to enable hardware acceleration hints */
  preferHardwareAcceleration: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_DECODE_WORKER_CONFIG: DecodeWorkerConfig = {
  maxCachedFramesPerSource: 60, // ~2 seconds at 30fps
  lookAheadFrames: 10,
  preferHardwareAcceleration: true,
};
