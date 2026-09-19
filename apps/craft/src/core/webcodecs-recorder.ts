/**
 * WebCodecs-based recorder that produces proper WebM containers.
 * Uses VideoEncoder + AudioEncoder with Mediabunny for real-time muxing.
 * This produces WebM files that work in all players including Windows Media Player.
 */

import {
  Output,
  BufferTarget,
  WebMOutputFormat,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from 'mediabunny';
import type { RecordingConfig, AudioLevels } from '../store/types';

export interface WebCodecsRecorderCallbacks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: (blob: Blob) => void;
  onError?: (error: Error) => void;
  onAudioLevels?: (levels: AudioLevels) => void;
}

/**
 * Check if WebCodecs recording is supported
 */
export function isWebCodecsRecordingSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

// Type for MediaStreamTrackProcessor (not yet in TypeScript lib)
interface MediaStreamTrackProcessor {
  readable: ReadableStream<VideoFrame>;
}
interface MediaStreamTrackProcessorConstructor {
  new (options: { track: MediaStreamTrack }): MediaStreamTrackProcessor;
}
declare const MediaStreamTrackProcessor: MediaStreamTrackProcessorConstructor | undefined;

/**
 * An analyser and the byte buffer its FFT is copied into. The buffer's size is
 * `frequencyBinCount`, which never changes, so it is allocated once when the
 * analyser is wired up and refilled in place for the rest of the take — rather
 * than a fresh Uint8Array per sample, per source, thrown away immediately.
 */
interface LevelMeter {
  analyser: AnalyserNode;
  // Uint8Array<ArrayBuffer>, not the default Uint8Array<ArrayBufferLike>:
  // getByteFrequencyData() will not write into a view that might be backed by
  // a SharedArrayBuffer.
  data: Uint8Array<ArrayBuffer>;
}

/**
 * How often the level meters are pushed to the UI. ~12.5 Hz: fast enough that
 * a meter looks live, slow enough that it costs nothing — each sample is a
 * store write, and in ESCAPECRAFT a store write re-renders the app. Mirrors
 * `Recorder`'s gate in recorder.ts; the two are held to the same rate by
 * `recorder.perf.test.ts` and `webcodecsRecorder.perf.test.ts`.
 */
const AUDIO_LEVEL_INTERVAL_MS = 80;

export class WebCodecsRecorder {
  private callbacks: WebCodecsRecorderCallbacks = {};
  private videoTrack: MediaStreamTrack | null = null;
  private audioContext: AudioContext | null = null;
  private micMeter: LevelMeter | null = null;
  private systemMeter: LevelMeter | null = null;
  private animationFrameId: number | null = null;

  // Encoding state
  private videoEncoder: VideoEncoder | null = null;
  private audioEncoder: AudioEncoder | null = null;
  private output: Output | null = null;
  private target: BufferTarget | null = null;
  private videoSource: EncodedVideoPacketSource | null = null;
  private audioSource: EncodedAudioPacketSource | null = null;

  // Recording state
  private isRecordingActive = false;
  // Distinguishes "never started" from "already finished": isRecordingActive is
  // false in both, but only the first means the capture died during the
  // countdown. Never reset — a WebCodecsRecorder records one take.
  private hasStarted = false;
  private isPausedState = false;
  // All three are `performance.now()` milliseconds — the one monotonic clock
  // getDuration() and the frame timestamps (nextFrameTiming) both read, so the
  // duration shown and the length muxed come from the same source. They are
  // not identical: the controller reads getDuration() after stop() has flushed
  // and finalised, a little past the last frame — see apps/craft/CLAUDE.md.
  private startTime = 0;
  private pausedDuration = 0;
  private pauseStartTime = 0;
  /** Frames encoded so far. Nothing reads it — it is kept deliberately, as the
   *  one running count of a take's captured frames, for the next thing that
   *  wants recorder stats. It no longer decides timing (see nextFrameTiming). */
  private frameCount = 0;
  /** Microsecond timestamp of the last frame handed to the encoder; -1 before
   *  the first, so a take that starts on the clock's own zero still stamps 0. */
  private lastFrameTimestampUs = -1;
  /** Recording-clock microsecond mark at which the next keyframe is due. */
  private nextKeyFrameUs = 0;
  private audioTimestamp = 0;

