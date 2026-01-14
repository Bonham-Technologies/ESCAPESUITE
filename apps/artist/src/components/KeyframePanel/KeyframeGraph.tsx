import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { getAllKeyframesForProperty, interpolateKeyframes } from '../../utils/animation';
import type { AnimatableProperty, Keyframe, ClipAnimation, ClipTransform, ClipEffects } from '../../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
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
}: KeyframeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

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

  // Get all keyframes for this property
  const keyframes = useMemo(() => {
    return getAllKeyframesForProperty(
      property,
      clipDuration,
      animation,
      transform || DEFAULT_TRANSFORM,
      effects || DEFAULT_EFFECTS
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
    return transform?.[property as keyof ClipTransform] ?? 0;
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

    setSelectedKeyframeTime(kf.time);
    setDragState({
      isDragging: true,
      originalTime: kf.time,
      originalValue: kf.value,
      currentTime: kf.time,
      currentValue: kf.value,
      dragType: e.shiftKey ? 'value' : e.altKey ? 'time' : 'both',
    });
  }, [isCustomKeyframe]);

  // Handle click on keyframe to select it
  const handleKeyframeClick = useCallback((e: React.MouseEvent, kf: Keyframe) => {
    e.stopPropagation();
    if (isCustomKeyframe(kf)) {
      setSelectedKeyframeTime(kf.time);
    }
  }, [isCustomKeyframe]);

  // Handle right-click on keyframe to delete
  const handleKeyframeContextMenu = useCallback((e: React.MouseEvent, kf: Keyframe) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCustomKeyframe(kf) && onDeleteKeyframe) {
      onDeleteKeyframe(property, kf.time);
    }
  }, [isCustomKeyframe, onDeleteKeyframe, property]);

  // Handle keyboard events for deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKeyframeTime !== null && onDeleteKeyframe) {
        e.preventDefault();
        onDeleteKeyframe(property, selectedKeyframeTime);
        setSelectedKeyframeTime(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedKeyframeTime, onDeleteKeyframe, property]);

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

  return (
    <svg
      ref={svgRef}
      className={styles.graph}
      viewBox={`0 0 ${graphDimensions.width} ${graphDimensions.height}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={handleGraphClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Grid lines */}
      <g className={styles.grid}>
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
      <path d={curvePath} className={styles.curve} />

      {/* Playhead */}
      {playheadX !== null && (
        <line
          x1={playheadX}
          y1={GRAPH_PADDING.top}
          x2={playheadX}
          y2={GRAPH_PADDING.top + graphDimensions.innerHeight}
          className={styles.playhead}
        />
      )}

      {/* Keyframe points */}
      {keyframes.map((kf, i) => {
        const isCustom = isCustomKeyframe(kf);
        const isDragging = dragState?.isDragging && Math.abs(dragState.originalTime - kf.time) < 0.001;
        const isSelected = selectedKeyframeTime !== null && Math.abs(selectedKeyframeTime - kf.time) < 0.001;

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
            className={`${styles.keyframePoint} ${isCustom ? styles.custom : styles.preset} ${isDragging ? styles.dragging : ''} ${isSelected ? styles.selected : ''}`}
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
      >
        Double-click to add • Right-click to delete • Drag to move
      </text>
    </svg>
  );
}
