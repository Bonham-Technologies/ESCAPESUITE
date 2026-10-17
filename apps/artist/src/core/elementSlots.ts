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
// export composer and the in-page MP4 source ask `assignElementSlots`, so they
// cannot disagree about which element a clip is.
//
// The preview asks `createStickySlotAssigner` instead (ESCSUITE-323), because
// its elements are playing playheads rather than frames seeked one at a time.
// The stateless rule re-packs a source's slots by track order every frame, so
// a clip of the source starting *below* a playing one took the playing one's
// element and pushed it onto another, which then had to seek — a stall on a
// clip that had not changed — and a split clip crossfading into itself lost,
// at the cut, the element its first frame had been held on. The sticky rule
// keeps a clip on the slot it had for as long as it stays live (or a side of
// the running transition), and gives a newcomer the lowest slot of its source
// no live clip holds. The exports keep the stateless rule: they seek every
// element every frame anyway, so a slot that moves when a clip starts costs
// them at most one extra seek, and a stateless answer cannot go stale.
import type { Clip } from '../store/types';

/** The two sides of a running transition — all the assignment reads of one. */
export interface SlotTransition {
  outgoingClip: Clip;
  incomingClip: Clip;
}

/** How many slots each source has handed out this call — scratch, module-wide. */
const taken = new Map<string, number>();

function assign(clip: Clip, out: Map<string, number>): void {
  if (out.has(clip.id)) return;
  const slot = taken.get(clip.sourceVideoId) ?? 0;
  taken.set(clip.sourceVideoId, slot + 1);
  out.set(clip.id, slot);
}

/**
 * Each live media clip's slot, keyed by clip id, written into `out`.
 *
 * `activeClips` is the frame's live clips in the order the frame composites
 * them (`getClipsAtTime`'s track order), overlays included and skipped. The
 * k-th live clip of a source, in that order, is slot k − 1. A running
 * transition's two sides follow: the outgoing clip is normally live already and
 * keeps its slot; the incoming clip, which has not started yet, takes the next
 * free slot of its source.
 *
 * `out` is cleared first. Synchronous and re-entrant only in the sense that
 * matters here: nothing it calls can call it back.
 *
 * Stable within a frame, which is all it has to be: a clip whose slot changes
 * from one frame to the next — another clip of its source has started below it
 * — draws from a different element after one seek.
 */
export function assignElementSlots(
  activeClips: Iterable<{ clip: Clip }>,
  transition: SlotTransition | null,
  out: Map<string, number>
): void {
  // Called every frame, so it allocates nothing: `out` is the caller's own
  // map, cleared and refilled, and `taken` is this module's scratch.
  out.clear();
  taken.clear();
  for (const { clip } of activeClips) {
    if (!clip.overlayType) assign(clip, out);
  }
  if (transition) {
    assign(transition.outgoingClip, out);
    assign(transition.incomingClip, out);
  }
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

/**
 * The preview's slot assignment (ESCSUITE-323): `assign` answers the same
 * question as {@link assignElementSlots}, over the same arguments, but
 * remembers its answers. A clip keeps the slot it was given for as long as each
 * call names it — live, or a side of the running transition — and a clip a
 * call does not name is forgotten, its slot free again. A clip seen for the
 * first time takes the lowest slot of its source that no remembered clip
 * holds, in the order the call names them, so the first call after a reset
 * agrees with the stateless rule exactly.
 */
export interface StickySlotAssigner {
  assign(
    activeClips: Iterable<{ clip: Clip }>,
    transition: SlotTransition | null,
    out: Map<string, number>
  ): void;
  /** Forget every clip: the next call assigns afresh. */
  reset(): void;
}

/** A remembered clip: the source it plays and the slot it holds. */
interface HeldSlot {
  source: string;
  slot: number;
}

/**
 * A fresh {@link StickySlotAssigner}. Its state is the closure's own, so two
 * previews (or two tests) never share one.
 *
 * `assign` runs on every paused scrub and whenever playback's set of live
 * clips changes, so it allocates only when a clip appears: `out` is the
 * caller's map, cleared and refilled, and the set of clips the call names is
 * scratch kept with the state.
 */
export function createStickySlotAssigner(): StickySlotAssigner {
  const held = new Map<string, HeldSlot>();
  const named = new Set<string>();

  const forgetIfUnnamed = (_: HeldSlot, clipId: string) => {
    if (!named.has(clipId)) held.delete(clipId);
  };

  /** The lowest slot of `source` no remembered clip holds. */
  const lowestFree = (source: string): number => {
    for (let slot = 0; ; slot += 1) {
      let taken = false;
      for (const entry of held.values()) {
        if (entry.source === source && entry.slot === slot) {
          taken = true;
          break;
        }
      }
      if (!taken) return slot;
    }
  };

  const place = (clip: Clip, out: Map<string, number>) => {
    // Assumes a clip's `sourceVideoId` never changes while it is remembered —
    // no editor action re-points a clip at another source — so a held entry's
    // `source` is not checked against it again.
    let entry = held.get(clip.id);
    if (!entry) {
      entry = { source: clip.sourceVideoId, slot: lowestFree(clip.sourceVideoId) };
      held.set(clip.id, entry);
    }
    out.set(clip.id, entry.slot);
  };

  return {
    assign(activeClips, transition, out) {
      out.clear();
      named.clear();
      for (const { clip } of activeClips) {
        if (!clip.overlayType) named.add(clip.id);
      }
      if (transition) {
        named.add(transition.outgoingClip.id);
        named.add(transition.incomingClip.id);
      }
      // Free the slots of clips that have left before handing any out.
      held.forEach(forgetIfUnnamed);
      for (const { clip } of activeClips) {
        if (!clip.overlayType) place(clip, out);
      }
      if (transition) {
        place(transition.outgoingClip, out);
        place(transition.incomingClip, out);
      }
    },
    reset() {
      held.clear();
    },
  };
}
