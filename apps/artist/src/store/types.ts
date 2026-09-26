// Core data types for the video editor

// Shared types - imported from shared package
import type {
  MediaType,
  MediaSource,
  WaveformPeak,
  SourceVideo,
  RecordingRole,
  OverlayPlacement,
} from '@escapesuite/shared/types'

// Re-export shared types
export type { MediaType, MediaSource, WaveformPeak, SourceVideo, RecordingRole, OverlayPlacement }

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

// Legacy overlay types, kept so an older project file can still be read.
//
// INPUT ONLY — write-never, read-once. Apart from `ensureTimelineHasTracks`
// normalising a missing array to `[]` first, `store/legacyOverlays.ts` is the only
// code that touches either array: `convertLegacyOverlays` turns them into ordinary
// overlay clips and empties them on every load path (`ensureTimelineHasTracks`, so
// every `setProject` caller) and in the headless render entry. Nothing in the app
// creates, renders, edits or selects a legacy overlay, and no loaded project still
// carries one — these types survive solely so an old file on disk still parses.
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

/** Input only — see `TextOverlay` above: converted to overlay clips and emptied on load. */
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

  // Mask and stroke (ESCSUITE-65). Static — never keyframed, never animated.
  // Media clips only: text and shape overlays have no drawn box either could
  // mean anything against. Absent means none for both.
  mask?: ClipMask;
  stroke?: ClipStroke;
}

/**
 * Which shape a media clip's picture is masked to (ESCSUITE-65).
 *
 * `'none'` exists so the inspector's `<select>` has a value for "no mask"; it is
 * never *stored* — `clip.mask === undefined` is how a clip says it has none, so
 * a clip that was never masked and one whose mask was removed are the same
 * object. `CLIP_MASK_KINDS` in `components/ClipEditor/clipEditorOptions.ts` is
 * the table the dropdown is built from, in the order the user sees.
 */
export type ClipMaskKind = 'none' | 'circle' | 'rounded';

/**
 * A media clip's mask: **static, and deliberately not keyframeable** (decision 4).
 *
 * Not a member of `ClipTransform`, because every field there is a number fed
 * through `getAnimatedValues` and every one of them is an `AnimatableProperty` —
 * an enum in there would put a non-interpolable value inside the interpolator
 * and force a `DEFAULT_TRANSFORM` change that every fixture and the migration in
 * `projectMigration.ts` reads. `kind` cannot be interpolated at all, so a
 * keyframed radius with a static kind would be a half-feature.
 */
export interface ClipMask {
  kind: ClipMaskKind;
  /**
   * Corner radius as a **fraction of the clip's shorter drawn side**, 0 to 0.5,
   * and read for `'rounded'` only (decision 2).
   *
   * A fraction rather than a pixel count for the same reason
   * `OVERLAY_MARGIN_FRACTION` is one (`utils/overlayPlacement.ts`): ARTIST has a
   * resolution-change dialog, and a pixel count would silently change the
   * rounding the moment the project resolution moved. 0.5 is a stadium; anything
   * above it is clamped to it by `core/clipMask.ts`.
   */
  radius?: number;
}

/**
 * A media clip's outline: the mask's own edge, or the picture's rectangle when
 * there is no mask (decision 6).
 *
 * The words are `ShapeOverlayData`'s (`strokeColor` / `strokeWidth`, defaulting
 * to `'#ffffff'` / `0`) so the two vocabularies read alike, but this is its own
 * object on the clip: a shape overlay's stroke belongs to its drawn shape, a
 * media clip's belongs to its mask.
 */
export interface ClipStroke {
  /** Any CSS colour string, stored as given — including the `rgba()` ESCAPECRAFT hands over. */
  color: string;
  /**
   * Line width as a **fraction of the frame width**, resolved against the
   * canvas at draw time. ESCAPECRAFT's border is 3 px *of a 1280-wide canvas*,
   * and a pixel count would change meaning at another resolution. 0 is no
   * stroke, but the inspector writes `undefined` rather than `{ width: 0 }`.
   */
  width: number;
}

/** The corner radius a mask starts at when the user first picks "Rounded Rectangle". */
export const DEFAULT_CLIP_MASK_RADIUS = 0.05;

/**
 * The colour a stroke starts at, and what an `<input type="color">` shows for a
 * stored colour it cannot represent — `ShapeOverlayData`'s own stroke default.
 */
export const DEFAULT_CLIP_STROKE_COLOR = '#ffffff';

