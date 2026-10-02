// One crop handle's gesture: the pointer drag, Escape, and the one store write a
// move makes (ESCSUITE-157). The arrow-key nudges join it in the same shape.
//
// The arithmetic is `core/cropDrag.ts` and the write decision is
// `core/clipCrop.ts`'s `cropUpdateFor`, shared with the inspector's sliders.
// What is here is the gesture: when it begins, what it reads, and the single
// `updateClip` it issues per animation frame.
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
// not a repeat begins; a repeat resumes; keyup and blur end. `useSliderGesture`'s
// rule verbatim.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { useGestureHistory, useThrottledDragUpdate } from '../../hooks';
import { cropUpdateFor } from '../../core/clipCrop';
import {
  cropCompensatesCentre,
  cropForHandleMove,
  cropRegionAspect,
  cropWriteFor,
  sourceDelta,
  type CropHandle,
} from '../../core/cropDrag';
import type { Clip, ClipCrop, ClipTransform, SourceVideo } from '../../store/types';
import type { ProjectSize } from './types';

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
  /** Ends a keyboard gesture. Bound to keyup AND blur, as the sliders' is. */
  onKeyUp: () => void;
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
  // Nothing writes this yet — the arrow nudges do, in Task 5. The live region it
  // feeds is rendered from the start regardless: an aria-live region has to
  // exist before its content changes for a screen reader to announce one.
  const [message] = useState('');

  /**
   * The open drag's teardown, so an unmount mid-drag takes its two document
   * listeners with it (ESCSUITE-120's shape). Null between drags.
   */
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

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

  // Escape only, for now: Task 5 adds the arrow branch below it, red first. The
  // `handle` parameter is already taken because every button passes it and the
  // arrows are what will read it.
  const onKeyDown = useCallback(
    (_handle: CropHandle, e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onLeave();
      }
    },
    [onLeave]
  );

  const onKeyUp = useCallback(() => gestureHistory.end(), [gestureHistory]);

  return { onMouseDown, onKeyDown, onKeyUp, message };
}
