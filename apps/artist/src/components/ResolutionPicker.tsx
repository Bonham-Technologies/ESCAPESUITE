import { useState, useCallback } from 'react';
import { useEditorStore } from '../store/projectStore';
import { RESOLUTION_PRESETS } from '../store/types';
import styles from './ResolutionPicker.module.css';

type PresetKey = keyof typeof RESOLUTION_PRESETS;

function getPresetLabel(key: PresetKey): string {
  const preset = RESOLUTION_PRESETS[key];
  return `${key} (${preset.width}x${preset.height})`;
}

function getCurrentPresetKey(width: number, height: number): PresetKey | 'custom' {
  for (const [key, value] of Object.entries(RESOLUTION_PRESETS)) {
    if (value.width === width && value.height === height) {
      return key as PresetKey;
    }
  }
  return 'custom';
}

export function ResolutionPicker() {
  const resolution = useEditorStore((state) => state.project.resolution);
  const setProjectResolution = useEditorStore((state) => state.setProjectResolution);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingResolution, setPendingResolution] = useState<{ width: number; height: number } | null>(null);

  const currentPreset = getCurrentPresetKey(resolution.width, resolution.height);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value as PresetKey | 'custom';
    if (key === 'custom') return;
    const preset = RESOLUTION_PRESETS[key];
    if (preset.width === resolution.width && preset.height === resolution.height) return;
    setPendingResolution({ width: preset.width, height: preset.height });
    setShowConfirm(true);
  }, [resolution]);

  const handleConfirm = useCallback(() => {
    if (pendingResolution) {
      setProjectResolution(pendingResolution.width, pendingResolution.height);
    }
    setShowConfirm(false);
    setPendingResolution(null);
  }, [pendingResolution, setProjectResolution]);

  const handleCancel = useCallback(() => {
    setShowConfirm(false);
    setPendingResolution(null);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="resolution-select">Resolution</label>
        <select
          id="resolution-select"
          className={styles.select}
          value={currentPreset}
          onChange={handleChange}
        >
          {currentPreset === 'custom' && (
            <option value="custom">
              Custom ({resolution.width}x{resolution.height})
            </option>
          )}
          {(Object.keys(RESOLUTION_PRESETS) as PresetKey[]).map((key) => (
            <option key={key} value={key}>
              {getPresetLabel(key)}
            </option>
          ))}
        </select>
      </div>

      {showConfirm && pendingResolution && (
        <div className={styles.confirmOverlay} data-testid="resolution-change-confirm">
          <div className={styles.confirmDialog}>
            <div className={styles.confirmHeader}>
              <h3 className={styles.confirmTitle}>Change Resolution</h3>
            </div>
            <div className={styles.confirmBody}>
              <p className={styles.confirmMessage}>
                Changing resolution may affect overlay positions and scaling. This cannot be undone automatically.
              </p>
              <div className={styles.confirmInfo}>
                {resolution.width}x{resolution.height} → {pendingResolution.width}x{pendingResolution.height}
              </div>
              <div className={styles.confirmActions}>
                <button className={styles.cancelButton} onClick={handleCancel}>
                  Cancel
                </button>
                <button className={styles.confirmButton} onClick={handleConfirm}>
                  Change Resolution
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
