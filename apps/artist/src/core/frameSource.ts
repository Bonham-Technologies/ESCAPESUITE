/**
 * Frame Source Abstraction
 *
 * Provides a unified interface for getting video frames, supporting both:
 * 1. WebCodecs VideoDecoder (for background-capable exports)
 * 2. HTMLVideoElement (fallback for unsupported formats/browsers)
 *
 * This abstraction allows the exporter to work with either implementation
 * transparently, enabling full-speed exports in background tabs when
 * WebCodecs is available.
 */

import { VideoDecodeManager } from './videoDecodeManager';
import { isMeasuredWorkerDecodeEngine } from './workerDecodeEngine';
import type { VideoSourceInfo } from '../workers/decodeWorker.types';

/**
 * A drawable frame that can be used with canvas drawImage
 */
export type DrawableFrame = VideoFrame | HTMLVideoElement | HTMLImageElement;

/**
 * Information about a loaded video source
 */
export interface SourceInfo {
  sourceId: string;
  duration: number;
  width: number;
  height: number;
  codec?: string;
  frameCount?: number;
}

/**
 * Progress callback for source loading
 */
export type LoadProgressCallback = (phase: string, progress: number) => void;

/**
 * Called when a source the WebCodecs worker was asked to decode ends up on
 * the HTMLVideoElement path instead — refused when it was loaded, or given up
 * on mid-export — with the worker's reason. The export uses it to say it is
 * decoding in the page (ESCSUITE-254).
 */
export type FallbackCallback = (sourceId: string, reason: string) => void;

/**
 * The most source bytes one export hands to the decode worker, summed over
 * its sources. The worker holds every encoded sample of every source it takes
 * until the export ends (mp4box copies them out of the file, which is read
 * into memory first), where the `<video>` path streams from the Blob. While a
 * source is being demuxed the worker briefly holds it twice — the file and the
 * copies — so the peak is up to the budget plus the largest source again.
 * A source that would take the export past it keeps the `<video>` path, and
 * the export says so (ESCSUITE-254). 512 MB: a few minutes of 1080p phone
 * video, on a renderer the operator's lower-spec customers share with the
 * page; a judgement, not a measurement.
 */
export const MAX_WORKER_SOURCE_BYTES = 512 * 1024 * 1024;

/** The words of whatever a decode failure was rejected with. */
function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Abstract frame source interface
 */
export interface IFrameSource {
  /**
   * Get a drawable frame at the specified timestamp
   * @param timestamp Time in seconds
   * @returns A drawable frame (VideoFrame, HTMLVideoElement, or HTMLImageElement)
   */
  getFrame(timestamp: number): Promise<DrawableFrame>;

  /**
   * Get information about the source
   */
  getInfo(): SourceInfo;

  /**
   * Check if this source requires manual frame cleanup
   * (VideoFrame needs to be closed, HTMLVideoElement does not)
   */
  requiresCleanup(): boolean;

  /**
   * Dispose of the source and free resources
   */
  dispose(): Promise<void>;
}

/**
 * WebCodecs-based frame source using VideoDecodeManager
 * Enables full-speed decoding in background tabs
 */
export class WebCodecsFrameSource implements IFrameSource {
  private manager: VideoDecodeManager;
  private sourceId: string;
  private info: VideoSourceInfo;
  private disposed = false;

  private constructor(
    manager: VideoDecodeManager,
    sourceId: string,
    info: VideoSourceInfo
  ) {
    this.manager = manager;
    this.sourceId = sourceId;
    this.info = info;
  }

  /**
   * Create a WebCodecs frame source from video data
   */
  static async create(
    manager: VideoDecodeManager,
    sourceId: string,
    data: ArrayBuffer,
    mimeType: string,
    onProgress?: LoadProgressCallback
  ): Promise<WebCodecsFrameSource> {
    const info = await manager.loadSource(sourceId, data, mimeType, onProgress);
    return new WebCodecsFrameSource(manager, sourceId, info);
  }

  async getFrame(timestamp: number): Promise<VideoFrame> {
    if (this.disposed) {
      throw new Error('Source has been disposed');
    }
    return this.manager.getFrame(this.sourceId, timestamp);
  }

