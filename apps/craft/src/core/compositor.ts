// Canvas-based compositor for Picture-in-Picture mode
// Combines screen capture with webcam overlay

import type { WebcamPosition, WebcamShape } from '../store/types';
import { drawWatermark, type WatermarkConfig } from './watermark';

export interface CompositorConfig {
  webcamPosition: WebcamPosition;
  webcamSize: number; // 0.1 to 0.4 (percentage of screen width)
  webcamShape: WebcamShape;
  padding: number; // Padding from edges in pixels
  watermark?: WatermarkConfig | null; // Optional watermark config
}

export class Compositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private screenVideo: HTMLVideoElement | null = null;
  private webcamVideo: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private config: CompositorConfig;
  private outputStream: MediaStream | null = null;

  constructor(width: number, height: number, config: Partial<CompositorConfig> = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;

    this.config = {
      webcamPosition: config.webcamPosition || 'bottom-right',
      webcamSize: config.webcamSize || 0.2,
      webcamShape: config.webcamShape || 'circle',
      padding: config.padding || 20,
      watermark: config.watermark || null,
    };
  }

  /**
   * Set the screen capture stream.
   */
  setScreenStream(stream: MediaStream): void {
    if (this.screenVideo) {
      this.screenVideo.srcObject = null;
      this.screenVideo.remove();
    }

    this.screenVideo = document.createElement('video');
    this.screenVideo.srcObject = stream;
    this.screenVideo.muted = true;
    // IMPORTANT: Attach to DOM to force browser to decode frames
    // Browsers optimize away frame decoding for non-visible elements
    this.screenVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(this.screenVideo);
    this.screenVideo.play();
  }

  /**
   * Set the webcam stream.
   */
  setWebcamStream(stream: MediaStream | null): void {
    if (this.webcamVideo) {
      this.webcamVideo.srcObject = null;
      this.webcamVideo.remove();
      this.webcamVideo = null;
    }

    if (stream) {
      this.webcamVideo = document.createElement('video');
      this.webcamVideo.srcObject = stream;
      this.webcamVideo.muted = true;
      // IMPORTANT: Attach to DOM to force browser to decode frames
      this.webcamVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;';
      document.body.appendChild(this.webcamVideo);
      this.webcamVideo.play();
    }
  }

  /**
   * Update compositor configuration.
   */
  updateConfig(config: Partial<CompositorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Start compositing and return the output stream.
   */
  start(frameRate: number = 30): MediaStream {
    this.outputStream = this.canvas.captureStream(frameRate);
    this.render();
    return this.outputStream;
  }

  /**
   * Stop compositing.
   */
  stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.screenVideo) {
      this.screenVideo.srcObject = null;
      this.screenVideo.remove(); // Remove from DOM
      this.screenVideo = null;
    }

    if (this.webcamVideo) {
      this.webcamVideo.srcObject = null;
      this.webcamVideo.remove(); // Remove from DOM
      this.webcamVideo = null;
    }

    this.outputStream = null;
  }

  /**
   * Get the canvas element for preview.
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Render a single frame.
   */
  private render = (): void => {
    this.drawFrame();
    this.animationFrameId = requestAnimationFrame(this.render);
  };

  /**
   * Draw a single frame to the canvas.
   */
  private drawFrame(): void {
    const { width, height } = this.canvas;

    // Clear canvas
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, width, height);

    // Draw screen capture
    if (this.screenVideo && this.screenVideo.readyState >= 2) {
      this.ctx.drawImage(this.screenVideo, 0, 0, width, height);
    }

    // Draw webcam overlay
    if (this.webcamVideo && this.webcamVideo.readyState >= 2) {
      this.drawWebcamOverlay();
    }

    // Draw watermark if configured
    if (this.config.watermark) {
      drawWatermark(this.ctx, width, height, this.config.watermark);
    }
  }

  /**
   * Draw the webcam overlay with the configured position, size, and shape.
   */
  private drawWebcamOverlay(): void {
    if (!this.webcamVideo) return;

    const { width, height } = this.canvas;
    const { webcamPosition, webcamSize, webcamShape, padding } = this.config;

    // Calculate webcam dimensions
    const webcamWidth = width * webcamSize;
    const webcamHeight = (webcamWidth * 9) / 16; // 16:9 aspect ratio

    // Calculate position
    let x: number, y: number;

    switch (webcamPosition) {
      case 'top-left':
        x = padding;
        y = padding;
        break;
      case 'top-right':
        x = width - webcamWidth - padding;
        y = padding;
        break;
      case 'bottom-left':
        x = padding;
        y = height - webcamHeight - padding;
        break;
      case 'bottom-right':
      default:
        x = width - webcamWidth - padding;
        y = height - webcamHeight - padding;
        break;
    }

    // Save context state
    this.ctx.save();

    if (webcamShape === 'circle') {
      // Draw circular webcam overlay
      const radius = Math.min(webcamWidth, webcamHeight) / 2;
      const centerX = x + webcamWidth / 2;
      const centerY = y + webcamHeight / 2;

      // Create circular clip path
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      this.ctx.closePath();
      this.ctx.clip();

      // Draw webcam video (centered and cropped to circle)
      const videoAspect = this.webcamVideo.videoWidth / this.webcamVideo.videoHeight;
      let srcWidth = this.webcamVideo.videoWidth;
      let srcHeight = this.webcamVideo.videoHeight;
      let srcX = 0;
      let srcY = 0;

      // Center crop to square for circle
      if (videoAspect > 1) {
        srcWidth = srcHeight;
        srcX = (this.webcamVideo.videoWidth - srcWidth) / 2;
      } else {
        srcHeight = srcWidth;
        srcY = (this.webcamVideo.videoHeight - srcHeight) / 2;
      }

      this.ctx.drawImage(
        this.webcamVideo,
        srcX,
        srcY,
        srcWidth,
        srcHeight,
        centerX - radius,
        centerY - radius,
        radius * 2,
        radius * 2
      );

      // Draw border
      this.ctx.restore();
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    } else {
      // Draw rectangular webcam overlay
      // Create rounded rectangle clip path
      const borderRadius = 8;
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, webcamWidth, webcamHeight, borderRadius);
      this.ctx.closePath();
      this.ctx.clip();

      // Draw webcam video
      this.ctx.drawImage(this.webcamVideo, x, y, webcamWidth, webcamHeight);

      // Draw border
      this.ctx.restore();
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, webcamWidth, webcamHeight, borderRadius);
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.stop();
  }
}
