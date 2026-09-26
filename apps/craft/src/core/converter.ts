/**
 * WebM to MP4 converter using WebCodecs and Mediabunny
 * Converts recordings from WebM (VP8/VP9 + Opus) to MP4 (H.264 + AAC)
 */

// TypeScript types for requestVideoFrameCallback (not in standard lib yet)
interface VideoFrameCallbackMetadata {
  presentationTime: number;
  expectedDisplayTime: number;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
  captureTime?: number;
  receiveTime?: number;
  rtpTimestamp?: number;
}

interface HTMLVideoElementWithRVFC extends HTMLVideoElement {
  requestVideoFrameCallback(
    callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void
  ): number;
  cancelVideoFrameCallback(handle: number): void;
}

import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from 'mediabunny';
import fixWebmDurationImport from 'webm-duration-fix';
import type { OverlayPlacement } from '@escapesuite/shared/types';
import { drawOverlay, overlayGeometryFor, type OverlayGeometry } from './overlayGeometry';

/**
 * The one function `webm-duration-fix` provides: repair a WebM container. Taken
 * from the library's own `lib/index.d.ts` rather than restated, so it tracks the
 * package — TypeScript reads the declaration whatever the runtime interop does.
 */
type FixWebmDuration = typeof fixWebmDurationImport;

/**
 * Pick the repair function out of whatever the toolchain handed us for
 * `webm-duration-fix`.
 *
 * The library is CommonJS: its `lib/index.js` ends `exports.default =
 * fixWebmDuration` and sets `__esModule`. What a default import binds to is
 * therefore a toolchain decision, and the toolchain changed its mind at the
 * Vite 7 → 8 major (`7c40710`, 2026-03-14, vite 8.0.0; first released here as
 * craft 2.1.0):
 *
 * - esbuild's `__toESM(mod, 0)` — Vite 7 and earlier, for both the dev server's
 *   pre-bundled deps and the build — honours `__esModule` and binds the
 *   **function** on `exports.default`.
 * - Vite 8 moved dep optimization and the build to Rolldown and aligned CJS
 *   interop with Node's (see `legacy.inconsistentCjsInterop` in Vite's config
 *   types, the opt-out documented for "pre-Vite 8" behaviour). Node binds a
 *   default import to the whole `module.exports`, so what arrives is the
 *   **object** `{ __esModule: true, default: fixWebmDuration }`. Observed in both
 *   halves of the 8.3.0 the bug was found and fixed under: the dev server emits
 *   `const fixWebmDuration = __vite__cjsImport1_webmDurationFix`, and the build
 *   emits `__toESM(require_lib(), 1)` — the `1` being Node mode.
 *
 * Calling the object is a `TypeError`, `useRecordingSave` catches it, and every
 * MediaRecorder take (PiP, audio-only, any browser without WebCodecs) is stored
 * unrepaired — playable, but with no Duration and no Cues, so it will not
 * scrub. No unit test could see it: they all `vi.mock('webm-duration-fix')`.
 *
 * Scope, exactly: this unwraps **one** level of `default`, which is every shape
 * a *default* import produces — the bare function, or `module.exports` with the
 * function on `.default`. It is not a general interop shim; Vite's namespace
 * helper double-wraps (`{ ...exports, default: exports }`), so if this module
 * ever switches to `import * as`, this has to grow a loop. Doing it here rather
 * than pinning a Vite option keeps one app's import correct without opting the
 * whole app out of an upstream change.
 *
 * `tests/escapecraft/pip-seekable.spec.ts` and its production-layout twin in
 * `apps/e2e` are what guard it, by recording a real PiP take and requiring the
 * stored blob to report a finite duration.
 */
export function resolveFixWebmDuration(imported: unknown): FixWebmDuration {
  if (typeof imported === 'function') return imported as FixWebmDuration;
  return (imported as { default: FixWebmDuration }).default;
}

const fixWebmDuration = resolveFixWebmDuration(fixWebmDurationImport);

export interface ConversionProgress {
  phase: 'preparing' | 'encoding' | 'finalizing';
  progress: number; // 0-100
  message: string;
}

export type ProgressCallback = (progress: ConversionProgress) => void;

/**
 * Error thrown when conversion is cancelled by user
 */
export class ConversionAbortedError extends Error {
  constructor() {
    super('Conversion was cancelled');
    this.name = 'ConversionAbortedError';
  }
}

/**
 * Check if abort was requested and throw if so
 */
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ConversionAbortedError();
  }
}

/** What a conversion needs to be able to do to any encoder it built. */
interface ReleasableEncoder {
  readonly state: CodecState;
  close(): void;
}

/**
 * The encoders one conversion built, and the first failure any of them
 * reported asynchronously.
 *
 * Two jobs in one object, because they are the same problem seen twice
 * (ESCSUITE-74).
 *
 * **Releasing.** A `VideoEncoder`/`AudioEncoder` holds a hardware encode
 * session and `close()` is the only way to give one back. Every encoder a
 * conversion constructs is registered here, and `release()` — called from that
 * conversion's one `finally`, which runs however it left — closes the ones
 * still open. Registration rather than a local per encoder, so a path that
 * grows a second encoder cannot grow a way to forget it.
 *
 * **Surfacing.** A codec that fails *asynchronously* fails through its
 * `error:` callback, which sits on no await path at all. Before this, that
 * callback only wrote a console line: the conversion carried on handing frames
 * to a dead encoder — whose `encode()` then throws `InvalidStateError` from
 * inside a `requestVideoFrameCallback`, where nothing catches it, so the
 * capture promise never settles and the conversion hangs holding every other
 * encoder open. `errorCallback()` is what that callback now is: it remembers
 * the codec's own error and aborts the work in flight, so the conversion stops
 * at the next check. `translate()` then puts the codec's message on the
 * rejection in place of the abort the failure itself raised, and
 * `throwIfFailed()` covers the gap between the last abort check and the muxer —
 * a file written from a dead encoder's packets is truncated, and handing one
 * over silently was the other half of the bug.
 */
interface ConversionEncoders {
  /**
   * The signal the conversion's own work runs under: the caller's cancellation
   * *and* an encoder failure, so one check serves both.
   */
  readonly signal: AbortSignal;
  /** Register an encoder for release, and hand it straight back. */
  register<T extends ReleasableEncoder>(encoder: T): T;
  /** The `error:` callback for one encoder. `kind` names it in the console. */
  errorCallback(kind: 'Video' | 'Audio'): (error: DOMException) => void;
  /** Throw the first codec failure, if there was one. */
  throwIfFailed(): void;
  /** What the conversion should reject with, given what its work threw. */
  translate(error: unknown): unknown;
  /** Close every registered encoder that is not closed already. */
  release(): void;
}

