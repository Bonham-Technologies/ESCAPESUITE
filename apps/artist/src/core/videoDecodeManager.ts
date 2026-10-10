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
 * How long a frame request waits for the worker's answer before the worker is
 * presumed dead (ESCSUITE-266). A worker the browser kills outright — an
 * out-of-memory kill of a dedicated worker, say — is not guaranteed to fire
 * `error` on this thread, and the worker's own stall bound (5 s,
 * `workers/frameDecoder.ts`) dies with it, so without this an MP4 export
 * waited forever at the frame it was on. Fifteen seconds is generous, but the
 * two bounds answer different questions and can disagree: the worker's is per
 * stall (it resets on every decoder output and fires only after 5 s with no
 * progress at all), while this one is the request's total age. A live worker
 * still making progress on one request — a long keyframe gap on a slow
 * machine, a transition of a clip onto itself bouncing one decoder between two
 * positions — can pass 15 s, and is then treated as dead: every source falls
 * back to `<video>`, so the export finishes slower and in the page, but it
 * finishes. A deadline that resets on worker progress is ESCSUITE-272.
 */
export const FRAME_REQUEST_DEADLINE_MS = 15_000;

const MIB = 1024 * 1024;

/**
 * The fixed part of a source load's deadline (ESCSUITE-273). `exportMP4.ts`
 * awaits every source's load before its frame loop makes a single frame
 * request, so a worker killed mid-load — where its memory peaks, holding the
 * file and the samples it is copying out of it, and an out-of-memory kill is
 * likeliest — never reaches a FRAME_REQUEST_DEADLINE_MS and used to leave the
 * export waiting forever. Unlike a frame, a load's honest duration grows with
 * the file (mp4box parses all of it and copies out every sample), so its
 * deadline is this floor plus LOAD_DEADLINE_PER_MIB_MS per MiB: a 20 MiB
 * ESCAPECRAFT take gets 35 s, a 512 MiB source — the whole per-export budget,
 * `MAX_WORKER_SOURCE_BYTES` — 158 s. Both figures are generous judgements, not
 * measurements: a live demux runs at hundreds of MiB a second, so a load that
 * misses this is a worker that is gone, and the cost of a false positive is a
 * slower in-page export, not a hang.
 */
export const LOAD_DEADLINE_FLOOR_MS = 30_000;

/** What each MiB of a source adds to its load deadline; see LOAD_DEADLINE_FLOOR_MS. */
export const LOAD_DEADLINE_PER_MIB_MS = 250;

/** How long a load of `byteLength` bytes waits for SOURCE_READY (ESCSUITE-273). */
export function loadDeadlineMs(byteLength: number): number {
  return Math.round(LOAD_DEADLINE_FLOOR_MS + (byteLength / MIB) * LOAD_DEADLINE_PER_MIB_MS);
}

/** A count of MiB or seconds as the deadline's reason prints it: at most one decimal. */
function oneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * Pending frame request
 */
interface PendingRequest {
  resolve: (frame: VideoFrame) => void;
  reject: (error: Error) => void;
  timestamp: number;
  /** Whose request it is: a dispose rejects only its own source's (ESCSUITE-254). */
  sourceId: string;
  /** Its FRAME_REQUEST_DEADLINE_MS timer, cleared wherever the request settles (ESCSUITE-266). */
  deadline: ReturnType<typeof setTimeout>;
}

/**
 * Manages video decoding using a Web Worker with WebCodecs
 */
export class VideoDecodeManager {
  /**
   * How long initialize() waits for WORKER_READY before giving up
   * (ESCSUITE-153 / ESCSUITE-29 Mechanism 2). A worker that never starts —
   * missing from the bundle, blocked by CSP — used to leave initialize()'s
   * promise unsettled forever, hanging the MP4 export at "Loading media
   * files…" with no error and a Cancel button that could not free it.
   */
  private static readonly READY_TIMEOUT_MS = 10000;

  private worker: Worker | null = null;
  private isReady = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readyAbortCleanup: (() => void) | null = null;

  // Request tracking
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();

  // Source loading promises
  private sourceLoadPromises = new Map<
    string,
    {
      resolve: (info: VideoSourceInfo) => void;
      reject: (error: Error) => void;
      /** Its loadDeadlineMs() timer, cleared wherever the load settles (ESCSUITE-273). */
      deadline: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * Set when a load missed its deadline and terminated the worker, presumed
   * dead: every later load is refused with the same reason rather than
   * starting another worker, so the rest of the export's sources go straight
   * to `<video>` (ESCSUITE-273).
   */
  private loadDeadlineMissed: Error | null = null;

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
   * Clear whatever is waiting on the worker becoming ready — the timeout and
   * the abort listener, if either was set up — without settling the promise.
   * Called from every settle path so none of them can fire again afterward.
   */
  private clearReadyWait(): void {
    if (this.readyTimeoutId !== null) {
      clearTimeout(this.readyTimeoutId);
      this.readyTimeoutId = null;
    }
    if (this.readyAbortCleanup) {
      this.readyAbortCleanup();
      this.readyAbortCleanup = null;
    }
  }

  /**
   * Initialize the decode worker.
   *
   * Settles once: on WORKER_READY (resolve), on the worker's own `error` or
   * `messageerror` event (reject), after READY_TIMEOUT_MS of silence (reject),
   * or when `signal` aborts while the wait is still pending (reject) — so a
   * worker that fails to start, for any reason, never leaves a caller hanging
   * (ESCSUITE-153 / ESCSUITE-29 Mechanism 2).
   */
  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.worker) {
      return this.readyPromise || Promise.resolve();
    }

