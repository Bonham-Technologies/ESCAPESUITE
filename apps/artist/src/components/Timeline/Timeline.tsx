import React, { useRef, useCallback, useMemo } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { formatTime, timeToPixels } from '../../utils/timeUtils';
import { useVirtualizedTimeline, groupClipsByTrack } from '../../hooks';
import { TimelinePlayhead } from './TimelinePlayhead';
import { TimelineTimeReadout } from './TimelineTimeReadout';
import { TimelineMarkerLines, TimelineRuler } from './TimelineRuler';
import { TimelineTrack } from './TimelineTrack';
import { TrackHeader } from './TrackHeader';
import { PIXELS_PER_SECOND_BASE, type TimeRange } from './timelineGeometry';
import { useClipDrag } from './useClipDrag';
import { useInOutDrag } from './useInOutDrag';
import { usePlayheadDrag } from './usePlayheadDrag';
import { useScrollSync } from './useScrollSync';
import { useTimelineMarquee } from './useTimelineMarquee';
import { useTimelineSeek } from './useTimelineSeek';
import { useTrackHeaderActions } from './useTrackHeaderActions';
import { useTrimDrag } from './useTrimDrag';
import { MarqueeSelection } from '../Preview/MarqueeSelection';
import styles from './Timeline.module.css';

interface TimelineProps {
  onExportSelection?: (timeRange: TimeRange) => void;
}

