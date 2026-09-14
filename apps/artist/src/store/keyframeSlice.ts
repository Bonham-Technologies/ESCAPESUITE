// Keyframe slice: the per-clip animation curves and the floating keyframe panel
// that edits them. `setClipKeyframe` is the one that does more than store what
// it is given — the first keyframe a property gets away from time 0 also seeds a
// keyframe AT 0 holding that property's current base value, so there is always a
// "from" value to animate out of.

import type { StateCreator } from 'zustand';
import type { EditorState, ClipTransform, AnimatableProperty, Keyframe } from './types';
import { DEFAULT_ANIMATION, DEFAULT_KEYFRAME_PANEL_STATE } from './types';
import { pushToHistory } from './storeHistory';

export type KeyframeSlice = Pick<EditorState, 'keyframePanelState' | 'setClipKeyframe' | 'removeClipKeyframe' | 'moveClipKeyframe' | 'clearClipKeyframes' | 'setKeyframePanelOpen' | 'setKeyframePanelPosition' | 'setKeyframePanelSize' | 'setKeyframePanelSelectedProperty' | 'setKeyframePanelZoom'>;

export const createKeyframeSlice: StateCreator<EditorState, [], [], KeyframeSlice> = (set) => ({
  keyframePanelState: DEFAULT_KEYFRAME_PANEL_STATE,

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