function conversionEncoders(callerSignal?: AbortSignal): ConversionEncoders {
  const encoders: ReleasableEncoder[] = [];
  const controller = new AbortController();
  let failure: DOMException | null = null;

  const onCallerAbort = () => controller.abort();
  // An already-aborted signal never fires `abort`, so the combined signal has
  // to start aborted — the conversion would otherwise run to completion for a
  // caller that had already cancelled it.
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', onCallerAbort);

  return {
    signal: controller.signal,
    register(encoder) {
      encoders.push(encoder);
      return encoder;
    },
    errorCallback: (kind) => (error) => {
      // Still logged: the console line is where the browser's own stack
      // survives, and it is the only record left when the rejection below is
      // swallowed (a cancellation outranks it — see `translate`).
      console.error(`${kind} encoder error:`, error);
      // The first failure is the one that stopped the conversion; a second
      // encoder dying afterwards is usually a consequence of the first.
      failure ??= error;
      controller.abort();
    },
    throwIfFailed() {
      if (failure) throw failure;
    },
    translate(error) {
      // The user's own cancellation outranks an encoder failure: they asked for
      // no file, and `useMp4Download` deliberately says nothing about a
      // conversion that was cancelled. Anything else that came back while an
      // encoder had failed *is* that failure, wearing whatever the work
      // happened to raise — the abort this object issued, or the flush that
      // rejected because the codec had closed itself.
      if (callerSignal?.aborted) return error;
      return failure ?? error;
    },
    release() {
      callerSignal?.removeEventListener('abort', onCallerAbort);
      for (const encoder of encoders) {
        // Guarded because an encoder that reported an asynchronous failure
        // closed itself, and the real API throws `InvalidStateError` on a
        // second `close()` — which is how this was found (ESCSUITE-66), and
        // what the test double is now strict about.
        if (encoder.state !== 'closed') encoder.close();
      }
    },
  };
}

/**
 * Yield to main thread without being throttled in background tabs.
 * Uses MessageChannel which is not subject to the same throttling as setTimeout.
 */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

/**
 * The camera half of a separate-tracks take, for the composite MP4.
 *
 * A take recorded with "Record webcam as a separate track" is two video files,
 * and MP4 is the format that puts them back together (ESCSUITE-14 decision 3):
 * the screen with the camera drawn into the corner it was recorded in. The
 * screen-only MP4 is deliberately not offered as a second option — a user who
 * wants one part alone downloads its WebM from its own row.
 *
 * There is no audio here on purpose. The primary's own track **is** the mix:
 * `WebCodecsRecorder` writes the microphone and system companions as a second
 * tap on tracks the mix is already reading rather than diverting them, so the
 * MP4's audio (and the whole M4A download) needs nothing from the parts.
 */
export interface CompositeCompanion {
  /** The webcam part's stored WebM. */
  blob: Blob;
  /**
   * Where the overlay sat while the take was recorded — the primary's stored
   * `overlayPlacement`. It is stored because the picture no longer carries it.
   */
  placement: OverlayPlacement;
  /** Seconds after the take's start at which this part's first frame was captured. */
  startOffset: number;
}

export interface CompositeOptions {
  companion: CompositeCompanion;
  /**
   * Called once, before any frame is encoded, when the camera part could not be
   * used and the MP4 will be the screen alone.
   *
   * The conversion still resolves: a screen-only MP4 is a real file, and
   * refusing to write one would leave the user with nothing after minutes of
   * encoding. This is how the caller learns the file is not what was asked for
   * — `hooks/useMp4Download.ts` turns it into a notice.
   */
  onCompanionSkipped?: () => void;
}

/** The second picture a composite frame draws, and where it goes. */
interface FrameOverlay {
  video: HTMLVideoElement;
  geometry: OverlayGeometry;
  /** Seconds into the screen part at which this picture begins. */
  startOffset: number;
  /**
   * Called when this overlay drew nothing at all — the header parsed, so the
   * load never reported a failure, and then not one frame of it decoded. The
   * same callback the load failure uses, and the two cannot both fire: a load
   * that failed never builds an overlay.
   */
  onSkipped?: () => void;
}

/**
 * The camera part mid-load: its element, its object URL, the header read that
 * is already in flight, and everything `convertToMP4` needs to decide what to
 * do with it.
 *
 * One nullable object rather than a field per value so every use downstream is
 * a single truthiness check — there is no state in which the element exists and
 * the URL does not, and spelling that as `composite && video && url` would ask
 * the reader (and the branch coverage) about combinations that cannot happen.
 */
interface CompanionLoad {
  video: HTMLVideoElement;
  url: string;
  /**
   * Resolves with `null` once the container's header is read, or with the
   * failure that stopped it. It never rejects: the failure is a decision this
   * function makes (draw the screen alone), not an error that should escape.
   */
  loaded: Promise<Error | null>;
  placement: OverlayPlacement;
  startOffset: number;
  onSkipped?: () => void;
}

/**
 * Capture frames by playing the video (much faster than seek-based approach).
 * Uses requestVideoFrameCallback if available for precise frame capture.
 */
