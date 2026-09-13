// Everything the clip inspector reads from the store, and everything its
// controls write back.
//
// This is the whole of `ClipEditor`'s wiring: the selectors, the three derived
// values the sections share (`sourceVideo`, `track`, `timeInClip`), the clip
// classification, and one handler per control. It adds no state and no
// subscription of its own — the hook calls below are the ones that used to sit
// at the top of `ClipEditor`, in the same order, with the same dependency
// arrays, so moving them here cannot change when anything re-renders.
//
// Two of those arrays are wrong, and are kept wrong on purpose:
//   * `handleGoToClip` reads `selectedClip` but depends only on
//     `[clipPosition, setCurrentTime]`. It is the directory's one
//     `exhaustive-deps` warning, and it is harmless in practice because
//     `clipPosition` is derived from the same clip. Fixing it is a behaviour
//     change (a new callback identity), so it is left alone.
//   * `setScaleLocked` depends on `[]` and reaches for
//     `useEditorStore.getState()` three times instead of closing over the clip
//     it already has. That is also what keeps its identity stable across
//     renders, which `TransformSection` benefits from.
// Likewise the `scaleLocked` selector re-finds the clip that
// `selectSelectedClip` already selects, one line below it. Merging the two
// subscriptions would change how often the panel re-renders; they stay apart.
//
// The last two entries returned, `handleResetToDefaults` and
// `handleKeyframePanelToggle`, are deliberately *not* memoised: they were
// inline arrows in the JSX before this file existed, so a fresh function per
// render is their existing behaviour, and wrapping them in `useCallback` would
// be a new memo rather than a move.
import { useCallback, useMemo } from 'react';
import { useEditorStore, selectSelectedClip } from '../../store/projectStore';
import { DEFAULT_TRANSFORM } from '../../store/types';
import type {
  BlendMode,
  Clip,
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
  /** How far the playhead is into the clip, or null when it is outside it. */
  timeInClip: number | null;
  /** Whether the keyframe panel is open — the Animation section's toggle state. */
  keyframePanelOpen: boolean;
  handleSplitAtPlayhead: () => void;
  handleDeleteClip: () => void;
  handleGoToClip: () => void;
  handleTransformChange: (key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'opacity', value: number) => void;
  handleDuplicate: () => void;
  handleBlendModeChange: (mode: BlendMode) => void;
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
  /** The scale row's Reset: the whole of `DEFAULT_TRANSFORM`, rotation included. */
  handleResetToDefaults: () => void;
  handleKeyframePanelToggle: () => void;
}