  getInfo(): SourceInfo {
    return {
      sourceId: this.info.sourceId,
      duration: this.info.duration,
      width: this.info.width,
      height: this.info.height,
      codec: this.info.codec,
      frameCount: this.info.frameCount,
    };
  }

  requiresCleanup(): boolean {
    return true;
  }

  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      await this.manager.disposeSource(this.sourceId);
    }
  }
}

/**
 * How far from the element's current time a request may be before the `<video>`
 * path seeks: half of one frame at the source's own rate, since anything closer
 * is the frame already showing and anything further is a different one
 * (ESCSUITE-263). The rate is floored at 30 because the export asks for frames
 * 1/30 s apart: below 15 fps a half-frame window would be wider than that spacing
 * and serve the previous frame across a boundary. A rate that is missing or not
 * finite and positive counts as 30 too — which is also what every stored
 * `SourceVideo.frameRate` is today (a placeholder; detecting the real one at
 * import is a follow-up).
 */
export function seekToleranceFor(frameRate: number | undefined): number {
  const rate = frameRate !== undefined && Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  return 0.5 / Math.max(rate, 30);
}

/**
 * HTMLVideoElement-based frame source
 * Fallback for unsupported formats or when WebCodecs is not available
 */
export class HTMLVideoFrameSource implements IFrameSource {
  private video: HTMLVideoElement;
  private seekTolerance: number;
  private sourceId: string;
  private objectUrl: string | null = null;
  private disposed = false;

  private constructor(
    video: HTMLVideoElement,
    sourceId: string,
    objectUrl: string | null,
    frameRate?: number
  ) {
    this.video = video;
    this.seekTolerance = seekToleranceFor(frameRate);
    this.sourceId = sourceId;
    this.objectUrl = objectUrl;
  }

  /**
   * Create an HTMLVideoElement frame source from a Blob
   */
  static async create(
    sourceId: string,
    blob: Blob,
    _onProgress?: LoadProgressCallback,
    frameRate?: number
  ): Promise<HTMLVideoFrameSource> {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.muted = true;

    const url = URL.createObjectURL(blob);

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load video'));
      };
      video.src = url;
    });

    return new HTMLVideoFrameSource(video, sourceId, url, frameRate);
  }

  /**
   * Create from an existing HTMLVideoElement (for compatibility)
   */
  static fromElement(
    sourceId: string,
    video: HTMLVideoElement,
    frameRate?: number
  ): HTMLVideoFrameSource {
    return new HTMLVideoFrameSource(video, sourceId, null, frameRate);
  }

  async getFrame(timestamp: number): Promise<HTMLVideoElement> {
    if (this.disposed) {
      throw new Error('Source has been disposed');
    }

    const video = this.video;

    // Check if we need to seek
    const currentTime = video.currentTime;
    const diff = timestamp - currentTime;

    // Only seek if necessary: a request within half a frame (at the source's own
    // rate) of the current time is the frame already showing.
    if (Math.abs(diff) > this.seekTolerance) {
      video.pause();
      video.currentTime = timestamp;

      // Wait for seek to complete
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          // Don't reject - just resolve with best effort
          resolve();
        }, 500);

        const onSeeked = () => {
          clearTimeout(timeout);
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };

        video.addEventListener('seeked', onSeeked);
      });

      // Ensure frame data is ready
      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          const onCanPlay = () => {
            video.removeEventListener('canplay', onCanPlay);
            resolve();
          };
          video.addEventListener('canplay', onCanPlay);

          // Timeout fallback
          setTimeout(resolve, 100);
        });
      }
    }

    return video;
  }

  getInfo(): SourceInfo {
    return {
      sourceId: this.sourceId,
      duration: this.video.duration || 0,
      width: this.video.videoWidth || 1920,
      height: this.video.videoHeight || 1080,
    };
  }

  requiresCleanup(): boolean {
    return false;
  }

  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.video.pause();
      // Detach BEFORE emptying src. `create()` above leaves onloadeddata and
      // onerror attached for the element's whole life, and the platform answers
      // an empty `src` with an `error` event — so leaving onerror attached here
      // hands that event back to a handler that revokes the object URL and
      // rejects a promise settled long ago. Both are no-ops today, but the same
      // shape in ESCAPECRAFT's thumbnailGenerator was an endless
      // error -> cleanup -> error loop because its handler rewrote `src`
      // (ESCSUITE-55). Nulling them is what keeps this site from being one edit
      // away from that.
      this.video.onloadeddata = null;
      this.video.onerror = null;
      this.video.src = '';
      this.video.load();

      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
    }
  }
}