async function captureFramesViaPlayback(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  videoEncoder: VideoEncoder,
  frameRate: number,
  totalFrames: number,
  keyFrameInterval: number,
  signal?: AbortSignal,
  onProgress?: (frameIndex: number, totalFrames: number) => void,
  /**
   * A second picture to draw on top of each captured frame. Absent for every
   * conversion but the composite of a separate-tracks take, and absent is what
   * keeps the plain path's per-frame work exactly one `drawImage`.
   */
  overlay?: FrameOverlay
): Promise<void> {
  const frameDuration = 1 / frameRate;
  const frameDurationUs = Math.round(frameDuration * 1_000_000);

  // Check if requestVideoFrameCallback is available
  // Use a function check to avoid TypeScript type narrowing issues
  const hasRVFC = typeof (video as HTMLVideoElementWithRVFC).requestVideoFrameCallback === 'function';

  return new Promise((resolve, reject) => {
    // An already-aborted signal never fires 'abort', and the capture callbacks
    // below bail out silently when signal.aborted is set — so without this the
    // conversion would hang forever instead of settling.
    if (signal?.aborted) {
      reject(new ConversionAbortedError());
      return;
    }

    let frameIndex = 0;
    let lastCaptureTime = -frameDuration; // Ensure we capture frame 0
    let rvfcHandle: number | null = null;
    let rafHandle: number | null = null;
    let isFinished = false;
    let overlayPlaying = false;
    // How many frames the overlay actually contributed to. Read once, at
    // cleanup: zero is the only failure `companion.loaded` cannot see.
    let overlayFrames = 0;

    /**
     * Play the camera part, once the screen has played as far as the point
     * where that part begins.
     *
     * Both elements then run at 1x off the same wall clock, so the two pictures
     * stay within the two elements' start-up latency of each other: both
     * `play()`s are issued from one synchronous block, nothing re-seeks either
     * element afterwards, so whatever that difference turns out to be it is
     * constant for the run rather than accumulating. (It is not bounded by a
     * frame — nothing here measures it.) That is what lets each captured frame
     * draw whatever the camera element is currently showing. The alternative is
     * a seek per frame, which is the minutes-instead-of-real-time cost this
     * whole function exists to avoid.
     *
     * `startOffset` is 0 for every take ESCAPECRAFT records: both parts come
     * from one `start()` on one clock (`core/webcodecs-recorder.ts`), so this
     * fires on the call below and the in-loop call never does anything. It is
     * honoured anyway because it is stored per part, and a recorder that
     * started them apart would otherwise silently misalign them.
     */
    const startOverlayIfDue = (elapsed: number): void => {
      if (!overlay || overlayPlaying || elapsed < overlay.startOffset) return;
      overlayPlaying = true;
      overlay.video.currentTime = 0;
      // Caught, not discarded: `cleanup()`'s pause() rejects a play() that is
      // still resolving with AbortError, which is what cancelling a composite
      // conversion does — the screen element's play() is handled the same way,
      // a few lines below.
      overlay.video.play().catch(() => {});
    };

    const cleanup = () => {
      isFinished = true;
      if (rvfcHandle !== null && hasRVFC) {
        (video as HTMLVideoElementWithRVFC).cancelVideoFrameCallback(rvfcHandle);
      }
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
      video.pause();
      // The camera element is stopped with the screen: a cancelled conversion
      // must not leave a second <video> decoding behind a row that is idle.
      overlay?.video.pause();
      // An overlay that was configured and drew nothing is a file missing
      // something the user recorded, and nothing upstream can tell:
      // `companion.loaded` resolves on `loadedmetadata`, which a container
      // whose pictures never decode still fires, and the element's `error`
      // after that point resolves an already-settled promise. The frame count
      // is the only honest question, and it can only be asked here.
      //
      // Said at most once, and never alongside the load-failure report — that
      // path builds no overlay at all — because the count is pushed past zero
      // as it is said, so a second `cleanup()` cannot repeat it. A cancelled
      // conversion reports too, harmlessly: it rejects, and
      // `hooks/useMp4Download.ts` says nothing about a file the user does not
      // have.
      if (overlay && overlayFrames === 0) {
        overlayFrames = -1;
        overlay.onSkipped?.();
      }
    };

    /**
     * Leave the capture with an error, by the one door: stop the loop and both
     * elements, stop listening for a cancellation that can no longer matter,
     * and reject with what stopped it.
     *
     * The abort path's own exit, which is why it is the exit a throw takes too
     * (see `guarded` below). It removes the abort listener where `onAbort`
     * used to leave it attached — a signal fires `abort` once, so that is the
     * same thing happening in one place instead of two.
     */
    const fail = (error: unknown) => {
      cleanup();
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    };

    /** …and the same door for a capture that got every frame it was owed. */
    const finish = () => {
      cleanup();
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };

    const onAbort = () => fail(new ConversionAbortedError());

    /**
     * Run one callback body, and turn a synchronous throw into that same
     * failure exit (ESCSUITE-78).
     *
     * Everything below runs from a browser callback — a video-frame callback,
     * an animation frame, an `ended` listener — and the browser *swallows* a
     * throw out of one of those: it is reported to the page and nothing else
     * happens. The next frame is never requested, neither `resolve` nor
     * `reject` is ever reached, so this promise stays pending for the life of
     * the tab, the conversion's one `finally` never runs, every encoder it
     * built stays open and the recording row never leaves "Converting…".
     * `new VideoFrame()` on a zero-sized canvas, a `drawImage` or
     * `drawOverlay` from an element that has errored or detached, a frame that
     * is already closed: all raise exactly that. ESCSUITE-74 fixed the one
     * case that was reachable in practice — a dead encoder's `encode()` — by
     * removing its cause; this is the shape, whatever the cause.
     */
    const guarded =
      <A extends unknown[]>(body: (...args: A) => void) =>
      (...args: A): void => {
        try {
          body(...args);
        } catch (error) {
          fail(error);
        }
      };

    signal?.addEventListener('abort', onAbort);

    const captureCurrentFrame = () => {
      if (frameIndex >= totalFrames || isFinished) return false;

      startOverlayIfDue(video.currentTime);

      // Draw current frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // …and the camera on top of it, where it was recorded. Guarded on the
      // part having *started* as well as on a decoded frame (which is how
      // `Compositor.drawFrame` guards the live overlay): `preload='auto'` gets
      // the element to `readyState >= 2` long before anything plays it, so
      // asking only about readiness would composite its frozen first frame over
      // every screen frame before `startOffset` — the one thing the offset
      // exists to prevent. Readiness is still asked because the first frames of
      // a conversion can arrive before the second element has a picture, and a
      // screen-only frame is better than a throw.
      if (overlay && overlayPlaying && overlay.video.readyState >= 2) {
        drawOverlay(ctx, overlay.video, canvas, overlay.geometry);
        overlayFrames++;
      }

      // Create and encode frame
      const frame = new VideoFrame(canvas, {
        timestamp: frameIndex * frameDurationUs,
        duration: frameDurationUs,
      });

      const keyFrame = frameIndex % keyFrameInterval === 0;
      videoEncoder.encode(frame, { keyFrame });
      frame.close();

      frameIndex++;
      onProgress?.(frameIndex, totalFrames);

      return frameIndex < totalFrames;
    };

    // Both halves start together (see `startOverlayIfDue`): the screen's own
    // `play()` is a few lines below, in whichever branch runs.
    startOverlayIfDue(0);

    if (hasRVFC) {
      // Use requestVideoFrameCallback for precise frame capture
      const rvfcCallback = guarded((_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
        if (signal?.aborted || isFinished) return;

        const currentTime = metadata.mediaTime;

        // Capture frames at target frame rate intervals
        while (lastCaptureTime + frameDuration <= currentTime && frameIndex < totalFrames) {
          captureCurrentFrame();
          lastCaptureTime += frameDuration;
        }

        // Continue if video is still playing and we need more frames
        if (!video.ended && !video.paused && frameIndex < totalFrames) {
          rvfcHandle = (video as HTMLVideoElementWithRVFC).requestVideoFrameCallback(rvfcCallback);
        }
      });

      video.addEventListener('ended', guarded(() => {
        if (isFinished) return;
        // Capture any remaining frames using the last displayed frame
        while (frameIndex < totalFrames) {
          captureCurrentFrame();
          lastCaptureTime += frameDuration;
        }
        finish();
      }));

      video.addEventListener('error', () => {
        fail(new Error('Video playback error'));
      });

      rvfcHandle = (video as HTMLVideoElementWithRVFC).requestVideoFrameCallback(rvfcCallback);
      video.currentTime = 0;
      video.play().catch(reject);
    } else {
      // Fallback: use requestAnimationFrame with time-based capture
      const rafCallback = guarded(() => {
        if (signal?.aborted || isFinished) return;

        const currentTime = video.currentTime;

        // Capture frames at target frame rate intervals
        while (lastCaptureTime + frameDuration <= currentTime && frameIndex < totalFrames) {
          captureCurrentFrame();
          lastCaptureTime += frameDuration;
        }

        // Continue if video is still playing and we need more frames
        if (!video.ended && !video.paused && frameIndex < totalFrames) {
          rafHandle = requestAnimationFrame(rafCallback);
        } else if (video.ended || frameIndex >= totalFrames) {
          // Capture any remaining frames
          while (frameIndex < totalFrames) {
            captureCurrentFrame();
            lastCaptureTime += frameDuration;
          }
          finish();
        }
      });

      video.addEventListener('ended', guarded(() => {
        if (isFinished) return;
        // Capture any remaining frames
        while (frameIndex < totalFrames) {
          captureCurrentFrame();
          lastCaptureTime += frameDuration;
        }
        finish();
      }));

      video.addEventListener('error', () => {
        fail(new Error('Video playback error'));
      });

      video.currentTime = 0;
      video.play().then(() => {
        rafHandle = requestAnimationFrame(rafCallback);
      }).catch(reject);
    }
  });
}

