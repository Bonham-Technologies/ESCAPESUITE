import { useState, useCallback, useRef, useEffect } from 'react';
import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import { useEditorStore } from '../../store/projectStore';
import {
  exportToWebM,
  exportToMP4,
  exportToGIF,
  estimateGifBytes,
  isMP4ExportSupported,
  isWebMExportSupported,
  ExportAbortedError,
  ExportError,
  EXPORT_NO_WEBCODECS_REASON,
  WEBM_NO_CODEC_REASON,
  GIF_ALWAYS_AVAILABLE_NOTE,
} from '../../core/exporter';
import {
  getResolution,
  gifFrameRate,
  resolutionForFormat,
  DEFAULT_GIF_FPS,
  GIF_FPS_OPTIONS,
  GIF_RESOLUTIONS,
  GIF_LONG_RANGE_SECONDS,
  GIF_LONG_RANGE_WARNING,
} from '../../core/exportTypes';
import { getSetting, setSetting } from '../../core/storage';
import { analytics } from '../../utils/analytics';
import { sendMessage } from '../../utils/integration';
import type { ExportOptions, ExportProgress } from '../../store/types';
import { formatTime, formatFileSize } from '../../utils/timeUtils';
import styles from './ExportDialog.module.css';

/**
 * A resolution dropdown option's label, with its actual output dimensions
 * spelled out. Since ESCSUITE-94 a preset's width follows the *project's*
 * aspect, so a bare "1080p" is surprising on a portrait project (it exports
 * narrower than 1920) — printing the dimensions makes the rule self-evident
 * (ESCSUITE-111).
 */
function resolutionOptionLabel(
  label: string,
  preset: ExportOptions['resolution'],
  projectResolution: { width: number; height: number }
): string {
  const { width, height } = getResolution(preset, projectResolution.width, projectResolution.height, projectResolution);
  return `${label} — ${width}×${height}`;
}

/** The resolution presets a format offers, in the order the dropdown lists them. */
const VIDEO_RESOLUTIONS: readonly ExportOptions['resolution'][] = ['project', '1080p', '720p', '480p'];

/** A preset's dropdown label — `'project'` reads as "Project", the rest as themselves. */
function resolutionPresetLabel(preset: ExportOptions['resolution']): string {
  return preset === 'project' ? 'Project' : preset;
}

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timeRange?: { start: number; end: number };
}

interface LastExportSettings {
  format: ExportOptions['format'];
  quality: ExportOptions['quality'];
  resolution: ExportOptions['resolution'];
  /** GIF only, and absent from every setting saved before ESCSUITE-34. */
  fps?: ExportOptions['fps'];
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
    fps: DEFAULT_GIF_FPS,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set alongside `error` only when the failed run was WebM, the failure was
  // an ExportError (a diagnosed codec problem, not an abort or a generic
  // crash) and MP4 is actually available — the WebM-side mirror of MP4's own
  // "Try WebM Instead" recovery (ESCSUITE-29 Mechanism 1), offered inline
  // rather than replacing the dialog with a dedicated screen, since WebM is
  // already this dialog's own default/fallback format.
  const [offerMp4Fallback, setOfferMp4Fallback] = useState(false);
  const [mp4FailedError, setMp4FailedError] = useState<string | null>(null);

  // The export currently in flight, if any — the only thing Cancel, ×, and
  // Escape can actually abort. Cleared both by a run's own `finally` (once
  // it finishes) and by handleCancel, so it always names "the run that still
  // needs stopping" and never a stale one — which is not the same question
  // as "am I still the run being displayed" below.
  const abortControllerRef = useRef<AbortController | null>(null);
  // Identity of the most recently *started* export. Unlike abortControllerRef,
  // this is never cleared by a run's own completion — only overwritten when a
  // *newer* run starts, and explicitly nulled by handleCancel so a cancelled
  // run's late callbacks cannot resurrect its own progress either. A run's
  // async continuation compares against this to tell whether it is still the
  // one the user is looking at, so its own completion or cancellation never
  // makes it look current to itself again later.
  const latestExportRef = useRef<AbortController | null>(null);

  const mp4Supported = isMP4ExportSupported();

