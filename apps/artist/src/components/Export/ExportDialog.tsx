import { useState, useCallback, useRef } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { exportToWebM, exportToMP4, isMP4ExportSupported, ExportAbortedError } from '../../core/exporter';
import { analytics } from '../../utils/analytics';
import { useAuth } from '../../auth';
import { defaultWatermarkConfig } from '../../utils/watermark';
import type { ExportOptions, ExportProgress } from '../../store/types';
import styles from './ExportDialog.module.css';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const projectName = useEditorStore((state) => state.project.name);
  const { isTrial } = useAuth();

  const [options, setOptions] = useState<ExportOptions>({
    format: 'webm',
    quality: 'high',
    resolution: 'original',
  });
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AbortController for cancelling exports
  const abortControllerRef = useRef<AbortController | null>(null);

  const mp4Supported = isMP4ExportSupported();

  const handleExport = useCallback(async () => {
    if (clips.length === 0) {
      setError('No clips to export');
      return;
    }

    setError(null);
    setProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

    // Create new AbortController for this export
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const format = options.format === 'mp4' && mp4Supported ? 'mp4' : 'webm';
    analytics.exportStarted(format);

    try {
      const onProgress = (p: ExportProgress) => setProgress(p);

      let blob: Blob;
      let extension: string;

      // Add watermark for trial users
      const watermark = isTrial ? defaultWatermarkConfig : null;

      if (options.format === 'mp4' && mp4Supported) {
        blob = await exportToMP4(clips, sourceVideos, options, onProgress, tracks, watermark, abortController.signal);
        extension = 'mp4';
      } else {
        blob = await exportToWebM(clips, sourceVideos, options, onProgress, tracks, watermark, abortController.signal);
        extension = 'webm';
      }

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName || 'export'}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Calculate total export duration from clips
      const totalDuration = clips.reduce((max, clip) => {
        const clipEnd = clip.timelinePosition + clip.duration;
        return Math.max(max, clipEnd);
      }, 0);

      analytics.exportCompleted(extension as 'webm' | 'mp4', totalDuration);
      setProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

      // Close dialog after a delay
      setTimeout(() => {
        onClose();
        setProgress(null);
      }, 2000);
    } catch (err) {
      // Don't show error for user-initiated cancellation
      if (err instanceof ExportAbortedError) {
        setProgress(null);
        return;
      }

      console.error('Export failed:', err);
      setError(err instanceof Error ? err.message : 'Export failed');
      setProgress(null);
    } finally {
      // Clear the abort controller reference
      abortControllerRef.current = null;
    }
  }, [clips, tracks, sourceVideos, options, projectName, mp4Supported, onClose, isTrial]);

  const handleCancel = useCallback(() => {
    // Abort any in-progress export
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setProgress(null);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Export Video</h2>
          <button className={styles.closeButton} onClick={handleCancel}>
            &times;
          </button>
        </div>

        <div className={styles.body}>
          {progress ? (
            <div className={styles.progressSection}>
              <div className={styles.progressInfo}>
                <span className={styles.progressPhase}>{progress.phase}</span>
                <span className={styles.progressMessage}>{progress.message}</span>
              </div>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <span className={styles.progressPercent}>{Math.round(progress.progress)}%</span>
            </div>
          ) : (
            <>
              <div className={styles.section}>
                <label className={styles.label}>Format</label>
                <div className={styles.radioGroup}>
                  <label className={styles.radio}>
                    <input
                      type="radio"
                      name="format"
                      value="webm"
                      checked={options.format === 'webm'}
                      onChange={() => setOptions({ ...options, format: 'webm' })}
                    />
                    <span>WebM (VP9 + Opus)</span>
                    <span className={styles.radioHint}>Smaller file size</span>
                  </label>
                  <label className={`${styles.radio} ${!mp4Supported ? styles.radioDisabled : ''}`}>
                    <input
                      type="radio"
                      name="format"
                      value="mp4"
                      checked={options.format === 'mp4'}
                      onChange={() => setOptions({ ...options, format: 'mp4' })}
                      disabled={!mp4Supported}
                    />
                    <span>MP4 (H.264 + AAC)</span>
                    <span className={styles.radioHint}>
                      {mp4Supported ? 'Best compatibility' : 'Not supported in this browser'}
                    </span>
                  </label>
                </div>
              </div>

              <div className={styles.section}>
                <label className={styles.label}>Quality</label>
                <select
                  className={styles.select}
                  value={options.quality}
                  onChange={(e) => setOptions({ ...options, quality: e.target.value as ExportOptions['quality'] })}
                >
                  <option value="low">Low (faster export)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High (slower export)</option>
                </select>
              </div>

              <div className={styles.section}>
                <label className={styles.label}>Resolution</label>
                <select
                  className={styles.select}
                  value={options.resolution}
                  onChange={(e) => setOptions({ ...options, resolution: e.target.value as ExportOptions['resolution'] })}
                >
                  <option value="original">Original</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                </select>
              </div>

              {error && (
                <div className={styles.error}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {error}
                </div>
              )}

              <div className={styles.summary}>
                <span>{clips.length} clip{clips.length !== 1 ? 's' : ''}</span>
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          {progress ? (
            progress.phase !== 'complete' && (
              <button className={styles.cancelButton} onClick={handleCancel}>
                Cancel
              </button>
            )
          ) : (
            <>
              <button className={styles.cancelButton} onClick={handleCancel}>
                Cancel
              </button>
              <button
                className={styles.exportButton}
                onClick={handleExport}
                disabled={clips.length === 0}
              >
                Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
