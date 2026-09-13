import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { formatTime, timeToPixels } from '../../utils/timeUtils';
import { useVirtualizedTimeline, groupClipsByTrack } from '../../hooks';
import { TimelinePlayhead } from './TimelinePlayhead';
import { TimelineTimeReadout } from './TimelineTimeReadout';
import { TimelineMarkerLines, TimelineRuler } from './TimelineRuler';
import { clampTime, pointerTime } from './timelineGeometry';
import { TimelineTrack } from './TimelineTrack';
import { TrackHeader } from './TrackHeader';
import { useClipDrag } from './useClipDrag';
import { useScrollSync } from './useScrollSync';
import { useTimelineMarquee } from './useTimelineMarquee';
import { useTrimDrag } from './useTrimDrag';
import { MarqueeSelection } from '../Preview/MarqueeSelection';
import styles from './Timeline.module.css';

const PIXELS_PER_SECOND_BASE = 50;

interface TimelineProps {
  onExportSelection?: (timeRange: { start: number; end: number }) => void;
}

export function Timeline({ onExportSelection }: TimelineProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

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

  const [isDraggingInPoint, setIsDraggingInPoint] = useState(false);
  const [isDraggingOutPoint, setIsDraggingOutPoint] = useState(false);

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

  // Handle ruler click to seek (and pause if playing)
  const handleRulerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!rulerRef.current) return;

      if (isPlaying) {
        setIsPlaying(false);
      }

      const rect = rulerRef.current.getBoundingClientRect();
      const time = pointerTime(e.clientX, rect.left, rulerRef.current.scrollLeft, pixelsPerSecond);
      const clampedTime = clampTime(time, timelineDuration || minTimelineDuration);
      setCurrentTime(clampedTime);
    },
    [pixelsPerSecond, timelineDuration, minTimelineDuration, setCurrentTime, isPlaying, setIsPlaying]
  );

  // Handle playhead drag
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  }, []);

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;

      const rect = trackContainerRef.current.getBoundingClientRect();
      const time = pointerTime(e.clientX, rect.left, trackContainerRef.current.scrollLeft, pixelsPerSecond);
      const clampedTime = clampTime(time, timelineDuration);
      setCurrentTime(clampedTime);
    };

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPlayhead, pixelsPerSecond, timelineDuration, setCurrentTime]);

  // Handle in/out point marker drag
  useEffect(() => {
    if (!isDraggingInPoint && !isDraggingOutPoint) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ref = trackContainerRef.current || rulerRef.current;
      if (!ref) return;

      const rect = ref.getBoundingClientRect();
      const time = pointerTime(e.clientX, rect.left, ref.scrollLeft, pixelsPerSecond);
      const clampedTime = clampTime(time, timelineDuration);

      if (isDraggingInPoint) {
        setInPoint(clampedTime);
      } else {
        setOutPoint(clampedTime);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingInPoint(false);
      setIsDraggingOutPoint(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingInPoint, isDraggingOutPoint, pixelsPerSecond, timelineDuration, setInPoint, setOutPoint]);

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

  // Move track up (toward top of visual stack)
  // sortedTracks is ordered top-first (highest index at [0])
  // reorderTracks assigns index based on array position (first = index 0 = bottom)
  // So we need to reverse the array before passing to reorderTracks
  const moveTrackUp = useCallback((trackId: string) => {
    const trackIndex = sortedTracks.findIndex(t => t.id === trackId);
    if (trackIndex <= 0) return; // Already at top

    // Swap with the track above in visual order
    const newOrder = sortedTracks.map(t => t.id);
    [newOrder[trackIndex], newOrder[trackIndex - 1]] = [newOrder[trackIndex - 1], newOrder[trackIndex]];
    // Reverse so first item gets highest index (top)
    reorderTracks([...newOrder].reverse());
  }, [sortedTracks, reorderTracks]);

  // Move track down (toward bottom of visual stack)
  const moveTrackDown = useCallback((trackId: string) => {
    const trackIndex = sortedTracks.findIndex(t => t.id === trackId);
    if (trackIndex >= sortedTracks.length - 1) return; // Already at bottom

    // Swap with the track below in visual order
    const newOrder = sortedTracks.map(t => t.id);
    [newOrder[trackIndex], newOrder[trackIndex + 1]] = [newOrder[trackIndex + 1], newOrder[trackIndex]];
    // Reverse so first item gets highest index (top)
    reorderTracks([...newOrder].reverse());
  }, [sortedTracks, reorderTracks]);

  // Delete track (with confirmation if it has clips)
  const handleDeleteTrack = useCallback((trackId: string) => {
    if (tracks.length <= 1) return; // Keep at least one track

    const trackClips = clips.filter(c => c.trackId === trackId);
    if (trackClips.length > 0) {
      if (!confirm(`Delete track with ${trackClips.length} clip(s)? This cannot be undone.`)) {
        return;
      }
    }
    removeTrack(trackId);
  }, [tracks.length, clips, removeTrack]);

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

  // Handle click on track to seek, pause, and deselect.
  // Declared after the drag and marquee hooks because it reads what they own:
  // a live `dragState` suppresses it, and `marqueeJustFinished` tells it that
  // the click it is about to handle only ended a rubber-band selection.
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      // If a marquee selection just completed, skip normal click behavior
      if (marqueeJustFinished.current) {
        marqueeJustFinished.current = false;
        return;
      }

      if (!trackContainerRef.current || isDraggingPlayhead || dragState) return;

      // Only deselect if clicking directly on the track container, not on a clip or playhead
      const target = e.target as HTMLElement;
      const isClickOnClip = target.closest('[data-clip-id]');
      const isClickOnPlayhead = target.closest('[data-playhead]');

      // Don't seek or deselect when clicking playhead
      if (isClickOnPlayhead) return;

      if (isPlaying) {
        setIsPlaying(false);
      }

      const rect = trackContainerRef.current.getBoundingClientRect();
      const time = pointerTime(e.clientX, rect.left, trackContainerRef.current.scrollLeft, pixelsPerSecond);
      const clampedTime = clampTime(time, timelineDuration);
      setCurrentTime(clampedTime);

      // Deselect clip only when clicking on empty track space
      if (!isClickOnClip) {
        clearMultiSelection();
        setSelectedClipId(null);
      }
    },
    [pixelsPerSecond, timelineDuration, setCurrentTime, setSelectedClipId, clearMultiSelection, isDraggingPlayhead, dragState, isPlaying, setIsPlaying]
  );

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
        onInPointMouseDown={(e) => { e.stopPropagation(); setIsDraggingInPoint(true); }}
        onOutPointMouseDown={(e) => { e.stopPropagation(); setIsDraggingOutPoint(true); }}
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
