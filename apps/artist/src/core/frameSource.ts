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
   * Release a frame when done with it (for cleanup)
   * @param frame The frame to release
   */
  releaseFrame(frame: DrawableFrame): void;

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

  releaseFrame(frame: DrawableFrame): void {
    if (frame instanceof VideoFrame) {
      frame.close();
    }
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
 * HTMLVideoElement-based frame source
 * Fallback for unsupported formats or when WebCodecs is not available
 */
export class HTMLVideoFrameSource implements IFrameSource {
  private video: HTMLVideoElement;
  private sourceId: string;
  private objectUrl: string | null = null;
  private disposed = false;

  private constructor(video: HTMLVideoElement, sourceId: string, objectUrl: string | null) {
    this.video = video;
    this.sourceId = sourceId;
    this.objectUrl = objectUrl;
  }

  /**
   * Create an HTMLVideoElement frame source from a Blob
   */
  static async create(
    sourceId: string,
    blob: Blob,
    _onProgress?: LoadProgressCallback
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

    return new HTMLVideoFrameSource(video, sourceId, url);
  }

  /**
   * Create from an existing HTMLVideoElement (for compatibility)
   */
  static fromElement(sourceId: string, video: HTMLVideoElement): HTMLVideoFrameSource {
    return new HTMLVideoFrameSource(video, sourceId, null);
  }

  async getFrame(timestamp: number): Promise<HTMLVideoElement> {
    if (this.disposed) {
      throw new Error('Source has been disposed');
    }

    const video = this.video;

    // Check if we need to seek
    const currentTime = video.currentTime;
    const diff = timestamp - currentTime;

    // Only seek if necessary (more than one frame away)
    const frameDuration = 1 / 30; // Assume 30fps
    if (Math.abs(diff) > frameDuration) {
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

  releaseFrame(_frame: DrawableFrame): void {
    // HTMLVideoElement doesn't need manual cleanup
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
 * Factory for creating frame sources
 * Automatically selects WebCodecs or HTMLVideoElement based on support
 */
export class FrameSourceFactory {
  private manager: VideoDecodeManager | null = null;
  private useWebCodecs: boolean;

  constructor(useWebCodecs: boolean = true) {
    this.useWebCodecs = useWebCodecs && VideoDecodeManager.isSupported();
  }

  /**
   * Check if WebCodecs mode is enabled
   */
  isWebCodecsEnabled(): boolean {
    return this.useWebCodecs;
  }

  /**
   * Initialize the factory (creates VideoDecodeManager if using WebCodecs)
   */
  async initialize(): Promise<void> {
    if (this.useWebCodecs && !this.manager) {
      this.manager = new VideoDecodeManager();
      await this.manager.initialize();
    }
  }

  /**
   * Create a frame source from video data
   *
   * @param sourceId Unique identifier for this source
   * @param blob Video blob
   * @param mimeType MIME type (e.g., 'video/mp4')
   * @param onProgress Optional progress callback
   * @returns A frame source (WebCodecs or HTMLVideoElement based)
   */
  async createSource(
    sourceId: string,
    blob: Blob,
    mimeType: string,
    onProgress?: LoadProgressCallback
  ): Promise<IFrameSource> {
    // Use WebCodecs for MP4 files when supported
    if (this.useWebCodecs && this.manager && mimeType.includes('mp4')) {
      try {
        const data = await blob.arrayBuffer();
        return await WebCodecsFrameSource.create(
          this.manager,
          sourceId,
          data,
          mimeType,
          onProgress
        );
      } catch (error) {
        // Fall back to HTMLVideoElement on error
        console.warn(
          `WebCodecs failed for ${sourceId}, falling back to HTMLVideoElement:`,
          error
        );
      }
    }

    // Fall back to HTMLVideoElement
    return HTMLVideoFrameSource.create(sourceId, blob, onProgress);
  }

  /**
   * Create a frame source from an existing HTMLVideoElement
   * (for compatibility with existing code during transition)
   */
  createFromElement(sourceId: string, video: HTMLVideoElement): IFrameSource {
    return HTMLVideoFrameSource.fromElement(sourceId, video);
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
