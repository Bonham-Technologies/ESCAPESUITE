import { useRef, useEffect, useState, useCallback, useMemo, type MouseEvent } from 'react';
import { useEditorStore, getClipsAtTime } from '../../store/projectStore';
import { getVideoBlob } from '../../core/storage';
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
import { getAnimatedValues, getAnimatedVolume } from '../../utils/animation';
import { useThrottledDragUpdate } from '../../hooks';
import type { Clip, Track, TextOverlayData, ShapeOverlayData } from '../../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import * as geometry from './previewGeometry';
import { getActiveTransition } from './transitions';
import * as hitTest from './hitTest';
import * as selectionOverlay from './selectionOverlay';
import type { DragMode, ManipulableClipType } from './types';
import { InlineTextEditor } from './InlineTextEditor';
import { MarqueeSelection } from './MarqueeSelection';
import styles from './PreviewPlayer.module.css';

// Drag state for overlay/clip manipulation
interface DragState {
  clipId: string;
  clipType: ManipulableClipType;
  mode: DragMode;
  startMouseX: number;
  startMouseY: number;
  startOverlayX: number;
  startOverlayY: number;
  startWidth: number;
  startHeight: number;
  startRotation: number;
  startScaleX: number;
  startScaleY: number;
}

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
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const loopPlaybackRef = useRef(false);
  const inPointRef = useRef<number | null>(null);
  const outPointRef = useRef<number | null>(null);
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map());
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);

  const resolution = useEditorStore((state) => state.project.resolution);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const textOverlays = useEditorStore((state) => state.project.timeline.textOverlays || []);
  const shapeOverlays = useEditorStore((state) => state.project.timeline.shapeOverlays || []);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const currentTime = useEditorStore((state) => state.currentTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const timelineDuration = useEditorStore((state) => state.project.timeline.duration);
  const loopPlayback = useEditorStore((state) => state.loopPlayback);
  const inPoint = useEditorStore((state) => state.inPoint);
  const outPoint = useEditorStore((state) => state.outPoint);

  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying);
  const updateTextOverlayData = useEditorStore((state) => state.updateTextOverlayData);
  const updateShapeOverlayData = useEditorStore((state) => state.updateShapeOverlayData);
  const setSelectedClipId = useEditorStore((state) => state.setSelectedClipId);
  const selectClipsInRange = useEditorStore((state) => state.selectClipsInRange);
  const clearMultiSelection = useEditorStore((state) => state.clearMultiSelection);
  const updateClipTransform = useEditorStore((state) => state.updateClipTransform);

  // Keyframe mode: when keyframe panel is open, manipulations create keyframes
  const keyframePanelOpen = useEditorStore((state) => state.keyframePanelState.isOpen);
  const setClipKeyframe = useEditorStore((state) => state.setClipKeyframe);

  // Canvas dimensions come from project resolution (fallback to defaults for safety)
  const canvasDimensions = useMemo(() => ({
    width: resolution?.width || DEFAULT_WIDTH,
    height: resolution?.height || DEFAULT_HEIGHT,
  }), [resolution?.width, resolution?.height]);

  // Drag state for overlay manipulation
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Marquee selection state
  const [marqueeStart, setMarqueeStart] = useState<{x: number; y: number} | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = useState<{x: number; y: number} | null>(null);
  const marqueeActive = marqueeStart !== null && marqueeCurrent !== null;
  const MARQUEE_THRESHOLD = 5; // pixels before starting marquee

  // Inline text editing state
  const [editingTextClipId, setEditingTextClipId] = useState<string | null>(null);

  // Throttled updates for smooth drag performance
  // Updates are batched per animation frame to reduce store updates
  const throttledTextUpdate = useThrottledDragUpdate<{ id: string; data: Partial<TextOverlayData> }>();
  const throttledShapeUpdate = useThrottledDragUpdate<{ id: string; data: Partial<ShapeOverlayData> }>();
  const throttledTransformUpdate = useThrottledDragUpdate<{ id: string; transform: Partial<import('../../store/types').ClipTransform> }>();

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    loopPlaybackRef.current = loopPlayback;
  }, [loopPlayback]);

  useEffect(() => {
    inPointRef.current = inPoint;
    outPointRef.current = outPoint;
  }, [inPoint, outPoint]);

  // Get clips at current time for display info
  const clipsAtTime = useMemo(() =>
    getClipsAtTime(clips, tracks, currentTime),
    [clips, tracks, currentTime]
  );

  const activeClipInfo = clipsAtTime.length > 0
    ? clipsAtTime[clipsAtTime.length - 1]
    : null;

  // Preload all videos, images, and audio
  // Create a stable dependency key that changes when clips or sourceVideos change
  const clipSourceIds = useMemo(() =>
    [...new Set(clips.map(c => c.sourceVideoId).filter(id => id))].sort().join(','),
    [clips]
  );
  const sourceVideoIds = useMemo(() =>
    sourceVideos.map(s => s.id).sort().join(','),
    [sourceVideos]
  );

  useEffect(() => {
    const loadAllMedia = async () => {
      const sourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id))];
      const newVideoUrls = new Map<string, string>();
      const newImageUrls = new Map<string, string>();
      const newAudioUrls = new Map<string, string>();

      // Only show loading if we need to fetch new media
      const needsLoading = sourceIds.some(id => {
        const sourceMedia = sourceVideos.find(s => s.id === id);
        const isImage = sourceMedia?.mediaType === 'image';
        const isAudio = sourceMedia?.mediaType === 'audio';
        if (isImage) return !imageUrls.has(id);
        if (isAudio) return !audioUrls.has(id);
        return !videoUrls.has(id);
      });

      if (needsLoading) {
        setIsLoading(true);
      }

      for (const sourceId of sourceIds) {
        // Check media type
        const sourceMedia = sourceVideos.find(s => s.id === sourceId);
        const isImage = sourceMedia?.mediaType === 'image';
        const isAudio = sourceMedia?.mediaType === 'audio';

        if (isImage) {
          // Handle image
          if (imageUrls.has(sourceId)) {
            newImageUrls.set(sourceId, imageUrls.get(sourceId)!);
            continue;
          }
        } else if (isAudio) {
          // Handle audio
          if (audioUrls.has(sourceId)) {
            newAudioUrls.set(sourceId, audioUrls.get(sourceId)!);
            continue;
          }
        } else {
          // Handle video
          if (videoUrls.has(sourceId)) {
            newVideoUrls.set(sourceId, videoUrls.get(sourceId)!);
            continue;
          }
        }

        try {
          const blob = await getVideoBlob(sourceId);
          if (blob) {
            const url = URL.createObjectURL(blob);
            if (isImage) {
              newImageUrls.set(sourceId, url);
            } else if (isAudio) {
              newAudioUrls.set(sourceId, url);
            } else {
              newVideoUrls.set(sourceId, url);
            }
          }
        } catch (error) {
          console.error('Failed to load media:', error);
        }
      }

      // Cleanup old video URLs that are no longer needed
      videoUrls.forEach((url, id) => {
        if (!newVideoUrls.has(id)) {
          URL.revokeObjectURL(url);
        }
      });

      // Cleanup old image URLs
      imageUrls.forEach((url, id) => {
        if (!newImageUrls.has(id)) {
          URL.revokeObjectURL(url);
        }
      });

      // Cleanup old audio URLs
      audioUrls.forEach((url, id) => {
        if (!newAudioUrls.has(id)) {
          URL.revokeObjectURL(url);
        }
      });

      setVideoUrls(newVideoUrls);
      setImageUrls(newImageUrls);
      setAudioUrls(newAudioUrls);
      setIsLoading(false);
    };

    loadAllMedia();
  }, [clipSourceIds, sourceVideoIds]);

  // Create/update video elements
  useEffect(() => {
    const existingVideos = videoElementsRef.current;
    const newVideos = new Map<string, HTMLVideoElement>();

    videoUrls.forEach((url, sourceId) => {
      if (existingVideos.has(sourceId)) {
        newVideos.set(sourceId, existingVideos.get(sourceId)!);
      } else {
        const video = document.createElement('video');
        video.src = url;
        video.preload = 'auto';
        video.playsInline = true;
        video.muted = true; // Start muted, we'll unmute the active audio track
        video.crossOrigin = 'anonymous';
        newVideos.set(sourceId, video);
      }
    });

    existingVideos.forEach((video, id) => {
      if (!newVideos.has(id)) {
        video.pause();
        video.src = '';
      }
    });

    videoElementsRef.current = newVideos;

    // Canvas dimensions are now driven by project.resolution from the store
    // No need to derive from source video dimensions
  }, [videoUrls, sourceVideos, clips, tracks]);

  // Create/update image elements
  useEffect(() => {
    const existingImages = imageElementsRef.current;
    const newImages = new Map<string, HTMLImageElement>();

    imageUrls.forEach((url, sourceId) => {
      if (existingImages.has(sourceId)) {
        newImages.set(sourceId, existingImages.get(sourceId)!);
      } else {
        const img = document.createElement('img');
        img.src = url;
        img.crossOrigin = 'anonymous';
        newImages.set(sourceId, img);
      }
    });

    imageElementsRef.current = newImages;
  }, [imageUrls]);

  // Create/update audio elements
  useEffect(() => {
    const existingAudios = audioElementsRef.current;
    const newAudios = new Map<string, HTMLAudioElement>();

    audioUrls.forEach((url, sourceId) => {
      if (existingAudios.has(sourceId)) {
        newAudios.set(sourceId, existingAudios.get(sourceId)!);
      } else {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.preload = 'auto';
        newAudios.set(sourceId, audio);
      }
    });

    // Pause and cleanup old audio elements
    existingAudios.forEach((audio, id) => {
      if (!newAudios.has(id)) {
        audio.pause();
        audio.src = '';
      }
    });

    audioElementsRef.current = newAudios;
  }, [audioUrls]);

  // Cleanup
  useEffect(() => {
    return () => {
      videoUrls.forEach(url => URL.revokeObjectURL(url));
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      audioUrls.forEach(url => URL.revokeObjectURL(url));
      videoElementsRef.current.forEach(video => {
        video.pause();
        video.src = '';
      });
      audioElementsRef.current.forEach(audio => {
        audio.pause();
        audio.src = '';
      });
    };
  }, []);

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
  }, [sourceVideos]);

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
  }, [clips, tracks, sourceVideos, textOverlays, shapeOverlays, drawClip, blurScratchFor, editingTextClipId]);

  // Overlay bounds for a clip, against whatever source media the store holds.
  const getOverlayBounds = useCallback(
    (clip: Clip, canvas: HTMLCanvasElement, time?: number) =>
      geometry.getOverlayBounds(clip, canvas, time, sourceVideos),
    [sourceVideos]
  );

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

  // Get mouse position relative to canvas in normalized coordinates (0-1)
  // Accepts any MouseEvent (canvas or window) so dragging works outside the canvas
  const getCanvasPosition = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return geometry.getCanvasPosition(canvas, e);
  }, []);

  // Hit test: find what's at the given position (handles take priority over overlay bodies)
  const hitTestHandles = useCallback((normalizedX: number, normalizedY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return hitTest.hitTestHandles(normalizedX, normalizedY, canvas, {
      clips,
      tracks,
      sourceVideos,
      currentTime,
      selectedClipId,
      keyframePanelOpen,
    });
  }, [clips, tracks, sourceVideos, currentTime, selectedClipId, keyframePanelOpen]);

  // Mouse event handlers for drag-and-drop
  const handleMouseDown = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    if (isPlaying) return; // Don't allow dragging during playback

    const pos = getCanvasPosition(e);
    const hit = hitTestHandles(pos.x, pos.y);

    if (hit) {
      e.preventDefault();
      const clip = clips.find(c => c.id === hit.clipId);
      if (!clip) return;

      let startX = 0, startY = 0, startWidth = 0, startHeight = 0, startRotation = 0, startScaleX = 1, startScaleY = 1;

      // Check if we should use animated values (keyframe mode)
      const isKeyframeMode = keyframePanelOpen && clip.id === selectedClipId;
      const canvas = canvasRef.current;

      if (isKeyframeMode && canvas) {
        // Use animated values from getOverlayBounds
        const bounds = getOverlayBounds(clip, canvas, currentTime);
        if (bounds) {
          startX = bounds.centerX / canvas.width;
          startY = bounds.centerY / canvas.height;
          startWidth = bounds.width / canvas.width;
          startHeight = bounds.height / canvas.height;
          startRotation = bounds.rotation;
          // For scale, we need to calculate from the animated scale
          if (clip.overlayType === 'text' && clip.textData) {
            const baseScale = clip.textData.scale ?? 1;
            // Get animated scale from the bounds vs base text size
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const fontStyle = clip.textData.fontStyle === 'italic' ? 'italic ' : '';
              const fontWeight = clip.textData.fontWeight === 'bold' ? 'bold ' : '';
              ctx.font = `${fontStyle}${fontWeight}${clip.textData.fontSize}px ${clip.textData.fontFamily}`;
              const metrics = ctx.measureText(clip.textData.text);
              const baseWidth = metrics.width * baseScale;
              startScaleX = bounds.width / baseWidth * baseScale;
              startScaleY = startScaleX;
            } else {
              startScaleX = baseScale;
              startScaleY = baseScale;
            }
          } else if (hit.clipType === 'image' || hit.clipType === 'video') {
            // For image/video clips, get the current animated scale values
            const transform = clip.transform || DEFAULT_TRANSFORM;
            const timeInClip = currentTime - clip.timelinePosition;
            const animatedValues = getAnimatedValues(
              timeInClip,
              clip.duration,
              clip.animation,
              transform,
              clip.effects || DEFAULT_EFFECTS
            );
            startScaleX = animatedValues.scaleX;
            startScaleY = animatedValues.scaleY;
          }
        }
      } else if (hit.clipType === 'text' && clip.textData) {
        startX = clip.textData.x;
        startY = clip.textData.y;
        startRotation = clip.textData.rotation ?? 0;
        startScaleX = clip.textData.scale ?? 1;
        startScaleY = startScaleX;
        // Estimate text dimensions for resizing
        if (canvas) {
          const bounds = getOverlayBounds(clip, canvas, currentTime);
          if (bounds) {
            startWidth = bounds.width / canvas.width;
            startHeight = bounds.height / canvas.height;
          }
        }
      } else if (hit.clipType === 'shape' && clip.shapeData) {
        startX = clip.shapeData.x;
        startY = clip.shapeData.y;
        startWidth = clip.shapeData.width;
        startHeight = clip.shapeData.height;
        startRotation = clip.shapeData.rotation;
      } else if (hit.clipType === 'image' || hit.clipType === 'video') {
        // Image or video clip - use transform properties
        const transform = clip.transform || DEFAULT_TRANSFORM;
        startX = transform.x;
        startY = transform.y;
        startScaleX = transform.scaleX;
        startScaleY = transform.scaleY;
        startRotation = transform.rotation ?? 0;
        // Get dimensions from bounds
        if (canvas) {
          const bounds = getOverlayBounds(clip, canvas, currentTime);
          if (bounds) {
            startWidth = bounds.width / canvas.width;
            startHeight = bounds.height / canvas.height;
          }
        }
      }

      setDragState({
        clipId: hit.clipId,
        clipType: hit.clipType,
        mode: hit.mode,
        startMouseX: pos.x,
        startMouseY: pos.y,
        startOverlayX: startX,
        startOverlayY: startY,
        startWidth,
        startHeight,
        startRotation,
        startScaleX,
        startScaleY,
      });

      // Select the clip
      setSelectedClipId(hit.clipId);
    } else {
      // Clicked on empty space - start tracking for marquee selection
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        setMarqueeStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        setMarqueeCurrent(null);
      }
    }
  }, [isPlaying, getCanvasPosition, hitTestHandles, clips, setSelectedClipId, getOverlayBounds, keyframePanelOpen, selectedClipId, currentTime]);

  const handleMouseMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    // Handle marquee drag
    if (marqueeStart && !dragState) {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        const dx = currentX - marqueeStart.x;
        const dy = currentY - marqueeStart.y;
        if (Math.sqrt(dx * dx + dy * dy) >= MARQUEE_THRESHOLD) {
          setMarqueeCurrent({ x: currentX, y: currentY });
        }
      }
      return;
    }

    if (!dragState) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const pos = getCanvasPosition(e);

    // Check if we should create keyframes instead of updating overlay directly
    const clip = clips.find(c => c.id === dragState.clipId);
    const isKeyframeMode = keyframePanelOpen && clip && clip.id === selectedClipId;

    // Calculate keyframe time (relative to clip start)
    const keyframeTime = clip ? currentTime - clip.timelinePosition : 0;

    // Helper to create keyframe or update overlay
    const applyChange = (property: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY', value: number) => {
      if (isKeyframeMode && clip) {
        setClipKeyframe(clip.id, property, {
          time: keyframeTime,
          value,
          easing: 'ease-in-out',
        });
      }
    };

    if (dragState.mode === 'move') {
      // Move mode
      const deltaX = pos.x - dragState.startMouseX;
      const deltaY = pos.y - dragState.startMouseY;
      const newX = Math.max(0, Math.min(1, dragState.startOverlayX + deltaX));
      const newY = Math.max(0, Math.min(1, dragState.startOverlayY + deltaY));

      if (isKeyframeMode) {
        applyChange('x', newX);
        applyChange('y', newY);
      } else {
        // Use throttled updates for smoother drag performance
        if (dragState.clipType === 'text') {
          throttledTextUpdate.scheduleUpdate(
            ({ id, data }) => updateTextOverlayData(id, data, true),
            { id: dragState.clipId, data: { x: newX, y: newY } }
          );
        } else if (dragState.clipType === 'shape') {
          throttledShapeUpdate.scheduleUpdate(
            ({ id, data }) => updateShapeOverlayData(id, data, true),
            { id: dragState.clipId, data: { x: newX, y: newY } }
          );
        } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
          throttledTransformUpdate.scheduleUpdate(
            ({ id, transform }) => updateClipTransform(id, transform, true),
            { id: dragState.clipId, transform: { x: newX, y: newY } }
          );
        }
      }
    } else if (dragState.mode === 'rotate') {
      // Rotation mode - calculate angle from center to mouse
      const centerX = dragState.startOverlayX;
      const centerY = dragState.startOverlayY;
      const angle = Math.atan2(pos.y - centerY, pos.x - centerX);
      const startAngle = Math.atan2(
        dragState.startMouseY - centerY,
        dragState.startMouseX - centerX
      );
      const deltaAngle = ((angle - startAngle) * 180) / Math.PI;
      const newRotation = dragState.startRotation + deltaAngle;

      if (isKeyframeMode) {
        applyChange('rotation', newRotation);
      } else {
        // Use throttled updates for smoother drag performance
        if (dragState.clipType === 'text') {
          throttledTextUpdate.scheduleUpdate(
            ({ id, data }) => updateTextOverlayData(id, data, true),
            { id: dragState.clipId, data: { rotation: newRotation } }
          );
        } else if (dragState.clipType === 'shape') {
          throttledShapeUpdate.scheduleUpdate(
            ({ id, data }) => updateShapeOverlayData(id, data, true),
            { id: dragState.clipId, data: { rotation: newRotation } }
          );
        } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
          throttledTransformUpdate.scheduleUpdate(
            ({ id, transform }) => updateClipTransform(id, transform, true),
            { id: dragState.clipId, transform: { rotation: newRotation } }
          );
        }
      }
    } else {
      // Resize modes
      const deltaX = pos.x - dragState.startMouseX;
      const deltaY = pos.y - dragState.startMouseY;

      let newWidth = dragState.startWidth;
      let newHeight = dragState.startHeight;
      let newX = dragState.startOverlayX;
      let newY = dragState.startOverlayY;

      // Handle different resize directions.
      // Match on the compass direction alone: the mode name itself contains
      // the 'e' and the 's' of "resize", so every handle would look like an
      // east/south one.
      const mode = dragState.mode;
      const direction = mode.startsWith('resize-') ? mode.slice('resize-'.length) : '';

      if (direction.includes('e')) {
        newWidth = Math.max(0.02, dragState.startWidth + deltaX);
      }
      if (direction.includes('w')) {
        const widthDelta = -deltaX;
        newWidth = Math.max(0.02, dragState.startWidth + widthDelta);
        newX = dragState.startOverlayX + deltaX / 2;
      }
      if (direction.includes('s')) {
        newHeight = Math.max(0.02, dragState.startHeight + deltaY);
      }
      if (direction.includes('n')) {
        const heightDelta = -deltaY;
        newHeight = Math.max(0.02, dragState.startHeight + heightDelta);
        newY = dragState.startOverlayY + deltaY / 2;
      }

      // Corner handles: Shift toggles lock state. When locked, scale uniformly.
      if (mode === 'resize-nw' || mode === 'resize-ne' || mode === 'resize-sw' || mode === 'resize-se') {
        // Determine effective lock: Shift temporarily toggles the clip's scaleLocked setting
        const clipScaleLocked = clip?.transform.scaleLocked ?? true;
        const effectiveLock = e.shiftKey ? !clipScaleLocked : clipScaleLocked;

        const widthRatio = newWidth / dragState.startWidth;
        const heightRatio = newHeight / dragState.startHeight;

        if (isKeyframeMode) {
          // Calculate scale values for keyframes
          if (effectiveLock) {
            // Uniform scale: use the diagonal (larger ratio) for both axes
            const uniformRatio = Math.max(widthRatio, heightRatio);
            applyChange('scaleX', Math.max(0.1, uniformRatio * dragState.startScaleX));
            applyChange('scaleY', Math.max(0.1, uniformRatio * dragState.startScaleY));
          } else {
            applyChange('scaleX', Math.max(0.1, widthRatio * dragState.startScaleX));
            applyChange('scaleY', Math.max(0.1, heightRatio * dragState.startScaleY));
          }
          applyChange('x', newX);
          applyChange('y', newY);
        } else {
          // For shapes, update width/height
          // For text, update scale
          // For images/videos, update scaleX/scaleY
          // Use throttled updates for smoother drag performance
          if (dragState.clipType === 'text') {
            // Calculate scale based on the larger dimension change
            const newScale = Math.max(0.1, dragState.startScaleX * Math.max(widthRatio, heightRatio));
            throttledTextUpdate.scheduleUpdate(
              ({ id, data }) => updateTextOverlayData(id, data, true),
              { id: dragState.clipId, data: { scale: newScale, x: newX, y: newY } }
            );
          } else if (dragState.clipType === 'shape') {
            if (effectiveLock) {
              // Uniform scale for shapes: use the larger ratio for both dimensions
              const uniformRatio = Math.max(widthRatio, heightRatio);
              const uniformWidth = Math.max(0.02, dragState.startWidth * uniformRatio);
              const uniformHeight = Math.max(0.02, dragState.startHeight * uniformRatio);
              throttledShapeUpdate.scheduleUpdate(
                ({ id, data }) => updateShapeOverlayData(id, data, true),
                { id: dragState.clipId, data: { width: uniformWidth, height: uniformHeight, x: newX, y: newY } }
              );
            } else {
              throttledShapeUpdate.scheduleUpdate(
                ({ id, data }) => updateShapeOverlayData(id, data, true),
                { id: dragState.clipId, data: { width: newWidth, height: newHeight, x: newX, y: newY } }
              );
            }
          } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
            if (effectiveLock) {
              // Uniform scale: apply the same ratio to both axes,
              // preserving any existing difference between scaleX and scaleY
              const uniformRatio = Math.max(widthRatio, heightRatio);
              const newScaleX = Math.max(0.1, dragState.startScaleX * uniformRatio);
              const newScaleY = Math.max(0.1, dragState.startScaleY * uniformRatio);
              throttledTransformUpdate.scheduleUpdate(
                ({ id, transform }) => updateClipTransform(id, transform, true),
                { id: dragState.clipId, transform: { scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY } }
              );
            } else {
              const newScaleX = Math.max(0.1, dragState.startScaleX * widthRatio);
              const newScaleY = Math.max(0.1, dragState.startScaleY * heightRatio);
              throttledTransformUpdate.scheduleUpdate(
                ({ id, transform }) => updateClipTransform(id, transform, true),
                { id: dragState.clipId, transform: { scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY } }
              );
            }
          }
        }
      } else {
        // Side handles - single axis resize
        if (isKeyframeMode) {
          const widthRatio = newWidth / dragState.startWidth;
          const heightRatio = newHeight / dragState.startHeight;
          if (direction.includes('e') || direction.includes('w')) {
            applyChange('scaleX', Math.max(0.1, widthRatio * dragState.startScaleX));
          }
          if (direction.includes('n') || direction.includes('s')) {
            applyChange('scaleY', Math.max(0.1, heightRatio * dragState.startScaleY));
          }
          applyChange('x', newX);
          applyChange('y', newY);
        } else {
          // Use throttled updates for smoother drag performance
          if (dragState.clipType === 'text') {
            // For text, side handles also scale
            const widthRatio = newWidth / dragState.startWidth;
            const heightRatio = newHeight / dragState.startHeight;
            const scaleRatio = direction.includes('e') || direction.includes('w') ? widthRatio : heightRatio;
            const newScale = Math.max(0.1, dragState.startScaleX * scaleRatio);
            throttledTextUpdate.scheduleUpdate(
              ({ id, data }) => updateTextOverlayData(id, data, true),
              { id: dragState.clipId, data: { scale: newScale, x: newX, y: newY } }
            );
          } else if (dragState.clipType === 'shape') {
            throttledShapeUpdate.scheduleUpdate(
              ({ id, data }) => updateShapeOverlayData(id, data, true),
              { id: dragState.clipId, data: { width: newWidth, height: newHeight, x: newX, y: newY } }
            );
          } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
            const widthRatio = newWidth / dragState.startWidth;
            const heightRatio = newHeight / dragState.startHeight;
            let newScaleX = dragState.startScaleX;
            let newScaleY = dragState.startScaleY;
            if (direction.includes('e') || direction.includes('w')) {
              newScaleX = Math.max(0.1, dragState.startScaleX * widthRatio);
            }
            if (direction.includes('n') || direction.includes('s')) {
              newScaleY = Math.max(0.1, dragState.startScaleY * heightRatio);
            }
            throttledTransformUpdate.scheduleUpdate(
              ({ id, transform }) => updateClipTransform(id, transform, true),
              { id: dragState.clipId, transform: { scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY } }
            );
          }
        }
      }
    }

    // Redraw selection handles after update
    requestAnimationFrame(() => {
      drawFrame(currentTime);
      drawSelectionHandles(currentTime);
      drawMultiSelectHandles(currentTime);
    });
  }, [dragState, getCanvasPosition, updateTextOverlayData, updateShapeOverlayData, updateClipTransform, currentTime, drawFrame, drawSelectionHandles, drawMultiSelectHandles, keyframePanelOpen, selectedClipId, clips, setClipKeyframe, throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate, marqueeStart]);

  const handleMouseUp = useCallback((e?: MouseEvent<HTMLCanvasElement>) => {
    // Handle marquee selection completion
    if (marqueeStart) {
      if (marqueeActive && canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Calculate rendered canvas area (accounting for object-fit: contain)
        const canvasAspect = canvas.width / canvas.height;
        const elementAspect = rect.width / rect.height;
        let renderedWidth: number, renderedHeight: number, offsetX: number, offsetY: number;
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

        // Convert marquee rect from CSS pixels to normalized canvas coords (0-1)
        const current = marqueeCurrent!;
        const normLeft = Math.min(marqueeStart.x, current.x);
        const normTop = Math.min(marqueeStart.y, current.y);
        const normRight = Math.max(marqueeStart.x, current.x);
        const normBottom = Math.max(marqueeStart.y, current.y);

        const mLeft = (normLeft - offsetX) / renderedWidth;
        const mTop = (normTop - offsetY) / renderedHeight;
        const mRight = (normRight - offsetX) / renderedWidth;
        const mBottom = (normBottom - offsetY) / renderedHeight;

        // Find overlay clips whose bounding boxes intersect the marquee
        const intersecting: string[] = [];
        for (const clip of clips) {
          // Only check clips visible at current time
          const clipEnd = clip.timelinePosition + clip.duration;
          if (currentTime < clip.timelinePosition || currentTime >= clipEnd) continue;

          const bounds = getOverlayBounds(clip, canvas, currentTime);
          if (!bounds) continue;

          // Convert bounds to normalized coords
          const bLeft = (bounds.centerX - bounds.width / 2) / canvas.width;
          const bTop = (bounds.centerY - bounds.height / 2) / canvas.height;
          const bRight = (bounds.centerX + bounds.width / 2) / canvas.width;
          const bBottom = (bounds.centerY + bounds.height / 2) / canvas.height;

          // Check AABB intersection (ignoring rotation for simplicity)
          if (bRight > mLeft && bLeft < mRight && bBottom > mTop && bTop < mBottom) {
            intersecting.push(clip.id);
          }
        }

        const nativeEvent = e as unknown as { ctrlKey?: boolean; metaKey?: boolean } | undefined;
        if (nativeEvent?.ctrlKey || nativeEvent?.metaKey) {
          // Add to existing selection
          const existing = Array.from(selectedClipIds);
          const combined = [...new Set([...existing, ...intersecting])];
          selectClipsInRange(combined);
        } else {
          selectClipsInRange(intersecting);
        }
      } else {
        // No drag happened - just a click on empty space: deselect
        clearMultiSelection();
        setSelectedClipId(null);
      }

      setMarqueeStart(null);
      setMarqueeCurrent(null);
      return;
    }

    if (dragState) {
      // Flush any pending throttled updates to ensure state is current
      throttledTextUpdate.flush();
      throttledShapeUpdate.flush();
      throttledTransformUpdate.flush();

      const clip = clips.find(c => c.id === dragState.clipId);
      const isKeyframeMode = keyframePanelOpen && clip && clip.id === selectedClipId;

      // Only commit changes to history when NOT in keyframe mode
      // (In keyframe mode, we're creating keyframes instead)
      if (!isKeyframeMode && clip) {
        if (dragState.clipType === 'text' && clip.textData) {
          updateTextOverlayData(dragState.clipId, {
            x: clip.textData.x,
            y: clip.textData.y,
            rotation: clip.textData.rotation,
            scale: clip.textData.scale,
          });
        } else if (dragState.clipType === 'shape' && clip.shapeData) {
          updateShapeOverlayData(dragState.clipId, {
            x: clip.shapeData.x,
            y: clip.shapeData.y,
            width: clip.shapeData.width,
            height: clip.shapeData.height,
            rotation: clip.shapeData.rotation,
          });
        } else if ((dragState.clipType === 'image' || dragState.clipType === 'video') && clip.transform) {
          updateClipTransform(dragState.clipId, {
            x: clip.transform.x,
            y: clip.transform.y,
            scaleX: clip.transform.scaleX,
            scaleY: clip.transform.scaleY,
            rotation: clip.transform.rotation,
          });
        }
      }
    }
    setDragState(null);
  }, [dragState, clips, updateTextOverlayData, updateShapeOverlayData, updateClipTransform, keyframePanelOpen, selectedClipId, throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate, marqueeStart, marqueeActive, marqueeCurrent, currentTime, getOverlayBounds, selectedClipIds, selectClipsInRange, clearMultiSelection, setSelectedClipId]);

  const handleMouseLeave = useCallback(() => {
    // Don't cancel drag when mouse leaves canvas — window listeners handle it
    if (dragState) return;

    // Only cancel non-drag operations
    setMarqueeStart(null);
    setMarqueeCurrent(null);
  }, [dragState]);

  // Window-level mouse listeners during drag — allows dragging outside the canvas
  useEffect(() => {
    if (!dragState) return;

    const onWindowMouseMove = (e: globalThis.MouseEvent) => {
      handleMouseMove(e as unknown as MouseEvent<HTMLCanvasElement>);
    };

    const onWindowMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [dragState, handleMouseMove, handleMouseUp]);

  // Double-click handler to enter inline text editing
  // Works even in keyframe mode — double-click always opens text editor
  const handleDoubleClick = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    if (isPlaying) return;

    // Cancel any drag that started from the first click of the double-click
    if (dragState) {
      setDragState(null);
    }

    const pos = getCanvasPosition(e);

    // Check all active text clips, not just via hitTestHandles (which is keyframe-restricted)
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mouseX = pos.x * canvas.width;
    const mouseY = pos.y * canvas.height;

    const activeClips = getClipsAtTime(clips, tracks, currentTime);
    // Check in reverse z-order (top-most first)
    for (const { clip } of [...activeClips].reverse()) {
      if (clip.overlayType !== 'text' || !clip.textData) continue;

      const bounds = getOverlayBounds(clip, canvas, currentTime);
      if (!bounds) continue;

      const { centerX, centerY, width, height, rotation } = bounds;
      const halfW = width / 2;
      const halfH = height / 2;

      // Transform mouse into local space (accounting for rotation)
      const rad = (-rotation * Math.PI) / 180;
      const dx = mouseX - centerX;
      const dy = mouseY - centerY;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

      if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
        e.preventDefault();
        e.stopPropagation();
        setEditingTextClipId(clip.id);
        setSelectedClipId(clip.id);
        return;
      }
    }
  }, [isPlaying, dragState, getCanvasPosition, clips, tracks, currentTime, getOverlayBounds, setSelectedClipId]);

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

  // Get cursor based on drag mode
  const getCursorForMode = (mode: DragMode): string => {
    switch (mode) {
      case 'move': return 'move';
      case 'rotate': return 'crosshair';
      case 'resize-n':
      case 'resize-s': return 'ns-resize';
      case 'resize-e':
      case 'resize-w': return 'ew-resize';
      case 'resize-nw':
      case 'resize-se': return 'nwse-resize';
      case 'resize-ne':
      case 'resize-sw': return 'nesw-resize';
      default: return 'default';
    }
  };

  // Determine cursor based on hover state
  const getCursor = useCallback((e: MouseEvent<HTMLCanvasElement>): string => {
    if (isPlaying) return 'default';
    if (dragState) return getCursorForMode(dragState.mode);

    const pos = getCanvasPosition(e);
    const hit = hitTestHandles(pos.x, pos.y);
    return hit ? getCursorForMode(hit.mode) : 'default';
  }, [isPlaying, dragState, getCanvasPosition, hitTestHandles]);

  // Track cursor for display
  const [cursor, setCursor] = useState('default');

  const handleMouseMoveForCursor = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    setCursor(getCursor(e));
    handleMouseMove(e);
  }, [getCursor, handleMouseMove]);

  // Redraw frame when media URLs change (e.g., after undo)
  // Only trigger on URL changes, not on every currentTime or clips change
  const videoUrlsKey = useMemo(() => [...videoUrls.keys()].sort().join(','), [videoUrls]);
  const imageUrlsKey = useMemo(() => [...imageUrls.keys()].sort().join(','), [imageUrls]);

  useEffect(() => {
    if (isPlaying) return;
    // Give video/image elements time to update after URL changes
    const timeout = setTimeout(() => {
      drawFrame(currentTimeRef.current);
      drawSelectionHandles(currentTimeRef.current);
      drawMultiSelectHandles(currentTimeRef.current);
    }, 50);
    return () => clearTimeout(timeout);
  }, [videoUrlsKey, imageUrlsKey, isPlaying, drawFrame, drawSelectionHandles, drawMultiSelectHandles]);

  // Handle scrubbing (when not playing)
  // Simple approach: seek videos, then poll-redraw as seeks settle.
  // No cancelled flags, no complex ref machinery. Each currentTime change
  // starts its own seek+poll cycle; cleanup just cancels the rAF poll.
  // The last poll cycle always wins because it draws at the latest currentTime.
  useEffect(() => {
    if (isPlaying) return;

    setDisplayTime(currentTime);

    const activeClips = getClipsAtTime(clips, tracks, currentTime);

    // No active clips — draw black, done
    if (activeClips.length === 0) {
      drawFrame(currentTime, false);
      drawSelectionHandles(currentTime);
      drawMultiSelectHandles(currentTime);
      return;
    }

    // Check if any active clips need video seeking
    const activeTransition = getActiveTransition(clips, tracks, currentTime);
    let needsVideoSeek = false;

    for (const { clip, clipTime } of activeClips) {
      if (clip.overlayType) continue; // Text/shape overlays don't need seeking
      const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
      if (sourceMedia?.mediaType === 'image' || sourceMedia?.mediaType === 'audio') continue;

      const video = videoElementsRef.current.get(clip.sourceVideoId);
      if (!video) continue;

      const sourceTime = clip.startTime + clipTime;
      if (Math.abs(video.currentTime - sourceTime) > 0.05) {
        video.currentTime = sourceTime;
        needsVideoSeek = true;
      }
    }

    if (activeTransition) {
      const { incomingClip } = activeTransition;
      const inClipTime = Math.max(0, currentTime - incomingClip.timelinePosition);
      const inSourceTime = incomingClip.startTime + inClipTime;
      const sourceMedia = sourceVideos.find(s => s.id === incomingClip.sourceVideoId);
      if (sourceMedia?.mediaType !== 'image' && sourceMedia?.mediaType !== 'audio') {
        const video = videoElementsRef.current.get(incomingClip.sourceVideoId);
        if (video && Math.abs(video.currentTime - inSourceTime) > 0.05) {
          video.currentTime = inSourceTime;
          needsVideoSeek = true;
        }
      }
    }

    // If no video seeking needed (overlays only, or videos already at position),
    // draw once and be done — no poll needed
    if (!needsVideoSeek) {
      drawFrame(currentTime, false);
      drawSelectionHandles(currentTime);
      drawMultiSelectHandles(currentTime);
      return;
    }

    // Event-driven redraw: listen for seeked events instead of polling.
    let settled = false;

    // Listen for seeked events on all active videos to know when to redraw
    const seekedHandler = () => {
      if (settled) return;
      settled = true;
      // One final accurate draw after seek completes
      requestAnimationFrame(() => {
        drawFrame(currentTime, false);
        drawSelectionHandles(currentTime);
        drawMultiSelectHandles(currentTime);
      });
    };

    const activeVideos: HTMLVideoElement[] = [];
    for (const { clip } of activeClips) {
      if (clip.overlayType) continue;
      const video = videoElementsRef.current.get(clip.sourceVideoId);
      if (video) {
        video.addEventListener('seeked', seekedHandler, { once: true });
        activeVideos.push(video);
      }
    }

    // Draw once immediately with best available frame
    drawFrame(currentTime, false);
    drawSelectionHandles(currentTime);
    drawMultiSelectHandles(currentTime);

    // Fallback: if seeked doesn't fire within 300ms, draw anyway
    const fallbackTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        drawFrame(currentTime, false);
        drawSelectionHandles(currentTime);
        drawMultiSelectHandles(currentTime);
      }
    }, 300);

    // Cleanup just removes listeners — no rAF loop to cancel
    return () => {
      settled = true;
      clearTimeout(fallbackTimeout);
      for (const video of activeVideos) {
        video.removeEventListener('seeked', seekedHandler);
      }
    };
  }, [currentTime, isPlaying, clips, tracks, drawFrame, drawSelectionHandles, drawMultiSelectHandles, sourceVideos]);

  // Invalidate frame cache when timeline content changes
  // This ensures we don't show stale cached frames after edits
  const timelineContentKey = useMemo(() => {
    // Create a key that changes when timeline content changes
    // We check: clip positions, durations, transforms, effects, overlays, track visibility
    return clips.map(c =>
      `${c.id}:${c.timelinePosition}:${c.duration}:${c.startTime}:${c.endTime}:` +
      `${JSON.stringify(c.transform)}:${JSON.stringify(c.effects)}:${JSON.stringify(c.animation)}:` +
      `${JSON.stringify(c.textData)}:${JSON.stringify(c.shapeData)}`
    ).join('|') + '||' + tracks.map(t => `${t.id}:${t.visible}`).join('|');
  }, [clips, tracks]);

  useEffect(() => {
    // Clear frame cache when timeline content changes
    const frameCache = getFrameCache();
    frameCache.clear();
  }, [timelineContentKey]);

  // Handle playback
  useEffect(() => {
    if (!isPlaying) {
      // Stop all videos
      videoElementsRef.current.forEach(video => {
        video.pause();
        video.muted = true;
      });

      // Stop all audio clips
      audioElementsRef.current.forEach(audio => {
        audio.pause();
      });

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      // Don't draw here — the scrubbing effect (which watches currentTime when !isPlaying)
      // handles drawing the correct frame. Drawing here with currentTimeRef would race
      // with timeline seek and overwrite the seeked frame with the stale playback position.
      return;
    }

    if (clips.length === 0) {
      setIsPlaying(false);
      return;
    }

    // Find active clips and set up audio
    const activeClips = getClipsAtTime(clips, tracks, currentTime);

    if (activeClips.length === 0) {
      // No clips at current position, find next clip
      const nextClip = clips
        .filter(c => c.timelinePosition > currentTime)
        .sort((a, b) => a.timelinePosition - b.timelinePosition)[0];

      if (nextClip) {
        setCurrentTime(nextClip.timelinePosition);
      } else {
        setIsPlaying(false);
        setCurrentTime(timelineDuration);
      }
      return;
    }

    // Collect all clips that have audio (videos and audio-only clips)
    const audioClips: { clip: Clip; clipTime: number; track: Track }[] = [];

    for (const clipData of activeClips) {
      const sourceMedia = sourceVideos.find(s => s.id === clipData.clip.sourceVideoId);
      // Skip images and muted tracks - they don't produce audio
      if (sourceMedia?.mediaType === 'image' || clipData.track.muted) continue;
      audioClips.push(clipData);
    }

    // Pause all audio elements first
    audioElementsRef.current.forEach((audio) => {
      audio.pause();
    });

    // Start all active videos at correct positions (skip images and audio)
    for (const { clip, clipTime } of activeClips) {
      const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
      // Skip image and audio clips - they don't need video playback
      if (sourceMedia?.mediaType === 'image' || sourceMedia?.mediaType === 'audio') continue;

      const video = videoElementsRef.current.get(clip.sourceVideoId);
      if (!video) continue;

      const track = tracks.find(t => t.id === clip.trackId);
      const sourceTime = clip.startTime + clipTime;
      video.currentTime = sourceTime;

      // Set audio for ALL video clips (browser will mix them)
      // Apply both track volume and animated clip volume
      video.muted = track?.muted ?? false;
      const trackVolume = track?.volume ?? 1;
      const clipVolume = getAnimatedVolume(clipTime, clip.animation, 1);
      video.volume = trackVolume * clipVolume;

      video.play().catch(console.error);
    }

    // Start all active audio-only clips
    for (const clipData of audioClips) {
      const sourceMedia = sourceVideos.find(s => s.id === clipData.clip.sourceVideoId);
      if (sourceMedia?.mediaType !== 'audio') continue;

      const audio = audioElementsRef.current.get(clipData.clip.sourceVideoId);
      if (!audio) continue;

      const sourceTime = clipData.clip.startTime + clipData.clipTime;
      audio.currentTime = sourceTime;
      // Apply both track volume and animated clip volume
      const trackVolume = clipData.track?.volume ?? 1;
      const clipVolume = getAnimatedVolume(clipData.clipTime, clipData.clip.animation, 1);
      audio.volume = trackVolume * clipVolume;
      audio.play().catch(console.error);
    }

    // Track playback start
    let playbackStartTime = performance.now();
    let startTimelineTime = currentTime;
    let lastStoreUpdateTime = startTimelineTime;

    // Track last active clips to detect transitions
    let lastActiveClipIds = new Set(activeClips.map(c => c.clip.id));

    // Animation loop - runs independently of React
    const animate = () => {
      if (!isPlayingRef.current) return;

      const elapsed = (performance.now() - playbackStartTime) / 1000;
      const newTimelineTime = startTimelineTime + elapsed;

      // Determine loop boundaries based on in/out points
      const loopEnd = (loopPlaybackRef.current && inPointRef.current !== null && outPointRef.current !== null)
        ? outPointRef.current
        : timelineDuration;
      const loopStart = (loopPlaybackRef.current && inPointRef.current !== null && outPointRef.current !== null)
        ? inPointRef.current
        : 0;

      // Check if we've reached the end of the timeline (or out point when looping with in/out)
      if (newTimelineTime >= loopEnd) {
        if (loopPlaybackRef.current) {
          // Loop back to the beginning (or in point)
          // Reset playback start time to now, starting from loop start position
          playbackStartTime = performance.now();
          startTimelineTime = loopStart;

          // Reset all videos to loop start and restart them
          videoElementsRef.current.forEach(video => {
            video.currentTime = loopStart;
            video.pause();
          });

          // Reset all audio clips
          audioElementsRef.current.forEach(audio => {
            audio.currentTime = loopStart;
            audio.pause();
          });

          // Update display and continue
          setCurrentTime(loopStart);
          setDisplayTime(loopStart);
          lastActiveClipIds = new Set();
          lastStoreUpdateTime = loopStart;

          // Continue animation loop
          animationFrameRef.current = requestAnimationFrame(animate);
          return;
        } else {
          // Stop playback at the end
          videoElementsRef.current.forEach(video => video.pause());
          audioElementsRef.current.forEach(audio => audio.pause());
          setIsPlaying(false);
          setCurrentTime(timelineDuration);
          setDisplayTime(timelineDuration);
          return;
        }
      }

      // Get current active clips
      const currentActiveClips = getClipsAtTime(clips, tracks, newTimelineTime);
      const currentClipIds = new Set(currentActiveClips.map(c => c.clip.id));

      // Check if clip set has changed (new clips appeared or old clips ended)
      const clipsChanged = currentClipIds.size !== lastActiveClipIds.size ||
        [...currentClipIds].some(id => !lastActiveClipIds.has(id)) ||
        [...lastActiveClipIds].some(id => !currentClipIds.has(id));

      if (clipsChanged) {
        // Clips changed - need to update video playback and audio routing
        lastActiveClipIds = currentClipIds;

        // Pause videos that are no longer active
        videoElementsRef.current.forEach((video, sourceId) => {
          const isActive = currentActiveClips.some(c => c.clip.sourceVideoId === sourceId);
          if (!isActive) {
            video.pause();
            video.muted = true;
          }
        });

        // Pause audio clips that are no longer active
        audioElementsRef.current.forEach((audio, sourceId) => {
          const isActive = currentActiveClips.some(c => c.clip.sourceVideoId === sourceId);
          if (!isActive) {
            audio.pause();
          }
        });

        // Start/sync newly active videos (skip images and audio)
        // ALL videos play their audio (browser mixes them)
        for (const { clip, clipTime } of currentActiveClips) {
          const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
          // Skip image and audio clips
          if (sourceMedia?.mediaType === 'image' || sourceMedia?.mediaType === 'audio') continue;

          const video = videoElementsRef.current.get(clip.sourceVideoId);
          if (!video) continue;

          const track = tracks.find(t => t.id === clip.trackId);
          const sourceTime = clip.startTime + clipTime;

          // Seek if needed
          if (Math.abs(video.currentTime - sourceTime) > 0.1) {
            video.currentTime = sourceTime;
          }

          // Set audio for ALL video clips (browser will mix them)
          // Apply both track volume and animated clip volume
          video.muted = track?.muted ?? false;
          const trackVolume = track?.volume ?? 1;
          const clipVolume = getAnimatedVolume(clipTime, clip.animation, 1);
          video.volume = trackVolume * clipVolume;

          // Make sure video is playing
          if (video.paused) {
            video.play().catch(console.error);
          }
        }

        // Start/sync audio-only clips
        for (const clipData of currentActiveClips) {
          const sourceMedia = sourceVideos.find(s => s.id === clipData.clip.sourceVideoId);
          if (sourceMedia?.mediaType !== 'audio') continue;
          if (clipData.track.muted) continue;

          const audio = audioElementsRef.current.get(clipData.clip.sourceVideoId);
          if (!audio) continue;

          const sourceTime = clipData.clip.startTime + clipData.clipTime;

          // Seek if needed
          if (Math.abs(audio.currentTime - sourceTime) > 0.1) {
            audio.currentTime = sourceTime;
          }

          // Apply both track volume and animated clip volume
          const trackVolume = clipData.track?.volume ?? 1;
          const clipVolume = getAnimatedVolume(clipData.clipTime, clipData.clip.animation, 1);
          audio.volume = trackVolume * clipVolume;

          // Make sure audio is playing
          if (audio.paused) {
            audio.play().catch(console.error);
          }
        }
      } else {
        // Clips haven't changed, but we still need to update volumes for keyframe animation
        // This ensures volume keyframes are applied continuously during playback
        for (const { clip, clipTime, track } of currentActiveClips) {
          const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
          if (!sourceMedia) continue;

          const trackVolume = track?.volume ?? 1;
          const clipVolume = getAnimatedVolume(clipTime, clip.animation, 1);
          const combinedVolume = trackVolume * clipVolume;

          if (sourceMedia.mediaType === 'audio') {
            const audio = audioElementsRef.current.get(clip.sourceVideoId);
            if (audio && !track.muted) {
              audio.volume = combinedVolume;
            }
          } else if (sourceMedia.mediaType !== 'image') {
            // Video clips
            const video = videoElementsRef.current.get(clip.sourceVideoId);
            if (video && !track?.muted) {
              video.volume = combinedVolume;
            }
          }
        }
      }

      // Update display time (local state, fast)
      setDisplayTime(newTimelineTime);

      // Update store less frequently (every 200ms)
      if (newTimelineTime - lastStoreUpdateTime > 0.2) {
        setCurrentTime(newTimelineTime);
        lastStoreUpdateTime = newTimelineTime;
      }

      // Draw the composited frame (even if there are no active clips - shows black)
      drawFrame(newTimelineTime);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, clips, tracks, timelineDuration, setIsPlaying, setCurrentTime, drawFrame, sourceVideos]);

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
