import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { getAllKeyframesForProperty, interpolateKeyframes } from '../../utils/animation';
import type { AnimatableProperty, Keyframe, ClipAnimation, ClipTransform, ClipEffects, EasingType } from '../../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import { EASING_TYPES } from '../../utils/easingOptions';
import styles from './KeyframeGraph.module.css';

interface KeyframeGraphProps {
  property: AnimatableProperty;
  clipDuration: number;
  animation: ClipAnimation | undefined;
  transform: ClipTransform;
  effects: ClipEffects;
  playheadTime: number;
  onKeyframeMoved: (property: AnimatableProperty, originalTime: number, newTime: number) => void;
  onKeyframeValueChanged: (property: AnimatableProperty, time: number, newValue: number) => void;
  onAddKeyframe: (property: AnimatableProperty, time: number, value: number) => void;
  onDeleteKeyframe?: (property: AnimatableProperty, time: number) => void;
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

// The name each property is announced by. Deliberately a copy of the labels
// KeyframePanel lists its property tracks with rather than an import of them:
// the panel owns the graph, so importing from it would invert the dependency.
// Not exported — react-refresh/only-export-components rejects a non-literal
// export from a component module, and nothing outside this file needs it.
const PROPERTY_LABELS: Record<AnimatableProperty, string> = {
  x: 'Position X',
  y: 'Position Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  rotation: 'Rotation',
  opacity: 'Opacity',
  blur: 'Blur',
  volume: 'Volume',
};

/**
 * What a screen reader reads for one keyframe handle. It overrides the <title>
 * child, which stays as the pointer tooltip.
 */
function keyframeOptionLabel(
  value: string,
  time: number,
  easing: EasingType,
  isCustom: boolean
): string {
  const easingLabel = EASING_TYPES.find(o => o.value === easing)?.label ?? easing;
  return `${value} at ${time.toFixed(2)} s, ${easingLabel}${isCustom ? '' : ', preset, not editable'}`;
}

/** The DOM id of a keyframe option — what aria-activedescendant points at. */
function keyframeOptionId(property: AnimatableProperty, index: number): string {
  return `kf-${property}-${index}`;
}

const GRAPH_PADDING = { top: 20, right: 20, bottom: 30, left: 50 };
const SAMPLE_INTERVAL = 4; // pixels between curve samples

export function KeyframeGraph({
  property,
  clipDuration,
  animation,
  transform,
  effects,
  playheadTime,
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

  // The listbox's active descendant, tracked by time rather than by index
  // because the keyframe array is sorted by time — a future time nudge re-sorts
  // it and an index would then address a different keyframe. Unlike
  // selectedKeyframeTime this may address a *preset* keyframe, so a keyboard or
  // screen-reader user can walk the whole curve; selection still follows it only
  // for the custom ones.
  const [activeTime, setActiveTime] = useState<number | null>(null);

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

  // Format value for display
  function formatValue(value: number, prop: AnimatableProperty): string {
    if (prop === 'rotation') return `${value.toFixed(0)}°`;
    if (prop === 'blur') return `${value.toFixed(0)}px`;
    if (prop === 'opacity' || prop === 'volume') return `${(value * 100).toFixed(0)}%`;
    if (prop === 'x' || prop === 'y') return `${(value * 100).toFixed(0)}%`;
    return value.toFixed(2);
  }

  // Handle mouse down on keyframe point
  const handleKeyframeMouseDown = useCallback((e: React.MouseEvent, kf: Keyframe) => {
    if (!isCustomKeyframe(kf)) return; // Can't drag preset keyframes

    e.preventDefault();
    e.stopPropagation();

    focusGraph();
    setActiveTime(kf.time);
    setSelectedKeyframeTime(kf.time);
    setDragState({
      isDragging: true,
      originalTime: kf.time,
      originalValue: kf.value,
      currentTime: kf.time,
      currentValue: kf.value,
      dragType: e.shiftKey ? 'value' : e.altKey ? 'time' : 'both',
    });
  }, [isCustomKeyframe, focusGraph]);

  // Handle click on keyframe to select it
  const handleKeyframeClick = useCallback((e: React.MouseEvent, kf: Keyframe) => {
    e.stopPropagation();
    focusGraph();
    setActiveTime(kf.time);
    if (isCustomKeyframe(kf)) {
      setSelectedKeyframeTime(kf.time);
    }
  }, [isCustomKeyframe, focusGraph]);

  // Handle right-click on keyframe to delete
  const handleKeyframeContextMenu = useCallback((e: React.MouseEvent, kf: Keyframe) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCustomKeyframe(kf) && onDeleteKeyframe) {
      onDeleteKeyframe(property, kf.time);
    }
  }, [isCustomKeyframe, onDeleteKeyframe, property]);

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