/**
 * Check if MP4 conversion is supported (requires WebCodecs)
 *
 * A *presence* check on the four globals, and deliberately cheap and
 * synchronous: it is what `convertToMP4` guards itself with, and what any
 * caller that needs an answer in the same tick can have. It says nothing about
 * whether this browser can actually encode H.264 or AAC — that question is
 * asynchronous, and `probeMP4Support()` below is the one that asks it.
 */
export function isMP4ConversionSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

/** The video bitrate an encode of this frame size is given. */
function videoBitrateForFrameSize(width: number, height: number): number {
  const pixels = width * height;
  if (pixels >= 1920 * 1080) {
    return 8_000_000; // 8 Mbps for 1080p+
  }
  if (pixels >= 1280 * 720) {
    return 5_000_000; // 5 Mbps for 720p
  }
  return 2_500_000; // 2.5 Mbps for smaller
}

/** H.264 High Profile Level 4.0 — what an MP4 conversion encodes video as. */
const MP4_VIDEO_CODEC = 'avc1.640028';
/** AAC-LC — what an MP4 conversion encodes audio as. */
const MP4_AUDIO_CODEC = 'mp4a.40.2';
const MP4_FRAME_RATE = 30;
const MP4_SAMPLE_RATE = 48000;

/**
 * The H.264 configuration `convertToMP4` will configure for a source of this
 * size. Declared once because `probeMP4Support()` has to ask the browser about
 * the *same* configuration: a probe of a different codec string, profile or
 * frame size answers a different question than the button is gating on.
 */
function mp4VideoEncoderConfig(width: number, height: number): VideoEncoderConfig {
  return {
    codec: MP4_VIDEO_CODEC,
    width,
    height,
    bitrate: videoBitrateForFrameSize(width, height),
    framerate: MP4_FRAME_RATE,
  };
}

/** The AAC configuration `convertToMP4` will configure — see above. */
const MP4_AUDIO_ENCODER_CONFIG: AudioEncoderConfig = {
  codec: MP4_AUDIO_CODEC,
  sampleRate: MP4_SAMPLE_RATE,
  numberOfChannels: 2,
  bitrate: 128000,
};

/**
 * The frame size the probe asks about. A recording's own size is not known
 * until one is picked, and the question being asked is whether the browser has
 * an H.264 encoder at all, so it asks about a representative 720p frame — the
 * middle rung of the bitrate ladder above.
 */
const PROBE_WIDTH = 1280;
const PROBE_HEIGHT = 720;

/**
 * What the codec probe found: two independent answers, each with its own
 * sentence — whether an MP4 can be offered at all, and whether AAC is there.
 *
 * `supported` and `audio` are separate because `convertToMP4` treats them
 * separately: no H.264 encoder is fatal, but no AAC encoder is not — the
 * conversion drops the audio and produces a working silent MP4. A probe that
 * refused there would disable a button that works.
 *
 * They are also separate in the *other* direction (ESCSUITE-61): the M4A
 * download needs AAC and nothing else, so a browser without an H.264 encoder
 * can still write one. `audio` therefore answers only about AAC, whatever the
 * H.264 answer was, and the two sentences are two fields — one gate must never
 * read the other's wording.
 */
export interface MP4SupportProbe {
  /** Whether a conversion can be run at all — the H.264 answer. */
  supported: boolean;
  /** Whether the browser has an AAC encoder, asked and answered on its own. */
  audio: boolean;
  /**
   * One user-facing sentence for why an MP4 cannot be written. Absent whenever
   * `supported` is true — a silent MP4 is not a refusal, and its warning is
   * `audioReason`.
   */
  reason?: string;
  /**
   * One user-facing sentence for the missing AAC encoder: what blocks an M4A
   * outright and what warns that an MP4 will be silent. Absent whenever
   * `audio` is true. Where the probe could not run at all it carries the same
   * sentence as `reason`, because neither question got an answer.
   */
  audioReason?: string;
}

export const MP4_NO_WEBCODECS_REASON =
  'This browser cannot convert to MP4 — it needs the WebCodecs API (Chrome or Edge).';
export const MP4_NO_H264_REASON =
  'This browser cannot encode H.264 video, which an MP4 needs.';
/**
 * Not a refusal: the conversion still runs, and the file it writes plays. This
 * is said under the library *before* the conversion, and again as
 * `MP4_SAVED_WITHOUT_AUDIO` (`utils/notices.ts`) after it.
 */
export const MP4_NO_AUDIO_REASON =
  'MP4 will have no audio in this browser (no AAC encoder)';
export const MP4_PROBE_FAILED_REASON =
  'This browser could not say whether it can encode MP4, so the conversion is not offered.';
/**
 * Why an audio-only conversion refused a take: there was no decodable audio in
 * it at all. The M4A button is disabled for a recording whose metadata says it
 * has no audio, so this is the defence behind that gate rather than the usual
 * way a user meets it — a take can also be *recorded* with a microphone that
 * produced silence the container never carried.
 *
 * Its pair is `NO_AUDIO_TRACK_REASON` in `hooks/useMp4Download.ts` ("This
 * recording has no audio"), which titles the disabled button for the same
 * fact. Two strings on purpose — that one is about a button, this one is
 * thrown and becomes a notice — and neither is canonical: change both or
 * neither.
 */
export const M4A_NO_AUDIO_MESSAGE = 'This recording has no audio track';

/**
 * Memoised for the life of the page: the answer cannot change while the tab is
 * open, and the UI asks on the way in rather than on the click path.
 */
let mp4SupportProbe: Promise<MP4SupportProbe> | null = null;

