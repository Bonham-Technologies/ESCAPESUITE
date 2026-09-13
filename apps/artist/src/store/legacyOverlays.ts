// apps/artist/src/store/legacyOverlays.ts
//
// Older ARTIST versions stored overlays in two arrays hanging off the timeline
// (`timeline.textOverlays` / `timeline.shapeOverlays`) instead of as clips.
// Nothing but the preview ever read them: the exporters iterate `timeline.clips`
// and branch on `clip.overlayType`, so a legacy overlay was visible while editing
// and then silently missing from every export and every headless render.
//
// This module folds those arrays into ordinary overlay clips, so a legacy project
// becomes an ordinary project the moment it loads — selectable, editable, movable,
// deletable, and exported. It is deliberately pure and **deterministic** (no
// `uuid`, no store, no React): ids derive from the legacy ids, so a headless render
// of the same file is reproducible and the output can be asserted literally.
import {
  DEFAULT_EFFECTS,
  DEFAULT_SHAPE_OVERLAY_DATA,
  DEFAULT_TEXT_OVERLAY_DATA,
  DEFAULT_TRANSFORM,
  DEFAULT_TRANSITION,
} from './types';
import type { Clip, ShapeOverlay, TextOverlay, Timeline, Track } from './types';
import { calculateTimelineDuration } from '../core/exportTypes';

/** Shortest overlay a converted clip may be: degenerate legacy data is clamped, not dropped. */
const MIN_DURATION = 0.1;

/** The field values `createTrackAtTop` gives a new track, minus the identity fields. */
const TRACK_DEFAULTS = {
  visible: true,
  locked: false,
  muted: false,
  volume: 1,
  height: 60,
} as const;

/** A converted clip plus the window it occupies, while tracks are being assigned. */
interface Placement {
  clip: Clip;
  start: number;
  end: number;
}

function toPlacement(
  overlay: TextOverlay | ShapeOverlay,
  id: string,
  name: string,
  extra: Pick<Clip, 'overlayType'> & Partial<Clip>
): Placement {
  // Legacy start/end are *timeline* times; a clip's startTime/endTime are source
  // in/out points, which for an overlay is simply 0..duration (what the
  // add-overlay-clip actions do too).
  const timelinePosition = Math.max(0, overlay.startTime);
  const duration = Math.max(MIN_DURATION, overlay.endTime - overlay.startTime);
  const clip: Clip = {
    id,
    sourceVideoId: '',
    name,
    startTime: 0,
    endTime: duration,
    duration,
    trackId: '', // assigned by placeOnTrack
    timelinePosition,
    blendMode: 'normal',
    // A legacy overlay's opacity is the only transform field it carries; its
    // position, rotation and scale live in the text/shape data, which is where
    // the renderer reads an overlay clip's base transform from.
    transform: { ...DEFAULT_TRANSFORM, opacity: overlay.opacity },
    effects: { ...DEFAULT_EFFECTS },
    transition: { ...DEFAULT_TRANSITION },
    // No `animation` key: a legacy overlay has no keyframes and no presets, and
    // its stored values *are* the values it drew with.
    ...extra,
  };
  return { clip, start: timelinePosition, end: timelinePosition + duration };
}

function textToClip(overlay: TextOverlay): Placement {
  const { x, y, fontFamily, fontSize, fontWeight, fontStyle, color, backgroundColor, textAlign } = overlay;
  return toPlacement(overlay, `legacy-text-${overlay.id}`, overlay.text, {
    overlayType: 'text',
    // rotation 0 / scale 1 come from the defaults — exactly the values the legacy
    // preview loop passed for a text overlay.
    textData: {
      ...DEFAULT_TEXT_OVERLAY_DATA,
      text: overlay.text,
      x, y, fontFamily, fontSize, fontWeight, fontStyle, color, backgroundColor, textAlign,
    },
  });
}

function shapeToClip(overlay: ShapeOverlay): Placement {
  const { type, x, y, width, height, fillColor, strokeColor, strokeWidth, rotation } = overlay;
  const name = type === 'blur' ? 'Blur Region' : type.charAt(0).toUpperCase() + type.slice(1);
  return toPlacement(overlay, `legacy-shape-${overlay.id}`, name, {
    overlayType: 'shape',
    // `addShapeOverlayClip`'s blur special-case (transparent fill, no stroke,
    // blurAmount 10) is deliberately NOT applied: a legacy shape carries no blur
    // amount and drew with its stored fill and stroke, so forcing those defaults
    // would change the picture. blurAmount stays the default 0 — which is what
    // the legacy draw loop passed too, since a ShapeOverlay has no such field.
    shapeData: {
      ...DEFAULT_SHAPE_OVERLAY_DATA,
      type, x, y, width, height, fillColor, strokeColor, strokeWidth, rotation,
    },
  });
}

