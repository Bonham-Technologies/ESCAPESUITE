import React from 'react';
import type { Marker } from '../../store/types';
import { formatTime, timeToPixels } from '../../utils/timeUtils';
import { getRulerTicks } from './timelineGeometry';
import styles from './Timeline.module.css';

interface TimelineRulerProps {
  /** The ruler's scroll box. `Timeline` mirrors the track scroll onto it. */
  rulerRef: React.RefObject<HTMLDivElement | null>;
  /** How many seconds the ruler spans — the timeline's duration, or its floor. */
  duration: number;
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** Width of the ruler's content, in pixels. */
  width: number;
  markers: Marker[];
  inPoint: number | null;
  outPoint: number | null;
  onRulerClick: (e: React.MouseEvent) => void;
  onRemoveMarker: (markerId: string) => void;
  onInPointMouseDown: (e: React.MouseEvent) => void;
  onOutPointMouseDown: (e: React.MouseEvent) => void;
}

/**
 * The ruler above the tracks: its ticks and labels, the marker flags, and the
 * in/out point handles with the region they bracket.
 *
 * Where a tick goes is `timelineGeometry.getRulerTicks`, so the spacing is
 * testable without a render; this component is the DOM around those numbers.
 */
export function TimelineRuler({
  rulerRef,
  duration,
  pixelsPerSecond,
  width,
  markers,
  inPoint,
  outPoint,
  onRulerClick,
  onRemoveMarker,
  onInPointMouseDown,
  onOutPointMouseDown,
}: TimelineRulerProps) {
  return (
    <div className={styles.rulerRow}>
      <div className={styles.trackHeaderSpacer} />
      <div
        className={styles.ruler}
        ref={rulerRef}
        onClick={onRulerClick}
        tabIndex={0}
        role="group"
        aria-label="Timeline ruler"
      >
        <div className={styles.rulerContent} style={{ width }}>
          {getRulerTicks(duration, pixelsPerSecond).map(({ time, x, isMajor }) => (
            <div
              key={time}
              className={`${styles.tick} ${isMajor ? styles.tickMajor : styles.tickMinor}`}
              style={{ left: x }}
            >
              {isMajor && <span className={styles.tickLabel}>{formatTime(time)}</span>}
            </div>
          ))}
          {markers.map((marker) => (
            <div
              key={marker.id}
              className={styles.markerFlag}
              style={{ left: timeToPixels(marker.time, pixelsPerSecond), '--marker-color': marker.color } as React.CSSProperties}
              title={`${marker.label} (${formatTime(marker.time)}) - Double-click to remove`}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onRemoveMarker(marker.id);
              }}
            >
              <div className={styles.markerFlagHead} />
            </div>
          ))}

          {/* In/Out point markers in ruler */}
          {inPoint !== null && (
            <div
              className={styles.inOutMarker}
              style={{ left: timeToPixels(inPoint, pixelsPerSecond) }}
              onMouseDown={onInPointMouseDown}
              title={`In point: ${formatTime(inPoint)}`}
            >
              <div className={`${styles.inOutMarkerHead} ${styles.inMarkerHead}`}>I</div>
            </div>
          )}
          {outPoint !== null && (
            <div
              className={styles.inOutMarker}
              style={{ left: timeToPixels(outPoint, pixelsPerSecond) }}
              onMouseDown={onOutPointMouseDown}
              title={`Out point: ${formatTime(outPoint)}`}
            >
              <div className={`${styles.inOutMarkerHead} ${styles.outMarkerHead}`}>O</div>
            </div>
          )}

          {/* In/Out region highlight in ruler */}
          {inPoint !== null && outPoint !== null && (
            <div
              className={styles.inOutRulerRegion}
              style={{
                left: timeToPixels(inPoint, pixelsPerSecond),
                width: timeToPixels(outPoint - inPoint, pixelsPerSecond),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface TimelineMarkerLinesProps {
  markers: Marker[];
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
}

/**
 * The vertical line each marker drops through the track stack.
 *
 * Same markers as the flags above, drawn in the other half of the timeline —
 * hence a second component rather than more props on `TimelineRuler`: the two
 * sit in different parents, and the DOM is unchanged by keeping them apart.
 */
export function TimelineMarkerLines({ markers, pixelsPerSecond }: TimelineMarkerLinesProps) {
  return (
    <>
      {markers.map((marker) => (
        <div
          key={marker.id}
          className={styles.markerLine}
          style={{ left: timeToPixels(marker.time, pixelsPerSecond), '--marker-color': marker.color } as React.CSSProperties}
        />
      ))}
    </>
  );
}
