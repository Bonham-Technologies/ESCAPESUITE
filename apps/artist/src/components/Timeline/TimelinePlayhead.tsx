import React from 'react';
import { useEditorStore } from '../../store/projectStore';
import { timeToPixels } from '../../utils/timeUtils';
import styles from './Timeline.module.css';

interface TimelinePlayheadProps {
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** Height of the track stack the playhead spans, in pixels. */
  height: number;
  onMouseDown: (e: React.MouseEvent) => void;
}

/**
 * The playhead line.
 *
 * Deliberately its own component: playback writes `currentTime` to the store
 * roughly every 200 ms, and subscribing here rather than in `Timeline` keeps
 * those writes from re-rendering the whole timeline (tracks, clips, waveforms)
 * on every tick. Only this element moves.
 */
export const TimelinePlayhead = React.memo(function TimelinePlayhead({
  pixelsPerSecond,
  height,
  onMouseDown,
}: TimelinePlayheadProps) {
  const currentTime = useEditorStore((state) => state.currentTime);

  return (
    <div
      data-playhead
      className={styles.playhead}
      style={{ left: timeToPixels(currentTime, pixelsPerSecond), height }}
      onMouseDown={onMouseDown}
    >
      <div className={styles.playheadHead} />
      <div className={styles.playheadLine} />
    </div>
  );
});
