// Shared types, constants, and utility functions for the export pipeline

import type { Clip, Track, ExportOptions, ExportProgress, BlendMode, SourceVideo } from '../store/types';
import { isTrackVisible, isVisibleTrack } from '../store/trackVisibility';
import { PRESET_SUPPRESSION } from '../utils/animation';
import type { AnimatedValuesOptions, PresetSide } from '../utils/animation';

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

    if (!isTrackVisible(tracks, clip.trackId)) continue;

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
          .filter(({ track: t }) => isVisibleTrack(t))
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

/**
 * The `getAnimatedValues` options a clip is evaluated under while this
 * transition owns one of its preset sides (ESCSUITE-147) — `undefined` when
 * none does, which is every clip outside a transition window, the third clip
 * inside one, and any overlay at all.
 *
 * The renderer never needs this: `drawTransition` knows which side it is about
 * to draw and `transitionSideModifiers` stamps the suppression on from there
 * (ESCSUITE-139). Every *reader* of the same animation knows a clip and a
 * transition instead — the selection box, the click target, the marquee, a
 * keyframe drag's seed — and each has to arrive at the renderer's answer or it
 * reports a position the picture has left. One function for all of them, so the
 * readers cannot drift from each other or from the draw.
 *
 * **An overlay is never suppressed**, which is why this takes the clip rather
 * than its id. The suppression reaches a draw through `TransitionModifiers`, and
 * only the two *media* paths take modifiers: `drawFrame.ts` (and both exporters'
 * overlay passes) dispatch `clip.overlayType` through `drawOverlayClip` ahead of
 * the "skip a clip the transition will draw" check and hand it nothing, so a text
 * or shape overlay carrying a transition is drawn with its own Animate Out preset
 * fully applied. A reader that suppressed it would box and hit-test that overlay
 * where the picture is not — this ticket's own bug with the sides reversed, in
 * the one configuration that used to agree. (The editor cannot author it:
 * `ClipEditor` hides the transition section for an overlay, so it takes an
 * imported or hand-edited project. The guard is here because the invariant is
 * the renderer's, not the editor's.)
 */
