// Overlay slice: text and shape overlays, which are ordinary timeline clips with
// an empty `sourceVideoId` and an `overlayType`. The two adders return the clip
// they created and select it, so they read their pre-change state from `get()`
// and write a bare object through `set` rather than using an updater.

import { v4 as uuidv4 } from 'uuid';
import type { StateCreator } from 'zustand';
import type { EditorState, Clip, TextOverlayData, ShapeOverlayData } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION, DEFAULT_TEXT_OVERLAY_DATA, DEFAULT_SHAPE_OVERLAY_DATA } from './types';
import { pushToHistory } from './storeHistory';
import { createTrackAtTop, findEmptyTrack, calculateTimelineDuration } from './projectFactory';
import { clipOnLockedTrack, isTrackLocked } from './trackLock';

export type OverlaySlice = Pick<EditorState, 'addTextOverlayClip' | 'addShapeOverlayClip' | 'updateTextOverlayData' | 'updateShapeOverlayData'>;

export const createOverlaySlice: StateCreator<EditorState, [], [], OverlaySlice> = (set, get) => ({
  // Overlay clip actions (new clip-based overlays)
  //
  // ESCSUITE-84: a locked track's contents are frozen. Both adders refuse an
  // explicit locked track and both `update*OverlayData` actions refuse a clip
  // already on one — see the spec at
  // .superpowers/sdd/2026-09-26-escsuite-84-track-lock/.
  //
  // ESCSUITE-87: the two `update*OverlayData` actions, which a preview drag and
  // the inspector's sliders thread `skipHistory` through, guard before their
  // `set` and report `false` when that guard refuses. See the shared doc comment
  // on `EditorState` in `types.ts`.
  addTextOverlayClip: (textData?, trackId?, position?, duration?) => {
    const state = get();
    // An explicit locked track takes nothing (ESCSUITE-84); with no track named,
    // `findEmptyTrack` already skips the locked ones.
    if (isTrackLocked(state.project.timeline.tracks, trackId)) return null; // ESCSUITE-84
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
    // An explicit locked track takes nothing (ESCSUITE-84); with no track named,
    // `findEmptyTrack` already skips the locked ones.
    if (isTrackLocked(state.project.timeline.tracks, trackId)) return null; // ESCSUITE-84
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

  updateTextOverlayData: (clipId: string, textData: Partial<TextOverlayData>, skipHistory?: boolean) => {
    const { clips, tracks } = get().project.timeline;
    if (clipOnLockedTrack(clips, tracks, clipId)) return false; // ESCSUITE-84
    // ESCSUITE-172: the same map-and-set shape as updateClip — an id that
    // names no clip, OR a real clip that is not a text overlay, matches
    // nothing in the `map` below (it bypasses on exactly this condition), and
    // the `set` would still run. Fix round 1: the guard has to mirror the
    // `map`'s own bypass, not just check the id exists.
    if (!clips.some((c) => c.id === clipId && c.overlayType === 'text')) return false;

    set((state) => {
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
    });

    return true;
  },

  updateShapeOverlayData: (clipId: string, shapeData: Partial<ShapeOverlayData>, skipHistory?: boolean) => {
    const { clips, tracks } = get().project.timeline;
    if (clipOnLockedTrack(clips, tracks, clipId)) return false; // ESCSUITE-84
    // ESCSUITE-172 (fix round 1): matches the `map`'s own bypass below — id
    // AND overlayType — not existence alone.
    if (!clips.some((c) => c.id === clipId && c.overlayType === 'shape')) return false;

    set((state) => {
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
    });

    return true;
  },
});
