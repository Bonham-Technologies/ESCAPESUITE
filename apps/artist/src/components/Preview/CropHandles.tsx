// Crop mode's handles: eight buttons on the kept region's corners and edges
// (ESCSUITE-157).
//
// A DOM layer over the canvas, beside `MarqueeSelection` and
// `InlineTextEditorAnchor` and positioned the same way — the clip's box in
// project pixels, through the object-fit: contain mapping, into the element's
// own CSS pixels. DOM rather than canvas chrome for three reasons: a handle has
// to be focusable and named for a keyboard user, it has to be disable-able on
// its own for a locked track, and a CSS-pixel size is exactly what ESCSUITE-90
// asks of chrome. The clip's rotation is one CSS `rotate()` on the frame, so
// the eight positions inside it are percentages.
//
// The dim behind it — the cropped-away picture — is canvas chrome and lives in
// `cropOverlay.ts`.
import { useEffect, useState } from 'react';
import { CROP_HANDLES, CROP_HANDLE_LABELS } from '../../core/cropDrag';
import { contentBox, getOverlayBounds } from './previewGeometry';
import { CROP_HANDLE_MODES, cropFrameBox } from './cropOverlay';
import { getCursorForMode } from './cursor';
import { useCropHandleGesture } from './useCropHandleGesture';
import type { TransitionInfo } from '../../core/exportTypes';
import type { Clip, SourceVideo } from '../../store/types';
import type { ProjectSize } from './types';
import styles from './CropHandles.module.css';

export interface CropHandlesProps {
  clip: Clip;
  source: SourceVideo;
  /** The preview canvas the handles are positioned over. */
  canvas: HTMLCanvasElement;
  projectSize: ProjectSize;
  /** The playhead, so the handles sit on the clip's animated box. */
  time: number;
  /** The clip's track is locked (ESCSUITE-84): the handles are inert. */
  locked: boolean;
  /**
   * The transition active at `time`, as `getActiveTransition` reports it
   * (ESCSUITE-147) — so the handles sit on the box the renderer draws rather
   * than on the clip's own Animate Out preset, when a transition has taken that
   * side over.
   */
  transition?: TransitionInfo | null;
  /** Leave crop mode. */
  onLeave: () => void;
}

export function CropHandles({
  clip,
  source,
  canvas,
  projectSize,
  time,
  locked,
  transition,
  onLeave,
}: CropHandlesProps) {
  // The canvas element's CSS box, followed for as long as crop mode is open.
  // An observer of its own rather than a prop from `PreviewPlayer`, which keeps
  // its box in a ref precisely so a resize does not re-render the preview
  // subtree: this layer only exists in crop mode, so the render a resize costs
  // here is bounded by the mode being open.
  const [box, setBox] = useState(() => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      // Every entry, rather than the last one behind a "was there an entry at
      // all" guard: one observed element's entries arrive in order, so the last
      // write wins either way, and the loop needs no conditional that no
      // observer can take the other side of.
      for (const { contentRect } of entries) {
        setBox({ width: contentRect.width, height: contentRect.height });
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);

  const content = contentBox(canvas, box, projectSize);
  // `locked` is not handed to the gesture: the buttons below are `disabled`, so
  // React delivers them no mouse event and they take no focus. A keydown aimed
  // straight at one is the only way in, and `updateClip` refuses that write
  // (ESCSUITE-84) — which is also the backstop for a row locked mid-drag.
  const gesture = useCropHandleGesture({
    clip,
    source,
    projectSize,
    contentScale: content.scaleX,
    onLeave,
  });

  // The same `getOverlayBounds` the selection chrome, the hit test, the marquee
  // and the drag seed read, under the same transition suppression (ESCSUITE-147),
  // so the crop frame cannot disagree with the box the rest of the preview draws
  // — or with the picture the handles are laid over.
  const bounds = getOverlayBounds(clip, canvas, time, [source], projectSize, { transition });
  if (!bounds) return null;
  // A preview whose panel has been dragged shut reports a 0x0 box — the case
  // ESCSUITE-90's `handleScreenScale` guards for the same arithmetic — and a
  // content box with no area is a `contentScale` of 0 for the gesture to divide
  // a pointer displacement by: one move would be an infinite delta and a crop
  // slammed to its clamp. Nothing is drawn at all instead, which is also the
  // honest answer for a layer with no pixels to lay handles on. One condition
  // and not two: `contentBox` derives each axis from the other, so a zero on
  // one is a zero on both.
  if (content.scaleX <= 0) return null;

  const frame = cropFrameBox(bounds, content);

  return (
    <>
      <div
        className={styles.frame}
        role="group"
        aria-label="Crop handles"
        style={{
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          transform: `rotate(${frame.rotation}deg)`,
        }}
      >
        {CROP_HANDLES.map((handle) => (
          <button
            key={handle}
            type="button"
            className={`${styles.handle} ${styles[handle]}`}
            style={{
              // One computed cursor rather than a keyword here and a
              // `:disabled` rule in the stylesheet: an inline style beats any
              // class rule, so the rule would never apply and a locked row's
              // handle would advertise a resize it refuses. `not-allowed` is
              // ESCSUITE-88's answer for exactly that.
              cursor: locked ? 'not-allowed' : getCursorForMode(CROP_HANDLE_MODES[handle]),
            }}
            aria-label={CROP_HANDLE_LABELS[handle]}
            disabled={locked}
            onMouseDown={(e) => gesture.onMouseDown(handle, e)}
            onKeyDown={(e) => gesture.onKeyDown(handle, e)}
            onKeyUp={gesture.onKeyUp}
            onBlur={gesture.onBlur}
          />
        ))}
      </div>

      {/* Always rendered, never conditional: a live region has to exist before
          its content changes for a screen reader to announce the change. */}
      <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {gesture.message}
      </span>
    </>
  );
}
