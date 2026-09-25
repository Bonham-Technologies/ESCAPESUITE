// Canvas-based compositor for Picture-in-Picture mode
// Combines screen capture with webcam overlay

import type { WebcamPosition, WebcamShape } from '../store/types';

export interface CompositorConfig {
  webcamPosition: WebcamPosition;
  webcamSize: number; // 0.1 to 0.4 (percentage of screen width)
  webcamShape: WebcamShape;
  padding: number; // Padding from edges in pixels
}

export class Compositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private screenVideo: HTMLVideoElement | null = null;
  private webcamVideo: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private config: CompositorConfig;
  private outputStream: MediaStream | null = null;
  private targetFrameRate: number = 30;
  /** `performance.now()` at which the next composited frame is due. */
  private nextFrameDue: number = 0;
  /**
   * How early a tick may run a frame that is due on the next tick.
   *
   * `1000 / 30` is bit-for-bit `2 * (1000 / 60)`, so without a tolerance two
   * 60 Hz animation frames clear a 30 fps deadline with *zero* margin and any
   * dispatch jitter below the ideal pushes the draw out to a third frame
   * (50 ms instead of 33 ms). 4 ms absorbs that jitter and stays well under one
   * 60 Hz tick, so two consecutive *evenly spaced* ticks still cannot both draw
   * — under non-uniform jitter two adjacent ticks occasionally can, which is a
   * cadence wobble and not a rate breach: the deadline advances a full interval
   * per draw, so the mean rate can never exceed the target whatever the
   * spacing. Both ends of the 4 are red in `compositor.test.ts`; see
   * `apps/craft/CLAUDE.md`, "The PiP frame gate".
   */
  private static readonly FRAME_TOLERANCE_MS = 4;

  constructor(width: number, height: number, config: Partial<CompositorConfig> = {}) {
    this.canvas = document.createElement('canvas');
    // Cap compositor resolution to 720p — reduces draw cost by ~55% vs 1080p
    // MediaRecorder re-encodes anyway so full resolution isn't needed here
    const maxDim = 1280;
    if (width > maxDim) {
      const scale = maxDim / width;
      this.canvas.width = maxDim;
      this.canvas.height = Math.round(height * scale);
    } else {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;

    this.config = {
      webcamPosition: config.webcamPosition || 'bottom-right',
      webcamSize: config.webcamSize || 0.2,
      webcamShape: config.webcamShape || 'circle',
      // ?? not || — a zero padding is a real choice (overlay flush against the
      // canvas edge), whereas a zero webcam size is nonsense input.
      padding: config.padding ?? 20,
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
   * Start compositing and return the output stream.
   */
  start(frameRate: number = 30): MediaStream {
    this.beginRender(frameRate);
    this.outputStream = this.canvas.captureStream(frameRate);
    return this.outputStream;
  }

  /**
   * Start compositing for the preview alone — no `captureStream`.
   *
   * A separate-tracks take (ESCSUITE-14) records the raw screen and webcam
   * tracks, and the preview is already the canvas itself (`useMediaStreams`
   * appends it to the preview container). Capturing a stream nothing records
   * would sample the canvas 30 times a second for no reader.
   */
  startPreviewOnly(frameRate: number = 30): void {
    this.beginRender(frameRate);
  }

  /** The draw loop both entry points share. */
  private beginRender(frameRate: number): void {
    // A start() on a running compositor replaces its loop. Without this the
    // new chain's handle overwrote the old one's, so stop() cancelled only the
    // newer chain and the first kept drawing until the page went away
    // (ESCSUITE-58). Nothing calls start() twice today; this is the contract.
    // Only the loop is replaced: the previous captureStream() belongs to
    // whoever was handed it, and a canvas capture track is theirs to stop.
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.targetFrameRate = frameRate;
    // 0 is always in the past, so the first render draws immediately.
    this.nextFrameDue = 0;
    this.render();
  }

  /**
   * Stop compositing.
   */
  stop(): void {
    if (this.animationFrameId !== null) {
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
   * Get the output stream created by start().
   * Returns null if the compositor hasn't been started yet.
   */
  getOutputStream(): MediaStream | null {
    return this.outputStream;
  }

  /**
   * Render loop — throttled to target frame rate to save CPU.
   * No need to draw at 60fps when captureStream only captures at 30fps.
   *
   * The gate is a deadline with a tolerance, not an elapsed-time comparison
   * against the last draw. See FRAME_TOLERANCE_MS for why the elapsed-time
   * form held ~23 fps against a 30 fps target (ESCSUITE-54).
   */
  private render = (): void => {
    this.animationFrameId = requestAnimationFrame(this.render);

    const now = performance.now();
    if (now < this.nextFrameDue - Compositor.FRAME_TOLERANCE_MS) return;

    const frameInterval = 1000 / this.targetFrameRate;
    // Advance on the schedule, not from `now`, so jitter does not accumulate.
    // But a stall longer than a frame — a hidden tab, a GC pause — resyncs to
    // now rather than drawing a burst to pay back frames nobody will see.
    this.nextFrameDue =
      now - this.nextFrameDue > frameInterval ? now + frameInterval : this.nextFrameDue + frameInterval;

    this.drawFrame();
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

    // Save context state. Each branch below restores it again once the webcam
    // frame is drawn, so the border is stroked outside the clip path — that
    // restore is the only one, and the pair stays balanced. An extra restore()
    // on the way out is a no-op on a real canvas, but it is a stack operation
    // per frame for nothing and it would silently undo a save() made by any
    // future caller that wrapped this draw.
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
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.stop();
  }
}
