/**
 * Video Decode Manager
 *
 * Provides a high-level API for decoding video frames using WebCodecs
 * in a Web Worker context. This enables full-speed decoding even when
 * the browser tab is in the background.
 *
 * Usage:
 *   const manager = new VideoDecodeManager();
 *   await manager.initialize();
 *
 *   const info = await manager.loadSource('source1', videoArrayBuffer, 'video/mp4');
 *   const frame = await manager.getFrame('source1', 1.5); // Get frame at 1.5 seconds
 *
 *   // When done with frame
 *   frame.close();
 *
 *   // When done with source
 *   await manager.disposeSource('source1');
 *
 *   // When done with manager
 *   manager.terminate();
 */

import type {
  DecodeWorkerRequest,
  DecodeWorkerResponse,
  VideoSourceInfo,
  SourceReadyResponse,
  FrameReadyResponse,
  ProgressResponse,
  ErrorResponse,
} from '../workers/decodeWorker.types';

/**
 * Progress callback for source loading
 */
export type ProgressCallback = (
  phase: 'demuxing' | 'indexing' | 'ready',
  progress: number
) => void;

/**
 * Error callback for async errors
 */
export type ErrorCallback = (error: string, fatal: boolean) => void;

/**
 * Pending frame request
 */
interface PendingRequest {
  resolve: (frame: VideoFrame) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Manages video decoding using a Web Worker with WebCodecs
 */
export class VideoDecodeManager {
  private worker: Worker | null = null;
  private isReady = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  // Request tracking
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();

  // Source loading promises
  private sourceLoadPromises = new Map<
    string,
    {
      resolve: (info: VideoSourceInfo) => void;
      reject: (error: Error) => void;
    }
  >();

  // Callbacks
  private progressCallbacks = new Map<string, ProgressCallback>();
  private errorCallback: ErrorCallback | null = null;

  /**
   * Create a new VideoDecodeManager
   */
  constructor() {
    // Don't auto-initialize; call initialize() explicitly
  }

  /**
   * Check if WebCodecs VideoDecoder is available
   */
  static isSupported(): boolean {
    return typeof VideoDecoder !== 'undefined' && typeof Worker !== 'undefined';
  }

  /**
   * Initialize the decode worker
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      return this.readyPromise || Promise.resolve();
    }

    if (!VideoDecodeManager.isSupported()) {
      throw new Error('WebCodecs VideoDecoder is not supported in this browser');
    }

    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    // Create worker from module
    // Note: The worker URL will be resolved by Vite's worker import
    this.worker = new Worker(
      new URL('../workers/decodeWorker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event: MessageEvent<DecodeWorkerResponse | { type: 'WORKER_READY' }>) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('Decode worker error:', error);
      if (this.errorCallback) {
        this.errorCallback(`Worker error: ${error.message}`, true);
      }
    };

    return this.readyPromise;
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(
    message: DecodeWorkerResponse | { type: 'WORKER_READY' }
  ): void {
    switch (message.type) {
      case 'WORKER_READY':
        this.isReady = true;
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
        }
        break;

      case 'SOURCE_READY': {
        const response = message as SourceReadyResponse;
        const loadPromise = this.sourceLoadPromises.get(response.sourceId);
        if (loadPromise) {
          loadPromise.resolve(response.info);
          this.sourceLoadPromises.delete(response.sourceId);
        }
        break;
      }

      case 'FRAME_READY': {
        const response = message as FrameReadyResponse;
        const pending = this.pendingRequests.get(response.requestId);
        if (pending) {
          pending.resolve(response.frame);
          this.pendingRequests.delete(response.requestId);
        }
        break;
      }

      case 'PROGRESS': {
        const response = message as ProgressResponse;
        const callback = this.progressCallbacks.get(response.sourceId);
        if (callback) {
          callback(response.phase, response.progress);
        }
        break;
      }

      case 'ERROR': {
        const response = message as ErrorResponse;
        this.handleError(response);
        break;
      }

      case 'STATUS':
        // Status responses are handled by specific queries
        break;
    }
  }

  /**
   * Handle error responses from the worker
   */
  private handleError(error: ErrorResponse): void {
    // Check if there's a pending request for this error
    if (error.requestId !== undefined) {
      const pending = this.pendingRequests.get(error.requestId);
      if (pending) {
        pending.reject(new Error(error.error));
        this.pendingRequests.delete(error.requestId);
        return;
      }
    }

    // Check if there's a source load promise for this error
    if (error.sourceId) {
      const loadPromise = this.sourceLoadPromises.get(error.sourceId);
      if (loadPromise) {
        loadPromise.reject(new Error(error.error));
        this.sourceLoadPromises.delete(error.sourceId);
        return;
      }
    }

    // General error - call error callback
    if (this.errorCallback) {
      this.errorCallback(error.error, error.fatal);
    }
  }

