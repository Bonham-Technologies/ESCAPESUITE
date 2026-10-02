// Shared types, constants, and utility functions for the export pipeline

import type { Clip, Track, ExportOptions, ExportProgress, BlendMode, SourceVideo } from '../store/types';
import type { PresetSide } from '../utils/animation';

/**
 * A drawable media source that can be used with canvas drawImage.
 * Includes VideoFrame (from WebCodecs), HTMLVideoElement, and HTMLImageElement.
 */
export type DrawableMediaSource = VideoFrame | HTMLVideoElement | HTMLImageElement;

/**
 * Get dimensions from a drawable source
 */
export function getSourceDimensions(source: DrawableMediaSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth || 1920, height: source.videoHeight || 1080 };
  } else if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth || 1920, height: source.naturalHeight || 1080 };
  } else if ('displayWidth' in source) {
    // VideoFrame
    return { width: source.displayWidth, height: source.displayHeight };
  }
  return { width: 1920, height: 1080 };
}

// Helper to get transition info between clips
export interface TransitionInfo {
  outgoingClip: Clip;
  incomingClip: Clip;
  progress: number; // 0 = start of transition, 1 = end
  type: import('../store/types').TransitionType;
}

export function getActiveTransition(clips: Clip[], tracks: Track[], time: number): TransitionInfo | null {
  // Find clips that are in a transition period
  for (const clip of clips) {
    if (clip.transition.type === 'none' || clip.transition.duration <= 0) continue;

    const track = tracks.find(t => t.id === clip.trackId);
    if (!track || !track.visible) continue;

    const clipEnd = clip.timelinePosition + clip.duration;
    const transitionStart = clipEnd - clip.transition.duration;

    // Check if we're in the transition period
    if (time >= transitionStart && time < clipEnd) {
      // Find the incoming clip - first check same track, then look at other tracks
      // The incoming clip should be the one that will be visible when this clip ends

      // First, try to find a clip on the same track that starts at/near the end of this clip
      let incomingClip = clips
        .filter(c => c.trackId === clip.trackId && c.timelinePosition >= clipEnd - 0.01 && c.id !== clip.id)
        .sort((a, b) => a.timelinePosition - b.timelinePosition)[0];

      // If no same-track clip, find the topmost clip that will be visible at the end time
      // (excluding the current clip and overlays)
      if (!incomingClip) {
        const clipsAtEnd = clips
          .filter(c => {
            if (c.id === clip.id) return false;
            if (c.overlayType) return false; // Skip overlays
            const cEnd = c.timelinePosition + c.duration;
            return c.timelinePosition <= clipEnd && cEnd > clipEnd;
          })
          .map(c => {
            const t = tracks.find(tr => tr.id === c.trackId);
            return { clip: c, track: t };
          })
          .filter(({ track: t }) => t && t.visible)
          .sort((a, b) => (b.track?.index ?? 0) - (a.track?.index ?? 0)); // Higher index = on top

        if (clipsAtEnd.length > 0) {
          incomingClip = clipsAtEnd[0].clip;
        }
      }

      if (incomingClip) {
        const progress = (time - transitionStart) / clip.transition.duration;
        return {
          outgoingClip: clip,
          incomingClip,
          progress: Math.min(1, Math.max(0, progress)),
          type: clip.transition.type,
        };
      }
    }
  }
  return null;
}

/**
 * The clip-relative time to evaluate the incoming clip's *animation* at,
 * during a transition (ESCSUITE-133).
 *
 * The same-track case `getActiveTransition` looks for first places the
 * incoming clip's `timelinePosition` at or after the outgoing clip's end, so
 * a plain `currentTime - incomingClip.timelinePosition` is negative for the
 * whole transition — the renderer was asking for the clip's animated state
 * (opacity, transform, blur) at a time the *frame* it was handed does not
 * correspond to: the frame fetch (`exportMP4.ts`'s `inSourceTime`) already
 * clamps to the incoming clip's first frame in this same case. Shared by
 * `drawTransition` and `drawTransitionWithFrames` — the two functions the
 * preview and both exporters draw a transition's incoming side through — so
 * the clamp can't drift between them.
 *
 * This does not, on its own, make a `fade` in-preset visible during the
 * transition: `interpolateKeyframes` already floors any time at or before a
 * property's first keyframe to that keyframe's own value, so 0 and any more
 * negative time read identically for every preset in this codebase (all of
 * which place their first keyframe at time 0 or later). What it fixes is the
 * inconsistency the finding names — the animated state and the frame it is
 * drawn onto now agree on which instant of the clip they are both showing.
 */
