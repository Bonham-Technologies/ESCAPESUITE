import { useMemo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore } from '../../store/projectStore';
import { clipOnLockedTrack } from '../../store/trackLock';
import type { Clip, AnimatableProperty, EasingType } from '../../store/types';
import { useDraggablePanel } from './hooks/useDraggablePanel';
import { KeyframeTrack } from './KeyframeTrack';
import { KeyframeGraph } from './KeyframeGraph';
import { ClipPreview } from './ClipPreview';
import styles from './KeyframePanel.module.css';

// Visual properties - transforms and effects
const VISUAL_PROPERTIES: { property: AnimatableProperty; label: string }[] = [
  { property: 'x', label: 'Position X' },
  { property: 'y', label: 'Position Y' },
  { property: 'scaleX', label: 'Scale X' },
  { property: 'scaleY', label: 'Scale Y' },
  { property: 'rotation', label: 'Rotation' },
  { property: 'opacity', label: 'Opacity' },
  { property: 'blur', label: 'Blur' },
];

// Audio properties
const AUDIO_PROPERTIES: { property: AnimatableProperty; label: string }[] = [
  { property: 'volume', label: 'Volume' },
];

// Combined for lookups
const ALL_PROPERTIES = [...VISUAL_PROPERTIES, ...AUDIO_PROPERTIES];

