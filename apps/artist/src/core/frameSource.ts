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
import { elementSeekTarget } from './elementSeek';
import { countWedgedSeek, wedgeCountAtStart } from './seekWedge';
import { loadVideoElementFromUrl } from './exportTypes';
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
   * @param slot Which live clip of this source the frame is for, this export
   *   frame — 0 for the first in track order, 1 for the next (ESCSUITE-313,
   *   `core/elementSlots.ts`). The `<video>` path serves each slot from its own
   *   element, so two clips of one source in one frame do not share a
   *   playhead; the decode worker answers each request on its own and ignores
   *   it. Defaults to 0.
   * @returns A drawable frame (VideoFrame, HTMLVideoElement, or HTMLImageElement),
   *   or `null` for a further slot whose element would not load — its clip is
   *   left out, said once rather than every frame
   */
  getFrame(timestamp: number, slot?: number): Promise<DrawableFrame | null>;

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
 * finite and positive counts as 30 too. An imported video's rate is measured
 * at import (ESCSUITE-276, `frameRateSource: 'measured'`); a rate the probe
 * could not measure, an ESCAPECRAFT take (`'configured'`) and every source
 * imported before then carry 30, so they get the 1/60 s window. The element
 * itself sits `ELEMENT_SEEK_BIAS` past the last request it was seeked for
 * (`elementSeek.ts`, ESCSUITE-265), far inside this window.
 */
export function seekToleranceFor(frameRate: number | undefined): number {
  const rate = frameRate !== undefined && Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  return 0.5 / Math.max(rate, 30);
}

/**
 * A muted, inline `<video>` over `url`, once its first frame has loaded.
 *
 * Rejects if the element will not load — an `error`, or nothing at all within
 * `waitForVideoLoad`'s 15 s deadline (ESCSUITE-325), which rejects with a
 * `MediaLoadTimeoutError` — without revoking `url`: the caller owns it, and a
 * source's further elements read the URL its first one still holds
 * (ESCSUITE-313). `name` is what the deadline's message calls the source.
 */
function loadSourceVideo(url: string, name: string): Promise<HTMLVideoElement> {
  return loadVideoElementFromUrl(url, name);
}

/** Pause a `<video>` from `loadSourceVideo`, take its handlers off and empty it. */
function releaseSourceVideo(video: HTMLVideoElement): void {
  video.pause();
  // Detach BEFORE emptying src. `waitForVideoLoad` takes its own handlers off
  // when the load settles (ESCSUITE-325), but the platform answers an empty
  // `src` with an `error` event, and a handler left on an element here would
  // be handed it back. The same shape in ESCAPECRAFT's thumbnailGenerator was
  // an endless error -> cleanup -> error loop because its handler rewrote `src`
  // (ESCSUITE-55). Nulling them is what keeps this site from being one edit
  // away from that.
  video.onloadeddata = null;
  video.onerror = null;
  video.src = '';
  video.load();
}

/**
 * HTMLVideoElement-based frame source
 * Fallback for unsupported formats or when WebCodecs is not available
 *
 * One element per *slot* (ESCSUITE-313): slot 0 is the element the source was
 * created with, and slot k a k-th element over the same object URL, made the
 * first time a request names it and kept until the source is disposed. A
 * source with one live clip is asked for slot 0 only, and costs one element,
 * as it always has.
 */
export class HTMLVideoFrameSource implements IFrameSource {
  private video: HTMLVideoElement;
  /**
   * Slot 1 onwards, each a load in flight or done; see the class comment. A
   * load that failed settles to `null`, so the slot is given up on once.
   */
  private extras: Promise<HTMLVideoElement | null>[] = [];
  private seekTolerance: number;
  private sourceId: string;
  /** What a refusal calls the source: its `SourceVideo.name`, or its id when given none. */
  readonly sourceName: string;
  private objectUrl: string | null = null;
  private disposed = false;
  /**
   * Consecutive seeks that wedged, per element (ESCSUITE-305, `seekWedge.ts`):
   * slot 0's and each further slot's (ESCSUITE-313) counted on their own.
   */
  private wedgedSeeks = new Map<HTMLVideoElement, number>();

  private constructor(
    video: HTMLVideoElement,
    sourceId: string,
    objectUrl: string | null,
    frameRate?: number,
    sourceName?: string
  ) {
    this.video = video;
    this.seekTolerance = seekToleranceFor(frameRate);
    this.sourceId = sourceId;
    this.sourceName = sourceName ?? sourceId;
    this.objectUrl = objectUrl;
  }

  /**
   * Create an HTMLVideoElement frame source from a Blob
   */
  static async create(
    sourceId: string,
    blob: Blob,
    _onProgress?: LoadProgressCallback,
    frameRate?: number,
    sourceName?: string
  ): Promise<HTMLVideoFrameSource> {
    const url = URL.createObjectURL(blob);

    let video: HTMLVideoElement;
    try {
      // Source name: the id is all this factory is handed (ESCSUITE-325).
      video = await loadSourceVideo(url, sourceId);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }

    return new HTMLVideoFrameSource(video, sourceId, url, frameRate, sourceName);
  }

