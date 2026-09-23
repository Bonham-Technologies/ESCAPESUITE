import { useRecorderStore } from '../../store/recorderStore';
import { formatDuration } from '../../utils/recordingFormat';

/**
 * The elapsed-take readout's own subscription to the store.
 *
 * It renders nothing but the formatted number, inside the timer `<span>` that
 * `RecorderControls` still owns — the span's classes depend on
 * `isRecordingActive`, which is the bar's business, and the number is the only
 * thing that ticks. Subscribing *here* rather than in `App` is what keeps the
 * controller's once-a-second `setCurrentDuration` from re-rendering `App`, the
 * header, the sidebar, the preview stage and the transport bar for a value
 * that moves five characters — the same trade `SourceTogglesPanel` makes for
 * the ~12-a-second `audioLevels` push. `App.rerender.test.tsx` counts it.
 */
export function RecordingDurationReadout() {
  const currentDuration = useRecorderStore((s) => s.currentDuration);

  return <>{formatDuration(currentDuration)}</>;
}
