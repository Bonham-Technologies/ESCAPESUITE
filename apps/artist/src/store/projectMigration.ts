// Migration of a loaded project onto the current timeline shape: resolution,
// tracks, overlay arrays, and the legacy overlays that fold into clips.

import type { Clip, ClipTransform, Project } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION } from './types';
import { convertLegacyOverlays } from './legacyOverlays';
import { createDefaultTrack, calculateTimelineDuration } from './projectFactory';
import { isValidCrop } from '../core/clipCrop';

/**
 * Repair a clip transform the app itself once wrote (ESCSUITE-255): a scale
 * that is not finite and positive becomes 1, and an x, y, rotation or opacity
 * that is not finite becomes its `DEFAULT_TRANSFORM` value. A session saved
 * before the store refused such writes (a 0x0 "video"'s Fit to Canvas wrote
 * `scaleX: Infinity`) restores usable instead of poisoning the project.
 * Returns the very same transform when nothing needs repair.
 */
function repairTransform(transform: ClipTransform): ClipTransform {
  let repaired: ClipTransform | null = null;
  for (const key of ['scaleX', 'scaleY'] as const) {
    const value = transform[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      repaired = { ...(repaired ?? transform), [key]: 1 };
    }
  }
  for (const key of ['x', 'y', 'rotation', 'opacity'] as const) {
    const value = transform[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      repaired = { ...(repaired ?? transform), [key]: DEFAULT_TRANSFORM[key] };
    }
  }
  return repaired ?? transform;
}

/**
 * Repair every clip's transform; the project, timeline and each clip keep
 * their identity when nothing was wrong, and one `console.warn` names each
 * clip that was repaired. `parseProject` has already refused an untrusted
 * file with such a transform (ESCSUITE-173), so this only ever touches the
 * app's own state — the session restore and a `setProject` of its own.
 */
function repairClipTransforms(project: Project): Project {
  const clips = project.timeline.clips;
  let changed = false;
  const repairedClips = clips.map((clip) => {
    if (!clip.transform) return clip;
    const transform = repairTransform(clip.transform);
    if (transform === clip.transform) return clip;
    console.warn(`Repaired a non-finite transform on clip ${clip.id}`);
    changed = true;
    return { ...clip, transform };
  });
  if (!changed) return project;
  return { ...project, timeline: { ...project.timeline, clips: repairedClips } };
}

// Ensure timeline has tracks and overlays arrays (migration helper)
function ensureTimelineHasTracks(project: Project): Project {
  // Ensure resolution exists (migration for older projects)
  if (!project.resolution) {
    project = { ...project, resolution: { width: 1920, height: 1080 } };
  }
  project = repairClipTransforms(project);

  const timeline = project.timeline;
  let needsMigration = false;

  // Check if we need to migrate
  if (!timeline.tracks || timeline.tracks.length === 0) {
    needsMigration = true;
  }

  // Ensure overlays arrays exist
  const textOverlays = timeline.textOverlays || [];
  const shapeOverlays = timeline.shapeOverlays || [];

  if (!timeline.textOverlays || !timeline.shapeOverlays) {
    needsMigration = true;
  }

  if (!needsMigration && timeline.tracks && timeline.tracks.length > 0) {
    // Just ensure overlay arrays exist, and fold any legacy overlay into clips
    return {
      ...project,
      timeline: convertLegacyOverlays({
        ...timeline,
        textOverlays,
        shapeOverlays,
      }),
    };
  }

  // Migrate: create default track and assign clips
  const defaultTrack = createDefaultTrack(0);
  let position = 0;

  const migratedClips = timeline.clips.map(clip => {
    const migrated: Clip = {
      ...clip,
      trackId: (clip as any).trackId || defaultTrack.id,
      timelinePosition: (clip as any).timelinePosition ?? position,
      blendMode: (clip as any).blendMode || 'normal',
      transform: (clip as any).transform || { ...DEFAULT_TRANSFORM },
      effects: (clip as any).effects || { ...DEFAULT_EFFECTS },
      transition: (clip as any).transition || { ...DEFAULT_TRANSITION },
    };

    // If no timelinePosition was set, calculate from sequential order
    if ((clip as any).timelinePosition === undefined) {
      position += clip.duration;
    }

    return migrated;
  });

  return {
    ...project,
    timeline: convertLegacyOverlays({
      tracks: timeline.tracks?.length > 0 ? timeline.tracks : [defaultTrack],
      clips: migratedClips,
      textOverlays,
      shapeOverlays,
      duration: calculateTimelineDuration(migratedClips),
    }),
  };
}