/** A track this conversion created, with the windows already placed on it. */
interface PoolTrack {
  track: Track;
  placements: Placement[];
}

/**
 * Assign tracks so the converted z-order is the legacy z-order.
 *
 * The legacy preview drew every clip (sorted by ascending track index) and then,
 * on top of everything, all legacy shapes followed by all legacy text. Converted
 * clips are drawn by track index like any other, so every track this creates has
 * to sit above every existing one, and shapes have to be converted before texts.
 *
 * Tracks created here form a pool that is reused only where the windows do not
 * overlap — `findEmptyTrack` (what the add-overlay-clip actions use) is deliberately
 * NOT used, because it would drop the overlays onto a low-index empty track and
 * hide them underneath media clips on higher tracks.
 */
function placeOnTrack(
  placement: Placement,
  pool: PoolTrack[],
  existing: Track[],
  takenTrackIds: Set<string>
): void {
  const free = pool.find((entry) => entry.placements.every(
    (other) => other.end <= placement.start || other.start >= placement.end
  ));
  const entry = free ?? createOverlayTrack(pool, existing, takenTrackIds);
  placement.clip.trackId = entry.track.id;
  entry.placements.push(placement);
}

function createOverlayTrack(pool: PoolTrack[], existing: Track[], takenTrackIds: Set<string>): PoolTrack {
  const indices = existing.concat(pool.map((entry) => entry.track)).map((t) => t.index);
  const index = indices.length > 0 ? Math.max(...indices) + 1 : 0;
  let n = 1;
  while (takenTrackIds.has(`legacy-overlay-track-${n}`)) n += 1;
  const id = `legacy-overlay-track-${n}`;
  takenTrackIds.add(id);
  const count = pool.length + 1;
  const entry: PoolTrack = {
    track: { id, name: count === 1 ? 'Overlay' : `Overlay ${count}`, index, ...TRACK_DEFAULTS },
    placements: [],
  };
  pool.push(entry);
  return entry;
}

/**
 * Fold a timeline's legacy overlay arrays into overlay clips and empty them.
 *
 * Returns the **identical** `Timeline` object when there is nothing to convert,
 * so a modern project (and the headless kit's fixture) is provably untouched.
 *
 * Idempotent: an overlay whose derived clip id is already on the timeline is
 * skipped rather than duplicated, so a file that somehow carries both the legacy
 * arrays and previously-converted clips converges instead of growing.
 */
export function convertLegacyOverlays(timeline: Timeline): Timeline {
  const textOverlays = timeline.textOverlays ?? [];
  const shapeOverlays = timeline.shapeOverlays ?? [];
  if (textOverlays.length === 0 && shapeOverlays.length === 0) return timeline;

  const existingTracks = timeline.tracks ?? [];
  const existingClips = timeline.clips ?? [];
  const clipIds = new Set(existingClips.map((c) => c.id));
  const takenTrackIds = new Set(existingTracks.map((t) => t.id));
  const pool: PoolTrack[] = [];
  const converted: Clip[] = [];

  // Shapes first, then texts — the order the legacy preview drew them in.
  const placements = shapeOverlays.map(shapeToClip).concat(textOverlays.map(textToClip));
  for (const placement of placements) {
    if (clipIds.has(placement.clip.id)) continue; // already converted
    clipIds.add(placement.clip.id);
    placeOnTrack(placement, pool, existingTracks, takenTrackIds);
    converted.push(placement.clip);
  }

  // Everything was already converted: empty the arrays so the next load is a
  // no-op, and leave the clips, tracks and duration exactly as they were.
  if (converted.length === 0) {
    return { ...timeline, textOverlays: [], shapeOverlays: [] };
  }

  const clips = existingClips.concat(converted);
  return {
    ...timeline,
    tracks: existingTracks.concat(pool.map((entry) => entry.track)),
    clips,
    textOverlays: [],
    shapeOverlays: [],
    duration: calculateTimelineDuration(clips),
  };
}
