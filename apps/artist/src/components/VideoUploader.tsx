import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useEditorStore } from '../store/projectStore';
import { processVideoFile, processImageFile, processAudioFile } from '../core/videoProcessor';
import { getStorageEstimate, clearAllVideos, deleteVideo } from '../core/storage';
import { getFrameCache } from '../core/frameCache';
import { saveProject, loadProject } from '../core/projectManager';
import { formatFileSize, formatDuration } from '../utils/timeUtils';
import { DEFAULT_IMAGE_DURATION } from '../store/types';
import { ResolutionMismatchDialog } from './ResolutionMismatchDialog';
import { ProjectLoadDialog } from './ProjectLoadDialog';
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

export function VideoUploader() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [showStorageWarning, setShowStorageWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingProjectFile, setPendingProjectFile] = useState<File | null>(null);
  const [showProjectLoadDialog, setShowProjectLoadDialog] = useState(false);

  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const project = useEditorStore((state) => state.project);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const addSourceVideo = useEditorStore((state) => state.addSourceVideo);
  const removeSourceVideo = useEditorStore((state) => state.removeSourceVideo);
  const setProject = useEditorStore((state) => state.setProject);
  const resetProject = useEditorStore((state) => state.resetProject);

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

  // Get frame cache stats
  const [cacheStats, setCacheStats] = useState<{ memoryBytes: number; frameCount: number } | null>(null);

  useEffect(() => {
    const updateCacheStats = () => {
      const cache = getFrameCache();
      setCacheStats(cache.getStats());
    };
    updateCacheStats();
    const interval = setInterval(updateCacheStats, 2000);
    return () => clearInterval(interval);
  }, []);

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

  // Clear frame cache
  const handleClearFrameCache = useCallback(() => {
    const cache = getFrameCache();
    const stats = cache.getStats();
    if (stats.frameCount === 0) return;
    cache.clear();
    setCacheStats({ memoryBytes: 0, frameCount: 0 });
  }, []);

  // Clear all storage (IndexedDB + in-memory state)
  const handleClearAllStorage = useCallback(async () => {
    if (confirm('Clear ALL stored media? This cannot be undone.')) {
      try {
        await clearAllVideos();
        // Also clear any in-memory state
        sourceVideos.forEach(v => removeSourceVideo(v.id));
        // Clear frame cache too
        const cache = getFrameCache();
        cache.clear();
        setCacheStats({ memoryBytes: 0, frameCount: 0 });
        refreshStorageInfo();
      } catch (e) {
        console.error('Failed to clear storage:', e);
      }
    }
  }, [sourceVideos, removeSourceVideo, refreshStorageInfo]);

  // Load a .veditor project file
  const loadProjectFile = useCallback(async (file: File) => {
    try {
      const { project: loadedProject, sourceVideos: loadedVideos } = await loadProject(file);
      resetProject();
      setProject(loadedProject);
      loadedVideos.forEach(addSourceVideo);
    } catch (error) {
      console.error('Failed to load project file:', error);
      alert('Failed to load project file.');
    }
  }, [resetProject, setProject, addSourceVideo]);

  // Handle .veditor file upload with safety dialog
  const handleProjectFileUpload = useCallback((file: File) => {
    if (clips.length > 0) {
      setPendingProjectFile(file);
      setShowProjectLoadDialog(true);
    } else {
      loadProjectFile(file);
    }
  }, [clips.length, loadProjectFile]);

  const handleProjectLoadCancel = useCallback(() => {
    setPendingProjectFile(null);
    setShowProjectLoadDialog(false);
  }, []);

  const handleProjectLoadSaveAndLoad = useCallback(async () => {
    setShowProjectLoadDialog(false);
    const file = pendingProjectFile;
    setPendingProjectFile(null);
    if (!file) return;
    try {
      await saveProject(project, sourceVideos);
    } catch (error) {
      console.error('Failed to save current project:', error);
    }
    await loadProjectFile(file);
  }, [pendingProjectFile, project, sourceVideos, loadProjectFile]);

  const handleProjectLoadDiscardAndLoad = useCallback(async () => {
    setShowProjectLoadDialog(false);
    const file = pendingProjectFile;
    setPendingProjectFile(null);
    if (!file) return;
    await loadProjectFile(file);
  }, [pendingProjectFile, loadProjectFile]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const allFiles = Array.from(files);

    // Check for .veditor project files first
    const projectFiles = allFiles.filter((file) => file.name.endsWith('.veditor'));
    if (projectFiles.length > 0) {
      handleProjectFileUpload(projectFiles[0]);
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

        // Remove from upload list after a delay
        setTimeout(() => {
          setUploads((prev) => prev.filter((u) => u.fileName !== file.name));
        }, 2000);
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
  }, [addSourceVideo, refreshStorageInfo, handleProjectFileUpload]);

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
                title="Clear all stored media and cache"
              >
                Clear All
              </button>
            )}
            {cacheStats && cacheStats.frameCount > 0 && (
              <button
                className={styles.storageClearButton}
                onClick={handleClearFrameCache}
                title={`Clear ${cacheStats.frameCount} cached frames to free memory`}
              >
                Clear Cache ({formatFileSize(cacheStats.memoryBytes)})
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

      <ProjectLoadDialog
        isOpen={showProjectLoadDialog}
        onCancel={handleProjectLoadCancel}
        onSaveAndLoad={handleProjectLoadSaveAndLoad}
        onDiscardAndLoad={handleProjectLoadDiscardAndLoad}
      />
    </div>
  );
}

