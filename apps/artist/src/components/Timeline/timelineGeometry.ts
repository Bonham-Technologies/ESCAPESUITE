// Where things are on the timeline.
//
// Pure functions: everything they read is a parameter — pixels, seconds, clips,
// plain numbers off a DOMRect — so the same maths backs the ruler's ticks, the
// drag/trim/marquee handlers' mouse-to-time conversions and the tests, without a
// ref, a store subscription or a React render in sight. `findNearestSnapPoint`
// is imported rather than re-implemented, from `store/timelineSnapping` — a
// module as free of the store as this one is.
import { findNearestSnapPoint } from '../../store/timelineSnapping';
import { pixelsToTime, timeToPixels } from '../../utils/timeUtils';
import type { Clip, SourceVideo, TrimOrigin } from '../../store/types';

/**
 * What a clip looked like when the trim started. Declared once, in
 * `store/types.ts` (`trimClip` is a store action and needs the same shape) —
 * this is a re-export, not a second declaration, since a component may
 * import from the store but the reverse is not allowed.
 */
export type { TrimOrigin };

/** How many pixels one second of timeline occupies at zoom 1. */
export const PIXELS_PER_SECOND_BASE = 50;

/**
 * The tick intervals a ruler may use, in seconds, finest first. The ruler picks
 * from this ladder by zoom (`rulerIntervals`), so a frame-level view is not one
 * label per screen and a zoomed-out one is not a smear of ticks.
 */
export const RULER_INTERVAL_LADDER: readonly number[] = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

/** The narrowest a tick may be drawn from its neighbour, in pixels. */
export const RULER_MIN_TICK_PX = 50;

/** The narrowest two time labels may sit apart, in pixels. */
export const RULER_MIN_LABEL_PX = 80;

/** How close to a clip's edges the razor refuses to split, in seconds. */
export const MIN_SPLIT_DISTANCE = 0.1;

/** The shortest clip a trim may leave behind, in seconds. */
export const MIN_CLIP_DURATION = 0.1;

/** How far the pointer must travel before a press becomes a marquee, in pixels. */
export const MARQUEE_DRAG_THRESHOLD = 5;

export interface RulerTick {
  /** The tick's time, in seconds. */
  time: number;
  /** Its offset from the start of the ruler, in pixels. */
  x: number;
  /** Major ticks carry a time label; minor ones are bare. */
  isMajor: boolean;
  /** The label a major tick shows; empty for a minor one. */
  label: string;
}

/**
 * The two spacings a ruler uses at this scale, in seconds. `label` comes first:
 * the smallest ladder step at least `RULER_MIN_LABEL_PX` wide, so labels never
 * get coarser as the zoom grows. `minor` is then the smallest ladder step at
 * least `RULER_MIN_TICK_PX` wide that divides `label` evenly, so every labelled
 * time is a tick. A scale too small for a label falls back to the ladder's last
 * step, and a tick too narrow to draw falls back to the label step itself.
 */
export function rulerIntervals(pixelsPerSecond: number): { minor: number; label: number } {
  const label =
    RULER_INTERVAL_LADDER.find((step) => step * pixelsPerSecond >= RULER_MIN_LABEL_PX) ??
    RULER_INTERVAL_LADDER[RULER_INTERVAL_LADDER.length - 1];
  const minor =
    RULER_INTERVAL_LADDER.find((step) => {
      const steps = label / step;
      return (
        step * pixelsPerSecond >= RULER_MIN_TICK_PX &&
        Math.abs(steps - Math.round(steps)) < 1e-9
      );
    }) ?? label;
  return { minor, label };
}

/**
 * A ruler label for `time`, with as many decimals as the labelled step needs
 * to tell neighbours apart: none from a second up, tenths for 0.1 and 0.5,
 * hundredths for 0.25.
 */
export function formatRulerTime(time: number, labelInterval: number): string {
  const decimals = labelInterval >= 1 ? 0 : labelInterval === 0.25 ? 2 : 1;
  const scale = 10 ** decimals;
  const units = Math.round(time * scale);
  const wholeSeconds = Math.floor(units / scale);
  const minutes = Math.floor(wholeSeconds / 60);
  const secs = (wholeSeconds % 60).toString().padStart(2, '0');
  if (decimals === 0) return `${minutes}:${secs}`;
  const fraction = (units % scale).toString().padStart(decimals, '0');
  return `${minutes}:${secs}.${fraction}`;
}

/**
 * The ticks a ruler of `duration` seconds shows at this scale: one every
 * minor interval of `rulerIntervals`, up to and including the tick at or past
 * the end, the labelled ones carrying their label.
 */
