// Zoom to region's preview half (ESCSUITE-475): is the tool open, and on what.
//
// The arithmetic — the clip's picture in the frame, the box's fit, the
// keyframes — is `utils/zoomToRegion.ts`. This is the latch, read the way crop
// mode reads its own (`cropOverlay.ts`' `cropTarget`), and the mapping of a
// region in project pixels onto the canvas element's CSS pixels.
import type { Clip, SourceVideo, Track } from '../../store/types';
import { isTrackVisible } from '../../store/trackVisibility';
import type { ZoomRect } from '../../utils/zoomToRegion';
import type { CanvasContentBox } from './previewGeometry';

/** Everything {@link zoomRegionTarget} reads out of the editor store. */
export interface ZoomRegionScene {
  clips: Clip[];
  sourceVideos: SourceVideo[];
  tracks: Track[];
  /** The latch: the clip the tool was opened on, or null. */
  zoomRegionClipId: string | null;
  selectedClipId: string | null;
}

/** The clip the tool is open on, and its source. */
export interface ZoomRegionTarget {
  clip: Clip;
  source: SourceVideo;
}

/**
 * Is Zoom to region open, and on what?
 *
 * Only while the latch names the selected clip — so selecting another clip,
 * deselecting, deleting it, loading a project or undoing it away all close the
 * tool with nothing to clear — and only for a video clip the frame draws: on a
 * visible track, with a picture source. An overlay has no source to find; an
 * image or audio source is not a video clip.
 */
export function zoomRegionTarget(scene: ZoomRegionScene): ZoomRegionTarget | null {
  const { clips, sourceVideos, tracks, zoomRegionClipId, selectedClipId } = scene;
  if (!zoomRegionClipId || zoomRegionClipId !== selectedClipId) return null;

  const clip = clips.find((c) => c.id === zoomRegionClipId);
  if (!clip || !isTrackVisible(tracks, clip.trackId)) return null;

  const source = sourceVideos.find((s) => s.id === clip.sourceVideoId);
  if (!source || source.mediaType === 'audio' || source.mediaType === 'image') return null;

  return { clip, source };
}

/** A region in project pixels, as a box in the picker layer's CSS pixels. */
export function regionCssBox(region: ZoomRect, content: CanvasContentBox): ZoomRect {
  return {
    x: region.x * content.scaleX,
    y: region.y * content.scaleY,
    width: region.width * content.scaleX,
    height: region.height * content.scaleY,
  };
}
