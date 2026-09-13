import React from 'react';
import type { Clip, SourceVideo, Track } from '../../store/types';
import { formatTime, timeToPixels } from '../../utils/timeUtils';
import { ClipKeyframeDiamonds } from './ClipKeyframeDiamonds';
import { AudioWaveform } from './AudioWaveform';
import type { DragState, TrimState } from './types';
import styles from './Timeline.module.css';

interface TimelineTrackProps {
  track: Track;
  /**
   * The clips to draw on this row — the caller's `getTrackClips(track.id)`,
   * i.e. only the clips the virtualiser says are near the viewport.
   */
  clips: Clip[];
  /**
   * Every clip on the timeline. Only the drag preview reads it, to size itself
   * from the dragged clip's duration — that clip may live on another track.
   */
  allClips: Clip[];
  /** The imported media, for the clip's icon, its colour, and its waveform. */
  sourceVideos: SourceVideo[];
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  selectedClipId: string | null;
  selectedClipIds: Set<string>;
  /** The drag in progress, or null. Drives the ghost position and the preview. */
  dragState: DragState | null;
  /** The trim in progress, or null. Only the clip id is read, for styling. */
  trimState: TrimState | null;
  onClipMouseDown: (e: React.MouseEvent, clip: Clip) => void;
  onTrimMouseDown: (e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') => void;
}

/**
 * One row of the track stack: every clip on this track, drawn at the scale the
 * timeline is zoomed to, plus the ghost of a clip being dragged onto it.
 *
 * A clip's position is normally its own `timelinePosition`, but a drag moves it
 * — and a bulk drag moves every other selected clip with it — so the position
 * and the track drawn here are the *displayed* ones, which is why this
 * component needs the drag state rather than just the clips.
 *
 * `data-track-id` is load-bearing: `Timeline`'s drag and marquee handlers find
 * the row under the pointer by querying for it.
 */
export function TimelineTrack({
  track,
  clips,
  allClips,
  sourceVideos,
  pixelsPerSecond,
  selectedClipId,
  selectedClipIds,
  dragState,
  trimState,
  onClipMouseDown,
  onTrimMouseDown,
}: TimelineTrackProps) {
  return (
    <div
      className={`${styles.track} ${!track.visible ? styles.trackHidden : ''} ${track.locked ? styles.trackLocked : ''}`}
      style={{ height: track.height }}
      data-track-id={track.id}
    >
      {/* Clips on this track */}
      {clips.map((clip) => {
        const isDragging = dragState?.clipId === clip.id;
        // During bulk drag, show all multi-selected clips moving together
        const isBulkDragging = !isDragging && dragState && selectedClipIds.has(clip.id) && selectedClipIds.has(dragState.clipId) && selectedClipIds.size > 1;
        const bulkDragDelta = isBulkDragging ? dragState.currentPosition - dragState.originalPosition : 0;
        const displayPosition = isDragging ? dragState.currentPosition : clip.timelinePosition + bulkDragDelta;
        const displayTrackId = isDragging ? dragState.currentTrackId : clip.trackId;

        // Only render if on this track (or being dragged to this track)
        if (displayTrackId !== track.id && !isDragging) return null;
        if (isDragging && displayTrackId !== track.id) return null;

        const clipX = timeToPixels(displayPosition, pixelsPerSecond);
        const clipWidth = timeToPixels(clip.duration, pixelsPerSecond);
        const isSelected = clip.id === selectedClipId;
        const isMultiSelected = selectedClipIds.has(clip.id);

        const isTrimming = trimState?.clipId === clip.id;

        // Check media type and overlay type for visual styling
        const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
        const isAudioClip = sourceMedia?.mediaType === 'audio';
        const isImageClip = sourceMedia?.mediaType === 'image';
        const isTextOverlay = clip.overlayType === 'text';
        const isShapeOverlay = clip.overlayType === 'shape';

        // Check if this clip has waveform data
        const hasWaveform = sourceMedia?.hasAudio && sourceMedia?.waveformData && sourceMedia.waveformData.length > 0;

        return (
          <div
            key={clip.id}
            data-clip-id={clip.id}
            className={`${styles.clip} ${isSelected ? styles.clipSelected : ''} ${isMultiSelected && !isSelected ? styles.clipMultiSelected : ''} ${isDragging || isBulkDragging ? styles.clipDragging : ''} ${isTrimming ? styles.clipTrimming : ''} ${isAudioClip ? styles.clipAudio : ''} ${isImageClip ? styles.clipImage : ''} ${isTextOverlay ? styles.clipText : ''} ${isShapeOverlay ? styles.clipShape : ''}`}
            style={{
              left: clipX,
              width: clipWidth,
            }}
            onMouseDown={(e) => onClipMouseDown(e, clip)}
          >
            {/* Audio waveform visualization */}
            {hasWaveform && sourceMedia && (
              <AudioWaveform
                peaks={sourceMedia.waveformData!}
                sourceDuration={sourceMedia.duration}
                startTime={clip.startTime}
                endTime={clip.endTime}
                width={clipWidth}
                height={track.height - 4}
                isAudioClip={isAudioClip}
                isSelected={isSelected}
              />
            )}
            {/* Left trim handle */}
            <div
              className={styles.trimHandle}
              style={{ left: 0 }}
              onMouseDown={(e) => onTrimMouseDown(e, clip, 'start')}
            />
            {/* Right trim handle */}
            <div
              className={styles.trimHandle}
              style={{ right: 0 }}
              onMouseDown={(e) => onTrimMouseDown(e, clip, 'end')}
            />
            <div className={styles.clipContent}>
              {isAudioClip && (
                <svg className={styles.clipIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              )}
              {isImageClip && (
                <svg className={styles.clipIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              )}
              {isTextOverlay && (
                <svg className={styles.clipIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 7 4 4 20 4 20 7" />
                  <line x1="9" y1="20" x2="15" y2="20" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
              )}
              {isShapeOverlay && clip.shapeData?.type === 'blur' && (
                <svg className={styles.clipIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              )}
              {isShapeOverlay && clip.shapeData?.type !== 'blur' && (
                <svg className={styles.clipIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
              )}
              <span className={styles.clipName}>{clip.name}</span>
              <span className={styles.clipDuration}>{formatTime(clip.duration)}</span>
            </div>
            {/* Keyframe diamonds */}
            <ClipKeyframeDiamonds clip={clip} pixelsPerSecond={pixelsPerSecond} />
          </div>
        );
      })}

      {/* Render dragged clip preview on target track */}
      {dragState && dragState.currentTrackId === track.id && dragState.originalTrackId !== track.id && (
        <div
          className={`${styles.clip} ${styles.clipPreview}`}
          style={{
            left: timeToPixels(dragState.currentPosition, pixelsPerSecond),
            width: timeToPixels(
              allClips.find(c => c.id === dragState.clipId)?.duration || 0,
              pixelsPerSecond
            ),
          }}
        />
      )}
    </div>
  );
}