/** What `parseProject` hands back: a migrated project, or why it refused one. */
export type ParseProjectResult =
  | { ok: true; project: Project }
  | { ok: false; reason: string };

// The smallest raster worth encoding, and the largest the exporters are ever
// asked to produce (7680x4320, 8K) — both ends of the range `parseProject`
// accepts a `resolution` within (ESCSUITE-152).
const MIN_RESOLUTION_DIMENSION = 2;
const MAX_RESOLUTION_WIDTH = 7680;
const MAX_RESOLUTION_HEIGHT = 4320;

function isValidResolutionDimension(value: unknown, max: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_RESOLUTION_DIMENSION &&
    value <= max
  );
}

/** A `resolution` of the shape `parseProject` is willing to trust. Odd
 * dimensions are fine — the exporters round those to even (ESCSUITE-111). */
function isValidResolution(resolution: unknown): resolution is { width: number; height: number } {
  if (!resolution || typeof resolution !== 'object') {
    return false;
  }
  const { width, height } = resolution as { width?: unknown; height?: unknown };
  return (
    isValidResolutionDimension(width, MAX_RESOLUTION_WIDTH) &&
    isValidResolutionDimension(height, MAX_RESOLUTION_HEIGHT)
  );
}

/**
 * A `ClipTransform` of the shape `parseProject` is willing to trust: six
 * finite numbers, with `scaleX`/`scaleY` strictly positive. A scale of zero
 * (or negative, or `NaN`) is not something the inspector's range inputs or
 * the resize handles can ever produce — both floor at 0.1 — but nothing
 * stopped a `.veditor` file, a host `LOAD_PROJECT` payload or a headless job
 * spec from carrying one, and `core/cropDrag.ts`'s `sourceDelta` divides by
 * it (ESCSUITE-173). `scaleLocked`, if present, is a UI preference and not
 * checked here.
 */
function isValidTransform(transform: unknown): transform is ClipTransform {
  if (!transform || typeof transform !== 'object') return false;
  const { x, y, scaleX, scaleY, rotation, opacity } = transform as Partial<ClipTransform>;
  return (
    typeof x === 'number' && Number.isFinite(x) &&
    typeof y === 'number' && Number.isFinite(y) &&
    typeof scaleX === 'number' && Number.isFinite(scaleX) && scaleX > 0 &&
    typeof scaleY === 'number' && Number.isFinite(scaleY) && scaleY > 0 &&
    typeof rotation === 'number' && Number.isFinite(rotation) &&
    typeof opacity === 'number' && Number.isFinite(opacity)
  );
}

/**
 * Validate a project shape before anything downstream touches it, and only
 * then run the existing migration on it.
 *
 * `ensureTimelineHasTracks` assumes the shape it is handed — it reads
 * `timeline.tracks` and, on the migration branch, maps over `timeline.clips`
 * with no guards, so a malformed `.veditor` (or a host's `LOAD_PROJECT`
 * payload, which arrives with no validation of its own) throws partway
 * through. Both callers need to know *before* they act on the file: loading
 * one from disk resets the editor first, and the host integration channel has
 * no UI to show a thrown error in. So the shape checks below run first and
 * report a reason instead of throwing, and migration runs only once they
 * pass — on a shape it is now safe to walk.
 *
 * What is (and is not) checked, straight from the ticket: `timeline` must be
 * an object; `clips` must be an array (an absent `tracks` is exactly what the
 * migration branch already handles, so it is let through rather than
 * rejected); every clip needs a unique string `id`; and after migration has
 * run, every clip's `trackId` must be a string naming a track that survived
 * migration. A clip's `sourceVideoId` is never checked here — media is
 * re-linked separately, so a clip pointing at a video the load has not
 * brought back yet is not this function's business. `resolution`, if
 * present, must be an object with finite integer `width` and `height` both
 * between 2 and 8K (ESCSUITE-152) — an unvalidated `{width:0,height:0}` used
 * to reach `VideoEncoder.configure` through the default `'project'` export
 * preset and fail deep inside the exporter instead of at the door. An
 * *absent* `resolution` is not rejected: that is exactly what
 * `ensureTimelineHasTracks`'s own migration default (1920x1080, below)
 * already handles, unchanged by this ticket.
 * A clip's `crop`, if present, must be four finite insets >= 0 leaving
 * something on each axis (ESCSUITE-6) — `core/clipCrop.ts`'s `isValidCrop`.
 * An *absent* crop is every clip in every project written before that ticket
 * and is not checked at all; a malformed one would otherwise reach
 * `croppedSourceRect` and, via a source rect of the wrong sign, `drawImage`.
 * A clip's `transform`, if present, must be six finite numbers with a
 * `scaleX`/`scaleY` strictly greater than zero (ESCSUITE-173) — neither the
 * inspector's range inputs nor the resize handles can ever produce a scale
 * that small (both floor at 0.1), but nothing short of this check stopped a
 * `.veditor`, a host payload or a headless job spec from carrying one, and
 * `core/cropDrag.ts`'s `sourceDelta` divides by it. An *absent* transform is
 * left untouched, to whatever default the caller (the migration below, or a
 * headless render) supplies.
 */
