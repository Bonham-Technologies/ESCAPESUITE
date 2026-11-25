// Clip speed (ESCSUITE-471): how fast a media clip plays its source.
//
// A clip at speed `s` plays `s` seconds of its source per second of timeline,
// so its length on the timeline is its source span divided by `s`, and the
// source time under the playhead is `startTime + clipTime * s`. Every reader
// that maps a timeline instant to a source instant (the preview, the three
// exporters through `elementFrames.ts` and `exportMP4.ts`, the audio mix,
// Remove silences, a split, a trim) goes through `sourceTimeAt` or
// `sourceSpanToTimeline` here, so none of them can disagree.
//
// `speed` is optional on a clip and absent means 1, so every clip written
// before this ticket, and every clip never sped, is exactly what it was. Only
// a media clip (a video or an audio source) has a speed: an overlay or an
// image has no source timeline, so `clipSpeed` reads 1 for an overlay whatever
// it carries and the store never writes one on either.
//
// Sound is resampled with the picture, so it changes pitch, up to
// `MAX_AUDIBLE_SPEED`; above it the clip is silent in the preview and in every
// export. Pitch-preserving time-stretch is out of scope.
//
// See `docs/reference/clip-speed.md`.

import type { Clip, SourceVideo } from './types';
import { linkedPartners } from './linkedClips';

/** The slowest a clip can play. */
export const MIN_CLIP_SPEED = 0.25;
/** The fastest a clip can play. */
export const MAX_CLIP_SPEED = 4;
/** The fastest a clip plays with its sound; faster, it is silent. */
export const MAX_AUDIBLE_SPEED = 2;
/** The speeds the inspector offers as one-click choices, slowest first. */
export const CLIP_SPEED_PRESETS: readonly number[] = [0.25, 0.5, 1, 1.5, 2, 4];

/** Whether `value` is a speed a clip may carry: a finite number from 0.25 to 4. */
export function isValidClipSpeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_CLIP_SPEED && value <= MAX_CLIP_SPEED;
}

/**
 * The speed `clip` plays at: its `speed`, or 1 when it has none, is an
 * overlay, or carries a value outside the range (which `parseProject` refuses
 * at the door, so only a hand-built clip can).
 */
export function clipSpeed(clip: Pick<Clip, 'speed'> & { overlayType?: Clip['overlayType'] }): number {
  if (clip.overlayType) return 1;
  return isValidClipSpeed(clip.speed) ? clip.speed : 1;
}

/** The timeline length of a source span played at `speed`. */
export function sourceSpanToTimeline(startTime: number, endTime: number, speed: number): number {
  return (endTime - startTime) / speed;
}

/** `clip`'s length on the timeline, from its trim points and speed. */
export function clipTimelineLength(clip: Pick<Clip, 'startTime' | 'endTime' | 'speed'> & { overlayType?: Clip['overlayType'] }): number {
  return sourceSpanToTimeline(clip.startTime, clip.endTime, clipSpeed(clip));
}

/** The source time `clip` shows `clipTime` seconds (of timeline) after its start. */
export function sourceTimeAt(clip: Pick<Clip, 'startTime' | 'speed'> & { overlayType?: Clip['overlayType'] }, clipTime: number): number {
  return clip.startTime + clipTime * clipSpeed(clip);
}

/** Whether a clip at `speed` plays its sound (resampled), rather than none. */
export function isAudibleSpeed(speed: number): boolean {
  return speed <= MAX_AUDIBLE_SPEED;
}

/** "2×", "0.25×", "1.5×": a speed as the inspector and the timeline show it. */
export function formatClipSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

/**
 * Whether `clip` can be given a speed: a media clip — one with a source that
 * is not an image. An overlay or an image has no source timeline to play
 * faster. A clip whose source is not in `sourceVideos` (not re-linked yet)
 * is taken at its word: only an image would refuse, and a clip already
 * carrying a speed must stay editable.
 */
export function canHaveSpeed(
  clip: Pick<Clip, 'overlayType' | 'sourceVideoId'>,
  sourceVideos: readonly Pick<SourceVideo, 'id' | 'mediaType'>[]
): boolean {
  if (clip.overlayType || !clip.sourceVideoId) return false;
  return sourceVideos.find((s) => s.id === clip.sourceVideoId)?.mediaType !== 'image';
}

/**
 * The clips a speed change of `clip` sets together: `clip` and every media
 * clip linked to it, so a take's screen and microphone stay in step.
 * `setClipSpeed` changes these, and the left-behind count
 * (`speedChangeLeftBehind`, ESCSUITE-521) reads where they start, so the two
 * cannot disagree.
 */
export function speedGroup(
  clips: readonly Clip[],
  clip: Clip,
  sourceVideos: readonly Pick<SourceVideo, 'id' | 'mediaType'>[]
): Clip[] {
  return [clip, ...linkedPartners(clips, clip).filter((p) => canHaveSpeed(p, sourceVideos))];
}