  // Global mouse move/up handlers for drag (using window events for reliable tracking)
  useEffect(() => {
    if (!dragState?.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const coords = screenToSvgCoords(e);
      if (!coords) return;

      const { x, y } = coords;

      const newTime = Math.max(0, Math.min(graphDimensions.xToTime(x), clipDuration));
      const newValue = Math.max(range.min, Math.min(graphDimensions.yToValue(y), range.max));

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
        // Commit the final position to the store
        const timeChanged = Math.abs(currentDrag.currentTime - currentDrag.originalTime) > 0.001;
        const valueChanged = Math.abs(currentDrag.currentValue - currentDrag.originalValue) > 0.001;

        if (timeChanged && valueChanged) {
          // When both change, move time first, then update value at NEW time
          onKeyframeMoved(property, currentDrag.originalTime, currentDrag.currentTime);
          // Use setTimeout to ensure store has updated before setting value
          setTimeout(() => {
            onKeyframeValueChanged(property, currentDrag.currentTime, currentDrag.currentValue);
          }, 0);
        } else if (timeChanged) {
          onKeyframeMoved(property, currentDrag.originalTime, currentDrag.currentTime);
        } else if (valueChanged) {
          // Value only - update at original time
          onKeyframeValueChanged(property, currentDrag.originalTime, currentDrag.currentValue);
        }

        // Both, and for the same reason: after a time change the keyframe lives
        // at currentTime, so an activeTime left on the original would resolve to
        // "no active option" and send the next arrow key back to the first.
        setActiveTime(currentDrag.currentTime);
        setSelectedKeyframeTime(currentDrag.currentTime);
      }
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState?.isDragging, graphDimensions, clipDuration, range, property, onKeyframeMoved, onKeyframeValueChanged, screenToSvgCoords]);

  // Click on graph background to deselect
  const handleGraphClick = useCallback(() => {
    setActiveTime(null);
    setSelectedKeyframeTime(null);
  }, []);

  // Handle double-click on graph to add keyframe
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const coords = screenToSvgCoords(e);
    if (!coords) return;

    const { x, y } = coords;

    // Check if click is within the graph area
    if (x < GRAPH_PADDING.left || x > GRAPH_PADDING.left + graphDimensions.innerWidth) return;
    if (y < GRAPH_PADDING.top || y > GRAPH_PADDING.top + graphDimensions.innerHeight) return;

    const time = graphDimensions.xToTime(x);
    const value = graphDimensions.yToValue(y);