/**
 * Ask WebCodecs whether this browser can actually encode an MP4 — H.264 video
 * and AAC audio, in the same configuration `convertToMP4` will configure.
 *
 * The presence check above is not enough to gate the button on: WebCodecs
 * being there says nothing about which codecs are behind it, and a browser
 * without an H.264 encoder would otherwise be offered a conversion that fails
 * part-way. Never rejects — a probe that could not answer is an answer of
 * "no", with a reason, rather than an exception on a capability path.
 *
 * It answers the same way `convertToMP4` behaves, which is not symmetrical: no
 * H.264 encoder is fatal, no AAC encoder is `{ supported: true, audio: false }`
 * — the conversion drops the audio and the file still plays.
 *
 * The two questions are independent, and so are the answers: `audio` is the AAC
 * answer whatever H.264 said, with `audioReason` as its sentence. Folding it
 * into the H.264 verdict (ESCSUITE-61) disabled the M4A button in a browser
 * that could have written the file, and titled it with a sentence about video.
 *
 * What it cannot answer is *this* recording: it asks about a representative
 * 720p frame (see `PROBE_WIDTH`), so on a source larger than the level the
 * codec string allows, `configure()` can still fail and the conversion falls
 * back to the notice channel. Necessary, not sufficient — see "Download
 * Formats" in `apps/craft/CLAUDE.md`.
 */
export function probeMP4Support(): Promise<MP4SupportProbe> {
  mp4SupportProbe ??= askMP4Support();
  return mp4SupportProbe;
}

async function askMP4Support(): Promise<MP4SupportProbe> {
  // Neither question can be asked, so both carry the same sentence.
  if (!isMP4ConversionSupported()) {
    return {
      supported: false,
      audio: false,
      reason: MP4_NO_WEBCODECS_REASON,
      audioReason: MP4_NO_WEBCODECS_REASON,
    };
  }

  try {
    const [video, audio] = await Promise.all([
      VideoEncoder.isConfigSupported(mp4VideoEncoderConfig(PROBE_WIDTH, PROBE_HEIGHT)),
      AudioEncoder.isConfigSupported(MP4_AUDIO_ENCODER_CONFIG),
    ]);

    // Two answers, folded separately. The AAC answer is *not* the H.264
    // answer's consequence: what it gates is the M4A download, which needs no
    // video encoder at all. A missing AAC encoder is still not a refusal for
    // MP4 — `convertToMP4` drops the audio and muxes the video anyway, a few
    // hundred lines below — so it leaves `supported` alone and says its piece
    // through `audioReason`.
    //
    // `supported` is optional on the browser's answer, and an answer that did
    // not say is not a yes — the same reading the `!video.supported` test this
    // replaced had.
    const h264 = video.supported === true;
    const aac = audio.supported === true;
    return {
      supported: h264,
      audio: aac,
      ...(h264 ? {} : { reason: MP4_NO_H264_REASON }),
      ...(aac ? {} : { audioReason: MP4_NO_AUDIO_REASON }),
    };
  } catch (error) {
    // One question threw; neither was answered.
    console.warn('MP4 codec probe failed:', error);
    return {
      supported: false,
      audio: false,
      reason: MP4_PROBE_FAILED_REASON,
      audioReason: MP4_PROBE_FAILED_REASON,
    };
  }
}

/**
 * Fix WebM metadata for proper seeking and playback.
 * This is near-instant since it only rewrites container metadata
 * (Duration, SeekHead, Cues) without re-encoding video/audio.
 *
 * Uses webm-duration-fix which properly adds seek cues that
 * Windows Media Player and other players need for scrubbing.
 */
export async function fixWebMMetadata(webmBlob: Blob): Promise<Blob> {
  const fixedBlob = await fixWebmDuration(webmBlob);
  return fixedBlob;
}

/**
 * Extract audio from video blob using AudioContext
 */
async function extractAudio(
  blob: Blob,
  onProgress?: (progress: number) => void
): Promise<AudioBuffer | null> {
  // Declared out here so the finally below closes it however this leaves. The
  // one path that used to escape without closing was `blob.arrayBuffer()`
  // rejecting — between the context being constructed and the inner try that
  // owned the close — which left a live AudioContext per attempt.
  let audioContext: AudioContext | null = null;

  try {
    audioContext = new AudioContext({ sampleRate: 48000 });
    const arrayBuffer = await blob.arrayBuffer();

    onProgress?.(10);

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      onProgress?.(100);
      return audioBuffer;
    } catch {
      // No audio or unsupported format
      return null;
    }
  } catch {
    return null;
  } finally {
    // Null only where the constructor itself threw, which is the one case
    // with nothing to release.
    await audioContext?.close();
  }
}

/**
 * Convert AudioBuffer to interleaved Float32Array (stereo)
 */
function audioBufferToFloat32(audioBuffer: AudioBuffer): Float32Array {
  const sampleRate = 48000;
  const numSamples = Math.ceil(audioBuffer.duration * sampleRate);
  const result = new Float32Array(numSamples * 2); // Stereo

  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = audioBuffer.numberOfChannels > 1
    ? audioBuffer.getChannelData(1)
    : leftChannel;

  // Resample if needed
  const ratio = audioBuffer.sampleRate / sampleRate;

  for (let i = 0; i < numSamples; i++) {
    const srcIndex = Math.min(Math.floor(i * ratio), audioBuffer.length - 1);
    result[i * 2] = leftChannel[srcIndex];
    result[i * 2 + 1] = rightChannel[srcIndex];
  }

  return result;
}

/**
 * Encode interleaved stereo samples as AAC, one 1024-sample chunk at a time,
 * and flush the encoder when they are all in.
 *
 * Lifted out of `convertToMP4` unchanged so `convertToM4A` can run the same
 * pass without the video half: the two differ in what they mux, not in how the
 * audio is encoded, and a second copy of this loop would be a second place for
 * the planar layout, the abort cadence and the backpressure drain to drift.
 *
 * `audioData` arrives interleaved `[L, R, L, R, ...]` from
 * `audioBufferToFloat32`, while `AudioData`'s `f32-planar` wants
 * `[L, L, L, ..., R, R, R, ...]` — the per-chunk copy below is that transpose.
 *
 * Cancellation is checked before the first chunk and every hundredth after it,
 * which is the cadence `convertToMP4` has always used: often enough that a
 * cancel lands within a frame of audio, rarely enough that the check is not
 * itself part of the cost.
 *
 * `onProgress` receives the fraction of the audio encoded so far (0-1), for a
 * caller whose whole conversion *is* this loop. `convertToMP4` passes none:
 * its audio pass is the last tenth of a conversion that has already reported
 * one frame at a time.
 */
