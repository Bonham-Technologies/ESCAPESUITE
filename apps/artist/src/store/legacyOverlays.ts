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
  extra: Required<Pick<Clip, 'overlayType'>> & Partial<Clip>
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
  // An empty (or whitespace-only) legacy text would otherwise show as a nameless
  // clip on the timeline; `addTextOverlayClip` falls back to 'Text' for the same
  // reason. Only the clip *name* falls back — `textData.text` is stored verbatim.
  const name = overlay.text.trim() ? overlay.text : 'Text';
  return toPlacement(overlay, `legacy-text-${overlay.id}`, name, {
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
    // Blur: the legacy preview's shape loop passed no canvas, so the capture-and-blur
    // branch never ran — and `case 'blur'` draws neither fill nor stroke. A legacy
    // blur shape therefore drew **nothing at all**. Converting it faithfully would
    // mean an invisible clip that only wastes a track, so the conversion deliberately
    // makes it a *working* blur region instead: `blurAmount: 10`, the same radius the
    // renderer already substitutes for 0 (`blurAmount || 10` in `effectiveShapeBlur`)
    // and the value `ShapeSection` displays (`blurAmount ?? 10`), so the inspector's
    // slider agrees with the picture rather than reading "0px" while it blurs at 10.
    //
    // The rest of `addShapeOverlayClip`'s blur special-case — forcing fill `#00000000`
    // and `strokeWidth: 0` — is NOT applied: fill and stroke are carried through as
    // stored, so they survive if the user switches the shape's type back. They are
    // invisible either way while the type is 'blur'.
    shapeData: {
      ...DEFAULT_SHAPE_OVERLAY_DATA,
      type, x, y, width, height, fillColor, strokeColor, strokeWidth, rotation,
      blurAmount: type === 'blur' ? 10 : DEFAULT_SHAPE_OVERLAY_DATA.blurAmount,
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
 * to sit above every existing one, and every *text* track has to sit above every
 * *shape* track.
 *
 * That last part is why the reuse pool is **per kind**: shapes are placed first
 * against a shapes-only pool, then texts against a fresh texts-only pool, while a
 * single `created` list does the index/id/name accounting for both. Sharing one
 * pool across kinds inverts the stacking — a text can land on a low pool track
 * created for a shape while a *later* shape has spilled onto a higher one, so the
 * shape would draw over the caption that used to be on top of it. The trade is one
 * extra track in the case where a shape and a non-overlapping text could have
 * shared one; a guaranteed ordering is worth it.
 *
 * Within one kind a track is reused only where the windows do not overlap.
 * `findEmptyTrack` (what the add-overlay-clip actions use) is deliberately NOT used,
 * because it would drop the overlays onto a low-index empty track and hide them
 * underneath media clips on higher tracks.
 */
function placeOnTrack(
  placement: Placement,
  pool: PoolTrack[],
  created: PoolTrack[],
  existing: Track[],
  takenTrackIds: Set<string>
): void {
  const free = pool.find((entry) => entry.placements.every(
    (other) => other.end <= placement.start || other.start >= placement.end
  ));
  const entry = free ?? createOverlayTrack(pool, created, existing, takenTrackIds);
  placement.clip.trackId = entry.track.id;
  entry.placements.push(placement);
}

function createOverlayTrack(
  pool: PoolTrack[],
  created: PoolTrack[],
  existing: Track[],
  takenTrackIds: Set<string>
): PoolTrack {
  const indices = existing.concat(created.map((entry) => entry.track)).map((t) => t.index);
  const index = indices.length > 0 ? Math.max(...indices) + 1 : 0;
  let n = 1;
  while (takenTrackIds.has(`legacy-overlay-track-${n}`)) n += 1;
  const id = `legacy-overlay-track-${n}`;
  takenTrackIds.add(id);
  const count = created.length + 1;
  const entry: PoolTrack = {
    track: { id, name: count === 1 ? 'Overlay' : `Overlay ${count}`, index, ...TRACK_DEFAULTS },
    placements: [],
  };
  pool.push(entry);
  created.push(entry);
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
  const created: PoolTrack[] = [];
  const converted: Clip[] = [];

  // Shapes first, then texts — the order the legacy preview drew them in — and each
  // kind against its own reuse pool, so every text track is created after (and so
  // indexed above) every shape track. `created` is shared: it carries the index, id
  // and name accounting for both pools, and is the list appended to `tracks`.
  const groups = [shapeOverlays.map(shapeToClip), textOverlays.map(textToClip)];
  for (const group of groups) {
    const pool: PoolTrack[] = [];
    for (const placement of group) {
      if (clipIds.has(placement.clip.id)) continue; // already converted
      clipIds.add(placement.clip.id);
      placeOnTrack(placement, pool, created, existingTracks, takenTrackIds);
      converted.push(placement.clip);
    }
  }

  // Everything was already converted: empty the arrays so the next load is a
  // no-op, and leave the clips, tracks and duration exactly as they were.
  if (converted.length === 0) {
    return { ...timeline, textOverlays: [], shapeOverlays: [] };
  }

  const clips = existingClips.concat(converted);
  return {
    ...timeline,
    tracks: existingTracks.concat(created.map((entry) => entry.track)),
    clips,
    textOverlays: [],
    shapeOverlays: [],
    duration: calculateTimelineDuration(clips),
  };
}
