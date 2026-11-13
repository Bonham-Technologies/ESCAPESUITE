import { useId, useState } from 'react';
import { useRecorderStore } from '../../store/recorderStore';
import { AudioLevelMeters } from '../SourceToggles/AudioLevelMeters';
import { CountdownAnnouncement } from '../AppHeader/CountdownAnnouncement';
import { TransportBar, type TransportBarProps } from './TransportBar';
import styles from '../../App.module.css';

type FloatingControlsProps = Omit<TransportBarProps, 'blockedReasonId' | 'showCountdown'>;

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
 *
 * It is also what the user is looking at while the page sits behind the thing
 * being recorded, so it says for itself what the page says (ESCSUITE-440):
 * - the countdown digit in the timer's place (`showCountdown`), since the
 *   page's overlay is usually out of sight;
 * - its own polite, atomic live region, the header's phrases ("Recording
 *   starts in 3", "Recording", "Paused", "Saving...") plus "Saved" once a save
 *   puts a new take at the top of the library — a save that failed adds no
 *   take, and says nothing here;
 * - a blocked Record button's reason as visible text, wired to the button
 *   through `aria-describedby` exactly as the page's is.
 */
export function FloatingControls(transport: FloatingControlsProps) {
  const config = useRecorderStore((s) => s.config);
  const capabilities = useRecorderStore((s) => s.capabilities);
  const capabilitiesReady = useRecorderStore((s) => s.capabilitiesReady);
  const headingId = useId();
  const audioLevels = useRecorderStore((s) => s.audioLevels);
  const systemAudioShared = useRecorderStore((s) => s.systemAudioShared);
  const blockedReasonId = useId();
  const recordings = useRecorderStore((s) => s.recordings);

  // "Saved" is a transition, saving -> idle with a take on top that was not
  // in the library when the save began, so the last state seen and the ids
  // the library held then are kept here (updated during render, as React
  // recommends for state derived from a prop's previous value). Comparing
  // against every id, not only the newest one, keeps a take deleted from the
  // library during a failed save from reading as "Saved".
  const { state } = transport;
  const newestTakeId = recordings[0]?.id ?? null;
  const [seen, setSeen] = useState(() => ({
    state,
    idsBeforeSave: recordings.map((r) => r.id),
    saved: false,
  }));
  if (seen.state !== state) {
    setSeen({
      state,
      idsBeforeSave: state === 'saving' ? recordings.map((r) => r.id) : seen.idsBeforeSave,
      saved:
        seen.state === 'saving' &&
        state === 'idle' &&
        newestTakeId !== null &&
        !seen.idsBeforeSave.includes(newestTakeId),
    });
  }
  const phrase =
    state === 'recording'
      ? 'Recording'
      : state === 'paused'
      ? 'Paused'
      : state === 'saving'
      ? 'Saving...'
      : state === 'idle' && seen.saved
      ? 'Saved'
      : null;

  const microphoneOn = config.microphoneEnabled && (capabilities.microphone || !capabilitiesReady);
  const showMeters = transport.isRecordingActive && (microphoneOn || config.systemAudioEnabled);

  return (
    <main className={styles.floatingControls} aria-labelledby={headingId}>
      <h1 id={headingId} className={styles.srOnly}>
        Recorder controls
      </h1>
      <TransportBar {...transport} blockedReasonId={blockedReasonId} showCountdown />
      {transport.blockedReason && (
        <p className={styles.recordBlockedReason} id={blockedReasonId}>
          {transport.blockedReason}
        </p>
      )}
      {showMeters && (
        <AudioLevelMeters
          audioLevels={audioLevels}
          showMicrophone={microphoneOn}
          showSystem={config.systemAudioEnabled}
          systemAudioShared={systemAudioShared}
        />
      )}
      <div className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {state === 'countdown' && <CountdownAnnouncement />}
        {phrase && <span role="status">{phrase}</span>}
      </div>
    </main>
  );
}
