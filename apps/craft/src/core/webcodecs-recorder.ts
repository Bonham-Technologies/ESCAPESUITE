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
import type {
  AudioLevels,
  CompanionPart,
  RecorderStopCallback,
  RecordingConfig,
} from '../store/types';
import { isWebCodecsRecordingSupported } from './webcodecsSupport';

// Moved to `webcodecsSupport.ts` so a component can ask without importing the
// muxer; re-exported here because this is where every caller imports it from.
export { isWebCodecsRecordingSupported } from './webcodecsSupport';

export interface WebCodecsRecorderCallbacks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  /**
   * The finished take. A separate-tracks take delivers its webcam half as the
   * second argument (see `CompanionPart`); every other take delivers the blob
   * alone, and so does `Recorder`.
   */
  onStop?: RecorderStopCallback;
  onError?: (error: Error) => void;
  onAudioLevels?: (levels: AudioLevels) => void;
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

/**
 * One encoder's presentation bookkeeping.
 *
 * The recording **clock** is shared — one `startTime`, one `pausedDuration`,
 * read by `nextFrameTiming()` for every pipeline — and that shared clock is
 * what makes a separate-tracks take's two blobs aligned by construction rather
 * than by measurement. These two numbers are per encoder, because each encoder
 * is fed its own monotonically increasing presentation timeline and owes its
 * own viewer a keyframe once a second; sharing them would have two interleaved
 * pipelines pushing each other's timestamps forward and handing the second
 * pipeline only the keyframes the first did not claim.
 */
interface FrameTiming {
  /** Microsecond timestamp of the last frame handed to this encoder; -1 before
   *  the first, so a take that starts on the clock's own zero still stamps 0. */
  lastFrameTimestampUs: number;
  /** Recording-clock microsecond mark at which this encoder's next keyframe is due. */
  nextKeyFrameUs: number;
}

function newFrameTiming(): FrameTiming {
  return { lastFrameTimestampUs: -1, nextKeyFrameUs: 0 };
}

/**
 * The webcam half of a separate-tracks take: its own encoder, its own
 * Mediabunny output, its own frame reader — and the recorder's *shared* clock,
 * which is what makes the two blobs frame-aligned by construction.
 *
 * Track-processor only, deliberately: the primary pipeline keeps its
 * `<video>`+canvas fallback because a take has to record something, while the
 * opt-in mode is gated on `canRecordSeparateTracks()` and simply records the
 * screen alone where the API is missing.
 */
interface CompanionPipeline {
  readonly track: MediaStreamTrack;
  encoder: VideoEncoder | null;
  output: Output | null;
  target: BufferTarget | null;
  packetSource: EncodedVideoPacketSource | null;
  reader: ReadableStreamDefaultReader<VideoFrame> | null;
  readerActive: boolean;
  timing: FrameTiming;
  /** Frames this pipeline encoded; 0 means there is no companion worth storing. */
  frameCount: number;
  /**
   * Set once this pipeline has given up — its encoder errored, or would not
   * flush. The blob is then not worth delivering, so `stop()` reports no
   * companion; the take itself is unaffected.
   */
  failed: boolean;
}