export function getRulerTicks(duration: number, pixelsPerSecond: number): RulerTick[] {
  const { minor, label } = rulerIntervals(pixelsPerSecond);
  const ticks: RulerTick[] = [];
  const totalTicks = Math.ceil(duration / minor);
  const labelEvery = Math.round(label / minor);

  for (let i = 0; i <= totalTicks; i++) {
    // Rounded to the millisecond so 3 * 0.1 is 0.3, not 0.30000000000000004.
    const time = Math.round(i * minor * 1000) / 1000;
    const isMajor = i % labelEvery === 0;
    ticks.push({
      time,
      x: timeToPixels(time, pixelsPerSecond),
      isMajor,
      label: isMajor ? formatRulerTime(time, label) : '',
    });
  }

  return ticks;
}

/**
 * The time a pointer is over, for an element that scrolls horizontally:
 * its client X, relative to the element's left edge, plus what is scrolled
 * out of view to the left.
 */
export function pointerTime(
  clientX: number,
  rectLeft: number,
  scrollLeft: number,
  pixelsPerSecond: number
): number {
  return pixelsToTime(clientX - rectLeft + scrollLeft, pixelsPerSecond);
}

/** A time held inside `[0, max]`. */
export function clampTime(time: number, max: number): number {
  return Math.max(0, Math.min(time, max));
}

export interface SnappedDrag {
  /** Where the clip's start goes — the snapped position, or the raw one. */
  position: number;
  /** The snap point that was hit, for the indicator line; null when none was. */
  snappedPosition: number | null;
}

/**
 * Snap a dragged clip to the nearest snap point within `threshold` seconds.
 * The clip's start edge wins over its end edge when both are in range.
 */
export function snapDragPosition(
  position: number,
  clipDuration: number,
  snapPoints: number[],
  threshold: number
): SnappedDrag {
  // Check clip start snap
  const startSnap = findNearestSnapPoint(position, snapPoints, threshold);
  // Check clip end snap
  const endSnap = findNearestSnapPoint(position + clipDuration, snapPoints, threshold);

  if (startSnap !== null) {
    return { position: startSnap, snappedPosition: startSnap };
  }
  if (endSnap !== null) {
    return { position: endSnap - clipDuration, snappedPosition: endSnap };
  }
  return { position, snappedPosition: null };
}

/**
 * Where inside a clip a razor click lands, relative to the clip's start —
 * or null when the click is on (or within `MIN_SPLIT_DISTANCE` of) an edge,
 * which would leave a sliver behind.
 */
export function getSplitOffset(
  clickTime: number,
  clipStart: number,
  clipDuration: number
): number | null {
  const clipEnd = clipStart + clipDuration;

  if (clickTime > clipStart + MIN_SPLIT_DISTANCE && clickTime < clipEnd - MIN_SPLIT_DISTANCE) {
    // Convert absolute timeline position to relative position within clip
    return clickTime - clipStart;
  }
  return null;
}

/**
 * Whether a clip can be trimmed past its source's length: overlays and images
 * have no fixed source duration, so trimming them changes how long they show.
 *
 * Its only production call site is `computeTrimUpdate`, forty lines below. It
 * is `export`ed anyway so that its overlay / image / video cases can be
 * asserted by name in `timelineGeometry.test.ts` rather than only indirectly,
 * through whichever edge×kind branch of `computeTrimUpdate` happens to reach
 * them — the same trade the four constants above make.
 */
export function isExtendableClip(
  clip: Pick<Clip, 'overlayType'>,
  sourceVideo: Pick<SourceVideo, 'mediaType'> | undefined
): boolean {
  const isOverlay = clip.overlayType === 'text' || clip.overlayType === 'shape';
  const isImage = sourceVideo?.mediaType === 'image';
  return isOverlay || isImage;
}

/** A span of timeline, in seconds. */
export interface TimeRange {
  start: number;
  end: number;
}

export interface TrimUpdateParams {
  /** Which edge is being dragged. */
  edge: 'start' | 'end';
  /** The time the pointer is over. */
  mouseTime: number;
  /** The clip as it stands now — the end trim measures against its live values. */
  clip: Pick<Clip, 'overlayType' | 'startTime' | 'timelinePosition'>;
  /** Its source media, if it has any. */
  sourceVideo: Pick<SourceVideo, 'mediaType' | 'duration'> | undefined;
  /** Its values when the trim started — the start trim measures against these. */
  origin: TrimOrigin;
}

