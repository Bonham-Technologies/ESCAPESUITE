import React from 'react';
import { useEditorStore } from '../../store/projectStore';
import { formatTime } from '../../utils/timeUtils';

interface TimelineTimeReadoutProps {
  /** Timeline duration, in seconds. */
  duration: number;
}

/**
 * The `current / total` readout in the timeline's info bar.
 *
 * Subscribes to `currentTime` itself for the same reason as
 * {@link TimelinePlayhead}: a playback tick should repaint this span, not the
 * entire timeline.
 */
export const TimelineTimeReadout = React.memo(function TimelineTimeReadout({
  duration,
}: TimelineTimeReadoutProps) {
  const currentTime = useEditorStore((state) => state.currentTime);

  return <span>{formatTime(currentTime)} / {formatTime(duration)}</span>;
});