export function parseProject(input: unknown): ParseProjectResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'Not a project file' };
  }

  const candidate = input as Partial<Project>;

  if (candidate.resolution !== undefined && !isValidResolution(candidate.resolution)) {
    return {
      ok: false,
      reason: 'Project resolution must be an object with a whole-number width and height, both between 2 and 7680x4320 (8K)',
    };
  }

  const timeline = candidate.timeline as Partial<Project['timeline']> | undefined;

  if (!timeline || typeof timeline !== 'object') {
    return { ok: false, reason: 'Project has no timeline' };
  }

  // An absent (or empty) `tracks` is what ensureTimelineHasTracks's migration
  // branch is for — only a `tracks` that exists and is not an array is bad.
  if (timeline.tracks !== undefined && !Array.isArray(timeline.tracks)) {
    return { ok: false, reason: 'Timeline tracks is not a list' };
  }

  if (!Array.isArray(timeline.clips)) {
    return { ok: false, reason: 'Timeline has no clips list' };
  }

  const seenClipIds = new Set<string>();
  for (const clip of timeline.clips) {
    const candidate = clip as Partial<Clip> | null;
    const id = candidate?.id;
    if (typeof id !== 'string') {
      return { ok: false, reason: 'A clip is missing an id' };
    }
    if (seenClipIds.has(id)) {
      return { ok: false, reason: `Duplicate clip id: ${id}` };
    }
    seenClipIds.add(id);

    // ESCSUITE-6. Checked here rather than after migration because migration
    // never touches `crop` — unlike `trackId`, which it can supply.
    if (candidate?.crop !== undefined && !isValidCrop(candidate?.crop)) {
      return { ok: false, reason: `Clip "${id}" has an invalid crop` };
    }

    // ESCSUITE-257. A clip with no positive duration gives a timeline of zero
    // or negative length, which the exporters cannot mix or encode. An absent
    // `timelinePosition` is left to the migration's sequential default.
    if (typeof candidate?.duration !== 'number' || !Number.isFinite(candidate.duration) || candidate.duration <= 0) {
      return { ok: false, reason: `Clip "${id}" has an invalid duration` };
    }
    if (
      candidate.timelinePosition !== undefined &&
      (typeof candidate.timelinePosition !== 'number' || !Number.isFinite(candidate.timelinePosition))
    ) {
      return { ok: false, reason: `Clip "${id}" has an invalid timelinePosition` };
    }

    // ESCSUITE-173. Checked here, against the RAW input, for the same reason
    // as `crop`: the migration branch that runs when `tracks` already exists
    // leaves a clip's `transform` untouched (only the trackless-migration
    // branch supplies a default, and only when the field is falsy — an
    // invalid non-empty object would survive it), so an invalid transform is
    // not something migration can be trusted to repair.
    if (candidate?.transform !== undefined && !isValidTransform(candidate?.transform)) {
      return { ok: false, reason: `Clip "${id}" has an invalid transform` };
    }
  }

  const migrated = ensureTimelineHasTracks(candidate as Project);
  const trackIds = new Set(migrated.timeline.tracks.map((track) => track.id));

  for (const clip of migrated.timeline.clips) {
    if (typeof clip.trackId !== 'string' || !trackIds.has(clip.trackId)) {
      return {
        ok: false,
        reason: `Clip "${clip.id}" is on a track that does not exist: ${String(clip.trackId)}`,
      };
    }
  }

  return { ok: true, project: migrated };
}

export { ensureTimelineHasTracks };