  // WebM's own support is a real codec probe (ESCSUITE-22/29) rather than a
  // boolean read of which globals exist, so — unlike `mp4Supported` above —
  // it cannot be answered synchronously at render time. Optimistic `true`
  // until the probe resolves: a user in Chrome/Edge (by far the common case)
  // never sees the primary button flash disabled-then-enabled, and a user
  // the probe does disable sees it happen within one effect tick of the
  // dialog opening, well before they could have clicked anything.
  const [webmSupported, setWebmSupported] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // Probe at the size the export will actually use once a preset is
    // chosen, not the raw project resolution (review round 1, MINOR 2): a
    // project whose native size this browser cannot configure but whose
    // 720p/480p preset it can should not read as unsupported. Re-runs
    // whenever the chosen resolution preset changes, not on every render —
    // `advancedOptions.resolution` is the only part of `advancedOptions` in
    // the dependency list.
    // Built from the two primitives already in the dependency list below,
    // rather than closing over `projectResolution` itself, so this effect's
    // only real inputs are the ones listed — a fresh object every render
    // would otherwise still need the object itself in the deps, which is
    // exactly the per-render re-probe this is written to avoid.
    const probeResolution = { width: projectResolution.width, height: projectResolution.height };
    const { width, height } = getResolution(
      advancedOptions.resolution,
      probeResolution.width,
      probeResolution.height,
      probeResolution
    );
    isWebMExportSupported(width, height).then((supported) => {
      if (!cancelled) setWebmSupported(supported);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectResolution.width, projectResolution.height, advancedOptions.resolution]);

  // Neither *video* format can be exported — no WebCodecs in this browser at
  // all (Firefox/Safari before their recent VideoEncoder support, or any
  // browser with it disabled). Both primary buttons are disabled below, with
  // this sentence shown in the main body rather than behind the collapsed
  // Advanced panel — the ESCSUITE-22 fix for the dialog offering an enabled
  // "Download WebM" button that silently failed as soon as it was clicked.
  // Since ESCSUITE-34 it is no longer a dead end: GIF needs no WebCodecs, so
  // the alert carries GIF_ALWAYS_AVAILABLE_NOTE beside it and the GIF radio
  // stays enabled. Hence the rename — "neither format" stopped being true the
  // moment a format that needs no WebCodecs existed.
  const noVideoFormatSupported = !mp4Supported && !webmSupported;

  // Why the WebM-flavoured buttons (primary + advanced) are disabled, or
  // null when WebM is offered. Mirrors `separateTracksBlockedReason` in
  // ESCAPECRAFT: the browser's answer either way, worded for what WebM
  // specifically needs — VP9/VP8 — distinct from "no WebCodecs at all".
  const webmBlockedReason = webmSupported
    ? null
    : noVideoFormatSupported
      ? EXPORT_NO_WEBCODECS_REASON
      : WEBM_NO_CODEC_REASON;

  // The Advanced "Download {format}" button must gate on the format the
  // click will actually run, not the one selected in the radio (review
  // round 1, MAJOR 1): `handleExport` already falls back from 'mp4' to
  // 'webm' whenever MP4 is unsupported (see `format` below), which is the
  // intentional behaviour `falls back to WebM when MP4 is chosen in a
  // browser without MP4 support` pins — a restored `{format:'mp4'}` setting
  // in a now-MP4-less browser must still export, as WebM. Gating on this
  // effective format rather than the selected one keeps that export reachable
  // while still refusing to run an export that would fail outright.
  // GIF short-circuits the MP4 fallback entirely: it is always available
  // (`gifenc` is pure JavaScript), so nothing can block it (ESCSUITE-34).
  const effectiveAdvancedFormat: ExportOptions['format'] =
    advancedOptions.format === 'gif'
      ? 'gif'
      : advancedOptions.format === 'mp4' && mp4Supported
        ? 'mp4'
        : 'webm';
  const advancedBlockedReason = effectiveAdvancedFormat === 'webm' ? webmBlockedReason : null;

  // What a GIF export would actually produce, for the estimate and the warning.
  // Computed unconditionally (it is arithmetic over values already in scope) and
  // rendered only when GIF is the selected format.
  const gifFps = gifFrameRate(advancedOptions.fps);
  const timelineDuration = clips.reduce(
    (max, clip) => Math.max(max, clip.timelinePosition + clip.duration),
    0
  );
  // The length that will be encoded: the in/out section when there is one, the
  // whole timeline otherwise. The warning is about the output, not the project.
  const gifSeconds = timeRange ? timeRange.end - timeRange.start : timelineDuration;
  // Frames, never seconds, derived from the rate — the same expression
  // `exportToGIF` itself uses, so the estimate counts what will be encoded.
  const gifFrames = Math.ceil(gifSeconds * gifFps);
  const gifOutput = getResolution(
    advancedOptions.resolution,
    projectResolution.width,
    projectResolution.height,
    projectResolution
  );

