// One crop handle's gesture: the pointer drag, Escape, and the one store write a
// move makes (ESCSUITE-157). The arrow-key nudges join it in the same shape.
//
// The arithmetic is `core/cropDrag.ts`, and **both** of the decisions a crop
// write makes are shared with the inspector's own crop controls
// (`components/ClipEditor/useClipEditorActions.ts`' `handleCropChange`):
// `core/clipCrop.ts`'s `cropUpdateFor` for what the store may hold, and
// `cropDrag.ts`'s `cropWriteFor` for where the picture then sits (ESCSUITE-171 —
// before it, the inspector shared only the first and wrote `{ crop }` alone).
// What is here is the gesture, which is the one thing that is NOT shared: when
// it begins, what it reads, and the single `updateClip` it issues per animation
// frame. A drag rebases every move from the press; each inspector write is its
// own gesture and rebases from the clip's current state.
//
// **One write, not two.** A crop alone would shrink the picture about the clip's
// centre, so both edges of the axis would move and the handle would lag the
// pointer by half (ESCSUITE-6's "cropping shrinks the picture in place"). The
// write therefore carries a compensating `transform` beside the `crop`, built
// from the transform the gesture STARTED with — one `updateClip`, so one
// history push, one locked-track check and no compounding from the previous
// move. The same thing the resize handles do when they write `x`/`y` beside a
// scale.
//
// **Except on a clip whose placement is keyframed**, where the crop is written
// alone: a static centre on an animated one fights its keyframes and loses at
// playback. `cropCompensatesCentre` is that question, `cropWriteFor` acts on it,
// and the picture then shrinks about its centre as it is cropped (operator
// ruling, 2026-10-02; documented in `apps/artist/CLAUDE.md`).
//
// **One undo entry.** `hooks/useGestureHistory.ts`, unchanged: `begin` at the
// press, `commit` around the write inside the throttled updater — the throttler
// coalesces a frame's moves, so "the gesture's first write" has to mean the
// first that reaches the store — and `end` at the release. A keydown that is
// not a repeat begins; a repeat resumes; a keyup for a nudging key ends it, and
// blur ends it regardless of key — both ignored while a mouse drag is open
// (ESCSUITE-169), so a key released, or focus lost, mid-drag cannot end the
// gesture the mouse is still driving. `useSliderGesture`'s rule, equivalent.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { useGestureHistory, useThrottledDragUpdate } from '../../hooks';
import { cropUpdateFor } from '../../core/clipCrop';
import {
  CROP_NUDGE,
  cropAnnouncement,
  cropCompensatesCentre,
  cropForHandleMove,
  cropRegionAspect,
  cropsEqual,
  cropWriteFor,
  sourceDelta,
  type CropHandle,
} from '../../core/cropDrag';
import type { Clip, ClipCrop, ClipTransform, SourceVideo } from '../../store/types';
import type { ProjectSize } from './types';

// Appended to alternate announcements so two identical ones in a row are two
// different strings — an aria-atomic region whose text does not change is not
// re-read, which is exactly the case a user repeating one nudge is in.
// Deliberately a copy of the keyframe graph's
// (`KeyframePanel/hooks/useKeyframeGraphKeyboard.ts`) rather than an import of
// it: the graph owns its own live region, and importing from it would tie the
// preview to the keyframe panel for one character.
const ANNOUNCE_MARK = '​';

/** Which way each arrow moves a handle, in the clip's own frame. */
const ARROW_STEPS: Record<string, { x: number; y: number } | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * What a crop gesture needs that a hook cannot reach for itself.
 *
 * No `locked`: a locked row's handles are `disabled`, React delivers no mouse
 * event to a disabled control and a disabled button takes no focus, so there is
 * nothing here for a lock to refuse — and `updateClip` refuses the write anyway
 * for a row locked mid-gesture (ESCSUITE-84).
 */
export interface CropHandleGestureDeps {
  clip: Clip;
  source: SourceVideo;
  projectSize: ProjectSize;
  /** CSS pixels per project pixel, from the canvas' content box. */
  contentScale: number;
  /** Leave crop mode (Escape). */
  onLeave: () => void;
}