/**
 * The clip fields a trim drag would write, or null when the drag asks for
 * something the clip cannot do: a clip shorter than `MIN_CLIP_DURATION`, or a
 * video trim on a clip whose source is missing.
 */
export function computeTrimUpdate({
  edge,
  mouseTime,
  clip,
  sourceVideo,
  origin,
}: TrimUpdateParams): Partial<Clip> | null {
  const isExtendable = isExtendableClip(clip, sourceVideo);

  if (edge === 'start') {
    if (isExtendable) {
      // For overlays/images: adjust timeline position and duration
      let newTimelinePosition = mouseTime;
      newTimelinePosition = Math.max(0, newTimelinePosition);

      // Calculate new duration
      const originalEnd = origin.timelinePosition + origin.endTime - origin.startTime;
      const newDuration = originalEnd - newTimelinePosition;

      if (newDuration >= MIN_CLIP_DURATION) {
        return {
          timelinePosition: newTimelinePosition,
          duration: newDuration,
          endTime: newDuration,
        };
      }
      return null;
    }
    if (sourceVideo) {
      // For video/audio: trim start point within source
      const deltaFromOriginalStart = mouseTime - origin.timelinePosition;
      let newStartTime = origin.startTime + deltaFromOriginalStart;
      newStartTime = Math.max(0, Math.min(newStartTime, origin.endTime - MIN_CLIP_DURATION));

      const newTimelinePosition = origin.timelinePosition + (newStartTime - origin.startTime);

      return {
        startTime: newStartTime,
        timelinePosition: Math.max(0, newTimelinePosition),
      };
    }
    return null;
  }

  // Trimming from the end
  if (isExtendable) {
    // For overlays/images: just adjust duration (no upper limit)
    const newEndTimelinePosition = mouseTime;
    const newDuration = newEndTimelinePosition - clip.timelinePosition;

    if (newDuration >= MIN_CLIP_DURATION) {
      return {
        duration: newDuration,
        endTime: newDuration,
      };
    }
    return null;
  }
  if (sourceVideo) {
    // For video/audio: trim end point within source
    const newEndTimelinePosition = mouseTime;
    const clipPlaybackTime = newEndTimelinePosition - clip.timelinePosition;
    let newEndTime = clip.startTime + clipPlaybackTime;
    newEndTime = Math.max(
      clip.startTime + MIN_CLIP_DURATION,
      Math.min(newEndTime, sourceVideo.duration)
    );

    return { endTime: newEndTime };
  }
  return null;
}

/** Whether a pointer has travelled far enough from the press to mean a marquee. */
export function exceedsMarqueeThreshold(dx: number, dy: number): boolean {
  return Math.sqrt(dx * dx + dy * dy) >= MARQUEE_DRAG_THRESHOLD;
}

/**
 * The span of time a marquee covers. Its X values are relative to the track
 * container's left edge, so what is scrolled out of view counts too.
 */
export function marqueeTimeRange(
  startX: number,
  currentX: number,
  scrollLeft: number,
  pixelsPerSecond: number
): { startTime: number; endTime: number } {
  const leftPx = Math.min(startX, currentX) + scrollLeft;
  const rightPx = Math.max(startX, currentX) + scrollLeft;
  return {
    startTime: pixelsToTime(leftPx, pixelsPerSecond),
    endTime: pixelsToTime(rightPx, pixelsPerSecond),
  };
}

/** The band of the track stack a marquee covers, in container-relative pixels. */
export function marqueeYRange(
  startY: number,
  currentY: number
): { topPx: number; bottomPx: number } {
  return {
    topPx: Math.min(startY, currentY),
    bottomPx: Math.max(startY, currentY),
  };
}

/** Whether a track occupying `[top, bottom]` falls inside a marquee's band. */
export function trackSpansMarquee(
  top: number,
  bottom: number,
  topPx: number,
  bottomPx: number
): boolean {
  return bottom > topPx && top < bottomPx;
}

/**
 * The ids of every clip on one of `trackIds` that overlaps `[startTime, endTime)`.
 * Touching the range at a single instant does not count as overlapping it.
 */
export function clipsIntersectingRange(
  clips: Clip[],
  trackIds: Set<string>,
  startTime: number,
  endTime: number
): string[] {
  return clips
    .filter((clip) => {
      if (!trackIds.has(clip.trackId)) return false;
      const clipEnd = clip.timelinePosition + clip.duration;
      // Clip overlaps the time range
      return clipEnd > startTime && clip.timelinePosition < endTime;
    })
    .map((c) => c.id);
}