export function getIncomingClipTime(transition: TransitionInfo, currentTime: number): number {
  return Math.max(0, currentTime - transition.incomingClip.timelinePosition);
}

export type ProgressCallback = (progress: ExportProgress) => void;

/**
 * Error thrown when export is cancelled by user
 */
export class ExportAbortedError extends Error {
  constructor() {
    super('Export was cancelled');
    this.name = 'ExportAbortedError';
  }
}

/**
 * Structured log entry for export diagnostics. Shared by both exporters so a
 * failure from either carries the same shape of trail (`ExportError` below).
 */
export interface ExportLogEntry {
  phase: string;
  detail: string;
  timestamp: number;
}

/**
 * Error class that carries the export diagnostic log for debugging. Lives
 * here (rather than in exportMP4.ts, where it was first written) so both
 * exporters can throw and catch it without one importing from the other;
 * exportMP4.ts re-exports it so every existing caller and test import is
 * untouched.
 */
export class ExportError extends Error {
  public readonly exportLog: ExportLogEntry[];
  public readonly frameIndex: number | undefined;
  public readonly totalFrames: number | undefined;

  constructor(message: string, exportLog: ExportLogEntry[], frameIndex?: number, totalFrames?: number) {
    super(message);
    this.name = 'ExportError';
    this.exportLog = exportLog;
    this.frameIndex = frameIndex;
    this.totalFrames = totalFrames;
  }
}

/**
 * Check if abort was requested and throw if so
 */
export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ExportAbortedError();
  }
}

// Map blend modes to canvas globalCompositeOperation
export const blendModeToCanvas: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  add: 'lighter',
};

/**
 * Check if WebCodecs export is supported
 */
export function isMP4ExportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

/**
 * What `findSupportedVideoConfig` found: the config to actually `configure()`
 * the encoder with, and the exact candidate (from the caller's own input
 * list) that was found supported.
 *
 * These can differ: `support.config` is the browser's own normalised answer
 * when it offers one, and nothing requires it to echo the candidate's `codec`
 * string unchanged (a browser is free to rewrite `'vp8'` into a fuller
 * `'vp08.00.10.08'`, say). A caller that needs to know *which configuration
 * it asked for* — `exportWebM.ts` labelling its muxer track VP9 or VP8 — reads
 * `candidate`, never `config`, because `candidate` is the object the caller
 * itself constructed and never touched by the browser (review round 1,
 * MINOR 3: the original code pattern-matched `config.codec`, which is latent
 * rather than live only because Chromium happens to echo the string today).
 */
export interface SupportedVideoConfig {
  config: VideoEncoderConfig;
  candidate: VideoEncoderConfig;
}

/**
 * Try each video encoder config in order and return the first one
 * `VideoEncoder.isConfigSupported` accepts — or `null` once every candidate
 * has been asked and none were. A config whose probe throws is skipped
 * rather than treated as a refusal, the same way a real `isConfigSupported()`
 * call that rejects is not a "no".
 *
 * Shared by the MP4 H.264 ladder (`exportMP4.ts`) and the WebM VP9/VP8 probe
 * below (ESCSUITE-29 Mechanism 1: before this, `exportWebM.ts` asked nothing
 * at all and hard-coded `vp09.00.10.08`), so there is exactly one place that
 * decides what "this browser can encode that" means for a codec list.
 */
export async function findSupportedVideoConfig(
  configs: VideoEncoderConfig[]
): Promise<SupportedVideoConfig | null> {
  for (const config of configs) {
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return { config: support.config || config, candidate: config };
      }
    } catch {
      // This codec isn't supported, try the next one.
    }
  }
  return null;
}

/**
 * The WebM video ladder: VP9 first (smaller files, and the codec
 * `exportWebM.ts` always configured regardless of whether this call ever
 * answered), VP8 as the fallback every Matroska-capable browser still has.
 * A function rather than a constant so the bitrate/framerate the probe asks
 * about can be the export's own — `isWebMExportSupported` and `exportToWebM`
 * call it with the same arguments, so the probe and the real `configure()`
 * never ask a different question.
 */
export function webMVideoCodecConfigs(
  width: number,
  height: number,
  videoBitrate: number,
  frameRate: number
): VideoEncoderConfig[] {
  return [
    { codec: 'vp09.00.10.08', width, height, bitrate: videoBitrate, framerate: frameRate, latencyMode: 'quality' },
    { codec: 'vp8', width, height, bitrate: videoBitrate, framerate: frameRate, latencyMode: 'quality' },
  ];
}