  /**
   * Create from an existing HTMLVideoElement (for compatibility)
   */
  static fromElement(
    sourceId: string,
    video: HTMLVideoElement,
    frameRate?: number,
    sourceName?: string
  ): HTMLVideoFrameSource {
    return new HTMLVideoFrameSource(video, sourceId, null, frameRate, sourceName);
  }

  /**
   * A request whose seek never completes hands back an element with no frame
   * in it — a black clip. Three in a row on one element and the source is
   * refused by name, since this is the last path a frame can come from
   * (ESCSUITE-305). The run is counted per element: each slot (ESCSUITE-313)
   * has a playhead of its own.
   */
  async getFrame(timestamp: number, slot = 0): Promise<HTMLVideoElement | null> {
    if (this.disposed) {
      throw new Error('Source has been disposed');
    }

    const video = slot === 0 ? this.video : await this.elementFor(slot);
    if (!video) return null;

    // Check if we need to seek
    const currentTime = video.currentTime;
    const diff = timestamp - currentTime;
    let seekLanded = false;
    // An earlier seek that has landed since — however late — starts the count
    // again (ESCSUITE-305 re-review round 1).
    const wedgedAtStart = wedgeCountAtStart(this.wedgedSeeks.get(video) ?? 0, video);

    // Only seek if necessary: a request within half a frame (at the source's own
    // rate) of the current time is the frame already showing. A request that
    // needs no seek over an element still seeking from an earlier one gets the
    // same waits a seek does before it is counted, so a seek that is only slow
    // is not refused by the requests held at its time (an incoming transition
    // clip, or the outgoing one fetched twice a frame).
    const needsSeek = Math.abs(diff) > this.seekTolerance;
    if (needsSeek || video.seeking) {
      if (needsSeek) {
        video.pause();
        // Just past the requested time: a request on a frame's exact start would
        // otherwise show the frame before it a third of the time (ESCSUITE-265).
        video.currentTime = elementSeekTarget(timestamp);
      }

      // Wait for seek to complete
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          // Don't reject - just resolve with best effort; a run of these with
          // nothing to show for it is counted below.
          resolve();
        }, 500);

        const onSeeked = () => {
          clearTimeout(timeout);
          video.removeEventListener('seeked', onSeeked);
          seekLanded = true;
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

    // A request that seeks nothing still counts while an earlier seek is stuck:
    // an incoming transition clip asks for one time, frame after frame.
    this.wedgedSeeks.set(video, countWedgedSeek(wedgedAtStart, video, seekLanded, this.sourceName));
    return video;
  }

  /**
   * Slot `slot`'s element (slot 1 onwards), making any missing up to it. One
   * that will not load — an `error`, or silence past the 15 s deadline
   * (ESCSUITE-325) — is warned about once and settles to `null` for good.
   */
  private elementFor(slot: number): Promise<HTMLVideoElement | null> {
    while (this.extras.length < slot) {
      this.extras.push(
        loadSourceVideo(this.video.src, this.sourceId).catch(() => {
          console.warn(
            `Could not load a second element for video ${this.sourceId}; the clip it was for is left out`
          );
          return null;
        })
      );
    }
    return this.extras[slot - 1];
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
      releaseSourceVideo(this.video);
      // A slot whose element never loaded has nothing to release.
      for (const extra of await Promise.all(this.extras)) {
        if (extra) releaseSourceVideo(extra);
      }

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

  async getFrame(timestamp: number, slot?: number): Promise<DrawableFrame | null> {
    if (!this.fallback) {
      try {
        return await this.primary.getFrame(timestamp, slot);
      } catch (error) {
        this.handOver(error);
      }
    }
    return (await this.fallback!).getFrame(timestamp, slot);
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
   * @param sourceName The source's name, for the refusal a `<video>` whose seeks never
   *   complete fails the export with (ESCSUITE-305); its id when omitted
   * @returns A frame source (WebCodecs or HTMLVideoElement based)
   */
  async createSource(
    sourceId: string,
    blob: Blob,
    mimeType: string,
    onProgress?: LoadProgressCallback,
    onFallback?: FallbackCallback,
    frameRate?: number,
    sourceName?: string
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
          // The handover's <video> is the last path there is: a source whose
          // seeks wedge there fails the export by name (ESCSUITE-305), and
          // `getFrame` below lets that refusal through rather than retrying.
          () => HTMLVideoFrameSource.create(sourceId, blob, onProgress, frameRate, sourceName),
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
    return HTMLVideoFrameSource.create(sourceId, blob, onProgress, frameRate, sourceName);
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
