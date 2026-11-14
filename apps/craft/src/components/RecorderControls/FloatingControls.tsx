import { useId } from 'react';
import { useRecorderStore } from '../../store/recorderStore';
import { AudioLevelMeters } from '../SourceToggles/AudioLevelMeters';
import { TransportBar, type TransportBarProps } from './TransportBar';
import styles from '../../App.module.css';

type FloatingControlsProps = Omit<TransportBarProps, 'blockedReasonId'>;

/**
 * What the "Float controls" window shows (ESCSUITE-400): the page's own
 * transport bar — timer, pause/resume, record/stop, cancel, wired to the same
 * handlers — and the Mic / System meters under it while a take is live. App
 * portals it into the Picture-in-Picture window's document, so it is still
 * part of App's React tree and reads the same store.
 *
 * Like `SourceTogglesPanel`, it subscribes to the meter fields itself, so a
 * level push redraws this and the sidebar meters, never App. The meter rule is
 * the Sources panel's: Mic when the microphone is on and capturable, System
 * when it was asked for (greyed if it never arrived).
 *
 * The window is a document of its own, so it carries its own landmark and a
 * visually hidden level-one heading naming it.
 */
export function FloatingControls(transport: FloatingControlsProps) {
  const config = useRecorderStore((s) => s.config);
  const capabilities = useRecorderStore((s) => s.capabilities);
  const capabilitiesReady = useRecorderStore((s) => s.capabilitiesReady);
  const headingId = useId();
  const audioLevels = useRecorderStore((s) => s.audioLevels);
  const systemAudioShared = useRecorderStore((s) => s.systemAudioShared);

  const microphoneOn = config.microphoneEnabled && (capabilities.microphone || !capabilitiesReady);
  const showMeters = transport.isRecordingActive && (microphoneOn || config.systemAudioEnabled);

  return (
    <main className={styles.floatingControls} aria-labelledby={headingId}>
      <h1 id={headingId} className={styles.srOnly}>
        Recorder controls
      </h1>
      <TransportBar {...transport} />
      {showMeters && (
        <AudioLevelMeters
          audioLevels={audioLevels}
          showMicrophone={microphoneOn}
          showSystem={config.systemAudioEnabled}
          systemAudioShared={systemAudioShared}
        />
      )}
    </main>
  );
}
