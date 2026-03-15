// Core data types for the video editor

// Shared types - imported from shared package
import type {
  MediaType,
  MediaSource,
  WaveformPeak,
  SourceVideo,
} from '@escapesuite/shared/types'

// Re-export shared types
export type { MediaType, MediaSource, WaveformPeak, SourceVideo }

// Default duration for images when added to timeline (seconds)
export const DEFAULT_IMAGE_DURATION = 5;

// Resolution presets for project canvas dimensions
export const RESOLUTION_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4K': { width: 3840, height: 2160 },
} as const;

// Blend modes for video compositing
export type BlendMode =
  | 'normal'      // Default - top layer covers bottom
  | 'multiply'    // Darkens
  | 'screen'      // Lightens
  | 'overlay'     // Combines multiply and screen
  | 'darken'      // Takes minimum
  | 'lighten'     // Takes maximum
  | 'difference'  // Absolute difference
  | 'add';        // Additive blending

// Transform properties for PiP positioning
export interface ClipTransform {
  x: number;        // Horizontal position (0-1, where 0.5 = center)
  y: number;        // Vertical position (0-1, where 0.5 = center)
  scaleX: number;   // Horizontal scale (1 = 100%)
  scaleY: number;   // Vertical scale (1 = 100%)
  rotation: number; // Rotation in degrees (future use)
  opacity: number;  // 0-1
  scaleLocked?: boolean;  // Lock aspect ratio during resize (default: true)
}

// Default transform (full frame, centered)
export const DEFAULT_TRANSFORM: ClipTransform = {
  x: 0.5,
  y: 0.5,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  scaleLocked: true,
};

// Visual effects for clips
export interface ClipEffects {
  blur: number; // Blur amount in pixels (0 = no blur, up to ~50px)
}

// Default effects (no effects applied)
export const DEFAULT_EFFECTS: ClipEffects = {
  blur: 0,
};

// ============================================
// KEYFRAME ANIMATION SYSTEM
// ============================================

// Easing functions for interpolation
export type EasingType =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-quad'
  | 'ease-out-quad'
  | 'ease-in-out-quad'
  | 'ease-in-cubic'
  | 'ease-out-cubic'
  | 'ease-in-out-cubic';

// A single keyframe for a numeric property
export interface Keyframe {
  time: number;         // Time relative to clip start (seconds)
  value: number;        // The value at this keyframe
  easing: EasingType;   // Easing to use when interpolating TO the next keyframe
}

// Animatable properties - these can have keyframes
export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'blur'
  | 'volume';  // Audio volume (0-1)

// Animation preset types for quick setup
export type AnimationPresetType =
  | 'none'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'scale'
  | 'scale-up'
  | 'scale-down'
  | 'pop'
  | 'blur';

// Animation configuration for a clip
export interface ClipAnimation {
  // Preset-based animations (Phase 1)
  in: {
    type: AnimationPresetType;
    duration: number;     // seconds
    easing: EasingType;
  };
  out: {
    type: AnimationPresetType;
    duration: number;     // seconds
    easing: EasingType;
  };
  // Custom keyframes (Phase 2) - keyed by property name
  // If keyframes exist for a property, they override presets
  keyframes: {
    [K in AnimatableProperty]?: Keyframe[];
  };
}

// Default animation (no animation)
export const DEFAULT_ANIMATION: ClipAnimation = {
  in: {
    type: 'none',
    duration: 0.5,
    easing: 'ease-out',
  },
  out: {
    type: 'none',
    duration: 0.5,
    easing: 'ease-in',
  },
  keyframes: {},
};

// Text overlay types
export type TextAlign = 'left' | 'center' | 'right';

// Text overlay data (stored in clip.textData for text overlay clips)
export interface TextOverlayData {
  text: string;
  // Position (0-1 normalized)
  x: number;
  y: number;
  // Styling
  fontFamily: string;
  fontSize: number;         // in pixels
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;            // hex color
  backgroundColor: string;  // hex color with alpha, e.g. #00000080
  textAlign: TextAlign;
  // Transform
  rotation?: number;        // degrees
  scale?: number;           // multiplier (1 = 100%)
}

