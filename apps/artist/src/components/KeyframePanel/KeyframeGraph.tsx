import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { getAllKeyframesForProperty, interpolateKeyframes, KEYFRAME_TIME_EPSILON } from '../../utils/animation';
import type { AnimatableProperty, Keyframe, ClipAnimation, ClipTransform, ClipEffects, EasingType } from '../../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import { EASING_TYPES } from '../../utils/easingOptions';
import { useGestureHistory } from '../../hooks/useGestureHistory';
import {
  formatValue,
  keyframeOptionId,
  keyframeOptionLabel,
  occupiedTimeMessage,
  PROPERTY_LABELS,
  useKeyframeGraphKeyboard,
} from './hooks/useKeyframeGraphKeyboard';
import styles from './KeyframeGraph.module.css';

interface KeyframeGraphProps {
  property: AnimatableProperty;
  clipDuration: number;
  animation: ClipAnimation | undefined;
  transform: ClipTransform;
  effects: ClipEffects;
  playheadTime: number;
  /**
   * Whether the clip sits on a locked track (ESCSUITE-88). Reading the curve is
   * unaffected — hover, click-to-select, the easing value on show, walking the
   * options with the keyboard — and every edit refuses at the gesture's start
   * rather than being swallowed by the store: no drag, no double-click add, no
   * right-click delete, the easing `<select>` disabled, and an edit key
   * announcing "Track is locked".
   */
  locked: boolean;
  /**
   * `skipHistory` folds an auto-repeated key's edit into the previous undo step.
   * Both return whether the store wrote (ESCSUITE-87) — the keyboard reads it,
   * so a nudge the lock refused announces nothing and moves no selection.
   */
  onKeyframeMoved: (property: AnimatableProperty, originalTime: number, newTime: number, skipHistory?: boolean) => boolean;
  onKeyframeValueChanged: (property: AnimatableProperty, time: number, newValue: number, skipHistory?: boolean) => boolean;
  onAddKeyframe: (property: AnimatableProperty, time: number, value: number) => void;
  /** Returns whether the store removed the keyframe — as the two above do. */
  onDeleteKeyframe?: (property: AnimatableProperty, time: number) => boolean;
  /** Omit to hide the per-keyframe easing control entirely. */
  onKeyframeEasingChanged?: (property: AnimatableProperty, time: number, easing: EasingType) => void;
}

// Property value ranges for display
const PROPERTY_RANGES: Record<AnimatableProperty, { min: number; max: number; step: number }> = {
  x: { min: 0, max: 1, step: 0.1 },
  y: { min: 0, max: 1, step: 0.1 },
  scaleX: { min: 0, max: 3, step: 0.5 },
  scaleY: { min: 0, max: 3, step: 0.5 },
  rotation: { min: -360, max: 360, step: 90 },
  opacity: { min: 0, max: 1, step: 0.25 },
  blur: { min: 0, max: 50, step: 10 },
  volume: { min: 0, max: 1, step: 0.25 },
};

const GRAPH_PADDING = { top: 20, right: 20, bottom: 30, left: 50 };
const SAMPLE_INTERVAL = 4; // pixels between curve samples

/**
 * A hair past `KEYFRAME_TIME_EPSILON` itself, so a clamped landing clears
 * `handleMouseUp`'s own `< KEYFRAME_TIME_EPSILON` occupied check with room
 * to spare — see `useKeyframeDrag.ts`'s identical constant for the float
 * arithmetic this works around (`occupiedTime ± KEYFRAME_TIME_EPSILON`
 * occasionally measures back as a hair under the epsilon it used to compute
 * itself). Nine orders of magnitude below the epsilon it rides on.
 */
const CLAMP_MARGIN = 1e-9;