  // Load last export settings on dialog open
  useEffect(() => {
    if (isOpen) {
      getSetting<LastExportSettings>('lastExportSettings').then((saved) => {
        if (saved) {
          setAdvancedOptions({
            format: saved.format,
            quality: saved.quality,
            resolution: saved.resolution,
            // Through `gifFrameRate`, so a setting saved before ESCSUITE-34
            // (no `fps` at all) or one carrying a rate this build no longer
            // offers lands on the default rather than on `undefined`.
            fps: gifFrameRate(saved.fps),
          });
          setShowAdvanced(true);
        }
      });
    }
  }, [isOpen]);

  const handleExport = useCallback(async (formatOverride?: ExportOptions['format'], useAdvanced?: boolean, exportFullVideo?: boolean) => {
    if (clips.length === 0) {
      setError('No clips to export');
      return;
    }

    setError(null);
    setOfferMp4Fallback(false);
    setMp4FailedError(null);
    setProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

    // Create new AbortController for this export. Cancelling one export and
    // starting another right away is a normal user action — the export
    // buttons reappear the instant Cancel is clicked, well before the
    // cancelled export's promise actually settles (it typically rejects only
    // at its next `await` inside the exporter). Every state write this run
    // makes below is guarded on isCurrentRun(), so a run that has been
    // superseded by a later one can still clear its own abort controller but
    // can never reset a later run's progress, error state or "exporting" UI.
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    latestExportRef.current = abortController;
    const isCurrentRun = () => latestExportRef.current === abortController;

    // Determine options: primary button uses defaults, advanced button uses configured options
    const effectiveTimeRange = exportFullVideo ? undefined : timeRange;
    const exportOptions: ExportOptions = useAdvanced
      ? { ...advancedOptions, timeRange: effectiveTimeRange }
      : { format: 'webm', quality: 'medium', resolution: 'project', timeRange: effectiveTimeRange };

    const requestedFormat = formatOverride || exportOptions.format;
    // GIF needs no WebCodecs, so it never falls back; MP4 still does.
    const format: ExportOptions['format'] =
      requestedFormat === 'gif' ? 'gif' : requestedFormat === 'mp4' && mp4Supported ? 'mp4' : 'webm';
    analytics.exportStarted(format);

    // Save advanced settings if using advanced options
    if (useAdvanced) {
      setSetting('lastExportSettings', {
        format: advancedOptions.format,
        quality: advancedOptions.quality,
        resolution: advancedOptions.resolution,
        fps: gifFrameRate(advancedOptions.fps),
      });
    }

    try {
      const onProgress = (p: ExportProgress) => {
        if (isCurrentRun()) setProgress(p);
      };

      let blob: Blob;
      let extension: string;

      if (format === 'gif') {
        blob = await exportToGIF(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
        extension = 'gif';
      } else if (format === 'mp4') {
        blob = await exportToMP4(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
        extension = 'mp4';
      } else {
        blob = await exportToWebM(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
        extension = 'webm';
      }

      // A superseded run must neither download nor notify a host: both are
      // user/host-visible side effects that belong only to the export the
      // user is actually looking at.
      if (isCurrentRun()) {
        const fileName = `${projectName || 'export'}.${extension}`;

        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Hand the finished file to an embedding host (no-op when not embedded).
        // The download above has already happened, so a host channel that throws
        // (a closed frame, a rejected target origin) must not fail the export.
        try {
          sendMessage({
            type: 'EXPORT_COMPLETE',
            payload: { blob, format: extension, name: fileName },
          });
        } catch (hostError) {
          console.error('Failed to notify host of completed export:', hostError);
        }
      }

      // Calculate total export duration from clips
      const totalDuration = clips.reduce((max, clip) => {
        const clipEnd = clip.timelinePosition + clip.duration;
        return Math.max(max, clipEnd);
      }, 0);

      analytics.exportCompleted(extension as 'webm' | 'mp4' | 'gif', totalDuration);

      if (isCurrentRun()) {
        setProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

        // Close dialog after a delay
        setTimeout(() => {
          if (isCurrentRun()) {
            onClose();
            setProgress(null);
          }
        }, 2000);
      }
    } catch (err) {
      // Don't show error for user-initiated cancellation
      if (err instanceof ExportAbortedError) {
        if (isCurrentRun()) setProgress(null);
        return;
      }

      const errorMessage = err instanceof Error ? err.message : 'Export failed';
      const errorType = err instanceof ExportError ? 'ExportError' : (err instanceof Error ? err.name : 'unknown');
      const failProgress = progress ? progress.progress / 100 : 0;

      console.error('Export failed:', err);
      if (err instanceof ExportError) {
        console.debug(`[${format === 'gif' ? 'GIF' : format === 'mp4' ? 'MP4' : 'WebM'} Export] Diagnostic log:`, err.exportLog);
      }

      // Track the failure
      analytics.exportFailed(format, errorType, failProgress);

      // If MP4 failed, show the fallback dialog instead of just an error
      if (isCurrentRun()) {
        if (format === 'mp4') {
          setMp4FailedError(errorMessage);
        } else {
          setError(errorMessage);
          // ESCSUITE-29 Mechanism 1: a WebM ExportError is a diagnosed codec
          // problem (the VP9/VP8 probe found nothing, or the encoder reported
          // one mid-export) rather than a generic crash, so — when MP4 is
          // actually available — offer it as a one-click alternative here,
          // the same thing MP4's own failure screen offers for WebM. A GIF
          // failure is not a codec problem another codec would solve, so it is
          // offered nothing further (ESCSUITE-34).
          setOfferMp4Fallback(format === 'webm' && err instanceof ExportError && mp4Supported);
        }
        setProgress(null);
      }
    } finally {
      // Clear the abort controller reference — but only if it is still this
      // run's own controller. A cancelled run's `finally` can fire after a
      // later run has already stored its controller here (the cancelled
      // run's promise usually only rejects at its next internal `await`),
      // and clobbering that later controller would leave Cancel / × / Escape
      // unable to abort the export the user is actually looking at.
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  }, [clips, tracks, sourceVideos, advancedOptions, projectName, projectResolution, mp4Supported, onClose, timeRange]);

  const handleCancel = useCallback(() => {
    // Abort any in-progress export
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // A cancelled run is no longer "current" even to itself: without this, a
    // solo run's own late onProgress/success/failure callbacks would still
    // pass isCurrentRun() and could resurrect its progress if the dialog is
    // reopened before its promise actually settles.
    latestExportRef.current = null;
    setProgress(null);
    setMp4FailedError(null);
    // The dialog stays mounted, so a stale alert would be re-announced the next
    // time it opens.
    setError(null);
    setOfferMp4Fallback(false);
    onClose();
  }, [onClose]);

  const handleWebMFallback = useCallback(() => {
    // Start a WebM export with the same quality/resolution settings
    handleExport('webm', true);
  }, [handleExport]);

  const handleMp4Fallback = useCallback(() => {
    // Start an MP4 export with the same quality/resolution settings
    handleExport('mp4', true);
  }, [handleExport]);

  // Modal keyboard behaviour — initial focus, the Tab trap, Escape-to-close and
  // focus restored to the opener — comes from the shared hook, which is this
  // dialog's own effect lifted into `packages/shared` and then fixed: its
  // Shift+Tab trap has an arm for focus parked on the dialog container, which
  // the copy that lived here did not. Escape still leaves through the same
  // cancel path as the × and Cancel buttons (aborting an in-progress export
  // exactly as they do), and is still stopped in the capture phase so the
  // editor's shortcuts do not also see it.
  const dialogRef = useDialogBehaviour(handleCancel, isOpen);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="export-dialog-title">Export Video</h2>
          <button className={styles.closeButton} onClick={handleCancel} title="Close">
            &times;
          </button>
        </div>

        <div className={styles.body}>
          {mp4FailedError ? (
            <div className={styles.section}>
              <div className={styles.error} role="alert">
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
              {/* GIF only: the exporter projects the finished size from the
                  bytes it has actually written, which is the one number a user
                  wants while a GIF encodes. Absent on every WebM and MP4
                  report, so this row simply does not exist for them. */}
              {progress.estimatedBytes !== undefined && (
                <span className={styles.summary} role="status">
                  Estimated size: ~{formatFileSize(progress.estimatedBytes)}
                </span>
              )}
            </div>
          ) : (
            <>
              {/* Neither format can be exported — shown here, in the main
                  body, rather than behind the collapsed Advanced panel (the
                  dialog's only other "not supported" notice, MP4's, lived
                  there, which is exactly what let an unusable WebM button
                  through unremarked — ESCSUITE-22). */}
              {noVideoFormatSupported && (
                <div className={styles.error} role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {/* Since ESCSUITE-34 this is no longer a dead end: the second
                      sentence names the one export that needs no WebCodecs. */}
                  {EXPORT_NO_WEBCODECS_REASON} {GIF_ALWAYS_AVAILABLE_NOTE}
                </div>
              )}

              {error && (
                <div className={styles.error} role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  Export failed: {error}
                </div>
              )}
              {offerMp4Fallback && (
                <button
                  className={styles.exportButton}
                  style={{ marginBottom: '12px' }}
                  onClick={handleMp4Fallback}
                >
                  Try MP4 Instead
                </button>
              )}

              <div className={styles.primarySection}>
                {timeRange ? (
                  <>
                    <button
                      className={styles.primaryExportButton}
                      onClick={() => handleExport(undefined, false)}
                      disabled={clips.length === 0 || !webmSupported}
                      title={webmBlockedReason ?? undefined}
                    >
                      Export Section ({formatTime(timeRange.start)} - {formatTime(timeRange.end)})
                    </button>
                    <button
                      className={styles.primaryExportButton}
                      onClick={() => handleExport(undefined, false, true)}
                      disabled={clips.length === 0 || !webmSupported}
                      title={webmBlockedReason ?? undefined}
                      style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
                    >
                      Export Full Video
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.primaryExportButton}
                    onClick={() => handleExport(undefined, false)}
                    disabled={clips.length === 0 || !webmSupported}
                    title={webmBlockedReason ?? undefined}
                  >
                    Download WebM
                  </button>
                )}
              </div>

              {/* WebM is possible but MP4 is not, or vice versa — say which,
                  without waiting for the Advanced panel (ESCSUITE-22: "when
                  only one format is possible, that one stays enabled and the
                  other is disabled with its reason"). The MP4-only radio's
                  own reason already lives in the Advanced panel below; this
                  is the WebM-side mirror, said where the primary button
                  actually is. */}
              {!noVideoFormatSupported && webmBlockedReason && (
                <div className={styles.summary} role="status">
                  {webmBlockedReason} Choose MP4 under Advanced options to export anyway.
                </div>
              )}

              {/* MP4 decodes through WebCodecs (in a worker) when the decode worker
                  starts successfully; WebM always drives an HTMLVideoElement from
                  rAF, which the browser throttles once the tab is hidden — and so
                  does MP4 when it has fallen back to the same element path
                  (ESCSUITE-153 / ESCSUITE-29 Mechanism 2: a worker that fails to
                  start, missing from a standalone download or blocked by a CSP, is
                  the case this hedge is for). The progress line below says so for
                  that run specifically, once the exporter knows. Hidden when GIF
                  is selected: it is about the two video formats' decoders, and
                  GIF has none (ESCSUITE-34). */}
              {mp4Supported && advancedOptions.format !== 'gif' && (
                <div className={styles.summary}>
                  MP4 exports keep encoding in a background tab when the decoder is available. WebM needs this tab visible.
                </div>
              )}

              {/* The two things a GIF surprises people with, said once. */}
              {advancedOptions.format === 'gif' && (
                <div className={styles.summary}>
                  GIF export needs this tab visible and has no sound.
                </div>
              )}

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
                        <label className={`${styles.radio} ${!webmSupported ? styles.radioDisabled : ''}`}>
                          <input
                            type="radio"
                            name="format"
                            value="webm"
                            checked={advancedOptions.format === 'webm'}
                            onChange={() => setAdvancedOptions({
                              ...advancedOptions,
                              format: 'webm',
                              resolution: resolutionForFormat('webm', advancedOptions.resolution),
                            })}
                            disabled={!webmSupported}
                          />
                          <span>WebM (VP9 + Opus)</span>
                          <span className={styles.radioHint}>
                            {webmSupported ? 'Smaller file size' : 'Not supported in this browser'}
                          </span>
                        </label>
                        <label className={`${styles.radio} ${!mp4Supported ? styles.radioDisabled : ''}`}>
                          <input
                            type="radio"
                            name="format"
                            value="mp4"
                            checked={advancedOptions.format === 'mp4'}
                            onChange={() => setAdvancedOptions({
                              ...advancedOptions,
                              format: 'mp4',
                              resolution: resolutionForFormat('mp4', advancedOptions.resolution),
                            })}
                            disabled={!mp4Supported}
                          />
                          <span>MP4 (H.264 + AAC)</span>
                          <span className={styles.radioHint}>
                            {mp4Supported ? 'Best compatibility' : 'Not supported in this browser'}
                          </span>
                        </label>
                        {/* Never disabled: `gifenc` is pure JavaScript, so this is
                            the one format that works in a browser where both
                            others are refused. The label and hint deliberately
                            avoid the words "WebM" and "MP4" — the suite finds the
                            other two radios by exactly those words. */}
                        <label className={styles.radio}>
                          <input
                            type="radio"
                            name="format"
                            value="gif"
                            checked={advancedOptions.format === 'gif'}
                            onChange={() => setAdvancedOptions({
                              ...advancedOptions,
                              format: 'gif',
                              resolution: resolutionForFormat('gif', advancedOptions.resolution),
                            })}
                          />
                          <span>GIF (256 colours, no audio)</span>
                          <span className={styles.radioHint}>No WebCodecs needed</span>
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

                    {/* GIF only: 10/15/20, the three rates a format whose size is
                        roughly linear in its frame count can sensibly offer. */}
                    {advancedOptions.format === 'gif' && (
                      <div className={styles.section}>
                        <label className={styles.label} htmlFor="export-gif-fps">
                          Frames per second
                        </label>
                        <select
                          id="export-gif-fps"
                          className={styles.select}
                          value={gifFps}
                          onChange={(e) => setAdvancedOptions({
                            ...advancedOptions,
                            fps: Number(e.target.value) as ExportOptions['fps'],
                          })}
                        >
                          {GIF_FPS_OPTIONS.map((fps) => (
                            <option key={fps} value={fps}>
                              {fps === 10 ? '10 fps (smallest file)' : fps === 20 ? '20 fps (smoothest)' : '15 fps'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className={styles.section}>
                      <label className={styles.label}>Resolution</label>
                      <select
                        className={styles.select}
                        value={advancedOptions.resolution}
                        onChange={(e) => setAdvancedOptions({ ...advancedOptions, resolution: e.target.value as ExportOptions['resolution'] })}
                      >
                        {/* Per format: GIF offers three fixed heights, the video
                            formats offer the project's own size and three
                            presets. Every format radio runs the current
                            selection through `resolutionForFormat`, so the value
                            is always one this list contains. */}
                        {(advancedOptions.format === 'gif' ? GIF_RESOLUTIONS : VIDEO_RESOLUTIONS).map((preset) => (
                          <option key={preset} value={preset}>
                            {resolutionOptionLabel(resolutionPresetLabel(preset), preset, projectResolution)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* The up-front estimate: pixels x frames x ~0.3 bytes, which
                        the exporter replaces with a real one (bytes written /
                        frames done x frames total) as soon as it has a frame. */}
                    {advancedOptions.format === 'gif' && (
                      <div className={styles.summary} role="status">
                        Estimated size: ~{formatFileSize(estimateGifBytes(gifOutput.width, gifOutput.height, gifFrames))}
                        {' '}at {gifOutput.width}×{gifOutput.height}, {gifFrames} frames
                      </div>
                    )}

                    {/* A warning, never a refusal. */}
                    {advancedOptions.format === 'gif' && gifSeconds > GIF_LONG_RANGE_SECONDS && (
                      <div className={styles.summary} role="status">
                        {GIF_LONG_RANGE_WARNING}
                      </div>
                    )}

                    <button
                      className={styles.advancedExportButton}
                      onClick={() => handleExport(undefined, true)}
                      disabled={clips.length === 0 || advancedBlockedReason !== null}
                      title={advancedBlockedReason ?? undefined}
                    >
                      Download {advancedOptions.format === 'gif' ? 'GIF' : advancedOptions.format === 'mp4' ? 'MP4' : 'WebM'}
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
                disabled={!webmSupported}
                title={webmBlockedReason ?? undefined}
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