// Default text overlay data
export const DEFAULT_TEXT_OVERLAY_DATA: TextOverlayData = {
  text: 'Text',
  x: 0.5,
  y: 0.5,
  fontFamily: 'Arial',
  fontSize: 48,
  fontWeight: 'normal',
  fontStyle: 'normal',
  color: '#ffffff',
  backgroundColor: '#00000000',
  textAlign: 'center',
  rotation: 0,
  scale: 1,
};

// Shape overlay types
export type ShapeType = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'blur';

// Shape overlay data (stored in clip.shapeData for shape overlay clips)
export interface ShapeOverlayData {
  type: ShapeType;
  // Position (0-1 normalized)
  x: number;
  y: number;
  // Size (0-1 normalized)
  width: number;
  height: number;
  // Styling
  fillColor: string;        // hex color with alpha
  strokeColor: string;      // hex color
  strokeWidth: number;      // in pixels
  rotation: number;         // degrees
  // Blur effect (blurs the region underneath the shape)
  blurAmount?: number;      // blur radius in pixels (0 = no blur)
}

// Default shape overlay data
export const DEFAULT_SHAPE_OVERLAY_DATA: ShapeOverlayData = {
  type: 'rectangle',
  x: 0.5,
  y: 0.5,
  width: 0.2,
  height: 0.2,
  fillColor: '#000000ff',
  strokeColor: '#ffffff',
  strokeWidth: 0,
  rotation: 0,
  blurAmount: 0,
};

// Legacy types for backwards compatibility during migration
export interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  backgroundColor: string;
  textAlign: TextAlign;
  startTime: number;
  endTime: number;
  opacity: number;
}

export interface ShapeOverlay {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  startTime: number;
  endTime: number;
  opacity: number;
  rotation: number;
}

// Overlay clip type - distinguishes overlay clips from media clips
export type OverlayType = 'text' | 'shape';

// Transition types
export type TransitionType =
  | 'none'
  | 'fade'           // Crossfade between clips
  | 'dissolve'       // Same as fade but with slight blur
  | 'wipe-left'      // Wipe from right to left
  | 'wipe-right'     // Wipe from left to right
  | 'wipe-up'        // Wipe from bottom to top
  | 'wipe-down'      // Wipe from top to bottom
  | 'slide-left'     // Slide out to left, slide in from right
  | 'slide-right'    // Slide out to right, slide in from left
  | 'slide-up'       // Slide out to top, slide in from bottom
  | 'slide-down';    // Slide out to bottom, slide in from top

export interface Transition {
  type: TransitionType;
  duration: number;   // Duration in seconds (typically 0.5 - 2.0)
}

// Default transition
export const DEFAULT_TRANSITION: Transition = {
  type: 'none',
  duration: 0.5,
};

// Individual track definition
export interface Track {
  id: string;
  name: string;
  index: number;    // Z-order: higher = rendered on top
  visible: boolean; // Can hide tracks
  locked: boolean;  // Prevent edits
  muted: boolean;   // Mute audio from this track
  volume: number;   // Audio volume level (0-1, where 1 = 100%)
  lastVolume?: number; // Remembered volume level when muted (for restoring on unmute)
  height: number;   // UI height in pixels
}

export interface Clip {
  id: string;
  sourceVideoId: string;    // Empty string for overlay clips
  name: string;
  startTime: number;        // Trim start point in source video (seconds), 0 for overlays
  endTime: number;          // Trim end point in source video (seconds), same as duration for overlays
  duration: number;         // Calculated: endTime - startTime

  // Multi-track positioning
  trackId: string;          // Which track this clip is on
  timelinePosition: number; // Absolute position on timeline (seconds)

  // Compositing
  blendMode: BlendMode;
  transform: ClipTransform;
  effects: ClipEffects;

  // Animation (keyframes and presets)
  animation?: ClipAnimation;

  // Transition (applied at the end of this clip, transitioning to the next)
  transition: Transition;

  // Overlay-specific fields (only set for overlay clips)
  overlayType?: OverlayType;      // 'text' | 'shape' - undefined for media clips
  textData?: TextOverlayData;     // Text overlay content and styling
  shapeData?: ShapeOverlayData;   // Shape overlay content and styling
}