/**
 * One part of a handed-over take, ready to be placed on the timeline
 * (ESCSUITE-14).
 *
 * A take used to be one file. Since ESCAPECRAFT can record the webcam as its
 * own track it can be several `SourceVideo`s sharing a `takeId`, and this is
 * what the host handoff reduces each of them to before the store places it:
 * enough to build a clip, and nothing about roles or storage.
 */
export interface TakeClipPart {
  /** The media library entry this clip plays. */
  sourceVideoId: string;
  /** The clip's name — the part's own, so the webcam half says so. */
  name: string;
  /** The part's length in seconds, already resolved against its blob. */
  duration: number;
  /** Seconds after the take's start at which this part's first frame was captured. */
  startOffset: number;
  /** The part's own frame size, for the overlay-placement conversion. */
  width: number;
  height: number;
  /**
   * `'audio'` for a part with no picture — a take's microphone and system-audio
   * companions (ESCSUITE-14 slice 3). Absent, like `'video'`, means the part is
   * drawn.
   *
   * It is a field of its own rather than a reading of `width === 0` because two
   * decisions turn on it and neither should be inferred from a consequence
   * (ESCSUITE-71): an audio clip takes no picture transform, and the rectangle
   * the webcam corner is measured against is the take's *picture*, whatever
   * order the parts arrive in. The same three roles the rest of the handoff
   * stays clear of — this says "no picture", not which capture it came from.
   */
  mediaType?: 'video' | 'audio';
  /**
   * Where the webcam overlay sat while recording. Set on the **part it applies
   * to** — the take's webcam half — even though it is stored on the take's
   * primary, so the store needs to know nothing about roles: a part that
   * carries one is seeded from it, and every other part gets the default
   * transform.
   */
  overlayPlacement?: OverlayPlacement;
}

export interface Timeline {
  tracks: Track[];
  clips: Clip[];
  // Legacy overlays from an older ARTIST version. Input only, and read only by
  // `convertLegacyOverlays`, which turns them into overlay clips and empties them on
  // load and on headless render. Nothing writes them, so on a loaded project both
  // are always [].
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
  /**
   * Place every part of a handed-over take, in one undo step.
   *
   * The first part takes the track a drop from the media library would take;
   * each one after it gets a new track above the last, which is what puts the
   * webcam over the screen. Positions are measured from the end of whatever the
   * timeline already holds, so a handoff into a session with work in it appends
   * rather than lands on top. An empty list places nothing and records nothing.
   */
  placeTakeOnTimeline: (parts: TakeClipPart[]) => void;
  removeClipFromTimeline: (clipId: string) => void;
  rippleDeleteClip: (clipId: string) => void;
  shiftClipsAfter: (trackId: string | undefined, afterTime: number, delta: number, skipHistory?: boolean) => void;
  updateClip: (clipId: string, updates: Partial<Clip>, skipHistory?: boolean) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  moveClipToTrack: (clipId: string, trackId: string) => void;
  setClipTimelinePosition: (clipId: string, position: number, skipHistory?: boolean) => void;
  updateClipTransform: (clipId: string, transform: Partial<ClipTransform>, skipHistory?: boolean) => void;
  updateClipBlendMode: (clipId: string, blendMode: BlendMode) => void;
  updateClipEffects: (clipId: string, effects: Partial<ClipEffects>, skipHistory?: boolean) => void;
  updateClipTransition: (clipId: string, transition: Partial<Transition>, skipHistory?: boolean) => void;
  updateClipAnimation: (clipId: string, animation: Partial<ClipAnimation>, skipHistory?: boolean) => void;
  setClipKeyframe: (clipId: string, property: AnimatableProperty, keyframe: Keyframe, skipHistory?: boolean) => void;
  removeClipKeyframe: (clipId: string, property: AnimatableProperty, time: number) => void;
  moveClipKeyframe: (clipId: string, property: AnimatableProperty, originalTime: number, newTime: number, skipHistory?: boolean) => void;
  clearClipKeyframes: (clipId: string, property?: AnimatableProperty) => void;
  duplicateClip: (clipId: string) => void;

  // Actions - Overlay Clips
  addTextOverlayClip: (textData?: Partial<TextOverlayData>, trackId?: string, position?: number, duration?: number) => Clip;
  addShapeOverlayClip: (shapeData?: Partial<ShapeOverlayData>, trackId?: string, position?: number, duration?: number) => Clip;
  updateTextOverlayData: (clipId: string, textData: Partial<TextOverlayData>, skipHistory?: boolean) => void;
  updateShapeOverlayData: (clipId: string, shapeData: Partial<ShapeOverlayData>, skipHistory?: boolean) => void;

  // Actions - Playback
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;

  // Actions - Selection
  setSelectedClipId: (id: string | null) => void;
  setSelectedTrackId: (id: string | null) => void;

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