/**
 * A representative bitrate/framerate for the export dialog's up-front probe.
 * The dialog asks before the user has chosen a quality setting — `quality`
 * only scales bitrate, never which codecs exist — so one fixed, reasonable
 * figure is enough to answer "can this browser encode WebM at all", the same
 * reasoning CRAFT's own `probeMP4Support()` documents for probing at a
 * representative size instead of the take's own.
 */
const WEBM_PROBE_BITRATE = 5_000_000;
const WEBM_PROBE_FRAMERATE = 30;

/**
 * Shown in the export dialog when neither WebM nor MP4 can be exported at
 * all — no WebCodecs in this browser (Firefox/Safari before their recent
 * `VideoEncoder` support landed, and anything that disables it).
 */
export const EXPORT_NO_WEBCODECS_REASON =
  'Exporting needs WebCodecs, which this browser does not provide. Chrome or Edge can export this project.';

/**
 * Shown in the export dialog when `VideoEncoder` exists but this browser can
 * configure neither VP9 nor VP8 — the failure ESCSUITE-29 traced: a browser
 * that passes a bare "does WebCodecs exist" check and then fails opaquely
 * mid-export because nothing ever asked the codec itself.
 */
export const WEBM_NO_CODEC_REASON =
  'This browser cannot encode WebM video — Chrome or Edge can.';

/**
 * Whether the two WebCodecs globals WebM encoding needs — `VideoEncoder` and
 * `VideoFrame`, not `VideoDecoder`, since WebM never decodes through
 * WebCodecs (`exportWebM.ts` seeks `HTMLVideoElement`s directly) — both
 * exist. The one predicate `isWebMExportSupported` and `exportToWebM`'s own
 * early guard both call (review round 1, MAJOR 2(d)): written twice, the two
 * copies can drift independently and a mutation to either one's `||` can go
 * unnoticed by a suite that only ever removes both globals together.
 */