async function encodeAudioChunks(
  audioData: Float32Array,
  audioEncoder: AudioEncoder,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void
): Promise<void> {
  // Check for cancellation before audio encoding
  checkAborted(signal);

  const sampleRate = MP4_SAMPLE_RATE;
  const samplesPerChunk = 1024;
  const totalAudioSamples = audioData.length / 2; // Stereo, so divide by 2
  let audioTimestamp = 0;
  let chunkCount = 0;

  for (let offset = 0; offset < totalAudioSamples; offset += samplesPerChunk) {
    // Check for cancellation periodically during audio encoding
    if (chunkCount % 100 === 0) {
      checkAborted(signal);
    }
    chunkCount++;

    const chunkSize = Math.min(samplesPerChunk, totalAudioSamples - offset);

    // Create planar data: [all left samples][all right samples]
    const planarData = new Float32Array(chunkSize * 2);

    for (let i = 0; i < chunkSize; i++) {
      const srcIndex = offset + i;
      // Left channel goes first (indices 0 to chunkSize-1)
      planarData[i] = audioData[srcIndex * 2] || 0;
      // Right channel goes second (indices chunkSize to chunkSize*2-1)
      planarData[chunkSize + i] = audioData[srcIndex * 2 + 1] || 0;
    }

    const audioFrame = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: chunkSize,
      numberOfChannels: 2,
      timestamp: audioTimestamp,
      data: planarData,
    });

    audioEncoder.encode(audioFrame);
    audioFrame.close();

    audioTimestamp += (chunkSize / sampleRate) * 1_000_000;

    onProgress?.(Math.min(offset + chunkSize, totalAudioSamples) / totalAudioSamples);

    // Wait for encoder queue to drain (uses MessageChannel to avoid background tab throttling)
    while (audioEncoder.encodeQueueSize > 20) {
      await yieldToMain();
    }
  }

  // Flushed, not closed: every encoder a conversion builds is released in that
  // conversion's one `finally` (see `conversionEncoders`), which is the only
  // place that also runs for the conversions that never reach here.
  await audioEncoder.flush();
}

/**
 * Convert WebM blob to MP4
 * @param webmBlob - The WebM blob to convert
 * @param onProgress - Progress callback
 * @param signal - Optional AbortSignal for cancellation
 * @param composite - The take's camera half, when it has one, to draw back into
 *   the corner it was recorded in (ESCSUITE-14 decision 3). Absent for every
 *   other conversion, and absent is what keeps that path's per-frame work and
 *   its ceilings exactly what they were.
 */
export async function convertToMP4(
  webmBlob: Blob,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  composite?: CompositeOptions
): Promise<Blob> {
  if (!isMP4ConversionSupported()) {
    throw new Error('MP4 conversion requires WebCodecs API (Chrome/Edge)');
  }

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing conversion...' });

  // Create video element to read the WebM
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';

  const videoUrl = URL.createObjectURL(webmBlob);

  // The camera half's element, URL and header read, set up here rather than
  // inside the try for two reasons. The `finally` below has to be able to
  // release the URL however this function leaves; and a media element fires
  // `loadedmetadata` exactly once whether or not anything is listening, so the
  // listener has to be attached in the same synchronous step that sets `src`.
  // Starting the load here rather than awaiting it later also means the two
  // containers read their headers in parallel instead of one after the other.
  // `muted` for the same reason the screen element is: this file has no audio
  // track (the mix is on the primary), and nothing should be able to make a
  // noise out of a conversion.
  let companion: CompanionLoad | null = null;
  if (composite) {
    const companionVideo = document.createElement('video');
    companionVideo.playsInline = true;
    companionVideo.muted = true;
    companionVideo.preload = 'auto';
    const companionUrl = URL.createObjectURL(composite.companion.blob);
    companion = {
      video: companionVideo,
      url: companionUrl,
      loaded: new Promise<Error | null>((resolve) => {
        companionVideo.onloadedmetadata = () => resolve(null);
        companionVideo.onerror = () => resolve(new Error('Failed to load the webcam track'));
        companionVideo.src = companionUrl;
      }),
      placement: composite.companion.placement,
      startOffset: composite.companion.startOffset,
      onSkipped: composite.onCompanionSkipped,
    };
  }

  // Every encoder this conversion builds, and the signal its work runs under:
  // the caller's cancellation and any encoder's own failure, together. The
  // `finally` below releases whatever was built, however this function leaves.
  const encoders = conversionEncoders(signal);

  try {
    // Load video metadata
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
      video.src = videoUrl;
    });

    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = video.duration;
    const frameRate = MP4_FRAME_RATE;
    const totalFrames = Math.ceil(duration * frameRate);

    // The camera half, whose header was already being read while the screen's
    // was. Its geometry is built once, here, from the placement the take was
    // recorded with and the frame this conversion is actually encoding — see
    // `overlayGeometryFor`.
    let overlay: FrameOverlay | undefined;
    if (companion) {
      onProgress({ phase: 'preparing', progress: 3, message: 'Loading the webcam track…' });
      const failure = await companion.loaded;
      if (failure) {
        // A camera part that will not decode costs the take its overlay and
        // nothing else. Refusing here would spend the whole conversion and then
        // hand back no file at all, which is strictly worse than a screen-only
        // MP4 the caller is told about.
        console.warn('The webcam track could not be read; converting the screen alone:', failure);
        companion.onSkipped?.();
      } else {
        overlay = {
          video: companion.video,
          geometry: overlayGeometryFor(companion.placement, width),
          startOffset: companion.startOffset,
          // The same report the failure above makes, for the failure that only
          // a frame count can see (see `cleanup()` in
          // `captureFramesViaPlayback`).
          onSkipped: companion.onSkipped,
        };
      }
    }

    onProgress({ phase: 'preparing', progress: 5, message: 'Extracting audio...' });

    // Extract audio
    const audioBuffer = await extractAudio(webmBlob, (p) => {
      onProgress({ phase: 'preparing', progress: 5 + p * 0.1, message: 'Extracting audio...' });
    });

    let audioData: Float32Array | null = null;
    if (audioBuffer) {
      audioData = audioBufferToFloat32(audioBuffer);
    }

    onProgress({ phase: 'preparing', progress: 15, message: 'Initializing encoder...' });

    // Create Mediabunny output
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({
        fastStart: 'in-memory',
      }),
      target,
    });

    // Create video packet source
    const videoSource = new EncodedVideoPacketSource('avc');
    output.addVideoTrack(videoSource, { frameRate });

    // Create audio packet source if we have audio
    let audioSource: EncodedAudioPacketSource | null = null;

    if (audioData) {
      try {
        const support = await AudioEncoder.isConfigSupported(MP4_AUDIO_ENCODER_CONFIG);
        if (support.supported) {
          audioSource = new EncodedAudioPacketSource('aac');
          output.addAudioTrack(audioSource);
        } else {
          console.warn('AAC not supported, converting without audio');
          audioData = null;
        }
      } catch {
        console.warn('Failed to check AAC support, converting without audio');
        audioData = null;
      }
    }

    // Start the output
    await output.start();

    // Create video encoder
    const videoEncoder = encoders.register(new VideoEncoder({
      output: async (chunk, meta) => {
        await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: encoders.errorCallback('Video'),
    }));

    // The same configuration `probeMP4Support()` asked about, by construction.
    await videoEncoder.configure(mp4VideoEncoderConfig(width, height));

    // Create audio encoder if we have audio
    let audioEncoder: AudioEncoder | null = null;
    if (audioData && audioSource) {
      audioEncoder = encoders.register(new AudioEncoder({
        output: async (chunk, meta) => {
          await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
        },
        error: encoders.errorCallback('Audio'),
      }));

      await audioEncoder.configure(MP4_AUDIO_ENCODER_CONFIG);
    }

    onProgress({ phase: 'encoding', progress: 18, message: 'Encoding frames (playing video)...' });

    // Create canvas for frame capture
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false })!;

    // Use play-based frame capture (much faster than seek-based)
    await captureFramesViaPlayback(
      video,
      canvas,
      ctx,
      videoEncoder,
      frameRate,
      totalFrames,
      30, // keyframe every 30 frames (1 second)
      encoders.signal,
      (frameIndex, total) => {
        const progress = 18 + (frameIndex / total) * 70;
        onProgress({
          phase: 'encoding',
          progress,
          message: `Encoding frame ${frameIndex} of ${total}...`
        });
      },
      overlay
    );

    // Flush video encoder. It is not closed here: every encoder is released in
    // the one `finally` below, which is also the only place a conversion that
    // never got this far releases anything.
    await videoEncoder.flush();

    onProgress({ phase: 'encoding', progress: 90, message: 'Encoding audio...' });

    // Encode audio if we have it
    if (audioEncoder && audioData) {
      await encodeAudioChunks(audioData, audioEncoder, encoders.signal);
    }

    // The last moment at which no file has been written. An encoder can fail
    // between the audio pass's every-hundredth-chunk abort check and here, and
    // a file muxed out of a dead encoder's packets is a truncated file handed
    // over as a finished one.
    encoders.throwIfFailed();

    onProgress({ phase: 'finalizing', progress: 95, message: 'Finalizing MP4...' });

    // Finalize output
    await output.finalize();

    // Get the result blob
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('Conversion failed: no data was written to buffer');
    }
    const mp4Blob = new Blob([buffer], { type: 'video/mp4' });

    onProgress({ phase: 'finalizing', progress: 100, message: 'Conversion complete!' });

    return mp4Blob;
  } catch (error) {
    // An encoder that failed asynchronously stopped the work above by aborting
    // it, so what arrives here is that abort (or the flush that rejected
    // because the codec had closed itself) rather than the failure. The codec's
    // own words are what the notice should carry.
    throw encoders.translate(error);
  } finally {
    URL.revokeObjectURL(videoUrl);
    if (companion) {
      URL.revokeObjectURL(companion.url);
    }
    encoders.release();
  }
}