export interface Timeline {
  tracks: Track[];
  clips: Clip[];
  textOverlays: TextOverlay[];
  shapeOverlays: ShapeOverlay[];
  duration: number;         // Max of (clip.timelinePosition + clip.duration)
}

export interface Project {
  id: string;
  name: string;
  created: number;
  modified: number;
  resolution: { width: number; height: number };
  timeline: Timeline;
}

// Undoable state (things that can be undone)
export interface UndoableState {
  project: Project;
  sourceVideos: SourceVideo[];
}

// Keyframe panel UI state
export interface KeyframePanelState {
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  selectedProperty: AnimatableProperty | null;
  graphZoom: number;  // 1 = 100%, 2 = 200%, etc.
}

export const DEFAULT_KEYFRAME_PANEL_STATE: KeyframePanelState = {
  isOpen: false,
  position: { x: 100, y: 100 },
  size: { width: 700, height: 520 },
  selectedProperty: null,
  graphZoom: 1,
};

// Tool types for timeline editing
export type ToolType = 'select' | 'razor' | 'ripple';

// Marker for timeline
export interface Marker {
  id: string;
  time: number;        // Position in seconds
  label: string;       // Optional label
  color: string;       // Marker color (hex)
}

// Store state types
export interface EditorState {
  // Project
  project: Project;

  // Source videos library
  sourceVideos: SourceVideo[];

  // Playback state
  currentTime: number;
  isPlaying: boolean;

  // Selection state
  selectedClipId: string | null;
  selectedClipIds: Set<string>;        // Multi-select set
  selectedTrackId: string | null;
  selectedOverlayId: string | null;
  selectedOverlayType: 'text' | 'shape' | null;

  // Clipboard (for copy/paste)
  clipboard: Clip[] | null;

  // In/Out points for section selection
  inPoint: number | null;
  outPoint: number | null;

  // UI state
  zoom: number;
  snapEnabled: boolean;
  snapThreshold: number; // in pixels
  activeTool: ToolType;
  loopPlayback: boolean;
  markers: Marker[];

  // Keyframe panel state
  keyframePanelState: KeyframePanelState;

  // Undo/Redo history
  history: {
    past: UndoableState[];
    future: UndoableState[];
  };

  // Actions - Project
  setProject: (project: Project) => void;
  resetProject: () => void;
  setProjectResolution: (width: number, height: number) => void;

  // Actions - Source videos
  addSourceVideo: (video: SourceVideo) => void;
  removeSourceVideo: (id: string) => void;

  // Actions - Tracks
  addTrack: (name?: string) => Track;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  reorderTracks: (trackIds: string[]) => void;

  // Actions - Clips
  addClipToTimeline: (clip: Omit<Clip, 'trackId' | 'timelinePosition' | 'blendMode' | 'transform' | 'effects' | 'transition'>, trackId?: string, position?: number) => void;
  removeClipFromTimeline: (clipId: string) => void;
  rippleDeleteClip: (clipId: string) => void;
  shiftClipsAfter: (trackId: string | undefined, afterTime: number, delta: number) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  moveClipToTrack: (clipId: string, trackId: string) => void;
  setClipTimelinePosition: (clipId: string, position: number) => void;
  updateClipTransform: (clipId: string, transform: Partial<ClipTransform>, skipHistory?: boolean) => void;
  updateClipBlendMode: (clipId: string, blendMode: BlendMode) => void;
  updateClipEffects: (clipId: string, effects: Partial<ClipEffects>) => void;
  updateClipTransition: (clipId: string, transition: Partial<Transition>) => void;
  updateClipAnimation: (clipId: string, animation: Partial<ClipAnimation>) => void;
  setClipKeyframe: (clipId: string, property: AnimatableProperty, keyframe: Keyframe) => void;
  removeClipKeyframe: (clipId: string, property: AnimatableProperty, time: number) => void;
  moveClipKeyframe: (clipId: string, property: AnimatableProperty, originalTime: number, newTime: number) => void;
  clearClipKeyframes: (clipId: string, property?: AnimatableProperty) => void;
  duplicateClip: (clipId: string) => void;