export function hasWebMEncodeGlobals(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Check if WebM export via WebCodecs is supported.
 *
 * Unlike `isMP4ExportSupported()` this is a real probe, not a boolean read of
 * which globals exist (ESCSUITE-22/29: it used to be
 * `return isMP4ExportSupported();`, which answered "yes" for any browser with
 * WebCodecs even when that browser's `VideoEncoder` cannot configure VP9 *or*
 * VP8 — the export would then fail opaquely partway through).
 *
 * `width`/`height` should be the size the export will actually configure the
 * encoder at — which, once a resolution preset is chosen, is
 * `getResolution(preset, …)`'s answer, not necessarily the raw project
 * resolution (review round 1, MINOR 2: `ExportDialog` passes
 * `getResolution(advancedOptions.resolution, …)` and re-probes when the
 * preset changes, precisely so a project whose native size this browser
 * cannot configure doesn't read as unsupported when a smaller preset would
 * have worked). This function itself takes whatever size it is given; it has
 * no opinion on which one that should be.
 */
export async function isWebMExportSupported(width: number, height: number): Promise<boolean> {
  if (!hasWebMEncodeGlobals()) {
    return false;
  }
  const found = await findSupportedVideoConfig(
    webMVideoCodecConfigs(width, height, WEBM_PROBE_BITRATE, WEBM_PROBE_FRAMERATE)
  );
  return found !== null;
}

/**
 * Wait for a WebCodecs encoder's queue to drain before handing it another
 * frame, the way both exporters guard against unbounded memory growth — but
 * read the encoder's own asynchronous `error:` callback while waiting
 * (`getError`) and give up after `timeoutMs` of no progress, rather than
 * waiting forever on an encoder that silently wedged (ESCSUITE-29: before
 * this, `exportWebM.ts`'s wait read neither).
 *
 * A free function with injectable `now`/`sleep` rather than inline in the
 * frame loop so both branches — the error arriving mid-wait, and the
 * timeout — are each a direct unit test instead of needing a real encoder
 * double to actually stall for 30 real seconds.
 */
export async function waitForEncoderBackpressure(params: {
  encoder: { encodeQueueSize: number };
  threshold: number;
  getError: () => Error | null;
  log: (phase: string, detail: string) => void;
  exportLog: ExportLogEntry[];
  frameIndex: number;
  totalFrames: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const {
    encoder,
    threshold,
    getError,
    log,
    exportLog,
    frameIndex,
    totalFrames,
    timeoutMs = 30000,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = params;

  const start = now();
  while (encoder.encodeQueueSize > threshold) {
    const err = getError();
    if (err) {
      log('error', `Encoder error during backpressure: ${err.message}`);
      throw err;
    }
    if (now() - start > timeoutMs) {
      log('fatal', `Backpressure timeout at frame ${frameIndex}, queue size: ${encoder.encodeQueueSize}`);
      throw new ExportError(
        'Video encoder backpressure timeout - encoder may be stuck',
        exportLog,
        frameIndex,
        totalFrames
      );
    }
    await sleep(5);
  }
}

/**
 * Get quality settings based on quality option
 */
export function getQualitySettings(quality: ExportOptions['quality']) {
  switch (quality) {
    case 'low':
      return { videoBitrate: 2_000_000, audioBitrate: 128_000 };
    case 'medium':
      return { videoBitrate: 5_000_000, audioBitrate: 192_000 };
    case 'high':
      return { videoBitrate: 10_000_000, audioBitrate: 256_000 };
  }
}

/**
 * Base (pre-scaling) dimensions for an export: the source dimensions of the
 * bottom-most media clip (lowest track index). Overlay clips are skipped.
 * Falls back to 1080p for overlay-only timelines. Shared by the MP4 and WebM
 * exporters and by the headless renderer's output metadata.
 */
export function getBaseDimensions(
  clips: Clip[],
  tracks: Track[],
  sourceVideos: SourceVideo[]
): { width: number; height: number } {
  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  const trackIndex = (trackId: string) => tracks.find(t => t.id === trackId)?.index ?? 0;
  const sortedClips = [...clips].sort((a, b) => trackIndex(a.trackId) - trackIndex(b.trackId));
  for (const clip of sortedClips) {
    if (clip.overlayType) continue;
    const source = sourceMap.get(clip.sourceVideoId);
    if (source && source.width && source.height) {
      return { width: source.width, height: source.height };
    }
  }
  return { width: 1920, height: 1080 };
}

/**
 * Get resolution dimensions.
 * When resolution is 'project', uses projectResolution if provided, falling
 * back to the source video's own dimensions otherwise.
 *
 * A preset (1080p, 720p, 480p) is a **height**, and the box it fills is the
 * **project's** shape: width = round-to-even(height x project aspect). It used
 * to take that aspect from `getBaseDimensions` — the bottom clip's source — so a
 * 16:9 project whose bottom clip happened to be 4:3 exported 960x720 for "720p"
 * (ESCSUITE-94). Only a caller with no project resolution at all falls back to
 * the source aspect, which is the same fallback 'project' itself takes.
 *
 * There used to be a fourth option, 'original', which took the source video's
 * dimensions regardless of the project's own shape — the one case that could
 * still letterbox after ESCSUITE-94, and one no UI ever offered (only a
 * hand-built headless job spec could reach it). ESCSUITE-111 dropped it rather
 * than fix it: every reachable resolution now follows the project's aspect.
 *
 * `resolution` is exactly `'project' | '1080p' | '720p' | '480p' | '360p'` now
 * (ESCSUITE-34 added the last of those, which only the GIF format offers — see
 * {@link resolutionForFormat}), so a preset name outside that list can only
 * reach this function by bypassing the type system — there is no longer a typed
 * caller (the export dialog, the three exporters, or a validated headless job
 * spec) that can construct one. That used to fall back silently to
 * `originalHeight`, which produced a plausible-looking but meaningless size; it
 * now throws instead (review round 1, ESCSUITE-111).
 */
export function getResolution(
  resolution: ExportOptions['resolution'],
  originalWidth: number,
  originalHeight: number,
  projectResolution?: { width: number; height: number }
): { width: number; height: number } {
  if (resolution === 'project' && projectResolution) {
    return {
      width: projectResolution.width % 2 === 0 ? projectResolution.width : projectResolution.width + 1,
      height: projectResolution.height % 2 === 0 ? projectResolution.height : projectResolution.height + 1,
    };
  }

  if (resolution === 'project') {
    // No projectResolution provided: fall back to the source's own dimensions.
    return {
      width: originalWidth % 2 === 0 ? originalWidth : originalWidth + 1,
      height: originalHeight % 2 === 0 ? originalHeight : originalHeight + 1
    };
  }

  const targetHeights: Partial<Record<'1080p' | '720p' | '480p' | '360p', number>> = {
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
    '360p': 360,
  };

  const targetHeight = targetHeights[resolution];
  if (targetHeight === undefined) {
    throw new Error(`getResolution: unknown resolution "${String(resolution)}"`);
  }
  const aspectSource =
    projectResolution && projectResolution.width > 0 && projectResolution.height > 0
      ? projectResolution
      : { width: originalWidth, height: originalHeight };
  const aspectRatio = aspectSource.width / aspectSource.height;
  const width = Math.round(targetHeight * aspectRatio);

  return {
    width: width % 2 === 0 ? width : width + 1,
    height: targetHeight % 2 === 0 ? targetHeight : targetHeight + 1,
  };
}

// ---------------------------------------------------------------------------
// GIF (ESCSUITE-34)
// ---------------------------------------------------------------------------

/**
 * The frame rates the GIF export offers. Low by design: a GIF carries one
 * 256-colour palette and one LZW-compressed bitmap per frame, so its size is
 * roughly linear in the frame count, and the format stores each frame's delay
 * in **centiseconds** — 20 fps (50 ms) and 10 fps (100 ms) are exact, while
 * 15 fps (67 ms) rounds to 7 cs and really plays at about 14.3 fps.
 */
export const GIF_FPS_OPTIONS = [10, 15, 20] as const;

export type GifFps = (typeof GIF_FPS_OPTIONS)[number];

export const DEFAULT_GIF_FPS: GifFps = 15;

/**
 * The frame rate an export will actually use, from whatever `options.fps`
 * carried. Anything that is not one of the three offered rates — `undefined`
 * from every caller that predates GIF export, a stale saved setting, a
 * hand-built headless job spec — lands on the default rather than being
 * encoded at.
 */
export function gifFrameRate(fps: number | undefined): GifFps {
  return fps !== undefined && (GIF_FPS_OPTIONS as readonly number[]).includes(fps)
    ? (fps as GifFps)
    : DEFAULT_GIF_FPS;
}

/**
 * The on-screen time one GIF frame ends up with, in milliseconds, as the file
 * **stores** it — which is not `1000 / fps`.
 *
 * There are two roundings between a frame rate and a delay, and this is the only
 * place both live. `exportGIF.ts` asks the writer for `round(1000 / rate)` ms,
 * and `gifenc` puts `round(delay / 10)` **centiseconds** into each frame's
 * Graphic Control Extension (`gifEncoder.ts`, pinned by `gifEncoder.test.ts`'s
 * decode of that block). So 10 fps (100 ms) and 20 fps (50 ms) survive both
 * exactly, while 15 fps asks for 67 ms and is written as 7 cs = 70 ms — a GIF
 * labelled 15 fps really plays at about 14.3, and `frames x 70` is what `ffprobe`
 * will report for its duration.
 *
 * `headless/renderProject.ts` reports a GIF's `durationSec` from this, so a
 * verification manifest describes the delivered bytes rather than the request.
 * The rate (and its default) comes from {@link gifFrameRate}, so there is no
 * second fallback here.
 */
export function gifFrameDelayMs(fps: number | undefined): number {
  return Math.round(Math.round(1000 / gifFrameRate(fps)) / 10) * 10;
}

/**
 * The resolution presets GIF offers, and only GIF. A GIF at 1080p is enormous
 * and a GIF at the project's own resolution is unpredictable, so the list is
 * three fixed heights with the project's aspect — `getResolution` does the
 * actual arithmetic, the same way it does for the video formats.
 */
export const GIF_RESOLUTIONS = ['720p', '480p', '360p'] as const;

export const DEFAULT_GIF_RESOLUTION: ExportOptions['resolution'] = '480p';

/**
 * The resolution preset a format can actually be exported at, given the one
 * currently selected.
 *
 * `'360p'` is on the shared `ExportOptions['resolution']` union — one union, one
 * `getResolution`, one headless `RESOLUTIONS` list — and this is the function
 * that keeps it GIF-only. Both directions matter: switching **to** GIF from
 * `'project'` or `'1080p'` lands on 480p (GIF offers neither), and switching
 * **away** from GIF while 360p is selected lands on 480p too (no video preset is
 * 360p). Pure, so the dialog's radios and a headless validator read the same
 * rule.
 */
export function resolutionForFormat(
  format: ExportOptions['format'],
  resolution: ExportOptions['resolution']
): ExportOptions['resolution'] {
  if (format === 'gif') {
    return (GIF_RESOLUTIONS as readonly string[]).includes(resolution)
      ? resolution
      : DEFAULT_GIF_RESOLUTION;
  }
  return resolution === '360p' ? '480p' : resolution;
}

/** Past this many seconds of output, the dialog warns (but never refuses). */
export const GIF_LONG_RANGE_SECONDS = 30;

/**
 * Shown beside the GIF controls when the export would be longer than
 * {@link GIF_LONG_RANGE_SECONDS}. A warning, not a gate: a long GIF is a
 * legitimate thing to want, it is just usually not what someone meant.
 */
export const GIF_LONG_RANGE_WARNING =
  'GIFs above 30 seconds get large; consider WebM.';

/**
 * Shown alongside {@link EXPORT_NO_WEBCODECS_REASON}, because "this browser
 * cannot export" stopped being true when GIF landed: `gifenc` is pure
 * JavaScript, so the one format that needs no WebCodecs at all is still there.
 */
export const GIF_ALWAYS_AVAILABLE_NOTE =
  'GIF export needs no WebCodecs — choose GIF under Advanced options to export anyway.';

/**
 * Whether GIF export is possible. It always is.
 *
 * A function rather than a `true` constant so the export dialog reads all three
 * formats' support the same way, and so a future reason to refuse (a missing
 * `getImageData`, say) has one place to live. This is the asymmetry
 * `apps/artist/CLAUDE.md`'s "Export Dialog Browser Support" section describes:
 * MP4's support is a synchronous globals check, WebM's is a real asynchronous
 * codec probe, and GIF's is a constant.
 */
export function isGIFExportSupported(): boolean {
  return true;
}

/**
 * Load a video blob and create an HTMLVideoElement
 */
export async function loadVideoElement(blob: Blob): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.muted = true;

    const url = URL.createObjectURL(blob);
    video.src = url;

    video.onloadeddata = () => {
      resolve(video);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video'));
    };
  });
}

