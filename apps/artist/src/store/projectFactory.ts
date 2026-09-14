// Factories for the empty project, timeline and tracks the store starts from,
// plus the timeline-duration calculation every clip mutation re-runs.

import { v4 as uuidv4 } from 'uuid';
import type { Clip, Project, Timeline, Track } from './types';

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

// Find an empty track (no clips assigned) - returns lowest index empty track
function findEmptyTrack(tracks: Track[], clips: Clip[]): Track | null {
  const usedTrackIds = new Set(clips.map(c => c.trackId));
  const emptyTracks = tracks.filter(t => !usedTrackIds.has(t.id));
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

export {
  createDefaultTrack,
  createTrackAtTop,
  findEmptyTrack,
  createEmptyTimeline,
  createEmptyProject,
  calculateTimelineDuration,
};
