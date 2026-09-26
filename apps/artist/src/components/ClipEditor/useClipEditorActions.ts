// Everything the clip inspector reads from the store, and everything its
// controls write back.
//
// This is the whole of `ClipEditor`'s wiring: the selectors, the two derived
// values the sections share (`sourceVideo`, `track`), the clip classification,
// and one handler per control. It adds no state and no subscription of its own
// — the hook calls below are the ones that used to sit at the top of
// `ClipEditor`, in the same order and, `handleGoToClip` aside, with the same
// dependency arrays, so moving them here cannot change when anything
// re-renders. `handleGoToClip` now also depends on `selectedClip`, which it
// reads: its identity changes whenever the selected clip object does rather
// than only when the clip's position does. Its one consumer is
// `ActionsSection`'s unmemoised button `onClick`, which takes no identity
// dependency, so no render count moves.
//
// **The playhead is not among the selectors, and must not become one.** A
// `useEditorStore((s) => s.currentTime)` here re-rendered the entire inspector
// on every playback tick — and, because this hook runs above `ClipEditor`'s
// `!selectedClip` early return, it did so with nothing selected too. The only
// thing on the panel the playhead can change is whether Split is disabled, so
// that button subscribes to the derived boolean for itself (`SplitButton`) and
// `handleSplitAtPlayhead` reads `useEditorStore.getState().currentTime`,
// which is what a click needs and a render does not. `ClipEditor.rerender.test.tsx`
// holds the line.
//
// One of those arrays is wrong, and is kept wrong on purpose:
//   * `setScaleLocked` depends on `[]` and reaches for
//     `useEditorStore.getState()` three times instead of closing over the clip
//     it already has. That is also what keeps its identity stable across
//     renders, which `TransformSection` benefits from.
// Likewise the `scaleLocked` selector re-finds the clip that
// `selectSelectedClip` already selects, one line below it. Merging the two
// subscriptions would change how often the panel re-renders; they stay apart.
//
// **The slider handlers coalesce their undo entries** (ESCSUITE-75). A range
// input writes on every `input` event, so the five handlers a slider can reach
// — `handleTransformChange`, `handleBlurChange`, `handleMaskChange`,
// `handleStrokeChange` and, for an overlay's Pos X/Y, `handleTextDataChange` /
// `handleShapeDataChange` — ask `useSliderGesture` for the `skipHistory` flag at
// the moment they write. The gesture itself is the `sliderGesture` listeners
// returned below, which `ClipEditor` spreads onto each slider. One hook
// instance serves the whole panel: a user drags one slider at a time, and a
// press on the next one closes whatever the last one left open. It holds refs
// and no state, so it adds no subscription and no render — the handler
// identities are unchanged too, `skipHistoryForWrite` being stable across
// renders. A write that belongs to no gesture (every other control on the
// panel, and a section rendered on its own in a test) pushes its own entry
// exactly as before.
//
// The last two entries returned, `handleResetToDefaults` and
// `handleKeyframePanelToggle`, are deliberately *not* memoised: they were
// inline arrows in the JSX before this file existed, so a fresh function per
// render is their existing behaviour, and wrapping them in `useCallback` would
// be a new memo rather than a move.
import { useCallback, useMemo } from 'react';
import { useEditorStore, selectSelectedClip } from '../../store/projectStore';
import { DEFAULT_TRANSFORM, DEFAULT_CLIP_MASK_RADIUS } from '../../store/types';
import type {
  BlendMode,
  Clip,
  ClipMask,
  ClipStroke,
  TransitionType,
  ShapeType,
  SourceVideo,
  TextOverlayData,
  ShapeOverlayData,
  Track,
  AnimationPresetType,
  EasingType,
} from '../../store/types';
import { describeClip, relativeTimeInClip, fitToCanvasScale } from './clipEditorModel';
import { useSliderGesture } from './useSliderGesture';
import type { SliderGestureHandlers } from './useSliderGesture';