export function KeyframePanel() {
  const {
    keyframePanelState,
    setKeyframePanelOpen,
    setKeyframePanelPosition,
    setKeyframePanelSize,
    setKeyframePanelSelectedProperty,
    selectedClipId,
    project,
    sourceVideos,
    currentTime,
    moveClipKeyframe,
    setClipKeyframe,
    removeClipKeyframe,
    setCurrentTime,
  } = useEditorStore();

  const { isOpen, selectedProperty } = keyframePanelState;

  // Get selected clip
  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    return project.timeline.clips.find((c: Clip) => c.id === selectedClipId) || null;
  }, [selectedClipId, project.timeline.clips]);

  // Whether the selected clip sits on a locked track (ESCSUITE-88). Derived
  // beside `selectedClip` from the state this component already holds — the
  // whole-store read above means the panel re-renders on every store change, so
  // this adds no subscription of its own, and a selector here would add one.
  const trackLocked = useMemo(() => {
    if (!selectedClipId) return false;
    return clipOnLockedTrack(project.timeline.clips, project.timeline.tracks, selectedClipId);
  }, [selectedClipId, project.timeline.clips, project.timeline.tracks]);

  // Check if selected clip has audio (video with audio, or audio-only clip)
  const clipHasAudio = useMemo(() => {
    if (!selectedClip) return false;
    const sourceMedia = sourceVideos.find(s => s.id === selectedClip.sourceVideoId);
    if (!sourceMedia) return false;
    // Audio clips or video clips with audio
    return sourceMedia.mediaType === 'audio' || sourceMedia.hasAudio === true;
  }, [selectedClip, sourceVideos]);

  // Calculate time relative to clip
  const clipRelativeTime = useMemo(() => {
    if (!selectedClip) return 0;
    return Math.max(0, Math.min(
      currentTime - selectedClip.timelinePosition,
      selectedClip.duration
    ));
  }, [selectedClip, currentTime]);

  // Playhead time relative to clip (ESCSUITE-126: derived from the timeline's
  // own `currentTime` alone, same as `clipRelativeTime` above but reporting 0
  // rather than clamping to an edge when the playhead sits outside the clip).
  // A local "preview time" used to override this once a scrub set it, and
  // nothing ever reset that override back to null — so the panel latched at
  // the last scrubbed offset and stopped following the timeline. There is
  // nothing left for an override to survive: `handlePreviewTimeChange` below
  // writes `currentTime` itself, synchronously, so the store IS the preview.
  const playheadTime = useMemo(() => {
    if (!selectedClip) return 0;
    const relative = currentTime - selectedClip.timelinePosition;
    if (relative < 0 || relative > selectedClip.duration) return 0;
    return relative;
  }, [selectedClip, currentTime]);

  // Handle preview time change (from ClipPreview scrubbing) — moves the main
  // timeline, which `playheadTime` above then reads back.
  const handlePreviewTimeChange = useCallback((time: number) => {
    if (selectedClip) {
      setCurrentTime(selectedClip.timelinePosition + time);
    }
  }, [selectedClip, setCurrentTime]);

  // Draggable panel hook
  const {
    position,
    size,
    onTitleBarMouseDown,
    onResizeMouseDown,
  } = useDraggablePanel(
    keyframePanelState.position,
    keyframePanelState.size,
    setKeyframePanelPosition,
    setKeyframePanelSize
  );

  // Handle close
  const handleClose = useCallback(() => {
    setKeyframePanelOpen(false);
  }, [setKeyframePanelOpen]);

  // Handle property selection
  const handlePropertySelect = useCallback((property: AnimatableProperty) => {
    setKeyframePanelSelectedProperty(
      selectedProperty === property ? null : property
    );
  }, [selectedProperty, setKeyframePanelSelectedProperty]);

  // Handle keyframe moved.
  //
  // `skipHistory` comes from the graph's keyboard, which sets it on an
  // auto-repeated keydown, so one held Alt+Arrow is one undo step. A drag omits
  // it and gets the entry it has always had.
  const handleKeyframeMoved = useCallback((
    property: AnimatableProperty,
    originalTime: number,
    newTime: number,
    skipHistory?: boolean
  ): boolean => {
    // Whether the store wrote (ESCSUITE-87), straight through: the graph's
    // keyboard will not announce a nudge the lock refused. No selection is no
    // write either.
    if (!selectedClipId) return false;
    return moveClipKeyframe(selectedClipId, property, originalTime, newTime, skipHistory);
  }, [selectedClipId, moveClipKeyframe]);

  // Handle add keyframe. Both the graph's two add paths and the track's
  // double-click (ESCSUITE-167 / m3) always supply the curve's own value at
  // `time` — nothing left falls back to the clip's static default, which used
  // to make a track double-click jump the shape it was adding to.
  const handleAddKeyframe = useCallback((property: AnimatableProperty, time: number, value: number) => {
    if (!selectedClip) return;

    setClipKeyframe(selectedClipId!, property, {
      time,
      value,
      easing: 'ease-in-out',
    });
  }, [selectedClip, selectedClipId, setClipKeyframe]);

  // Handle keyframe value changed (from a graph drag or an arrow-key nudge).
  // `skipHistory` as above: set on a held key's auto-repeats only.
  const handleKeyframeValueChanged = useCallback((
    property: AnimatableProperty,
    time: number,
    newValue: number,
    skipHistory?: boolean
  ): boolean => {
    // As `handleKeyframeMoved`: the store's own answer (ESCSUITE-87).
    if (!selectedClipId) return false;

    // Get fresh state from store to avoid stale memoized values
    const state = useEditorStore.getState();
    const freshClip = state.project.timeline.clips.find(c => c.id === selectedClipId);
    const existingKeyframes = freshClip?.animation?.keyframes[property] || [];
    const existingKf = existingKeyframes.find(kf => Math.abs(kf.time - time) < 0.001);

    // Update existing keyframe or create new one at this time
    return setClipKeyframe(selectedClipId, property, {
      time: time,
      value: newValue,
      easing: existingKf?.easing || 'ease-in-out',
    }, skipHistory);
  }, [selectedClipId, setClipKeyframe]);

  // Handle keyframe easing changed (from the graph's easing select)
  const handleKeyframeEasingChanged = useCallback((
    property: AnimatableProperty,
    time: number,
    easing: EasingType
  ) => {
    if (!selectedClipId) return;

    // Fresh state, for the same reason handleKeyframeValueChanged reads it:
    // the memoized clip can lag a keyframe that was just moved or added.
    const state = useEditorStore.getState();
    const freshClip = state.project.timeline.clips.find(c => c.id === selectedClipId);
    const existingKf = (freshClip?.animation?.keyframes[property] || [])
      .find(kf => Math.abs(kf.time - time) < 0.001);
    if (!existingKf) return;

    // setClipKeyframe replaces the keyframe at this time, so time and value
    // survive untouched and the whole change is one history entry.
    setClipKeyframe(selectedClipId, property, { ...existingKf, easing });
  }, [selectedClipId, setClipKeyframe]);

  // Handle keyframe deletion.
  //
  // Reports whether the store removed it, as the move and value handlers do
  // (ESCSUITE-87's shape, extended to Delete by ESCSUITE-88): the graph's
  // keyboard will not announce a removal the lock refused, or clear a selection
  // whose keyframe is still there. No selection is no write either.
  const handleDeleteKeyframe = useCallback((
    property: AnimatableProperty,
    time: number
  ): boolean => {
    if (!selectedClipId) return false;
    return removeClipKeyframe(selectedClipId, property, time);
  }, [selectedClipId, removeClipKeyframe]);

  // The one live region every property row's diamond drag shares
  // (ESCSUITE-167 / M6, review round 1 MINOR 6): only one diamond on one row
  // can ever be dragging at a time, so eight per-row regions would carry a
  // message only one of them could ever produce.
  //
  // Since ESCSUITE-183 the only thing a diamond drag reports is `''` — a
  // landed drop, with nothing to say — because the clamp makes every landing a
  // legal one and there is no refusal left for the row to raise. The setter
  // therefore goes straight to the row, with no alternating mark on the way:
  // an empty region has nothing for the mark to help a screen reader re-read,
  // and the occupied-time refusal that needed it is now the graph keyboard's
  // alone, announced through the graph's own region (`announceWithMark`, in
  // `hooks/useKeyframeGraphKeyboard.ts`, beside the `nudgeTime` that raises
  // it).
  const [keyframeDragMessage, setKeyframeDragMessage] = useState('');

  if (!isOpen) return null;

  const panelContent = (
    <div
      className={styles.panel}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      {/* Title bar */}
      <div className={styles.titleBar} onMouseDown={onTitleBarMouseDown}>
        <span className={styles.title}>Keyframe Editor</span>
        {selectedClip && (
          <span className={styles.clipName}>{selectedClip.name}</span>
        )}
        <button className={styles.closeButton} onClick={handleClose}>
          ×
        </button>
      </div>

      {/* The lock, said out loud (ESCSUITE-88). A plain <p>, not a status
          region: it is a standing fact about the selected clip, not an event —
          the same shape as ClipEditorHeader's. */}
      {trackLocked && (
        <p className={styles.lockedNotice}>
          Track locked — unlock it in the timeline to edit keyframes
        </p>
      )}

      {/* Content */}
      <div className={styles.content}>
        {!selectedClip ? (
          <div className={styles.noClip}>
            <p>Select a clip to edit keyframes</p>
          </div>
        ) : (
          <>
            {/* Clip Preview */}
            <ClipPreview
              clip={selectedClip}
              playheadTime={playheadTime}
              onTimeChange={handlePreviewTimeChange}
            />

            {/* Graph view when property selected */}
            {selectedProperty && (
              <div className={styles.graphContainer}>
                <div className={styles.graphHeader}>
                  <span className={styles.graphTitle}>
                    {ALL_PROPERTIES.find(p => p.property === selectedProperty)?.label}
                  </span>
                  <button
                    className={styles.graphClose}
                    onClick={() => setKeyframePanelSelectedProperty(null)}
                  >
                    ×
                  </button>
                </div>
                <KeyframeGraph
                  // Keyed on the clip and the property so switching either
                  // mounts a fresh graph: the active option and the selection
                  // are the graph's own state, and a keyframe at the same time
                  // on the next property — or the next clip — would otherwise
                  // inherit them.
                  key={`${selectedClip.id}:${selectedProperty}`}
                  property={selectedProperty}
                  clipDuration={selectedClip.duration}
                  animation={selectedClip.animation}
                  transform={selectedClip.transform}
                  effects={selectedClip.effects}
                  playheadTime={playheadTime}
                  locked={trackLocked}
                  onKeyframeMoved={handleKeyframeMoved}
                  onKeyframeValueChanged={handleKeyframeValueChanged}
                  onAddKeyframe={handleAddKeyframe}
                  onDeleteKeyframe={handleDeleteKeyframe}
                  onKeyframeEasingChanged={handleKeyframeEasingChanged}
                />
              </div>
            )}

            {/* Visual property tracks */}
            <div className={styles.tracks}>
              {VISUAL_PROPERTIES.map(({ property, label }) => (
                <KeyframeTrack
                  key={property}
                  property={property}
                  label={label}
                  clipId={selectedClip.id}
                  clipDuration={selectedClip.duration}
                  animation={selectedClip.animation}
                  transform={selectedClip.transform}
                  effects={selectedClip.effects}
                  currentTime={clipRelativeTime}
                  playheadTime={playheadTime}
                  isSelected={selectedProperty === property}
                  onSelect={() => handlePropertySelect(property)}
                  locked={trackLocked}
                  onKeyframeMoved={handleKeyframeMoved}
                  onAddKeyframe={handleAddKeyframe}
                  onAnnounce={setKeyframeDragMessage}
                />
              ))}
            </div>

            {/* Audio property tracks - only show if clip has audio */}
            {clipHasAudio && (
              <>
                <div className={styles.sectionHeader}>Audio</div>
                <div className={styles.tracks}>
                  {AUDIO_PROPERTIES.map(({ property, label }) => (
                    <KeyframeTrack
                      key={property}
                      property={property}
                      label={label}
                      clipId={selectedClip.id}
                      clipDuration={selectedClip.duration}
                      animation={selectedClip.animation}
                      transform={selectedClip.transform}
                      effects={selectedClip.effects}
                      currentTime={clipRelativeTime}
                      playheadTime={playheadTime}
                      isSelected={selectedProperty === property}
                      onSelect={() => handlePropertySelect(property)}
                      locked={trackLocked}
                      onKeyframeMoved={handleKeyframeMoved}
                      onAddKeyframe={handleAddKeyframe}
                      onAnnounce={setKeyframeDragMessage}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Help text */}
            <div className={styles.helpText}>
              Double-click track to add keyframe • Drag diamonds to move • Click track to see curve
            </div>

            {/* Always rendered, never conditional: a live region has to exist
                before its content changes for a screen reader to announce the
                change. Shared by every property row's diamond drag — see
                keyframeDragMessage above. */}
            <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
              {keyframeDragMessage}
            </span>
          </>
        )}
      </div>

      {/* Resize handles */}
      <div className={styles.resizeN} onMouseDown={(e) => onResizeMouseDown(e, 'n')} />
      <div className={styles.resizeS} onMouseDown={(e) => onResizeMouseDown(e, 's')} />
      <div className={styles.resizeE} onMouseDown={(e) => onResizeMouseDown(e, 'e')} />
      <div className={styles.resizeW} onMouseDown={(e) => onResizeMouseDown(e, 'w')} />
      <div className={styles.resizeNE} onMouseDown={(e) => onResizeMouseDown(e, 'ne')} />
      <div className={styles.resizeNW} onMouseDown={(e) => onResizeMouseDown(e, 'nw')} />
      <div className={styles.resizeSE} onMouseDown={(e) => onResizeMouseDown(e, 'se')} />
      <div className={styles.resizeSW} onMouseDown={(e) => onResizeMouseDown(e, 'sw')} />
    </div>
  );

  // Render as portal to body
  return createPortal(panelContent, document.body);
}
