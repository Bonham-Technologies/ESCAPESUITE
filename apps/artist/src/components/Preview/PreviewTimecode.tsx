// The playhead readout under the preview canvas.
//
// It is its own component for one reason: during playback the playhead moves
// every animation frame, and if the preview read that position as React state
// the whole preview subtree — canvas element, overlays, clip info — would
// re-render (and lay out) fifty times a second to change three digits. So the
// render loop publishes the position to subscribers instead, and this span is
// the only thing subscribed. `useSyncExternalStore` re-renders just this
// component, and only when the loop actually publishes: at most ten times a
// second while playing, and immediately on a scrub or at a playback boundary.
import { useSyncExternalStore } from 'react';
import { formatTimecode } from '../../utils/timeUtils';

export interface PreviewTimecodeProps {
  /** Watch the published playhead position; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  /** Read the position as of the last publish. */
  getTime: () => number;
  className?: string;
}

export function PreviewTimecode({ subscribe, getTime, className }: PreviewTimecodeProps) {
  const time = useSyncExternalStore(subscribe, getTime, getTime);
  return <span className={className}>{formatTimecode(time)}</span>;
}
