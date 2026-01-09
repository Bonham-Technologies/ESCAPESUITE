import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import {
  useEditorStore,
  getSnapPoints,
  findNearestSnapPoint,
  wouldOverlap,
} from '../../store/projectStore';
import type { Clip } from '../../store/types';
import { formatTime, timeToPixels, pixelsToTime } from '../../utils/timeUtils';
import { useVirtualizedTimeline, groupClipsByTrack } from '../../hooks';
import { ClipKeyframeDiamonds } from './ClipKeyframeDiamonds';
import { AudioWaveform } from './AudioWaveform';
import styles from './Timeline.module.css';

const PIXELS_PER_SECOND_BASE = 50;
const RULER_MAJOR_INTERVAL = 5;
const RULER_MINOR_INTERVAL = 1;

interface DragState {
  clipId: string;
  originalTrackId: string;
  originalPosition: number;
  currentTrackId: string;
  currentPosition: number;
  snappedPosition: number | null;
  offsetX: number; // Mouse offset from clip left edge
}

interface TrimState {
  clipId: string;
  edge: 'start' | 'end';
  originalStartTime: number;
  originalEndTime: number;
  originalTimelinePosition: number;
}

export function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [trimState, setTrimState] = useState<TrimState | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState('');

  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const timelineDuration = useEditorStore((state) => state.project.timeline.duration);
  const currentTime = useEditorStore((state) => state.currentTime);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const zoom = useEditorStore((state) => state.zoom);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const snapThreshold = useEditorStore((state) => state.snapThreshold);

  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setSelectedClipId = useEditorStore((state) => state.setSelectedClipId);
  const setClipTimelinePosition = useEditorStore((state) => state.setClipTimelinePosition);
  const moveClipToTrack = useEditorStore((state) => state.moveClipToTrack);
  const updateTrack = useEditorStore((state) => state.updateTrack);
  const removeTrack = useEditorStore((state) => state.removeTrack);
  const reorderTracks = useEditorStore((state) => state.reorderTracks);
  const updateClip = useEditorStore((state) => state.updateClip);
  const shiftClipsAfter = useEditorStore((state) => state.shiftClipsAfter);
  const markers = useEditorStore((state) => state.markers);
  const removeMarker = useEditorStore((state) => state.removeMarker);
  const activeTool = useEditorStore((state) => state.activeTool);
  const splitClip = useEditorStore((state) => state.splitClip);

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

  // Generate ruler ticks
  const renderRuler = useCallback(() => {
    const ticks: React.ReactNode[] = [];
    const totalTicks = Math.ceil(minTimelineDuration / RULER_MINOR_INTERVAL);

    for (let i = 0; i <= totalTicks; i++) {
      const time = i * RULER_MINOR_INTERVAL;
      const isMajor = time % RULER_MAJOR_INTERVAL === 0;
      const x = timeToPixels(time, pixelsPerSecond);

      ticks.push(
        <div
          key={time}
          className={`${styles.tick} ${isMajor ? styles.tickMajor : styles.tickMinor}`}
          style={{ left: x }}
        >
          {isMajor && <span className={styles.tickLabel}>{formatTime(time)}</span>}
        </div>
      );
    }

    return ticks;
  }, [minTimelineDuration, pixelsPerSecond]);

  // Render markers in ruler
  const renderMarkers = useCallback(() => {
    return markers.map((marker) => {
      const x = timeToPixels(marker.time, pixelsPerSecond);
      return (
        <div
          key={marker.id}
          className={styles.markerFlag}
          style={{ left: x, '--marker-color': marker.color } as React.CSSProperties}
          title={`${marker.label} (${formatTime(marker.time)}) - Double-click to remove`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            removeMarker(marker.id);
          }}
        >
          <div className={styles.markerFlagHead} />
        </div>
      );
    });
  }, [markers, pixelsPerSecond, removeMarker]);

  // Render marker lines in track area
  const renderMarkerLines = useCallback(() => {
    return markers.map((marker) => {
      const x = timeToPixels(marker.time, pixelsPerSecond);
      return (
        <div
          key={marker.id}
          className={styles.markerLine}
          style={{ left: x, '--marker-color': marker.color } as React.CSSProperties}
        />
      );
    });
  }, [markers, pixelsPerSecond]);

  // Handle ruler click to seek
  const handleRulerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!rulerRef.current) return;

      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + rulerRef.current.scrollLeft;
      const time = pixelsToTime(x, pixelsPerSecond);
      const clampedTime = Math.max(0, Math.min(time, timelineDuration || minTimelineDuration));
      setCurrentTime(clampedTime);
    },
    [pixelsPerSecond, timelineDuration, minTimelineDuration, setCurrentTime]
  );

  // Handle click on track to seek and deselect
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (!trackContainerRef.current || isDraggingPlayhead || dragState) return;

      // Only deselect if clicking directly on the track container, not on a clip or playhead
      const target = e.target as HTMLElement;
      const isClickOnClip = target.closest('[data-clip-id]');
      const isClickOnPlayhead = target.closest('[data-playhead]');

      // Don't seek or deselect when clicking playhead
      if (isClickOnPlayhead) return;

      const rect = trackContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + trackContainerRef.current.scrollLeft;
      const time = pixelsToTime(x, pixelsPerSecond);
      const clampedTime = Math.max(0, Math.min(time, timelineDuration));
      setCurrentTime(clampedTime);

      // Deselect clip only when clicking on empty track space
      if (!isClickOnClip) {
        setSelectedClipId(null);
      }
    },
    [pixelsPerSecond, timelineDuration, setCurrentTime, setSelectedClipId, isDraggingPlayhead, dragState]
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
      const x = e.clientX - rect.left + trackContainerRef.current.scrollLeft;
      const time = pixelsToTime(x, pixelsPerSecond);
      const clampedTime = Math.max(0, Math.min(time, timelineDuration));
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

  // Sync ruler scroll (horizontal) and track headers scroll (vertical) with track container scroll
  const handleTrackScroll = useCallback(() => {
    if (trackContainerRef.current) {
      // Sync horizontal scroll with ruler
      if (rulerRef.current) {
        rulerRef.current.scrollLeft = trackContainerRef.current.scrollLeft;
      }
      // Sync vertical scroll with track headers
      if (trackHeadersRef.current) {
        trackHeadersRef.current.scrollTop = trackContainerRef.current.scrollTop;
      }
      // Update virtualization with new scroll position
      onVirtualScroll(trackContainerRef.current.scrollLeft);
    }
  }, [onVirtualScroll]);

  // Sync track container scroll when track headers are scrolled
  const handleHeadersScroll = useCallback(() => {
    if (trackHeadersRef.current && trackContainerRef.current) {
      trackContainerRef.current.scrollTop = trackHeadersRef.current.scrollTop;
    }
  }, []);

  // Track container width for virtualization
  useEffect(() => {
    const container = trackContainerRef.current;
    if (!container) return;

    // Set initial width
    setContainerWidth(container.clientWidth);

    // Observe resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [setContainerWidth]);

  // Handle razor tool click on clip
  const handleRazorClick = useCallback(
    (e: React.MouseEvent, clip: Clip) => {
      if (!trackContainerRef.current) return;

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || track.locked) return;

      const containerRect = trackContainerRef.current.getBoundingClientRect();
      const scrollLeft = trackContainerRef.current.scrollLeft;
      const x = e.clientX - containerRect.left + scrollLeft;
      const clickTime = pixelsToTime(x, pixelsPerSecond);

      // Only split if click is within the clip bounds (not on edges)
      const clipStart = clip.timelinePosition;
      const clipEnd = clip.timelinePosition + clip.duration;
      const minSplitDistance = 0.1; // Minimum 100ms from edges

      if (clickTime > clipStart + minSplitDistance && clickTime < clipEnd - minSplitDistance) {
        // Convert absolute timeline position to relative position within clip
        const splitTimeRelative = clickTime - clip.timelinePosition;
        splitClip(clip.id, splitTimeRelative);
      }
    },
    [tracks, pixelsPerSecond, splitClip]
  );

  // Handle clip drag start
  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, clip: Clip) => {
      e.stopPropagation();

      // Handle razor tool
      if (activeTool === 'razor') {
        handleRazorClick(e, clip);
        return;
      }

      setSelectedClipId(clip.id);

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || track.locked) return;

      const clipElement = e.currentTarget as HTMLElement;
      const clipRect = clipElement.getBoundingClientRect();
      const offsetX = e.clientX - clipRect.left;

      setDragState({
        clipId: clip.id,
        originalTrackId: clip.trackId,
        originalPosition: clip.timelinePosition,
        currentTrackId: clip.trackId,
        currentPosition: clip.timelinePosition,
        snappedPosition: null,
        offsetX,
      });
    },
    [tracks, setSelectedClipId, activeTool, handleRazorClick]
  );

  // Handle drag movement
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;

      const containerRect = trackContainerRef.current.getBoundingClientRect();
      const scrollLeft = trackContainerRef.current.scrollLeft;

      // Calculate new timeline position
      const x = e.clientX - containerRect.left + scrollLeft - dragState.offsetX;
      let newPosition = pixelsToTime(x, pixelsPerSecond);
      newPosition = Math.max(0, newPosition);

      // Apply snapping if enabled
      let snappedPosition: number | null = null;
      if (snapEnabled) {
        const snapPoints = getSnapPoints(clips, dragState.clipId);
        const threshold = pixelsToTime(snapThreshold, pixelsPerSecond);
        const clip = clips.find(c => c.id === dragState.clipId);

        if (clip) {
          // Check clip start snap
          const startSnap = findNearestSnapPoint(newPosition, snapPoints, threshold);
          // Check clip end snap
          const endSnap = findNearestSnapPoint(newPosition + clip.duration, snapPoints, threshold);

          if (startSnap !== null) {
            snappedPosition = startSnap;
            newPosition = startSnap;
          } else if (endSnap !== null) {
            snappedPosition = endSnap;
            newPosition = endSnap - clip.duration;
          }
        }
      }

      // Determine target track based on mouse Y position
      const trackElements = trackContainerRef.current.querySelectorAll('[data-track-id]');
      let targetTrackId = dragState.currentTrackId;

      trackElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY < rect.bottom) {
          targetTrackId = el.getAttribute('data-track-id') || targetTrackId;
        }
      });

      setDragState(prev => prev ? {
        ...prev,
        currentTrackId: targetTrackId,
        currentPosition: newPosition,
        snappedPosition,
      } : null);
    };

    const handleMouseUp = () => {
      if (dragState) {
        const clip = clips.find(c => c.id === dragState.clipId);
        if (clip) {
          // Check for overlaps before committing
          const overlap = wouldOverlap(
            clips,
            dragState.currentTrackId,
            dragState.currentPosition,
            clip.duration,
            dragState.clipId
          );

          if (!overlap) {
            // Commit the move
            if (dragState.currentTrackId !== dragState.originalTrackId) {
              moveClipToTrack(dragState.clipId, dragState.currentTrackId);
            }
            if (dragState.currentPosition !== dragState.originalPosition) {
              setClipTimelinePosition(dragState.clipId, dragState.currentPosition);
            }
          }
        }
      }
      setDragState(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, clips, snapEnabled, snapThreshold, pixelsPerSecond, moveClipToTrack, setClipTimelinePosition]);

  // Handle trim edge mouse down
  const handleTrimMouseDown = useCallback(
    (e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') => {
      e.stopPropagation();
      e.preventDefault();

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || track.locked) return;

      setSelectedClipId(clip.id);
      setTrimState({
        clipId: clip.id,
        edge,
        originalStartTime: clip.startTime,
        originalEndTime: clip.endTime,
        originalTimelinePosition: clip.timelinePosition,
      });
    },
    [tracks, setSelectedClipId]
  );

  // Handle trim drag
  useEffect(() => {
    if (!trimState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;

      const clip = clips.find(c => c.id === trimState.clipId);
      if (!clip) return;

      const sourceVideo = sourceVideos.find(v => v.id === clip.sourceVideoId);

      const containerRect = trackContainerRef.current.getBoundingClientRect();
      const scrollLeft = trackContainerRef.current.scrollLeft;
      const mouseX = e.clientX - containerRect.left + scrollLeft;
      const mouseTime = pixelsToTime(mouseX, pixelsPerSecond);

      const minClipDuration = 0.1; // Minimum 100ms clip

      // Check if this is an overlay or image clip (no fixed source duration)
      const isOverlay = clip.overlayType === 'text' || clip.overlayType === 'shape';
      const isImage = sourceVideo?.mediaType === 'image';
      const isExtendable = isOverlay || isImage;

      if (trimState.edge === 'start') {
        if (isExtendable) {
          // For overlays/images: adjust timeline position and duration
          let newTimelinePosition = mouseTime;
          newTimelinePosition = Math.max(0, newTimelinePosition);

          // Calculate new duration
          const originalEnd = trimState.originalTimelinePosition + trimState.originalEndTime - trimState.originalStartTime;
          const newDuration = originalEnd - newTimelinePosition;

          if (newDuration >= minClipDuration) {
            updateClip(trimState.clipId, {
              timelinePosition: newTimelinePosition,
              duration: newDuration,
              endTime: newDuration,
            });
          }
        } else if (sourceVideo) {
          // For video/audio: trim start point within source
          const deltaFromOriginalStart = mouseTime - trimState.originalTimelinePosition;
          let newStartTime = trimState.originalStartTime + deltaFromOriginalStart;
          newStartTime = Math.max(0, Math.min(newStartTime, trimState.originalEndTime - minClipDuration));

          const newTimelinePosition = trimState.originalTimelinePosition + (newStartTime - trimState.originalStartTime);

          updateClip(trimState.clipId, {
            startTime: newStartTime,
            timelinePosition: Math.max(0, newTimelinePosition),
          });
        }
      } else {
        // Trimming from the end
        if (isExtendable) {
          // For overlays/images: just adjust duration (no upper limit)
          const newEndTimelinePosition = mouseTime;
          const newDuration = newEndTimelinePosition - clip.timelinePosition;

          if (newDuration >= minClipDuration) {
            updateClip(trimState.clipId, {
              duration: newDuration,
              endTime: newDuration,
            });
          }
        } else if (sourceVideo) {
          // For video/audio: trim end point within source
          const newEndTimelinePosition = mouseTime;
          const clipPlaybackTime = newEndTimelinePosition - clip.timelinePosition;
          let newEndTime = clip.startTime + clipPlaybackTime;
          newEndTime = Math.max(clip.startTime + minClipDuration, Math.min(newEndTime, sourceVideo.duration));

          updateClip(trimState.clipId, {
            endTime: newEndTime,
          });
        }
      }
    };

    const handleMouseUp = () => {
      // If ripple tool is active, shift subsequent clips
      if (activeTool === 'ripple' && trimState) {
        const clip = clips.find((c) => c.id === trimState.clipId);
        if (clip) {
          const originalEnd = trimState.originalTimelinePosition +
            (trimState.originalEndTime - trimState.originalStartTime);
          const currentEnd = clip.timelinePosition + (clip.endTime - clip.startTime);
          const delta = currentEnd - originalEnd;

          if (delta !== 0) {
            // Shift all clips after the original end position
            shiftClipsAfter(clip.trackId, originalEnd, delta);
          }
        }
      }
      setTrimState(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [trimState, clips, sourceVideos, pixelsPerSecond, updateClip, activeTool, shiftClipsAfter]);

  // Calculate playhead position
  const playheadX = timeToPixels(currentTime, pixelsPerSecond);

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

  // Handle mute toggle with volume memory
  const handleMuteToggle = useCallback((track: typeof tracks[0]) => {
    if (track.muted) {
      // Unmuting: restore last volume (or default to 1 if no lastVolume)
      const restoredVolume = track.lastVolume ?? 1;
      updateTrack(track.id, { muted: false, volume: restoredVolume });
    } else {
      // Muting: save current volume and set to 0
      updateTrack(track.id, { muted: true, lastVolume: track.volume, volume: 0 });
    }
  }, [updateTrack]);

  // Handle track name editing
  const handleTrackNameDoubleClick = useCallback((track: typeof tracks[0]) => {
    setEditingTrackId(track.id);
    setEditingTrackName(track.name);
  }, []);

  const handleTrackNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingTrackName(e.target.value);
  }, []);

  const handleTrackNameBlur = useCallback(() => {
    if (editingTrackId && editingTrackName.trim()) {
      updateTrack(editingTrackId, { name: editingTrackName.trim() });
    }
    setEditingTrackId(null);
    setEditingTrackName('');
  }, [editingTrackId, editingTrackName, updateTrack]);

  const handleTrackNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTrackNameBlur();
    } else if (e.key === 'Escape') {
      setEditingTrackId(null);
      setEditingTrackName('');
    }
  }, [handleTrackNameBlur]);

  return (
    <div className={styles.container} ref={containerRef}>
      {/* Ruler */}
      <div className={styles.rulerRow}>
        <div className={styles.trackHeaderSpacer} />
        <div className={styles.ruler} ref={rulerRef} onClick={handleRulerClick}>
          <div className={styles.rulerContent} style={{ width: timelineWidth }}>
            {renderRuler()}
            {renderMarkers()}
          </div>
        </div>
      </div>

      {/* Tracks area */}
      <div className={styles.tracksArea}>
        {/* Track headers column */}
        <div className={styles.trackHeadersColumn}>
          {/* Scrollable track headers */}
          <div className={styles.trackHeaders} ref={trackHeadersRef} onScroll={handleHeadersScroll}>
            {sortedTracks.map((track, index) => (
              <div
                key={track.id}
                className={styles.trackHeader}
                style={{ height: track.height }}
              >
                {/* Left side: Vertical volume slider */}
                <div className={styles.trackVolumeSection}>
                  <input
                    type="range"
                    className={styles.trackVolumeSlider}
                    min="0"
                    max="1"
                    step="0.01"
                    value={track.volume ?? 1}
                    onChange={(e) => {
                      const newVolume = parseFloat(e.target.value);
                      // If adjusting volume while muted, unmute
                      if (track.muted && newVolume > 0) {
                        updateTrack(track.id, { volume: newVolume, muted: false });
                      } else {
                        updateTrack(track.id, { volume: newVolume, lastVolume: newVolume > 0 ? newVolume : track.lastVolume });
                      }
                    }}
                    title={`Volume: ${Math.round((track.volume ?? 1) * 100)}%`}
                  />
                  <button
                    className={`${styles.trackMuteBtn} ${track.muted ? styles.active : ''}`}
                    onClick={() => handleMuteToggle(track)}
                    title={track.muted ? 'Unmute' : 'Mute'}
                  >
                    {track.muted ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* Right side: Track info and controls */}
                <div className={styles.trackInfoSection}>
                  <div className={styles.trackHeaderTop}>
                    {editingTrackId === track.id ? (
                      <input
                        type="text"
                        className={styles.trackNameInput}
                        value={editingTrackName}
                        onChange={handleTrackNameChange}
                        onBlur={handleTrackNameBlur}
                        onKeyDown={handleTrackNameKeyDown}
                        autoFocus
                      />
                    ) : (
                      <span
                        className={styles.trackName}
                        onDoubleClick={() => handleTrackNameDoubleClick(track)}
                        title="Double-click to rename"
                      >
                        {track.name}
                      </span>
                    )}
                    <div className={styles.trackReorderBtns}>
                      <button
                        className={styles.trackMoveBtn}
                        onClick={() => moveTrackUp(track.id)}
                        disabled={index === 0}
                        title="Move track up"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 4L4 14h16L12 4z" />
                        </svg>
                      </button>
                      <button
                        className={styles.trackMoveBtn}
                        onClick={() => moveTrackDown(track.id)}
                        disabled={index === sortedTracks.length - 1}
                        title="Move track down"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 20l8-10H4l8 10z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className={styles.trackControls}>
                    <button
                      className={`${styles.trackControlBtn} ${!track.visible ? styles.active : ''}`}
                      onClick={() => updateTrack(track.id, { visible: !track.visible })}
                      title={track.visible ? 'Hide track' : 'Show track'}
                    >
                      {track.visible ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      )}
                    </button>
                    <button
                      className={`${styles.trackControlBtn} ${track.locked ? styles.active : ''}`}
                      onClick={() => updateTrack(track.id, { locked: !track.locked })}
                      title={track.locked ? 'Unlock track' : 'Lock track'}
                    >
                      {track.locked ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                        </svg>
                      )}
                    </button>
                    <button
                      className={`${styles.trackControlBtn} ${styles.trackDeleteBtn}`}
                      onClick={() => handleDeleteTrack(track.id)}
                      disabled={tracks.length <= 1}
                      title="Delete track"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Track content */}
        <div
          className={`${styles.trackContainer} ${activeTool === 'razor' ? styles.razorCursor : ''} ${activeTool === 'ripple' ? styles.rippleCursor : ''}`}
          ref={trackContainerRef}
          onClick={handleTrackClick}
          onScroll={handleTrackScroll}
        >
          <div className={styles.tracksContent} style={{ width: timelineWidth }}>
            {sortedTracks.map((track) => (
              <div
                key={track.id}
                className={`${styles.track} ${!track.visible ? styles.trackHidden : ''} ${track.locked ? styles.trackLocked : ''}`}
                style={{ height: track.height }}
                data-track-id={track.id}
              >
                {/* Clips on this track */}
                {getTrackClips(track.id).map((clip) => {
                  const isDragging = dragState?.clipId === clip.id;
                  const displayPosition = isDragging ? dragState.currentPosition : clip.timelinePosition;
                  const displayTrackId = isDragging ? dragState.currentTrackId : clip.trackId;

                  // Only render if on this track (or being dragged to this track)
                  if (displayTrackId !== track.id && !isDragging) return null;
                  if (isDragging && displayTrackId !== track.id) return null;

                  const clipX = timeToPixels(displayPosition, pixelsPerSecond);
                  const clipWidth = timeToPixels(clip.duration, pixelsPerSecond);
                  const isSelected = clip.id === selectedClipId;

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
                      className={`${styles.clip} ${isSelected ? styles.clipSelected : ''} ${isDragging ? styles.clipDragging : ''} ${isTrimming ? styles.clipTrimming : ''} ${isAudioClip ? styles.clipAudio : ''} ${isImageClip ? styles.clipImage : ''} ${isTextOverlay ? styles.clipText : ''} ${isShapeOverlay ? styles.clipShape : ''}`}
                      style={{
                        left: clipX,
                        width: clipWidth,
                      }}
                      onMouseDown={(e) => handleClipMouseDown(e, clip)}
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
                        />
                      )}
                      {/* Left trim handle */}
                      <div
                        className={styles.trimHandle}
                        style={{ left: 0 }}
                        onMouseDown={(e) => handleTrimMouseDown(e, clip, 'start')}
                      />
                      {/* Right trim handle */}
                      <div
                        className={styles.trimHandle}
                        style={{ right: 0 }}
                        onMouseDown={(e) => handleTrimMouseDown(e, clip, 'end')}
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
                        clips.find(c => c.id === dragState.clipId)?.duration || 0,
                        pixelsPerSecond
                      ),
                    }}
                  />
                )}
              </div>
            ))}

            {/* Marker lines */}
            {renderMarkerLines()}

            {/* Snap indicator */}
            {dragState && dragState.snappedPosition !== null && (
              <div
                className={styles.snapLine}
                style={{ left: timeToPixels(dragState.snappedPosition, pixelsPerSecond) }}
              />
            )}

            {/* Playhead */}
            <div
              data-playhead
              className={styles.playhead}
              style={{ left: playheadX, height: totalTracksHeight }}
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className={styles.playheadHead} />
              <div className={styles.playheadLine} />
            </div>
          </div>
        </div>
      </div>

      {/* Timeline info */}
      <div className={styles.info}>
        <span>{formatTime(currentTime)} / {formatTime(timelineDuration)}</span>
        <span>{clips.length} clip{clips.length !== 1 ? 's' : ''} · {tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