export function presetSuppressionFor(
  clip: Clip,
  transition: TransitionInfo | null | undefined
): AnimatedValuesOptions | undefined {
  if (!transition || clip.overlayType) return undefined;
  if (transition.outgoingClip.id === clip.id) return PRESET_SUPPRESSION.out;
  if (transition.incomingClip.id === clip.id) return PRESET_SUPPRESSION.in;
  return undefined;
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
 * Whether the three WebCodecs globals the MP4 pipeline needs exist —
 * `VideoEncoder` to encode, `VideoFrame` to hand it frames, and `VideoDecoder`
 * because MP4 (unlike WebM) decodes its sources through WebCodecs.
 *
 * A globals read, nothing more: it says whether there is an API to ask, not
 * whether that API can encode anything. This used to be the whole of
 * `isMP4ExportSupported()`, and the gap was the defect ESCSUITE-175 fixed — a
 * browser with WebCodecs and no H.264 encoder read "MP4 available" and only
 * found out mid-export, and a browser with no AAC encoder (Firefox 155,
 * measured 2026-10-02) exported a silent file. The real probe is below; this is
 * kept for the two callers that genuinely only need "is the API here at all":
 * `exportToMP4`'s own door guard, and `isMP4ExportSupported`'s short-circuit.
 *
 * `ExportDialog` also reads it, for one narrow question: when *neither* video
 * format can be exported, is that because WebCodecs is missing
 * ({@link EXPORT_NO_WEBCODECS_REASON}) or because it is present and cannot
 * configure either codec ({@link EXPORT_NO_VIDEO_CODEC_REASON})? Every
 * combination that reaches that question is answered correctly by this
 * predicate, because the only global it reads that WebM does not need is
 * `VideoDecoder`, and a browser missing *only* `VideoDecoder` still exports
 * WebM — so the "neither" branch is never reached there.
 */
export function hasMP4EncodeGlobals(): boolean {
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
 * A representative bitrate/framerate for the export dialog's up-front probes.
 * The dialog asks before the user has chosen a quality setting — `quality`
 * only scales bitrate, never which codecs exist — so one fixed, reasonable
 * figure is enough to answer "can this browser encode this format at all", the
 * same reasoning CRAFT's own `probeMP4Support()` documents for probing at a
 * representative size instead of the take's own. Shared by both video probes
 * (ESCSUITE-175) so neither can drift from the other.
 */
const EXPORT_PROBE_BITRATE = 5_000_000;
const EXPORT_PROBE_FRAMERATE = 30;

/**
 * The audio bitrate the dialog's audio probes ask about: the `'medium'` quality
 * setting's, because the probe runs before any quality is chosen and — as with
 * the video bitrate above — the answer is about the codec, not the rate.
 */
const AUDIO_PROBE_BITRATE = 192_000;

/** The sample rate every exporter mixes at, and every probe asks about. */
export const EXPORT_AUDIO_SAMPLE_RATE = 48000;

/** Stereo, in both the exporters' mixes and their probes. */
export const EXPORT_AUDIO_CHANNELS = 2;

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
 * Shown in the export dialog when `VideoEncoder` exists but this browser can
 * configure no H.264 profile at any of {@link mp4VideoCodecConfigs}' ten
 * candidates — MP4's half of {@link WEBM_NO_CODEC_REASON} (ESCSUITE-175). It
 * names what is *left*, because the two formats that need no H.264 are both
 * still there; that second sentence is only true while WebM is available, which
 * is why the dialog shows this reason only when it is, and
 * {@link EXPORT_NO_VIDEO_CODEC_REASON} when it is not.
 */
export const MP4_NO_CODEC_REASON =
  'This browser cannot encode H.264, so MP4 export is unavailable here. WebM and GIF are.';

/**
 * Shown when WebCodecs is present and neither video format can be encoded — so
 * {@link EXPORT_NO_WEBCODECS_REASON} would be a lie and the two per-format
 * reasons would each contradict the other's "but this one works" clause
 * (ESCSUITE-175). `GIF_ALWAYS_AVAILABLE_NOTE` still follows it: `gifenc` needs
 * no encoder at all.
 */
export const EXPORT_NO_VIDEO_CODEC_REASON =
  'This browser cannot encode WebM video or MP4 video — Chrome or Edge can.';

/**
 * The two video formats, and for each: how it is written, the audio codec it
 * carries, and the other one to point a user at.
 *
 * GIF is deliberately absent. Its result always reports `audio: false` because
 * the container has nowhere to put sound, and every sentence below blames a
 * missing encoder — which would be the wrong explanation for a format that
 * never had an audio track to begin with. Keying the sentences off this table
 * is what makes that impossible to get wrong: there is no `gif` entry to read.
 */
const VIDEO_FORMAT_AUDIO = {
  mp4: { label: 'MP4', codec: 'AAC', alternative: 'WebM' },
  webm: { label: 'WebM', codec: 'Opus', alternative: 'MP4' },
} as const;

/** A format that carries sound — MP4 or WebM, never GIF. */
export type VideoExportFormat = keyof typeof VIDEO_FORMAT_AUDIO;

/** The audio codec a format's exporter writes: `'AAC'` or `'Opus'`. */
export function audioCodecName(format: VideoExportFormat): string {
  return VIDEO_FORMAT_AUDIO[format].codec;
}

/**
 * Shown under the format controls *before* an export, and reported by the
 * exporter through its own `onProgress` channel once it is running, when this
 * browser can encode the format's picture but not its sound — H.264 without AAC
 * (Firefox 155, measured 2026-10-02), or VP9/VP8 without Opus.
 *
 * The format stays offered: a silent MP4 or WebM is a legitimate thing to want,
 * and the one thing the user must not have is a file that turns out silent with
 * no warning — which is exactly what happened before ESCSUITE-175, behind a
 * `console.warn`, on both sides. {@link exportedWithoutSoundReason} is the same
 * fact said afterwards.
 *
 * `alternativeKeepsAudio` drops the second sentence. A browser with no
 * `AudioEncoder` at all makes *both* formats silent, and then "WebM keeps the
 * audio" and "MP4 keeps the audio" are each false — the audio-side twin of the
 * trap {@link EXPORT_NO_VIDEO_CODEC_REASON} exists for. The clause is dropped
 * rather than a further sentence invented. An exporter that is already running
 * leaves it at the default: it has not probed the other format, and the
 * suggestion is the actionable one for the browser this is about.
 */
export function noAudioNote(format: VideoExportFormat, alternativeKeepsAudio = true): string {
  const { label, codec, alternative } = VIDEO_FORMAT_AUDIO[format];
  const note = `${label} export in this browser will have no sound (no ${codec} encoder).`;
  return alternativeKeepsAudio ? `${note} ${alternative} keeps the audio.` : note;
}

/**
 * Shown on the dialog's completion screen when an export's result carries
 * `audio: false` — {@link noAudioNote}'s after-the-fact form, naming the codec
 * this browser turned out not to have.
 *
 * It asserts a **loss**, so the dialog also requires the project to have had
 * sound in it: see `projectHasAudio` in `ExportDialog.tsx`.
 */
export function exportedWithoutSoundReason(format: VideoExportFormat): string {
  return `Exported without sound — this browser has no ${audioCodecName(format)} encoder.`;
}

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
 * Check whether WebM export is possible, and whether it will have sound — the
 * exact shape {@link isMP4ExportSupported} answers, and since ESCSUITE-175 the
 * exact set of questions too.
 *
 * It has been a real probe rather than a read of which globals exist since
 * ESCSUITE-22/29 (it used to be `return isMP4ExportSupported();`, which
 * answered "yes" for any browser with WebCodecs even when that browser's
 * `VideoEncoder` cannot configure VP9 *or* VP8 — the export would then fail
 * opaquely partway through). What ESCSUITE-175 added is `audio`: `exportToWebM`
 * drops the soundtrack when Opus cannot be configured, and before this nothing
 * asked that question early enough for the dialog to say so.
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
export async function isWebMExportSupported(
  width: number,
  height: number
): Promise<ExportFormatSupport> {
  if (!hasWebMEncodeGlobals()) {
    return { video: false, audio: false };
  }
  const found = await findSupportedVideoConfig(
    webMVideoCodecConfigs(width, height, EXPORT_PROBE_BITRATE, EXPORT_PROBE_FRAMERATE)
  );
  const audio = await isAudioCodecSupported(
    opusEncoderConfig(EXPORT_AUDIO_SAMPLE_RATE, EXPORT_AUDIO_CHANNELS, AUDIO_PROBE_BITRATE)
  );
  return { video: found !== null, audio };
}

/**
 * The H.264 ladder, quality first and compatibility last, walked twice: once
 * asking for hardware acceleration (a GPU encode where there is one) and once
 * with no preference, which is what lets software encoding answer on a headless
 * or CI box with no GPU. Levels 4.0 come before 5.1 so a 1080p export keeps the
 * more compatible level; `isConfigSupported` refuses Level 4.0 above 1920x1080,
 * which is what makes the 5.1 entries reachable for a 1440p or 4K raster.
 *
 * Lifted out of `exportMP4.ts` by ESCSUITE-175, for the same reason
 * {@link webMVideoCodecConfigs} exists: the dialog's up-front probe and the
 * exporter's own `configure()` must ask one question, not two that can drift.
 */
export function mp4VideoCodecConfigs(
  width: number,
  height: number,
  videoBitrate: number,
  frameRate: number
): VideoEncoderConfig[] {
  const codecs = [
    'avc1.640028', // High Profile Level 4.0 - best quality (up to 1080p30)
    'avc1.4d0028', // Main Profile Level 4.0 - good compatibility
    'avc1.42001f', // Baseline Profile Level 3.1 - maximum compatibility
    'avc1.640033', // High Profile Level 5.1 - 1440p and 4K
    'avc1.4d0033', // Main Profile Level 5.1
  ];
  const hwModes: VideoEncoderConfig['hardwareAcceleration'][] = ['prefer-hardware', 'no-preference'];
  const configs: VideoEncoderConfig[] = [];
  for (const hardwareAcceleration of hwModes) {
    for (const codec of codecs) {
      configs.push({
        codec,
        width,
        height,
        bitrate: videoBitrate,
        framerate: frameRate,
        latencyMode: 'quality',
        hardwareAcceleration,
      });
    }
  }
  return configs;
}

/** AAC-LC, the one audio codec the MP4 exporter writes. */
export function aacEncoderConfig(
  sampleRate: number,
  numberOfChannels: number,
  bitrate: number
): AudioEncoderConfig {
  return { codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate };
}

/** Opus, the one audio codec the WebM exporter writes. */
export function opusEncoderConfig(
  sampleRate: number,
  numberOfChannels: number,
  bitrate: number
): AudioEncoderConfig {
  return { codec: 'opus', sampleRate, numberOfChannels, bitrate };
}

/**
 * Whether this browser's `AudioEncoder` can configure the given config — AAC
 * for MP4, Opus for WebM; one implementation, because the question and every
 * way of failing to answer it are the same.
 *
 * `false` rather than a throw for every way of not knowing — no `AudioEncoder`
 * at all, a refusal, or a probe that rejects — because the caller's next move
 * is the same in all three: export without sound, and say so.
 */
export async function isAudioCodecSupported(config: AudioEncoderConfig): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') {
    return false;
  }
  try {
    const support = await AudioEncoder.isConfigSupported(config);
    return support.supported === true;
  } catch {
    return false;
  }
}