/**
 * Convert a recording to M4A: its audio alone, AAC in an MP4 container.
 *
 * The third download, and the only one that throws away picture. A mic-only
 * take is already an audio recording, but it is stored as an audio-only WebM,
 * which plays and is not an "audio file" to most tools; and `convertToMP4` is
 * no help there — it has no guard against a take with no picture, so it
 * configures a 0x0 video encoder and fails with whatever the browser says.
 * This produces `audio/mp4` — the `.m4a` every audio editor, podcast tool and
 * phone opens.
 *
 * It is the tail of `convertToMP4` and nothing else: extract, encode AAC, mux.
 * No `<video>`, no playback, no canvas, no `VideoFrame` — which is why it
 * costs a fraction of an MP4 conversion of the same take, and why it is the
 * one conversion that can be offered on a recording with no picture.
 *
 * **AAC is a hard requirement here**, unlike in `convertToMP4`, which drops
 * the audio and muxes a silent video when the browser has no AAC encoder.
 * There is no silent M4A worth writing, so this refuses — in the probe's own
 * words (`MP4_NO_AUDIO_REASON`), so the button's reason and the failure say
 * the same sentence.
 *
 * @param webmBlob - The recording to take the audio out of
 * @param onProgress - Progress callback
 * @param signal - Optional AbortSignal for cancellation
 */
export async function convertToM4A(
  webmBlob: Blob,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<Blob> {
  onProgress({ phase: 'preparing', progress: 0, message: 'Extracting audio…' });

  // The one encoder this conversion builds, and the signal its work runs
  // under — the caller's cancellation and the encoder's own failure, together.
  const encoders = conversionEncoders(signal);

  try {
    // Asked first, because it is the cheap half: the same question
    // `probeMP4Support()` asks, about the same configuration this configures
    // below. A browser that cannot answer is answering no — an encoder that
    // will not configure fails a few lines later anyway, and this way it fails
    // with a sentence rather than with whatever the API threw. Decoding the
    // whole file only to refuse it would be a gigabyte of work for an answer
    // available in a microsecond.
    let aacSupported = false;
    try {
      const support = await AudioEncoder.isConfigSupported(MP4_AUDIO_ENCODER_CONFIG);
      aacSupported = support.supported === true;
    } catch {
      console.warn('Failed to check AAC support, refusing the audio-only conversion');
    }
    if (!aacSupported) {
      throw new Error(MP4_NO_AUDIO_REASON);
    }

    const audioBuffer = await extractAudio(webmBlob, (p) => {
      onProgress({ phase: 'preparing', progress: p * 0.15, message: 'Extracting audio…' });
    });
    if (!audioBuffer) {
      throw new Error(M4A_NO_AUDIO_MESSAGE);
    }
    const audioData = audioBufferToFloat32(audioBuffer);

    // Create Mediabunny output — one audio track, and deliberately no video
    // track: an MP4 container carrying only sound is what `.m4a` names.
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({
        fastStart: 'in-memory',
      }),
      target,
    });

    const audioSource = new EncodedAudioPacketSource('aac');
    output.addAudioTrack(audioSource);

    await output.start();

    const audioEncoder = encoders.register(new AudioEncoder({
      output: async (chunk, meta) => {
        await audioSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: encoders.errorCallback('Audio'),
    }));

    await audioEncoder.configure(MP4_AUDIO_ENCODER_CONFIG);

    // The encode is the whole conversion here, so it owns the whole bar
    // between the extraction and the mux.
    await encodeAudioChunks(audioData, audioEncoder, encoders.signal, (fraction) => {
      onProgress({
        phase: 'encoding',
        progress: 15 + fraction * 80,
        message: 'Encoding audio…',
      });
    });

    // See `convertToMP4`: the encoder can die between the loop's last abort
    // check and the mux, and there is no such thing as a truncated M4A worth
    // handing over.
    encoders.throwIfFailed();

    onProgress({ phase: 'finalizing', progress: 95, message: 'Finalizing M4A…' });

    await output.finalize();

    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('Conversion failed: no data was written to buffer');
    }
    const m4aBlob = new Blob([buffer], { type: 'audio/mp4' });

    onProgress({ phase: 'finalizing', progress: 100, message: 'Conversion complete!' });

    return m4aBlob;
  } catch (error) {
    throw encoders.translate(error);
  } finally {
    encoders.release();
  }
}

