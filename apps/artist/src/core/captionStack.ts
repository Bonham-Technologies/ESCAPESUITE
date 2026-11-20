// Two caption tracks on screen at once (ESCSUITE-473).
//
// A translated caption track copies its source's style, position included, so
// both languages would draw on the same spot. While cues of two or more
// visible caption tracks are up at the same instant, they are stacked instead:
// the caption track lowest in the timeline keeps its own place, and each one
// above it is raised just far enough to clear the boxes below it. The
// translation goes directly below its source in the timeline, so the original
// draws above and the translation below. Hide either track and the other
// draws exactly where its clips say; a caption placed well clear of the others
// (at the top of the frame, say) is never moved.
//
// This is a drawing-time rule only: the clips keep their own position, so the
// project, the inspector and the sidecar are unchanged. The preview, the MP4
// exporter and the WebM / GIF compositor (`elementFrames.ts`) all run their
// active clips through `stackCaptions`, so the picture and every export agree.

import type { Clip, Track } from '../store/types';

/** One of `getClipsAtTime`'s results, as far as stacking reads it. */
export interface StackEntry {
  clip: Clip;
  track: Track;
}

/** The space left between two stacked captions, as a fraction of the frame's height. */
export const CAPTION_STACK_GAP = 0.01;

interface Box {
  top: number;
  bottom: number;
}

/**
 * A caption's box on the frame, in pixels, as `drawTextOverlayToCanvasAnimated`
 * draws it: `lines × fontSize × 1.2` tall, plus the background's padding of
 * `0.3 × fontSize` above and below, scaled, centred on `y`.
 */
function captionBox(clip: Clip, height: number): Box {
  const text = clip.textData!;
  const lines = String(text.text).split('\n').length;
  const scale = text.scale ?? 1;
  const tall = (lines * text.fontSize * 1.2 + text.fontSize * 0.6) * scale;
  const centre = text.y * height;
  return { top: centre - tall / 2, bottom: centre + tall / 2 };
}

function isCaption(entry: StackEntry): boolean {
  return entry.track?.kind === 'captions' && entry.clip.overlayType === 'text' && !!entry.clip.textData;
}

/**
 * `active` with the captions of a second (third…) visible caption track raised
 * so no two tracks' captions overlap. Returns `active` itself when there is
 * nothing to move; otherwise a new array in the same order, with each moved
 * clip replaced by a copy whose `textData.y` is where it draws.
 */
export function stackCaptions<T extends StackEntry>(active: T[], height: number): T[] {
  // The common frame has at most one caption track up: answer it without
  // building anything, since this runs on every preview and export frame
  // (`drawFrame.perf.test.ts` and `exportWebM.perf.test.ts` count the
  // collections a frame makes).
  let firstTrack: string | null = null;
  let several = false;
  for (const entry of active) {
    if (!isCaption(entry)) continue;
    if (firstTrack === null) firstTrack = entry.track.id;
    else if (entry.track.id !== firstTrack) {
      several = true;
      break;
    }
  }
  if (!several) return active;

  const groups = new Map<string, T[]>();
  for (const entry of active) {
    if (!isCaption(entry)) continue;
    const group = groups.get(entry.track.id);
    if (group) group.push(entry);
    else groups.set(entry.track.id, [entry]);
  }
  if (groups.size < 2 || !(height > 0)) return active;

  // Lowest in the timeline first: it keeps its place.
  const ordered = [...groups.values()].sort((a, b) => a[0].track.index - b[0].track.index);
  const gap = CAPTION_STACK_GAP * height;
  const placed: Box[] = [];
  const shifts = new Map<Clip, number>();
  for (const group of ordered) {
    const boxes = group.map((entry) => captionBox(entry.clip, height));
    let top = Math.min(...boxes.map((box) => box.top));
    let bottom = Math.max(...boxes.map((box) => box.bottom));
    let shift = 0;
    // From the lowest box placed upward: each one in the way lifts this group above it.
    for (const box of [...placed].sort((a, b) => b.top - a.top)) {
      if (bottom > box.top - gap && top < box.bottom + gap) {
        const lift = bottom - (box.top - gap);
        shift += lift;
        top -= lift;
        bottom -= lift;
      }
    }
    placed.push({ top, bottom });
    if (shift > 0) for (const entry of group) shifts.set(entry.clip, shift / height);
  }
  if (shifts.size === 0) return active;

  return active.map((entry) => {
    const shift = shifts.get(entry.clip);
    if (shift === undefined) return entry;
    const textData = entry.clip.textData!;
    return { ...entry, clip: { ...entry.clip, textData: { ...textData, y: textData.y - shift } } };
  });
}
