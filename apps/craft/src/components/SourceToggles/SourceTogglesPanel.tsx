import { useRecorderStore } from '../../store/recorderStore';
import { SourceToggles, type RecordingSource } from './SourceToggles';

interface SourceTogglesPanelProps {
  /** True for countdown, recording and paused — sources are frozen mid-take. */
  isRecordingActive: boolean;
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
 * and it keeps the panel's inputs in one place. `isRecordingActive` stays a
 * prop because `App` derives it from `state` for the transport bar as well.
 */
export function SourceTogglesPanel({ isRecordingActive, onToggleSource }: SourceTogglesPanelProps) {
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
      isRecordingActive={isRecordingActive}
      systemAudioShared={systemAudioShared}
      onToggleSource={onToggleSource}
    />
  );
}