/**
 * Load an image blob and create an HTMLImageElement
 */
export async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(blob);
    img.src = url;

    img.onload = () => {
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
  });
}

/**
 * Yield to allow other tasks to run without being throttled in background tabs.
 * Uses MessageChannel which is not subject to the same throttling as setTimeout.
 */
export function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

// Transition modifiers for drawing clips during transitions
export interface TransitionModifiers {
  opacity?: number;
  offsetX?: number;
  offsetY?: number;
  clipRegion?: { x: number; y: number; width: number; height: number };
  /**
   * The clip's own animation preset this transition takes over (ESCSUITE-139):
   * `'in'` for the incoming side, `'out'` for the outgoing one. Handed straight
   * to `getAnimatedValues`' `suppressPreset`, so the side arriving under a fade
   * is not also faded in by its own fade-in preset, and the side leaving is not
   * faded out twice.
   *
   * Unlike every other field here it is not geometry: it applies to a side of
   * *any* active transition, including a type with no geometry of its own, and
   * it is the one field a caller outside `drawTransition` /
   * `drawTransitionWithFrames` never sets. An ordinary (non-transition) draw
   * passes no modifiers at all, which is why a preset outside a transition
   * window is untouched.
   */
  suppressPreset?: PresetSide;
}

/**
 * Per-call overrides for drawing a media clip. Every default reproduces the
 * export pipeline's own behaviour: the exporters pass none of these, the live
 * preview passes the two it needs.
 */
