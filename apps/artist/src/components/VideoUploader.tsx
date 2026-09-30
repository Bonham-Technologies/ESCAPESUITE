import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useEditorStore } from '../store/projectStore';
import { processVideoFile, processImageFile, processAudioFile } from '../core/videoProcessor';
import { getStorageEstimate, deleteVideo, resolveThumbnailUrl } from '../core/storage';
import { formatFileSize, formatDuration } from '../utils/timeUtils';
import { DEFAULT_IMAGE_DURATION } from '../store/types';
import { lockedSourceVideoIds } from '../store/trackLock';
import styles from './VideoUploader.module.css';

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
}

interface StorageInfo {
  used: number;
  quota: number;
  available: number;
}

interface VideoUploaderProps {
  /**
   * Called with a `.veditor` the user dropped here or picked through the file
   * input. The uploader recognises a project file and hands it on; the "you
   * have unsaved work" question, the dialog and the load itself all belong to
   * `useProjectActions` (`App` passes its `handleProjectFile`).
   *
   * Required, and deliberately: this used to be a second `ProjectLoadDialog`
   * rendered right here, with its own pending file and its own copies of the
   * replace/merge handlers — a dialog `App`'s `modalOpen` knew nothing about, so
   * the editor behind it still took every key and Ctrl+O stacked App's copy on
   * top of it (ESCSUITE-63). A caller that forgets to wire this now fails to
   * compile rather than silently swallowing a dropped project.
   */
  onProjectFile: (file: File) => void;
}