/**
 * A WebCodecs source that hands itself over to the HTMLVideoElement path the
 * first time the decode worker cannot produce a frame — a decoder error, a
 * stall — instead of leaving that clip missing from every frame after it.
 *
 * The worker answers every request (it bounds its own waits), so a failure
 * arrives as a rejection here. Requests already in flight when it happens are
 * served by the same `<video>` source; the worker's copy is disposed.
 */
class FailoverFrameSource implements IFrameSource {
  private fallback: Promise<IFrameSource> | null = null;

  constructor(
    private readonly primary: IFrameSource,
    private readonly sourceId: string,
    private readonly createFallback: () => Promise<IFrameSource>,
    private readonly onFallback?: FallbackCallback
  ) {}

  async getFrame(timestamp: number): Promise<DrawableFrame> {
    if (!this.fallback) {
      try {
        return await this.primary.getFrame(timestamp);
      } catch (error) {
        this.handOver(error);
      }
    }
    return (await this.fallback!).getFrame(timestamp);
  }

  getInfo(): SourceInfo {
    return this.primary.getInfo();
  }

  requiresCleanup(): boolean {
    return true;
  }

  async dispose(): Promise<void> {
    await this.primary.dispose();
    if (!this.fallback) return;
    // A <video> that never loaded skipped this clip, as the oracle does; it
    // must not turn a finished export into a failed one at cleanup.
    let fallback: IFrameSource;
    try {
      fallback = await this.fallback;
    } catch (error) {
      console.warn(`The <video> fallback for ${this.sourceId} never loaded:`, error);
      return;
    }
    await fallback.dispose();
  }

  /** Switch to the `<video>` path, once, however many requests failed together. */
  private handOver(error: unknown): void {
    if (this.fallback) return;
    console.warn(
      `WebCodecs failed for ${this.sourceId} mid-export, falling back to HTMLVideoElement:`,
      error
    );
    this.onFallback?.(this.sourceId, failureReason(error));
    this.fallback = this.createFallback();
    void this.primary.dispose();
  }
}

export interface FrameSourceFactoryOptions {
  /** Whether the worker's output was measured against this engine's `<video>`; see `workerDecodeEngine.ts`. */
  measuredEngine?: boolean;
}

/**
 * Factory for creating frame sources
 * Automatically selects WebCodecs or HTMLVideoElement based on support
 */
export class FrameSourceFactory {
  private manager: VideoDecodeManager | null = null;
  private useWebCodecs: boolean;
  /** Source bytes handed to the worker so far; see MAX_WORKER_SOURCE_BYTES. */
  private workerBytes = 0;

  /**
   * `measuredEngine` says whether this engine's worker output was measured
   * against its own `<video>` (`workerDecodeEngine.ts`). When it was not, the
   * worker is never started and no source is read into memory for it: every
   * source takes the `<video>` path, and the MP4 export says so once
   * (ESCSUITE-254). Defaults to asking the running browser.
   */
  constructor(
    useWebCodecs: boolean = true,
    { measuredEngine = isMeasuredWorkerDecodeEngine(globalThis.navigator) }: FrameSourceFactoryOptions = {}
  ) {
    this.useWebCodecs = useWebCodecs && measuredEngine && VideoDecodeManager.isSupported();
  }

  /**
   * Check if WebCodecs mode is enabled
   */
  isWebCodecsEnabled(): boolean {
    return this.useWebCodecs;
  }

