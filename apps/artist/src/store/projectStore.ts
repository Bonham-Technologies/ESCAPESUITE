// Zustand store for project state management

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { EditorState, Project, SourceVideo, Clip, Timeline, Track, ClipTransform, ClipEffects, BlendMode, UndoableState, TextOverlay, ShapeOverlay, Transition, TextOverlayData, ShapeOverlayData, ClipAnimation, AnimatableProperty, Keyframe } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION, DEFAULT_TEXT_OVERLAY_DATA, DEFAULT_SHAPE_OVERLAY_DATA, DEFAULT_ANIMATION, DEFAULT_KEYFRAME_PANEL_STATE } from './types';
import { createUndoableSnapshot, cloneClip } from '../utils/deepClone';

// Legacy defaults for backwards compatibility
const DEFAULT_TEXT_OVERLAY = {
  text: 'Text',
  x: 0.5,
  y: 0.5,
  fontFamily: 'Arial',
  fontSize: 48,
  fontWeight: 'normal' as const,
  fontStyle: 'normal' as const,
  color: '#ffffff',
  backgroundColor: '#00000000',
  textAlign: 'center' as const,
  opacity: 1,
};

const DEFAULT_SHAPE_OVERLAY = {
  type: 'rectangle' as const,
  x: 0.5,
  y: 0.5,
  width: 0.2,
  height: 0.2,
  fillColor: '#000000ff',
  strokeColor: '#ffffff',
  strokeWidth: 0,
  opacity: 1,
  rotation: 0,
  blurAmount: 0,
};

// Maximum history size to prevent memory issues
const MAX_HISTORY_SIZE = 50;

// Helper to get undoable state snapshot
function getUndoableState(state: EditorState): UndoableState {
  return createUndoableSnapshot(state.project, state.sourceVideos);
}

// Helper to push state to history (call before making changes)
function pushToHistory(state: EditorState): { past: UndoableState[]; future: UndoableState[] } {
  const snapshot = getUndoableState(state);
  const newPast = [...state.history.past, snapshot];

  // Limit history size
  if (newPast.length > MAX_HISTORY_SIZE) {
    newPast.shift();
  }

  return {
    past: newPast,
    future: [], // Clear future on new action
  };
}

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

function createEmptyProject(): Project {
  return {
    id: uuidv4(),
    name: 'Untitled Project',
    created: Date.now(),
    modified: Date.now(),
    resolution: { width: 1280, height: 720 },
    timeline: createEmptyTimeline(),
  };
}

