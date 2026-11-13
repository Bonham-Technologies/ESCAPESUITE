import { Timeline } from '../components/Timeline/Timeline';
import type { TimeRange } from '../components/Timeline/timelineGeometry';
import { TranscribeControl } from '../components/Timeline/TranscribeControl';
import type { ShowNotification } from './useNotification';
import styles from '../App.module.css';

interface TimelinePaneProps {
  /** The pane's height in pixels, applied as an inline style. */
  height: number;
  /** The timeline's zoom factor, shown as a percentage. */
  zoom: number;
  /** Add a track to the timeline. */
  onAddTrack: () => void;
  /** Zoom the timeline in one step. */
  onZoomIn: () => void;
  /** Zoom the timeline out one step. */
  onZoomOut: () => void;
  /** Export just the selected range. */
  onExportSelection: (timeRange: TimeRange) => void;
  /** The editor's notice, for "Transcribe to captions"'s outcome (ESCSUITE-404). */
  showNotification: ShowNotification;
  /**
   * Told when "Transcribe to captions"'s "Replace or add" dialog opens or
   * closes (ESCSUITE-442), so `App` counts it in `modalOpen`. Required here,
   * as `MediaLibrarySidebar`'s is, so `App` cannot forget it.
   */
  onTranscribeDialogOpenChange: (open: boolean) => void;
}

/**
 * The bottom pane: the timeline's own controls (add track, zoom out, the zoom
 * readout, zoom in, and — only where the browser can recognise speech on this
 * device — "Transcribe to captions") above the timeline itself.
 *
 * Deliberately not memoised — `App.rerender.test.tsx` counts how often
 * `Timeline` renders, and a memo here would make that pass for the wrong
 * reason and hide a future `currentTime` subscription.
 */
export function TimelinePane({
  height,
  zoom,
  onAddTrack,
  onZoomIn,
  onZoomOut,
  onExportSelection,
  showNotification,
  onTranscribeDialogOpenChange,
}: TimelinePaneProps) {
  return (
    <footer className={styles.footer} style={{ height }}>
      <div className={styles.timelineControls}>
        {/* Wrapped on purpose: addTrack takes an optional argument, and the click event must not become it. */}
        {/* No aria-label (ESCSUITE-334): the name is the visible "Add Track", so a speech-input user can say what they see (WCAG 2.5.3). */}
        <button className={styles.addTrackButton} onClick={() => onAddTrack()} title="Add new track">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add Track</span>
        </button>
        <div className={styles.controlsDivider} aria-hidden="true" />
        <button className={styles.zoomButton} onClick={onZoomOut} title="Zoom out" aria-label="Zoom out timeline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <span className={styles.zoomLabel} aria-label={`Zoom level ${Math.round(zoom * 100)}%`}>{Math.round(zoom * 100)}%</span>
        <button className={styles.zoomButton} onClick={onZoomIn} title="Zoom in" aria-label="Zoom in timeline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <TranscribeControl showNotification={showNotification} onDialogOpenChange={onTranscribeDialogOpenChange} />
      </div>
      <Timeline onExportSelection={onExportSelection} />
    </footer>
  );
}