/** The store reads, derived values and handlers `ClipEditor` composes its sections from. */
export interface ClipEditorActions {
  /** The clip the panel is editing, or undefined when nothing is selected. */
  selectedClip: Clip | undefined;
  /** Whether the two scale axes move together (default true, for old projects). */
  scaleLocked: boolean;
  setScaleLocked: (locked: boolean) => void;
  /** The clip's source media, when it has one. */
  sourceVideo: SourceVideo | null | undefined;
  /** The track the clip sits on, for the header's third row. */
  track: Track | null | undefined;
  isTextOverlay: boolean;
  isShapeOverlay: boolean;
  isOverlay: boolean;
  isAudio: boolean;
  isVideo: boolean;
  clipTypeLabel: string;
  /** Where the clip starts on the timeline, in seconds. */
  clipPosition: number;
  /**
   * The project's frame width in pixels — what `clip.stroke.width` is a
   * fraction of, so the inspector can show it as the pixels the user sees.
   * Derived from the `resolution` selector this hook already had; it is not a
   * new subscription.
   */
  frameWidth: number;
  /** Whether the keyframe panel is open — the Animation section's toggle state. */
  keyframePanelOpen: boolean;
  /**
   * The gesture listeners every inspector slider spreads onto its
   * `<input type="range">`, so one drag is one undo step (ESCSUITE-75).
   */
  sliderGesture: SliderGestureHandlers;
  handleSplitAtPlayhead: () => void;
  handleDeleteClip: () => void;
  handleGoToClip: () => void;
  handleTransformChange: (key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'opacity', value: number) => void;
  handleDuplicate: () => void;
  handleBlendModeChange: (mode: BlendMode) => void;
  handleMaskChange: (mask: ClipMask) => void;
  handleStrokeChange: (stroke: ClipStroke) => void;
  handleBlurChange: (blur: number) => void;
  handleTransitionTypeChange: (type: TransitionType) => void;
  handleTransitionDurationChange: (duration: number) => void;
  handleAnimationInTypeChange: (type: AnimationPresetType) => void;
  handleAnimationInDurationChange: (duration: number) => void;
  handleAnimationInEasingChange: (easing: EasingType) => void;
  handleAnimationOutTypeChange: (type: AnimationPresetType) => void;
  handleAnimationOutDurationChange: (duration: number) => void;
  handleAnimationOutEasingChange: (easing: EasingType) => void;
  /** The Transform section header's Reset: position, scale, opacity and overlay data — not rotation. */
  handleResetTransform: () => void;
  handleFitToCanvas: () => void;
  handleTextDataChange: (updates: Partial<TextOverlayData>) => void;
  handleShapeDataChange: (updates: Partial<ShapeOverlayData>) => void;
  handleAddText: () => void;
  handleAddShape: (type: ShapeType) => void;
  /**
   * The scale row's Reset: the whole of `DEFAULT_TRANSFORM`, rotation included.
   * Only valid while a clip is selected — it reads `selectedClip.id` unguarded.
   */
  handleResetToDefaults: () => void;
  handleKeyframePanelToggle: () => void;
}

