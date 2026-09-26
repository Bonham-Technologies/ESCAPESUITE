import React from 'react';
import type { Clip, SourceVideo, Track } from '../../store/types';
import { formatTime, timeToPixels } from '../../utils/timeUtils';
import { ClipKeyframeDiamonds } from './ClipKeyframeDiamonds';
import { AudioWaveform } from './AudioWaveform';
import { CLIP_THUMB_ASPECT, maskClipPathFor } from '../../utils/maskClipPath';
import type { DragState, TrimState } from './types';
import styles from './Timeline.module.css';

/**
 * How much shorter a clip's box is than its track row's content, in pixels.
 *
 * `.clip` is `top: 4px; height: calc(100% - 8px)` (`Timeline.module.css`), so
 * this mirrors one CSS declaration and exists because two boxes drawn inside
 * `.clip` need that height as a number in JS — the thumbnail, whose
 * `maskClipPathFor` needs pixels to place a circle's radius, and the waveform,
 * whose canvas is sized in device pixels. CSS cannot read `track.height`, so
 * neither can be written as a percentage.
 */
const CLIP_BOX_VERTICAL_INSET = 8;

/**
 * `.track`'s `border-bottom`, in pixels.
 *
 * Load-bearing and easy to miss: `.track` is `box-sizing: border-box` with
 * `border-bottom: 1px solid var(--border-color)`, and `.clip` is absolutely
 * positioned, so its `height: calc(100% - 8px)` resolves the `100%` against
 * `.track`'s **padding** box — which is `track.height` minus this border, not
 * `track.height`. A 60px row therefore holds a 51px clip box, not a 52px one.
 *
 * (`.track:last-child` drops the border, so the bottom row's box really is one
 * pixel taller than this says. Being a pixel short there is the harmless
 * direction — the drawn box sits inside `.clip` rather than overflowing it —
 * and the alternative would be to give the last row of the stack its own
 * arithmetic for one pixel.)
 */
const TRACK_BORDER_BOTTOM = 1;

/**
 * The shortest clip box there is, mirroring `.clip`'s own `min-height: 40px`: a
 * track dragged shorter than that stops shrinking the box, so both boxes drawn
 * inside it have to stop shrinking too — otherwise they would float against the
 * top edge of a box taller than themselves.
 */
const MIN_CLIP_BOX_HEIGHT = 40;

/**
 * The height, in pixels, of the box `.clip` actually draws in on a row this
 * tall — the row less {@link TRACK_BORDER_BOTTOM} and
 * {@link CLIP_BOX_VERTICAL_INSET}, never below {@link MIN_CLIP_BOX_HEIGHT}.
 *
 * **One expression for both boxes**, deliberately (ESCSUITE-76). The waveform
 * canvas used to be sized `track.height - 4`, which at a 60px row is 56px inside
 * a 51px box — and `.clip` is `overflow: hidden`, so the extra five pixels were
 * not scaled away, they were **cut off**: the waveform lost its lower peaks and
 * its centreline sat ~2.5px below the middle of the box. The two boxes cannot
 * drift again while they read the same number.
 */
function clipBoxHeightFor(trackHeight: number): number {
  return Math.max(
    trackHeight - TRACK_BORDER_BOTTOM - CLIP_BOX_VERTICAL_INSET,
    MIN_CLIP_BOX_HEIGHT
  );
}

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
 *
 * `React.memo`'d, and only useful while `Timeline` hands it the *same* `clips`
 * array — which is why `Timeline`'s `clipsByTrack` memo exists. A clip drag
 * still re-renders every row, because `dragState` changes on every pointer
 * frame and any row may have to draw the ghost; a marquee changes none of these
 * props, so the rows now sit out the whole gesture
 * (`timelineGestures.perf.test.ts`).
 */
export const TimelineTrack = React.memo(function TimelineTrack({
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
  /** The box every clip on this row draws in — see `clipBoxHeightFor`. */
  const clipBoxHeight = clipBoxHeightFor(track.height);

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

        // The masked thumbnail (ESCSUITE-65, decision 5): the clip's own mask,
        // shown where the user looks for the clip.
        //
        // Media clips only — an audio part carries no picture and an overlay has
        // no drawn box a mask could mean anything against — and only when the
        // source actually has a thumbnail, which `processVideoFile` and
        // `processImageFile` write and `extractAudioMetadata` does not.
        //
        // It costs this row **no new store read**: `sourceMedia` above is the
        // lookup the waveform and the type styling already need, and `clip.mask`
        // is on the clip being rendered. That is why `App.rerender.test.tsx`'s
        // Timeline counts and `timelineGestures.perf.test.ts`' per-move counts
        // are unchanged by this feature.
        const thumbnailUrl =
          !isAudioClip && !isTextOverlay && !isShapeOverlay ? sourceMedia?.thumbnailUrl : undefined;
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
                height={clipBoxHeight}
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
              {thumbnailUrl && (
                <img
                  className={styles.clipThumb}
                  src={thumbnailUrl}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  decoding="async"
                  width={Math.round(clipBoxHeight * CLIP_THUMB_ASPECT)}
                  height={clipBoxHeight}
                  style={{ clipPath: maskClipPathFor(clip.mask, clipBoxHeight) }}
                />
              )}
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
});