  // Actions - Overlay Clips
  addTextOverlayClip: (textData?: Partial<TextOverlayData>, trackId?: string, position?: number, duration?: number) => Clip;
  addShapeOverlayClip: (shapeData?: Partial<ShapeOverlayData>, trackId?: string, position?: number, duration?: number) => Clip;
  updateTextOverlayData: (clipId: string, textData: Partial<TextOverlayData>, skipHistory?: boolean) => void;
  updateShapeOverlayData: (clipId: string, shapeData: Partial<ShapeOverlayData>, skipHistory?: boolean) => void;

  // Legacy overlay actions (for backwards compatibility)
  addTextOverlay: (overlay?: Partial<TextOverlay>) => TextOverlay;
  updateTextOverlay: (id: string, updates: Partial<TextOverlay>) => void;
  removeTextOverlay: (id: string) => void;
  addShapeOverlay: (overlay?: Partial<ShapeOverlay>) => ShapeOverlay;
  updateShapeOverlay: (id: string, updates: Partial<ShapeOverlay>) => void;
  removeShapeOverlay: (id: string) => void;

  // Actions - Playback
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;

  // Actions - Selection
  setSelectedClipId: (id: string | null) => void;
  setSelectedTrackId: (id: string | null) => void;
  setSelectedOverlay: (id: string | null, type: 'text' | 'shape' | null) => void;

  // Actions - Multi-Select
  toggleClipSelection: (clipId: string) => void;
  selectClipsInRange: (clipIds: string[]) => void;
  clearMultiSelection: () => void;
  moveSelectedClips: (deltaTime: number, deltaTrack: number) => void;
  deleteSelectedClips: () => void;
  copySelectedClips: () => void;
  pasteClips: () => void;
  muteSelectedClips: () => void;
  unmuteSelectedClips: () => void;

  // Actions - In/Out Points
  setInPoint: (time: number) => void;
  setOutPoint: (time: number) => void;
  clearInOutPoints: () => void;

  // Actions - UI
  setZoom: (zoom: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setActiveTool: (tool: ToolType) => void;
  setLoopPlayback: (enabled: boolean) => void;
  recalculateTimelineDuration: () => void;

  // Actions - Markers
  addMarker: (time: number, label?: string, color?: string) => Marker;
  removeMarker: (markerId: string) => void;
  updateMarker: (markerId: string, updates: Partial<Marker>) => void;
  clearMarkers: () => void;
  goToNextMarker: () => void;
  goToPreviousMarker: () => void;

  // Actions - Keyframe Panel
  setKeyframePanelOpen: (open: boolean) => void;
  setKeyframePanelPosition: (position: { x: number; y: number }) => void;
  setKeyframePanelSize: (size: { width: number; height: number }) => void;
  setKeyframePanelSelectedProperty: (property: AnimatableProperty | null) => void;
  setKeyframePanelZoom: (zoom: number) => void;

  // Actions - Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

// Export options
export interface ExportOptions {
  format: 'webm' | 'mp4';
  quality: 'low' | 'medium' | 'high';
  resolution: 'project' | 'original' | '1080p' | '720p' | '480p';
  timeRange?: { start: number; end: number };
}

export interface ExportProgress {
  phase: 'preparing' | 'encoding' | 'muxing' | 'complete' | 'error';
  progress: number;       // 0-100
  message: string;
}

// Integration API types
export type IntegrationMessageType =
  | 'LOAD_VIDEO'
  | 'LOAD_PROJECT'
  | 'EXPORT_COMPLETE'
  | 'PROJECT_SAVED'
  | 'READY'
  | 'VIDEO_LOADED'
  | 'ERROR'
  | 'GET_STATE'
  | 'STATE'
  | 'EXPORT'
  | 'EXPORT_PROGRESS'
  | 'SET_THEME'
  | 'GET_THEME'
  | 'THEME_CHANGED'
  | 'THEME_STATE';

export interface IntegrationMessage {
  type: IntegrationMessageType;
  payload?: unknown;
}
