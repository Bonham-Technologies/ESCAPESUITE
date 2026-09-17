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
import fixWebmDuration from 'webm-duration-fix';

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
  onProgress?: (frameIndex: number, totalFrames: number) => void
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

    const cleanup = () => {
      isFinished = true;
      if (rvfcHandle !== null && hasRVFC) {
        (video as HTMLVideoElementWithRVFC).cancelVideoFrameCallback(rvfcHandle);
      }
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
      video.pause();
    };

    const onAbort = () => {
      cleanup();
      reject(new ConversionAbortedError());
    };

    signal?.addEventListener('abort', onAbort);

    const captureCurrentFrame = () => {
      if (frameIndex >= totalFrames || isFinished) return false;

      // Draw current frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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

    if (hasRVFC) {
      // Use requestVideoFrameCallback for precise frame capture
      const rvfcCallback = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
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
      };

      video.addEventListener('ended', () => {
        if (isFinished) return;
        // Capture any remaining frames using the last displayed frame
        while (frameIndex < totalFrames) {
          captureCurrentFrame();
          lastCaptureTime += frameDuration;
        }
        cleanup();
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });

      video.addEventListener('error', () => {
        cleanup();
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('Video playback error'));
      });

      rvfcHandle = (video as HTMLVideoElementWithRVFC).requestVideoFrameCallback(rvfcCallback);
      video.currentTime = 0;
      video.play().catch(reject);
    } else {
      // Fallback: use requestAnimationFrame with time-based capture
      const rafCallback = () => {
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
          cleanup();
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }
      };

      video.addEventListener('ended', () => {
        if (isFinished) return;
        // Capture any remaining frames
        while (frameIndex < totalFrames) {
          captureCurrentFrame();
          lastCaptureTime += frameDuration;
        }
        cleanup();
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });

      video.addEventListener('error', () => {
        cleanup();
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('Video playback error'));
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
 * What the codec probe found: whether an MP4 can be offered at all, whether it
 * will have sound, and the one sentence that says what is missing.
 *
 * `supported` and `audio` are separate because `convertToMP4` treats them
 * separately: no H.264 encoder is fatal, but no AAC encoder is not — the
 * conversion drops the audio and produces a working silent MP4. A probe that
 * refused there would disable a button that works.
 */
export interface MP4SupportProbe {
  /** Whether a conversion can be run at all. */
  supported: boolean;
  /** Whether that conversion will have sound. */
  audio: boolean;
  /** One user-facing sentence naming what is missing. Absent when all is well. */
  reason?: string;
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
  if (!isMP4ConversionSupported()) {
    return { supported: false, audio: false, reason: MP4_NO_WEBCODECS_REASON };
  }

  try {
    const [video, audio] = await Promise.all([
      VideoEncoder.isConfigSupported(mp4VideoEncoderConfig(PROBE_WIDTH, PROBE_HEIGHT)),
      AudioEncoder.isConfigSupported(MP4_AUDIO_ENCODER_CONFIG),
    ]);

    if (!video.supported) {
      return { supported: false, audio: false, reason: MP4_NO_H264_REASON };
    }
    if (!audio.supported) {
      // What `convertToMP4` does with this same answer, a few hundred lines
      // below: drop the audio and mux the video anyway.
      return { supported: true, audio: false, reason: MP4_NO_AUDIO_REASON };
    }
    return { supported: true, audio: true };
  } catch (error) {
    console.warn('MP4 codec probe failed:', error);
    return { supported: false, audio: false, reason: MP4_PROBE_FAILED_REASON };
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
  try {
    const audioContext = new AudioContext({ sampleRate: 48000 });
    const arrayBuffer = await blob.arrayBuffer();

    onProgress?.(10);

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      onProgress?.(100);
      await audioContext.close();
      return audioBuffer;
    } catch {
      // No audio or unsupported format
      await audioContext.close();
      return null;
    }
  } catch {
    return null;
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
 * Convert WebM blob to MP4
 * @param webmBlob - The WebM blob to convert
 * @param onProgress - Progress callback
 * @param signal - Optional AbortSignal for cancellation
 */
export async function convertToMP4(
  webmBlob: Blob,
  onProgress: ProgressCallback,
  signal?: AbortSignal
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

  // Declared out here so the finally below can release them however this
  // function leaves — including a cancellation between the two encode passes.
  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;

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
    const sampleRate = MP4_SAMPLE_RATE;

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
    videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: (e) => {
        console.error('Video encoder error:', e);
      },
    });

    // The same configuration `probeMP4Support()` asked about, by construction.
    await videoEncoder.configure(mp4VideoEncoderConfig(width, height));

    // Create audio encoder if we have audio
    if (audioData && audioSource) {
      audioEncoder = new AudioEncoder({
        output: async (chunk, meta) => {
          await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
        },
        error: (e) => {
          console.error('Audio encoder error:', e);
        },
      });

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
      signal,
      (frameIndex, total) => {
        const progress = 18 + (frameIndex / total) * 70;
        onProgress({
          phase: 'encoding',
          progress,
          message: `Encoding frame ${frameIndex} of ${total}...`
        });
      }
    );

    // Flush video encoder
    await videoEncoder.flush();
    videoEncoder.close();

    onProgress({ phase: 'encoding', progress: 90, message: 'Encoding audio...' });

    // Encode audio if we have it
    // Note: audioData is interleaved [L, R, L, R, ...] but AudioData f32-planar
    // expects planar format [L, L, L, ..., R, R, R, ...]
    if (audioEncoder && audioData) {
      // Check for cancellation before audio encoding
      checkAborted(signal);

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

        // Wait for encoder queue to drain (uses MessageChannel to avoid background tab throttling)
        while (audioEncoder.encodeQueueSize > 20) {
          await yieldToMain();
        }
      }

      await audioEncoder.flush();
      audioEncoder.close();
    }

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
  } finally {
    URL.revokeObjectURL(videoUrl);
    // Both encoders are already closed on the success path; this releases them
    // when the conversion left early (cancellation, or a failure part-way).
    if (videoEncoder && videoEncoder.state !== 'closed') {
      videoEncoder.close();
    }
    if (audioEncoder && audioEncoder.state !== 'closed') {
      audioEncoder.close();
    }
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

  // Declared out here so the finally below can release them however this
  // function leaves — including a cancellation between the two encode passes.
  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;

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
    videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: (e) => {
        console.error('Video encoder error:', e);
      },
    });

    await videoEncoder.configure({
      codec: 'vp09.00.10.08', // VP9 Profile 0
      width,
      height,
      bitrate: videoBitrate,
      framerate: frameRate,
    });

    // Create audio encoder if we have audio (Opus)
    if (audioData && audioSource) {
      audioEncoder = new AudioEncoder({
        output: async (chunk, meta) => {
          await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
        },
        error: (e) => {
          console.error('Audio encoder error:', e);
        },
      });

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
      signal,
      (frameIndex, total) => {
        const progress = 18 + (frameIndex / total) * 70;
        onProgress({
          phase: 'encoding',
          progress,
          message: `Encoding frame ${frameIndex} of ${total}...`
        });
      }
    );

    // Flush video encoder
    await videoEncoder.flush();
    videoEncoder.close();

    onProgress({ phase: 'encoding', progress: 90, message: 'Encoding audio...' });

    // Encode audio if we have it
    if (audioEncoder && audioData) {
      // Check for cancellation before audio encoding
      checkAborted(signal);
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

        // Wait for encoder queue to drain (uses MessageChannel to avoid background tab throttling)
        while (audioEncoder.encodeQueueSize > 20) {
          await yieldToMain();
        }
      }

      await audioEncoder.flush();
      audioEncoder.close();
    }

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
  } finally {
    URL.revokeObjectURL(videoUrl);
    // Both encoders are already closed on the success path; this releases them
    // when the conversion left early (cancellation, or a failure part-way).
    if (videoEncoder && videoEncoder.state !== 'closed') {
      videoEncoder.close();
    }
    if (audioEncoder && audioEncoder.state !== 'closed') {
      audioEncoder.close();
    }
  }
}
