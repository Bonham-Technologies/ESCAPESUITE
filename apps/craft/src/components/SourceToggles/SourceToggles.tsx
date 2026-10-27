import { useId } from 'react';
import type {
  AudioLevels,
  CapabilityInfo,
  DetailedCapabilities,
  EnvironmentCapabilities,
  RecordingConfig,
} from '../../store/types';
import { MicIcon, ScreenIcon, SpeakerIcon, UnavailableIcon, WebcamIcon } from '../icons';
import styles from '../../App.module.css';

/**
 * Why the System meter is greyed.
 *
 * Deliberately *not* the `NO_SYSTEM_AUDIO` notice: that one tells the user to
 * tick a box in the share dialog, and the meter also greys for a take that
 * never opened one (system audio on, screen off). This says only what is true
 * in both cases; the actionable version reaches the header when it applies.
 */
const NO_SYSTEM_AUDIO_HINT = 'No system audio arrived for this take.';

/** The four capture sources the sidebar can switch on and off. */
export type RecordingSource = 'screen' | 'webcam' | 'microphone' | 'systemAudio';

interface SourceTogglesProps {
  config: RecordingConfig;
  /** Whether each source can be captured at all — drives the disabled state. */
  capabilities: EnvironmentCapabilities;
  /** The same answer with a reason, shown as the row's `title` tooltip. */
  detailedCapabilities: DetailedCapabilities;
  /** Live mic / system levels, 0–1; only drawn during a take. */
  audioLevels: AudioLevels;
  /**
   * True for preparing, countdown, recording and paused, and while the take that just
   * finished is still being saved — sources are frozen for as long as the
   * take is live, not just while it is actively recording (ESCSUITE-104).
   */
  disabled: boolean;
  /**
   * True only for countdown, recording and paused — `App`'s own
   * `isRecordingActive`, not the wider `disabled` above. Kept apart from
   * `disabled` on purpose (ESCSUITE-104 review): the meters draw *live*
   * levels, and the store never resets them between takes, so gating the
   * meter block on `disabled` would leave it on screen — frozen at the last
   * level pushed — for the whole time a just-finished take is saving, when
   * there is no take left to meter.
   */
  showMeters: boolean;
  /**
   * Whether the running take actually got a system-audio track. False greys
   * the System meter: the toggle asked for the audio, the share dialog did not
   * hand it over, and a live-looking meter stuck at 0 is a lie.
   */
  systemAudioShared: boolean;
  /**
   * Whether capability detection has finished. Until it has, every capability
   * reads false ("Checking..."), which means "not known yet", not
   * "unavailable": the toggles keep showing the stored preference.
   */
  capabilitiesReady: boolean;
  onToggleSource: (source: RecordingSource) => void;
}

/**
 * The Sources panel: one row per capture source, plus the audio meters that
 * appear underneath while an audio source is recording.
 *
 * The four rows are written out literally rather than mapped over a list. They
 * differ in more than a label — each has its own icon, its own capability
 * slice and its own config flag — and keeping them side by side is what makes
 * a change to one of them readable in a diff.
 *
 * A row greys out (`sourceUnavailable`) from `detailedCapabilities`, which
 * carries the reason, while the toggle button disables from `capabilities`
 * plus whether a take is in progress. The two are separate on purpose: the
 * tooltip explains a permanent limitation, the disabled state also covers the
 * temporary one.
 *
 * A toggle whose source cannot be captured is drawn and announced as off
 * whatever its stored flag says (ESCSUITE-343): the take records nothing from
 * it (`useMediaStreams` skips it), so a greyed-but-ON switch was a lie. The
 * stored preference itself is left alone, so the toggle comes back on when
 * the device appears. The row's reason is also tied to the button with
 * `aria-describedby`, since a `title` tooltip is not reliably announced.
 * Neither applies before detection has finished (`capabilitiesReady`), when
 * every source reads unavailable only because it has not been checked yet.
 */
