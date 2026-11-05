import type { AudioLevels } from '../../store/types';
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

interface AudioLevelMetersProps {
  /** Live mic / system levels, 0–1. */
  audioLevels: AudioLevels;
  /** Draw the Mic meter. */
  showMicrophone: boolean;
  /** Draw the System meter. */
  showSystem: boolean;
  /**
   * Whether the running take actually got a system-audio track. False greys
   * the System meter: the toggle asked for the audio, the share dialog did not
   * hand it over, and a live-looking meter stuck at 0 is a lie.
   */
  systemAudioShared: boolean;
}

/**
 * The Mic and System level bars, props only. Drawn under the Sources panel by
 * `SourceToggles` and in the "Float controls" window by `FloatingControls`
 * (ESCSUITE-400); each caller decides when the block is on screen at all.
 */
export function AudioLevelMeters({
  audioLevels,
  showMicrophone,
  showSystem,
  systemAudioShared,
}: AudioLevelMetersProps) {
  return (
    <div className={styles.audioMeters}>
      {showMicrophone && (
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
      {showSystem && (
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
  );
}