export function VideoUploader({ onProjectFile }: VideoUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [showStorageWarning, setShowStorageWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * The "remove from the list" timers still armed, one per finished upload.
   * Cleared on unmount so none can fire on a component that is gone: a timer
   * that outlived the uploader used to call `setUploads` after its test
   * file's document had been torn down, and react-dom threw
   * `window is not defined` from inside it (ESCSUITE-120). Created on first
   * use rather than passed to `useRef`, which would build a Set on every
   * render only to throw it away.
   */
  const removalTimersRef = useRef<Set<number> | null>(null);
  useEffect(() => () => {
    for (const id of removalTimersRef.current ?? []) clearTimeout(id);
    removalTimersRef.current = null;
  }, []);

  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const addSourceVideo = useEditorStore((state) => state.addSourceVideo);
  const removeSourceVideo = useEditorStore((state) => state.removeSourceVideo);

  /**
   * The media a clip on a locked track uses, which nothing here may delete
   * (ESCSUITE-84). Clear All skips these ids the same way Clear Unused always
   * has — a locked source is in use, so it was never going to appear in
   * `unusedVideos` either — rather than refusing the whole action.
   */
  const lockedMedia = useMemo(() => lockedSourceVideoIds(clips, tracks), [clips, tracks]);

  // Calculate which videos are unused (not referenced by any clip)
  const { unusedVideos, unusedSize } = useMemo(() => {
    const usedIds = new Set(
      clips
        .filter(c => c.sourceVideoId)
        .map(c => c.sourceVideoId)
    );
    const unused = sourceVideos.filter(v => !usedIds.has(v.id));
    const size = unused.reduce((sum, v) => sum + v.size, 0);
    return { unusedVideos: unused, unusedSize: size };
  }, [clips, sourceVideos]);

  // Load storage info on mount and after uploads
  const refreshStorageInfo = useCallback(async () => {
    try {
      const info = await getStorageEstimate();
      setStorageInfo(info);
      // Show warning if less than 100MB available
      setShowStorageWarning(info.available < 100 * 1024 * 1024);
    } catch (e) {
      console.error('Failed to get storage estimate:', e);
    }
  }, []);

  useEffect(() => {
    refreshStorageInfo();
  }, [refreshStorageInfo]);

  // Clear unused videos (not in any clip)
  const handleClearUnusedVideos = useCallback(async () => {
    if (unusedVideos.length === 0) return;
    const message = `Remove ${unusedVideos.length} unused media file${unusedVideos.length !== 1 ? 's' : ''}? This will free ${formatFileSize(unusedSize)}.`;
    if (confirm(message)) {
      try {
        for (const video of unusedVideos) {
          await deleteVideo(video.id);
          removeSourceVideo(video.id);
        }
        refreshStorageInfo();
      } catch (e) {
        console.error('Failed to clear unused videos:', e);
      }
    }
  }, [unusedVideos, unusedSize, removeSourceVideo, refreshStorageInfo]);

  // Clear all storage — the bulk form of Clear Unused (ESCSUITE-142): per id,
  // over the editor's own `sourceVideos`, so its blast radius can only ever be
  // what the library shows. `video-editor-db` is shared with ESCAPECRAFT,
  // which keeps recordings ARTIST never imported and has no row for — a
  // whole-object-store wipe used to take those too. A source a locked
  // track's clip still uses is left alone, the same way it was never counted
  // "unused" for Clear Unused either (ESCSUITE-84).
  const handleClearAllStorage = useCallback(async () => {
    const clearable = sourceVideos.filter((v) => !lockedMedia.has(v.id));
    if (clearable.length === 0) return;
    if (confirm('Remove every file in this library? This cannot be undone.')) {
      try {
        for (const video of clearable) {
          await deleteVideo(video.id);
          removeSourceVideo(video.id);
        }
        refreshStorageInfo();
      } catch (e) {
        console.error('Failed to clear storage:', e);
      }
    }
  }, [sourceVideos, lockedMedia, removeSourceVideo, refreshStorageInfo]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const allFiles = Array.from(files);

    // Check for .veditor project files first
    const projectFiles = allFiles.filter((file) => file.name.endsWith('.veditor'));
    if (projectFiles.length > 0) {
      onProjectFile(projectFiles[0]);
      return;
    }

    const mediaFiles = allFiles.filter((file) =>
      file.type.startsWith('video/') || file.type.startsWith('image/') || file.type.startsWith('audio/')
    );

    if (mediaFiles.length === 0) {
      alert('Please select video, image, or audio files');
      return;
    }

    for (const file of mediaFiles) {
      // Check available space before processing
      const currentInfo = await getStorageEstimate();
      if (currentInfo.available < file.size + 10 * 1024 * 1024) {
        setUploads((prev) => [
          ...prev,
          {
            fileName: file.name,
            progress: 0,
            status: 'error',
            error: `Not enough storage space. Need ${formatFileSize(file.size)}, only ${formatFileSize(currentInfo.available)} available. Remove some media to free up space.`,
          },
        ]);
        continue;
      }

      setUploads((prev) => [
        ...prev,
        { fileName: file.name, progress: 0, status: 'processing' },
      ]);

      try {
        const isImage = file.type.startsWith('image/');
        const isAudio = file.type.startsWith('audio/');
        let metadata;
        if (isImage) {
          metadata = await processImageFile(file);
        } else if (isAudio) {
          metadata = await processAudioFile(file);
        } else {
          metadata = await processVideoFile(file);
        }
        addSourceVideo(metadata);

        setUploads((prev) =>
          prev.map((u) =>
            u.fileName === file.name ? { ...u, progress: 100, status: 'complete' } : u
          )
        );

        // Refresh storage info
        refreshStorageInfo();

        // Remove from upload list after a delay. The id is kept so the unmount
        // cleanup above can call it off (ESCSUITE-120).
        const timers = (removalTimersRef.current ??= new Set());
        const id = window.setTimeout(() => {
          timers.delete(id);
          setUploads((prev) => prev.filter((u) => u.fileName !== file.name));
        }, 2000);
        timers.add(id);
      } catch (error) {
        console.error('Failed to process media:', error);

        // Provide more helpful error message for quota errors
        let errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage.includes('QuotaExceeded') || errorMessage.includes('quota')) {
          errorMessage = 'Storage quota exceeded. Remove some media to free up space.';
        }

        setUploads((prev) =>
          prev.map((u) =>
            u.fileName === file.name
              ? {
                  ...u,
                  status: 'error',
                  error: errorMessage,
                }
              : u
          )
        );

        // Refresh storage info to show current state
        refreshStorageInfo();
      }
    }
  }, [addSourceVideo, refreshStorageInfo, onProjectFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      handleFiles(files);
    },
    [handleFiles]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        handleFiles(files);
      }
      // Reset input so the same file can be selected again
      e.target.value = '';
    },
    [handleFiles]
  );

  const handleClearError = useCallback((fileName: string) => {
    setUploads((prev) => prev.filter((u) => u.fileName !== fileName));
  }, []);

  return (
    <div className={styles.container}>
      <div
        className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <div className={styles.dropZoneIcon}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className={styles.dropZoneText}>
          Drop media or click to browse
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*,audio/*,.veditor"
          multiple
          onChange={handleFileChange}
          className={styles.fileInput}
          aria-label="Add media files"
        />
      </div>

      {/* Storage management bar */}
      {storageInfo && (
        <div className={`${styles.storageBar} ${showStorageWarning ? styles.storageWarning : ''}`}>
          <div className={styles.storageMain}>
            <div className={styles.storageInfo}>
              <span>{formatFileSize(storageInfo.used)} / {formatFileSize(storageInfo.quota)}</span>
            </div>
            <div className={styles.storageProgress}>
              <div
                className={styles.storageProgressFill}
                style={{ width: `${(storageInfo.used / storageInfo.quota) * 100}%` }}
              />
            </div>
          </div>
          <div className={styles.storageActions}>
            {storageInfo.used > 1024 * 1024 && (
              <button
                className={`${styles.storageClearButton} ${styles.clearAll}`}
                onClick={handleClearAllStorage}
                title="Remove every file in this library"
              >
                Clear All
              </button>
            )}
            {unusedVideos.length > 0 && (
              <button
                className={`${styles.storageClearButton} ${styles.clearUnused}`}
                onClick={handleClearUnusedVideos}
                title={`Remove ${unusedVideos.length} media files not used in timeline`}
              >
                Clear Unused ({formatFileSize(unusedSize)})
              </button>
            )}
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <div className={styles.uploadList}>
          {uploads.map((upload, index) => (
            <div key={index} className={`${styles.uploadItem} ${upload.status === 'error' ? styles.uploadError : ''}`}>
              <div className={styles.uploadInfo}>
                <span className={styles.uploadName}>{upload.fileName}</span>
                <span className={styles.uploadStatus}>
                  {upload.status === 'processing' && 'Processing...'}
                  {upload.status === 'complete' && 'Complete'}
                  {upload.status === 'error' && upload.error}
                </span>
              </div>
              {upload.status === 'processing' && (
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: '100%' }} />
                </div>
              )}
              {upload.status === 'error' && (
                <button
                  className={styles.dismissButton}
                  onClick={() => handleClearError(upload.fileName)}
                >
                  Dismiss
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Video Library component to show uploaded videos
// Check if media dimensions differ significantly from project resolution
export function VideoLibrary() {
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const addClipToTimeline = useEditorStore((state) => state.addClipToTimeline);
  const removeSourceVideo = useEditorStore((state) => state.removeSourceVideo);
  const setSourceThumbnail = useEditorStore((state) => state.setSourceThumbnail);

  // The media the store will refuse to remove, because a clip on a locked
  // track uses it (ESCSUITE-84) — the row says so rather than doing nothing.
  const lockedMedia = useMemo(() => lockedSourceVideoIds(clips, tracks), [clips, tracks]);

  /**
   * Ids this mount has already asked storage about, so a re-render (a second
   * source arriving, a clip added) does not issue the read again. Never
   * emptied: one read per source per mount is enough — a source whose
   * thumbnail is not in storage will not grow one while the editor is open,
   * and one that IS rebuilt is no longer thumbnail-less.
   *
   * Created on first use rather than passed to `useRef`, which would build a
   * Set on every render and throw all but the first away.
   */
  const thumbnailReadsRef = useRef<Set<string> | null>(null);

  /**
   * False from the moment this component unmounts — for the whole component's
   * life, not one effect run's.
   *
   * It has to outlive the effect below. A rebuild that lands writes the store,
   * which hands this component a new `sourceVideos` array and re-runs that
   * effect; an effect-scoped flag flipped by the previous run's cleanup would
   * therefore tell every read still parked that the editor had gone, and each
   * would free the handle it had just minted instead of setting it — while the
   * re-run skipped those ids, having already read them. One tile repaired per
   * burst, where undo across a project load restores every source of the
   * project at once (review round 1).
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    // Set on the way in as well as cleared on the way out, because StrictMode's
    // double mount runs the cleanup and then mounts the same instance again.
    mountedRef.current = true;
    return () => { mountedRef.current = false };
  }, []);

  /**
   * Rebuild a thumbnail the history scrubbed (ESCSUITE-117).
   *
   * A `thumbnailUrl` is an object URL, so ESCSUITE-113 revokes it when a source
   * leaves the library and scrubs the dead handle out of the history snapshots.
   * A source restored by undo — undo across the `resetProject` a project load
   * does is the realistic case — therefore comes back with no thumbnail, and
   * showed the placeholder tile until it was next genuinely loaded. The stored
   * thumbnail is still there, so read it again and hand the fresh handle to the
   * store. That also covers the older "restored with no thumbnail" case.
   *
   * The handle belongs to the library from the moment the store takes it. Until
   * then this owns it, and frees it if the tile it was for is gone — the source
   * removed, the editor unmounted (`mountedRef`, which is the component's
   * lifetime and deliberately not this effect's), or a real load having won the
   * race.
   */
  useEffect(() => {
    const alreadyRead = (thumbnailReadsRef.current ??= new Set<string>());
    for (const source of sourceVideos) {
      if (source.thumbnailUrl || alreadyRead.has(source.id)) continue;
      const id = source.id;
      alreadyRead.add(id);
      void (async () => {
        let url: string | undefined;
        try {
          url = await resolveThumbnailUrl(id);
        } catch (e) {
          console.error('Failed to rebuild thumbnail:', e);
          return;
        }
        if (!url) return;
        const current = useEditorStore.getState().sourceVideos.find((v) => v.id === id);
        if (!mountedRef.current || !current || current.thumbnailUrl) {
          URL.revokeObjectURL(url);
          return;
        }
        setSourceThumbnail(id, url);
      })();
    }
  }, [sourceVideos, setSourceThumbnail]);

  const handleAddToTimeline = useCallback(
    (media: typeof sourceVideos[0]) => {
      // Auto-fit: the store's addClipToTimeline computes uniform fit scale
      const duration = media.mediaType === 'image' ? DEFAULT_IMAGE_DURATION : media.duration;
      addClipToTimeline({
        id: crypto.randomUUID(),
        sourceVideoId: media.id,
        name: media.name,
        startTime: 0,
        endTime: duration,
        duration: duration,
      });
    },
    [addClipToTimeline]
  );

  const handleRemoveVideo = useCallback(
    async (id: string) => {
      // ESCSUITE-84: the blob goes before the store is asked, so a source a
      // locked-track clip uses is refused here, ahead of `deleteVideo` — the
      // disabled button is the visible half of the same rule.
      if (lockedMedia.has(id)) return;
      if (confirm('Remove this video? This will also remove any clips using it.')) {
        try {
          await deleteVideo(id);
        } catch (e) {
          console.error('Failed to delete video from storage:', e);
        }
        removeSourceVideo(id);
      }
    },
    [lockedMedia, removeSourceVideo]
  );

  if (sourceVideos.length === 0) {
    return (
      <div className={styles.emptyLibrary}>
        <p>No media uploaded yet</p>
      </div>
    );
  }

  return (
    <div className={styles.libraryContainer}>
      <div className={styles.libraryHeader}>
        <span>{sourceVideos.length} item{sourceVideos.length !== 1 ? 's' : ''}</span>
      </div>
      <div className={styles.library}>
        {sourceVideos.map((media) => {
          const isImage = media.mediaType === 'image';
          const isAudio = media.mediaType === 'audio';
          const locked = lockedMedia.has(media.id);
          return (
            <div key={media.id} className={styles.videoItem}>
              <div className={styles.thumbnail}>
                {media.thumbnailUrl ? (
                  <img src={media.thumbnailUrl} alt={media.name} />
                ) : (
                  <div className={styles.thumbnailPlaceholder}>
                    {isImage ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    ) : isAudio ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    )}
                  </div>
                )}
                {isImage && (
                  <div className={styles.mediaTypeBadge}>IMG</div>
                )}
                {isAudio && (
                  <div className={`${styles.mediaTypeBadge} ${styles.audioBadge}`}>AUD</div>
                )}
              </div>
              <div className={styles.videoInfo}>
                <div className={styles.videoName} title={media.name}>
                  {media.name}
                </div>
                <div className={styles.videoMeta}>
                  {isImage ? 'Image' : formatDuration(media.duration)}{isAudio ? '' : ` · ${media.width}x${media.height}`} · {formatFileSize(media.size)}
                </div>
              </div>
              <div className={styles.videoActions}>
                <button
                  className={styles.addButton}
                  onClick={() => handleAddToTimeline(media)}
                  title="Add to timeline"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <button
                  className={styles.removeButton}
                  onClick={() => handleRemoveVideo(media.id)}
                  disabled={locked}
                  title={locked ? 'Used by a clip on a locked track' : 'Remove media'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