export function KeyframeGraph({
  property,
  clipDuration,
  animation,
  transform,
  effects,
  playheadTime,
  locked,
  onKeyframeMoved,
  onKeyframeValueChanged,
  onAddKeyframe,
  onDeleteKeyframe,
  onKeyframeEasingChanged,
}: KeyframeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Safari does not focus a tabindex element on mousedown, so the pointer
  // handlers take focus explicitly — click-then-Delete has to keep working there.
  const focusGraph = useCallback(() => {
    svgRef.current?.focus();
  }, []);

  // Track drag state with refs to avoid re-render issues during drag
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    originalTime: number;    // Original keyframe time when drag started
    originalValue: number;   // Original keyframe value when drag started
    currentTime: number;     // Current time during drag (visual only)
    currentValue: number;    // Current value during drag (visual only)
    dragType: 'time' | 'value' | 'both';
  } | null>(null);

  // Selected keyframe for deletion
  const [selectedKeyframeTime, setSelectedKeyframeTime] = useState<number | null>(null);

  // Get all keyframes for this property (filter out any with invalid values)
  const keyframes = useMemo(() => {
    const allKeyframes = getAllKeyframesForProperty(
      property,
      clipDuration,
      animation,
      transform || DEFAULT_TRANSFORM,
      effects || DEFAULT_EFFECTS
    );
    // Filter out keyframes with undefined or NaN values
    return allKeyframes.filter(kf =>
      kf.value !== undefined &&
      kf.value !== null &&
      Number.isFinite(kf.value)
    );
  }, [property, clipDuration, animation, transform, effects]);

  // Check if a keyframe is custom (user-created)
  const isCustomKeyframe = useCallback((kf: Keyframe): boolean => {
    const customKfs = animation?.keyframes[property] || [];
    return customKfs.some(ckf => Math.abs(ckf.time - kf.time) < 0.001);
  }, [animation, property]);

  // Get value range for this property
  const range = PROPERTY_RANGES[property];

  // Get default value for property
  const defaultValue = useMemo(() => {
    if (property === 'blur') return effects?.blur ?? 0;
    if (property === 'volume') return 1; // Volume default is 1 (100%)
    const val = transform?.[property as keyof ClipTransform];
    return typeof val === 'number' ? val : 0;
  }, [property, transform, effects]);

  // The selected keyframe, when it is one the user can edit. Preset keyframes
  // are never selectable (see the isCustomKeyframe guards below), so this is
  // undefined for them and the easing control simply does not render.
  const selectedKeyframe = selectedKeyframeTime === null
    ? undefined
    : keyframes.find(kf => Math.abs(kf.time - selectedKeyframeTime) < 0.001 && isCustomKeyframe(kf));

  const { activeIndex, activeId, setActiveTime, nudgeMessage, announce, onKeyDown } = useKeyframeGraphKeyboard({
    property,
    keyframes,
    isCustomKeyframe,
    selectedKeyframe,
    setSelectedKeyframeTime,
    clipDuration,
    playheadTime,
    defaultValue,
    range,
    locked,
    onKeyframeMoved,
    onKeyframeValueChanged,
    onAddKeyframe,
    onDeleteKeyframe,
  });

  // Calculate SVG dimensions and coordinate conversions
  const graphDimensions = useMemo(() => {
    const width = 500; // Default width, will be responsive
    const height = 200;
    const innerWidth = width - GRAPH_PADDING.left - GRAPH_PADDING.right;
    const innerHeight = height - GRAPH_PADDING.top - GRAPH_PADDING.bottom;

    return {
      width,
      height,
      innerWidth,
      innerHeight,
      // Convert time to X coordinate
      timeToX: (time: number) => GRAPH_PADDING.left + (time / clipDuration) * innerWidth,
      // Convert X coordinate to time
      xToTime: (x: number) => ((x - GRAPH_PADDING.left) / innerWidth) * clipDuration,
      // Convert value to Y coordinate (inverted because SVG Y goes down)
      valueToY: (value: number) => {
        const normalized = (value - range.min) / (range.max - range.min);
        return GRAPH_PADDING.top + (1 - normalized) * innerHeight;
      },
      // Convert Y coordinate to value
      yToValue: (y: number) => {
        const normalized = 1 - (y - GRAPH_PADDING.top) / innerHeight;
        return range.min + normalized * (range.max - range.min);
      },
    };
  }, [clipDuration, range]);

  // Generate curve path by sampling interpolated values
  const curvePath = useMemo(() => {
    if (keyframes.length === 0) {
      // No keyframes - draw flat line at default value
      const y = graphDimensions.valueToY(defaultValue);
      return `M ${GRAPH_PADDING.left} ${y} L ${GRAPH_PADDING.left + graphDimensions.innerWidth} ${y}`;
    }

    const points: string[] = [];
    const numSamples = Math.floor(graphDimensions.innerWidth / SAMPLE_INTERVAL);

    for (let i = 0; i <= numSamples; i++) {
      const x = GRAPH_PADDING.left + (i / numSamples) * graphDimensions.innerWidth;
      const time = graphDimensions.xToTime(x);
      const value = interpolateKeyframes(keyframes, time, defaultValue);
      const y = graphDimensions.valueToY(value);

      points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }

    return points.join(' ');
  }, [keyframes, graphDimensions, defaultValue]);

  // Generate grid lines
  const gridLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; label?: string }[] = [];

    // Horizontal lines (value)
    const numValueLines = Math.floor((range.max - range.min) / range.step) + 1;
    for (let i = 0; i < numValueLines; i++) {
      const value = range.min + i * range.step;
      const y = graphDimensions.valueToY(value);
      lines.push({
        x1: GRAPH_PADDING.left,
        y1: y,
        x2: GRAPH_PADDING.left + graphDimensions.innerWidth,
        y2: y,
        label: formatValue(value, property),
      });
    }

    // Vertical lines (time) - one per second
    const numTimeLines = Math.ceil(clipDuration);
    for (let i = 0; i <= numTimeLines; i++) {
      const time = i;
      if (time > clipDuration) continue;
      const x = graphDimensions.timeToX(time);
      lines.push({
        x1: x,
        y1: GRAPH_PADDING.top,
        x2: x,
        y2: GRAPH_PADDING.top + graphDimensions.innerHeight,
        label: `${time}s`,
      });
    }

    return lines;
  }, [range, clipDuration, graphDimensions, property]);

  // Handle mouse down on keyframe point
  const handleKeyframeMouseDown = useCallback((e: React.MouseEvent, kf: Keyframe) => {
    if (!isCustomKeyframe(kf)) return; // Can't drag preset keyframes
    // A locked track refuses the whole gesture rather than the write at the end
    // of it (ESCSUITE-88): the keyframe would follow the pointer and then snap
    // back on release, which reads as a bug. The click handler still selects it.
    if (locked) return;

    e.preventDefault();
    e.stopPropagation();

    focusGraph();
    setActiveTime(kf.time);
    setSelectedKeyframeTime(kf.time);
    occupiedTimesRef.current = keyframes
      .map(k => k.time)
      .filter(t => Math.abs(t - kf.time) >= KEYFRAME_TIME_EPSILON);
    setDragState({
      isDragging: true,
      originalTime: kf.time,
      originalValue: kf.value,
      currentTime: kf.time,
      currentValue: kf.value,
      dragType: e.shiftKey ? 'value' : e.altKey ? 'time' : 'both',
    });
  }, [isCustomKeyframe, locked, focusGraph, setActiveTime, keyframes]);

  // Handle click on keyframe to select it
  const handleKeyframeClick = useCallback((e: React.MouseEvent, kf: Keyframe) => {
    e.stopPropagation();
    focusGraph();
    setActiveTime(kf.time);
    // The selection follows the active option and a preset is never selectable
    // — the same rule the keyboard's activateIndex follows. Leaving the
    // previously clicked custom keyframe selected here would let Delete and the
    // value nudges act on a keyframe that is not the one drawn as active.
    setSelectedKeyframeTime(isCustomKeyframe(kf) ? kf.time : null);
  }, [isCustomKeyframe, focusGraph, setActiveTime]);

  // Handle right-click on keyframe to delete
  const handleKeyframeContextMenu = useCallback((e: React.MouseEvent, kf: Keyframe) => {
    // preventDefault first, and whatever the lock says: the browser menu is
    // suppressed over a keyframe either way.
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;
    if (isCustomKeyframe(kf) && onDeleteKeyframe) {
      onDeleteKeyframe(property, kf.time);
    }
  }, [isCustomKeyframe, locked, onDeleteKeyframe, property]);

  // Convert screen coordinates to SVG viewBox coordinates
  // Must account for preserveAspectRatio="xMidYMid meet" which centers content
  const screenToSvgCoords = useCallback((e: React.MouseEvent | MouseEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    const viewBoxWidth = graphDimensions.width;
    const viewBoxHeight = graphDimensions.height;

    // With "meet", content scales uniformly to fit while preserving aspect ratio
    const scaleX = rect.width / viewBoxWidth;
    const scaleY = rect.height / viewBoxHeight;
    const scale = Math.min(scaleX, scaleY); // "meet" uses the smaller scale

    // Calculate the actual rendered size of the viewBox content
    const renderedWidth = viewBoxWidth * scale;
    const renderedHeight = viewBoxHeight * scale;

    // Calculate offset due to centering (xMidYMid)
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;

    // Convert screen position to viewBox coordinates
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const x = (screenX - offsetX) / scale;
    const y = (screenY - offsetY) / scale;

    return { x, y };
  }, [graphDimensions]);

  // Use refs to track drag state for the event handlers to avoid stale closures
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  /**
   * Every occupied time but the one being dragged, snapshotted once per
   * gesture — `handleKeyframeMouseDown`'s twin of `useKeyframeDrag.ts`'s own
   * `occupiedTimesRef`, added so `handleMouseMove` below can clamp against it
   * on every move without recomputing (and reallocating) the filter per
   * pointer frame (ESCSUITE-183). `keyframes` is every handle drawn on the
   * graph, presets included, the same list `handleMouseUp`'s own occupied
   * check already reads.
   */
  const occupiedTimesRef = useRef<number[]>([]);

  // One gesture is one undo entry (ESCSUITE-163 / M1), the same mechanism
  // useTrimDrag and useTransformHandles already use: the move's own write,
  // when there is one, goes first and reports whether it landed, and the
  // value write joins its entry via `skipHistory` rather than pushing one of
  // its own.
  const gestureHistory = useGestureHistory();

  // Global mouse move/up handlers for drag (using window events for reliable tracking)
  useEffect(() => {
    if (!dragState?.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const coords = screenToSvgCoords(e);
      if (!coords) return;

      const { x, y } = coords;

      let newTime = Math.max(0, Math.min(graphDimensions.xToTime(x), clipDuration));
      const newValue = Math.max(range.min, Math.min(graphDimensions.yToValue(y), range.max));

      // Clamp away from every neighbour's epsilon window (ESCSUITE-183): one
      // pass over the once-per-gesture occupied list, no allocation. The
      // point can no longer be dragged onto a neighbour and refused on
      // release — it stops at the window's edge instead. Re-clamped to the
      // clip bounds afterwards, since a neighbour right at an edge could
      // otherwise push the point just past it.
      for (const occupiedTime of occupiedTimesRef.current) {
        if (Math.abs(newTime - occupiedTime) < KEYFRAME_TIME_EPSILON) {
          newTime = newTime < occupiedTime
            ? occupiedTime - KEYFRAME_TIME_EPSILON - CLAMP_MARGIN
            : occupiedTime + KEYFRAME_TIME_EPSILON + CLAMP_MARGIN;
        }
      }
      newTime = Math.max(0, Math.min(newTime, clipDuration));

      // Update visual position only (don't commit to store yet)
      setDragState(prev => {
        if (!prev) return null;
        return {
          ...prev,
          currentTime: prev.dragType === 'value' ? prev.originalTime : newTime,
          currentValue: prev.dragType === 'time' ? prev.originalValue : newValue,
        };
      });
    };

    const handleMouseUp = () => {
      const currentDrag = dragStateRef.current;
      if (currentDrag) {
        const timeChanged = Math.abs(currentDrag.currentTime - currentDrag.originalTime) > 0.001;
        const valueChanged = Math.abs(currentDrag.currentValue - currentDrag.originalValue) > 0.001;

        // `moveClipKeyframe` deletes whatever CUSTOM keyframe already sits
        // within KEYFRAME_TIME_EPSILON of the target, so a drop that still
        // lands there is refused outright instead of silently destroying a
        // neighbour (ESCSUITE-179) — the same refusal the keyboard's own
        // `nudgeTime` makes for the identical situation, and announced
        // through the exact same message and live region (`announce`,
        // shared out of `useKeyframeGraphKeyboard`). `keyframes` is every
        // handle drawn on the graph, presets included: landing on a
        // PRESET's handle is refused too, but for a different reason — the
        // store deletes nothing there (a preset is regenerated from
        // `animation.in`/`out`, never stored as a keyframe), but
        // `getAllKeyframesForProperty` merges two handles within the same
        // epsilon and the custom one wins, so the preset's handle would
        // simply vanish behind it. Backstop, not the common case
        // (ESCSUITE-183): `handleMouseMove`'s clamp keeps `currentTime` out
        // of every occupied window on every move, so a mouse drag should
        // never actually reach this `true` arm any more — this file's own
        // tests confirm it. Kept anyway as the same rule `nudgeTime` enforces
        // for its own, different entry point.
        const occupied = timeChanged && keyframes.some(kf =>
          Math.abs(kf.time - currentDrag.originalTime) >= KEYFRAME_TIME_EPSILON &&
          Math.abs(kf.time - currentDrag.currentTime) < KEYFRAME_TIME_EPSILON
        );

        // One gesture, one undo entry (ESCSUITE-163 / M1): the move commits
        // first — synchronously, no setTimeout — and the value write, when
        // there is one, joins the same entry via `gestureHistory`'s
        // `skipHistory`. An occupied drop (ESCSUITE-179) refuses before any
        // `commit` at all — the gesture still opens and closes, owing
        // nothing and writing nothing, move included — and a refused move (a
        // locked track) leaves `settledTime` at the keyframe's original
        // time either way, so a value-only write — if any — lands there
        // rather than on a time the drag never actually reached.
        let settledTime = currentDrag.originalTime;
        if (timeChanged || valueChanged) {
          gestureHistory.begin();

          if (occupied) {
            announce(occupiedTimeMessage(property, currentDrag.currentTime));
          } else {
            let moveLanded = true;
            if (timeChanged) {
              moveLanded = gestureHistory.commit((skipHistory) =>
                onKeyframeMoved(property, currentDrag.originalTime, currentDrag.currentTime, skipHistory)
              );
              if (moveLanded) settledTime = currentDrag.currentTime;
            }

            // A refused move leaves the value alone: committing it at the
            // keyframe's old time would write a second keyframe the drag never
            // intended, right where the move itself landed on being refused.
            if (valueChanged && moveLanded) {
              gestureHistory.commit((skipHistory) =>
                onKeyframeValueChanged(property, settledTime, currentDrag.currentValue, skipHistory)
              );
            }
          }

          gestureHistory.end();
        }

        // Both, and for the same reason: after a time change the keyframe lives
        // at settledTime, so an activeTime left on the original would resolve to
        // "no active option" and send the next arrow key back to the first.
        setActiveTime(settledTime);
        setSelectedKeyframeTime(settledTime);
      }
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState?.isDragging, graphDimensions, clipDuration, range, property, onKeyframeMoved, onKeyframeValueChanged, screenToSvgCoords, setActiveTime, gestureHistory, keyframes, announce]);

  // Click on graph background to deselect
  const handleGraphClick = useCallback(() => {
    setActiveTime(null);
    setSelectedKeyframeTime(null);
  }, [setActiveTime]);

  // Handle double-click on graph to add keyframe
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (locked) return;
    const coords = screenToSvgCoords(e);
    if (!coords) return;

    const { x, y } = coords;

    // Check if click is within the graph area
    if (x < GRAPH_PADDING.left || x > GRAPH_PADDING.left + graphDimensions.innerWidth) return;
    if (y < GRAPH_PADDING.top || y > GRAPH_PADDING.top + graphDimensions.innerHeight) return;

    const time = graphDimensions.xToTime(x);
    const value = graphDimensions.yToValue(y);

    onAddKeyframe(property, Math.max(0, Math.min(time, clipDuration)), Math.max(range.min, Math.min(value, range.max)));
  }, [locked, screenToSvgCoords, graphDimensions, clipDuration, range, property, onAddKeyframe]);

  // Playhead position
  const playheadX = playheadTime >= 0 && playheadTime <= clipDuration
    ? graphDimensions.timeToX(playheadTime)
    : null;

  return (
    <div className={styles.graphWrap}>
      <svg
        ref={svgRef}
        className={styles.graph}
        viewBox={`0 0 ${graphDimensions.width} ${graphDimensions.height}`}
        preserveAspectRatio="xMidYMid meet"
        tabIndex={0}
        role="listbox"
        aria-orientation="horizontal"
        aria-label={`Keyframes for ${PROPERTY_LABELS[property]}`}
        aria-activedescendant={activeId}
        onClick={handleGraphClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={onKeyDown}
      >
        {/* Grid lines */}
        <g className={styles.grid} aria-hidden="true">
          {gridLines.map((line, i) => (
            <g key={i}>
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                className={styles.gridLine}
              />
              {line.label && line.x1 === line.x2 && (
                // Time label (bottom)
                <text
                  x={line.x1}
                  y={graphDimensions.height - 8}
                  className={styles.label}
                  textAnchor="middle"
                >
                  {line.label}
                </text>
              )}
              {line.label && line.y1 === line.y2 && (
                // Value label (left)
                <text
                  x={GRAPH_PADDING.left - 8}
                  y={line.y1 + 4}
                  className={styles.label}
                  textAnchor="end"
                >
                  {line.label}
                </text>
              )}
            </g>
          ))}
        </g>

        {/* Value curve */}
        <path d={curvePath} className={styles.curve} aria-hidden="true" />

        {/* Playhead */}
        {playheadX !== null && (
          <line
            x1={playheadX}
            y1={GRAPH_PADDING.top}
            x2={playheadX}
            y2={GRAPH_PADDING.top + graphDimensions.innerHeight}
            className={styles.playhead}
            aria-hidden="true"
          />
        )}

        {/* Keyframe points */}
        {keyframes.map((kf, i) => {
          const isCustom = isCustomKeyframe(kf);
          const isDragging = dragState?.isDragging && Math.abs(dragState.originalTime - kf.time) < 0.001;
          const isSelected = selectedKeyframeTime !== null && Math.abs(selectedKeyframeTime - kf.time) < 0.001;
          const isActive = i === activeIndex;

          // Use drag state position if this keyframe is being dragged
          const displayTime = isDragging ? dragState.currentTime : kf.time;
          const displayValue = isDragging ? dragState.currentValue : kf.value;
          const cx = graphDimensions.timeToX(displayTime);
          const cy = graphDimensions.valueToY(displayValue);

          return (
            <circle
              key={`${kf.time}-${i}`}
              cx={cx}
              cy={cy}
              r={isDragging ? 8 : isSelected ? 7 : 6}
              className={`${styles.keyframePoint} ${isCustom ? styles.custom : styles.preset} ${isDragging ? styles.dragging : ''} ${isSelected ? styles.selected : ''} ${isActive ? styles.active : ''}`}
              id={keyframeOptionId(property, i)}
              role="option"
              aria-selected={isActive}
              aria-label={keyframeOptionLabel(formatValue(displayValue, property), displayTime, kf.easing, isCustom)}
              onMouseDown={(e) => handleKeyframeMouseDown(e, kf)}
              onClick={(e) => handleKeyframeClick(e, kf)}
              onContextMenu={(e) => handleKeyframeContextMenu(e, kf)}
            >
              <title>
                {formatValue(displayValue, property)} @ {displayTime.toFixed(2)}s
                {isCustom ? '\n(Drag to move, Right-click or Delete key to remove)' : '\n(Preset - cannot modify)'}
              </title>
            </circle>
          );
        })}

        {/* Help text */}
        <text
          x={graphDimensions.width / 2}
          y={graphDimensions.height - 2}
          className={styles.helpLabel}
          textAnchor="middle"
          aria-hidden="true"
        >
          Double-click to add • Drag to move • Arrow keys to navigate
        </text>
      </svg>

      {/* Always rendered, never conditional: a live region has to exist before
          its content changes for a screen reader to announce the change. */}
      <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {nudgeMessage}
      </span>

      {selectedKeyframe && onKeyframeEasingChanged && (
        <div className={styles.easingRow}>
          <span className={styles.easingLabel}>Easing</span>
          <select
            className={styles.easingSelect}
            aria-label="Keyframe easing"
            disabled={locked}
            value={selectedKeyframe.easing}
            onChange={(e) =>
              onKeyframeEasingChanged(property, selectedKeyframe.time, e.target.value as EasingType)
            }
          >
            {!EASING_TYPES.some(o => o.value === selectedKeyframe.easing) && (
              // A project loaded from a file or a host can carry an EasingType the menu
              // does not offer (the quad variants, which are exact aliases of ease-in /
              // ease-out / ease-in-out). Show it rather than render a blank select.
              <option value={selectedKeyframe.easing}>{selectedKeyframe.easing}</option>
            )}
            {EASING_TYPES.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
