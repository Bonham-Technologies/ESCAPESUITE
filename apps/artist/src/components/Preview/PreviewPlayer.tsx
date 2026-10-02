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
import { drawPreviewFrame, isDrawableImage, isDrawableVideo } from './drawFrame';
import { contentBox, previewRaster, projectSizeOf } from './previewGeometry';
import * as selectionOverlay from './selectionOverlay';
import { getActiveTransition } from './transitions';
import * as cropOverlay from './cropOverlay';
import { CropHandles } from './CropHandles';
import { isTrackLocked } from '../../store/trackLock';
import { usePreviewMedia } from './usePreviewMedia';
import { usePreviewRenderLoop } from './usePreviewRenderLoop';
import { useTransformHandles } from './useTransformHandles';
import { InlineTextEditorAnchor } from './InlineTextEditorAnchor';
import { MarqueeSelection } from './MarqueeSelection';
import { PreviewTimecode } from './PreviewTimecode';
import type { SourceVideo } from '../../store/types';
import styles from './PreviewPlayer.module.css';

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * The same element as `canvasRef.current`, held in state so the DOM layers
   * below (the crop handles, the inline text editor anchor) can gate on it
   * during render instead of reading a ref there.
   *
   * A `ref.current` read during render sees the value from the PREVIOUS
   * commit — React assigns refs after rendering, as part of the commit itself
   * — so the render that mounts a brand new canvas (the `hasContent &&
   * !isLoading` arm below, remounted after the timeline empties and refills)
   * still sees the old, now-null ref on that first pass. A layer gated on
   * `canvasRef.current` would then be absent for one commit and only appear
   * once something else happens to trigger a second render (ESCSUITE-160).
   * `setCanvasEl` runs in the same callback-ref commit that mounts the new
   * canvas, so the state update — and the render it schedules — lands before
   * the browser paints: no missing frame, and no per-frame cost, since the
   * callback only fires on mount/unmount rather than once a frame.
   */
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const setCanvasRefs = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasEl(node);
  }, []);
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
  const cropClipId = useEditorStore((state) => state.cropClipId);
  const setCropClipId = useEditorStore((state) => state.setCropClipId);

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

  // Crop mode (ESCSUITE-157). `visibleCropTarget` is the single answer to "is it
  // on, and on what": the latch has to name the SELECTED clip, so a selection
  // change leaves the mode with nothing to clear, and the playhead has to be on
  // that clip, so the chrome and the handles appear and disappear together. It
  // gates three things — the chrome below, the canvas' own pointer handlers, and
  // the DOM handle layer — and all three ask it once, here.
  //
  // `tracks` is in it because a clip on a hidden track takes no picture in the
  // frame either (ESCSUITE-171), and this component already subscribes to them.
  //
  // Taking `currentTime` means this value's identity changes on every scrub tick
  // *while crop mode is open* (it stays a stable `null` the rest of the time, so
  // nothing downstream of it churns when the mode is off). The cost is bounded by
  // the mode being open, the same argument `CropHandles`' own ResizeObserver
  // makes.
  const cropScene = useMemo<cropOverlay.CropOverlayScene>(
    () => ({ clips, sourceVideos, tracks, cropClipId, selectedClipId, isPlaying }),
    [clips, sourceVideos, tracks, cropClipId, selectedClipId, isPlaying]
  );
  const cropping = useMemo(
    () => cropOverlay.visibleCropTarget(cropScene, currentTime),
    [cropScene, currentTime]
  );

  /**
   * The decoded element a source draws from, for the crop chrome's dim pass —
   * or `undefined` when there is nothing in it to draw yet.
   *
   * It applies the frame path's own readiness test (`drawFrame.ts`'s
   * `isDrawableImage` / `isDrawableVideo`) rather than asking whether the
   * element exists: `usePreviewMedia` puts an element into its map when it
   * CREATES it, before anything has loaded, and `drawImage` on a `<video>` at
   * `readyState` 0 or an undecoded `<img>` is a silent no-op — which would leave
   * the ring neither dimmed nor veiled. Handing back `undefined` is what makes
   * `drawCropOverlay` take its veil fallback for exactly the window the spec
   * names.
   */
  const mediaElementFor = useCallback(
    (source: SourceVideo): CanvasImageSource | undefined => {
      if (source.mediaType === 'image') {
        const img = imageElementsRef.current.get(source.id);
        return isDrawableImage(img) ? img : undefined;
      }
      const video = videoElementsRef.current.get(source.id);
      return isDrawableVideo(video) ? video : undefined;
    },
    [imageElementsRef, videoElementsRef]
  );

  // Draw a single frame to canvas
  const drawFrame = useCallback((time: number) => {
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

  /**
   * Project pixels per CSS pixel of the box the canvas is laid out in.
   *
   * The chrome the two callbacks below draw is the one thing on the canvas that
   * is a *screen* size rather than a part of the picture: a handle should be the
   * same 8px under the pointer whatever the project's resolution, which in the
   * project space everything here draws in means 8 times this number
   * (ESCSUITE-90). Derived at draw time rather than held in state — it is a
   * function of two things the component already has, and the box is a ref
   * precisely so a resize does not re-render the subtree.
   *
   * `contentBox` is pure arithmetic over the rect it is handed, so this reads no
   * layout: the box comes from the ResizeObserver below. Before that observer's
   * first callback there is no box, and 1 is what the preview always drew.
   */
  const handleScreenScale = useCallback((canvas: HTMLCanvasElement) => {
    const box = displayBoxRef.current;
    if (!box) return 1;
    const { scaleX } = contentBox(canvas, box, canvasDimensions);
    return scaleX > 0 ? 1 / scaleX : 1;
  }, [canvasDimensions]);

  // Draw selection handles for the selected overlay or media clip.
  //
  // The transition is derived here, from the `time` the chrome is being drawn at
  // rather than from the store's playhead: these two are called with the display
  // time the render loop is on, and the box has to follow the frame that loop
  // just composited (ESCSUITE-147). It is a function of `clips`, `tracks` and
  // that argument, so it costs one pass over the clips per repaint of the chrome
  // — and nothing at all while the preview is playing, where both of these
  // return before measuring anything.
  const drawSelectionHandles = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // In crop mode the crop chrome REPLACES the transform chrome: the canvas'
    // own pointer handling is off (see the canvas element below), so resize
    // handles would be visible and inert, over the same rectangle as the crop
    // frame.
    if (cropping) {
      cropOverlay.drawCropOverlay(
        canvas,
        time,
        cropScene,
        mediaElementFor(cropping.source),
        canvasDimensions,
        handleScreenScale(canvas),
        // From the `time` the chrome is being drawn at, exactly as the selection
        // chrome below derives its own: the crop frame is the user's picture of
        // what the crop keeps, so it has to sit on the frame the render loop just
        // composited (ESCSUITE-147).
        { transition: getActiveTransition(clips, tracks, time) }
      );
      return;
    }

    selectionOverlay.drawSelectionHandles(canvas, time, {
      clips,
      sourceVideos,
      selectedClipId,
      isPlaying,
      keyframePanelOpen,
      transition: getActiveTransition(clips, tracks, time),
    }, canvasDimensions, handleScreenScale(canvas));
  }, [canvasDimensions, clips, tracks, sourceVideos, selectedClipId, isPlaying, keyframePanelOpen,
      handleScreenScale, cropping, cropScene, mediaElementFor]);

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
      transition: getActiveTransition(clips, tracks, time),
    }, canvasDimensions, handleScreenScale(canvas));
  }, [canvasDimensions, clips, tracks, sourceVideos, selectedClipId, selectedClipIds, isPlaying,
      handleScreenScale]);

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
      drawFrame(time);
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
            ref={setCanvasRefs}
            className={styles.canvas}
            /* The project size is only the starting point: the first draw
               re-sizes the backing store to the box the observer reports. React
               does not rewrite these attributes unless the project resolution
               itself changes, which is a redraw either way. */
            width={canvasDimensions.width}
            height={canvasDimensions.height}
            style={{ cursor }}
            onMouseDown={editingTextClipId || cropping ? undefined : handleMouseDown}
            onMouseMove={editingTextClipId || cropping ? undefined : handleMouseMoveForCursor}
            onMouseUp={editingTextClipId || cropping ? undefined : handleMouseUp}
            onMouseLeave={editingTextClipId || cropping ? undefined : handleMouseLeave}
            onDoubleClick={handleDoubleClick}
          />
        )}
        {editingTextClipId && canvasEl && (
          <InlineTextEditorAnchor
            clip={clips.find(c => c.id === editingTextClipId)}
            canvas={canvasEl}
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
        {cropping && canvasEl && (
          <CropHandles
            clip={cropping.clip}
            source={cropping.source}
            canvas={canvasEl}
            projectSize={canvasDimensions}
            time={currentTime}
            locked={isTrackLocked(tracks, cropping.clip.trackId)}
            // Derived here rather than in a memo of its own: `cropping` is the
            // guard above, so this costs one pass over the clips per render
            // *while crop mode is open* and nothing at all the rest of the time.
            transition={getActiveTransition(clips, tracks, currentTime)}
            onLeave={() => setCropClipId(null)}
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