// Video Library component to show uploaded videos
// Check if media dimensions differ significantly from project resolution
function hasResolutionMismatch(
  mediaWidth: number,
  mediaHeight: number,
  projectWidth: number,
  projectHeight: number
): boolean {
  if (mediaWidth === 0 || mediaHeight === 0) return false; // audio files
  return (
    Math.abs(1 - mediaWidth / projectWidth) > 0.1 ||
    Math.abs(1 - mediaHeight / projectHeight) > 0.1
  );
}

interface PendingMedia {
  media: { id: string; name: string; duration: number; width: number; height: number; mediaType?: string };
}

export function VideoLibrary() {
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const addClipToTimeline = useEditorStore((state) => state.addClipToTimeline);
  const updateClipTransform = useEditorStore((state) => state.updateClipTransform);
  const removeSourceVideo = useEditorStore((state) => state.removeSourceVideo);
  const projectResolution = useEditorStore((state) => state.project.resolution);

  const [mismatchDialog, setMismatchDialog] = useState<PendingMedia | null>(null);

  const addClipWithScale = useCallback(
    (media: PendingMedia['media'], scaleX: number, scaleY: number) => {
      const duration = media.mediaType === 'image' ? DEFAULT_IMAGE_DURATION : media.duration;
      const clipId = crypto.randomUUID();
      addClipToTimeline({
        id: clipId,
        sourceVideoId: media.id,
        name: media.name,
        startTime: 0,
        endTime: duration,
        duration: duration,
      });
      // Apply scale transform if not default (1, 1)
      if (scaleX !== 1 || scaleY !== 1) {
        updateClipTransform(clipId, { scaleX, scaleY });
      }
    },
    [addClipToTimeline, updateClipTransform]
  );

  const handleAddToTimeline = useCallback(
    (media: typeof sourceVideos[0]) => {
      // Check for resolution mismatch (skip audio files)
      if (
        media.mediaType !== 'audio' &&
        media.width > 0 &&
        media.height > 0 &&
        hasResolutionMismatch(media.width, media.height, projectResolution.width, projectResolution.height)
      ) {
        setMismatchDialog({ media });
        return;
      }

      // No mismatch — add directly
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
    [addClipToTimeline, projectResolution]
  );

  const handleScaleToFit = useCallback(() => {
    if (!mismatchDialog) return;
    const { media } = mismatchDialog;
    const scale = Math.min(
      projectResolution.width / media.width,
      projectResolution.height / media.height
    );
    addClipWithScale(media, scale, scale);
    setMismatchDialog(null);
  }, [mismatchDialog, projectResolution, addClipWithScale]);

  const handleKeepOriginal = useCallback(() => {
    if (!mismatchDialog) return;
    const { media } = mismatchDialog;
    const scaleX = media.width / projectResolution.width;
    const scaleY = media.height / projectResolution.height;
    addClipWithScale(media, scaleX, scaleY);
    setMismatchDialog(null);
  }, [mismatchDialog, projectResolution, addClipWithScale]);

  const handleRemoveVideo = useCallback(
    async (id: string) => {
      if (confirm('Remove this video? This will also remove any clips using it.')) {
        try {
          await deleteVideo(id);
        } catch (e) {
          console.error('Failed to delete video from storage:', e);
        }
        removeSourceVideo(id);
      }
    },
    [removeSourceVideo]
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
                  title="Remove media"
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

      <ResolutionMismatchDialog
        isOpen={mismatchDialog !== null}
        mediaName={mismatchDialog?.media.name ?? ''}
        mediaDimensions={{
          width: mismatchDialog?.media.width ?? 0,
          height: mismatchDialog?.media.height ?? 0,
        }}
        projectDimensions={projectResolution}
        onScaleToFit={handleScaleToFit}
        onKeepOriginal={handleKeepOriginal}
      />
    </div>
  );
}
