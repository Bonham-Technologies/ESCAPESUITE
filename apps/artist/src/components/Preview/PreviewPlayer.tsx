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
import { drawPreviewFrame } from './drawFrame';
import { previewRaster, projectSizeOf } from './previewGeometry';
import * as selectionOverlay from './selectionOverlay';
import { usePreviewMedia } from './usePreviewMedia';
import { usePreviewRenderLoop } from './usePreviewRenderLoop';
import { useTransformHandles } from './useTransformHandles';
import { InlineTextEditorAnchor } from './InlineTextEditorAnchor';
import { MarqueeSelection } from './MarqueeSelection';
import { PreviewTimecode } from './PreviewTimecode';
import styles from './PreviewPlayer.module.css';

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null); // Cached 2d context
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null); // Reusable scratch canvas for shape blur
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  /**
   * The canvas element's CSS box, as the ResizeObserver last reported it.
   *
   * A ref rather than state: it decides the size of the backing store, which
   * is written to the DOM imperatively, and re-rendering the preview subtree
   * every time the window is dragged would be work for nothing. Null until the
   * observer's first callback, and {@link previewRaster} reads that as "draw at
   * the project size", which is what the preview always did.
   */
  const displayBoxRef = useRef<{ width: number; height: number } | null>(null);

  const resolution = useEditorStore((state) => state.project.resolution);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const currentTime = useEditorStore((state) => state.currentTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const updateTextOverlayData = useEditorStore((state) => state.updateTextOverlayData);

  // Keyframe mode: when keyframe panel is open, manipulations create keyframes
  const keyframePanelOpen = useEditorStore((state) => state.keyframePanelState.isOpen);

  // The project's own pixel grid — the space every number in the preview is in.
  // Not the canvas' backing store, which follows the size it is displayed at
  // (see `previewRaster`). `projectSizeOf` is the one derivation, shared with
  // `useTransformHandles`.
  const projectWidth = resolution?.width;
  const projectHeight = resolution?.height;
  const canvasDimensions = useMemo(
    () => projectSizeOf({ width: projectWidth, height: projectHeight }),
    [projectWidth, projectHeight]
  );

  // Inline text editing state
  const [editingTextClipId, setEditingTextClipId] = useState<string | null>(null);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const hasContent = clips.length > 0;

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

    // The backing store follows the size the canvas is *displayed* at, in
    // device pixels — not the project resolution. A 4K project in a 380px box
    // otherwise rasterises 8.3 megapixels to show 0.08 of them, sixty times a
    // second, and the cost of a frame is proportional to the pixels it touches.
    // Everything below still draws in project pixels; drawPreviewFrame sets the
    // one transform that carries them onto this raster.
    //
    // Assigning width/height clears the canvas and resets the context state,
    // which is why it is only done when the number actually changes — and why
    // the frame that follows redraws the whole picture anyway.
    const raster = previewRaster(canvasDimensions, displayBoxRef.current, window.devicePixelRatio || 1);
    if (canvas.width !== raster.width) canvas.width = raster.width;
    if (canvas.height !== raster.height) canvas.height = raster.height;

    // Cache the 2d context — getContext returns the same object but the lookup adds up.
    //
    // `alpha: false` matches both exporters. Every frame starts with an opaque
    // black fillRect in drawPreviewFrame, so the canvas never shows anything
    // through — dropping the alpha channel lets the compositor skip a blend per
    // blit without changing a pixel. Nothing else in the preview clears to
    // transparent or composites against the canvas' own alpha (no clearRect, no
    // destination-* blend mode; the shape-blur scratch canvas keeps its alpha).
    //
    // This must stay the FIRST getContext('2d') on this canvas: per the HTML
    // spec a second call returns the context already created and ignores the
    // options. The other preview call sites (selectionOverlay, previewGeometry,
    // dragGeometry) all run after the first draw, off pointer events or after
    // drawFrame in the render loop.
    if (!canvasCtxRef.current || canvasCtxRef.current.canvas !== canvas) {
      canvasCtxRef.current = canvas.getContext('2d', { alpha: false });
    }
    const ctx = canvasCtxRef.current;
    if (!ctx) return;

    // Check frame cache first (only when not playing and cache is enabled)
    // This provides instant scrubbing through previously viewed frames
    if (useCache && !isPlayingRef.current) {
      const frameCache = getFrameCache();
      const cachedFrame = frameCache.get(time);
      if (cachedFrame) {
        // Draw cached frame directly - much faster than re-rendering.
        // The bitmap was captured off this canvas at whatever size it was
        // rasterised at then; drawing it at the project size under the same
        // transform every frame uses puts it back where it came from, and
        // rescales it if the window has changed size since.
        const scale = canvas.width / canvasDimensions.width;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(cachedFrame, 0, 0, canvasDimensions.width, canvasDimensions.height);
        return;
      }
    }

    drawPreviewFrame(
      ctx,
      canvas,
      time,
      {
        projectSize: canvasDimensions,
        clips,
        tracks,
        sourceVideos,
        editingTextClipId,
      },
      {
        videoElements: videoElementsRef.current,
        imageElements: imageElementsRef.current,
        blurScratch: blurCanvasRef,
      }
    );
  }, [canvasDimensions, clips, tracks, sourceVideos, editingTextClipId,
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
    }, canvasDimensions);
  }, [canvasDimensions, clips, sourceVideos, selectedClipId, isPlaying, keyframePanelOpen]);

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
    }, canvasDimensions);
  }, [canvasDimensions, clips, sourceVideos, selectedClipId, selectedClipIds, isPlaying]);

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
  const { subscribeDisplayTime, getDisplayTime } = usePreviewRenderLoop({
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

  const hasActiveClips = clipsAtTime.length > 0;

  // Repaint everything at the playhead, through the current scene. Held in a
  // ref so the observer below is installed once per canvas instead of being
  // torn down and re-subscribed on every edit.
  const redrawRef = useRef<() => void>(() => {});
  useEffect(() => {
    redrawRef.current = () => {
      const time = currentTimeRef.current;
      // Not from the cache: its bitmaps were captured at the old raster size,
      // and a resize is exactly when they are the wrong pixels.
      drawFrame(time, false);
      drawSelectionHandles(time);
      drawMultiSelectHandles(time);
    };
  });

  // Follow the size the canvas is displayed at.
  //
  // The backing store is sized from this (see `previewRaster`), so a window
  // resize, a panel drag or a move to a different-DPI screen re-rasterises the
  // preview at the new size and repaints it once. The observer reports the
  // element's box in CSS pixels; nothing here reads layout itself, so no frame
  // pays for a forced reflow.
  const showCanvas = hasContent && !isLoading;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (!box) return;
      const previous = displayBoxRef.current;
      if (previous && previous.width === box.width && previous.height === box.height) return;
      displayBoxRef.current = { width: box.width, height: box.height };
      redrawRef.current();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [showCanvas]);

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
            /* The project size is only the starting point: the first draw
               re-sizes the backing store to the box the observer reports. React
               does not rewrite these attributes unless the project resolution
               itself changes, which is a redraw either way. */
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
            projectSize={canvasDimensions}
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
        <PreviewTimecode
          subscribe={subscribeDisplayTime}
          getTime={getDisplayTime}
          className={styles.timecode}
        />
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