/** The listeners one handle binds, and what the live region is saying. */
export interface CropHandleGesture {
  onMouseDown: (handle: CropHandle, e: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (handle: CropHandle, e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  /**
   * Ends a keyboard nudge gesture — but only for a key that actually nudges
   * (the same `ARROW_STEPS` filter `onKeyDown` applies), and only while no
   * mouse drag is open (ESCSUITE-169): a key released — Shift, dropping the
   * aspect lock — mid-drag must not close the gesture the mouse is still
   * driving.
   */
  onKeyUp: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  /**
   * Ends a keyboard gesture on focus loss. Carries the same open-mouse-drag
   * guard as `onKeyUp`, but none of its key filter — blur has no key, and (as
   * `CropHandles.test.tsx` already held) it closes whatever keyboard gesture
   * is open regardless of which key is still down.
   */
  onBlur: () => void;
  message: string;
}

/** What the gesture read when it began, and never re-reads. */
interface CropGestureStart {
  handle: CropHandle;
  clientX: number;
  clientY: number;
  crop: ClipCrop | undefined;
  /**
   * The clip's whole transform, not just the five fields the arithmetic reads:
   * the write hands `updateClip` a complete `ClipTransform` with a new centre,
   * so `opacity` and `scaleLocked` have to come along unchanged.
   */
  transform: ClipTransform;
  /** The kept region's aspect at the press — what Shift holds. */
  aspect: number;
}

export function useCropHandleGesture({
  clip,
  source,
  projectSize,
  contentScale,
  onLeave,
}: CropHandleGestureDeps): CropHandleGesture {
  const updateClip = useEditorStore((state) => state.updateClip);
  const gestureHistory = useGestureHistory();
  const throttled = useThrottledDragUpdate<{ crop: ClipCrop; start: CropGestureStart }>();
  const [message, setMessage] = useState('');

  /**
   * The open drag's teardown, so an unmount mid-drag takes its two document
   * listeners with it (ESCSUITE-120's shape). Null between drags.
   */
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

  const announce = useCallback((text: string) => {
    setMessage((prev) => (prev.slice(-1) === ANNOUNCE_MARK ? text : text + ANNOUNCE_MARK));
  }, []);

  /**
   * Normalise one crop and write it — with the centre that keeps the pinned
   * edges still, unless the clip's placement is keyframed, in which case the
   * crop goes alone (operator ruling, 2026-10-02). Returns whether the store
   * wrote.
   */
  const write = useCallback(
    (next: ClipCrop, start: Pick<CropGestureStart, 'crop' | 'transform'>): boolean => {
      const update = cropUpdateFor(next, source);
      if (!update) return false;

      const payload = cropWriteFor(
        start,
        update.crop,
        source,
        projectSize,
        cropCompensatesCentre(clip.animation)
      );
      return gestureHistory.commit((skipHistory) => updateClip(clip.id, payload, skipHistory));
    },
    [clip.id, clip.animation, source, projectSize, updateClip, gestureHistory]
  );

  const onMouseDown = useCallback(
    (handle: CropHandle, e: ReactMouseEvent<HTMLButtonElement>) => {
      // No locked check: the button is `disabled` on a locked row and React
      // delivers it no mouse event at all.
      // No text selection and no scroll during the drag; focus is taken
      // explicitly, because preventDefault would otherwise leave the handle
      // unfocused and the arrow keys with nothing to nudge.
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.focus();

      const start: CropGestureStart = {
        handle,
        clientX: e.clientX,
        clientY: e.clientY,
        crop: clip.crop,
        transform: clip.transform,
        aspect: cropRegionAspect(clip.crop, source),
      };
      gestureHistory.begin();

      const onMove = (move: MouseEvent) => {
        const delta = sourceDelta(
          {
            x: (move.clientX - start.clientX) / contentScale,
            y: (move.clientY - start.clientY) / contentScale,
          },
          start.transform
        );
        const next = cropForHandleMove(
          start.crop,
          start.handle,
          delta,
          source,
          move.shiftKey ? start.aspect : undefined
        );
        throttled.scheduleUpdate((pending) => write(pending.crop, pending.start), {
          crop: next,
          start,
        });
      };

      const onUp = () => {
        throttled.flush();
        gestureHistory.end();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        endDragRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      endDragRef.current = onUp;
    },
    [clip.crop, clip.transform, source, contentScale, gestureHistory, throttled, write]
  );

  const onKeyDown = useCallback(
    (handle: CropHandle, e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onLeave();
        return;
      }

      const step = ARROW_STEPS[e.key];
      if (!step) return;
      // A focused control owns its arrows — the rule the keyframe graph states —
      // so all four are claimed even where the handle owns no inset on that
      // axis, rather than stepping the playhead out from under the user.
      e.preventDefault();
      e.stopPropagation();

      // Read the clip's crop and transform fresh from the store rather than the
      // `clip` prop: unlike a drag, a key press has no `start` object to rebase
      // from — each is its own gesture — so the SECOND of two presses has to see
      // what the FIRST one actually stored. In the mounted app that is also what
      // the prop holds, because `PreviewPlayer` re-renders this component from a
      // store subscription before the next keydown can reach it; reading the
      // store directly makes that true by construction rather than by timing.
      // Unlike the rest of this hook's unguarded reads of the `clip` prop,
      // `clip` here is a prop a caller can hand this component directly — this
      // file's own tests render it with an id the store does not hold — so the
      // lookup's absence is reachable, and refused rather than asserted away.
      const live = useEditorStore.getState().project.timeline.clips.find(
        (c) => c.id === clip.id
      );
      if (!live) return;

      const distance = e.shiftKey ? CROP_NUDGE.coarse : CROP_NUDGE.fine;
      // No `keepAspect` here: Shift means the coarse step on the keyboard,
      // not the aspect lock, which is a mouse-drag-only question
      // (`cropRegionAspect` is read once, at the press).
      const next = cropForHandleMove(
        live.crop,
        handle,
        { x: step.x * distance, y: step.y * distance },
        source
      );
      // An arrow the handle does not own, or a handle already clamped at the
      // frame's edge: writing this would spend an undo entry on a change of
      // nothing and announce an edit that did not happen.
      if (cropsEqual(next, live.crop)) return;

      // A held key is one undo entry, not one per repetition —
      // `useSliderGesture`'s rule for a held slider arrow.
      if (e.repeat) gestureHistory.resume();
      else gestureHistory.begin();

      // Refused by the store (a locked row): nothing changed, so the live region
      // must not say otherwise (ESCSUITE-87's shape).
      if (!write(next, { crop: live.crop, transform: live.transform })) return;
      // `?.` would be a dead branch: `write` only returns true after its own,
      // identical `cropUpdateFor(next, source)` call already returned truthy,
      // over the same two pure arguments — so this one cannot come back null.
      announce(cropAnnouncement(handle, cropUpdateFor(next, source)!.crop, source));
    },
    [clip, source, onLeave, gestureHistory, write, announce]
  );

  const onKeyUp = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      // A mouse drag already owns this gesture; its own `mouseup` is what
      // ends it, so a key released mid-drag — Shift, most often, releasing
      // the aspect lock without releasing the mouse — must leave it open.
      if (endDragRef.current) return;
      // Selective the way `onKeyDown` already is: only a key that actually
      // nudges a handle closes the keyboard gesture it opened. Any other
      // keyup reaching a focused handle must not end one.
      if (!ARROW_STEPS[e.key]) return;
      gestureHistory.end();
    },
    [gestureHistory]
  );

  const onBlur = useCallback(() => {
    // Same guard as `onKeyUp`'s first: a focus change mid-drag — a window
    // switch, say — must not end a gesture the mouse is still driving either.
    if (endDragRef.current) return;
    gestureHistory.end();
  }, [gestureHistory]);

  return { onMouseDown, onKeyDown, onKeyUp, onBlur, message };
}
