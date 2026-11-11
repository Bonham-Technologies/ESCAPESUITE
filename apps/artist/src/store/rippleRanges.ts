// Cutting stretches of timeline time out of some rows and closing the gaps
// (ESCSUITE-403, "Remove silences").
//
// A ripple delete of a time range rather than of a clip: on every row named,
// whatever lies inside a range is removed and everything after it moves left
// by the time removed before it. Every row moves by the same amount at the
// same timeline time, so the parts of a take recorded as separate tracks stay
// in step however many ranges are cut. Rows not named are left where they
// are, as a clip's ripple delete leaves them.
//
// "Move everything after each cut" (ESCSUITE-434) names the other rows too,
// as rows to move rather than to cut: a clip there moves left by the time
// removed before it, and one a range crosses is shortened by the time removed
// within it — never split, so an overlay or a caption stays one clip. The
// markers and in/out points move the same way (`cutEditorBlock`).
//
// Pure: `clipSlice`'s `removeTimeRanges` calls it inside one `set`, which is
// what makes the whole cut one undo step.

import { v4 as uuidv4 } from 'uuid';
import type { Clip, ClipAnimation, EditorBlock, Keyframe, SourceVideo } from './types';
import { DEFAULT_ANIMATION } from './types';
import type { TimeRange } from '../core/silenceDetection';
import { cloneClip } from '../utils/deepClone';
import { trimAnimation, KEYFRAME_TIME_EPSILON } from '../utils/animation';
import { isExtendableClip } from './extendableClip';

/**
 * A piece shorter than this is not kept (a millisecond, the tolerance a split
 * of a linked clip uses for the same reason: float edges a bit off).
 */
const PIECE_EPSILON = KEYFRAME_TIME_EPSILON;

/** `ranges` sorted, overlapping or touching ones joined, empty ones dropped, nothing before 0. */
export function normaliseRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  const sorted = ranges
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .filter((r) => r.end - r.start > PIECE_EPSILON)
    .sort((a, b) => a.start - b.start);
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/**
 * The rows a cut through `clip` has to move together: its own, its partners',
 * and — round again until nothing is added — the rows of every clip linked to
 * a clip already on one of them. After a split the pieces of one take sit in
 * several groups, and a later piece's partner may be on a row the target's own
 * group never reaches; moving the one without the other would put them out of
 * step. A row no link reaches is not moved, as a ripple delete leaves it.
 */
export function linkedRows(clips: readonly Clip[], clip: Clip): Set<string> {
  const rows = new Set([clip.trackId]);
  const groups = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of clips) {
      if (!c.linkGroupId) continue;
      if (rows.has(c.trackId) && !groups.has(c.linkGroupId)) {
        groups.add(c.linkGroupId);
        grew = true;
      }
      if (groups.has(c.linkGroupId) && !rows.has(c.trackId)) {
        rows.add(c.trackId);
        grew = true;
      }
    }
  }
  return rows;
}

/** How much of `ranges` lies before `time`. */
function removedBefore(ranges: readonly TimeRange[], time: number): number {
  let total = 0;
  for (const r of ranges) {
    if (r.start >= time) break;
    total += Math.min(time, r.end) - r.start;
  }
  return total;
}

/** Where the cut puts what stood at timeline `time`: `time` less the time removed before it. */
export function cutTime(ranges: readonly TimeRange[], time: number): number {
  return time - removedBefore(ranges, time);
}

/**
 * The in/out points and markers moved as `ranges` (normalised) move the
 * timeline (ESCSUITE-434): each by the time removed before it, so one inside a
 * range lands where that range closes up. Null when none of them moves.
 */
export function cutEditorBlock(block: EditorBlock, ranges: readonly TimeRange[]): EditorBlock | null {
  let moved = false;
  const at = (time: number) => {
    const to = cutTime(ranges, time);
    if (to !== time) moved = true;
    return to;
  };
  const markers = block.markers.map((m) => {
    const time = at(m.time);
    return time === m.time ? m : { ...m, time };
  });
  const inPoint = block.inPoint === null ? null : at(block.inPoint);
  const outPoint = block.outPoint === null ? null : at(block.outPoint);
  return moved ? { inPoint, outPoint, markers } : null;
}

