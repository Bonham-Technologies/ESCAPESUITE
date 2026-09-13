import type { RecordingConfig, WebcamPosition, WebcamShape } from '../../store/types';
import styles from '../../App.module.css';

interface WebcamOverlaySettingsProps {
  config: RecordingConfig;
  /** True while a take is in progress — the overlay is baked in by then. */
  disabled: boolean;
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
export function WebcamOverlaySettings({ config, disabled, onChange }: WebcamOverlaySettingsProps) {
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
      </div>
    </section>
  );
}
