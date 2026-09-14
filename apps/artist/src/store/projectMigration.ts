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

export { ensureTimelineHasTracks };