/**
 * What a video export can actually do in this browser: `video` is whether any
 * of the format's picture codecs can be configured at the output size, `audio`
 * whether its audio codec can.
 *
 * Two booleans because the two failures are different in kind. No picture codec
 * means no export in that format at all — the dialog refuses it. No audio codec
 * means a file with no sound in it — the dialog keeps offering the format and
 * says what the trade is. One shape for both formats, so the dialog reads them
 * the same way.
 */
export interface ExportFormatSupport {
  video: boolean;
  audio: boolean;
}

/**
 * Check whether MP4 export is possible, and whether it will have sound.
 *
 * Until ESCSUITE-175 this was {@link hasMP4EncodeGlobals} under this name — a
 * read of which globals exist, which answered "yes" for any browser with
 * WebCodecs whether or not its `VideoEncoder` could configure H.264 and whether
 * or not it had an AAC encoder at all. It is now the same shape of real probe
 * `isWebMExportSupported` has had since ESCSUITE-22/29: it asks the browser,
 * through the same {@link findSupportedVideoConfig} ladder walker and the same
 * {@link mp4VideoCodecConfigs} list `exportToMP4` configures from.
 *
 * `width`/`height` should be the size the export will actually configure the
 * encoder at — `getResolution(preset, …)`'s answer, not the raw project
 * resolution — for the reason `isWebMExportSupported` documents: a project whose
 * native size this browser cannot configure should not read as unsupported when
 * a smaller preset would have worked.
 */
