import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useEditorStore, getClipsAtTime } from '../../store/projectStore';
import { getFrameCache } from '../../core/frameCache';
import {
  drawClipToCanvas,
  drawImageToCanvasWithModifiers,
  drawShapeOverlayToCanvasAnimated,
  drawTextOverlayToCanvasAnimated,
  drawTransition,
  shapeBlursBackground,
} from '../../core/canvasRenderer';
import type { MediaDrawOptions, TransitionModifiers } from '../../core/exportTypes';
import { formatTimecode } from '../../utils/timeUtils';
import { getAnimatedValues } from '../../utils/animation';
import type { Clip } from '../../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import { getActiveTransition } from './transitions';
import * as selectionOverlay from './selectionOverlay';
import { usePreviewMedia } from './usePreviewMedia';
import { usePreviewRenderLoop } from './usePreviewRenderLoop';
import { useTransformHandles } from './useTransformHandles';
import { InlineTextEditor } from './InlineTextEditor';
import { MarqueeSelection } from './MarqueeSelection';
import styles from './PreviewPlayer.module.css';

// Fallback canvas dimensions (used if resolution not yet available)
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

/**
 * How the preview draws media clips, as against how an export does.
 *
 * `uncachedAnimation`: the export memo cache is keyed by clip id and clip time
 * and only cleared when an export starts, so an editor that redraws the same
 * clip at the same time after every edit would keep drawing pre-edit values.
 * `resetFilter`: a clip with no blur of its own draws unfiltered here, even
 * inside a dissolve, which is what the preview has always done.
 * `quiet`: media that is not ready yet is ordinary mid-scrub, and this frame
 * is redrawn sixty times a second — the exporter's one-off warning would be a
 * console flood here.
 */
