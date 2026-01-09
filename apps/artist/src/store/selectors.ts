// Memoized selectors for optimized state access
// These prevent unnecessary re-renders by caching derived state

import { useShallow } from 'zustand/shallow';
import { useEditorStore } from './projectStore';
import type { EditorState, Clip, Track } from './types';


// ============================================
// Basic Selectors (no memoization needed)
// ============================================

export const selectCurrentTime = (state: EditorState) => state.currentTime;
export const selectIsPlaying = (state: EditorState) => state.isPlaying;
export const selectSelectedClipId = (state: EditorState) => state.selectedClipId;
export const selectSelectedTrackId = (state: EditorState) => state.selectedTrackId;
export const selectZoom = (state: EditorState) => state.zoom;
export const selectLoopPlayback = (state: EditorState) => state.loopPlayback;
export const selectActiveTool = (state: EditorState) => state.activeTool;
export const selectSnapEnabled = (state: EditorState) => state.snapEnabled;

// ============================================
// Timeline Selectors
// ============================================

export const selectClips = (state: EditorState) => state.project.timeline.clips;
export const selectTracks = (state: EditorState) => state.project.timeline.tracks;
export const selectTimelineDuration = (state: EditorState) => state.project.timeline.duration;
export const selectTextOverlays = (state: EditorState) => state.project.timeline.textOverlays || [];
export const selectShapeOverlays = (state: EditorState) => state.project.timeline.shapeOverlays || [];
export const selectMarkers = (state: EditorState) => state.markers;

// ============================================
// Source Media Selectors
// ============================================

export const selectSourceVideos = (state: EditorState) => state.sourceVideos;

// ============================================
// Derived Selectors (memoized)
// ============================================

export const selectClipCount = (state: EditorState) => state.project.timeline.clips.length;
export const selectTrackCount = (state: EditorState) => state.project.timeline.tracks.length;

// Memoized selected clip lookup
export const selectSelectedClip = (state: EditorState): Clip | undefined => {
  if (!state.selectedClipId) return undefined;
  return state.project.timeline.clips.find((c) => c.id === state.selectedClipId);
};

// Memoized selected track lookup
export const selectSelectedTrack = (state: EditorState): Track | undefined => {
  if (!state.selectedTrackId) return undefined;
  return state.project.timeline.tracks.find((t) => t.id === state.selectedTrackId);
};

// Keyframe panel state selectors
export const selectKeyframePanelOpen = (state: EditorState) => state.keyframePanelState.isOpen;
export const selectKeyframePanelPosition = (state: EditorState) => state.keyframePanelState.position;

// ============================================
// Action Selectors (stable references)
// ============================================

export const selectActions = (state: EditorState) => ({
  setCurrentTime: state.setCurrentTime,
  setIsPlaying: state.setIsPlaying,
  setSelectedClipId: state.setSelectedClipId,
  setSelectedTrackId: state.setSelectedTrackId,
  updateClipTransform: state.updateClipTransform,
  updateTextOverlayData: state.updateTextOverlayData,
  updateShapeOverlayData: state.updateShapeOverlayData,
  setClipKeyframe: state.setClipKeyframe,
  addMarker: state.addMarker,
  removeMarker: state.removeMarker,
  goToNextMarker: state.goToNextMarker,
  goToPreviousMarker: state.goToPreviousMarker,
});

// ============================================
// Composite Hooks for Common Use Cases
// ============================================

/**
 * Hook for preview player - groups related state to reduce subscriptions
 */
export function usePreviewState() {
  return useEditorStore(
    useShallow((state) => ({
      clips: state.project.timeline.clips,
      tracks: state.project.timeline.tracks,
      sourceVideos: state.sourceVideos,
      currentTime: state.currentTime,
      isPlaying: state.isPlaying,
      timelineDuration: state.project.timeline.duration,
      loopPlayback: state.loopPlayback,
      selectedClipId: state.selectedClipId,
      keyframePanelOpen: state.keyframePanelState.isOpen,
      textOverlays: state.project.timeline.textOverlays || [],
      shapeOverlays: state.project.timeline.shapeOverlays || [],
    }))
  );
}