export function SourceToggles({
  config,
  capabilities,
  detailedCapabilities,
  audioLevels,
  disabled,
  showMeters,
  systemAudioShared,
  capabilitiesReady,
  onToggleSource,
}: SourceTogglesProps) {
  const reasonId = useId();
  const screenOn = config.screenEnabled && (capabilities.screenCapture || !capabilitiesReady);
  const webcamOn = config.webcamEnabled && (capabilities.webcam || !capabilitiesReady);
  const microphoneOn = config.microphoneEnabled && (capabilities.microphone || !capabilitiesReady);
  const systemAudioOn =
    config.systemAudioEnabled && (capabilities.systemAudio || !capabilitiesReady);
  const unavailableReason = (c: CapabilityInfo) =>
    c.available || !capabilitiesReady ? undefined : c.message;
  const screenReason = unavailableReason(detailedCapabilities.screenCapture);
  const webcamReason = unavailableReason(detailedCapabilities.webcam);
  const microphoneReason = unavailableReason(detailedCapabilities.microphone);
  const systemAudioReason = unavailableReason(detailedCapabilities.systemAudio);

  return (
    <section className={styles.sidebarSection}>
      <h2 className={styles.sidebarTitle}>Sources</h2>
      <div className={styles.sourceToggles}>
        <div
          className={`${styles.sourceToggle} ${!detailedCapabilities.screenCapture.available ? styles.sourceUnavailable : ''}`}
          title={detailedCapabilities.screenCapture.message}
        >
          <span className={styles.sourceLabel}>
            <ScreenIcon className={styles.sourceIcon} />
            Screen
            {!detailedCapabilities.screenCapture.available && (
              <UnavailableIcon className={styles.unavailableIcon} />
            )}
          </span>
          {screenReason && (
            <span id={`${reasonId}-screen`} className={styles.srOnly}>
              {screenReason}
            </span>
          )}
          <button
            className={`${styles.toggle} ${screenOn ? styles.active : ''}`}
            onClick={() => onToggleSource('screen')}
            disabled={!capabilities.screenCapture || disabled}
            aria-pressed={screenOn}
            aria-describedby={screenReason ? `${reasonId}-screen` : undefined}
            aria-label="Screen"
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        <div
          className={`${styles.sourceToggle} ${!detailedCapabilities.webcam.available ? styles.sourceUnavailable : ''}`}
          title={detailedCapabilities.webcam.message}
        >
          <span className={styles.sourceLabel}>
            <WebcamIcon className={styles.sourceIcon} />
            Webcam
            {!detailedCapabilities.webcam.available && (
              <UnavailableIcon className={styles.unavailableIcon} />
            )}
          </span>
          {webcamReason && (
            <span id={`${reasonId}-webcam`} className={styles.srOnly}>
              {webcamReason}
            </span>
          )}
          <button
            className={`${styles.toggle} ${webcamOn ? styles.active : ''}`}
            onClick={() => onToggleSource('webcam')}
            disabled={!capabilities.webcam || disabled}
            aria-pressed={webcamOn}
            aria-describedby={webcamReason ? `${reasonId}-webcam` : undefined}
            aria-label="Webcam"
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        <div
          className={`${styles.sourceToggle} ${!detailedCapabilities.microphone.available ? styles.sourceUnavailable : ''}`}
          title={detailedCapabilities.microphone.message}
        >
          <span className={styles.sourceLabel}>
            <MicIcon className={styles.sourceIcon} />
            Microphone
            {!detailedCapabilities.microphone.available && (
              <UnavailableIcon className={styles.unavailableIcon} />
            )}
          </span>
          {microphoneReason && (
            <span id={`${reasonId}-microphone`} className={styles.srOnly}>
              {microphoneReason}
            </span>
          )}
          <button
            className={`${styles.toggle} ${microphoneOn ? styles.active : ''}`}
            onClick={() => onToggleSource('microphone')}
            disabled={!capabilities.microphone || disabled}
            aria-pressed={microphoneOn}
            aria-describedby={microphoneReason ? `${reasonId}-microphone` : undefined}
            aria-label="Microphone"
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        <div
          className={`${styles.sourceToggle} ${!detailedCapabilities.systemAudio.available ? styles.sourceUnavailable : ''}`}
          title={detailedCapabilities.systemAudio.message}
        >
          <span className={styles.sourceLabel}>
            <SpeakerIcon className={styles.sourceIcon} />
            System Audio
            {!detailedCapabilities.systemAudio.available && (
              <UnavailableIcon className={styles.unavailableIcon} />
            )}
          </span>
          {systemAudioReason && (
            <span id={`${reasonId}-systemAudio`} className={styles.srOnly}>
              {systemAudioReason}
            </span>
          )}
          <button
            className={`${styles.toggle} ${systemAudioOn ? styles.active : ''}`}
            onClick={() => onToggleSource('systemAudio')}
            disabled={!capabilities.systemAudio || disabled}
            aria-pressed={systemAudioOn}
            aria-describedby={systemAudioReason ? `${reasonId}-systemAudio` : undefined}
            aria-label="System Audio"
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      {/* Audio meters */}
      {(microphoneOn || config.systemAudioEnabled) && showMeters && (
        <div className={styles.audioMeters}>
          {microphoneOn && (
            <div className={styles.audioMeter}>
              <span className={styles.meterLabel}>Mic</span>
              <div className={styles.meterBar}>
                <div
                  className={styles.meterFill}
                  style={{ width: `${audioLevels.microphone * 100}%` }}
                />
              </div>
            </div>
          )}
          {config.systemAudioEnabled && (
            <div
              className={`${styles.audioMeter} ${!systemAudioShared ? styles.meterUnavailable : ''}`}
              title={systemAudioShared ? undefined : NO_SYSTEM_AUDIO_HINT}
            >
              <span className={styles.meterLabel}>System</span>
              <div className={styles.meterBar}>
                <div
                  className={styles.meterFill}
                  style={{ width: `${audioLevels.system * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