  /**
   * Post a request to the worker
   */
  private postRequest(request: DecodeWorkerRequest): void {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    if (request.type === 'INIT_SOURCE') {
      // Transfer the ArrayBuffer for zero-copy
      this.worker.postMessage(request, [request.data]);
    } else {
      this.worker.postMessage(request);
    }
  }

  /**
   * Set the error callback for async errors
   */
  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  /**
   * Load a video source for decoding
   *
   * @param sourceId - Unique identifier for this source
   * @param data - Video file data as ArrayBuffer
   * @param mimeType - MIME type of the video (e.g., 'video/mp4')
   * @param onProgress - Optional progress callback
   * @returns Promise resolving to source info when ready
   */
  async loadSource(
    sourceId: string,
    data: ArrayBuffer,
    mimeType: string,
    onProgress?: ProgressCallback
  ): Promise<VideoSourceInfo> {
    await this.initialize();

    if (onProgress) {
      this.progressCallbacks.set(sourceId, onProgress);
    }

    return new Promise((resolve, reject) => {
      this.sourceLoadPromises.set(sourceId, { resolve, reject });

      this.postRequest({
        type: 'INIT_SOURCE',
        sourceId,
        data,
        mimeType,
      });
    });
  }

  /**
   * Get a decoded frame at a specific timestamp
   *
   * @param sourceId - Source to get frame from
   * @param timestamp - Timestamp in seconds
   * @returns Promise resolving to VideoFrame (caller must call .close() when done)
   */
  async getFrame(sourceId: string, timestamp: number): Promise<VideoFrame> {
    if (!this.isReady) {
      throw new Error('Manager not initialized');
    }

    const requestId = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject, timestamp });

      this.postRequest({
        type: 'REQUEST_FRAME',
        sourceId,
        timestamp,
        requestId,
      });
    });
  }

  /**
   * Get multiple frames in sequence
   * More efficient than calling getFrame multiple times
   *
   * @param sourceId - Source to get frames from
   * @param timestamps - Array of timestamps in seconds
   * @returns AsyncGenerator yielding VideoFrame objects
   */
  async *getFrames(
    sourceId: string,
    timestamps: number[]
  ): AsyncGenerator<VideoFrame, void, unknown> {
    for (const timestamp of timestamps) {
      yield await this.getFrame(sourceId, timestamp);
    }
  }

  /**
   * Release a frame from the cache
   * Call this when you're done with a frame to free memory
   *
   * @param sourceId - Source the frame belongs to
   * @param timestamp - Timestamp of the frame to release
   */
  releaseFrame(sourceId: string, timestamp: number): void {
    if (!this.worker) return;

    this.postRequest({
      type: 'RELEASE_FRAME',
      sourceId,
      timestamp,
    });
  }

  /**
   * Flush pending decode operations for a source
   *
   * @param sourceId - Source to flush
   */
  async flush(sourceId: string): Promise<void> {
    if (!this.worker) return;

    this.postRequest({
      type: 'FLUSH',
      sourceId,
    });

    // Wait a bit for flush to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Dispose of a video source and free all resources
   *
   * @param sourceId - Source to dispose
   */
  async disposeSource(sourceId: string): Promise<void> {
    if (!this.worker) return;

    // Remove callbacks
    this.progressCallbacks.delete(sourceId);

    // Cancel pending requests for this source
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      // We don't track sourceId on pending requests, so just cancel all
      // This is a simplification; in production you might want to track sourceId
      if (pending.timestamp !== undefined) {
        pending.reject(new Error('Source disposed'));
        this.pendingRequests.delete(requestId);
      }
    }

    this.postRequest({
      type: 'DISPOSE_SOURCE',
      sourceId,
    });

    // Wait a bit for cleanup to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Terminate the worker and free all resources
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.isReady = false;
    this.readyPromise = null;
    this.readyResolve = null;

    // Reject all pending requests
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Manager terminated'));
    }
    this.pendingRequests.clear();

    // Reject all pending source loads
    for (const loadPromise of this.sourceLoadPromises.values()) {
      loadPromise.reject(new Error('Manager terminated'));
    }
    this.sourceLoadPromises.clear();

    this.progressCallbacks.clear();
  }

  /**
   * Check if the manager is ready
   */
  get ready(): boolean {
    return this.isReady;
  }
}

// Export a singleton instance for convenience
let defaultManager: VideoDecodeManager | null = null;

/**
 * Get the default VideoDecodeManager instance
 */
export function getVideoDecodeManager(): VideoDecodeManager {
  if (!defaultManager) {
    defaultManager = new VideoDecodeManager();
  }
  return defaultManager;
}

/**
 * Reset the default manager (for testing)
 */
export function resetVideoDecodeManager(): void {
  if (defaultManager) {
    defaultManager.terminate();
    defaultManager = null;
  }
}