export function Timeline({ onExportSelection }: TimelineProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);

  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const timelineDuration = useEditorStore((state) => state.project.timeline.duration);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const zoom = useEditorStore((state) => state.zoom);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const snapThreshold = useEditorStore((state) => state.snapThreshold);

  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setSelectedClipId = useEditorStore((state) => state.setSelectedClipId);
  const toggleClipSelection = useEditorStore((state) => state.toggleClipSelection);
  const moveSelectedClips = useEditorStore((state) => state.moveSelectedClips);
  const setClipTimelinePosition = useEditorStore((state) => state.setClipTimelinePosition);
  const moveClipToTrack = useEditorStore((state) => state.moveClipToTrack);
  const updateTrack = useEditorStore((state) => state.updateTrack);
  const removeTrack = useEditorStore((state) => state.removeTrack);
  const reorderTracks = useEditorStore((state) => state.reorderTracks);
  const updateClip = useEditorStore((state) => state.updateClip);
  const shiftClipsAfter = useEditorStore((state) => state.shiftClipsAfter);
  const markers = useEditorStore((state) => state.markers);
  const removeMarker = useEditorStore((state) => state.removeMarker);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying);
  const activeTool = useEditorStore((state) => state.activeTool);
  const splitClip = useEditorStore((state) => state.splitClip);
  const selectClipsInRange = useEditorStore((state) => state.selectClipsInRange);
  const clearMultiSelection = useEditorStore((state) => state.clearMultiSelection);
  const inPoint = useEditorStore((state) => state.inPoint);
  const outPoint = useEditorStore((state) => state.outPoint);
  const setInPoint = useEditorStore((state) => state.setInPoint);
  const setOutPoint = useEditorStore((state) => state.setOutPoint);

  const pixelsPerSecond = PIXELS_PER_SECOND_BASE * zoom;
  const minTimelineDuration = Math.max(timelineDuration, 60);
  const timelineWidth = timeToPixels(minTimelineDuration, pixelsPerSecond);

  // Sort tracks by index for display (higher index = top of stack visually, but we render bottom-to-top)
  const sortedTracks = useMemo(() => {
    return [...tracks].sort((a, b) => b.index - a.index); // Higher index at top
  }, [tracks]);

  // Virtualized timeline rendering - only render clips in viewport
  // This hook must be called before any callbacks that use onVirtualScroll
  const {
    visibleClips,
    onScroll: onVirtualScroll,
    setContainerWidth,
  } = useVirtualizedTimeline({
    clips,
    pixelsPerSecond,
    overscan: 300, // Render clips 300px outside viewport
  });

  // Group visible clips by track for efficient rendering
  const visibleClipsByTrack = useMemo(
    () => groupClipsByTrack(visibleClips),
    [visibleClips]
  );

  // Get clips for a specific track (only visible clips)
  const getTrackClips = useCallback(
    (trackId: string) => {
      const trackClips = visibleClipsByTrack.get(trackId);
      return trackClips ? trackClips.map(vc => vc.clip) : [];
    },
    [visibleClipsByTrack]
  );

  // Scrubbing the playhead
  const { isDraggingPlayhead, handlePlayheadMouseDown } = usePlayheadDrag({
    trackContainerRef,
    pixelsPerSecond,
    timelineDuration,
    setCurrentTime,
  });

  // Dragging the in/out point markers on the ruler
  const { handleInPointMouseDown, handleOutPointMouseDown } = useInOutDrag({
    trackContainerRef,
    rulerRef,
    pixelsPerSecond,
    timelineDuration,
    setInPoint,
    setOutPoint,
  });

  // Keep the ruler, the headers and the track area scrolled together
  const { handleTrackScroll, handleHeadersScroll } = useScrollSync({
    trackContainerRef,
    rulerRef,
    trackHeadersRef,
    onVirtualScroll,
    setContainerWidth,
  });

  // Dragging a clip along the timeline (and the razor tool's split)
  const { dragState, handleClipMouseDown } = useClipDrag({
    trackContainerRef,
    pixelsPerSecond,
    clips,
    tracks,
    snapEnabled,
    snapThreshold,
    selectedClipIds,
    activeTool,
    setSelectedClipId,
    toggleClipSelection,
    moveSelectedClips,
    setClipTimelinePosition,
    moveClipToTrack,
    splitClip,
  });

  // Dragging a clip's edge
  const { trimState, handleTrimMouseDown } = useTrimDrag({
    trackContainerRef,
    pixelsPerSecond,
    clips,
    sourceVideos,
    tracks,
    activeTool,
    setSelectedClipId,
    updateClip,
    shiftClipsAfter,
  });

  // Calculate total tracks height
  const totalTracksHeight = tracks.reduce((sum, t) => sum + t.height, 0);

  // Raising, lowering and deleting a track from its header
  const { moveTrackUp, moveTrackDown, handleDeleteTrack } = useTrackHeaderActions({
    sortedTracks,
    tracks,
    clips,
    reorderTracks,
    removeTrack,
  });

  // Track whether marquee was just completed so handleTrackClick can skip deselection
  const marqueeJustFinished = useRef(false);

  // Rubber-band selection over the track area
  const { marquee, handleTrackMouseDown } = useTimelineMarquee({
    trackContainerRef,
    pixelsPerSecond,
    clips,
    selectedClipIds,
    selectClipsInRange,
    isDraggingPlayhead,
    dragState,
    marqueeJustFinished,
  });

  // Click-to-seek, on the ruler and on empty track space
  const { handleRulerClick, handleTrackClick } = useTimelineSeek({
    rulerRef,
    trackContainerRef,
    pixelsPerSecond,
    timelineDuration,
    minTimelineDuration,
    isPlaying,
    setIsPlaying,
    setCurrentTime,
    setSelectedClipId,
    clearMultiSelection,
    isDraggingPlayhead,
    dragState,
    marqueeJustFinishedRef: marqueeJustFinished,
  });

  return (
    <div className={styles.container} ref={containerRef}>
      {/* Ruler */}
      <TimelineRuler
        rulerRef={rulerRef}
        duration={minTimelineDuration}
        pixelsPerSecond={pixelsPerSecond}
        width={timelineWidth}
        markers={markers}
        inPoint={inPoint}
        outPoint={outPoint}
        onRulerClick={handleRulerClick}
        onRemoveMarker={removeMarker}
        onInPointMouseDown={handleInPointMouseDown}
        onOutPointMouseDown={handleOutPointMouseDown}
      />

      {/* Tracks area */}
      <div className={styles.tracksArea}>
        {/* Track headers column */}
        <div className={styles.trackHeadersColumn}>
          {/* Scrollable track headers */}
          <div className={styles.trackHeaders} ref={trackHeadersRef} onScroll={handleHeadersScroll}>
            {sortedTracks.map((track, index) => (
              <TrackHeader
                key={track.id}
                track={track}
                index={index}
                trackCount={sortedTracks.length}
                onUpdateTrack={updateTrack}
                onMoveTrackUp={moveTrackUp}
                onMoveTrackDown={moveTrackDown}
                onDeleteTrack={handleDeleteTrack}
              />
            ))}
          </div>
        </div>

        {/* Track content */}
        <div
          className={`${styles.trackContainer} ${activeTool === 'razor' ? styles.razorCursor : ''} ${activeTool === 'ripple' ? styles.rippleCursor : ''}`}
          ref={trackContainerRef}
          onClick={handleTrackClick}
          onMouseDown={handleTrackMouseDown}
          onScroll={handleTrackScroll}
        >
          <div className={styles.tracksContent} style={{ width: timelineWidth }}>
            {sortedTracks.map((track) => (
              <TimelineTrack
                key={track.id}
                track={track}
                clips={getTrackClips(track.id)}
                allClips={clips}
                sourceVideos={sourceVideos}
                pixelsPerSecond={pixelsPerSecond}
                selectedClipId={selectedClipId}
                selectedClipIds={selectedClipIds}
                dragState={dragState}
                trimState={trimState}
                onClipMouseDown={handleClipMouseDown}
                onTrimMouseDown={handleTrimMouseDown}
              />
            ))}

            {/* In/Out region highlight over tracks */}
            {inPoint !== null && outPoint !== null && (
              <div
                className={styles.inOutRegion}
                style={{
                  left: timeToPixels(inPoint, pixelsPerSecond),
                  width: timeToPixels(outPoint - inPoint, pixelsPerSecond),
                  height: totalTracksHeight,
                }}
              />
            )}

            {/* In/Out point vertical lines */}
            {inPoint !== null && (
              <div
                className={styles.inOutLine}
                style={{
                  left: timeToPixels(inPoint, pixelsPerSecond),
                  height: totalTracksHeight,
                  '--in-out-color': '#4ade80',
                } as React.CSSProperties}
              />
            )}
            {outPoint !== null && (
              <div
                className={styles.inOutLine}
                style={{
                  left: timeToPixels(outPoint, pixelsPerSecond),
                  height: totalTracksHeight,
                  '--in-out-color': '#f87171',
                } as React.CSSProperties}
              />
            )}

            {/* Marker lines */}
            <TimelineMarkerLines markers={markers} pixelsPerSecond={pixelsPerSecond} />

            {/* Snap indicator */}
            {dragState && dragState.snappedPosition !== null && (
              <div
                className={styles.snapLine}
                style={{ left: timeToPixels(dragState.snappedPosition, pixelsPerSecond) }}
              />
            )}

            {/* Playhead (subscribes to currentTime itself — see TimelinePlayhead) */}
            <TimelinePlayhead
              pixelsPerSecond={pixelsPerSecond}
              height={totalTracksHeight}
              onMouseDown={handlePlayheadMouseDown}
            />

            {/* Marquee selection rectangle */}
            {marquee.active && marquee.start && marquee.current && (
              <MarqueeSelection
                startX={marquee.start.x}
                startY={marquee.start.y}
                currentX={marquee.current.x}
                currentY={marquee.current.y}
              />
            )}
          </div>
        </div>
      </div>

      {/* Timeline info */}
      <div className={styles.info}>
        <TimelineTimeReadout duration={timelineDuration} />
        {inPoint !== null && outPoint !== null && (
          <span className={styles.inOutInfo}>
            Selection: {formatTime(inPoint)} - {formatTime(outPoint)} ({formatTime(outPoint - inPoint)})
            {onExportSelection && (
              <button
                className={styles.exportSelectionBtn}
                onClick={() => onExportSelection({ start: inPoint, end: outPoint })}
                title="Export selected region"
              >
                Export Selection
              </button>
            )}
          </span>
        )}
        <span>{clips.length} clip{clips.length !== 1 ? 's' : ''} · {tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