export function useClipEditorActions(): ClipEditorActions {
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
  const currentTime = useEditorStore((state) => state.currentTime);

  const removeClipFromTimeline = useEditorStore((state) => state.removeClipFromTimeline);
  const splitClip = useEditorStore((state) => state.splitClip);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const updateClipTransform = useEditorStore((state) => state.updateClipTransform);
  const updateClipBlendMode = useEditorStore((state) => state.updateClipBlendMode);
  const updateClipEffects = useEditorStore((state) => state.updateClipEffects);
  const updateClipTransition = useEditorStore((state) => state.updateClipTransition);
  const updateClipAnimation = useEditorStore((state) => state.updateClipAnimation);
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

  // Calculate if current time is within this clip
  const timeInClip = useMemo(() => {
    if (!selectedClip) return null;
    return relativeTimeInClip(currentTime, clipPosition, selectedClip.duration);
  }, [currentTime, clipPosition, selectedClip]);


  const handleSplitAtPlayhead = useCallback(() => {
    if (!selectedClip || timeInClip === null || timeInClip <= 0) return;
    splitClip(selectedClip.id, timeInClip);
  }, [selectedClip, timeInClip, splitClip]);

  const handleDeleteClip = useCallback(() => {
    if (!selectedClip) return;
    if (confirm(`Delete clip "${selectedClip.name}"?`)) {
      removeClipFromTimeline(selectedClip.id);
    }
  }, [selectedClip, removeClipFromTimeline]);

  const handleGoToClip = useCallback(() => {
    if (!selectedClip) return;
    setCurrentTime(clipPosition);
  }, [clipPosition, setCurrentTime]);

  const handleTransformChange = useCallback(
    (key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'opacity', value: number) => {
      if (!selectedClip) return;

      // If scale is locked and changing one scale dimension, update both
      if (scaleLocked && (key === 'scaleX' || key === 'scaleY')) {
        updateClipTransform(selectedClip.id, { scaleX: value, scaleY: value });
      } else {
        updateClipTransform(selectedClip.id, { [key]: value });
      }
    },
    [selectedClip, updateClipTransform, scaleLocked]
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

  const handleBlurChange = useCallback(
    (blur: number) => {
      if (!selectedClip) return;
      updateClipEffects(selectedClip.id, { blur });
    },
    [selectedClip, updateClipEffects]
  );

  const handleTransitionTypeChange = useCallback(
    (type: TransitionType) => {
      if (!selectedClip) return;
      updateClipTransition(selectedClip.id, { type });
    },
    [selectedClip, updateClipTransition]
  );

  const handleTransitionDurationChange = useCallback(
    (duration: number) => {
      if (!selectedClip) return;
      updateClipTransition(selectedClip.id, { duration });
    },
    [selectedClip, updateClipTransition]
  );

  // Animation handlers
  const handleAnimationInTypeChange = useCallback(
    (type: AnimationPresetType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { in: { type, duration: selectedClip.animation?.in.duration ?? 0.5, easing: selectedClip.animation?.in.easing ?? 'ease-out' } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationInDurationChange = useCallback(
    (duration: number) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { in: { type: selectedClip.animation?.in.type ?? 'none', duration, easing: selectedClip.animation?.in.easing ?? 'ease-out' } });
    },
    [selectedClip, updateClipAnimation]
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
      updateClipAnimation(selectedClip.id, { out: { type: selectedClip.animation?.out.type ?? 'none', duration, easing: selectedClip.animation?.out.easing ?? 'ease-in' } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationOutEasingChange = useCallback(
    (easing: EasingType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { out: { type: selectedClip.animation?.out.type ?? 'none', duration: selectedClip.animation?.out.duration ?? 0.5, easing } });
    },
    [selectedClip, updateClipAnimation]
  );

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
      });
    } else if (selectedClip.overlayType === 'shape' && selectedClip.shapeData) {
      updateShapeOverlayData(selectedClip.id, {
        x: 0.5,
        y: 0.5,
        width: 0.2,
        height: 0.2,
        rotation: 0,
      });
    }
  }, [selectedClip, updateClipTransform, updateTextOverlayData, updateShapeOverlayData]);

  const handleFitToCanvas = useCallback(() => {
    if (!selectedClip || !sourceVideo) return;
    const fitScale = fitToCanvasScale(resolution, sourceVideo);
    updateClipTransform(selectedClip.id, { scaleX: fitScale, scaleY: fitScale });
  }, [selectedClip, sourceVideo, resolution, updateClipTransform]);

  // Text overlay handlers
  const handleTextDataChange = useCallback(
    (updates: Partial<TextOverlayData>) => {
      if (!selectedClip) return;
      updateTextOverlayData(selectedClip.id, updates);
    },
    [selectedClip, updateTextOverlayData]
  );

  // Shape overlay handlers
  const handleShapeDataChange = useCallback(
    (updates: Partial<ShapeOverlayData>) => {
      if (!selectedClip) return;
      updateShapeOverlayData(selectedClip.id, updates);
    },
    [selectedClip, updateShapeOverlayData]
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
    timeInClip,
    keyframePanelOpen,
    handleSplitAtPlayhead,
    handleDeleteClip,
    handleGoToClip,
    handleTransformChange,
    handleDuplicate,
    handleBlendModeChange,
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
