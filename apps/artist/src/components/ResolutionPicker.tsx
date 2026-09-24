import { useState, useCallback, useEffect, useRef } from 'react';
import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import { useEditorStore } from '../store/projectStore';
import { RESOLUTION_PRESETS } from '../store/types';
import styles from './ResolutionPicker.module.css';

interface ResolutionPickerProps {
  /**
   * Told whenever the change-resolution confirm opens or closes, so `App` can
   * count it in `modalOpen` — the flag that stops the editor behind a dialog
   * taking keys.
   *
   * Optional: the confirm is a complete dialog without it (the picker is
   * rendered bare in its own tests), and nothing about the dialog's behaviour
   * depends on anyone listening.
   */
  onConfirmOpenChange?: (open: boolean) => void;
}

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

export function ResolutionPicker({ onConfirmOpenChange }: ResolutionPickerProps) {
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

  // Escape cancels. Confirming is the only other answer and it rewrites the
  // project's resolution, which a dismissal key must never do; cancelling costs
  // nothing — the select is controlled by the store's resolution, so it snaps
  // back to the preset still in force. Trap, initial focus and focus restored
  // to the select all come from the hook, as they do for the other four modals.
  const dialogRef = useDialogBehaviour(handleCancel, showConfirm);

  // Read through a ref for the same reason the hook reads its `onClose` that
  // way: a caller passing a fresh arrow every render would otherwise re-run the
  // effect below, reporting a close and a re-open for a dialog that never moved.
  const onConfirmOpenChangeRef = useRef(onConfirmOpenChange);
  useEffect(() => {
    onConfirmOpenChangeRef.current = onConfirmOpenChange;
  }, [onConfirmOpenChange]);

  // Derived from `showConfirm` rather than announced by the three handlers, so
  // the report cannot drift from the state it describes — and so an unmount
  // while the confirm is up (collapsing the sidebar) still reports it gone,
  // instead of leaving `App`'s `modalOpen` stuck true and the editor deaf.
  useEffect(() => {
    if (!showConfirm) return;
    onConfirmOpenChangeRef.current?.(true);
    return () => onConfirmOpenChangeRef.current?.(false);
  }, [showConfirm]);

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
          <div
            ref={dialogRef}
            tabIndex={-1}
            className={styles.confirmDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolution-confirm-title"
          >
            <div className={styles.confirmHeader}>
              <h2 className={styles.confirmTitle} id="resolution-confirm-title">Change Resolution</h2>
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