  /**
   * Initialize the factory (creates VideoDecodeManager if using WebCodecs)
   *
   * `signal`, when given, is forwarded to the decode manager so a cancelled
   * export does not have to wait out the manager's full startup timeout
   * (ESCSUITE-29 Mechanism 2).
   *
   * If the decode worker fails to start for any reason — missing from a
   * standalone download (ESCSUITE-153), blocked by CSP, timed out, or the
   * wait was aborted — this degrades to the HTMLVideoElement path instead of
   * throwing or hanging; createSource() already falls back per-source when
   * WebCodecs is unavailable, so a factory with useWebCodecs forced off here
   * takes exactly that path for every source.
   */
  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.useWebCodecs && !this.manager) {
      const manager = new VideoDecodeManager();
      try {
        await manager.initialize(signal);
        this.manager = manager;
      } catch (error) {
        console.warn(
          'WebCodecs decode worker failed to start, falling back to HTMLVideoElement:',
          error
        );
        manager.terminate();
        this.useWebCodecs = false;
      }
    }
  }

  /**
   * Create a frame source from video data
   *
   * @param sourceId Unique identifier for this source
   * @param blob Video blob
   * @param mimeType MIME type (e.g., 'video/mp4')
   * @param onProgress Optional progress callback
   * @param onFallback Told when a source decodes on the HTMLVideoElement path while
   *   the worker is running — an MP4 refused now or given up on mid-export, or
   *   a source that is not an MP4 at all (ESCSUITE-261)
   * @param frameRate The source's own frame rate, for the `<video>` path's seek tolerance
   * @returns A frame source (WebCodecs or HTMLVideoElement based)
   */
  async createSource(
    sourceId: string,
    blob: Blob,
    mimeType: string,
    onProgress?: LoadProgressCallback,
    onFallback?: FallbackCallback,
    frameRate?: number
  ): Promise<IFrameSource> {
    // Use WebCodecs for MP4 files when supported
    if (this.useWebCodecs && this.manager && mimeType.includes('mp4')) {
      try {
        if (this.workerBytes + blob.size > MAX_WORKER_SOURCE_BYTES) {
          throw new Error(
            `This export's sources would hold more than the ${MAX_WORKER_SOURCE_BYTES / 1024 / 1024} MB the decode worker keeps in memory`
          );
        }
        const data = await blob.arrayBuffer();
        const source = await WebCodecsFrameSource.create(
          this.manager,
          sourceId,
          data,
          mimeType,
          onProgress
        );
        this.workerBytes += blob.size;
        return new FailoverFrameSource(
          source,
          sourceId,
          () => HTMLVideoFrameSource.create(sourceId, blob, onProgress, frameRate),
          onFallback
        );
      } catch (error) {
        // Fall back to HTMLVideoElement on error — and say so: before
        // ESCSUITE-254 this warning was the only trace that every source
        // fell back.
        console.warn(
          `WebCodecs failed for ${sourceId}, falling back to HTMLVideoElement:`,
          error
        );
        onFallback?.(sourceId, failureReason(error));
      }
    } else if (this.useWebCodecs && this.manager) {
      // Running worker, non-MP4 source: never offered to the worker, so nothing
      // above reported it. A factory with no worker already told the export
      // once, at its own start (ESCSUITE-261).
      onFallback?.(sourceId, `${mimeType} sources decode in the page; only MP4 sources use the decode worker`);
    }

    // Fall back to HTMLVideoElement
    return HTMLVideoFrameSource.create(sourceId, blob, onProgress, frameRate);
  }

  /**
   * Create a frame source from an existing HTMLVideoElement
   * (for compatibility with existing code during transition)
   */
  createFromElement(sourceId: string, video: HTMLVideoElement, frameRate?: number): IFrameSource {
    return HTMLVideoFrameSource.fromElement(sourceId, video, frameRate);
  }

  /**
   * Dispose of the factory and all resources
   */
  dispose(): void {
    if (this.manager) {
      this.manager.terminate();
      this.manager = null;
    }
  }
}

/**
 * Check if WebCodecs frame source is available
 */
export function isWebCodecsAvailable(): boolean {
  return VideoDecodeManager.isSupported();
}
