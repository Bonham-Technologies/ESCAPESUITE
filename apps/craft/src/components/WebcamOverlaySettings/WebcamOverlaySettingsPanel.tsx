import { useRecorderStore } from '../../store/recorderStore';
import { canRecordSeparateTracks } from '../../core/webcodecsSupport';
import { separateTracksBlockedReason } from '../../utils/separateTracksReadiness';
import { WebcamOverlaySettings } from './WebcamOverlaySettings';
import type { RecordingConfig } from '../../store/types';

interface WebcamOverlaySettingsPanelProps {
  config: RecordingConfig;
  /** True while a take is in progress — the overlay is baked in by then. */
  disabled: boolean;
  /** A partial config patch, exactly as the store's `setConfig` takes it. */
  onChange: (config: Partial<RecordingConfig>) => void;
}

/**
 * The overlay panel's one subscription: whether there is storage headroom for a
 * take at roughly double the bitrate.
 *
 * It is selected here rather than in `App` for the same reason
 * `SourceTogglesPanel` owns `audioLevels` and `RecordingsListPanel` owns
 * `mp4Support`: a field `App` merely passes through still re-renders `App` and
 * every hook it calls. `App.rerender.test.tsx` is the net.
 *
 * `canRecordSeparateTracks()` is asked on every render instead of remembered,
 * exactly as `RecordingsListPanel` asks `isEmbedded()`: it is two `typeof`
 * checks and an `in`, which is cheaper than a store field to keep in step. It
 * comes from `core/webcodecsSupport.ts` rather than from the recorder, so
 * asking it does not pull the muxer into this component's module graph.
 */
export function WebcamOverlaySettingsPanel({
  config,
  disabled,
  onChange,
}: WebcamOverlaySettingsPanelProps) {
  const hasSeparateTracksSpace = useRecorderStore((s) => s.hasSeparateTracksSpace);

  return (
    <WebcamOverlaySettings
      config={config}
      disabled={disabled}
      separateTracksReason={separateTracksBlockedReason(
        canRecordSeparateTracks(),
        hasSeparateTracksSpace
      )}
      onChange={onChange}
    />
  );
}