export interface MediaDrawOptions {
  /**
   * Say nothing about media that is not ready to draw. An export reports it
   * once per frame and a frame is drawn once; a preview redraws the same frame
   * on every animation frame, and would repeat the same warning sixty times a
   * second for as long as the playhead sat there.
   */
  quiet?: boolean;
  /**
   * Device pixels per drawing unit, for the lengths that are not in drawing
   * units at all.
   *
   * `ctx.filter` is the exception to everything else on a 2D context: a
   * `blur(4px)` is four pixels of the *output bitmap* and the current transform
   * does not touch it (verified in Chromium — the same filter over a halved
   * transform blurs across exactly as many device pixels). Everywhere the
   * canvas is the project — every export — that distinction does not exist and
   * this stays 1. The preview rasterises at the size it is displayed at, so a
   * blur the project calls 4px has to be asked for in the device pixels that
   * many project pixels currently occupy, or the picture in the editor would
   * blur harder than the file it exports.
   */
  filterScale?: number;
}

/**
 * Calculate total timeline duration from clips
 */
export function calculateTimelineDuration(clips: Clip[]): number {
  if (clips.length === 0) return 0;
  return Math.max(...clips.map(c => c.timelinePosition + c.duration));
}

// Animated values type for overlays
export interface AnimatedOverlayValues {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  blur: number;
}
