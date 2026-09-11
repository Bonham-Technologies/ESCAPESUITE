// The preview: the canvas the timeline is composited onto, and everything the
// pointer can do to it.
//
// The component itself is wiring. What a frame looks like lives in
// `drawFrame.ts`, where the clips go and what the pointer is over in
// `previewGeometry.ts` / `hitTest.ts`, the selection chrome in
// `selectionOverlay.ts`, and the media, the redraw loop and the drag state
// machine in the three hooks beside them.
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useEditorStore, getClipsAtTime } from '../../store/projectStore';
import { getFrameCache } from '../../core/frameCache';
import { formatTimecode } from '../../utils/timeUtils';
import { drawPreviewFrame } from './drawFrame';
import * as selectionOverlay from './selectionOverlay';
import { usePreviewMedia } from './usePreviewMedia';
import { usePreviewRenderLoop } from './usePreviewRenderLoop';
import { useTransformHandles } from './useTransformHandles';
import { InlineTextEditorAnchor } from './InlineTextEditorAnchor';
import { MarqueeSelection } from './MarqueeSelection';
import styles from './PreviewPlayer.module.css';

// Fallback canvas dimensions (used if resolution not yet available)
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

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

    drawPreviewFrame(
      ctx,
      canvas,
      time,
      { clips, tracks, sourceVideos, textOverlays, shapeOverlays, editingTextClipId },
      {
        videoElements: videoElementsRef.current,
        imageElements: imageElementsRef.current,
        blurScratch: blurCanvasRef,
      }
    );
  }, [clips, tracks, sourceVideos, textOverlays, shapeOverlays, editingTextClipId,
      videoElementsRef, imageElementsRef]);

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
        {editingTextClipId && canvasRef.current && (
          <InlineTextEditorAnchor
            clip={clips.find(c => c.id === editingTextClipId)}
            canvas={canvasRef.current}
            onCommit={handleInlineTextCommit}
            onCancel={handleInlineTextCancel}
          />
        )}
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
