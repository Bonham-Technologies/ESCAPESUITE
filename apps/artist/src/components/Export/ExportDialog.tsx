import { useState, useCallback, useRef, useEffect } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { exportToWebM, exportToMP4, isMP4ExportSupported, ExportAbortedError, ExportError } from '../../core/exporter';
import { getSetting, setSetting } from '../../core/storage';
import { analytics } from '../../utils/analytics';
import type { ExportOptions, ExportProgress } from '../../store/types';
import { formatTime } from '../../utils/timeUtils';
import styles from './ExportDialog.module.css';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timeRange?: { start: number; end: number };
}

interface LastExportSettings {
  format: ExportOptions['format'];
  quality: ExportOptions['quality'];
  resolution: ExportOptions['resolution'];
}

export function ExportDialog({ isOpen, onClose, timeRange: timeRangeProp }: ExportDialogProps) {
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const projectName = useEditorStore((state) => state.project.name);
  const projectResolution = useEditorStore((state) => state.project.resolution);
  const inPoint = useEditorStore((state) => state.inPoint);
  const outPoint = useEditorStore((state) => state.outPoint);

  // Use prop timeRange if provided, otherwise derive from in/out points
  const timeRange = timeRangeProp ?? (inPoint !== null && outPoint !== null
    ? { start: Math.min(inPoint, outPoint), end: Math.max(inPoint, outPoint) }
    : undefined);

  const [advancedOptions, setAdvancedOptions] = useState<ExportOptions>({
    format: 'webm',
    quality: 'medium',
    resolution: 'project',
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mp4FailedError, setMp4FailedError] = useState<string | null>(null);

  // AbortController for cancelling exports
  const abortControllerRef = useRef<AbortController | null>(null);

  const mp4Supported = isMP4ExportSupported();

  // Load last export settings on dialog open
  useEffect(() => {
    if (isOpen) {
      getSetting<LastExportSettings>('lastExportSettings').then((saved) => {
        if (saved) {
          setAdvancedOptions({
            format: saved.format,
            quality: saved.quality,
            resolution: saved.resolution,
          });
          setShowAdvanced(true);
        }
      });
    }
  }, [isOpen]);

  const handleExport = useCallback(async (formatOverride?: 'webm' | 'mp4', useAdvanced?: boolean, exportFullVideo?: boolean) => {
    if (clips.length === 0) {
      setError('No clips to export');
      return;
    }

    setError(null);
    setMp4FailedError(null);
    setProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

    // Create new AbortController for this export
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Determine options: primary button uses defaults, advanced button uses configured options
    const effectiveTimeRange = exportFullVideo ? undefined : timeRange;
    const exportOptions: ExportOptions = useAdvanced
      ? { ...advancedOptions, timeRange: effectiveTimeRange }
      : { format: 'webm', quality: 'medium', resolution: 'project', timeRange: effectiveTimeRange };

    const requestedFormat = formatOverride || exportOptions.format;
    const format = requestedFormat === 'mp4' && mp4Supported ? 'mp4' : 'webm';
    analytics.exportStarted(format);

    // Save advanced settings if using advanced options
    if (useAdvanced) {
      setSetting('lastExportSettings', {
        format: advancedOptions.format,
        quality: advancedOptions.quality,
        resolution: advancedOptions.resolution,
      });
    }

    try {
      const onProgress = (p: ExportProgress) => setProgress(p);

      let blob: Blob;
      let extension: string;

      if (format === 'mp4') {
        blob = await exportToMP4(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
        extension = 'mp4';
      } else {
        blob = await exportToWebM(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
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

      const errorMessage = err instanceof Error ? err.message : 'Export failed';
      const errorType = err instanceof ExportError ? 'ExportError' : (err instanceof Error ? err.name : 'unknown');
      const failProgress = progress ? progress.progress / 100 : 0;

      console.error('Export failed:', err);
      if (err instanceof ExportError) {
        console.debug('[MP4 Export] Diagnostic log:', err.exportLog);
      }

      // Track the failure
      analytics.exportFailed(format, errorType, failProgress);

      // If MP4 failed, show the fallback dialog instead of just an error
      if (format === 'mp4') {
        setMp4FailedError(errorMessage);
        setProgress(null);
      } else {
        setError(errorMessage);
        setProgress(null);
      }
    } finally {
      // Clear the abort controller reference
      abortControllerRef.current = null;
    }
  }, [clips, tracks, sourceVideos, advancedOptions, projectName, projectResolution, mp4Supported, onClose, timeRange]);

  const handleCancel = useCallback(() => {
    // Abort any in-progress export
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setProgress(null);
    setMp4FailedError(null);
    onClose();
  }, [onClose]);

  const handleWebMFallback = useCallback(() => {
    // Start a WebM export with the same quality/resolution settings
    handleExport('webm', true);
  }, [handleExport]);

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
          {mp4FailedError ? (
            <div className={styles.section}>
              <div className={styles.error}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                MP4 export failed: {mp4FailedError}
              </div>
              <p className={styles.radioHint} style={{ marginTop: '8px' }}>
                You can try exporting as WebM instead. WebM files work in most browsers and video players.
              </p>
            </div>
          ) : progress ? (
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
              <div className={styles.primarySection}>
                {timeRange ? (
                  <>
                    <button
                      className={styles.primaryExportButton}
                      onClick={() => handleExport(undefined, false)}
                      disabled={clips.length === 0}
                    >
                      Export Section ({formatTime(timeRange.start)} - {formatTime(timeRange.end)})
                    </button>
                    <button
                      className={styles.primaryExportButton}
                      onClick={() => handleExport(undefined, false, true)}
                      disabled={clips.length === 0}
                      style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
                    >
                      Export Full Video
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.primaryExportButton}
                    onClick={() => handleExport(undefined, false)}
                    disabled={clips.length === 0}
                  >
                    Download WebM
                  </button>
                )}
              </div>

              <div className={styles.advancedSection}>
                <button
                  className={styles.advancedToggle}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  aria-expanded={showAdvanced}
                >
                  <svg
                    className={`${styles.advancedChevron} ${showAdvanced ? styles.advancedChevronOpen : ''}`}
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  Advanced options
                </button>

                {showAdvanced && (
                  <div className={styles.advancedContent}>
                    <div className={styles.section}>
                      <label className={styles.label}>Format</label>
                      <div className={styles.radioGroup}>
                        <label className={styles.radio}>
                          <input
                            type="radio"
                            name="format"
                            value="webm"
                            checked={advancedOptions.format === 'webm'}
                            onChange={() => setAdvancedOptions({ ...advancedOptions, format: 'webm' })}
                          />
                          <span>WebM (VP9 + Opus)</span>
                          <span className={styles.radioHint}>Smaller file size</span>
                        </label>
                        <label className={`${styles.radio} ${!mp4Supported ? styles.radioDisabled : ''}`}>
                          <input
                            type="radio"
                            name="format"
                            value="mp4"
                            checked={advancedOptions.format === 'mp4'}
                            onChange={() => setAdvancedOptions({ ...advancedOptions, format: 'mp4' })}
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
                        value={advancedOptions.quality}
                        onChange={(e) => setAdvancedOptions({ ...advancedOptions, quality: e.target.value as ExportOptions['quality'] })}
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
                        value={advancedOptions.resolution}
                        onChange={(e) => setAdvancedOptions({ ...advancedOptions, resolution: e.target.value as ExportOptions['resolution'] })}
                      >
                        <option value="project">Project ({projectResolution.width}x{projectResolution.height})</option>
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

                    <button
                      className={styles.advancedExportButton}
                      onClick={() => handleExport(undefined, true)}
                      disabled={clips.length === 0}
                    >
                      Download {advancedOptions.format === 'mp4' ? 'MP4' : 'WebM'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          {mp4FailedError ? (
            <>
              <button className={styles.cancelButton} onClick={handleCancel}>
                Close
              </button>
              <button
                className={styles.exportButton}
                onClick={handleWebMFallback}
              >
                Try WebM Instead
              </button>
            </>
          ) : progress ? (
            progress.phase !== 'complete' && (
              <button className={styles.cancelButton} onClick={handleCancel}>
                Cancel
              </button>
            )
          ) : (
            <button className={styles.cancelButton} onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
