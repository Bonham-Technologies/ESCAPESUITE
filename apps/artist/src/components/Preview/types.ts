// Shapes shared by the preview canvas modules.
//
// PreviewPlayer, the pure geometry/hit-test/selection-drawing modules beside it
// and the tests all need to name the same things, and none of them should have
// to import the component to do it.
import type { Clip, SourceVideo, Track } from '../../store/types';
import type { TransitionInfo } from '../../core/exportTypes';

// Drag modes for different transform operations
export type DragMode = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' |
                'resize-n' | 'resize-s' | 'resize-e' | 'resize-w' | 'rotate';

// Clip type for manipulation - includes overlays and media clips
export type ManipulableClipType = 'text' | 'shape' | 'image' | 'video';

/**
 * The logical canvas everything the preview computes is measured in.
 *
 * This is the project's own resolution — `project.resolution` — and it is the
 * coordinate space of every number in this directory: clip transforms, overlay
 * bounds, handle sizes, hit tests, the frame's own draw calls. It is
 * deliberately *not* the preview canvas' backing store, which follows the size
 * the element is displayed at (see `previewRaster`) and changes when the window
 * does. Scale 100% means native source pixels against this, and nothing else.
 */
export interface ProjectSize {
  width: number;
  height: number;
}

/** A clip's box on the canvas: centre and size in project pixels, rotation in degrees. */
export interface OverlayBounds {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
}

/** What a hit test found under the pointer, and the drag it would start. */
export interface HandleHit {
  clipId: string;
  clipType: ManipulableClipType;
  mode: DragMode;
}

/** A point in the canvas' own 0-1 coordinate space. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/**
 * Everything the pure preview modules read out of the editor store.
 *
 * Each function takes the minimal `Pick<>` of this that it actually needs, so
 * call sites can hand over one scene object and let TypeScript discard the
 * rest, while the signature still documents exactly what the function looks at.
 */
export interface PreviewSceneContext {
  clips: Clip[];
  tracks: Track[];
  sourceVideos: SourceVideo[];
  currentTime: number;
  selectedClipId: string | null;
  selectedClipIds: Set<string>;
  keyframePanelOpen: boolean;
  isPlaying: boolean;
  /**
   * The transition active at the instant this scene is being asked about —
   * `currentTime` for the hit test, the `time` argument for the chrome the
   * selection overlay draws — as `getActiveTransition` reports it
   * (ESCSUITE-147).
   *
   * Derived rather than read off the store, and derived by the caller: the
   * component and the gesture hook already hold `clips` and `tracks`, and
   * computing it once where the scene is assembled keeps the pure modules below
   * from each reaching a different answer. Optional, because a reader with no
   * scene (and every test that is not about a transition) has none to give: that
   * reads as "no transition here", which is what these functions always assumed.
   */
  transition?: TransitionInfo | null;
}
