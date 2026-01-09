// Optimized deep cloning utility for state management
// Uses structuredClone (faster than JSON.parse/JSON.stringify)
// and handles edge cases that JSON serialization misses

import type { Project, SourceVideo, Clip, UndoableState } from '../store/types';

/**
 * Deep clone any value using structuredClone.
 * Much faster than JSON.parse(JSON.stringify()) and handles:
 * - undefined values (JSON loses these)
 * - NaN, Infinity (JSON converts to null)
 * - Circular references (throws explicit error vs JSON)
 */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Deep clone a Project object.
 * Specialized for the Project type structure.
 */
export function cloneProject(project: Project): Project {
  return structuredClone(project);
}

/**
 * Deep clone an array of SourceVideo objects.
 */
export function cloneSourceVideos(videos: SourceVideo[]): SourceVideo[] {
  return structuredClone(videos);
}

/**
 * Deep clone a Clip object.
 * Useful for duplicating clips.
 */
export function cloneClip(clip: Clip): Clip {
  return structuredClone(clip);
}

/**
 * Create an UndoableState snapshot efficiently.
 * This is the hot path for undo/redo operations.
 */
export function createUndoableSnapshot(
  project: Project,
  sourceVideos: SourceVideo[]
): UndoableState {
  return {
    project: structuredClone(project),
    sourceVideos: structuredClone(sourceVideos),
  };
}
