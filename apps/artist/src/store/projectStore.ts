// Zustand store for project state management

import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { EditorState, Clip, ClipTransform, ClipEffects, BlendMode, Transition, TextOverlayData, ShapeOverlayData, ClipAnimation, AnimatableProperty, Keyframe } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION, DEFAULT_TEXT_OVERLAY_DATA, DEFAULT_SHAPE_OVERLAY_DATA, DEFAULT_ANIMATION, DEFAULT_KEYFRAME_PANEL_STATE } from './types';
import { cloneClip } from '../utils/deepClone';
import { pushToHistory } from './storeHistory';
import { createTrackAtTop, findEmptyTrack, calculateTimelineDuration } from './projectFactory';
import { createHistorySlice, type HistorySlice } from './historySlice';
import { createPlaybackSlice, type PlaybackSlice } from './playbackSlice';
import { createMarkerSlice, type MarkerSlice } from './markerSlice';
import { createUiSlice, type UiSlice } from './uiSlice';
import { createProjectSlice, type ProjectSlice } from './projectSlice';
import { createTrackSlice, type TrackSlice } from './trackSlice';

// The pure helpers moved to their own modules — none of them reads the store —
// and DEFAULT_PROJECT_NAME is re-exported here so every existing import path still resolves.
export { DEFAULT_PROJECT_NAME } from './projectFactory';

// Everything the slices have not claimed yet, kept inline and byte-unchanged so
// the split stays a provable move. Tasks 3-5 empty it slice by slice; Task 6
// deletes it and composes the store from slices alone.
type RemainingSlice = Omit<EditorState, keyof HistorySlice | keyof PlaybackSlice | keyof MarkerSlice | keyof UiSlice | keyof ProjectSlice | keyof TrackSlice>;

const createRemainingSlice: StateCreator<EditorState, [], [], RemainingSlice> = (set, get) => ({
  // Initial state
  selectedClipId: null,
  selectedClipIds: new Set<string>(),
  selectedTrackId: null,
  clipboard: null,
  keyframePanelState: DEFAULT_KEYFRAME_PANEL_STATE,

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

    // Import at 100% scale (native source pixels on canvas).
    // Scale 1.0 = actual source size. Use "Fit to Canvas" to fill.
    const initialScaleX = 1, initialScaleY = 1;

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
      // Seed from DEFAULT_TRANSITION the way updateClipAnimation seeds from DEFAULT_ANIMATION:
      // a clip loaded from a foreign project file can be missing `transition` entirely, and a
      // half-written `{ type }` with no duration crashes TransitionSection's `duration.toFixed(1)`.
      return {
        ...clip,
        transition: { ...DEFAULT_TRANSITION, ...clip.transition, ...transitionUpdates },
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

  // Selection actions
  setSelectedClipId: (id: string | null) => set({
    selectedClipId: id,
    selectedClipIds: new Set<string>(), // Clear multi-selection on single click
  }),
  setSelectedTrackId: (id: string | null) => set({ selectedTrackId: id }),

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

  recalculateTimelineDuration: () => set((state) => ({
    project: {
      ...state.project,
      timeline: {
        ...state.project.timeline,
        duration: calculateTimelineDuration(state.project.timeline.clips),
      },
    },
  })),

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
});

export const useEditorStore = create<EditorState>((...a) => ({
  ...createHistorySlice(...a),
  ...createPlaybackSlice(...a),
  ...createMarkerSlice(...a),
  ...createUiSlice(...a),
  ...createProjectSlice(...a),
  ...createTrackSlice(...a),
  ...createRemainingSlice(...a),
}));

// Selectors for common derived state
export const selectTimelineDuration = (state: EditorState) => state.project.timeline.duration;
export const selectClipCount = (state: EditorState) => state.project.timeline.clips.length;
export const selectSelectedClip = (state: EditorState) =>
  state.project.timeline.clips.find((c) => c.id === state.selectedClipId);
export const selectSelectedTrack = (state: EditorState) =>
  state.project.timeline.tracks.find((t) => t.id === state.selectedTrackId);

// The clip queries moved to ./clipQueries — they never read the store — and are
// re-exported here so every existing import path still resolves.
export { getClipsAtTime, getClipAtTime, getClipPosition } from './clipQueries';

// The snapping helpers moved to ./timelineSnapping — they never read the store —
// and are re-exported here so every existing import path still resolves.
export { getSnapPoints, findNearestSnapPoint, wouldOverlap } from './timelineSnapping';
