// Clip slice: everything that adds, removes, moves or restyles a timeline clip.
// Actions that change which clips exist or where they sit recompute
// `timeline.duration`; the ones that only restyle a clip deliberately do not.
// `recalculateTimelineDuration` is the odd one out — it rewrites the duration
// alone, recording no undo step and leaving `modified` untouched.

import { v4 as uuidv4 } from 'uuid';
import type { StateCreator } from 'zustand';
import type { EditorState, Clip, ClipTransform, ClipEffects, BlendMode, Transition, ClipAnimation, TakeClipPart } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION, DEFAULT_ANIMATION } from './types';
import { cloneClip } from '../utils/deepClone';
import { pushToHistory } from './storeHistory';
import { createTrackAtTop, findEmptyTrack, calculateTimelineDuration } from './projectFactory';
import {
  maskForPlacement,
  overlayPlacementToTransform,
  strokeForPlacement,
} from '../utils/overlayPlacement';

export type ClipSlice = Pick<EditorState, 'addClipToTimeline' | 'placeTakeOnTimeline' | 'removeClipFromTimeline' | 'rippleDeleteClip' | 'shiftClipsAfter' | 'updateClip' | 'splitClip' | 'moveClipToTrack' | 'setClipTimelinePosition' | 'updateClipTransform' | 'updateClipBlendMode' | 'updateClipEffects' | 'updateClipTransition' | 'updateClipAnimation' | 'duplicateClip' | 'recalculateTimelineDuration'>;

export const createClipSlice: StateCreator<EditorState, [], [], ClipSlice> = (set) => ({
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

  // A whole take at once (ESCSUITE-14). Deliberately not a run of
  // addClipToTimeline calls: one `set` makes "one undo step" a property of the
  // code rather than a convention, and every part's position is measured
  // against the *same* timeline — a run would measure each part against a
  // timeline the part before it had already lengthened.
  placeTakeOnTimeline: (parts: TakeClipPart[]) => set((state) => {
    // Every part missing is a real case (the caller skips a part whose blob is
    // gone). Placing nothing must not record an undo step that undoes nothing,
    // or leave an empty track behind.
    if (parts.length === 0) return state;

    const timeline = state.project.timeline;
    // Append at the end of whatever is already there. An empty timeline
    // measures 0, so the ordinary import still starts at 0 and this needs no
    // special case for it.
    const takeStart = calculateTimelineDuration(timeline.clips);

    const tracks = [...timeline.tracks];
    const clips = [...timeline.clips];
    // The primary takes the track a drop from the media library would take —
    // the lowest-index empty one — which is addClipToTimeline's own rule. A
    // companion may never reuse an empty track: the webcam belongs *above* the
    // screen, and an empty low-index track would put it underneath.
    const primaryTrack = findEmptyTrack(tracks, clips);

    // The rectangle the overlay sat in a corner of: the primary's own drawn
    // rect, not the canvas. Every part imports at native pixels centred on the
    // canvas (scale 1), so a capture smaller or larger than the project is
    // drawn in a rectangle of its own — and the camera was in a corner of
    // *that* while recording. A primary with no stored dimensions (nothing
    // ESCAPECRAFT writes, but IndexedDB is not type-checked) leaves the whole
    // canvas as the frame, which is `overlayPlacementToTransform`'s default.
    // Which part that is, is asked of the parts rather than taken as `parts[0]`
    // (ESCSUITE-71). The primary *is* first, by `app/takeImport.ts`'s contract,
    // but a take's audio companions have no picture at all — they arrive 0x0 —
    // and an audio part read as the frame means "the whole canvas", which is a
    // wrong answer that looks like a default. So the frame comes from the
    // take's first part that has a picture, which on every take ESCAPECRAFT
    // writes is the primary.
    const resolution = state.project.resolution;
    const framePart = parts.find((part) => part.mediaType !== 'audio');
    const overlayFrame =
      framePart !== undefined && framePart.width > 0 && framePart.height > 0
        ? {
            left: (resolution.width - framePart.width) / 2,
            top: (resolution.height - framePart.height) / 2,
            width: framePart.width,
            height: framePart.height,
          }
        : undefined;

    parts.forEach((part, index) => {
      let trackId: string;
      if (index === 0 && primaryTrack) {
        trackId = primaryTrack.id;
      } else {
        const created = createTrackAtTop(tracks);
        tracks.push(created);
        trackId = created.id;
      }

      // The placement the camera was drawn with, or nothing — asked once, so
      // the transform, the mask and the stroke cannot disagree about whether
      // this part is the take's camera. An audio part never takes any of the
      // three: it is never drawn, so a picture property on it would be a number
      // nobody reads that looks like a decision (ESCSUITE-71).
      const placement = part.mediaType !== 'audio' ? part.overlayPlacement : undefined;

      clips.push({
        id: uuidv4(),
        sourceVideoId: part.sourceVideoId,
        name: part.name,
        startTime: 0,
        endTime: part.duration,
        duration: part.duration,
        trackId,
        timelinePosition: takeStart + part.startOffset,
        blendMode: 'normal',
        // The part that carries the overlay placement is the one the camera was
        // drawn into; everything else imports at native size, centred, like any
        // other clip.
        //
        // **An audio part takes the default transform, always** (ESCSUITE-71).
        // It is never drawn — `previewGeometry.getOverlayBounds` answers no
        // bounds for one and both renderers skip it — so the numbers here are
        // never read; it carries the whole default rather than nothing because
        // `Clip.transform` is a required field. Stated rather than left to the
        // 0x0 dimensions such a part arrives with, which reached the same place
        // by accident. The same question decides the mask and the stroke
        // (ESCSUITE-65).
        transform: placement
          ? overlayPlacementToTransform(placement, resolution, part, overlayFrame)
          : { ...DEFAULT_TRANSFORM },
        // ESCSUITE-65: the shape and the border the camera was recorded with,
        // mapped beside the corner and the size rather than bolted on after.
        // Spread conditionally so a part that is not the camera produces the
        // same clip object it produced before this ticket — byte for byte, not
        // just `toEqual`-equal.
        ...(placement
          ? {
              mask: maskForPlacement(placement, overlayFrame ?? resolution, part),
              stroke: strokeForPlacement(overlayFrame ?? resolution, resolution),
            }
          : {}),
        effects: { ...DEFAULT_EFFECTS },
        transition: { ...DEFAULT_TRANSITION },
      });
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...timeline,
          tracks,
          clips,
          duration: calculateTimelineDuration(clips),
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

  recalculateTimelineDuration: () => set((state) => ({
    project: {
      ...state.project,
      timeline: {
        ...state.project.timeline,
        duration: calculateTimelineDuration(state.project.timeline.clips),
      },
    },
  })),
});