    onAddKeyframe(property, Math.max(0, Math.min(time, clipDuration)), Math.max(range.min, Math.min(value, range.max)));
  }, [screenToSvgCoords, graphDimensions, clipDuration, range, property, onAddKeyframe]);

  // Playhead position
  const playheadX = playheadTime >= 0 && playheadTime <= clipDuration
    ? graphDimensions.timeToX(playheadTime)
    : null;

  // The selected keyframe, when it is one the user can edit. Preset keyframes
  // are never selectable (see the isCustomKeyframe guards above), so this is
  // undefined for them and the easing control simply does not render.
  const selectedKeyframe = selectedKeyframeTime === null
    ? undefined
    : keyframes.find(kf => Math.abs(kf.time - selectedKeyframeTime) < 0.001 && isCustomKeyframe(kf));

  // The active descendant, resolved back to a position in the sorted array.
  // -1 means "no active option", which is also what the arrow keys step from.
  const activeIndex = activeTime === null
    ? -1
    : keyframes.findIndex(kf => Math.abs(kf.time - activeTime) < 0.001);
  const activeId = activeIndex === -1 ? undefined : keyframeOptionId(property, activeIndex);

  // Move the active option, and take the selection with it when the keyframe is
  // one the user can edit — single-select follow-focus, the APG listbox default
  // and the model the easing control below already assumes. Landing on a preset
  // clears the selection instead, because a preset is never editable.
  const activateIndex = useCallback((index: number) => {
    const kf = keyframes[index];
    if (!kf) return;
    setActiveTime(kf.time);
    setSelectedKeyframeTime(isCustomKeyframe(kf) ? kf.time : null);
  }, [keyframes, isCustomKeyframe]);

  // The propagation contract, in one place.
  //
  // While the graph has focus it owns its own keys. React attaches its listener
  // at the root container, which sits *below* `window`, so stopPropagation() on
  // the synthetic event stops the native one before either of the editor's
  // window-level cascades (app/useAppKeyboardShortcuts.ts and
  // Preview/PlaybackControls.tsx) can see it.
  //
  //   * ArrowLeft/Right/Up/Down, Home, End and Enter are claimed
  //     unconditionally — a focused listbox owning its arrows is what a user
  //     expects, and an unconditional claim is one fewer branch to get wrong.
  //   * Delete/Backspace and Escape are claimed whenever an option is active —
  //     including a preset, which is announced as the selected option and would
  //     otherwise let the editor delete the whole clip two keystrokes into the
  //     graph. They only *act* on a custom keyframe. With nothing active they
  //     are not claimed at all, so Delete still reaches the editor's "delete the
  //     selected clip" shortcut: the bug (ESCSUITE-49) was that both fired at
  //     once, not that the editor's one fires at all.
  //   * Everything else — Tab, Space, '?', letters — falls through untouched, so
  //     the shortcut sheet, play/pause and tool switching still work from here.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<SVGSVGElement>) => {
    const key = e.key;

    if (
      key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' ||
      key === 'ArrowDown' || key === 'Home' || key === 'End' || key === 'Enter'
    ) {
      e.preventDefault();
      e.stopPropagation();
      const last = keyframes.length - 1;
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        // Neither arrow wraps; from -1 ("nothing active") either lands on the
        // first keyframe.
        const next = activeIndex + (key === 'ArrowRight' ? 1 : -1);
        activateIndex(Math.max(0, Math.min(next, last)));
      } else if (key === 'Home') {
        activateIndex(0);
      } else if (key === 'End') {
        activateIndex(last);
      }
      return;
    }

    if ((key === 'Delete' || key === 'Backspace') && activeTime !== null) {
      e.preventDefault();
      e.stopPropagation();
      // Only a custom keyframe can be deleted; on a preset the key is swallowed
      // and nothing happens.
      if (selectedKeyframe && onDeleteKeyframe) {
        onDeleteKeyframe(property, selectedKeyframe.time);
        setActiveTime(null);
        setSelectedKeyframeTime(null);
      }
      return;
    }

    if (key === 'Escape' && activeTime !== null) {
      e.preventDefault();
      e.stopPropagation();
      setActiveTime(null);
      setSelectedKeyframeTime(null);
    }
  }, [keyframes.length, activeIndex, activateIndex, activeTime, selectedKeyframe, onDeleteKeyframe, property]);

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
        onKeyDown={handleKeyDown}
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
          Double-click to add • Right-click to delete • Drag to move
        </text>
      </svg>

      {selectedKeyframe && onKeyframeEasingChanged && (
        <div className={styles.easingRow}>
          <span className={styles.easingLabel}>Easing</span>
          <select
            className={styles.easingSelect}
            aria-label="Keyframe easing"
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
