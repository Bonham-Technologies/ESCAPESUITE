// Zoom to region (ESCSUITE-475): the box on the preview and the form under it.
//
// `useZoomRegion` (beside this file) holds the box the user asked for and fits it, every render,
// to where the clip's picture is at the playhead (`utils/zoomToRegion.ts`), so
// the picker and the form always show the box Apply would write. The picker is
// a DOM layer over the canvas, laid out like `CropHandles` (the object-fit:
// contain mapping into the element's CSS pixels); the form is where a keyboard
// or screen-reader user sets the same box with four numbers instead of a drag.
//
// Apply writes the whole zoom with one `updateClipAnimation`, so one undo takes
// it all away and one redo puts it all back.
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { useCommittedNumberInput } from '../ClipEditor/useCommittedNumberInput';
import { EASING_TYPES } from '../../utils/easingOptions';
import {
  DEFAULT_ZOOM_SETTINGS,
  MIN_ZOOM_STEP,
  dragZoomRect,
  planZoomToRegion,
  type ZoomRect,
  type ZoomSettings,
} from '../../utils/zoomToRegion';
import type { EasingType } from '../../store/types';
import { contentBox } from './previewGeometry';
import { regionCssBox, type ZoomRegionTarget } from './zoomRegionTarget';
import type { ProjectSize } from './types';
import styles from './ZoomRegion.module.css';

/** The inspector's "Zoom to region" button (`ClipEditor/ActionsSection.tsx`). */
const TOGGLE_SELECTOR = '[data-zoom-region-toggle]';

/** How far, in CSS pixels, a press has to move before it draws a new box. */
const DRAG_THRESHOLD = 3;

export interface ZoomRegionPickerProps {
  /** The preview canvas the layer covers. */
  canvas: HTMLCanvasElement;
  projectSize: ProjectSize;
  region: ZoomRect | null;
  onRegionChange: (rect: ZoomRect) => void;
}

/** The layer a box is dragged on, over the canvas' picture. */
export function ZoomRegionPicker({ canvas, projectSize, region, onRegionChange }: ZoomRegionPickerProps) {
  // The canvas' CSS box, followed while the tool is open — `CropHandles`' own
  // observer, for the same reason.
  const [box, setBox] = useState(() => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const { contentRect } of entries) {
        setBox({ width: contentRect.width, height: contentRect.height });
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);
  // A drag in progress: how to end it, so an unmount mid-drag ends it too.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  const content = contentBox(canvas, box, projectSize);
  if (content.scaleX <= 0) return null;

  // Mouse events with the move and release on `window`, the shape every other
  // preview gesture has (`useCropHandleGesture`, `useTransformHandles`), so a
  // drag that leaves the picture keeps drawing until the button comes up.
  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    endDrag.current?.();
    const rect = e.currentTarget.getBoundingClientRect();
    const toProject = (clientX: number, clientY: number) => ({
      x: (clientX - rect.left) / content.scaleX,
      y: (clientY - rect.top) / content.scaleY,
    });
    const start = toProject(e.clientX, e.clientY);
    const from = { x: e.clientX, y: e.clientY };
    const move = (ev: MouseEvent) => {
      if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_THRESHOLD) return;
      onRegionChange(dragZoomRect(start, toProject(ev.clientX, ev.clientY), projectSize));
    };
    const end = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      endDrag.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    endDrag.current = end;
  };

  const css = region && regionCssBox(region, content);

  return (
    <div
      className={styles.layer}
      // Mouse only: the form's four number fields are the same box for a
      // keyboard or a screen reader, so the layer stays out of the a11y tree.
      aria-hidden="true"
      data-testid="zoom-region-picker"
      style={{ left: content.offsetX, top: content.offsetY, width: content.width, height: content.height }}
      onMouseDown={onMouseDown}
    >
      {css && (
        <div className={styles.region} style={{ left: css.x, top: css.y, width: css.width, height: css.height }} />
      )}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}

function NumberField({ label, unit, value, min, max, step, onCommit }: NumberFieldProps) {
  const id = useId();
  const field = useCommittedNumberInput({ value, min, max, onCommit });
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={field.text}
        onChange={field.onChange}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
      />
      <span className={styles.unit} aria-hidden="true">
        {unit}
      </span>
    </div>
  );
}