export function useClipEditorActions(): ClipEditorActions {
  // One gesture for the whole panel: its listeners go on every slider, and its
  // `skipHistory` answer is asked for at each write. Refs only — see the note
  // above, and `useSliderGesture.ts` for the rule.
  const { handlers: sliderGesture, skipHistoryForWrite } = useSliderGesture();

  // Read scaleLocked from the selected clip's transform (default true for backwards compat)
  const scaleLocked = useEditorStore((state) => {
    const clip = state.project.timeline.clips.find(c => c.id === state.selectedClipId);
    return clip?.transform.scaleLocked ?? true;
  });
  const setScaleLocked = useCallback((locked: boolean) => {
    const clip = useEditorStore.getState().project.timeline.clips.find(
      c => c.id === useEditorStore.getState().selectedClipId
    );
    if (clip) {
      useEditorStore.getState().updateClipTransform(clip.id, { scaleLocked: locked });
    }
  }, []);

  const selectedClip = useEditorStore(selectSelectedClip);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const resolution = useEditorStore((state) => state.project.resolution);

  const removeClipFromTimeline = useEditorStore((state) => state.removeClipFromTimeline);
  const splitClip = useEditorStore((state) => state.splitClip);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const updateClipTransform = useEditorStore((state) => state.updateClipTransform);
  const updateClipBlendMode = useEditorStore((state) => state.updateClipBlendMode);
  const updateClipEffects = useEditorStore((state) => state.updateClipEffects);
  const updateClipTransition = useEditorStore((state) => state.updateClipTransition);
  const updateClipAnimation = useEditorStore((state) => state.updateClipAnimation);
  // ESCSUITE-65's mask and stroke go through the `updateClip` that already
  // exists — it takes a Partial<Clip> and pushes history — so this feature adds
  // no store action and no member to ClipSlice's Pick. An *action* selector, in
  // the same shape as the thirteen above: an action's identity never changes, so
  // this cannot cost a re-render, and `ClipEditor.rerender.test.tsx` is what
  // holds that line.
  const updateClip = useEditorStore((state) => state.updateClip);
  const duplicateClip = useEditorStore((state) => state.duplicateClip);
  const updateTextOverlayData = useEditorStore((state) => state.updateTextOverlayData);
  const updateShapeOverlayData = useEditorStore((state) => state.updateShapeOverlayData);
  const addTextOverlayClip = useEditorStore((state) => state.addTextOverlayClip);
  const addShapeOverlayClip = useEditorStore((state) => state.addShapeOverlayClip);
  const setKeyframePanelOpen = useEditorStore((state) => state.setKeyframePanelOpen);
  const keyframePanelOpen = useEditorStore((state) => state.keyframePanelState.isOpen);

  const sourceVideo = useMemo(() => {
    if (!selectedClip) return null;
    return sourceVideos.find((v) => v.id === selectedClip.sourceVideoId);
  }, [selectedClip, sourceVideos]);

  const track = useMemo(() => {
    if (!selectedClip) return null;
    return tracks.find((t) => t.id === selectedClip.trackId);
  }, [selectedClip, tracks]);

  // Determine clip type
  const { isTextOverlay, isShapeOverlay, isOverlay, isAudio, isVideo, clipTypeLabel } =
    describeClip(selectedClip, sourceVideo);

  // Clip position is now stored directly on the clip
  const clipPosition = selectedClip?.timelinePosition ?? 0;

  // Where the playhead is inside the clip, read at click time rather than
  // subscribed to: see the note at the top of this file.
  const handleSplitAtPlayhead = useCallback(() => {
    if (!selectedClip) return;
    const timeInClip = relativeTimeInClip(
      useEditorStore.getState().currentTime,
      selectedClip.timelinePosition,
      selectedClip.duration
    );
    if (timeInClip === null || timeInClip <= 0) return;
    splitClip(selectedClip.id, timeInClip);
  }, [selectedClip, splitClip]);

  const handleDeleteClip = useCallback(() => {
    if (!selectedClip) return;
    if (confirm(`Delete clip "${selectedClip.name}"?`)) {
      removeClipFromTimeline(selectedClip.id);
    }
  }, [selectedClip, removeClipFromTimeline]);

  const handleGoToClip = useCallback(() => {
    if (!selectedClip) return;
    setCurrentTime(clipPosition);
  }, [selectedClip, clipPosition, setCurrentTime]);

  const handleTransformChange = useCallback(
    (key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'opacity', value: number) => {
      if (!selectedClip) return;

      // Asked once, before the branch: both arms are one write, and asking is
      // what marks the gesture as having pushed.
      const skipHistory = skipHistoryForWrite();

      // If scale is locked and changing one scale dimension, update both
      if (scaleLocked && (key === 'scaleX' || key === 'scaleY')) {
        updateClipTransform(selectedClip.id, { scaleX: value, scaleY: value }, skipHistory);
      } else {
        updateClipTransform(selectedClip.id, { [key]: value }, skipHistory);
      }
    },
    [selectedClip, updateClipTransform, scaleLocked, skipHistoryForWrite]
  );

  const handleDuplicate = useCallback(() => {
    if (!selectedClip) return;
    duplicateClip(selectedClip.id);
  }, [selectedClip, duplicateClip]);

  const handleBlendModeChange = useCallback(
    (mode: BlendMode) => {
      if (!selectedClip) return;
      updateClipBlendMode(selectedClip.id, mode);
    },
    [selectedClip, updateClipBlendMode]
  );

  // ESCSUITE-65. `MaskSection` reports what the user did; these decide what gets
  // stored, so the store only ever holds canonical shapes: no `{ kind: 'none' }`,
  // no `{ width: 0 }`, and no radius on a circle. A clip that was never masked
  // and one whose mask was removed are then the same object, which is what makes
  // `undefined === none` the only rule the renderer and the migration need.
  const handleMaskChange = useCallback(
    (mask: ClipMask) => {
      if (!selectedClip) return;
      const skipHistory = skipHistoryForWrite();
      if (mask.kind === 'none') {
        updateClip(selectedClip.id, { mask: undefined }, skipHistory);
        return;
      }
      updateClip(
        selectedClip.id,
        {
          mask:
            mask.kind === 'circle'
              ? { kind: 'circle' }
              : { kind: 'rounded', radius: mask.radius ?? DEFAULT_CLIP_MASK_RADIUS },
        },
        skipHistory
      );
    },
    [selectedClip, updateClip, skipHistoryForWrite]
  );

  const handleStrokeChange = useCallback(
    (stroke: ClipStroke) => {
      if (!selectedClip) return;
      updateClip(
        selectedClip.id,
        { stroke: stroke.width > 0 ? stroke : undefined },
        skipHistoryForWrite()
      );
    },
    [selectedClip, updateClip, skipHistoryForWrite]
  );

  const handleBlurChange = useCallback(
    (blur: number) => {
      if (!selectedClip) return;
      updateClipEffects(selectedClip.id, { blur }, skipHistoryForWrite());
    },
    [selectedClip, updateClipEffects, skipHistoryForWrite]
  );

  const handleTransitionTypeChange = useCallback(
    (type: TransitionType) => {
      if (!selectedClip) return;
      updateClipTransition(selectedClip.id, { type });
    },
    [selectedClip, updateClipTransition]
  );

  // The Transition Out section's one slider (ESCSUITE-77). The type select
  // above it keeps its own entry per change, so it does not ask.
  const handleTransitionDurationChange = useCallback(
    (duration: number) => {
      if (!selectedClip) return;
      updateClipTransition(selectedClip.id, { duration }, skipHistoryForWrite());
    },
    [selectedClip, updateClipTransition, skipHistoryForWrite]
  );

  // Animation handlers
  const handleAnimationInTypeChange = useCallback(
    (type: AnimationPresetType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { in: { type, duration: selectedClip.animation?.in.duration ?? 0.5, easing: selectedClip.animation?.in.easing ?? 'ease-out' } });
    },
    [selectedClip, updateClipAnimation]
  );

  // The Animation section's two sliders (ESCSUITE-77), Animate In and Animate
  // Out. The four preset and easing selects around them are single changes and
  // keep an entry each, so only these two ask.
  const handleAnimationInDurationChange = useCallback(
    (duration: number) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { in: { type: selectedClip.animation?.in.type ?? 'none', duration, easing: selectedClip.animation?.in.easing ?? 'ease-out' } }, skipHistoryForWrite());
    },
    [selectedClip, updateClipAnimation, skipHistoryForWrite]
  );

  const handleAnimationInEasingChange = useCallback(
    (easing: EasingType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { in: { type: selectedClip.animation?.in.type ?? 'none', duration: selectedClip.animation?.in.duration ?? 0.5, easing } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationOutTypeChange = useCallback(
    (type: AnimationPresetType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { out: { type, duration: selectedClip.animation?.out.duration ?? 0.5, easing: selectedClip.animation?.out.easing ?? 'ease-in' } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationOutDurationChange = useCallback(
    (duration: number) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { out: { type: selectedClip.animation?.out.type ?? 'none', duration, easing: selectedClip.animation?.out.easing ?? 'ease-in' } }, skipHistoryForWrite());
    },
    [selectedClip, updateClipAnimation, skipHistoryForWrite]
  );

  const handleAnimationOutEasingChange = useCallback(
    (easing: EasingType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { out: { type: selectedClip.animation?.out.type ?? 'none', duration: selectedClip.animation?.out.duration ?? 0.5, easing } });
    },
    [selectedClip, updateClipAnimation]
  );

  // One click, one undo entry (ESCSUITE-77). On an overlay this is two store
  // writes — the transform, then the overlay's own coordinates — and both used
  // to push, so a single Reset cost two Ctrl+Zs and the first of them left the
  // clip in a state the user had never seen: the transform back at its default
  // with the overlay data still where the drag had put it. The rule is the
  // sliders': the first write pushes, so the entry snapshots the state as it was
  // before the Reset, and the second passes `skipHistory`. The flag is a literal
  // rather than `skipHistoryForWrite()` because this is a button, not a gesture
  // — the two writes are one click, always, and asking a gesture that is not
  // open would answer `false` twice.
  const handleResetTransform = useCallback(() => {
    if (!selectedClip) return;

    // Reset clip transform
    updateClipTransform(selectedClip.id, {
      x: 0.5,
      y: 0.5,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    });

    // Also reset overlay-specific position data
    if (selectedClip.overlayType === 'text' && selectedClip.textData) {
      updateTextOverlayData(selectedClip.id, {
        x: 0.5,
        y: 0.5,
      }, true);
    } else if (selectedClip.overlayType === 'shape' && selectedClip.shapeData) {
      updateShapeOverlayData(selectedClip.id, {
        x: 0.5,
        y: 0.5,
        width: 0.2,
        height: 0.2,
        rotation: 0,
      }, true);
    }
  }, [selectedClip, updateClipTransform, updateTextOverlayData, updateShapeOverlayData]);

  const handleFitToCanvas = useCallback(() => {
    if (!selectedClip || !sourceVideo) return;
    const fitScale = fitToCanvasScale(resolution, sourceVideo);
    updateClipTransform(selectedClip.id, { scaleX: fitScale, scaleY: fitScale });
  }, [selectedClip, sourceVideo, resolution, updateClipTransform]);

  // Text overlay handlers. The gesture flag is here because the Transform
  // section's Pos X/Y sliders route through this for a text overlay; the text
  // content controls also call it, and, having no gesture listeners on them,
  // get `false` and their own undo entry per write exactly as before.
  const handleTextDataChange = useCallback(
    (updates: Partial<TextOverlayData>) => {
      if (!selectedClip) return;
      updateTextOverlayData(selectedClip.id, updates, skipHistoryForWrite());
    },
    [selectedClip, updateTextOverlayData, skipHistoryForWrite]
  );

  // Shape overlay handlers — the Pos X/Y sliders' other destination, same rule.
  const handleShapeDataChange = useCallback(
    (updates: Partial<ShapeOverlayData>) => {
      if (!selectedClip) return;
      updateShapeOverlayData(selectedClip.id, updates, skipHistoryForWrite());
    },
    [selectedClip, updateShapeOverlayData, skipHistoryForWrite]
  );

  // Add overlay handlers
  const handleAddText = useCallback(() => {
    addTextOverlayClip();
  }, [addTextOverlayClip]);

  const handleAddShape = useCallback((type: ShapeType) => {
    addShapeOverlayClip({ type });
  }, [addShapeOverlayClip]);

  // The two that were inline arrows in the JSX. Not memoised — see the note at
  // the top of this file.
  const handleResetToDefaults = () => updateClipTransform(selectedClip!.id, { ...DEFAULT_TRANSFORM });
  const handleKeyframePanelToggle = () => setKeyframePanelOpen(!keyframePanelOpen);

  return {
    selectedClip,
    scaleLocked,
    setScaleLocked,
    sourceVideo,
    track,
    isTextOverlay,
    isShapeOverlay,
    isOverlay,
    isAudio,
    isVideo,
    clipTypeLabel,
    clipPosition,
    frameWidth: resolution.width,
    keyframePanelOpen,
    sliderGesture,
    handleSplitAtPlayhead,
    handleDeleteClip,
    handleGoToClip,
    handleTransformChange,
    handleDuplicate,
    handleBlendModeChange,
    handleMaskChange,
    handleStrokeChange,
    handleBlurChange,
    handleTransitionTypeChange,
    handleTransitionDurationChange,
    handleAnimationInTypeChange,
    handleAnimationInDurationChange,
    handleAnimationInEasingChange,
    handleAnimationOutTypeChange,
    handleAnimationOutDurationChange,
    handleAnimationOutEasingChange,
    handleResetTransform,
    handleFitToCanvas,
    handleTextDataChange,
    handleShapeDataChange,
    handleAddText,
    handleAddShape,
    handleResetToDefaults,
    handleKeyframePanelToggle,
  };
}