  // Frame capture (for fallback method)
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private frameInterval: number | null = null;

  // Frame capture (for MediaStreamTrackProcessor method)
  private trackProcessor: MediaStreamTrackProcessor | null = null;
  private frameReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private frameReaderActive = false;

  // Audio capture
  private audioWorklet: ScriptProcessorNode | null = null;
  private mixedAudioStream: MediaStream | null = null;

  // Configuration
  private readonly frameRate = 30;
  private readonly sampleRate = 48000;
  private width = 0;
  private height = 0;

  // Track ended handlers
  private trackEndedHandlers: Map<MediaStreamTrack, () => void> = new Map();

  constructor(callbacks: WebCodecsRecorderCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Initialize the recorder with the given streams.
   */
  async initialize(
    screenStream: MediaStream | null,
    webcamStream: MediaStream | null,
    micStream: MediaStream | null,
    config: RecordingConfig
  ): Promise<void> {
    if (!isWebCodecsRecordingSupported()) {
      throw new Error('WebCodecs recording is not supported in this browser');
    }

    // Get video track
    if (screenStream && config.screenEnabled) {
      this.videoTrack = screenStream.getVideoTracks()[0] || null;
    } else if (webcamStream && config.webcamEnabled) {
      this.videoTrack = webcamStream.getVideoTracks()[0] || null;
    }

    if (!this.videoTrack) {
      throw new Error('No video track available for recording');
    }

    // Get video dimensions from track settings
    const settings = this.videoTrack.getSettings();
    this.width = settings.width || 1920;
    this.height = settings.height || 1080;

    // Safe to re-enable: WebCodecsRecorder is only used for non-PiP modes (factory enforces this).
    // The original PiP frame capture issue (PR #93) was caused by the compositor's hidden video
    // elements, not by MediaStreamTrackProcessor itself. For direct screen/webcam streams, it works.
    const hasTrackProcessor = typeof MediaStreamTrackProcessor !== 'undefined';

    if (hasTrackProcessor && typeof MediaStreamTrackProcessor !== 'undefined') {
      // Use MediaStreamTrackProcessor for direct frame access
      console.log('Using MediaStreamTrackProcessor for frame capture');
      this.trackProcessor = new MediaStreamTrackProcessor!({ track: this.videoTrack });
      this.frameReader = this.trackProcessor.readable.getReader();
    } else {
      // Fallback: Use video element + canvas approach
      console.log('Falling back to video element for frame capture');
      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = new MediaStream([this.videoTrack]);
      this.videoElement.muted = true;
      this.videoElement.playsInline = true;
      // Use visibility:hidden and actual dimensions to ensure proper decoding
      this.videoElement.style.cssText = `position:fixed;top:0;left:0;width:${this.width}px;height:${this.height}px;visibility:hidden;pointer-events:none;z-index:-9999;`;
      document.body.appendChild(this.videoElement);
      await this.videoElement.play();

      // Set up canvas for frame capture
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    }

    // Set up audio context for mixing and level monitoring
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    const destination = this.audioContext.createMediaStreamDestination();

    // Add system audio if available
    if (screenStream && config.systemAudioEnabled) {
      const systemAudioTrack = screenStream.getAudioTracks()[0];
      if (systemAudioTrack) {
        const systemSource = this.audioContext.createMediaStreamSource(
          new MediaStream([systemAudioTrack])
        );
        systemSource.connect(destination);

        // Set up analyser for system audio
        this.systemMeter = this.createLevelMeter(this.audioContext, systemSource);
      }
    }

    // Add microphone audio if available
    if (micStream && config.microphoneEnabled) {
      const micSource = this.audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);

      // Set up analyser for microphone
      this.micMeter = this.createLevelMeter(this.audioContext, micSource);
    }

    // Store mixed audio stream
    this.mixedAudioStream = destination.stream;

    // Listen for track ended events
    const handler = () => {
      console.warn(`Video track ended: ${this.videoTrack?.label}`);
      if (this.isRecordingActive) {
        // isRecordingActive stays true across pause(), so a take that was
        // paused when the capture died is finalized and delivered here too.
        console.warn('Video track ended during recording, stopping...');
        this.stop();
      } else if (!this.hasStarted) {
        // Between initialize() and start() — the countdown. Nothing has been
        // encoded, so there is no take to deliver; tell the caller instead, or
        // it starts a recording with no source behind it. After stop() the flag
        // is still set, and deliberately so: stop() drops isRecordingActive
        // before awaiting the encoder flushes and output.finalize(), and an
        // onError in that window would dispose the muxer mid-finalize and lose
        // the recording.
        this.callbacks.onError?.(new Error('Capture ended before recording started'));
      }
    };
    this.videoTrack.addEventListener('ended', handler);
    this.trackEndedHandlers.set(this.videoTrack, handler);

    // Set up Mediabunny output
    this.target = new BufferTarget();
    this.output = new Output({
      format: new WebMOutputFormat(),
      target: this.target,
    });

    // Create video packet source (VP9)
    this.videoSource = new EncodedVideoPacketSource('vp9');
    this.output.addVideoTrack(this.videoSource, { frameRate: this.frameRate });

    // Create audio packet source (Opus) if we have audio
    if (this.mixedAudioStream.getAudioTracks().length > 0) {
      this.audioSource = new EncodedAudioPacketSource('opus');
      this.output.addAudioTrack(this.audioSource);
    }

    // Start the output
    await this.output.start();

    // Set up video encoder
    this.videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        if (this.videoSource) {
          await this.videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
        }
      },
      error: (e) => {
        console.error('Video encoder error:', e);
        this.callbacks.onError?.(new Error(`Video encoder error: ${e.message}`));
      },
    });

    // Determine video bitrate based on resolution
    const pixels = this.width * this.height;
    let videoBitrate: number;
    if (pixels >= 1920 * 1080) {
      videoBitrate = 8_000_000; // 8 Mbps for 1080p+
    } else if (pixels >= 1280 * 720) {
      videoBitrate = 5_000_000; // 5 Mbps for 720p
    } else {
      videoBitrate = 2_500_000; // 2.5 Mbps for smaller
    }

    await this.videoEncoder.configure({
      codec: 'vp09.00.10.08', // VP9 Profile 0
      width: this.width,
      height: this.height,
      bitrate: videoBitrate,
      framerate: this.frameRate,
    });

    // Set up audio encoder if we have audio
    if (this.audioSource) {
      this.audioEncoder = new AudioEncoder({
        output: async (chunk, meta) => {
          if (this.audioSource) {
            await this.audioSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
          }
        },
        error: (e) => {
          console.error('Audio encoder error:', e);
        },
      });

      await this.audioEncoder.configure({
        codec: 'opus',
        sampleRate: this.sampleRate,
        numberOfChannels: 2,
        bitrate: 128000,
      });

      // Set up audio capture using ScriptProcessorNode
      // (AudioWorklet would be better but requires more setup)
      this.setupAudioCapture();
    }

    // Start audio level monitoring
    this.startAudioLevelMonitoring();
  }

  /**
   * Set up audio capture using ScriptProcessorNode
   */
  private setupAudioCapture(): void {
    if (!this.audioContext || !this.mixedAudioStream) return;

    const source = this.audioContext.createMediaStreamSource(this.mixedAudioStream);

    // Use ScriptProcessorNode for audio capture
    // Buffer size of 4096 samples at 48kHz = ~85ms chunks
    this.audioWorklet = this.audioContext.createScriptProcessor(4096, 2, 2);

    this.audioWorklet.onaudioprocess = (event) => {
      if (!this.isRecordingActive || this.isPausedState || !this.audioEncoder) return;

      const leftChannel = event.inputBuffer.getChannelData(0);
      const rightChannel = event.inputBuffer.getChannelData(1);
      const numberOfFrames = leftChannel.length;

      // Create planar data for AudioData
      const planarData = new Float32Array(numberOfFrames * 2);
      for (let i = 0; i < numberOfFrames; i++) {
        planarData[i] = leftChannel[i];
        planarData[numberOfFrames + i] = rightChannel[i];
      }

      try {
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: this.sampleRate,
          numberOfFrames,
          numberOfChannels: 2,
          timestamp: this.audioTimestamp,
          data: planarData,
        });

        this.audioEncoder.encode(audioData);
        audioData.close();

        this.audioTimestamp += (numberOfFrames / this.sampleRate) * 1_000_000;
      } catch (e) {
        console.error('Audio encoding error:', e);
      }
    };

    source.connect(this.audioWorklet);
    this.audioWorklet.connect(this.audioContext.destination);
  }

  /**
   * Start recording.
   */
  start(): void {
    // Check initialization based on which capture method we're using
    const usingTrackProcessor = this.frameReader !== null;
    const usingVideoElement = this.videoElement !== null && this.canvas !== null && this.ctx !== null;

    if (!this.videoEncoder || (!usingTrackProcessor && !usingVideoElement)) {
      throw new Error('Recorder not initialized');
    }

    this.isRecordingActive = true;
    this.hasStarted = true;
    this.isPausedState = false;
    this.startTime = performance.now();
    this.pausedDuration = 0;
    this.frameCount = 0;
    this.lastFrameTimestampUs = -1;
    this.nextKeyFrameUs = 0;
    this.audioTimestamp = 0;

    const frameDurationUs = Math.round((1 / this.frameRate) * 1_000_000);

    if (usingTrackProcessor && this.frameReader) {
      // Use MediaStreamTrackProcessor for direct frame access
      this.frameReaderActive = true;
      this.startTrackProcessorCapture();
    } else if (usingVideoElement) {
      // Fallback to video element + canvas approach
      this.startVideoElementCapture(frameDurationUs);
    }

    this.callbacks.onStart?.();
  }

  /**
   * Decide the timestamp and keyframe flag for the frame being captured right
   * now. All three capture paths go through here, so they cannot drift apart.
   *
   * The timestamp is the **recording clock at capture** — elapsed since
   * `start()`, paused time excluded — and not the frame index times a nominal
   * frame duration. `getDisplayMedia` does not promise 30fps: a window or
   * screen capture routinely delivers 5-15 frames a second, and counting
   * frames made N of them span N x 33.3ms however long they really took. A
   * 60 s take at 15fps came out as a 30 s video track against 60 s of audio:
   * playback at 2x with the audio lagging.
   *
   * Two rules on top of the clock:
   * - **Strictly increasing.** Two frames inside one tick of a coarse or
   *   frozen `performance.now()` would otherwise be stamped the same, so the
   *   second takes previous + 1us. This is an **encoder-level** guard:
   *   `VideoEncoder` is fed a monotonically increasing presentation timeline
   *   and a zero-delta frame is a meaningless presentation. It is not a
   *   container-level one — Mediabunny only throws when a timestamp is below
   *   the largest of the *previous GOP*, and its WebM muxer rounds each
   *   timestamp to a whole millisecond anyway, so 1us apart and identical land
   *   on the same block timecode.
   * - **A keyframe once per elapsed second**, not once per 30 frames. The
   *   count-based rule only meant one a second while the source really ran at
   *   30fps; at 10fps it was one every three seconds, and seeking suffered
   *   for it. Note a resume is not forced to be a keyframe: a pause consumes
   *   no recording clock, so the frame after it is keyed only if a second of
   *   *recording* has passed since the last one.
   *
   * `now` is the reading of the clock the caller has already taken, where it
   * has one: the track-processor path reads `performance.now()` for its
   * throttle a few lines earlier, and reading it twice per frame both costs
   * something per frame and lets the throttle and the stamp disagree.
   */
  private nextFrameTiming(now = performance.now()): { timestamp: number; keyFrame: boolean } {
    const elapsedUs = Math.round((now - this.startTime - this.pausedDuration) * 1000);
    const timestamp =
      elapsedUs > this.lastFrameTimestampUs ? elapsedUs : this.lastFrameTimestampUs + 1;
    this.lastFrameTimestampUs = timestamp;

    const keyFrame = timestamp >= this.nextKeyFrameUs;
    if (keyFrame) {
      this.nextKeyFrameUs = timestamp + 1_000_000;
    }

    return { timestamp, keyFrame };
  }

  /**
   * Start frame capture using MediaStreamTrackProcessor (preferred method)
   */
  private async startTrackProcessorCapture(): Promise<void> {
    if (!this.frameReader || !this.videoEncoder) return;

    const targetFrameInterval = 1000 / this.frameRate;
    let lastFrameTime = 0;

    try {
      while (this.frameReaderActive && this.isRecordingActive) {
        const { value: sourceFrame, done } = await this.frameReader.read();

        if (done) break;
        if (!sourceFrame) continue;

        // Throttle to target frame rate
        const now = performance.now();
        if (now - lastFrameTime < targetFrameInterval * 0.8) {
          sourceFrame.close();
          continue;
        }
        lastFrameTime = now;

        if (this.isPausedState) {
          sourceFrame.close();
          continue;
        }

        if (this.videoEncoder && this.videoEncoder.state !== 'closed') {
          try {
            // Re-stamp the frame with the recording clock (see nextFrameTiming),
            // reusing the reading the throttle above already took.
            const { timestamp, keyFrame } = this.nextFrameTiming(now);
            const frame = new VideoFrame(sourceFrame, { timestamp });
            // Close source frame immediately - we've copied the data we need
            sourceFrame.close();

            this.videoEncoder.encode(frame, { keyFrame });
            // Close frame after encoding - encoder copies the data it needs
            frame.close();

            this.frameCount++;
          } catch (e) {
            console.error('Frame encoding error:', e);
            sourceFrame.close();
          }
        } else {
          sourceFrame.close();
        }
      }
    } catch (e) {
      // Reader was cancelled or track ended
      if (this.isRecordingActive) {
        console.warn('Track processor read error:', e);
      }
    }
  }

  /**
   * Start frame capture using video element + canvas (fallback method)
   */
  private startVideoElementCapture(frameDurationUs: number): void {
    // Check if requestVideoFrameCallback is available (more reliable for video frame capture)
    const hasRequestVideoFrameCallback = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

    if (hasRequestVideoFrameCallback && this.videoElement) {
      // Use requestVideoFrameCallback for more accurate frame capture
      const captureFrameRVFC = () => {
        if (!this.isRecordingActive) return;

        if (!this.isPausedState && this.videoElement && this.ctx && this.canvas && this.videoEncoder) {
          try {
            // Draw current video frame to canvas
            this.ctx.drawImage(this.videoElement, 0, 0, this.width, this.height);

            // Create VideoFrame from canvas, stamped with the recording clock
            // (see nextFrameTiming). `duration` stays nominal: the muxer
            // derives the real packet durations from the timestamps.
            const { timestamp, keyFrame } = this.nextFrameTiming();
            const frame = new VideoFrame(this.canvas, {
              timestamp,
              duration: frameDurationUs,
            });

            this.videoEncoder.encode(frame, { keyFrame });
            // Close frame after encoding - encoder copies data synchronously
            frame.close();

            this.frameCount++;
          } catch (e) {
            console.error('Frame capture error:', e);
          }
        }

        // Request next frame callback
        if (this.isRecordingActive && this.videoElement) {
          (this.videoElement as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number })
            .requestVideoFrameCallback(captureFrameRVFC);
        }
      };

      // Start the frame callback loop
      (this.videoElement as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number })
        .requestVideoFrameCallback(captureFrameRVFC);
    } else {
      // Fallback to setTimeout-based frame capture
      const frameDurationMs = 1000 / this.frameRate;

      const captureFrame = () => {
        if (!this.isRecordingActive) return;

        if (!this.isPausedState && this.videoElement && this.ctx && this.canvas && this.videoEncoder) {
          try {
            // Draw current video frame to canvas
            this.ctx.drawImage(this.videoElement, 0, 0, this.width, this.height);

            // Create VideoFrame from canvas, stamped with the recording clock
            // (see nextFrameTiming). `duration` stays nominal: the muxer
            // derives the real packet durations from the timestamps.
            const { timestamp, keyFrame } = this.nextFrameTiming();
            const frame = new VideoFrame(this.canvas, {
              timestamp,
              duration: frameDurationUs,
            });

            this.videoEncoder.encode(frame, { keyFrame });
            // Close frame after encoding - encoder copies data synchronously
            frame.close();

            this.frameCount++;
          } catch (e) {
            console.error('Frame capture error:', e);
          }
        }

        this.frameInterval = window.setTimeout(captureFrame, frameDurationMs);
      };

      captureFrame();
    }
  }

  /**
   * Pause recording.
   */
  pause(): void {
    if (this.isRecordingActive && !this.isPausedState) {
      this.pauseStartTime = performance.now();
      this.isPausedState = true;
      this.callbacks.onPause?.();
    }
  }

  /**
   * Resume recording.
   */
  resume(): void {
    if (this.isRecordingActive && this.isPausedState) {
      this.pausedDuration += performance.now() - this.pauseStartTime;
      this.isPausedState = false;
      this.callbacks.onResume?.();
    }
  }

  /**
   * Stop recording and finalize.
   */
  async stop(): Promise<void> {
    if (!this.isRecordingActive) return;

    this.isRecordingActive = false;
    this.frameReaderActive = false;

    // Stop frame capture (setTimeout-based)
    if (this.frameInterval) {
      clearTimeout(this.frameInterval);
      this.frameInterval = null;
    }

    // Cancel frame reader (MediaStreamTrackProcessor-based)
    if (this.frameReader) {
      try {
        await this.frameReader.cancel();
      } catch {
        // Ignore cancel errors
      }
    }

    try {
      // Flush encoders
      if (this.videoEncoder && this.videoEncoder.state !== 'closed') {
        await this.videoEncoder.flush();
        this.videoEncoder.close();
      }

      if (this.audioEncoder && this.audioEncoder.state !== 'closed') {
        await this.audioEncoder.flush();
        this.audioEncoder.close();
      }

      // Finalize output
      if (this.output) {
        await this.output.finalize();
      }

      // Get the result blob
      const buffer = this.target?.buffer;
      if (buffer) {
        const blob = new Blob([buffer], { type: 'video/webm' });
        this.callbacks.onStop?.(blob);
      } else {
        this.callbacks.onError?.(new Error('Recording failed: no data was written'));
      }
    } catch (e) {
      console.error('Error finalizing recording:', e);
      this.callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.cleanup();
    }
  }

  /**
   * Get the current recording duration in seconds.
   */
  getDuration(): number {
    // Not `!this.startTime`: `performance.now()` legitimately returns 0 at the
    // page's time origin, where `Date.now()` never could, and a take that
    // started on that reading would otherwise report 0 seconds forever.
    if (!this.hasStarted) return 0;

    let elapsed = performance.now() - this.startTime - this.pausedDuration;

    if (this.isPausedState) {
      elapsed -= performance.now() - this.pauseStartTime;
    }

    return Math.max(0, elapsed / 1000);
  }

  /**
   * Check if recording is active.
   */
  isRecording(): boolean {
    return this.isRecordingActive && !this.isPausedState;
  }

  /**
   * Check if recording is paused.
   */
  isPaused(): boolean {
    return this.isRecordingActive && this.isPausedState;
  }

  /**
   * Wire an analyser onto an audio source and give it the buffer it will read
   * into for the rest of the take.
   */
  private createLevelMeter(context: AudioContext, source: AudioNode): LevelMeter {
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    return { analyser, data: new Uint8Array(analyser.frequencyBinCount) };
  }

  /**
   * Start monitoring audio levels.
   */
  private startAudioLevelMonitoring(): void {
    // A take with no microphone and no system audio has nothing to measure, so
    // there is no loop to run: pushing a hard-coded { 0, 0 } into the store on
    // every animation frame is a re-render of the whole app for a meter that
    // cannot move. Send that value exactly once, though — the store keeps the
    // previous take's levels (nothing resets them between takes) and
    // SourceToggles draws a meter whenever the *toggle* is on, so a take that
    // asked for system audio and was not given it would otherwise show the
    // last take's bar, frozen at whatever it was.
    if (!this.micMeter && !this.systemMeter) {
      this.callbacks.onAudioLevels?.({ microphone: 0, system: 0 });
      return;
    }

    let lastUpdate = 0;

    const monitor = () => {
      const now = performance.now();
      if (now - lastUpdate >= AUDIO_LEVEL_INTERVAL_MS) {
        lastUpdate = now;
        const levels: AudioLevels = {
          microphone: this.getAudioLevel(this.micMeter),
          system: this.getAudioLevel(this.systemMeter),
        };
        this.callbacks.onAudioLevels?.(levels);
      }
      this.animationFrameId = requestAnimationFrame(monitor);
    };

    monitor();
  }

  /**
   * Get audio level from a meter (0-1). An absent source reads as silence.
   */
  private getAudioLevel(meter: LevelMeter | null): number {
    if (!meter) return 0;

    const { analyser, data } = meter;
    analyser.getByteFrequencyData(data);

    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / data.length);

    // Normalize to 0-1 range
    return Math.min(1, rms / 128);
  }

  /**
   * Clean up resources.
   */
  private cleanup(): void {
    this.frameReaderActive = false;

    if (this.frameInterval) {
      clearTimeout(this.frameInterval);
      this.frameInterval = null;
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Clean up MediaStreamTrackProcessor resources
    if (this.frameReader) {
      try {
        this.frameReader.cancel().catch(() => {});
      } catch {
        // Ignore errors
      }
      this.frameReader = null;
    }
    this.trackProcessor = null;

    if (this.audioWorklet) {
      this.audioWorklet.disconnect();
      this.audioWorklet = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      // Remove from DOM since we attached it during initialization
      if (this.videoElement.parentNode) {
        this.videoElement.parentNode.removeChild(this.videoElement);
      }
      this.videoElement = null;
    }

    // Remove track ended event listeners
    for (const [track, handler] of this.trackEndedHandlers) {
      track.removeEventListener('ended', handler);
    }
    this.trackEndedHandlers.clear();

    this.videoEncoder = null;
    this.audioEncoder = null;
    this.output = null;
    this.target = null;
    this.videoSource = null;
    this.audioSource = null;
    this.canvas = null;
    this.ctx = null;
    this.micMeter = null;
    this.systemMeter = null;
    this.videoTrack = null;
    this.mixedAudioStream = null;
  }

  /**
   * Dispose of the recorder and all streams.
   */
  dispose(): void {
    if (this.isRecordingActive) {
      this.isRecordingActive = false;
      this.frameReaderActive = false;
      if (this.frameInterval) {
        clearTimeout(this.frameInterval);
      }
    }
    this.cleanup();
  }
}
