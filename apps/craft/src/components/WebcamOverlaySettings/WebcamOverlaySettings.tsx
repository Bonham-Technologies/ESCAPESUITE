import type { RecordingConfig, WebcamPosition, WebcamShape } from '../../store/types';
import styles from '../../App.module.css';

/**
 * What the separate-tracks mode is for and what it costs, said before the
 * choice rather than after it.
 *
 * It splits the sound as well as the picture (slice 3): the camera, the
 * microphone and the system audio each become their own file, while the
 * screen recording keeps the mixed audio so a screen-only download still has
 * sound. One toggle for all of it, because the spec treats separate tracks as
 * one mode and the storage headroom gate prices one. The wording is pinned by
 * this component's test.
 */
export const SEPARATE_TRACKS_HELP =
  'Records the screen, the webcam and each audio source as separate files, so the webcam and the sound can be adjusted in the editor. Uses about twice the CPU and storage.';

/**
 * The id the toggle's `aria-describedby` points at — the one paragraph that
 * carries either the help text or the reason the toggle is disabled. One
 * paragraph rather than two, because they are never both true.
 */
export const SEPARATE_TRACKS_HELP_ID = 'separate-tracks-help';

interface WebcamOverlaySettingsProps {
  config: RecordingConfig;
  /** True while a take is in progress — the overlay is baked in by then. */
  disabled: boolean;
  /**
   * Why the webcam cannot be recorded as its own track, or null when it can.
   * Computed by `WebcamOverlaySettingsPanel` — a fact about the browser and the
   * storage rather than about this panel.
   */
  separateTracksReason: string | null;
  /** A partial config patch, exactly as the store's `setConfig` takes it. */
  onChange: (config: Partial<RecordingConfig>) => void;
}

/**
 * Where the webcam sits on top of the screen capture, how big it is, and
 * whether it is a circle or a rectangle.
 *
 * The caller decides whether this panel exists at all — it is only meaningful
 * when screen and webcam are both on — so this component draws unconditionally
 * and reports every change as a config patch.
 *
 * The position and shape buttons are mapped (they differ only by their value)
 * while the size slider is spelled out, because it is the one control with an
 * `id`: the `htmlFor`/`id` pair on `webcam-size-slider` is what makes the
 * "Size" label point at it, and `aria-label` is what names it for a screen
 * reader.
 */
export function WebcamOverlaySettings({
  config,
  disabled,
  separateTracksReason,
  onChange,
}: WebcamOverlaySettingsProps) {
  return (
    <section className={styles.sidebarSection}>
      <h2 className={styles.sidebarTitle}>Webcam Overlay</h2>
      <div className={styles.webcamControls}>
        <div className={styles.positionGrid}>
          {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as WebcamPosition[]).map(
            (pos) => (
              <button
                key={pos}
                className={`${styles.positionButton} ${
                  config.webcamPosition === pos ? styles.active : ''
                }`}
                onClick={() => onChange({ webcamPosition: pos })}
                disabled={disabled}
              >
                {pos.replace('-', ' ')}
              </button>
            )
          )}
        </div>

        <div className={styles.sizeSlider}>
          <label htmlFor="webcam-size-slider" className={styles.meterLabel}>Size</label>
          <input
            id="webcam-size-slider"
            type="range"
            className={styles.slider}
            min="0.1"
            max="0.4"
            step="0.05"
            value={config.webcamSize}
            onChange={(e) => onChange({ webcamSize: parseFloat(e.target.value) })}
            disabled={disabled}
            aria-label="Webcam overlay size"
          />
        </div>

        <div className={styles.shapeToggle}>
          {(['circle', 'rectangle'] as WebcamShape[]).map((shape) => (
            <button
              key={shape}
              className={`${styles.shapeButton} ${
                config.webcamShape === shape ? styles.active : ''
              }`}
              onClick={() => onChange({ webcamShape: shape })}
              disabled={disabled}
            >
              {shape}
            </button>
          ))}
        </div>

        <div
          className={styles.separateTracksToggle}
          title={separateTracksReason ?? SEPARATE_TRACKS_HELP}
        >
          <span className={styles.sourceLabel}>Record webcam as a separate track</span>
          <button
            className={`${styles.toggle} ${config.separateTracks ? styles.active : ''}`}
            onClick={() => onChange({ separateTracks: !config.separateTracks })}
            disabled={disabled || separateTracksReason !== null}
            aria-pressed={config.separateTracks}
            aria-label="Record webcam as a separate track"
            aria-describedby={SEPARATE_TRACKS_HELP_ID}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
        <p className={styles.mp4BlockedReason} id={SEPARATE_TRACKS_HELP_ID}>
          {separateTracksReason ?? SEPARATE_TRACKS_HELP}
        </p>
      </div>
    </section>
  );
}