export interface ZoomRegionFormProps {
  target: ZoomRegionTarget;
  projectSize: ProjectSize;
  region: ZoomRect | null;
  onRegionChange: (rect: ZoomRect) => void;
  /** The clip's track is locked (ESCSUITE-84): Apply refuses, saying why. */
  locked: boolean;
  /** Close the tool. */
  onLeave: () => void;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The tool's form: the box as four numbers, the timing, Apply and Cancel. */
export function ZoomRegionForm({ target, projectSize, region, onRegionChange, locked, onLeave }: ZoomRegionFormProps) {
  const headingId = useId();
  const easingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  // Focus follows the tool: opened from the inspector's button, the form takes
  // focus on its first field, so a keyboard user lands where the box is typed
  // rather than a whole layout away from it; closed (Apply, Cancel, Escape)
  // with focus inside it, focus goes back to that button instead of dropping
  // to the page. A form that appears for any other reason (the clip selected
  // again) leaves focus where the user put it.
  useEffect(() => {
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active.matches(TOGGLE_SELECTOR) ? active : null;
    if (opener) sectionRef.current?.querySelector('input')?.focus();
    const section = sectionRef.current;
    return () => {
      const now = document.activeElement;
      const focusWasInside = !now || now === document.body || (section != null && section.contains(now));
      if (!focusWasInside) return;
      const toggle = opener?.isConnected ? opener : document.querySelector<HTMLElement>(TOGGLE_SELECTOR);
      toggle?.focus();
    };
  }, []);
  const [settings, setSettings] = useState<ZoomSettings>(DEFAULT_ZOOM_SETTINGS);
  const [message, setMessage] = useState<string | null>(null);
  const updateClipAnimation = useEditorStore((state) => state.updateClipAnimation);
  // A refusal is the last thing in a form that scrolls when the preview is
  // short (a phone): bring it into view rather than leave it below the fold.
  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [message]);
  const { clip, source } = target;
  const aspect = projectSize.width / projectSize.height;
  const r = region ?? { x: 0, y: 0, width: 0, height: 0 };
  // A refusal answers the box and timing it was given; any change makes it stale.
  const changeRegion = (rect: ZoomRect) => {
    setMessage(null);
    onRegionChange(rect);
  };
  const changeSettings = (update: Partial<ZoomSettings>) => {
    setMessage(null);
    setSettings((s) => ({ ...s, ...update }));
  };

  const apply = () => {
    if (locked) {
      setMessage("The clip's track is locked. Unlock it to add a zoom.");
      return;
    }
    const plan = planZoomToRegion({
      clip,
      source,
      project: projectSize,
      clipTime: useEditorStore.getState().currentTime - clip.timelinePosition,
      region: r,
      settings,
    });
    if (!plan.ok) {
      setMessage(plan.reason);
      return;
    }
    updateClipAnimation(clip.id, { keyframes: plan.keyframes });
    onLeave();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onLeave();
    }
  };

  return (
    <section ref={sectionRef} className={styles.form} aria-labelledby={headingId} onKeyDown={onKeyDown}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Zoom to region
        </h2>
        <p className={styles.hint}>
          Drag a box on the preview, or type it in project pixels. The zoom starts at the playhead.
        </p>
      </div>
      <div className={styles.fields}>
        <NumberField label="Region X" unit="px" value={round(r.x)} min={0} max={projectSize.width} step={1}
          onCommit={(x) => changeRegion({ ...r, x })} />
        <NumberField label="Region Y" unit="px" value={round(r.y)} min={0} max={projectSize.height} step={1}
          onCommit={(y) => changeRegion({ ...r, y })} />
        <NumberField label="Region width" unit="px" value={round(r.width)} min={1} max={projectSize.width} step={1}
          onCommit={(width) => changeRegion({ ...r, width, height: width / aspect })} />
        <NumberField label="Region height" unit="px" value={round(r.height)} min={1} max={projectSize.height} step={1}
          onCommit={(height) => changeRegion({ ...r, width: height * aspect, height })} />
        <NumberField label="Hold" unit="s" value={settings.hold} min={MIN_ZOOM_STEP} max={600} step={0.1}
          onCommit={(hold) => changeSettings({ hold })} />
        <NumberField label="Transition" unit="s" value={settings.transition} min={MIN_ZOOM_STEP} max={10} step={0.1}
          onCommit={(transition) => changeSettings({ transition })} />
        <div className={styles.field}>
          <label htmlFor={easingId}>Easing</label>
          <select
            id={easingId}
            value={settings.easing}
            onChange={(e) => changeSettings({ easing: e.target.value as EasingType })}
          >
            {EASING_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {/* In the fields' wrapping row rather than a row of their own: the
            form takes its height from the preview's picture. */}
        <div className={styles.buttons}>
          <button type="button" className={styles.apply} onClick={apply}>
            Apply zoom
          </button>
          <button type="button" className={styles.cancel} onClick={onLeave}>
            Cancel
          </button>
        </div>
      </div>
      {message && (
        <p ref={messageRef} className={styles.message} role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