// Calculate timeline duration from all clips (max end position)
function calculateTimelineDuration(clips: Clip[]): number {
  if (clips.length === 0) return 0;
  return Math.max(...clips.map(c => c.timelinePosition + c.duration));
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // Initial state
  project: createEmptyProject(),
  sourceVideos: [],
  currentTime: 0,
  isPlaying: false,
  selectedClipId: null,
  selectedClipIds: new Set<string>(),
  selectedTrackId: null,
  selectedOverlayId: null,
  selectedOverlayType: null,
  clipboard: null,
  zoom: 1,
  snapEnabled: true,
  snapThreshold: 10, // pixels
  activeTool: 'select',
  loopPlayback: false,
  markers: [],
  keyframePanelState: DEFAULT_KEYFRAME_PANEL_STATE,
  history: {
    past: [],
    future: [],
  },

  // Project actions
  setProject: (project: Project) => set((state) => ({
    project: ensureTimelineHasTracks(project),
    history: pushToHistory(state),
  })),

  resetProject: () => set((state) => ({
    project: createEmptyProject(),
    sourceVideos: [],
    currentTime: 0,
    isPlaying: false,
    selectedClipId: null,
    selectedClipIds: new Set<string>(),
    selectedTrackId: null,
    selectedOverlayId: null,
    selectedOverlayType: null,
    clipboard: null,
    history: pushToHistory(state),
  })),

  setProjectResolution: (width: number, height: number) => set((state) => ({
    project: {
      ...state.project,
      modified: Date.now(),
      resolution: { width, height },
    },
    history: pushToHistory(state),
  })),

  // Source video actions
  addSourceVideo: (video: SourceVideo) => set((state) => ({
    sourceVideos: [...state.sourceVideos, video],
    history: pushToHistory(state),
  })),

  removeSourceVideo: (id: string) => set((state) => ({
    sourceVideos: state.sourceVideos.filter((v) => v.id !== id),
    project: {
      ...state.project,
      modified: Date.now(),
      timeline: {
        ...state.project.timeline,
        clips: state.project.timeline.clips.filter((c) => c.sourceVideoId !== id),
        duration: calculateTimelineDuration(
          state.project.timeline.clips.filter((c) => c.sourceVideoId !== id)
        ),
      },
    },
    history: pushToHistory(state),
  })),

  // Track actions
  addTrack: (name?: string) => {
    const state = get();
    const tracks = state.project.timeline.tracks;
    const newIndex = tracks.length > 0 ? Math.max(...tracks.map(t => t.index)) + 1 : 0;
    const newTrack: Track = {
      id: uuidv4(),
      name: name || `Track ${newIndex + 1}`,
      index: newIndex,
      visible: true,
      locked: false,
      muted: false,
      volume: 1,
      height: 60,
    };

    set({
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks: [...tracks, newTrack],
        },
      },
      history: pushToHistory(state),
    });

    return newTrack;
  },

  removeTrack: (trackId: string) => set((state) => {
    const tracks = state.project.timeline.tracks;
    if (tracks.length <= 1) return state; // Keep at least one track

    const newTracks = tracks.filter(t => t.id !== trackId);
    const newClips = state.project.timeline.clips.filter(c => c.trackId !== trackId);

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks: newTracks,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
      history: pushToHistory(state),
    };
  }),

  updateTrack: (trackId: string, updates: Partial<Track>) => set((state) => ({
    project: {
      ...state.project,
      modified: Date.now(),
      timeline: {
        ...state.project.timeline,
        tracks: state.project.timeline.tracks.map(track =>
          track.id === trackId ? { ...track, ...updates } : track
        ),
      },
    },
    history: pushToHistory(state),
  })),

  reorderTracks: (trackIds: string[]) => set((state) => {
    const trackMap = new Map(state.project.timeline.tracks.map(t => [t.id, t]));
    const newTracks = trackIds
      .map((id, index) => {
        const track = trackMap.get(id);
        return track ? { ...track, index } : null;
      })
      .filter((t): t is Track => t !== null);

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks: newTracks,
        },
      },
      history: pushToHistory(state),
    };
  }),

  // Clip actions
  addClipToTimeline: (clipData, trackId?, position?) => set((state) => {
    let tracks = [...state.project.timeline.tracks];
    let targetTrackId = trackId;

    // Use empty track if available, otherwise create new track at top
    if (!targetTrackId) {
      const emptyTrack = findEmptyTrack(tracks, state.project.timeline.clips);
      if (emptyTrack) {
        targetTrackId = emptyTrack.id;
      } else {
        const newTrack = createTrackAtTop(tracks);
        tracks = [...tracks, newTrack];
        targetTrackId = newTrack.id;
      }
    }

    // Use playhead position if no position specified
    const timelinePosition = position ?? state.currentTime;

    // Calculate initial scale based on source media dimensions vs project resolution
    const source = state.sourceVideos.find(v => v.id === clipData.sourceVideoId);
    const { resolution } = state.project;
    let initialScaleX = 1, initialScaleY = 1;

    if (source && (source.mediaType === 'image' || source.mediaType === 'video' || (!source.mediaType && source.width > 0 && source.height > 0))) {
      const nativeScaleX = source.width / resolution.width;
      const nativeScaleY = source.height / resolution.height;

      if (nativeScaleX > 1 || nativeScaleY > 1) {
        // Auto-fit: scale down to contain within canvas
        const fitScale = Math.min(resolution.width / source.width, resolution.height / source.height);
        initialScaleX = initialScaleY = fitScale;
      } else {
        // Keep native size relative to project
        initialScaleX = nativeScaleX;
        initialScaleY = nativeScaleY;
      }
    }

    const newClip: Clip = {
      ...clipData,
      trackId: targetTrackId,
      timelinePosition,
      blendMode: 'normal',
      transform: { ...DEFAULT_TRANSFORM, scaleX: initialScaleX, scaleY: initialScaleY },
      effects: { ...DEFAULT_EFFECTS },
      transition: { ...DEFAULT_TRANSITION },
    };

    const newClips = [...state.project.timeline.clips, newClip];

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      history: pushToHistory(state),
    };
  }),

  removeClipFromTimeline: (clipId: string) => set((state) => {
    const newClips = state.project.timeline.clips.filter((c) => c.id !== clipId);
    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
      history: pushToHistory(state),
    };
  }),

  // Ripple delete: remove clip and shift all subsequent clips on the same track
  rippleDeleteClip: (clipId: string) => set((state) => {
    const clipToDelete = state.project.timeline.clips.find((c) => c.id === clipId);
    if (!clipToDelete) return state;

    const clipEnd = clipToDelete.timelinePosition + (clipToDelete.endTime - clipToDelete.startTime);
    const clipDuration = clipToDelete.endTime - clipToDelete.startTime;
    const trackId = clipToDelete.trackId;

    const newClips = state.project.timeline.clips
      .filter((c) => c.id !== clipId)
      .map((clip) => {
        // Shift clips on the same track that come after the deleted clip
        if (clip.trackId === trackId && clip.timelinePosition >= clipEnd) {
          return {
            ...clip,
            timelinePosition: Math.max(0, clip.timelinePosition - clipDuration),
          };
        }
        return clip;
      });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
      history: pushToHistory(state),
    };
  }),

  // Shift all clips on a track that are after a certain time by a delta amount
  shiftClipsAfter: (trackId: string | undefined, afterTime: number, delta: number) => set((state) => {
    if (delta === 0) return state;

    const newClips = state.project.timeline.clips.map((clip) => {
      // Shift clips on the same track that start at or after the given time
      if (clip.trackId === trackId && clip.timelinePosition >= afterTime) {
        return {
          ...clip,
          timelinePosition: Math.max(0, clip.timelinePosition + delta),
        };
      }
      return clip;
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      history: pushToHistory(state),
    };
  }),

  updateClip: (clipId: string, updates: Partial<Clip>) => set((state) => {
    const newClips = state.project.timeline.clips.map((clip) => {
      if (clip.id !== clipId) return clip;

      const updated = { ...clip, ...updates };
      // Recalculate duration if start/end times changed
      if (updates.startTime !== undefined || updates.endTime !== undefined) {
        updated.duration = updated.endTime - updated.startTime;
      }
      return updated;
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      history: pushToHistory(state),
    };
  }),

  splitClip: (clipId: string, splitTime: number) => set((state) => {
    const clip = state.project.timeline.clips.find((c) => c.id === clipId);
    if (!clip) return state;

    // splitTime is relative to the clip's start on the timeline
    const sourceTime = clip.startTime + splitTime;

    // Validate split point is within clip bounds
    if (sourceTime <= clip.startTime || sourceTime >= clip.endTime) {
      return state;
    }

    const firstClip: Clip = {
      ...clip,
      id: uuidv4(),
      endTime: sourceTime,
      duration: sourceTime - clip.startTime,
      name: `${clip.name} (1)`,
    };

    const secondClip: Clip = {
      ...clip,
      id: uuidv4(),
      startTime: sourceTime,
      duration: clip.endTime - sourceTime,
      timelinePosition: clip.timelinePosition + firstClip.duration,
      name: `${clip.name} (2)`,
    };

    const newClips = state.project.timeline.clips
      .filter(c => c.id !== clipId)
      .concat([firstClip, secondClip]);

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedClipId: firstClip.id,
      history: pushToHistory(state),
    };
  }),

  moveClipToTrack: (clipId: string, trackId: string) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip =>
      clip.id === clipId ? { ...clip, trackId } : clip
    );

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  setClipTimelinePosition: (clipId: string, position: number) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip =>
      clip.id === clipId ? { ...clip, timelinePosition: Math.max(0, position) } : clip
    );

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      history: pushToHistory(state),
    };
  }),

  updateClipTransform: (clipId: string, transformUpdates: Partial<ClipTransform>, skipHistory?: boolean) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      return {
        ...clip,
        transform: { ...clip.transform, ...transformUpdates },
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: skipHistory ? state.history : pushToHistory(state),
    };
  }),

  updateClipBlendMode: (clipId: string, blendMode: BlendMode) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip =>
      clip.id === clipId ? { ...clip, blendMode } : clip
    );

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  updateClipEffects: (clipId: string, effectsUpdates: Partial<ClipEffects>) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      return {
        ...clip,
        effects: { ...clip.effects, ...effectsUpdates },
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  updateClipTransition: (clipId: string, transitionUpdates: Partial<Transition>) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      return {
        ...clip,
        transition: { ...clip.transition, ...transitionUpdates },
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  updateClipAnimation: (clipId: string, animationUpdates: Partial<ClipAnimation>) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      const currentAnimation = clip.animation || { ...DEFAULT_ANIMATION };
      return {
        ...clip,
        animation: {
          ...currentAnimation,
          ...animationUpdates,
          // Deep merge in/out if provided
          in: animationUpdates.in ? { ...currentAnimation.in, ...animationUpdates.in } : currentAnimation.in,
          out: animationUpdates.out ? { ...currentAnimation.out, ...animationUpdates.out } : currentAnimation.out,
          keyframes: animationUpdates.keyframes !== undefined ? animationUpdates.keyframes : currentAnimation.keyframes,
        },
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  setClipKeyframe: (clipId: string, property: AnimatableProperty, keyframe: Keyframe) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      const currentAnimation = clip.animation || { ...DEFAULT_ANIMATION, keyframes: {} };
      const currentKeyframes = currentAnimation.keyframes[property] || [];

      // Check if keyframe exists at this time (within tolerance)
      const existingIndex = currentKeyframes.findIndex(kf => Math.abs(kf.time - keyframe.time) < 0.001);
      let newKeyframes: Keyframe[];

      if (existingIndex >= 0) {
        // Replace existing keyframe
        newKeyframes = [...currentKeyframes];
        newKeyframes[existingIndex] = keyframe;
      } else {
        // Add new keyframe and sort by time
        newKeyframes = [...currentKeyframes, keyframe].sort((a, b) => a.time - b.time);
      }

      // AUTO-CREATE START KEYFRAME: If this is the first keyframe for this property
      // and it's not at time 0, create a keyframe at time 0 with the base value.
      // This ensures there's always a "from" value to animate from.
      const hasKeyframeAtZero = newKeyframes.some(kf => Math.abs(kf.time) < 0.001);
      if (!hasKeyframeAtZero && newKeyframes.length > 0) {
        // Get the base value for this property from the clip's transform/effects/overlayData
        let baseValue: number;
        if (property === 'blur') {
          baseValue = clip.effects?.blur ?? 0;
        } else if (property === 'volume') {
          // Volume default is 1 (100%)
          baseValue = 1;
        } else if (clip.textData && (property === 'x' || property === 'y' || property === 'rotation')) {
          // Text overlay - get from textData
          if (property === 'rotation') {
            baseValue = clip.textData.rotation ?? 0;
          } else {
            baseValue = clip.textData[property];
          }
        } else if (clip.shapeData && (property === 'x' || property === 'y' || property === 'rotation')) {
          // Shape overlay - get from shapeData
          baseValue = clip.shapeData[property];
        } else {
          // Video/image clip - get from transform
          baseValue = clip.transform[property as keyof ClipTransform] as number;
        }

        // Insert keyframe at time 0 with base value
        newKeyframes.unshift({
          time: 0,
          value: baseValue,
          easing: 'ease-out',
        });
      }

      return {
        ...clip,
        animation: {
          ...currentAnimation,
          keyframes: {
            ...currentAnimation.keyframes,
            [property]: newKeyframes,
          },
        },
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  removeClipKeyframe: (clipId: string, property: AnimatableProperty, time: number) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      const currentAnimation = clip.animation;
      if (!currentAnimation) return clip;

      const currentKeyframes = currentAnimation.keyframes[property];
      if (!currentKeyframes) return clip;

      const newKeyframes = currentKeyframes.filter(kf => Math.abs(kf.time - time) >= 0.001);

      return {
        ...clip,
        animation: {
          ...currentAnimation,
          keyframes: {
            ...currentAnimation.keyframes,
            [property]: newKeyframes.length > 0 ? newKeyframes : undefined,
          },
        },
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  moveClipKeyframe: (clipId: string, property: AnimatableProperty, originalTime: number, newTime: number) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      const currentAnimation = clip.animation;
      if (!currentAnimation) return clip;

      const currentKeyframes = currentAnimation.keyframes[property];
      if (!currentKeyframes) return clip;

      // Find the keyframe to move
      const keyframeToMove = currentKeyframes.find(kf => Math.abs(kf.time - originalTime) < 0.001);
      if (!keyframeToMove) return clip;

      // Remove any existing keyframe at the new time, then update the moved keyframe's time
      const newKeyframes = currentKeyframes
        .filter(kf => Math.abs(kf.time - originalTime) >= 0.001 && Math.abs(kf.time - newTime) >= 0.001)
        .concat({ ...keyframeToMove, time: newTime })
        .sort((a, b) => a.time - b.time);

      return {
        ...clip,
        animation: {
          ...currentAnimation,
          keyframes: {
            ...currentAnimation.keyframes,
            [property]: newKeyframes,
          },
        },
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  clearClipKeyframes: (clipId: string, property?: AnimatableProperty) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      const currentAnimation = clip.animation;
      if (!currentAnimation) return clip;

      if (property) {
        // Clear specific property
        const { [property]: _, ...remainingKeyframes } = currentAnimation.keyframes;
        return {
          ...clip,
          animation: {
            ...currentAnimation,
            keyframes: remainingKeyframes,
          },
        };
      } else {
        // Clear all keyframes
        return {
          ...clip,
          animation: {
            ...currentAnimation,
            keyframes: {},
          },
        };
      }
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: pushToHistory(state),
    };
  }),

  duplicateClip: (clipId: string) => set((state) => {
    const clip = state.project.timeline.clips.find(c => c.id === clipId);
    if (!clip) return state;

    // Place duplicated clip right after the original
    const newPosition = clip.timelinePosition + clip.duration;

    // Check for overlap and find next available position
    let position = newPosition;
    const trackClips = state.project.timeline.clips
      .filter(c => c.trackId === clip.trackId && c.id !== clipId)
      .sort((a, b) => a.timelinePosition - b.timelinePosition);

    for (const otherClip of trackClips) {
      const otherEnd = otherClip.timelinePosition + otherClip.duration;
      if (position < otherEnd && position + clip.duration > otherClip.timelinePosition) {
        // Overlap detected, move position to after this clip
        position = otherEnd;
      }
    }

    const duplicatedClip: Clip = {
      ...cloneClip(clip),
      id: uuidv4(),
      timelinePosition: position,
      name: `${clip.name} (copy)`,
    };

    const newClips = [...state.project.timeline.clips, duplicatedClip];

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedClipId: duplicatedClip.id,
      history: pushToHistory(state),
    };
  }),

  // Overlay clip actions (new clip-based overlays)
  addTextOverlayClip: (textData?, trackId?, position?, duration?) => {
    const state = get();
    const currentTime = state.currentTime;
    const clipDuration = duration ?? 5;

    let tracks = [...state.project.timeline.tracks];
    let targetTrackId = trackId;

    // Use empty track if available, otherwise create new track at top
    if (!targetTrackId) {
      const emptyTrack = findEmptyTrack(tracks, state.project.timeline.clips);
      if (emptyTrack) {
        targetTrackId = emptyTrack.id;
      } else {
        const newTrack = createTrackAtTop(tracks, 'Text');
        tracks = [...tracks, newTrack];
        targetTrackId = newTrack.id;
      }
    }

    const newClip: Clip = {
      id: uuidv4(),
      sourceVideoId: '', // Empty for overlay clips
      name: textData?.text ?? 'Text',
      startTime: 0,
      endTime: clipDuration,
      duration: clipDuration,
      trackId: targetTrackId,
      timelinePosition: position ?? currentTime,
      blendMode: 'normal',
      transform: { ...DEFAULT_TRANSFORM },
      effects: { ...DEFAULT_EFFECTS },
      transition: { ...DEFAULT_TRANSITION },
      overlayType: 'text',
      textData: { ...DEFAULT_TEXT_OVERLAY_DATA, ...textData },
    };

    const newClips = [...state.project.timeline.clips, newClip];

    set({
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedClipId: newClip.id,
      selectedOverlayId: null,
      selectedOverlayType: null,
      history: pushToHistory(state),
    });

    return newClip;
  },

  addShapeOverlayClip: (shapeData?, trackId?, position?, duration?) => {
    const state = get();
    const currentTime = state.currentTime;
    const clipDuration = duration ?? 5;

    const shapeType = shapeData?.type ?? 'rectangle';

    let tracks = [...state.project.timeline.tracks];
    let targetTrackId = trackId;

    // Use empty track if available, otherwise create new track at top
    if (!targetTrackId) {
      const emptyTrack = findEmptyTrack(tracks, state.project.timeline.clips);
      if (emptyTrack) {
        targetTrackId = emptyTrack.id;
      } else {
        const trackName = shapeType === 'blur' ? 'Blur' : shapeType.charAt(0).toUpperCase() + shapeType.slice(1);
        const newTrack = createTrackAtTop(tracks, trackName);
        tracks = [...tracks, newTrack];
        targetTrackId = newTrack.id;
      }
    }

    // Set specific defaults for blur type
    let finalShapeData = { ...DEFAULT_SHAPE_OVERLAY_DATA, ...shapeData };
    if (shapeType === 'blur') {
      finalShapeData = {
        ...finalShapeData,
        fillColor: '#00000000',  // Transparent fill by default
        strokeWidth: 0,          // No stroke by default
        blurAmount: 10,          // Default blur amount
      };
    }

    const newClip: Clip = {
      id: uuidv4(),
      sourceVideoId: '', // Empty for overlay clips
      name: shapeType === 'blur' ? 'Blur Region' : shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
      startTime: 0,
      endTime: clipDuration,
      duration: clipDuration,
      trackId: targetTrackId,
      timelinePosition: position ?? currentTime,
      blendMode: 'normal',
      transform: { ...DEFAULT_TRANSFORM },
      effects: { ...DEFAULT_EFFECTS },
      transition: { ...DEFAULT_TRANSITION },
      overlayType: 'shape',
      shapeData: finalShapeData,
    };

    const newClips = [...state.project.timeline.clips, newClip];

    set({
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedClipId: newClip.id,
      selectedOverlayId: null,
      selectedOverlayType: null,
      history: pushToHistory(state),
    });

    return newClip;
  },

  updateTextOverlayData: (clipId: string, textData: Partial<TextOverlayData>, skipHistory?: boolean) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId || clip.overlayType !== 'text') return clip;
      return {
        ...clip,
        textData: { ...clip.textData!, ...textData },
        name: textData.text ?? clip.name, // Update name if text changes
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: skipHistory ? state.history : pushToHistory(state),
    };
  }),

  updateShapeOverlayData: (clipId: string, shapeData: Partial<ShapeOverlayData>, skipHistory?: boolean) => set((state) => {
    const newClips = state.project.timeline.clips.map(clip => {
      if (clip.id !== clipId || clip.overlayType !== 'shape') return clip;
      const updatedData = { ...clip.shapeData!, ...shapeData };
      return {
        ...clip,
        shapeData: updatedData,
        name: shapeData.type ? shapeData.type.charAt(0).toUpperCase() + shapeData.type.slice(1) : clip.name,
      };
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
        },
      },
      history: skipHistory ? state.history : pushToHistory(state),
    };
  }),

  // Legacy text overlay actions (for backwards compatibility)
  addTextOverlay: (overlayData?) => {
    const state = get();
    const currentTime = state.currentTime;
    const timelineDuration = state.project.timeline.duration;

    const newOverlay: TextOverlay = {
      ...DEFAULT_TEXT_OVERLAY,
      ...overlayData,
      id: uuidv4(),
      startTime: overlayData?.startTime ?? currentTime,
      endTime: overlayData?.endTime ?? Math.max(currentTime + 5, timelineDuration),
    };

    set({
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          textOverlays: [...(state.project.timeline.textOverlays || []), newOverlay],
        },
      },
      selectedOverlayId: newOverlay.id,
      selectedOverlayType: 'text',
      selectedClipId: null, // Deselect clip when selecting overlay
      history: pushToHistory(state),
    });

    return newOverlay;
  },

  updateTextOverlay: (id: string, updates: Partial<TextOverlay>) => set((state) => {
    const newOverlays = (state.project.timeline.textOverlays || []).map(overlay =>
      overlay.id === id ? { ...overlay, ...updates } : overlay
    );

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          textOverlays: newOverlays,
        },
      },
      history: pushToHistory(state),
    };
  }),

  removeTextOverlay: (id: string) => set((state) => ({
    project: {
      ...state.project,
      modified: Date.now(),
      timeline: {
        ...state.project.timeline,
        textOverlays: (state.project.timeline.textOverlays || []).filter(o => o.id !== id),
      },
    },
    selectedOverlayId: state.selectedOverlayId === id ? null : state.selectedOverlayId,
    selectedOverlayType: state.selectedOverlayId === id ? null : state.selectedOverlayType,
    history: pushToHistory(state),
  })),

  // Shape overlay actions
  addShapeOverlay: (overlayData?) => {
    const state = get();
    const currentTime = state.currentTime;
    const timelineDuration = state.project.timeline.duration;

    const newOverlay: ShapeOverlay = {
      ...DEFAULT_SHAPE_OVERLAY,
      ...overlayData,
      id: uuidv4(),
      startTime: overlayData?.startTime ?? currentTime,
      endTime: overlayData?.endTime ?? Math.max(currentTime + 5, timelineDuration),
    };

    set({
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          shapeOverlays: [...(state.project.timeline.shapeOverlays || []), newOverlay],
        },
      },
      selectedOverlayId: newOverlay.id,
      selectedOverlayType: 'shape',
      selectedClipId: null, // Deselect clip when selecting overlay
      history: pushToHistory(state),
    });

    return newOverlay;
  },

  updateShapeOverlay: (id: string, updates: Partial<ShapeOverlay>) => set((state) => {
    const newOverlays = (state.project.timeline.shapeOverlays || []).map(overlay =>
      overlay.id === id ? { ...overlay, ...updates } : overlay
    );

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          shapeOverlays: newOverlays,
        },
      },
      history: pushToHistory(state),
    };
  }),

  removeShapeOverlay: (id: string) => set((state) => ({
    project: {
      ...state.project,
      modified: Date.now(),
      timeline: {
        ...state.project.timeline,
        shapeOverlays: (state.project.timeline.shapeOverlays || []).filter(o => o.id !== id),
      },
    },
    selectedOverlayId: state.selectedOverlayId === id ? null : state.selectedOverlayId,
    selectedOverlayType: state.selectedOverlayId === id ? null : state.selectedOverlayType,
    history: pushToHistory(state),
  })),

  // Playback actions
  setCurrentTime: (time: number) => set({ currentTime: time }),
  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),

  // Selection actions
  setSelectedClipId: (id: string | null) => set({
    selectedClipId: id,
    selectedClipIds: new Set<string>(), // Clear multi-selection on single click
    // Deselect overlay when selecting clip
    selectedOverlayId: id ? null : undefined,
    selectedOverlayType: id ? null : undefined,
  }),
  setSelectedTrackId: (id: string | null) => set({ selectedTrackId: id }),
  setSelectedOverlay: (id: string | null, type: 'text' | 'shape' | null) => set({
    selectedOverlayId: id,
    selectedOverlayType: type,
    selectedClipId: id ? null : undefined, // Deselect clip when selecting overlay
  }),

  // Multi-Select actions
  toggleClipSelection: (clipId: string) => set((state) => {
    const newSet = new Set(state.selectedClipIds);
    if (newSet.has(clipId)) {
      newSet.delete(clipId);
      // If set is now empty, clear primary selection too
      if (newSet.size === 0) {
        return { selectedClipIds: newSet, selectedClipId: null };
      }
      return { selectedClipIds: newSet };
    } else {
      newSet.add(clipId);
      return { selectedClipIds: newSet, selectedClipId: clipId };
    }
  }),

  selectClipsInRange: (clipIds: string[]) => set(() => ({
    selectedClipIds: new Set(clipIds),
    selectedClipId: clipIds.length > 0 ? clipIds[clipIds.length - 1] : null,
  })),

  clearMultiSelection: () => set({
    selectedClipIds: new Set<string>(),
    selectedClipId: null,
  }),

  moveSelectedClips: (deltaTime: number, deltaTrack: number) => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    const tracks = state.project.timeline.tracks;
    const sortedTracks = [...tracks].sort((a, b) => a.index - b.index);
    const trackIndexMap = new Map(sortedTracks.map((t, i) => [t.id, i]));

    const newClips = state.project.timeline.clips.map(clip => {
      if (!state.selectedClipIds.has(clip.id)) return clip;

      const updatedClip = { ...clip };

      // Adjust timeline position
      if (deltaTime !== 0) {
        updatedClip.timelinePosition = Math.max(0, clip.timelinePosition + deltaTime);
      }

      // Move to different track if deltaTrack !== 0
      if (deltaTrack !== 0) {
        const currentTrackIdx = trackIndexMap.get(clip.trackId);
        if (currentTrackIdx !== undefined) {
          const newTrackIdx = Math.max(0, Math.min(sortedTracks.length - 1, currentTrackIdx + deltaTrack));
          updatedClip.trackId = sortedTracks[newTrackIdx].id;
        }
      }

      return updatedClip;
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      history: pushToHistory(state),
    };
  }),

  deleteSelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    const newClips = state.project.timeline.clips.filter(
      clip => !state.selectedClipIds.has(clip.id)
    );

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      history: pushToHistory(state),
    };
  }),

  copySelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    const selectedClips = state.project.timeline.clips
      .filter(clip => state.selectedClipIds.has(clip.id))
      .map(clip => cloneClip(clip));

    return { clipboard: selectedClips };
  }),

  pasteClips: () => set((state) => {
    if (!state.clipboard || state.clipboard.length === 0) return state;

    // Find the earliest position among clipboard clips to calculate offsets
    const minPosition = Math.min(...state.clipboard.map(c => c.timelinePosition));

    const newClips = state.clipboard.map(clip => ({
      ...cloneClip(clip),
      id: uuidv4(),
      timelinePosition: clip.timelinePosition - minPosition + (state.currentTime || minPosition + 0.5),
    }));

    const allClips = [...state.project.timeline.clips, ...newClips];
    const newSelectedIds = new Set(newClips.map(c => c.id));

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: allClips,
          duration: calculateTimelineDuration(allClips),
        },
      },
      selectedClipIds: newSelectedIds,
      selectedClipId: newClips[newClips.length - 1].id,
      history: pushToHistory(state),
    };
  }),

  muteSelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    // Find which tracks contain selected clips
    const trackIdsToMute = new Set<string>();
    for (const clip of state.project.timeline.clips) {
      if (state.selectedClipIds.has(clip.id)) {
        trackIdsToMute.add(clip.trackId);
      }
    }

    const newTracks = state.project.timeline.tracks.map(track => {
      if (trackIdsToMute.has(track.id)) {
        return { ...track, muted: true };
      }
      return track;
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks: newTracks,
        },
      },
      history: pushToHistory(state),
    };
  }),

  unmuteSelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    // Find which tracks contain selected clips
    const trackIdsToUnmute = new Set<string>();
    for (const clip of state.project.timeline.clips) {
      if (state.selectedClipIds.has(clip.id)) {
        trackIdsToUnmute.add(clip.trackId);
      }
    }

    const newTracks = state.project.timeline.tracks.map(track => {
      if (trackIdsToUnmute.has(track.id)) {
        return { ...track, muted: false };
      }
      return track;
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks: newTracks,
        },
      },
      history: pushToHistory(state),
    };
  }),

  // UI actions
  setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setSnapEnabled: (enabled: boolean) => set({ snapEnabled: enabled }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setLoopPlayback: (enabled: boolean) => set({ loopPlayback: enabled }),

  recalculateTimelineDuration: () => set((state) => ({
    project: {
      ...state.project,
      timeline: {
        ...state.project.timeline,
        duration: calculateTimelineDuration(state.project.timeline.clips),
      },
    },
  })),

  // Marker actions
  addMarker: (time: number, label?: string, color?: string) => {
    const marker = {
      id: uuidv4(),
      time,
      label: label || '',
      color: color || '#ffcc00',
    };
    set((state) => ({
      markers: [...state.markers, marker].sort((a, b) => a.time - b.time),
    }));
    return marker;
  },

  removeMarker: (markerId: string) => set((state) => ({
    markers: state.markers.filter((m) => m.id !== markerId),
  })),

  updateMarker: (markerId: string, updates: Partial<{ time: number; label: string; color: string }>) => set((state) => ({
    markers: state.markers
      .map((m) => (m.id === markerId ? { ...m, ...updates } : m))
      .sort((a, b) => a.time - b.time),
  })),

  clearMarkers: () => set({ markers: [] }),

  goToNextMarker: () => set((state) => {
    const nextMarker = state.markers.find((m) => m.time > state.currentTime);
    if (nextMarker) {
      return { currentTime: nextMarker.time };
    }
    return {};
  }),

  goToPreviousMarker: () => set((state) => {
    const previousMarkers = state.markers.filter((m) => m.time < state.currentTime);
    if (previousMarkers.length > 0) {
      const prevMarker = previousMarkers[previousMarkers.length - 1];
      return { currentTime: prevMarker.time };
    }
    return {};
  }),

  // Keyframe panel actions
  setKeyframePanelOpen: (open: boolean) => set((state) => ({
    keyframePanelState: { ...state.keyframePanelState, isOpen: open },
  })),

  setKeyframePanelPosition: (position: { x: number; y: number }) => set((state) => ({
    keyframePanelState: { ...state.keyframePanelState, position },
  })),

  setKeyframePanelSize: (size: { width: number; height: number }) => set((state) => ({
    keyframePanelState: { ...state.keyframePanelState, size },
  })),

  setKeyframePanelSelectedProperty: (property: AnimatableProperty | null) => set((state) => ({
    keyframePanelState: { ...state.keyframePanelState, selectedProperty: property },
  })),

  setKeyframePanelZoom: (zoom: number) => set((state) => ({
    keyframePanelState: { ...state.keyframePanelState, graphZoom: Math.max(0.5, Math.min(4, zoom)) },
  })),

  // Undo/Redo actions
  undo: () => set((state) => {
    if (state.history.past.length === 0) return state;

    const previous = state.history.past[state.history.past.length - 1];
    const newPast = state.history.past.slice(0, -1);

    // Save current state to future
    const currentSnapshot = getUndoableState(state);

    return {
      project: previous.project,
      sourceVideos: previous.sourceVideos,
      history: {
        past: newPast,
        future: [currentSnapshot, ...state.history.future],
      },
    };
  }),

  redo: () => set((state) => {
    if (state.history.future.length === 0) return state;

    const next = state.history.future[0];
    const newFuture = state.history.future.slice(1);

    // Save current state to past
    const currentSnapshot = getUndoableState(state);

    return {
      project: next.project,
      sourceVideos: next.sourceVideos,
      history: {
        past: [...state.history.past, currentSnapshot],
        future: newFuture,
      },
    };
  }),

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,

  clearHistory: () => set({
    history: { past: [], future: [] },
  }),
}));