/** How many of `ranges` end at or before `time` (within the piece tolerance). */
function slotAt(ranges: readonly TimeRange[], time: number): number {
  let slot = 0;
  for (const r of ranges) if (r.end <= time + PIECE_EPSILON) slot++;
  return slot;
}

/**
 * `clips` with `ranges` (timeline seconds, normalised) cut out of every clip
 * on `trackIds` and the gaps closed there, and every clip on `moveRows`
 * moved and shortened to match (`shortenClip`). The same array when nothing
 * on those rows is touched.
 *
 * A clip a range crosses becomes the pieces outside it: the first keeps the
 * clip's id (so a selection of it survives), the rest get new ones. Each piece
 * is a window on the same source at the same offset, with its animation
 * trimmed to it. A clip wholly inside a range is dropped.
 *
 * Link groups follow `splitClip`'s rule that a group is a segment. A slot is
 * the stretch between two cuts; a group's clips in its earliest slot keep its
 * id, and its clips in each later slot share one fresh id, on every row. A
 * group that lies within one slot keeps its id.
 */
export function cutTimeRanges(
  clips: readonly Clip[],
  sourceVideos: readonly SourceVideo[],
  trackIds: ReadonlySet<string>,
  ranges: readonly TimeRange[],
  moveRows: ReadonlySet<string> = new Set()
): readonly Clip[] {
  const placed: { clip: Clip; slot: number }[] = [];
  let changed = false;
  for (const clip of clips) {
    if (!trackIds.has(clip.trackId)) {
      const moved = moveRows.has(clip.trackId) ? shortenClip(clip, sourceVideos, ranges) : clip;
      if (moved !== clip) changed = true;
      // Slot -1: its link group, if any, is left as it is.
      if (moved) placed.push({ clip: moved, slot: -1 });
      continue;
    }
    const from = clip.timelinePosition;
    const to = clip.timelinePosition + clip.duration;
    const pieces = outside(ranges, from, to);
    if (pieces.length === 1 && pieces[0].start === from && pieces[0].end === to) {
      // No range crosses it: it only moves.
      const shift = removedBefore(ranges, from);
      if (shift !== 0) changed = true;
      placed.push({ clip: shift === 0 ? clip : { ...clip, timelinePosition: from - shift }, slot: slotAt(ranges, from) });
      continue;
    }
    changed = true;
    const extendable = isExtendableClip(clip, sourceVideos.find((v) => v.id === clip.sourceVideoId));
    pieces.forEach((piece, i) => {
      const start = piece.start - from;
      const end = piece.end - from;
      const copy = i === 0 ? { ...clip } : { ...cloneClip(clip), id: uuidv4() };
      const cut: Clip = {
        ...copy,
        ...(extendable ? { startTime: 0, endTime: end - start } : { startTime: clip.startTime + start, endTime: clip.startTime + end }),
        duration: end - start,
        timelinePosition: piece.start - removedBefore(ranges, piece.start),
        ...(clip.animation ? { animation: pieceAnimation(clip.animation, start, end, clip.duration) } : {}),
      };
      placed.push({ clip: cut, slot: slotAt(ranges, piece.start) });
    });
  }
  if (!changed) return clips;

  const earliest = new Map<string, number>();
  for (const { clip, slot } of placed) {
    if (slot < 0 || !clip.linkGroupId) continue;
    earliest.set(clip.linkGroupId, Math.min(slot, earliest.get(clip.linkGroupId) ?? slot));
  }
  const fresh = new Map<string, string>();
  return placed.map(({ clip, slot }) => {
    if (slot < 0 || !clip.linkGroupId || slot === earliest.get(clip.linkGroupId)) return clip;
    const key = `${clip.linkGroupId}#${slot}`;
    let id = fresh.get(key);
    if (!id) {
      id = uuidv4();
      fresh.set(key, id);
    }
    return { ...clip, linkGroupId: id };
  });
}

