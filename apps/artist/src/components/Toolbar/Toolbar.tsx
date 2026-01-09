import { useCallback } from 'react';
import { useEditorStore } from '../../store/projectStore';
import type { ToolType } from '../../store/types';
import styles from './Toolbar.module.css';

interface ToolbarProps {
  onShowShortcuts: () => void;
}

export function Toolbar({ onShowShortcuts }: ToolbarProps) {
  const activeTool = useEditorStore((state) => state.activeTool);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const setSnapEnabled = useEditorStore((state) => state.setSnapEnabled);
  const loopPlayback = useEditorStore((state) => state.loopPlayback);
  const setLoopPlayback = useEditorStore((state) => state.setLoopPlayback);
  const currentTime = useEditorStore((state) => state.currentTime);
  const addMarker = useEditorStore((state) => state.addMarker);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);

  const handleToolChange = useCallback((tool: ToolType) => {
    setActiveTool(tool);
  }, [setActiveTool]);

  const handleAddMarker = useCallback(() => {
    addMarker(currentTime);
  }, [addMarker, currentTime]);

  return (
    <div className={styles.toolbar}>
      {/* Tool selection group */}
      <div className={styles.toolGroup}>
        <span className={styles.groupLabel}>Tools</span>
        <div className={styles.buttonGroup}>
          <button
            className={`${styles.toolButton} ${activeTool === 'select' ? styles.active : ''}`}
            onClick={() => handleToolChange('select')}
            title="Selection Tool (V)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
              <path d="M13 13l6 6" />
            </svg>
          </button>
          <button
            className={`${styles.toolButton} ${activeTool === 'razor' ? styles.active : ''}`}
            onClick={() => handleToolChange('razor')}
            title="Razor Tool (C) - Click on clip to split"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18" />
              <path d="M8 7l4-4 4 4" />
              <path d="M8 17l4 4 4-4" />
            </svg>
          </button>
          <button
            className={`${styles.toolButton} ${activeTool === 'ripple' ? styles.active : ''}`}
            onClick={() => handleToolChange('ripple')}
            title="Ripple Edit (B) - Trim and shift subsequent clips"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="6" height="12" rx="1" />
              <rect x="10" y="6" width="6" height="12" rx="1" />
              <path d="M18 9l3 3-3 3" />
              <path d="M18 12h3" />
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.divider} />

      {/* Undo/Redo group */}
      <div className={styles.toolGroup}>
        <span className={styles.groupLabel}>History</span>
        <div className={styles.buttonGroup}>
          <button
            className={styles.toolButton}
            onClick={undo}
            disabled={!canUndo()}
            title="Undo (Ctrl+Z)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button
            className={styles.toolButton}
            onClick={redo}
            disabled={!canRedo()}
            title="Redo (Ctrl+Y)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.divider} />

      {/* Snapping toggle */}
      <div className={styles.toolGroup}>
        <span className={styles.groupLabel}>Snap</span>
        <button
          className={`${styles.toolButton} ${styles.toggleButton} ${snapEnabled ? styles.active : ''}`}
          onClick={() => setSnapEnabled(!snapEnabled)}
          title={`Snapping ${snapEnabled ? 'On' : 'Off'} (S)`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          {snapEnabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className={styles.divider} />

      {/* Loop toggle */}
      <div className={styles.toolGroup}>
        <span className={styles.groupLabel}>Loop</span>
        <button
          className={`${styles.toolButton} ${styles.toggleButton} ${loopPlayback ? styles.active : ''}`}
          onClick={() => setLoopPlayback(!loopPlayback)}
          title={`Loop Playback ${loopPlayback ? 'On' : 'Off'} (L)`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          {loopPlayback ? 'On' : 'Off'}
        </button>
      </div>

      <div className={styles.divider} />

      {/* Markers */}
      <div className={styles.toolGroup}>
        <span className={styles.groupLabel}>Markers</span>
        <button
          className={styles.toolButton}
          onClick={handleAddMarker}
          title="Add Marker at Playhead (M)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L12 22" />
            <path d="M5 5l7 4 7-4" />
          </svg>
        </button>
      </div>

      {/* Spacer */}
      <div className={styles.spacer} />

      {/* Keyboard shortcuts help */}
      <button
        className={styles.helpButton}
        onClick={onShowShortcuts}
        title="Keyboard Shortcuts (?)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M6 8h.01" />
          <path d="M10 8h.01" />
          <path d="M14 8h.01" />
          <path d="M18 8h.01" />
          <path d="M8 12h.01" />
          <path d="M12 12h.01" />
          <path d="M16 12h.01" />
          <path d="M7 16h10" />
        </svg>
        Shortcuts
      </button>
    </div>
  );
}