const PREVIEW_DRAW_OPTIONS: MediaDrawOptions = {
  uncachedAnimation: true,
  resetFilter: true,
  quiet: true,
};

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null); // Cached 2d context
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null); // Reusable scratch canvas for shape blur
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);

  const resolution = useEditorStore((state) => state.project.resolution);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const textOverlays = useEditorStore((state) => state.project.timeline.textOverlays || []);
  const shapeOverlays = useEditorStore((state) => state.project.timeline.shapeOverlays || []);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const currentTime = useEditorStore((state) => state.currentTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const updateTextOverlayData = useEditorStore((state) => state.updateTextOverlayData);

  // Keyframe mode: when keyframe panel is open, manipulations create keyframes
  const keyframePanelOpen = useEditorStore((state) => state.keyframePanelState.isOpen);

  // Canvas dimensions come from project resolution (fallback to defaults for safety)
  const canvasDimensions = useMemo(() => ({
    width: resolution?.width || DEFAULT_WIDTH,
    height: resolution?.height || DEFAULT_HEIGHT,
  }), [resolution?.width, resolution?.height]);

  // Inline text editing state
  const [editingTextClipId, setEditingTextClipId] = useState<string | null>(null);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Get clips at current time for display info
  const clipsAtTime = useMemo(() =>
    getClipsAtTime(clips, tracks, currentTime),
    [clips, tracks, currentTime]
  );

  const activeClipInfo = clipsAtTime.length > 0
    ? clipsAtTime[clipsAtTime.length - 1]
    : null;

  // The <video>/<img>/<audio> elements for every source the timeline uses, and
  // the object URLs behind them, loaded and released as the timeline changes.
  const {
    videoElementsRef,
    imageElementsRef,
    audioElementsRef,
    isLoading,
    videoUrlsKey,
    imageUrlsKey,
  } = usePreviewMedia();

  // Helper to draw a single clip with optional transition modifiers.
  //
  // The drawing itself is the export pipeline's — same geometry, same blend,
  // same transition modifiers. What stays here is the preview's own decision
  // about *whether* a clip can be drawn at all: an audio clip has nothing to
  // show, and a video or image the browser has not decoded yet would paint a
  // black flash mid-scrub if it were drawn at a fallback size.
  const drawClip = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    clip: Clip,
    clipTime: number, // Time relative to clip start (for animations)
    transitionModifiers?: TransitionModifiers
  ) => {
    // Check media type
    const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
    const isImage = sourceMedia?.mediaType === 'image';
    const isAudio = sourceMedia?.mediaType === 'audio';

    // Audio clips don't render visually - skip drawing
    if (isAudio) return;

    if (isImage) {
      const img = imageElementsRef.current.get(clip.sourceVideoId);
      if (!img || !img.complete) return;
      drawImageToCanvasWithModifiers(
        ctx, img, clip, clipTime, canvas.width, canvas.height, transitionModifiers, PREVIEW_DRAW_OPTIONS
      );
      return;
    }

    const video = videoElementsRef.current.get(clip.sourceVideoId);
    // Allow drawing if video has any data (readyState >= 1 means metadata loaded)
    // During seeking, readyState may temporarily drop, but we can still draw the current frame
    // This prevents black flashes during scrubbing
    if (!video || video.readyState < 1) return;
    // If video dimensions aren't available yet, skip
    if (!video.videoWidth || !video.videoHeight) return;
    drawClipToCanvas(
      ctx, video, clip, clipTime, canvas.width, canvas.height, transitionModifiers, PREVIEW_DRAW_OPTIONS
    );
  }, [sourceVideos, imageElementsRef, videoElementsRef]);

  // The scratch canvas a blur shape captures the frame so far into. One canvas,
  // reused for the life of the component: the preview redraws continuously, and
  // a fresh full-size canvas per frame would cost 8MB+ each time. Allocated on
  // the first shape that actually blurs — a timeline with none never pays.
  const blurScratchFor = useCallback((canvas: HTMLCanvasElement) => {
    const scratch = blurCanvasRef.current;
    if (!scratch || scratch.width !== canvas.width || scratch.height !== canvas.height) {
      const replacement = document.createElement('canvas');
      replacement.width = canvas.width;
      replacement.height = canvas.height;
      blurCanvasRef.current = replacement;
      return replacement;
    }
    return scratch;
  }, []);

  // Draw a single frame to canvas
  // When useCache is true and not playing, check the frame cache first for instant scrubbing
  const drawFrame = useCallback((time: number, useCache: boolean = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Cache the 2d context — getContext returns the same object but the lookup adds up
    if (!canvasCtxRef.current || canvasCtxRef.current.canvas !== canvas) {
      canvasCtxRef.current = canvas.getContext('2d');
    }
    const ctx = canvasCtxRef.current;
    if (!ctx) return;

    // Check frame cache first (only when not playing and cache is enabled)
    // This provides instant scrubbing through previously viewed frames
    if (useCache && !isPlayingRef.current) {
      const frameCache = getFrameCache();
      const cachedFrame = frameCache.get(time);
      if (cachedFrame) {
        // Draw cached frame directly - much faster than re-rendering
        ctx.drawImage(cachedFrame, 0, 0, canvas.width, canvas.height);
        return;
      }
    }

    // Reset all canvas state to defaults before drawing
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform matrix

    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Check for active transitions
    const activeTransition = getActiveTransition(clips, tracks, time);

    // Get active clips at this time
    const activeClips = getClipsAtTime(clips, tracks, time);

    // Sort ALL clips by track index (lower = bottom, rendered first)
    // This ensures proper z-ordering: blur overlays only affect content below them
    const sortedClips = [...activeClips].sort((a, b) => {
      return (a.track?.index || 0) - (b.track?.index || 0);
    });

    // Helper to calculate clip time
    const getClipTime = (clip: Clip) => time - clip.timelinePosition;

    // Helper to draw an overlay clip with animations
    const drawOverlayClip = (clip: Clip) => {
      const overlayClipTime = time - clip.timelinePosition;

      // Build base transform from overlay's own properties
      let baseTransform = clip.transform || DEFAULT_TRANSFORM;

      if (clip.overlayType === 'text' && clip.textData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.textData.x,
          y: clip.textData.y,
          scaleX: clip.textData.scale ?? 1,
          scaleY: clip.textData.scale ?? 1,
          rotation: clip.textData.rotation ?? 0,
        };
      } else if (clip.overlayType === 'shape' && clip.shapeData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.shapeData.x,
          y: clip.shapeData.y,
          rotation: clip.shapeData.rotation,
        };
      }

      // Get animated values using overlay's properties as base
      const animated = getAnimatedValues(
        overlayClipTime,
        clip.duration,
        clip.animation,
        baseTransform,
        clip.effects || DEFAULT_EFFECTS
      );

      // Draw overlay with animated transform values
      // Skip drawing text that is currently being inline-edited (to avoid duplicate)
      if (clip.overlayType === 'shape' && clip.shapeData) {
        // A blur shape captures the frame so far from the canvas itself, into
        // the one scratch canvas this component reuses across frames. Shapes
        // that cannot blur ask for neither.
        const blurs = shapeBlursBackground(clip.shapeData);
        drawShapeOverlayToCanvasAnimated(
          ctx,
          clip.shapeData,
          canvas.width,
          canvas.height,
          animated,
          blurs ? canvas : undefined,
          blurs ? blurScratchFor(canvas) : undefined
        );
      } else if (clip.overlayType === 'text' && clip.textData) {
        if (clip.id !== editingTextClipId) {
          drawTextOverlayToCanvasAnimated(ctx, clip.textData, canvas.width, canvas.height, animated);
        }
      }
    };

    // Draw all clips in track order (media and overlays interleaved for proper z-order)
    for (const { clip } of sortedClips) {
      if (clip.overlayType) {
        // Draw overlay clip
        drawOverlayClip(clip);
      } else {
        // Draw media clip - check if it's part of an active transition
        if (activeTransition &&
            (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
          // This clip will be drawn as part of the transition
          continue;
        }
        // Draw clip normally
        drawClip(ctx, canvas, clip, getClipTime(clip));
      }
    }

    // Draw transition if active
    if (activeTransition) {
      drawTransition(
        ctx,
        videoElementsRef.current,
        imageElementsRef.current,
        activeTransition,
        time,
        canvas.width,
        canvas.height,
        PREVIEW_DRAW_OPTIONS
      );
    }

    // Draw shape and text overlays from the legacy arrays (for backwards
    // compatibility). A legacy overlay has no animation of its own: its stored
    // position, rotation and opacity *are* the values it draws with.
    for (const shape of shapeOverlays) {
      if (time < shape.startTime || time >= shape.endTime) continue;

      drawShapeOverlayToCanvasAnimated(ctx, shape, canvas.width, canvas.height, {
        x: shape.x,
        y: shape.y,
        scaleX: 1,
        scaleY: 1,
        rotation: shape.rotation,
        opacity: shape.opacity,
        blur: 0,
      });
    }

    for (const overlay of textOverlays) {
      if (time < overlay.startTime || time >= overlay.endTime) continue;

      drawTextOverlayToCanvasAnimated(ctx, overlay, canvas.width, canvas.height, {
        x: overlay.x,
        y: overlay.y,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: overlay.opacity,
        blur: 0,
      });
    }
  }, [clips, tracks, sourceVideos, textOverlays, shapeOverlays, drawClip, blurScratchFor, editingTextClipId, videoElementsRef, imageElementsRef]);

  // Draw selection handles for the selected overlay or media clip
  const drawSelectionHandles = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    selectionOverlay.drawSelectionHandles(canvas, time, {
      clips,
      sourceVideos,
      selectedClipId,
      isPlaying,
      keyframePanelOpen,
    });
  }, [clips, sourceVideos, selectedClipId, isPlaying, keyframePanelOpen]);

  // Draw lightweight bounding boxes for multi-selected overlay clips (no resize handles)
  const drawMultiSelectHandles = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    selectionOverlay.drawMultiSelectHandles(canvas, time, {
      clips,
      sourceVideos,
      selectedClipId,
      selectedClipIds,
      isPlaying,
    });
  }, [clips, sourceVideos, selectedClipId, selectedClipIds, isPlaying]);

  // Everything a pointer does to the canvas: drag a handle, sweep a marquee,
  // double-click into the text editor — and the cursor that advertises it.
  const {
    cursor,
    handleMouseDown,
    handleMouseMoveForCursor,
    handleMouseUp,
    handleMouseLeave,
    handleDoubleClick,
    marqueeStart,
    marqueeCurrent,
    marqueeActive,
  } = useTransformHandles({
    canvasRef,
    setEditingTextClipId,
    drawFrame,
    drawSelectionHandles,
    drawMultiSelectHandles,
  });

  // Commit handler for inline text editing
  const handleInlineTextCommit = useCallback((newText: string) => {
    if (editingTextClipId) {
      updateTextOverlayData(editingTextClipId, { text: newText });
    }
    setEditingTextClipId(null);
  }, [editingTextClipId, updateTextOverlayData]);

  // Cancel handler for inline text editing
  const handleInlineTextCancel = useCallback(() => {
    setEditingTextClipId(null);
  }, []);

  // Clear editing state when playing starts
  useEffect(() => {
    if (isPlaying) {
      setEditingTextClipId(null);
    }
  }, [isPlaying]);

  // When the canvas gets repainted: on a media change, on a scrub, and on every
  // frame of playback.
  const { displayTime } = usePreviewRenderLoop({
    drawFrame,
    drawSelectionHandles,
    drawMultiSelectHandles,
    videoElementsRef,
    audioElementsRef,
    isPlayingRef,
    currentTimeRef,
    videoUrlsKey,
    imageUrlsKey,
  });

  const hasContent = clips.length > 0;
  const hasActiveClips = clipsAtTime.length > 0;

  return (
    <div className={styles.container}>
      <div className={styles.videoWrapper}>
        {!hasContent ? (
          <div className={styles.placeholder}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <p>Add clips to the timeline to preview</p>
          </div>
        ) : isLoading ? (
          <div className={styles.placeholder}>
            <div className={styles.spinner} />
            <p>Loading videos...</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            width={canvasDimensions.width}
            height={canvasDimensions.height}
            style={{ cursor }}
            onMouseDown={editingTextClipId ? undefined : handleMouseDown}
            onMouseMove={editingTextClipId ? undefined : handleMouseMoveForCursor}
            onMouseUp={editingTextClipId ? undefined : handleMouseUp}
            onMouseLeave={editingTextClipId ? undefined : handleMouseLeave}
            onDoubleClick={handleDoubleClick}
          />
        )}
        {editingTextClipId && canvasRef.current && (() => {
          const editingClip = clips.find(c => c.id === editingTextClipId);
          if (!editingClip?.textData) return null;

          const canvas = canvasRef.current!;
          const rect = canvas.getBoundingClientRect();
          const textData = editingClip.textData;

          // Calculate rendered canvas area within the element (object-fit: contain)
          const canvasAspect = canvas.width / canvas.height;
          const elementAspect = rect.width / rect.height;

          let renderedWidth: number;
          let renderedHeight: number;
          let offsetX: number;
          let offsetY: number;

          if (canvasAspect > elementAspect) {
            renderedWidth = rect.width;
            renderedHeight = rect.width / canvasAspect;
            offsetX = 0;
            offsetY = (rect.height - renderedHeight) / 2;
          } else {
            renderedHeight = rect.height;
            renderedWidth = rect.height * canvasAspect;
            offsetX = (rect.width - renderedWidth) / 2;
            offsetY = 0;
          }

          const scaleX = renderedWidth / canvas.width;
          const scaleY = renderedHeight / canvas.height;

          // Get text bounds from canvas
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;

          const fontStyleStr = textData.fontStyle === 'italic' ? 'italic ' : '';
          const fontWeightStr = textData.fontWeight === 'bold' ? 'bold ' : '';
          ctx.font = `${fontStyleStr}${fontWeightStr}${textData.fontSize}px ${textData.fontFamily}`;

          const lines = textData.text.split('\n');
          const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
          const lineHeight = textData.fontSize * 1.2;
          const totalHeight = lines.length * lineHeight;
          const scale = textData.scale ?? 1;

          // Canvas-space coordinates
          const canvasX = textData.x * canvas.width;
          const canvasY = textData.y * canvas.height;
          const textWidth = maxLineWidth * scale;
          const textHeight = totalHeight * scale;

          // Adjust x based on textAlign
          let textLeft = canvasX;
          if (textData.textAlign === 'center') {
            textLeft = canvasX - textWidth / 2;
          } else if (textData.textAlign === 'right') {
            textLeft = canvasX - textWidth;
          }
          const textTop = canvasY - textHeight / 2;

          // Convert to screen-space relative to videoWrapper
          const screenX = offsetX + textLeft * scaleX;
          const screenY = offsetY + textTop * scaleY;
          const screenFontSize = textData.fontSize * scale * scaleY;

          return (
            <InlineTextEditor
              clipId={editingTextClipId}
              text={textData.text}
              x={screenX}
              y={screenY}
              fontFamily={textData.fontFamily}
              fontSize={screenFontSize}
              fontWeight={textData.fontWeight}
              fontStyle={textData.fontStyle}
              color={textData.color}
              textAlign={textData.textAlign}
              onCommit={handleInlineTextCommit}
              onCancel={handleInlineTextCancel}
            />
          );
        })()}
        {marqueeActive && marqueeStart && marqueeCurrent && (
          <MarqueeSelection
            startX={marqueeStart.x}
            startY={marqueeStart.y}
            currentX={marqueeCurrent.x}
            currentY={marqueeCurrent.y}
          />
        )}
      </div>

      <div className={styles.info}>
        <span className={styles.timecode}>{formatTimecode(displayTime)}</span>
        <span className={styles.clipInfo}>
          {hasActiveClips
            ? `${clipsAtTime.length} clip${clipsAtTime.length > 1 ? 's' : ''} • ${activeClipInfo?.clip.name}`
            : hasContent ? 'Gap' : ''
          }
        </span>
      </div>
    </div>
  );
}