export async function isMP4ExportSupported(
  width: number,
  height: number
): Promise<ExportFormatSupport> {
  if (!hasMP4EncodeGlobals()) {
    return { video: false, audio: false };
  }
  const found = await findSupportedVideoConfig(
    mp4VideoCodecConfigs(width, height, EXPORT_PROBE_BITRATE, EXPORT_PROBE_FRAMERATE)
  );
  const audio = await isAudioCodecSupported(
    aacEncoderConfig(EXPORT_AUDIO_SAMPLE_RATE, EXPORT_AUDIO_CHANNELS, AUDIO_PROBE_BITRATE)
  );
  return { video: found !== null, audio };
}

/**
 * What an export hands back: the bytes, and whether this browser was able to
 * carry the project's sound (ESCSUITE-175).
 *
 * `audio: false` means the sound **could not be carried** — an MP4 in a browser
 * with no AAC encoder, a WebM in one with no Opus encoder, and every GIF, whose
 * container has nowhere to put it. It is a statement about the *pipeline*, not
 * about this project: an export of a silent timeline in a no-AAC browser still
 * reports `false`, because the exporter cannot know whether there was anything
 * to lose without doing the decode this ticket removed.
 *
 * So `audio: false` alone does not mean sound was lost, and the dialog does not
 * treat it that way: its completion sentence also requires the project to have
 * had something that could carry sound (`projectHasAudio` in
 * `ExportDialog.tsx`). A host reading `EXPORT_COMPLETE.audio` should read it the
 * same way — "this file has no audio track", not "your audio was dropped".
 *
 * One field across all three formats so the dialog reads it the same way
 * whichever ran.
 */
export interface ExportResult {
  blob: Blob;
  audio: boolean;
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
 * The one fact WebM and GIF share: both drive `core/elementFrames.ts`'s
 * `requestAnimationFrame` readiness poll — WebM seeking an `HTMLVideoElement`,
 * GIF reading the canvas — which the browser throttles once the tab is
 * hidden. MP4 is the exception, decoding through a Web Worker when one starts
 * (ESCSUITE-153), so it keeps encoding in the background. One constant so the
 * export dialog's WebM and GIF notices say the same thing and cannot drift
 * apart (ESCSUITE-173: the WebM half of this used to be bundled with MP4's
 * own background-tab sentence and disappeared whenever MP4 was unsupported,
 * taking the equally-true WebM fact down with it).
 */
export const TAB_VISIBLE_NOTE = 'needs this tab visible';

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

/**
 * Why a timeline of this many seconds cannot be exported, or `null` when it can
 * (ESCSUITE-257). A length of zero or less — one zero-length clip at 0, or a
 * clip placed so it ends before 0 — gives the audio mixer a zero or negative
 * sample count, which the browser answers with a raw `OfflineAudioContext` or
 * typed-array error. One sentence, shared by the exporters' refusal and the
 * export dialog's disabled buttons, so they cannot drift apart.
 */
export function exportLengthReason(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return 'Cannot export: the timeline has no finite length';
  if (seconds <= 0) return 'Cannot export: the timeline is empty';
  return null;
}

/**
 * Refuse a timeline with no exportable length before any work is spent on it:
 * before the codec probe, the audio mix, the media load and the muxer.
 */
export function assertExportableLength(
  seconds: number,
  format: 'mp4' | 'webm',
  exportLog: ExportLogEntry[]
): void {
  const reason = exportLengthReason(seconds);
  if (reason === null) return;
  exportLog.push({ phase: 'init', detail: `${format} refused: length ${seconds}s`, timestamp: performance.now() });
  throw new ExportError(reason, exportLog);
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
