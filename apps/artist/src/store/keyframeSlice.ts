// Keyframe slice: the per-clip animation curves and the floating keyframe panel
// that edits them. `setClipKeyframe` is the one that does more than store what
// it is given — the very first keyframe a property EVER gets, if it isn't
// already at time 0, also seeds a keyframe AT 0 holding that property's
// current base value, so there is always a "from" value to animate out of.
// Gated on the property having no keyframes before this write, not on the
// written-out array happening to lack one at 0 (ESCSUITE-166) — the latter is
// also true on every later write, so a 0 keyframe the user deleted or moved
// away would silently come back on the next unrelated edit to that property.
//
// `setClipKeyframe` and `moveClipKeyframe` also take a trailing `skipHistory`,
// exactly as `clipSlice`'s `updateClipTransform` does: the edit lands, but no
// undo entry is pushed. The keyframe graph's keyboard passes the keydown's own
// `repeat` flag there, which makes a held arrow key one undo step rather than
// one per auto-repeat.
//
// Those two therefore also **report whether they wrote** (ESCSUITE-87): their
// lock guard sits before the `set` and reads through `get()`, they answer `false`
// when it refuses and `true` otherwise, so a caller threading `skipHistory` into
// a later write can tell that its first one never landed. See the shared doc
// comment on `EditorState` in `types.ts`.

import type { StateCreator } from 'zustand';
import type { EditorState, ClipTransform, AnimatableProperty, Keyframe } from './types';
import { DEFAULT_ANIMATION, DEFAULT_KEYFRAME_PANEL_STATE } from './types';
import { pushToHistory } from './storeHistory';
import { clipOnLockedTrack } from './trackLock';
import { KEYFRAME_TIME_EPSILON } from '../utils/animation';

export type KeyframeSlice = Pick<EditorState, 'keyframePanelState' | 'setClipKeyframe' | 'removeClipKeyframe' | 'moveClipKeyframe' | 'clearClipKeyframes' | 'setKeyframePanelOpen' | 'setKeyframePanelPosition' | 'setKeyframePanelSize' | 'setKeyframePanelSelectedProperty' | 'setKeyframePanelZoom'>;

