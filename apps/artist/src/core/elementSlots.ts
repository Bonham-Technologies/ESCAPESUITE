// Which `<video>` element each live clip of a source draws from (ESCSUITE-313).
//
// A `<video>` element has one playhead. Two clips of one source live in the
// same frame — a clip split and crossfaded into a later part of itself, or the
// same recording duplicated on a track above as a zoom or picture-in-picture —
// want two moments of it at once, and every element-drawing path used to give a
// source exactly one element: the second clip's seek landed on it and both
// clips drew the second clip's moment.
//
// So a source has one element per *simultaneously live* clip, and a frame says
// which clip gets which: its slot, the clip's position among that source's live
// clips. Slot 0 is the source's own element — the one every path has always
// had, so a source with one live clip costs exactly what it did. Slot k > 0 is
// a k-th element over the same object URL, made the first time a frame needs it
// and kept, so a transition does not create and tear one down every frame. The
// export composer, the in-page MP4 source, the preview's seeks and its draw all
// ask this one function, so they cannot disagree about which element a clip is.
import type { Clip } from '../store/types';

/** The two sides of a running transition — all the assignment reads of one. */
export interface SlotTransition {
  outgoingClip: Clip;
  incomingClip: Clip;
}

/**
 * Each live media clip's slot, keyed by clip id.
 *
 * `activeClips` is the frame's live clips in the order the frame composites
 * them (`getClipsAtTime`'s track order), overlays included and skipped. The
 * k-th live clip of a source, in that order, is slot k − 1. A running
 * transition's two sides follow: the outgoing clip is normally live already and
 * keeps its slot; the incoming clip, which has not started yet, takes the next
 * free slot of its source.
 *
 * Stable within a frame, which is all it has to be: a clip whose slot changes
 * from one frame to the next — another clip of its source has started below it
 * — draws from a different element after one seek.
 */
export function assignElementSlots(
  activeClips: Iterable<{ clip: Clip }>,
  transition: SlotTransition | null
): Map<string, number> {
  const slots = new Map<string, number>();
  const taken = new Map<string, number>();
  const assign = (clip: Clip) => {
    if (slots.has(clip.id)) return;
    const slot = taken.get(clip.sourceVideoId) ?? 0;
    taken.set(clip.sourceVideoId, slot + 1);
    slots.set(clip.id, slot);
  };
  for (const { clip } of activeClips) {
    if (!clip.overlayType) assign(clip);
  }
  if (transition) {
    assign(transition.outgoingClip);
    assign(transition.incomingClip);
  }
  return slots;
}

/**
 * A source's `slot`-th element: its own for slot 0, else the (slot − 1)-th of
 * `extras`. Undefined when that element does not exist (yet), or could not be
 * loaded (`null`).
 */
export function videoForSlot(
  videos: ReadonlyMap<string, HTMLVideoElement>,
  extras: ReadonlyMap<string, readonly (HTMLVideoElement | null)[]> | undefined,
  sourceId: string,
  slot: number
): HTMLVideoElement | undefined {
  if (slot === 0) return videos.get(sourceId);
  return extras?.get(sourceId)?.[slot - 1] ?? undefined;
}