// Ensure timeline has tracks and overlays arrays (migration helper)
function ensureTimelineHasTracks(project: Project): Project {
  // Ensure resolution exists (migration for older projects)
  if (!project.resolution) {
    project = { ...project, resolution: { width: 1280, height: 720 } };
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
    // Just ensure overlay arrays exist
    return {
      ...project,
      timeline: {
        ...timeline,
        textOverlays,
        shapeOverlays,
      },
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
    timeline: {
      tracks: timeline.tracks?.length > 0 ? timeline.tracks : [defaultTrack],
      clips: migratedClips,
      textOverlays,
      shapeOverlays,
      duration: calculateTimelineDuration(migratedClips),
    },
  };
}

// Selectors for common derived state
export const selectTimelineDuration = (state: EditorState) => state.project.timeline.duration;
export const selectClipCount = (state: EditorState) => state.project.timeline.clips.length;
export const selectSelectedClip = (state: EditorState) =>
  state.project.timeline.clips.find((c) => c.id === state.selectedClipId);
export const selectSelectedTrack = (state: EditorState) =>
  state.project.timeline.tracks.find((t) => t.id === state.selectedTrackId);

// Get all clips at a specific timeline time, sorted by track index (for compositing)
export function getClipsAtTime(
  clips: Clip[],
  tracks: Track[],
  time: number
): { clip: Clip; clipTime: number; track: Track }[] {
  const results: { clip: Clip; clipTime: number; track: Track }[] = [];
  const trackMap = new Map(tracks.map(t => [t.id, t]));

  for (const clip of clips) {
    const clipEnd = clip.timelinePosition + clip.duration;
    if (time >= clip.timelinePosition && time < clipEnd) {
      const track = trackMap.get(clip.trackId);
      if (track && track.visible) {
        results.push({
          clip,
          clipTime: time - clip.timelinePosition,
          track,
        });
      }
    }
  }

  // Sort by track index (lower index = rendered first/bottom)
  results.sort((a, b) => a.track.index - b.track.index);
  return results;
}

// Legacy helper - get single clip at time (for backwards compatibility)
export function getClipAtTime(clips: Clip[], time: number): { clip: Clip; clipTime: number } | null {
  for (const clip of clips) {
    const clipEnd = clip.timelinePosition + clip.duration;
    if (time >= clip.timelinePosition && time < clipEnd) {
      return {
        clip,
        clipTime: time - clip.timelinePosition,
      };
    }
  }
  return null;
}

// Get timeline position for a clip (now just returns timelinePosition)
export function getClipPosition(clips: Clip[], clipId: string): number {
  const clip = clips.find(c => c.id === clipId);
  return clip?.timelinePosition ?? -1;
}

// Get snap points from all clip edges
export function getSnapPoints(clips: Clip[], excludeClipId?: string): number[] {
  const points: Set<number> = new Set([0]); // Always snap to start

  for (const clip of clips) {
    if (clip.id === excludeClipId) continue;
    points.add(clip.timelinePosition);
    points.add(clip.timelinePosition + clip.duration);
  }

  return Array.from(points).sort((a, b) => a - b);
}

// Find nearest snap point within threshold
export function findNearestSnapPoint(
  position: number,
  snapPoints: number[],
  threshold: number
): number | null {
  let nearest: number | null = null;
  let minDistance = threshold;

  for (const point of snapPoints) {
    const distance = Math.abs(position - point);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = point;
    }
  }

  return nearest;
}

// Check if clip placement would overlap with another on same track
export function wouldOverlap(
  clips: Clip[],
  trackId: string,
  position: number,
  duration: number,
  excludeClipId?: string
): boolean {
  const end = position + duration;

  for (const clip of clips) {
    if (clip.trackId !== trackId) continue;
    if (clip.id === excludeClipId) continue;

    const clipEnd = clip.timelinePosition + clip.duration;
    // Overlap if ranges intersect
    if (position < clipEnd && end > clip.timelinePosition) {
      return true;
    }
  }

  return false;
}