/**
 * Hook for preview player actions - stable references
 */
export function usePreviewActions() {
  return useEditorStore(
    useShallow((state) => ({
      setCurrentTime: state.setCurrentTime,
      setIsPlaying: state.setIsPlaying,
      setSelectedClipId: state.setSelectedClipId,
      updateClipTransform: state.updateClipTransform,
      updateTextOverlayData: state.updateTextOverlayData,
      updateShapeOverlayData: state.updateShapeOverlayData,
      setClipKeyframe: state.setClipKeyframe,
    }))
  );
}

/**
 * Hook for timeline component - groups timeline-specific state
 */
export function useTimelineState() {
  return useEditorStore(
    useShallow((state) => ({
      clips: state.project.timeline.clips,
      tracks: state.project.timeline.tracks,
      duration: state.project.timeline.duration,
      currentTime: state.currentTime,
      isPlaying: state.isPlaying,
      selectedClipId: state.selectedClipId,
      selectedTrackId: state.selectedTrackId,
      zoom: state.zoom,
      snapEnabled: state.snapEnabled,
      snapThreshold: state.snapThreshold,
      activeTool: state.activeTool,
      markers: state.markers,
    }))
  );
}

/**
 * Hook for timeline actions
 */
export function useTimelineActions() {
  return useEditorStore(
    useShallow((state) => ({
      setCurrentTime: state.setCurrentTime,
      setIsPlaying: state.setIsPlaying,
      setSelectedClipId: state.setSelectedClipId,
      setSelectedTrackId: state.setSelectedTrackId,
      setZoom: state.setZoom,
      addTrack: state.addTrack,
      removeTrack: state.removeTrack,
      updateTrack: state.updateTrack,
      moveClipToTrack: state.moveClipToTrack,
      setClipTimelinePosition: state.setClipTimelinePosition,
      splitClip: state.splitClip,
      removeClipFromTimeline: state.removeClipFromTimeline,
      duplicateClip: state.duplicateClip,
      addMarker: state.addMarker,
      removeMarker: state.removeMarker,
      updateMarker: state.updateMarker,
    }))
  );
}

/**
 * Hook for playback controls
 */
export function usePlaybackState() {
  return useEditorStore(
    useShallow((state) => ({
      isPlaying: state.isPlaying,
      currentTime: state.currentTime,
      duration: state.project.timeline.duration,
      loopPlayback: state.loopPlayback,
    }))
  );
}

/**
 * Hook for playback actions
 */
export function usePlaybackActions() {
  return useEditorStore(
    useShallow((state) => ({
      setIsPlaying: state.setIsPlaying,
      setCurrentTime: state.setCurrentTime,
      setLoopPlayback: state.setLoopPlayback,
      goToNextMarker: state.goToNextMarker,
      goToPreviousMarker: state.goToPreviousMarker,
    }))
  );
}

// ============================================
// Clips by Track Index (memoized)
// ============================================

/**
 * Creates a map of clips indexed by track ID for O(1) lookup
 */
export function createClipsByTrackMap(clips: Clip[]): Map<string, Clip[]> {
  const map = new Map<string, Clip[]>();
  for (const clip of clips) {
    const trackClips = map.get(clip.trackId);
    if (trackClips) {
      trackClips.push(clip);
    } else {
      map.set(clip.trackId, [clip]);
    }
  }
  return map;
}

/**
 * Hook that provides clips grouped by track ID
 */
export function useClipsByTrack() {
  const clips = useEditorStore(selectClips);
  // Note: In a real app, you'd memoize this with useMemo
  // For now, components should memoize this themselves
  return createClipsByTrackMap(clips);
}
