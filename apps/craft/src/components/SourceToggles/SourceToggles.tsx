import type {
  AudioLevels,
  DetailedCapabilities,
  EnvironmentCapabilities,
  RecordingConfig,
} from '../../store/types';
import { MicIcon, ScreenIcon, SpeakerIcon, UnavailableIcon, WebcamIcon } from '../icons';
import { NO_SYSTEM_AUDIO } from '../../utils/notices';
import styles from '../../App.module.css';

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
  /** True for countdown, recording and paused — sources are frozen mid-take. */
  isRecordingActive: boolean;
  /**
   * Whether the running take actually got a system-audio track. False greys
   * the System meter: the toggle asked for the audio, the share dialog did not
   * hand it over, and a live-looking meter stuck at 0 is a lie.
   */
  systemAudioShared: boolean;
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
 */
export function SourceToggles({
  config,
  capabilities,
  detailedCapabilities,
  audioLevels,
  isRecordingActive,
  systemAudioShared,
  onToggleSource,
}: SourceTogglesProps) {
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
          <button
            className={`${styles.toggle} ${config.screenEnabled ? styles.active : ''}`}
            onClick={() => onToggleSource('screen')}
            disabled={!capabilities.screenCapture || isRecordingActive}
            aria-pressed={config.screenEnabled}
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
          <button
            className={`${styles.toggle} ${config.webcamEnabled ? styles.active : ''}`}
            onClick={() => onToggleSource('webcam')}
            disabled={!capabilities.webcam || isRecordingActive}
            aria-pressed={config.webcamEnabled}
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
          <button
            className={`${styles.toggle} ${config.microphoneEnabled ? styles.active : ''}`}
            onClick={() => onToggleSource('microphone')}
            disabled={!capabilities.microphone || isRecordingActive}
            aria-pressed={config.microphoneEnabled}
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
          <button
            className={`${styles.toggle} ${config.systemAudioEnabled ? styles.active : ''}`}
            onClick={() => onToggleSource('systemAudio')}
            disabled={!capabilities.systemAudio || isRecordingActive}
            aria-pressed={config.systemAudioEnabled}
            aria-label="System Audio"
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      {/* Audio meters */}
      {(config.microphoneEnabled || config.systemAudioEnabled) && isRecordingActive && (
        <div className={styles.audioMeters}>
          {config.microphoneEnabled && (
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
              title={systemAudioShared ? undefined : NO_SYSTEM_AUDIO}
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