export function PlaybackControls() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const currentTime = useEditorStore((state) => state.currentTime);
  const timelineDuration = useEditorStore((state) => state.project.timeline.duration);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);

  const canPlay = clips.length > 0 && currentTime < timelineDuration;

  const handlePlayPause = useCallback(() => {
    if (!canPlay && !isPlaying) return;
    setIsPlaying(!isPlaying);
  }, [isPlaying, canPlay, setIsPlaying]);

  const handleStepBackward = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(Math.max(0, currentTime - 1));
  }, [currentTime, setCurrentTime, setIsPlaying]);

  const handleStepForward = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(Math.min(timelineDuration, currentTime + 1));
  }, [currentTime, timelineDuration, setCurrentTime, setIsPlaying]);

  const handleGoToStart = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [setCurrentTime, setIsPlaying]);

  const handleGoToEnd = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(timelineDuration);
  }, [timelineDuration, setCurrentTime, setIsPlaying]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleStepBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleStepForward();
          break;
        case 'Home':
          e.preventDefault();
          handleGoToStart();
          break;
        case 'End':
          e.preventDefault();
          handleGoToEnd();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, handleStepBackward, handleStepForward, handleGoToStart, handleGoToEnd]);

  return (
    <div className={styles.controls}>
      <button
        className={styles.controlButton}
        onClick={handleGoToStart}
        title="Go to start (Home)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
        </svg>
      </button>

      <button
        className={styles.controlButton}
        onClick={handleStepBackward}
        title="Step backward (←)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>

      <button
        className={`${styles.controlButton} ${styles.playButton}`}
        onClick={handlePlayPause}
        disabled={!canPlay && !isPlaying}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      >
        {isPlaying ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <button
        className={styles.controlButton}
        onClick={handleStepForward}
        title="Step forward (→)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
        </svg>
      </button>

      <button
        className={styles.controlButton}
        onClick={handleGoToEnd}
        title="Go to end (End)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>

    </div>
  );
}
