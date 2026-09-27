import { useRecorderStore } from '../../store/recorderStore';
import { SourceToggles, type RecordingSource } from './SourceToggles';

interface SourceTogglesPanelProps {
  /**
   * True while a take is live and while it is being saved — sources are
   * frozen from the moment a take starts preparing until the write to
   * storage is done, not just while it is actively recording (ESCSUITE-104):
   * `App` derives it as `sidebarLocked`, wider than the transport bar's own
   * `isRecordingActive`.
   */
  disabled: boolean;
  /**
   * True only while a take is actively live (countdown, recording, paused) —
   * `App`'s own `isRecordingActive`, handed down separately from `disabled`
   * so the audio meters vanish the moment recording stops rather than sitting
   * on screen, frozen at their last level, for the whole time the take is
   * being saved (ESCSUITE-104 review).
   */
  showMeters: boolean;
  onToggleSource: (source: RecordingSource) => void;
}

/**
 * The Sources panel's subscription to the store.
 *
 * `SourceToggles` itself is driven by props only, and this is the one component
 * that reads `audioLevels`. That matters because of how often it changes: both
 * recorders push an `AudioLevels` into the store ~12 times a second for the
 * whole length of a take (see "Audio level meters" in `apps/craft/CLAUDE.md`),
 * and the only pixels it moves are the two meter bars. Subscribing *here*
 * rather than in `App` is what keeps a level push from re-rendering the header,
 * the library, the preview stage and the transport bar as well —
 * `App.rerender.test.tsx` is the net under that.
 *
 * Every field the panel draws is selected here, so the panel is the whole
 * subscription: `detailedCapabilities`, `audioLevels` and `systemAudioShared`
 * reach nothing else in the tree, and `config` and `capabilities` are read by
 * `App` too — selecting them twice costs a subscription and no extra render,
 * and it keeps the panel's inputs in one place. `disabled` and `showMeters`
 * both stay props because `App` derives them from `state`, alongside the
 * transport bar's own (narrower still) reading of it.
 */
export function SourceTogglesPanel({ disabled, showMeters, onToggleSource }: SourceTogglesPanelProps) {
  const config = useRecorderStore((s) => s.config);
  const capabilities = useRecorderStore((s) => s.capabilities);
  const detailedCapabilities = useRecorderStore((s) => s.detailedCapabilities);
  const audioLevels = useRecorderStore((s) => s.audioLevels);
  const systemAudioShared = useRecorderStore((s) => s.systemAudioShared);

  return (
    <SourceToggles
      config={config}
      capabilities={capabilities}
      detailedCapabilities={detailedCapabilities}
      audioLevels={audioLevels}
      disabled={disabled}
      showMeters={showMeters}
      systemAudioShared={systemAudioShared}
      onToggleSource={onToggleSource}
    />
  );
}
