import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import {
  useEditorStore,
  getSnapPoints,
  wouldOverlap,
} from '../../store/projectStore';
import type { Clip } from '../../store/types';
import { formatTime, timeToPixels, pixelsToTime } from '../../utils/timeUtils';
import { useVirtualizedTimeline, groupClipsByTrack } from '../../hooks';
import { ClipKeyframeDiamonds } from './ClipKeyframeDiamonds';
import { AudioWaveform } from './AudioWaveform';
import { TimelinePlayhead } from './TimelinePlayhead';
import { TimelineTimeReadout } from './TimelineTimeReadout';
import { TimelineMarkerLines, TimelineRuler } from './TimelineRuler';
import {
  clampTime,
  clipsIntersectingRange,
  computeTrimUpdate,
  exceedsMarqueeThreshold,
  getSplitOffset,
  marqueeTimeRange,
  marqueeYRange,
  pointerTime,
  snapDragPosition,
  trackSpansMarquee,
} from './timelineGeometry';
import { MarqueeSelection } from '../Preview/MarqueeSelection';
import styles from './Timeline.module.css';

const PIXELS_PER_SECOND_BASE = 50;

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

interface TimelineProps {
  onExportSelection?: (timeRange: { start: number; end: number }) => void;
}

export function Timeline({ onExportSelection }: TimelineProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [trimState, setTrimState] = useState<TrimState | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState('');
  const [tlMarqueeStart, setTlMarqueeStart] = useState<{x: number; y: number} | null>(null);
  const [tlMarqueeCurrent, setTlMarqueeCurrent] = useState<{x: number; y: number} | null>(null);
  const tlMarqueeActive = tlMarqueeStart !== null && tlMarqueeCurrent !== null;

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

  // Handle click on track to seek, pause, and deselect
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
      const clickTime = pointerTime(e.clientX, containerRect.left, scrollLeft, pixelsPerSecond);

      // Only split if click is within the clip bounds (not on edges)
      const splitTimeRelative = getSplitOffset(clickTime, clip.timelinePosition, clip.duration);

      if (splitTimeRelative !== null) {
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

      // Ctrl+click (or Cmd+click on Mac) toggles multi-selection
      if (e.ctrlKey || e.metaKey) {
        toggleClipSelection(clip.id);
        return;
      }

      // If the clip is part of a multi-selection, keep the selection for bulk drag
      // Otherwise, select just this clip
      if (!selectedClipIds.has(clip.id)) {
        setSelectedClipId(clip.id);
      }

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
    [tracks, setSelectedClipId, toggleClipSelection, selectedClipIds, activeTool, handleRazorClick]
  );

  // Handle drag movement
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;

      const containerRect = trackContainerRef.current.getBoundingClientRect();
      const scrollLeft = trackContainerRef.current.scrollLeft;

      // Calculate new timeline position
      // Kept as the original two-step expression: `pointerTime` would sum the
      // same terms in a different order, and the extraction promised identical
      // floating-point results.
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
          const snapped = snapDragPosition(newPosition, clip.duration, snapPoints, threshold);
          newPosition = snapped.position;
          snappedPosition = snapped.snappedPosition;
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
          const deltaTime = dragState.currentPosition - dragState.originalPosition;

          // Bulk drag: if dragged clip is part of multi-selection, move all selected clips
          if (selectedClipIds.has(dragState.clipId) && selectedClipIds.size > 1 && deltaTime !== 0) {
            moveSelectedClips(deltaTime, 0);
          } else {
            // Single clip move
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
              if (deltaTime !== 0) {
                setClipTimelinePosition(dragState.clipId, dragState.currentPosition);
              }
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
  }, [dragState, clips, snapEnabled, snapThreshold, pixelsPerSecond, moveClipToTrack, setClipTimelinePosition, selectedClipIds, moveSelectedClips]);

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
      const mouseTime = pointerTime(e.clientX, containerRect.left, scrollLeft, pixelsPerSecond);

      const update = computeTrimUpdate({
        edge: trimState.edge,
        mouseTime,
        clip,
        sourceVideo,
        origin: {
          startTime: trimState.originalStartTime,
          endTime: trimState.originalEndTime,
          timelinePosition: trimState.originalTimelinePosition,
        },
      });

      if (update) {
        updateClip(trimState.clipId, update);
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

  // Track whether marquee was just completed so handleTrackClick can skip deselection
  const marqueeJustFinished = useRef(false);

  // Handle mousedown on track area to start marquee selection
  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!trackContainerRef.current || isDraggingPlayhead || dragState) return;

      const target = e.target as HTMLElement;
      const isClickOnClip = target.closest('[data-clip-id]');
      const isClickOnPlayhead = target.closest('[data-playhead]');

      // Only start marquee on empty space
      if (isClickOnClip || isClickOnPlayhead) return;

      const rect = trackContainerRef.current.getBoundingClientRect();
      setTlMarqueeStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setTlMarqueeCurrent(null);
    },
    [isDraggingPlayhead, dragState]
  );

  // Marquee mousemove/mouseup via useEffect (document-level events)
  useEffect(() => {
    if (!tlMarqueeStart) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;
      const rect = trackContainerRef.current.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;
      const dx = currentX - tlMarqueeStart.x;
      const dy = currentY - tlMarqueeStart.y;
      if (exceedsMarqueeThreshold(dx, dy)) {
        setTlMarqueeCurrent({ x: currentX, y: currentY });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (tlMarqueeActive && trackContainerRef.current) {
        const current = tlMarqueeCurrent!;
        const scrollLeft = trackContainerRef.current.scrollLeft;

        // Convert marquee X pixel positions to time values
        const { startTime, endTime } = marqueeTimeRange(
          tlMarqueeStart.x,
          current.x,
          scrollLeft,
          pixelsPerSecond
        );

        // Determine which tracks the marquee spans by Y position
        const { topPx, bottomPx } = marqueeYRange(tlMarqueeStart.y, current.y);

        // Find track elements and match Y ranges
        const trackElements = trackContainerRef.current.querySelectorAll('[data-track-id]');
        const containerRect = trackContainerRef.current.getBoundingClientRect();
        const scrollTop = trackContainerRef.current.scrollTop;

        const spannedTrackIds = new Set<string>();
        trackElements.forEach((el) => {
          const elRect = el.getBoundingClientRect();
          // Convert to container-relative coordinates
          const elTop = elRect.top - containerRect.top + scrollTop;
          const elBottom = elRect.bottom - containerRect.top + scrollTop;
          // Check if track overlaps with marquee Y range
          if (trackSpansMarquee(elTop, elBottom, topPx, bottomPx)) {
            const trackId = el.getAttribute('data-track-id');
            if (trackId) spannedTrackIds.add(trackId);
          }
        });

        // Find all clips within the time range on the spanned tracks
        const intersecting = clipsIntersectingRange(clips, spannedTrackIds, startTime, endTime);

        if (e.ctrlKey || e.metaKey) {
          const existing = Array.from(selectedClipIds);
          const combined = [...new Set([...existing, ...intersecting])];
          selectClipsInRange(combined);
        } else {
          selectClipsInRange(intersecting);
        }

        marqueeJustFinished.current = true;
      } else {
        // No drag - let handleTrackClick handle the deselect + seek
      }

      setTlMarqueeStart(null);
      setTlMarqueeCurrent(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [tlMarqueeStart, tlMarqueeActive, tlMarqueeCurrent, pixelsPerSecond, clips, selectedClipIds, selectClipsInRange]);

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
                    aria-label={`${track.name} volume`}
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
          onMouseDown={handleTrackMouseDown}
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
                          isSelected={isSelected}
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
            {tlMarqueeActive && tlMarqueeStart && tlMarqueeCurrent && (
              <MarqueeSelection
                startX={tlMarqueeStart.x}
                startY={tlMarqueeStart.y}
                currentX={tlMarqueeCurrent.x}
                currentY={tlMarqueeCurrent.y}
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