/**
 * `clip` on a row the cut moves but does not cut (ESCSUITE-434): moved left by
 * the time `ranges` remove before it and shortened by the time they remove
 * within it, off its out point, so it stays one clip; null when nothing of it
 * is left. Its keyframes keep their place in what is left (`shortenAnimation`).
 */
function shortenClip(clip: Clip, sourceVideos: readonly SourceVideo[], ranges: readonly TimeRange[]): Clip | null {
  const from = clip.timelinePosition;
  const to = from + clip.duration;
  const before = removedBefore(ranges, from);
  const within = removedBefore(ranges, to) - before;
  if (within === 0) return before === 0 ? clip : { ...clip, timelinePosition: from - before };
  const duration = clip.duration - within;
  if (duration <= PIECE_EPSILON) return null;
  const extendable = isExtendableClip(clip, sourceVideos.find((v) => v.id === clip.sourceVideoId));
  return {
    ...clip,
    timelinePosition: from - before,
    duration,
    ...(extendable ? { startTime: 0, endTime: duration } : { endTime: clip.startTime + duration }),
    ...(clip.animation ? { animation: shortenAnimation(clip.animation, from, ranges, duration) } : {}),
  };
}

/**
 * A shortened clip's animation: a keyframe inside a range goes with the time
 * it stood in, every other one moves left by the time removed before it in the
 * clip (where two then meet, the later one stays), and the presets are capped
 * to the new length as a trim caps them.
 */
function shortenAnimation(animation: ClipAnimation, from: number, ranges: readonly TimeRange[], duration: number): ClipAnimation {
  const offset = removedBefore(ranges, from);
  const keyframes: ClipAnimation['keyframes'] = {};
  for (const [property, track] of Object.entries(animation.keyframes) as [keyof ClipAnimation['keyframes'], Keyframe[] | undefined][]) {
    if (!track) continue;
    const kept: Keyframe[] = [];
    for (const k of [...track].sort((a, b) => a.time - b.time)) {
      const at = from + k.time;
      if (ranges.some((r) => at > r.start + PIECE_EPSILON && at < r.end - PIECE_EPSILON)) continue;
      const time = k.time - (removedBefore(ranges, at) - offset);
      const last = kept[kept.length - 1];
      if (last && time - last.time <= PIECE_EPSILON) kept.pop();
      kept.push({ ...k, time });
    }
    keyframes[property] = kept;
  }
  return trimAnimation({ ...animation, keyframes }, { start: 0, end: duration });
}

/** The parts of `[from, to]` outside every range, each longer than the piece tolerance. */
function outside(ranges: readonly TimeRange[], from: number, to: number): TimeRange[] {
  const pieces: TimeRange[] = [];
  let at = from;
  for (const r of ranges) {
    if (r.end <= at) continue;
    if (r.start >= to) break;
    if (r.start - at > PIECE_EPSILON) pieces.push({ start: at, end: r.start });
    at = Math.max(at, r.end);
  }
  if (to - at > PIECE_EPSILON) pieces.push({ start: at, end: to });
  return pieces;
}

/**
 * A piece's animation: the keyframes trimmed to it as a trim crops them, and
 * the in and out presets only at the clip's own ends — a cut is a join, as a
 * split's is (`splitAnimation`), so nothing fades in or out at it.
 */
function pieceAnimation(animation: ClipAnimation, start: number, end: number, duration: number): ClipAnimation {
  const trimmed = trimAnimation(animation, { start, end });
  return {
    ...trimmed,
    in: start > PIECE_EPSILON ? { ...DEFAULT_ANIMATION.in } : trimmed.in,
    out: duration - end > PIECE_EPSILON ? { ...DEFAULT_ANIMATION.out } : trimmed.out,
  };
}
