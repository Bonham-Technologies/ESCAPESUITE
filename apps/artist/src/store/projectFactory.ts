// Factories for the empty project, timeline and tracks the store starts from,
// plus the timeline-duration calculation every clip mutation re-runs.

import { v4 as uuidv4 } from 'uuid';
import type { Clip, Project, SourceVideo, Timeline, Track } from './types';

// Create a default track
function createDefaultTrack(index: number = 0): Track {
  return {
    id: uuidv4(),
    name: `Track ${index + 1}`,
    index,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
  };
}

// Create a track at the top of the stack (highest index)
function createTrackAtTop(tracks: Track[], name?: string): Track {
  const newIndex = tracks.length > 0 ? Math.max(...tracks.map(t => t.index)) + 1 : 0;
  return {
    id: uuidv4(),
    name: name || `Track ${newIndex + 1}`,
    index: newIndex,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
  };
}

// Find an empty track (no clips assigned) - returns lowest index empty track.
// A locked track is never chosen (ESCSUITE-84): its contents are frozen, and an
// empty locked track is still locked. Nor is the caption track (ESCSUITE-293,
// review M2): emptied of captions it is still the one the next import and the
// sidecar use, so a title or a video put there would be read as a caption.
function findEmptyTrack(tracks: Track[], clips: Clip[]): Track | null {
  const usedTrackIds = new Set(clips.map(c => c.trackId));
  const emptyTracks = tracks.filter(t => !usedTrackIds.has(t.id) && !t.locked && t.kind !== 'captions');
  if (emptyTracks.length === 0) return null;
  // Return the one with lowest index
  return emptyTracks.reduce((a, b) => a.index < b.index ? a : b);
}

function createEmptyTimeline(): Timeline {
  const defaultTrack = createDefaultTrack(0);
  return {
    tracks: [defaultTrack],
    clips: [],
    textOverlays: [],
    shapeOverlays: [],
    duration: 0,
  };
}

// Name given to a project that has never been named by the user or a host.
export const DEFAULT_PROJECT_NAME = 'Untitled Project';

function createEmptyProject(): Project {
  return {
    id: uuidv4(),
    name: DEFAULT_PROJECT_NAME,
    created: Date.now(),
    modified: Date.now(),
    resolution: { width: 1920, height: 1080 },
    timeline: createEmptyTimeline(),
  };
}

// Calculate timeline duration from all clips (max end position)
function calculateTimelineDuration(clips: Clip[]): number {
  if (clips.length === 0) return 0;
  return Math.max(...clips.map(c => c.timelinePosition + c.duration));
}

/**
 * `timeline` without every clip that plays one of `removedIds`, its duration
 * recalculated. The one place that arithmetic lives: the media library's
 * storage clears (`removeSourceVideosPermanently`, ESCSUITE-149) and a session
 * restore that finds a source's bytes gone (ESCSUITE-307) both drop a source's
 * clips this way. A clip with no source (a text overlay) is always kept.
 */
function timelineWithoutSources(timeline: Timeline, removedIds: ReadonlySet<string>): Timeline {
  const clips = timeline.clips.filter((c) => !c.sourceVideoId || !removedIds.has(c.sourceVideoId));
  return { ...timeline, clips, duration: calculateTimelineDuration(clips) };
}

/**
 * The editor holds no work at all: no source in the library and no clip on the
 * timeline (ESCSUITE-227). Read by the autosave, which never writes such a
 * session over this tab's slot (`isEmptySession`), and by the media library's
 * three storage clears, which empty the slot themselves when one of them is
 * what left the project this way (ESCSUITE-307). A clip with no source (a text
 * overlay) is work, and so is a source with no clip.
 */
function holdsNoWork(state: { sourceVideos: readonly SourceVideo[]; project: Project }): boolean {
  return state.sourceVideos.length === 0 && state.project.timeline.clips.length === 0;
}

export {
  createDefaultTrack,
  createTrackAtTop,
  findEmptyTrack,
  createEmptyTimeline,
  createEmptyProject,
  calculateTimelineDuration,
  timelineWithoutSources,
  holdsNoWork,
};