export const createKeyframeSlice: StateCreator<EditorState, [], [], KeyframeSlice> = (set, get) => ({
  keyframePanelState: DEFAULT_KEYFRAME_PANEL_STATE,

  // ESCSUITE-84: a locked track's contents are frozen. Every one of the four
  // clip-keyframe actions below asks `trackLock.ts`'s question first and
  // returns `state` unchanged when the clip is on a locked track — the five
  // panel-UI setters below them are untouched, since they hold no clip id. See
  // the spec at .superpowers/sdd/2026-09-26-escsuite-84-track-lock/.
  setClipKeyframe: (clipId: string, property: AnimatableProperty, keyframe: Keyframe, skipHistory?: boolean) => {
    const { clips, tracks } = get().project.timeline;
    if (clipOnLockedTrack(clips, tracks, clipId)) return false; // ESCSUITE-84
    // ESCSUITE-172: the same map-and-set shape as updateClip — an id that
    // names no clip matches nothing in the `map` below, and the `set` would
    // still run.
    if (!clips.some((c) => c.id === clipId)) return false;

    set((state) => {
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

        // AUTO-CREATE START KEYFRAME: If this is the first keyframe this property has
        // EVER had (nothing there before this write) and it's not at time 0, create a
        // keyframe at time 0 with the base value, so there is always a "from" value to
        // animate from. Gated on `currentKeyframes` (the state before this write), not
        // on whether `newKeyframes` happens to lack one at 0 — that was true on every
        // later write too, so a keyframe at 0 the user deleted, or dragged away from 0,
        // silently came back on the next unrelated edit (ESCSUITE-166).
        if (currentKeyframes.length === 0 && Math.abs(keyframe.time) >= 0.001) {
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
        // Same flag, and the same shape, as updateClipTransform's: a run of edits
        // the caller wants collapsed pushes on its first call and skips the rest.
        history: skipHistory ? state.history : pushToHistory(state),
      };
    });

    return true;
  },

  // Its guard sits in front of the `set` rather than inside it, and it reports
  // back, because the keyframe graph's Delete key *announces* the removal
  // (ESCSUITE-88): the same reason the two beside it report (ESCSUITE-87), even
  // though nothing threads a `skipHistory` through this one.
  removeClipKeyframe: (clipId: string, property: AnimatableProperty, time: number) => {
    const { clips, tracks } = get().project.timeline;
    if (clipOnLockedTrack(clips, tracks, clipId)) return false; // ESCSUITE-84

    // ESCSUITE-101: false, with nothing written, for an unknown clip, a
    // property the clip has no keyframes on, or a time with no keyframe
    // within KEYFRAME_TIME_EPSILON — the three ways this used to push an undo
    // entry that removed nothing at all.
    const targetClip = clips.find((c) => c.id === clipId);
    const targetKeyframes = targetClip?.animation?.keyframes[property];
    const hasMatch = targetKeyframes?.some(
      (kf) => Math.abs(kf.time - time) < KEYFRAME_TIME_EPSILON
    ) ?? false;
    if (!hasMatch) return false;

    set((state) => {
      const newClips = state.project.timeline.clips.map(clip => {
        if (clip.id !== clipId) return clip;
        const currentAnimation = clip.animation;
        if (!currentAnimation) return clip;

        const currentKeyframes = currentAnimation.keyframes[property];
        if (!currentKeyframes) return clip;

        const newKeyframes = currentKeyframes.filter(kf => Math.abs(kf.time - time) >= KEYFRAME_TIME_EPSILON);

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
    });

    return true;
  },

  moveClipKeyframe: (clipId: string, property: AnimatableProperty, originalTime: number, newTime: number, skipHistory?: boolean) => {
    const { clips, tracks } = get().project.timeline;
    if (clipOnLockedTrack(clips, tracks, clipId)) return false; // ESCSUITE-84
    if (!clips.some((c) => c.id === clipId)) return false; // ESCSUITE-172

    // ESCSUITE-163 / m2: false, with nothing written and no undo entry pushed,
    // for an unknown clip, a property the clip has no keyframes on, or an
    // originalTime holding no keyframe — the same three refusals
    // removeClipKeyframe gained in ESCSUITE-101, and for the same reason: the
    // `=> boolean` contract in types.ts means `false` is a promise that
    // nothing changed, which a caller threading `skipHistory` into a later
    // write (or announcing the move, as the graph's keyboard does) depends on.
    const targetClip = clips.find((c) => c.id === clipId);
    const targetKeyframes = targetClip?.animation?.keyframes[property];
    const hasMatch = targetKeyframes?.some(
      (kf) => Math.abs(kf.time - originalTime) < KEYFRAME_TIME_EPSILON
    ) ?? false;
    if (!hasMatch) return false;

    set((state) => {
      const newClips = state.project.timeline.clips.map(clip => {
        if (clip.id !== clipId) return clip;
        const currentAnimation = clip.animation;
        if (!currentAnimation) return clip;

        const currentKeyframes = currentAnimation.keyframes[property];
        if (!currentKeyframes) return clip;

        // Find the keyframe to move
        const keyframeToMove = currentKeyframes.find(kf => Math.abs(kf.time - originalTime) < KEYFRAME_TIME_EPSILON);
        if (!keyframeToMove) return clip;

        // Remove any existing keyframe at the new time, then update the moved keyframe's time
        const newKeyframes = currentKeyframes
          .filter(kf => Math.abs(kf.time - originalTime) >= KEYFRAME_TIME_EPSILON && Math.abs(kf.time - newTime) >= KEYFRAME_TIME_EPSILON)
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
        // Same skipHistory contract as setClipKeyframe above: an Alt+Arrow run
        // held down is one undo step, not one per auto-repeat.
        history: skipHistory ? state.history : pushToHistory(state),
      };
    });

    return true;
  },

  // `=> boolean` since fix round 1 of ESCSUITE-172: this had no existence
  // check at all — not even splitClip/duplicateClip's `if (!clip) return
  // state` — so an unknown clip id, or a clip with no animation, still
  // matched nothing in the `map` below while the `set` ran anyway. It now
  // refuses for the same two reasons removeClipKeyframe does (ESCSUITE-101):
  // there is nothing to clear either way. No production caller exists today
  // (it is reachable only from a test or a future UI wire-up), so this adds
  // no behaviour change for any live code path.
  clearClipKeyframes: (clipId: string, property?: AnimatableProperty) => {
    const { clips, tracks } = get().project.timeline;
    if (clipOnLockedTrack(clips, tracks, clipId)) return false; // ESCSUITE-84
    const targetClip = clips.find((c) => c.id === clipId);
    if (!targetClip?.animation) return false; // ESCSUITE-172

    set((state) => {
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
    });

    return true;
  },

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