/** Bitrate for a video pipeline of this size. */
function videoBitrateFor(width: number, height: number): number {
  const pixels = width * height;
  if (pixels >= 1920 * 1080) return 8_000_000; // 8 Mbps for 1080p+
  if (pixels >= 1280 * 720) return 5_000_000; // 5 Mbps for 720p
  return 2_500_000; // 2.5 Mbps for smaller
}

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
  /** The primary (screen or webcam) pipeline's own frame bookkeeping. */
  private screenTiming: FrameTiming = newFrameTiming();
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

  // The webcam half of a separate-tracks take, or null for every other take.
  private companion: CompanionPipeline | null = null;

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

    // Safe to re-enable: no take that reaches this recorder captures frames
    // through the compositor. Composited PiP never gets here — the factory still
    // forces MediaRecorder for it — and a separate-tracks take, which does
    // (ESCSUITE-14), is handed the RAW screen and webcam tracks while the
    // compositor only draws the preview. The original PiP frame capture issue
    // (PR #93) was caused by the compositor's hidden video elements, not by
    // MediaStreamTrackProcessor itself. For direct screen/webcam streams, it works.
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
    const primary = this.createVideoOutput();
    this.target = primary.target;
    this.output = primary.output;
    this.videoSource = primary.packetSource;

    // Create audio packet source (Opus) if we have audio
    if (this.mixedAudioStream.getAudioTracks().length > 0) {
      this.audioSource = new EncodedAudioPacketSource('opus');
      this.output.addAudioTrack(this.audioSource);
    }

    // Start the output
    await this.output.start();

    // Set up video encoder
    this.videoEncoder = await this.createVideoEncoder(
      () => this.videoSource,
      this.width,
      this.height,
      // The primary's encoder dying is the take dying: there is nothing else
      // being recorded, so the caller has to be told.
      (e) => {
        console.error('Video encoder error:', e);
        this.callbacks.onError?.(new Error(`Video encoder error: ${e.message}`));
      }
    );

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

    // A separate-tracks take (ESCSUITE-14): the webcam gets its own encoder and
    // its own output, stamped from the same clock as the screen's. Only a
    // screen+webcam take can have one — a webcam-only take *is* the webcam.
    //
    // `screenStream` is part of the question, not just `config.screenEnabled`:
    // a take can be configured for the screen and started without one (see
    // useMediaStreams, which asks for display capture only where it can, and
    // recordReadiness, which starts a take on any one available source). The
    // primary above is then the webcam itself, and a companion would be a
    // second encoder on that same track — one camera in two files, and a
    // second 'ended' listener that cleanup() could not remove because
    // trackEndedHandlers is keyed by track.
    if (
      config.separateTracks &&
      config.screenEnabled &&
      screenStream &&
      config.webcamEnabled &&
      webcamStream
    ) {
      await this.initializeCompanion(webcamStream);
    }

    // Start audio level monitoring
    this.startAudioLevelMonitoring();
  }

  /**
   * Build the webcam pipeline, or record the screen alone and say why.
   *
   * Both refusals are warnings rather than throws: the take the user asked for
   * is mostly the screen, and losing it because the camera track was missing
   * would be a worse outcome than a take with no companion.
   */
  private async initializeCompanion(webcamStream: MediaStream): Promise<void> {
    const track = webcamStream.getVideoTracks()[0];
    if (!track) {
      console.warn(
        'Separate tracks asked for, but the webcam stream has no video track — recording the screen alone'
      );
      return;
    }
    if (typeof MediaStreamTrackProcessor === 'undefined') {
      console.warn('No MediaStreamTrackProcessor — recording the screen alone');
      return;
    }

    const settings = track.getSettings();
    const { output, target, packetSource } = this.createVideoOutput();
    // No audio track: slice 1 keeps the whole mix on the primary output.
    await output.start();

    this.companion = {
      track,
      encoder: await this.createVideoEncoder(
        () => this.companion?.packetSource ?? null,
        settings.width || 1280,
        settings.height || 720,
        // ...and the companion's encoder dying costs the take its companion and
        // nothing else. Routing this to onError would have the controller
        // dispose the recorder and throw away a screen recording that is still
        // being made.
        (e) => {
          console.warn(`Webcam track encoder failed: ${e.message}`);
          this.failCompanion();
        }
      ),
      output,
      target,
      packetSource,
      reader: new MediaStreamTrackProcessor({ track }).readable.getReader(),
      readerActive: false,
      timing: newFrameTiming(),
      frameCount: 0,
      failed: false,
    };

    // A camera that stops is not a take that stops: end this pipeline and let
    // the screen keep recording. stop() then finalizes a shorter companion, or
    // none at all if no frame ever arrived.
    const companionEnded = () => {
      console.warn(`Webcam track ended: ${track.label}`);
      if (this.companion) this.companion.readerActive = false;
    };
    track.addEventListener('ended', companionEnded);
    this.trackEndedHandlers.set(track, companionEnded);
  }

  /** Read the webcam track into its own encoder, on the shared clock. */
  private async startCompanionCapture(): Promise<void> {
    const companion = this.companion;
    if (!companion?.reader) return;

    await this.captureFromTrackProcessor(
      companion.reader,
      companion.timing,
      () => companion.readerActive,
      () => companion.encoder,
      () => {
        companion.frameCount++;
      }
    );
  }

  /**
   * Give up on the webcam half without touching the take: stop reading the
   * camera, and make `stop()` report no companion.
   */
  private failCompanion(): void {
    if (this.companion) {
      this.companion.readerActive = false;
      this.companion.failed = true;
    }
  }

  /**
   * Flush and close the companion's encoder, giving up the companion rather
   * than the take if it refuses.
   *
   * Its own try/catch, and not `stop()`'s: this runs *before* the primary's
   * `output.finalize()`, so a rejection that escaped here would skip the
   * finalize, land in the outer catch and report `onError` over a screen
   * recording that was already complete.
   */
  private async flushCompanion(): Promise<void> {
    const encoder = this.companion?.encoder;
    if (!encoder || encoder.state === 'closed') return;

    try {
      await encoder.flush();
      encoder.close();
    } catch (e) {
      console.warn('The webcam companion could not be flushed:', e);
      this.failCompanion();
    }
  }

  /**
   * Finalize the webcam half and hand back its blob, or null when there is
   * nothing worth storing.
   *
   * Three cases end as "no companion" rather than as an empty row in the
   * library: a webcam that delivered no frame (the take recorded the screen
   * alone), a pipeline that already gave up (`failed`), and a muxer that could
   * not write. The last is swallowed into a warning on purpose — the primary
   * blob is the take, and losing it because the companion's finalize threw
   * would be the worse outcome by far.
   */
  private async finalizeCompanion(): Promise<CompanionPart | null> {
    const companion = this.companion;
    if (!companion || companion.failed || companion.frameCount === 0) return null;

    try {
      await companion.output?.finalize();
      const buffer = companion.target?.buffer;
      if (!buffer) return null;
      // 0 in this slice: one clock, one start(), both pipelines' first frame
      // stamped from the same origin. Written down rather than assumed, because
      // the audio companions (slice 3) will not all start at zero.
      return {
        role: 'webcam',
        blob: new Blob([buffer], { type: 'video/webm' }),
        startOffset: 0,
      };
    } catch (e) {
      console.warn('The webcam companion could not be finalized:', e);
      return null;
    }
  }

  /**
   * A WebM output with one VP9 video track. The caller adds any audio track and
   * then starts it, because the primary output mixes audio in and the webcam
   * companion does not.
   */
  private createVideoOutput(): {
    output: Output;
    target: BufferTarget;
    packetSource: EncodedVideoPacketSource;
  } {
    const target = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target });
    const packetSource = new EncodedVideoPacketSource('vp9');
    output.addVideoTrack(packetSource, { frameRate: this.frameRate });
    return { output, target, packetSource };
  }

  /**
   * A configured VP9 encoder writing into `sourceOf()`'s packet source.
   *
   * The source is read through a function rather than captured, because
   * `cleanup()` nulls it: an encoder output that lands after a take has been
   * torn down must find nothing to add to rather than write into a finalized
   * muxer.
   *
   * `onEncoderError` is per pipeline and has no default, because what an
   * encoder failure *means* differs by pipeline: the primary's is the end of
   * the take, the companion's is the end of the companion. A shared handler
   * made a webcam hiccup throw away the screen recording.
   */
  private async createVideoEncoder(
    sourceOf: () => EncodedVideoPacketSource | null,
    width: number,
    height: number,
    onEncoderError: (error: DOMException) => void
  ): Promise<VideoEncoder> {
    const encoder = new VideoEncoder({
      output: async (chunk, meta) => {
        const source = sourceOf();
        if (source) {
          await source.add(EncodedPacket.fromEncodedChunk(chunk), meta);
        }
      },
      error: onEncoderError,
    });

    await encoder.configure({
      codec: 'vp09.00.10.08', // VP9 Profile 0
      width,
      height,
      bitrate: videoBitrateFor(width, height),
      framerate: this.frameRate,
    });

    return encoder;
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
    this.screenTiming = newFrameTiming();
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

    if (this.companion) {
      this.companion.timing = newFrameTiming();
      this.companion.frameCount = 0;
      this.companion.readerActive = true;
      void this.startCompanionCapture();
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
   *
   * `timing` is the calling pipeline's own bookkeeping; the clock it is
   * measured against is the recorder's, which is what keeps two pipelines'
   * frames on one timeline.
   */
  private nextFrameTiming(
    timing: FrameTiming,
    now = performance.now()
  ): { timestamp: number; keyFrame: boolean } {
    const elapsedUs = Math.round((now - this.startTime - this.pausedDuration) * 1000);
    const timestamp =
      elapsedUs > timing.lastFrameTimestampUs ? elapsedUs : timing.lastFrameTimestampUs + 1;
    timing.lastFrameTimestampUs = timestamp;

    const keyFrame = timestamp >= timing.nextKeyFrameUs;
    if (keyFrame) {
      timing.nextKeyFrameUs = timestamp + 1_000_000;
    }

    return { timestamp, keyFrame };
  }

  /**
   * Start frame capture using MediaStreamTrackProcessor (preferred method)
   */
  private async startTrackProcessorCapture(): Promise<void> {
    if (!this.frameReader || !this.videoEncoder) return;

    await this.captureFromTrackProcessor(
      this.frameReader,
      this.screenTiming,
      () => this.frameReaderActive,
      () => this.videoEncoder,
      () => {
        this.frameCount++;
      }
    );
  }

  /**
   * Read one track's frames, re-stamp each with the recording clock and hand it
   * to that track's encoder, until the pipeline is stopped or the track ends.
   *
   * Parameterised rather than written twice: a separate-tracks take runs this
   * loop once per video track, and the throttle (`lastFrameTime`) is a local so
   * each track is throttled against its own delivery rate rather than against
   * the other's.
   */
  private async captureFromTrackProcessor(
    reader: ReadableStreamDefaultReader<VideoFrame>,
    timing: FrameTiming,
    active: () => boolean,
    encoderOf: () => VideoEncoder | null,
    onFrameEncoded: () => void
  ): Promise<void> {
    const targetFrameInterval = 1000 / this.frameRate;
    let lastFrameTime = 0;

    try {
      while (active() && this.isRecordingActive) {
        const { value: sourceFrame, done } = await reader.read();

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

        const encoder = encoderOf();
        if (encoder && encoder.state !== 'closed') {
          try {
            // Re-stamp the frame with the recording clock (see nextFrameTiming),
            // reusing the reading the throttle above already took.
            const { timestamp, keyFrame } = this.nextFrameTiming(timing, now);
            const frame = new VideoFrame(sourceFrame, { timestamp });
            // Close source frame immediately - we've copied the data we need
            sourceFrame.close();

            encoder.encode(frame, { keyFrame });
            // Close frame after encoding - encoder copies the data it needs
            frame.close();

            onFrameEncoded();
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
            const { timestamp, keyFrame } = this.nextFrameTiming(this.screenTiming);
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
            const { timestamp, keyFrame } = this.nextFrameTiming(this.screenTiming);
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
    if (this.companion) this.companion.readerActive = false;

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

    if (this.companion?.reader) {
      try {
        await this.companion.reader.cancel();
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

      await this.flushCompanion();

      if (this.audioEncoder && this.audioEncoder.state !== 'closed') {
        await this.audioEncoder.flush();
        this.audioEncoder.close();
      }

      // Finalize output
      if (this.output) {
        await this.output.finalize();
      }

      const companion = await this.finalizeCompanion();

      // Get the result blob
      const buffer = this.target?.buffer;
      if (buffer) {
        const blob = new Blob([buffer], { type: 'video/webm' });
        this.callbacks.onStop?.(blob, companion);
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

    if (this.companion) {
      const { reader } = this.companion;
      if (reader) {
        try {
          reader.cancel().catch(() => {});
        } catch {
          // Ignore errors
        }
      }
      this.companion.encoder = null;
      this.companion.output = null;
      this.companion.target = null;
      this.companion.packetSource = null;
      this.companion = null;
    }

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
      if (this.companion) this.companion.readerActive = false;
      if (this.frameInterval) {
        clearTimeout(this.frameInterval);
      }
    }
    this.cleanup();
  }
}
