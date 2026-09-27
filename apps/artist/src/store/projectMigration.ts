// Migration of a loaded project onto the current timeline shape: resolution,
// tracks, overlay arrays, and the legacy overlays that fold into clips.

import type { Clip, Project } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION } from './types';
import { convertLegacyOverlays } from './legacyOverlays';
import { createDefaultTrack, calculateTimelineDuration } from './projectFactory';

// Ensure timeline has tracks and overlays arrays (migration helper)
function ensureTimelineHasTracks(project: Project): Project {
  // Ensure resolution exists (migration for older projects)
  if (!project.resolution) {
    project = { ...project, resolution: { width: 1920, height: 1080 } };
  }

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
 * brought back yet is not this function's business.
 */
export function parseProject(input: unknown): ParseProjectResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'Not a project file' };
  }

  const candidate = input as Partial<Project>;
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
    const id = (clip as Partial<Clip> | null)?.id;
    if (typeof id !== 'string') {
      return { ok: false, reason: 'A clip is missing an id' };
    }
    if (seenClipIds.has(id)) {
      return { ok: false, reason: `Duplicate clip id: ${id}` };
    }
    seenClipIds.add(id);
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