    if (!VideoDecodeManager.isSupported()) {
      throw new Error('WebCodecs VideoDecoder is not supported in this browser');
    }

    if (signal?.aborted) {
      throw new Error('Decode worker initialization was aborted');
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      // The timeout and the abort listener below call these two directly —
      // never through `this.readyReject?.()` — because clearReadyWait()
      // cancels both of them on every settle path, so neither can ever fire
      // a second time: there is no "already settled" case for them to guard
      // against. `this.readyResolve`/`this.readyReject` exist only for the
      // worker's `onerror`/`onmessageerror` handlers below, which are not
      // scoped to one wait and genuinely can fire after this promise has
      // already settled (an error after WORKER_READY, say) — that is where
      // the null-safe `?.` belongs.
      const settleResolve = () => {
        this.clearReadyWait();
        this.readyResolve = null;
        this.readyReject = null;
        resolve();
      };
      const settleReject = (error: Error) => {
        this.clearReadyWait();
        this.readyResolve = null;
        this.readyReject = null;
        reject(error);
      };

      this.readyResolve = settleResolve;
      this.readyReject = settleReject;

      this.readyTimeoutId = setTimeout(() => {
        settleReject(
          new Error(`Decode worker did not become ready within ${VideoDecodeManager.READY_TIMEOUT_MS}ms`)
        );
      }, VideoDecodeManager.READY_TIMEOUT_MS);

      if (signal) {
        const onAbort = () => {
          settleReject(new Error('Decode worker initialization was aborted'));
        };
        signal.addEventListener('abort', onAbort);
        this.readyAbortCleanup = () => signal.removeEventListener('abort', onAbort);
      }
    });

    // Create worker from module
    // Note: The worker URL will be resolved by Vite's worker import
    try {
      this.worker = new Worker(
        new URL('../workers/decodeWorker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (error) {
      // A synchronous construction failure (e.g. the file:// "SecurityError:
      // Failed to construct 'Worker'" case) leaves nothing listening for the
      // timeout or the abort signal, so clean both up directly here rather
      // than depending on a caller's terminate() to do it later.
      this.clearReadyWait();
      this.readyPromise = null;
      this.readyResolve = null;
      this.readyReject = null;
      throw error;
    }

    this.worker.onmessage = (event: MessageEvent<DecodeWorkerResponse | { type: 'WORKER_READY' }>) => {
      this.handleWorkerMessage(event.data);
    };

    // Before ready these reject the startup wait; after it, every frame
    // request and source load in flight — an answer lost to a dead worker or
    // an unreadable message is never coming, and an export must not wait for
    // it (ESCSUITE-254). A worker killed outright may fire neither; that is
    // what each frame request's FRAME_REQUEST_DEADLINE_MS (ESCSUITE-266) and
    // each source load's loadDeadlineMs() (ESCSUITE-273) are for.
    this.worker.onerror = (error) => {
      console.error('Decode worker error:', error);
      if (this.errorCallback) {
        this.errorCallback(`Worker error: ${error.message}`, true);
      }
      this.readyReject?.(new Error(`Decode worker failed to start: ${error.message || 'unknown error'}`));
      this.rejectInFlight(new Error(`Decode worker failed: ${error.message || 'unknown error'}`));
    };

    this.worker.onmessageerror = () => {
      console.error('Decode worker message error: received an unparseable message');
      this.readyReject?.(new Error('Decode worker failed to start: received an unparseable message'));
      this.rejectInFlight(new Error('Decode worker failed: received an unparseable message'));
    };

    return this.readyPromise;
  }

  /** Reject, and forget, every frame request and source load in flight. */
  private rejectInFlight(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.deadline);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    for (const loadPromise of this.sourceLoadPromises.values()) {
      clearTimeout(loadPromise.deadline);
      loadPromise.reject(error);
    }
    this.sourceLoadPromises.clear();
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(
    message: DecodeWorkerResponse | { type: 'WORKER_READY' }
  ): void {
    switch (message.type) {
      case 'WORKER_READY':
        // A WORKER_READY that arrives after the wait already settled (timed
        // out, errored, or was aborted) must not report ready — `readyResolve`
        // is only non-null while a wait is still live, so this is also the
        // guard against resolving (or marking ready) twice.
        if (this.readyResolve) {
          this.isReady = true;
          this.readyResolve();
        }
        break;

      case 'SOURCE_READY': {
        const response = message as SourceReadyResponse;
        const loadPromise = this.sourceLoadPromises.get(response.sourceId);
        if (loadPromise) {
          clearTimeout(loadPromise.deadline);
          loadPromise.resolve(response.info);
          this.sourceLoadPromises.delete(response.sourceId);
        }
        break;
      }

      case 'FRAME_READY': {
        const response = message as FrameReadyResponse;
        const pending = this.pendingRequests.get(response.requestId);
        if (pending) {
          clearTimeout(pending.deadline);
          pending.resolve(response.frame);
          this.pendingRequests.delete(response.requestId);
        } else {
          // Its request was already settled (its source disposed, say): the
          // frame was transferred to this thread and is nobody else's to close.
          response.frame.close();
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
        clearTimeout(pending.deadline);
        pending.reject(new Error(error.error));
        this.pendingRequests.delete(error.requestId);
        return;
      }
    }

    // Check if there's a source load promise for this error
    if (error.sourceId) {
      const loadPromise = this.sourceLoadPromises.get(error.sourceId);
      if (loadPromise) {
        clearTimeout(loadPromise.deadline);
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
   *
   * Rejects if the worker has not answered within loadDeadlineMs() of the
   * file's size, and terminates it, as a missed frame deadline does
   * (ESCSUITE-266): every other load and request in flight fails at once with
   * "Decode worker did not finish loading <sourceId> (<n> MiB) within <s> s",
   * and every later load is refused with the same reason instead of starting
   * another worker, so each source falls back to `<video>` (ESCSUITE-273).
   * `exportMP4.ts` awaits every load before its frame loop makes a single
   * frame request, so without this a worker killed mid-load hung the export.
   */
  async loadSource(
    sourceId: string,
    data: ArrayBuffer,
    mimeType: string,
    onProgress?: ProgressCallback
  ): Promise<VideoSourceInfo> {
    if (this.loadDeadlineMissed) {
      throw this.loadDeadlineMissed;
    }

    await this.initialize();

    if (onProgress) {
      this.progressCallbacks.set(sourceId, onProgress);
    }

    // Read before the post: transferring `data` to the worker detaches it here.
    const byteLength = data.byteLength;
    const deadlineMs = loadDeadlineMs(byteLength);

    return new Promise((resolve, reject) => {
      // Cleared on every settle, so it fires only for a load still in flight:
      // terminate() rejects that one along with everything else.
      const deadline = setTimeout(() => {
        this.loadDeadlineMissed = new Error(
          `Decode worker did not finish loading ${sourceId} (${oneDecimal(byteLength / MIB)} MiB) within ${oneDecimal(deadlineMs / 1000)} s`
        );
        this.terminate(this.loadDeadlineMissed);
      }, deadlineMs);
      this.sourceLoadPromises.set(sourceId, { resolve, reject, deadline });

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
   *
   * Rejects if the worker has not answered within FRAME_REQUEST_DEADLINE_MS,
   * and terminates it: a worker that missed one deadline is presumed dead, so
   * every other request and load in flight fails at once with the same reason
   * and each source falls back now, rather than after a deadline of its own
   * (ESCSUITE-266).
   */
  async getFrame(sourceId: string, timestamp: number): Promise<VideoFrame> {
    if (!this.isReady) {
      throw new Error('Manager not initialized');
    }

    const requestId = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      // Cleared on every settle, so it fires only for a request still in
      // flight: terminate() rejects that one along with everything else.
      const deadline = setTimeout(() => {
        this.terminate(
          new Error(`Decode worker did not answer within ${FRAME_REQUEST_DEADLINE_MS / 1000} s for ${sourceId}`)
        );
      }, FRAME_REQUEST_DEADLINE_MS);
      this.pendingRequests.set(requestId, { resolve, reject, timestamp, sourceId, deadline });

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

    // Cancel this source's pending requests — only this source's: a
    // mid-export handover disposes one source while the others' requests are
    // still in flight (ESCSUITE-254).
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      if (pending.sourceId === sourceId) {
        clearTimeout(pending.deadline);
        pending.reject(new Error('Source disposed'));
        this.pendingRequests.delete(requestId);
      }
    }

    // And its load, if it is still loading: its deadline must not terminate
    // a worker the other sources still use (ESCSUITE-273).
    const loadPromise = this.sourceLoadPromises.get(sourceId);
    if (loadPromise) {
      clearTimeout(loadPromise.deadline);
      loadPromise.reject(new Error('Source disposed'));
      this.sourceLoadPromises.delete(sourceId);
    }

    this.postRequest({
      type: 'DISPOSE_SOURCE',
      sourceId,
    });

    // Wait a bit for cleanup to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Terminate the worker and free all resources, rejecting everything still in
   * flight with `reason` — a missed frame or load deadline names itself here.
   */
  terminate(reason: Error = new Error('Manager terminated')): void {
    this.clearReadyWait();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.isReady = false;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;

    this.rejectInFlight(reason);

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