/**
 * Check if WebM remuxing is supported (requires WebCodecs)
 */
export function isWebMRemuxSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

/**
 * Remux WebM blob to create a proper container with seek metadata
 * This re-encodes the video using WebCodecs + Mediabunny to produce
 * a WebM file that plays correctly in all players (including Windows Media Player)
 * @param webmBlob - The WebM blob to remux
 * @param duration - Known duration of the video
 * @param onProgress - Progress callback
 * @param signal - Optional AbortSignal for cancellation
 */
export async function remuxToWebM(
  webmBlob: Blob,
  duration: number,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<Blob> {
  if (!isWebMRemuxSupported()) {
    throw new Error('WebM remuxing requires WebCodecs API (Chrome/Edge)');
  }

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing WebM...' });

  // Create video element to read the source WebM
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';

  const videoUrl = URL.createObjectURL(webmBlob);

  // The same encoder hygiene the MP4 conversion has, through the same object:
  // one release point, and an asynchronous codec failure that reaches the
  // caller in the codec's own words.
  const encoders = conversionEncoders(signal);

  try {
    // Load video metadata
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
      video.src = videoUrl;
    });

    const width = video.videoWidth;
    const height = video.videoHeight;
    // Use the known duration rather than video.duration (which may be Infinity for MediaRecorder output)
    const videoDuration = isFinite(video.duration) ? video.duration : duration;
    const frameRate = 30;
    const totalFrames = Math.ceil(videoDuration * frameRate);

    onProgress({ phase: 'preparing', progress: 5, message: 'Extracting audio...' });

    // Extract audio
    const audioBuffer = await extractAudio(webmBlob, (p) => {
      onProgress({ phase: 'preparing', progress: 5 + p * 0.1, message: 'Extracting audio...' });
    });

    let audioData: Float32Array | null = null;
    if (audioBuffer) {
      audioData = audioBufferToFloat32(audioBuffer);
    }

    onProgress({ phase: 'preparing', progress: 15, message: 'Initializing encoder...' });

    // Create Mediabunny output with WebM format
    const target = new BufferTarget();
    const output = new Output({
      format: new WebMOutputFormat(),
      target,
    });

    // Create video packet source (VP9 for WebM)
    const videoSource = new EncodedVideoPacketSource('vp9');
    output.addVideoTrack(videoSource, { frameRate });

    // Create audio packet source if we have audio (Opus for WebM)
    let audioSource: EncodedAudioPacketSource | null = null;
    const sampleRate = 48000;

    if (audioData) {
      audioSource = new EncodedAudioPacketSource('opus');
      output.addAudioTrack(audioSource);
    }

    // Start the output
    await output.start();

    const videoBitrate = videoBitrateForFrameSize(width, height);

    // Create video encoder (VP9)
    const videoEncoder = encoders.register(new VideoEncoder({
      output: async (chunk, meta) => {
        await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: encoders.errorCallback('Video'),
    }));

    await videoEncoder.configure({
      codec: 'vp09.00.10.08', // VP9 Profile 0
      width,
      height,
      bitrate: videoBitrate,
      framerate: frameRate,
    });

    // Create audio encoder if we have audio (Opus)
    let audioEncoder: AudioEncoder | null = null;
    if (audioData && audioSource) {
      audioEncoder = encoders.register(new AudioEncoder({
        output: async (chunk, meta) => {
          await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
        },
        error: encoders.errorCallback('Audio'),
      }));

      await audioEncoder.configure({
        codec: 'opus',
        sampleRate,
        numberOfChannels: 2,
        bitrate: 128000,
      });
    }

    onProgress({ phase: 'encoding', progress: 18, message: 'Encoding frames (playing video)...' });

    // Create canvas for frame capture
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false })!;

    // Use play-based frame capture (much faster than seek-based)
    await captureFramesViaPlayback(
      video,
      canvas,
      ctx,
      videoEncoder,
      frameRate,
      totalFrames,
      frameRate * 2, // keyframe every 2 seconds for better seeking
      encoders.signal,
      (frameIndex, total) => {
        const progress = 18 + (frameIndex / total) * 70;
        onProgress({
          phase: 'encoding',
          progress,
          message: `Encoding frame ${frameIndex} of ${total}...`
        });
      }
    );

    // Flush video encoder. Released, like every encoder here, in the one
    // `finally` below.
    await videoEncoder.flush();

    onProgress({ phase: 'encoding', progress: 90, message: 'Encoding audio...' });

    // Encode audio if we have it
    if (audioEncoder && audioData) {
      // Check for cancellation before audio encoding
      checkAborted(encoders.signal);
      const samplesPerChunk = 1024;
      const totalAudioSamples = audioData.length / 2; // Stereo, so divide by 2
      let audioTimestamp = 0;
      let chunkCount = 0;

      for (let offset = 0; offset < totalAudioSamples; offset += samplesPerChunk) {
        // Check for cancellation periodically during audio encoding
        if (chunkCount % 100 === 0) {
          checkAborted(encoders.signal);
        }
        chunkCount++;

        const chunkSize = Math.min(samplesPerChunk, totalAudioSamples - offset);

        // Create planar data: [all left samples][all right samples]
        const planarData = new Float32Array(chunkSize * 2);

        for (let i = 0; i < chunkSize; i++) {
          const srcIndex = offset + i;
          // Left channel goes first (indices 0 to chunkSize-1)
          planarData[i] = audioData[srcIndex * 2] || 0;
          // Right channel goes second (indices chunkSize to chunkSize*2-1)
          planarData[chunkSize + i] = audioData[srcIndex * 2 + 1] || 0;
        }

        const audioFrame = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: chunkSize,
          numberOfChannels: 2,
          timestamp: audioTimestamp,
          data: planarData,
        });

        audioEncoder.encode(audioFrame);
        audioFrame.close();

        audioTimestamp += (chunkSize / sampleRate) * 1_000_000;

        // Wait for encoder queue to drain (uses MessageChannel to avoid background tab throttling)
        while (audioEncoder.encodeQueueSize > 20) {
          await yieldToMain();
        }
      }

      await audioEncoder.flush();
    }

    // See `convertToMP4`: no file is written out of an encoder that has died.
    encoders.throwIfFailed();

    onProgress({ phase: 'finalizing', progress: 95, message: 'Finalizing WebM...' });

    // Finalize output
    await output.finalize();

    // Get the result blob
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('Remuxing failed: no data was written to buffer');
    }
    const remuxedBlob = new Blob([buffer], { type: 'video/webm' });

    onProgress({ phase: 'finalizing', progress: 100, message: 'WebM ready!' });

    return remuxedBlob;
  } catch (error) {
    throw encoders.translate(error);
  } finally {
    URL.revokeObjectURL(videoUrl);
    encoders.release();
  }
}
