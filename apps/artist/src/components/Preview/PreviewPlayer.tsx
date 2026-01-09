import { useRef, useEffect, useState, useCallback, useMemo, type MouseEvent } from 'react';
import { useEditorStore, getClipsAtTime } from '../../store/projectStore';
import { getVideoBlob } from '../../core/storage';
import { getFrameCache } from '../../core/frameCache';
import { formatTimecode } from '../../utils/timeUtils';
import { getAnimatedValues } from '../../utils/animation';
import { useThrottledDragUpdate } from '../../hooks';
import type { BlendMode, Clip, Track, TransitionType, TextOverlayData, ShapeOverlayData } from '../../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import styles from './PreviewPlayer.module.css';

// Drag modes for different transform operations
type DragMode = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' |
                'resize-n' | 'resize-s' | 'resize-e' | 'resize-w' | 'rotate';

// Clip type for manipulation - includes overlays and media clips
type ManipulableClipType = 'text' | 'shape' | 'image' | 'video';

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

// Handle size in pixels (for hit detection and drawing)
const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 25; // Distance above the bounding box

// Map blend modes to canvas globalCompositeOperation
const blendModeToCanvas: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  add: 'lighter',
};

// Default canvas dimensions
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

// Helper to get transition info between clips
interface TransitionInfo {
  outgoingClip: Clip;
  incomingClip: Clip;
  progress: number; // 0 = start of transition, 1 = end
  type: TransitionType;
}

function getActiveTransition(clips: Clip[], tracks: Track[], time: number): TransitionInfo | null {
  // Find clips that are in a transition period
  for (const clip of clips) {
    if (clip.transition.type === 'none' || clip.transition.duration <= 0) continue;

    const track = tracks.find(t => t.id === clip.trackId);
    if (!track || !track.visible) continue;

    const clipEnd = clip.timelinePosition + clip.duration;
    const transitionStart = clipEnd - clip.transition.duration;

    // Check if we're in the transition period
    if (time >= transitionStart && time < clipEnd) {
      // Find the incoming clip - first check same track, then look at other tracks
      // The incoming clip should be the one that will be visible when this clip ends

      // First, try to find a clip on the same track that starts at/near the end of this clip
      let incomingClip = clips
        .filter(c => c.trackId === clip.trackId && c.timelinePosition >= clipEnd - 0.01 && c.id !== clip.id)
        .sort((a, b) => a.timelinePosition - b.timelinePosition)[0];

      // If no same-track clip, find the topmost clip that will be visible at the end time
      // (excluding the current clip and overlays)
      if (!incomingClip) {
        const clipsAtEnd = clips
          .filter(c => {
            if (c.id === clip.id) return false;
            if (c.overlayType) return false; // Skip overlays
            const cEnd = c.timelinePosition + c.duration;
            return c.timelinePosition <= clipEnd && cEnd > clipEnd;
          })
          .map(c => {
            const t = tracks.find(tr => tr.id === c.trackId);
            return { clip: c, track: t };
          })
          .filter(({ track: t }) => t && t.visible)
          .sort((a, b) => (b.track?.index ?? 0) - (a.track?.index ?? 0)); // Higher index = on top

        if (clipsAtEnd.length > 0) {
          incomingClip = clipsAtEnd[0].clip;
        }
      }

      if (incomingClip) {
        const progress = (time - transitionStart) / clip.transition.duration;
        return {
          outgoingClip: clip,
          incomingClip,
          progress: Math.min(1, Math.max(0, progress)),
          type: clip.transition.type,
        };
      }
    }
  }
  return null;
}

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const loopPlaybackRef = useRef(false);
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map());
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [displayTime, setDisplayTime] = useState(0);

  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const textOverlays = useEditorStore((state) => state.project.timeline.textOverlays || []);
  const shapeOverlays = useEditorStore((state) => state.project.timeline.shapeOverlays || []);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const currentTime = useEditorStore((state) => state.currentTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const timelineDuration = useEditorStore((state) => state.project.timeline.duration);
  const loopPlayback = useEditorStore((state) => state.loopPlayback);

  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying);
  const updateTextOverlayData = useEditorStore((state) => state.updateTextOverlayData);
  const updateShapeOverlayData = useEditorStore((state) => state.updateShapeOverlayData);
  const setSelectedClipId = useEditorStore((state) => state.setSelectedClipId);
  const updateClipTransform = useEditorStore((state) => state.updateClipTransform);

  // Keyframe mode: when keyframe panel is open, manipulations create keyframes
  const keyframePanelOpen = useEditorStore((state) => state.keyframePanelState.isOpen);
  const setClipKeyframe = useEditorStore((state) => state.setClipKeyframe);

  // Drag state for overlay manipulation
  const [dragState, setDragState] = useState<DragState | null>(null);

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

    // Set canvas dimensions from the bottom-most track's source (lowest index = base layer)
    // The base layer typically contains the main video content, with overlays on top
    if (clips.length > 0 && tracks.length > 0) {
      // Sort clips by track index (lower = base/bottom)
      const sortedClips = [...clips].sort((a, b) => {
        const trackA = tracks.find(t => t.id === a.trackId);
        const trackB = tracks.find(t => t.id === b.trackId);
        return (trackA?.index ?? 0) - (trackB?.index ?? 0);
      });

      // Find bottom-most media clip with dimensions (skip overlays)
      for (const clip of sortedClips) {
        if (clip.overlayType) continue; // Skip overlays
        const source = sourceVideos.find(s => s.id === clip.sourceVideoId);
        if (source && source.width && source.height) {
          setCanvasDimensions({ width: source.width, height: source.height });
          break;
        }
      }
    } else if (sourceVideos.length > 0) {
      // Fallback to first source if no clips yet
      const firstSource = sourceVideos[0];
      if (firstSource.width && firstSource.height) {
        setCanvasDimensions({ width: firstSource.width, height: firstSource.height });
      }
    }
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

  // Helper to draw a single clip with optional transition modifiers
  const drawClip = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    clip: Clip,
    clipTime: number, // Time relative to clip start (for animations)
    transitionModifiers?: {
      opacity?: number;
      offsetX?: number;
      offsetY?: number;
      clipRegion?: { x: number; y: number; width: number; height: number };
    }
  ) => {
    // Check media type
    const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
    const isImage = sourceMedia?.mediaType === 'image';
    const isAudio = sourceMedia?.mediaType === 'audio';

    // Audio clips don't render visually - skip drawing
    if (isAudio) return;

    let drawSource: HTMLVideoElement | HTMLImageElement | null = null;
    let sourceWidth: number;
    let sourceHeight: number;

    if (isImage) {
      const img = imageElementsRef.current.get(clip.sourceVideoId);
      if (!img || !img.complete) return;
      drawSource = img;
      sourceWidth = img.naturalWidth || canvas.width;
      sourceHeight = img.naturalHeight || canvas.height;
    } else {
      const video = videoElementsRef.current.get(clip.sourceVideoId);
      // Allow drawing if video has any data (readyState >= 1 means metadata loaded)
      // During seeking, readyState may temporarily drop, but we can still draw the current frame
      // This prevents black flashes during scrubbing
      if (!video || video.readyState < 1) return;
      // If video dimensions aren't available yet, skip
      if (!video.videoWidth || !video.videoHeight) return;
      drawSource = video;
      sourceWidth = video.videoWidth;
      sourceHeight = video.videoHeight;
    }

    // Get animated values - this applies presets and custom keyframes
    const animated = getAnimatedValues(
      clipTime,
      clip.duration,
      clip.animation,
      clip.transform || DEFAULT_TRANSFORM,
      clip.effects || DEFAULT_EFFECTS
    );

    ctx.save();
    ctx.globalCompositeOperation = blendModeToCanvas[clip.blendMode] || 'source-over';

    // Apply opacity with transition modifier
    const baseOpacity = animated.opacity;
    const finalOpacity = transitionModifiers?.opacity !== undefined
      ? baseOpacity * transitionModifiers.opacity
      : baseOpacity;
    ctx.globalAlpha = finalOpacity;

    // Apply blur effect (from animation or static)
    // Always set filter to ensure it's reset between clips
    const blurAmount = animated.blur;
    ctx.filter = blurAmount > 0 ? `blur(${blurAmount}px)` : 'none';

    // Apply clip region for wipe transitions
    if (transitionModifiers?.clipRegion) {
      const { x, y, width, height } = transitionModifiers.clipRegion;
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
    }

    // Calculate scale to fill canvas (cover mode - fills canvas, may crop)
    const sourceAspect = sourceWidth / sourceHeight;
    const canvasAspect = canvas.width / canvas.height;

    let baseWidth: number;
    let baseHeight: number;

    if (sourceAspect > canvasAspect) {
      // Source is wider - fit to height, crop width
      baseHeight = canvas.height;
      baseWidth = canvas.height * sourceAspect;
    } else {
      // Source is taller - fit to width, crop height
      baseWidth = canvas.width;
      baseHeight = canvas.width / sourceAspect;
    }

    // Apply animated scale on top of the base fill size
    const scaledWidth = baseWidth * animated.scaleX;
    const scaledHeight = baseHeight * animated.scaleY;

    // Apply animated position with transition offset
    const offsetX = transitionModifiers?.offsetX || 0;
    const offsetY = transitionModifiers?.offsetY || 0;
    const centerX = (animated.x * canvas.width) + offsetX;
    const centerY = (animated.y * canvas.height) + offsetY;

    // Apply rotation around center point
    if (animated.rotation !== 0) {
      ctx.translate(centerX, centerY);
      ctx.rotate((animated.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    const x = centerX - (scaledWidth / 2);
    const y = centerY - (scaledHeight / 2);

    ctx.drawImage(drawSource, x, y, scaledWidth, scaledHeight);
    ctx.restore();
  }, [sourceVideos]);

  // Helper to draw text overlay from clip
  const drawTextOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    textData: TextOverlayData,
    opacity: number
  ) => {
    ctx.save();
    ctx.globalAlpha = opacity;

    const x = textData.x * canvas.width;
    const y = textData.y * canvas.height;
    const scale = textData.scale ?? 1;
    const rotation = textData.rotation ?? 0;

    // Apply rotation and scale around the text position
    if (rotation !== 0 || scale !== 1) {
      ctx.translate(x, y);
      if (rotation !== 0) {
        ctx.rotate((rotation * Math.PI) / 180);
      }
      if (scale !== 1) {
        ctx.scale(scale, scale);
      }
      ctx.translate(-x, -y);
    }

    // Set up font
    const fontStyle = textData.fontStyle === 'italic' ? 'italic ' : '';
    const fontWeight = textData.fontWeight === 'bold' ? 'bold ' : '';
    ctx.font = `${fontStyle}${fontWeight}${textData.fontSize}px ${textData.fontFamily}`;
    ctx.textAlign = textData.textAlign;
    ctx.textBaseline = 'middle';

    // Draw background if set
    if (textData.backgroundColor && textData.backgroundColor !== '#00000000') {
      const metrics = ctx.measureText(textData.text);
      const padding = textData.fontSize * 0.3;
      const bgWidth = metrics.width + padding * 2;
      const bgHeight = textData.fontSize * 1.4;

      let bgX = x - padding;
      if (textData.textAlign === 'center') {
        bgX = x - bgWidth / 2;
      } else if (textData.textAlign === 'right') {
        bgX = x - bgWidth + padding;
      }

      ctx.fillStyle = textData.backgroundColor;
      ctx.fillRect(bgX, y - bgHeight / 2, bgWidth, bgHeight);
    }

    // Draw text
    ctx.fillStyle = textData.color;
    ctx.fillText(textData.text, x, y);

    ctx.restore();
  }, []);

  // Helper to draw shape overlay from clip
  const drawShapeOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    shapeData: ShapeOverlayData,
    opacity: number
  ) => {
    const centerX = shapeData.x * canvas.width;
    const centerY = shapeData.y * canvas.height;
    const width = shapeData.width * canvas.width;
    const height = shapeData.height * canvas.height;
    const blurAmount = shapeData.blurAmount ?? 0;

    // Helper to create shape path
    const createShapePath = () => {
      ctx.beginPath();
      switch (shapeData.type) {
        case 'rectangle':
          ctx.rect(centerX - width / 2, centerY - height / 2, width, height);
          break;
        case 'ellipse':
        case 'blur':  // Blur renders as an ellipse
          ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
          break;
        default:
          ctx.rect(centerX - width / 2, centerY - height / 2, width, height);
      }
    };

    // If blur is enabled, capture and blur the region underneath
    // For 'blur' type, always apply blur effect regardless of blurAmount setting
    const effectiveBlurAmount = shapeData.type === 'blur' ? (blurAmount || 10) : blurAmount;
    if (effectiveBlurAmount > 0 && (shapeData.type === 'rectangle' || shapeData.type === 'ellipse' || shapeData.type === 'blur')) {
      // Create an offscreen canvas to capture current content
      // This prevents issues with drawing canvas onto itself
      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        // Copy current canvas content to offscreen
        offCtx.drawImage(canvas, 0, 0);

        ctx.save();

        // Apply rotation to create the rotated clip path
        if (shapeData.rotation !== 0) {
          ctx.translate(centerX, centerY);
          ctx.rotate((shapeData.rotation * Math.PI) / 180);
          ctx.translate(-centerX, -centerY);
        }

        // Create clipping path for the shape (in rotated coordinate space)
        createShapePath();
        ctx.clip();

        // Reset transform to identity - the clip path stays, but we draw unrotated content
        // This ensures the blur applies to the content as-is, not rotated
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // Apply blur filter and draw the captured content into the clipped region
        ctx.filter = `blur(${effectiveBlurAmount}px)`;
        ctx.globalAlpha = opacity;

        // Draw from offscreen canvas (source) to main canvas (destination) with blur
        // The content is drawn unrotated, but clipped to the rotated shape
        ctx.drawImage(offscreen, 0, 0);

        ctx.restore();
      }
    }

    // Draw the fill color (on top of blur if both are used)
    ctx.save();
    ctx.globalAlpha = opacity;

    // Apply rotation if needed
    if (shapeData.rotation !== 0) {
      ctx.translate(centerX, centerY);
      ctx.rotate((shapeData.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    ctx.fillStyle = shapeData.fillColor;
    ctx.strokeStyle = shapeData.strokeColor;
    ctx.lineWidth = shapeData.strokeWidth;

    // Only draw fill if it's not fully transparent
    const hasVisibleFill = shapeData.fillColor && !shapeData.fillColor.endsWith('00');

    switch (shapeData.type) {
      case 'rectangle':
        if (hasVisibleFill) {
          ctx.fillRect(centerX - width / 2, centerY - height / 2, width, height);
        }
        if (shapeData.strokeWidth > 0) {
          ctx.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
        }
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
        if (hasVisibleFill) {
          ctx.fill();
        }
        if (shapeData.strokeWidth > 0) {
          ctx.stroke();
        }
        break;
      case 'blur':
        // Blur type only applies blur effect, no fill/stroke needed
        // The blur is already applied above, nothing more to draw
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(centerX - width / 2, centerY);
        ctx.lineTo(centerX + width / 2, centerY);
        ctx.stroke();
        break;
      case 'arrow':
        const arrowSize = Math.min(width, height) * 0.2;
        ctx.beginPath();
        ctx.moveTo(centerX - width / 2, centerY);
        ctx.lineTo(centerX + width / 2 - arrowSize, centerY);
        ctx.stroke();
        // Arrow head
        ctx.beginPath();
        ctx.moveTo(centerX + width / 2, centerY);
        ctx.lineTo(centerX + width / 2 - arrowSize, centerY - arrowSize / 2);
        ctx.lineTo(centerX + width / 2 - arrowSize, centerY + arrowSize / 2);
        ctx.closePath();
        ctx.fill();
        break;
    }

    ctx.restore();
  }, []);

  // Helper to draw text overlay with full animated transform values
  const drawTextOverlayAnimated = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    textData: TextOverlayData,
    animated: { x: number; y: number; scaleX: number; scaleY: number; rotation: number; opacity: number; blur: number }
  ) => {
    ctx.save();
    ctx.globalAlpha = animated.opacity;

    // Apply blur effect if specified
    if (animated.blur > 0) {
      ctx.filter = `blur(${animated.blur}px)`;
    }

    // Use animated position instead of textData position
    const x = animated.x * canvas.width;
    const y = animated.y * canvas.height;

    // Apply animated rotation and scale around the text position
    ctx.translate(x, y);
    if (animated.rotation !== 0) {
      ctx.rotate((animated.rotation * Math.PI) / 180);
    }
    // Use the larger of scaleX/scaleY for uniform text scaling
    const scale = Math.max(animated.scaleX, animated.scaleY);
    if (scale !== 1) {
      ctx.scale(scale, scale);
    }
    ctx.translate(-x, -y);

    // Set up font
    const fontStyle = textData.fontStyle === 'italic' ? 'italic ' : '';
    const fontWeight = textData.fontWeight === 'bold' ? 'bold ' : '';
    ctx.font = `${fontStyle}${fontWeight}${textData.fontSize}px ${textData.fontFamily}`;
    ctx.textAlign = textData.textAlign;
    ctx.textBaseline = 'middle';

    // Draw background if set
    if (textData.backgroundColor && textData.backgroundColor !== '#00000000') {
      const metrics = ctx.measureText(textData.text);
      const padding = textData.fontSize * 0.3;
      const bgWidth = metrics.width + padding * 2;
      const bgHeight = textData.fontSize * 1.4;

      let bgX = x - padding;
      if (textData.textAlign === 'center') {
        bgX = x - bgWidth / 2;
      } else if (textData.textAlign === 'right') {
        bgX = x - bgWidth + padding;
      }

      ctx.fillStyle = textData.backgroundColor;
      ctx.fillRect(bgX, y - bgHeight / 2, bgWidth, bgHeight);
    }

    // Draw text
    ctx.fillStyle = textData.color;
    ctx.fillText(textData.text, x, y);

    ctx.restore();
  }, []);

  // Helper to draw shape overlay with full animated transform values
  const drawShapeOverlayAnimated = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    shapeData: ShapeOverlayData,
    animated: { x: number; y: number; scaleX: number; scaleY: number; rotation: number; opacity: number; blur: number }
  ) => {
    // Use animated position
    const centerX = animated.x * canvas.width;
    const centerY = animated.y * canvas.height;
    // Apply animated scale to shape dimensions
    const width = shapeData.width * canvas.width * animated.scaleX;
    const height = shapeData.height * canvas.height * animated.scaleY;
    const rotation = animated.rotation;
    const blurAmount = shapeData.blurAmount ?? 0;

    // Helper to create shape path
    const createShapePath = () => {
      ctx.beginPath();
      switch (shapeData.type) {
        case 'rectangle':
          ctx.rect(centerX - width / 2, centerY - height / 2, width, height);
          break;
        case 'ellipse':
        case 'blur':
          ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
          break;
        default:
          ctx.rect(centerX - width / 2, centerY - height / 2, width, height);
      }
    };

    // If blur is enabled, capture and blur the region underneath
    const effectiveBlurAmount = shapeData.type === 'blur' ? (blurAmount || 10) : blurAmount;
    if (effectiveBlurAmount > 0 && (shapeData.type === 'rectangle' || shapeData.type === 'ellipse' || shapeData.type === 'blur')) {
      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.drawImage(canvas, 0, 0);

        ctx.save();

        if (rotation !== 0) {
          ctx.translate(centerX, centerY);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.translate(-centerX, -centerY);
        }

        createShapePath();
        ctx.clip();

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = `blur(${effectiveBlurAmount}px)`;
        ctx.globalAlpha = animated.opacity;
        ctx.drawImage(offscreen, 0, 0);

        ctx.restore();
      }
    }

    // Draw the fill color
    ctx.save();
    ctx.globalAlpha = animated.opacity;

    // Apply animated blur effect to the shape itself
    if (animated.blur > 0) {
      ctx.filter = `blur(${animated.blur}px)`;
    }

    if (rotation !== 0) {
      ctx.translate(centerX, centerY);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    ctx.fillStyle = shapeData.fillColor;
    ctx.strokeStyle = shapeData.strokeColor;
    ctx.lineWidth = shapeData.strokeWidth;

    const hasVisibleFill = shapeData.fillColor && !shapeData.fillColor.endsWith('00');

    switch (shapeData.type) {
      case 'rectangle':
        if (hasVisibleFill) {
          ctx.fillRect(centerX - width / 2, centerY - height / 2, width, height);
        }
        if (shapeData.strokeWidth > 0) {
          ctx.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
        }
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
        if (hasVisibleFill) {
          ctx.fill();
        }
        if (shapeData.strokeWidth > 0) {
          ctx.stroke();
        }
        break;
      case 'blur':
        // Blur type only applies blur effect, no fill/stroke
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(centerX - width / 2, centerY);
        ctx.lineTo(centerX + width / 2, centerY);
        ctx.stroke();
        break;
      case 'arrow':
        const arrowSize = Math.min(width, height) * 0.2;
        ctx.beginPath();
        ctx.moveTo(centerX - width / 2, centerY);
        ctx.lineTo(centerX + width / 2 - arrowSize, centerY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(centerX + width / 2, centerY);
        ctx.lineTo(centerX + width / 2 - arrowSize, centerY - arrowSize / 2);
        ctx.lineTo(centerX + width / 2 - arrowSize, centerY + arrowSize / 2);
        ctx.closePath();
        ctx.fill();
        break;
    }

    ctx.restore();
  }, []);

  // Draw a single frame to canvas
  // When useCache is true and not playing, check the frame cache first for instant scrubbing
  const drawFrame = useCallback((time: number, useCache: boolean = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
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
      if (clip.overlayType === 'shape' && clip.shapeData) {
        drawShapeOverlayAnimated(ctx, canvas, clip.shapeData, animated);
      } else if (clip.overlayType === 'text' && clip.textData) {
        drawTextOverlayAnimated(ctx, canvas, clip.textData, animated);
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
      const { outgoingClip, incomingClip, progress, type } = activeTransition;
      const outClipTime = getClipTime(outgoingClip);
      const inClipTime = getClipTime(incomingClip);
      const w = canvas.width;
      const h = canvas.height;

      switch (type) {
        case 'fade':
          // Crossfade: outgoing fades out, incoming fades in
          drawClip(ctx, canvas, outgoingClip, outClipTime, { opacity: 1 - progress });
          drawClip(ctx, canvas, incomingClip, inClipTime, { opacity: progress });
          break;

        case 'dissolve':
          // Similar to fade but with slight blur effect during transition
          // The blur is strongest in the middle of the transition
          const dissolveBlur = Math.sin(progress * Math.PI) * 3;
          ctx.save();
          if (dissolveBlur > 0) {
            ctx.filter = `blur(${dissolveBlur}px)`;
          }
          drawClip(ctx, canvas, outgoingClip, outClipTime, { opacity: 1 - progress });
          drawClip(ctx, canvas, incomingClip, inClipTime, { opacity: progress });
          ctx.restore();
          break;

        case 'wipe-left':
          // Wipe from right to left
          drawClip(ctx, canvas, outgoingClip, outClipTime, {
            clipRegion: { x: 0, y: 0, width: w * (1 - progress), height: h }
          });
          drawClip(ctx, canvas, incomingClip, inClipTime, {
            clipRegion: { x: w * (1 - progress), y: 0, width: w * progress, height: h }
          });
          break;

        case 'wipe-right':
          // Wipe from left to right
          drawClip(ctx, canvas, outgoingClip, outClipTime, {
            clipRegion: { x: w * progress, y: 0, width: w * (1 - progress), height: h }
          });
          drawClip(ctx, canvas, incomingClip, inClipTime, {
            clipRegion: { x: 0, y: 0, width: w * progress, height: h }
          });
          break;

        case 'wipe-up':
          // Wipe from bottom to top
          drawClip(ctx, canvas, outgoingClip, outClipTime, {
            clipRegion: { x: 0, y: 0, width: w, height: h * (1 - progress) }
          });
          drawClip(ctx, canvas, incomingClip, inClipTime, {
            clipRegion: { x: 0, y: h * (1 - progress), width: w, height: h * progress }
          });
          break;

        case 'wipe-down':
          // Wipe from top to bottom
          drawClip(ctx, canvas, outgoingClip, outClipTime, {
            clipRegion: { x: 0, y: h * progress, width: w, height: h * (1 - progress) }
          });
          drawClip(ctx, canvas, incomingClip, inClipTime, {
            clipRegion: { x: 0, y: 0, width: w, height: h * progress }
          });
          break;

        case 'slide-left':
          // Outgoing slides out to left, incoming slides in from right
          drawClip(ctx, canvas, outgoingClip, outClipTime, { offsetX: -w * progress });
          drawClip(ctx, canvas, incomingClip, inClipTime, { offsetX: w * (1 - progress) });
          break;

        case 'slide-right':
          // Outgoing slides out to right, incoming slides in from left
          drawClip(ctx, canvas, outgoingClip, outClipTime, { offsetX: w * progress });
          drawClip(ctx, canvas, incomingClip, inClipTime, { offsetX: -w * (1 - progress) });
          break;

        case 'slide-up':
          // Outgoing slides out to top, incoming slides in from bottom
          drawClip(ctx, canvas, outgoingClip, outClipTime, { offsetY: -h * progress });
          drawClip(ctx, canvas, incomingClip, inClipTime, { offsetY: h * (1 - progress) });
          break;

        case 'slide-down':
          // Outgoing slides out to bottom, incoming slides in from top
          drawClip(ctx, canvas, outgoingClip, outClipTime, { offsetY: h * progress });
          drawClip(ctx, canvas, incomingClip, inClipTime, { offsetY: -h * (1 - progress) });
          break;

        default:
          // For 'none' or unknown types, just draw normally
          drawClip(ctx, canvas, outgoingClip, outClipTime);
          drawClip(ctx, canvas, incomingClip, inClipTime);
      }
    }

    // Draw shape overlays from legacy array (for backwards compatibility)
    for (const shape of shapeOverlays) {
      if (time < shape.startTime || time >= shape.endTime) continue;

      ctx.save();
      ctx.globalAlpha = shape.opacity;

      const centerX = shape.x * canvas.width;
      const centerY = shape.y * canvas.height;
      const width = shape.width * canvas.width;
      const height = shape.height * canvas.height;

      // Apply rotation if needed
      if (shape.rotation !== 0) {
        ctx.translate(centerX, centerY);
        ctx.rotate((shape.rotation * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);
      }

      ctx.fillStyle = shape.fillColor;
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;

      switch (shape.type) {
        case 'rectangle':
          ctx.fillRect(centerX - width / 2, centerY - height / 2, width, height);
          if (shape.strokeWidth > 0) {
            ctx.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
          }
          break;
        case 'ellipse':
          ctx.beginPath();
          ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          if (shape.strokeWidth > 0) {
            ctx.stroke();
          }
          break;
        case 'line':
          ctx.beginPath();
          ctx.moveTo(centerX - width / 2, centerY);
          ctx.lineTo(centerX + width / 2, centerY);
          ctx.stroke();
          break;
        case 'arrow':
          const arrowSize = Math.min(width, height) * 0.2;
          ctx.beginPath();
          ctx.moveTo(centerX - width / 2, centerY);
          ctx.lineTo(centerX + width / 2 - arrowSize, centerY);
          ctx.stroke();
          // Arrow head
          ctx.beginPath();
          ctx.moveTo(centerX + width / 2, centerY);
          ctx.lineTo(centerX + width / 2 - arrowSize, centerY - arrowSize / 2);
          ctx.lineTo(centerX + width / 2 - arrowSize, centerY + arrowSize / 2);
          ctx.closePath();
          ctx.fill();
          break;
      }

      ctx.restore();
    }

    // Draw text overlays from legacy array (for backwards compatibility)
    for (const overlay of textOverlays) {
      if (time < overlay.startTime || time >= overlay.endTime) continue;

      ctx.save();
      ctx.globalAlpha = overlay.opacity;

      // Set up font
      const fontStyle = overlay.fontStyle === 'italic' ? 'italic ' : '';
      const fontWeight = overlay.fontWeight === 'bold' ? 'bold ' : '';
      ctx.font = `${fontStyle}${fontWeight}${overlay.fontSize}px ${overlay.fontFamily}`;
      ctx.textAlign = overlay.textAlign;
      ctx.textBaseline = 'middle';

      const x = overlay.x * canvas.width;
      const y = overlay.y * canvas.height;

      // Draw background if set
      if (overlay.backgroundColor && overlay.backgroundColor !== '#00000000') {
        const metrics = ctx.measureText(overlay.text);
        const padding = overlay.fontSize * 0.3;
        const bgWidth = metrics.width + padding * 2;
        const bgHeight = overlay.fontSize * 1.4;

        let bgX = x - padding;
        if (overlay.textAlign === 'center') {
          bgX = x - bgWidth / 2;
        } else if (overlay.textAlign === 'right') {
          bgX = x - bgWidth + padding;
        }

        ctx.fillStyle = overlay.backgroundColor;
        ctx.fillRect(bgX, y - bgHeight / 2, bgWidth, bgHeight);
      }

      // Draw text
      ctx.fillStyle = overlay.color;
      ctx.fillText(overlay.text, x, y);

      ctx.restore();
    }
  }, [clips, tracks, sourceVideos, textOverlays, shapeOverlays, drawClip, drawTextOverlay, drawShapeOverlay, drawTextOverlayAnimated, drawShapeOverlayAnimated]);

  // Get overlay bounds in canvas pixels for a given clip
  // Uses animated values from keyframes when available
  const getOverlayBounds = useCallback((clip: Clip, canvas: HTMLCanvasElement, time?: number): {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    rotation: number;
  } | null => {
    // Calculate animated values if time is provided
    let animatedX: number | undefined;
    let animatedY: number | undefined;
    let animatedScaleX: number | undefined;
    let animatedScaleY: number | undefined;
    let animatedRotation: number | undefined;

    if (time !== undefined && clip.animation) {
      const clipTime = time - clip.timelinePosition;
      if (clipTime >= 0 && clipTime <= clip.duration) {
        // Build base transform from overlay properties
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

        const animated = getAnimatedValues(
          clipTime,
          clip.duration,
          clip.animation,
          baseTransform,
          clip.effects || DEFAULT_EFFECTS
        );

        animatedX = animated.x;
        animatedY = animated.y;
        animatedScaleX = animated.scaleX;
        animatedScaleY = animated.scaleY;
        animatedRotation = animated.rotation;
      }
    }

    if (clip.overlayType === 'shape' && clip.shapeData) {
      const x = animatedX ?? clip.shapeData.x;
      const y = animatedY ?? clip.shapeData.y;
      const scaleX = animatedScaleX ?? 1;
      const scaleY = animatedScaleY ?? 1;
      const rotation = animatedRotation ?? clip.shapeData.rotation;

      return {
        centerX: x * canvas.width,
        centerY: y * canvas.height,
        width: clip.shapeData.width * canvas.width * scaleX,
        height: clip.shapeData.height * canvas.height * scaleY,
        rotation,
      };
    } else if (clip.overlayType === 'text' && clip.textData) {
      // For text, we need to measure it
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const textData = clip.textData;
      const baseScale = textData.scale ?? 1;
      const scaleX = animatedScaleX ?? baseScale;
      const scaleY = animatedScaleY ?? baseScale;
      const scale = Math.max(scaleX, scaleY);
      const x = animatedX ?? textData.x;
      const y = animatedY ?? textData.y;
      const rotation = animatedRotation ?? (textData.rotation ?? 0);

      const fontStyle = textData.fontStyle === 'italic' ? 'italic ' : '';
      const fontWeight = textData.fontWeight === 'bold' ? 'bold ' : '';
      ctx.font = `${fontStyle}${fontWeight}${textData.fontSize}px ${textData.fontFamily}`;
      const metrics = ctx.measureText(textData.text);
      const textWidth = metrics.width * scale;
      const textHeight = textData.fontSize * 1.4 * scale;

      // Adjust center based on text alignment
      let centerX = x * canvas.width;
      if (textData.textAlign === 'left') {
        centerX += textWidth / 2;
      } else if (textData.textAlign === 'right') {
        centerX -= textWidth / 2;
      }

      return {
        centerX,
        centerY: y * canvas.height,
        width: textWidth,
        height: textHeight,
        rotation,
      };
    } else if (!clip.overlayType && clip.sourceVideoId) {
      // Image or video clip - use transform properties
      const transform = clip.transform || DEFAULT_TRANSFORM;
      const x = animatedX ?? transform.x;
      const y = animatedY ?? transform.y;
      const scaleX = animatedScaleX ?? transform.scaleX;
      const scaleY = animatedScaleY ?? transform.scaleY;
      const rotation = animatedRotation ?? (transform.rotation ?? 0);

      // Get the source media dimensions
      const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
      if (!sourceMedia) return null;

      // Calculate the clip's dimensions based on source aspect ratio and scale
      // This matches the "cover" mode used in drawClip (fills canvas, may crop)
      const sourceAspect = sourceMedia.width / sourceMedia.height;
      const canvasAspect = canvas.width / canvas.height;

      let baseWidth: number;
      let baseHeight: number;
      if (sourceAspect > canvasAspect) {
        // Source is wider - fit to height, crop width
        baseHeight = canvas.height;
        baseWidth = canvas.height * sourceAspect;
      } else {
        // Source is taller - fit to width, crop height
        baseWidth = canvas.width;
        baseHeight = canvas.width / sourceAspect;
      }

      return {
        centerX: x * canvas.width,
        centerY: y * canvas.height,
        width: baseWidth * scaleX,
        height: baseHeight * scaleY,
        rotation,
      };
    }
    return null;
  }, [sourceVideos]);

  // Helper to determine if a clip is manipulable (overlays, images, videos - not audio)
  const isManipulableClip = useCallback((clip: Clip): boolean => {
    // Overlays are always manipulable
    if (clip.overlayType) return true;
    // Media clips are manipulable if they're not audio
    if (clip.sourceVideoId) {
      const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
      return sourceMedia?.mediaType !== 'audio';
    }
    return false;
  }, [sourceVideos]);

  // Get the manipulable clip type
  const getClipType = useCallback((clip: Clip): ManipulableClipType | null => {
    if (clip.overlayType === 'text') return 'text';
    if (clip.overlayType === 'shape') return 'shape';
    if (clip.sourceVideoId) {
      const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
      if (sourceMedia?.mediaType === 'image') return 'image';
      if (sourceMedia?.mediaType === 'audio') return null;
      return 'video';
    }
    return null;
  }, [sourceVideos]);

  // Check if a clip has custom keyframes (not just presets)
  const hasCustomKeyframes = useCallback((clip: Clip): boolean => {
    if (!clip.animation?.keyframes) return false;
    const properties: ('x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'blur')[] =
      ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur'];
    for (const prop of properties) {
      const kfs = clip.animation.keyframes[prop];
      if (kfs && kfs.length > 0) return true;
    }
    return false;
  }, []);

  // Draw selection handles for the selected overlay or media clip
  const drawSelectionHandles = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedClipId || isPlaying) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Find the selected clip
    const selectedClip = clips.find(c => c.id === selectedClipId);
    if (!selectedClip || !isManipulableClip(selectedClip)) return;

    // Check if clip is visible at current time
    const clipEnd = selectedClip.timelinePosition + selectedClip.duration;
    if (time < selectedClip.timelinePosition || time >= clipEnd) return;

    // Don't draw handles if the clip can't be interacted with
    // Case 1: Clip has custom keyframes but we're not in keyframe mode
    if (hasCustomKeyframes(selectedClip) && !keyframePanelOpen) return;

    const bounds = getOverlayBounds(selectedClip, canvas, time);
    if (!bounds) return;

    const { centerX, centerY, width, height, rotation } = bounds;
    const halfW = width / 2;
    const halfH = height / 2;

    ctx.save();

    // Apply rotation
    ctx.translate(centerX, centerY);
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw bounding box
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(-halfW, -halfH, width, height);

    // Draw corner handles
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;
    const handleSize = HANDLE_SIZE;
    const halfHandle = handleSize / 2;

    // Corner positions (relative to center)
    const corners = [
      { x: -halfW, y: -halfH }, // NW
      { x: halfW, y: -halfH },  // NE
      { x: -halfW, y: halfH },  // SW
      { x: halfW, y: halfH },   // SE
    ];

    // Side positions
    const sides = [
      { x: 0, y: -halfH },      // N
      { x: 0, y: halfH },       // S
      { x: -halfW, y: 0 },      // W
      { x: halfW, y: 0 },       // E
    ];

    // Draw corner handles (squares)
    for (const corner of corners) {
      ctx.fillRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
      ctx.strokeRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
    }

    // Draw side handles (smaller squares)
    const sideHandleSize = handleSize * 0.8;
    const halfSideHandle = sideHandleSize / 2;
    for (const side of sides) {
      ctx.fillRect(side.x - halfSideHandle, side.y - halfSideHandle, sideHandleSize, sideHandleSize);
      ctx.strokeRect(side.x - halfSideHandle, side.y - halfSideHandle, sideHandleSize, sideHandleSize);
    }

    // Draw rotation handle (circle above the bounding box)
    const rotationHandleY = -halfH - ROTATION_HANDLE_OFFSET;

    // Line connecting to rotation handle
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(0, -halfH);
    ctx.lineTo(0, rotationHandleY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Rotation handle circle
    ctx.beginPath();
    ctx.arc(0, rotationHandleY, handleSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }, [clips, selectedClipId, isPlaying, getOverlayBounds, isManipulableClip, hasCustomKeyframes, keyframePanelOpen]);

  // Get mouse position relative to canvas in normalized coordinates (0-1)
  // Accounts for object-fit: contain which letterboxes the canvas content
  const getCanvasPosition = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    // Calculate the actual rendered size of the canvas content (accounting for object-fit: contain)
    const canvasAspect = canvas.width / canvas.height;
    const elementAspect = rect.width / rect.height;

    let renderedWidth: number;
    let renderedHeight: number;
    let offsetX: number;
    let offsetY: number;

    if (canvasAspect > elementAspect) {
      // Canvas is wider than element - letterboxed top/bottom
      renderedWidth = rect.width;
      renderedHeight = rect.width / canvasAspect;
      offsetX = 0;
      offsetY = (rect.height - renderedHeight) / 2;
    } else {
      // Canvas is taller than element - letterboxed left/right
      renderedHeight = rect.height;
      renderedWidth = rect.height * canvasAspect;
      offsetX = (rect.width - renderedWidth) / 2;
      offsetY = 0;
    }

    // Convert mouse position to be relative to the actual canvas content area
    const mouseX = e.clientX - rect.left - offsetX;
    const mouseY = e.clientY - rect.top - offsetY;

    // Return normalized coordinates (0-1), clamped to valid range
    return {
      x: Math.max(0, Math.min(1, mouseX / renderedWidth)),
      y: Math.max(0, Math.min(1, mouseY / renderedHeight)),
    };
  }, []);

  // Hit test: find what's at the given position (handles take priority over overlay bodies)
  const hitTestHandles = useCallback((normalizedX: number, normalizedY: number): {
    clipId: string;
    clipType: ManipulableClipType;
    mode: DragMode;
  } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const mouseX = normalizedX * canvas.width;
    const mouseY = normalizedY * canvas.height;

    // RESTRICTION 1: When keyframe panel is open, ONLY allow interaction with the selected clip
    // This prevents accidentally clicking through and grabbing something else
    if (keyframePanelOpen && selectedClipId) {
      const selectedClip = clips.find(c => c.id === selectedClipId);
      const selectedClipType = selectedClip ? getClipType(selectedClip) : null;
      if (selectedClip && selectedClipType) {
        const clipEnd = selectedClip.timelinePosition + selectedClip.duration;
        if (currentTime >= selectedClip.timelinePosition && currentTime < clipEnd) {
          const bounds = getOverlayBounds(selectedClip, canvas, currentTime);
          if (bounds) {
            const { centerX, centerY, width, height, rotation } = bounds;
            const halfW = width / 2;
            const halfH = height / 2;

            const rad = (-rotation * Math.PI) / 180;
            const dx = mouseX - centerX;
            const dy = mouseY - centerY;
            const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
            const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

            const handleHitSize = HANDLE_SIZE * 1.5;

            // Check rotation handle
            const rotationHandleY = -halfH - ROTATION_HANDLE_OFFSET;
            if (Math.abs(localX) < handleHitSize && Math.abs(localY - rotationHandleY) < handleHitSize) {
              return { clipId: selectedClipId, clipType: selectedClipType, mode: 'rotate' };
            }

            // Check corner handles
            const corners: { x: number; y: number; mode: DragMode }[] = [
              { x: -halfW, y: -halfH, mode: 'resize-nw' },
              { x: halfW, y: -halfH, mode: 'resize-ne' },
              { x: -halfW, y: halfH, mode: 'resize-sw' },
              { x: halfW, y: halfH, mode: 'resize-se' },
            ];
            for (const corner of corners) {
              if (Math.abs(localX - corner.x) < handleHitSize && Math.abs(localY - corner.y) < handleHitSize) {
                return { clipId: selectedClipId, clipType: selectedClipType, mode: corner.mode };
              }
            }

            // Check side handles
            const sides: { x: number; y: number; mode: DragMode }[] = [
              { x: 0, y: -halfH, mode: 'resize-n' },
              { x: 0, y: halfH, mode: 'resize-s' },
              { x: -halfW, y: 0, mode: 'resize-w' },
              { x: halfW, y: 0, mode: 'resize-e' },
            ];
            for (const side of sides) {
              if (Math.abs(localX - side.x) < handleHitSize && Math.abs(localY - side.y) < handleHitSize) {
                return { clipId: selectedClipId, clipType: selectedClipType, mode: side.mode };
              }
            }

            // Check body for move
            if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
              return { clipId: selectedClipId, clipType: selectedClipType, mode: 'move' };
            }
          }
        }
      }
      // In keyframe mode, clicking outside the selected clip does nothing
      return null;
    }

    // Get all active manipulable clips sorted by z-order (highest on top first)
    const activeClips = getClipsAtTime(clips, tracks, currentTime);
    const manipulableClips = activeClips
      .filter(c => isManipulableClip(c.clip))
      .sort((a, b) => {
        // Overlays on top of media clips
        if (a.clip.overlayType && !b.clip.overlayType) return 1;
        if (!a.clip.overlayType && b.clip.overlayType) return -1;
        // Text overlays on top of shape overlays
        if (a.clip.overlayType === 'text' && b.clip.overlayType === 'shape') return 1;
        if (a.clip.overlayType === 'shape' && b.clip.overlayType === 'text') return -1;
        return (a.track?.index ?? 0) - (b.track?.index ?? 0);
      })
      .reverse(); // Now highest z-order first

    // First pass: Check handles ONLY on the selected clip (if visible and doesn't have keyframes)
    if (selectedClipId) {
      const selectedClip = clips.find(c => c.id === selectedClipId);
      const selectedClipType = selectedClip ? getClipType(selectedClip) : null;

      // RESTRICTION 2: If clip has custom keyframes, only allow interaction in keyframe mode
      // This is already handled since keyframePanelOpen check is above, and here we're NOT in keyframe mode
      if (selectedClip && selectedClipType && !hasCustomKeyframes(selectedClip)) {
        const clipEnd = selectedClip.timelinePosition + selectedClip.duration;
        if (currentTime >= selectedClip.timelinePosition && currentTime < clipEnd) {
          const bounds = getOverlayBounds(selectedClip, canvas, currentTime);
          if (bounds) {
            const { centerX, centerY, width, height, rotation } = bounds;
            const halfW = width / 2;
            const halfH = height / 2;

            const rad = (-rotation * Math.PI) / 180;
            const dx = mouseX - centerX;
            const dy = mouseY - centerY;
            const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
            const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

            const handleHitSize = HANDLE_SIZE * 1.5;

            // Check rotation handle
            const rotationHandleY = -halfH - ROTATION_HANDLE_OFFSET;
            if (Math.abs(localX) < handleHitSize && Math.abs(localY - rotationHandleY) < handleHitSize) {
              return { clipId: selectedClipId, clipType: selectedClipType, mode: 'rotate' };
            }

            // Check corner handles
            const corners: { x: number; y: number; mode: DragMode }[] = [
              { x: -halfW, y: -halfH, mode: 'resize-nw' },
              { x: halfW, y: -halfH, mode: 'resize-ne' },
              { x: -halfW, y: halfH, mode: 'resize-sw' },
              { x: halfW, y: halfH, mode: 'resize-se' },
            ];
            for (const corner of corners) {
              if (Math.abs(localX - corner.x) < handleHitSize && Math.abs(localY - corner.y) < handleHitSize) {
                return { clipId: selectedClipId, clipType: selectedClipType, mode: corner.mode };
              }
            }

            // Check side handles
            const sides: { x: number; y: number; mode: DragMode }[] = [
              { x: 0, y: -halfH, mode: 'resize-n' },
              { x: 0, y: halfH, mode: 'resize-s' },
              { x: -halfW, y: 0, mode: 'resize-w' },
              { x: halfW, y: 0, mode: 'resize-e' },
            ];
            for (const side of sides) {
              if (Math.abs(localX - side.x) < handleHitSize && Math.abs(localY - side.y) < handleHitSize) {
                return { clipId: selectedClipId, clipType: selectedClipType, mode: side.mode };
              }
            }
          }
        }
      }
    }

    // Second pass: Check body hit on ALL clips in z-order (highest first)
    // Skip clips that have custom keyframes (they can only be manipulated in keyframe mode)
    for (const { clip } of manipulableClips) {
      // RESTRICTION 2: Skip clips with custom keyframes when not in keyframe mode
      if (hasCustomKeyframes(clip)) continue;

      const clipType = getClipType(clip);
      if (!clipType) continue;

      const bounds = getOverlayBounds(clip, canvas, currentTime);
      if (!bounds) continue;

      const { centerX, centerY, width, height, rotation } = bounds;
      const halfW = width / 2;
      const halfH = height / 2;

      const rad = (-rotation * Math.PI) / 180;
      const dx = mouseX - centerX;
      const dy = mouseY - centerY;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

      if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
        return { clipId: clip.id, clipType, mode: 'move' };
      }
    }

    return null;
  }, [clips, tracks, currentTime, selectedClipId, getOverlayBounds, isManipulableClip, getClipType, keyframePanelOpen, hasCustomKeyframes]);

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
      // Clicked on empty space - deselect
      setSelectedClipId(null);
    }
  }, [isPlaying, getCanvasPosition, hitTestHandles, clips, setSelectedClipId, getOverlayBounds, keyframePanelOpen, selectedClipId, currentTime]);

  const handleMouseMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
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

      // Handle different resize directions
      const mode = dragState.mode;

      if (mode.includes('e')) {
        newWidth = Math.max(0.02, dragState.startWidth + deltaX);
      }
      if (mode.includes('w')) {
        const widthDelta = -deltaX;
        newWidth = Math.max(0.02, dragState.startWidth + widthDelta);
        newX = dragState.startOverlayX + deltaX / 2;
      }
      if (mode.includes('s')) {
        newHeight = Math.max(0.02, dragState.startHeight + deltaY);
      }
      if (mode.includes('n')) {
        const heightDelta = -deltaY;
        newHeight = Math.max(0.02, dragState.startHeight + heightDelta);
        newY = dragState.startOverlayY + deltaY / 2;
      }

      // For corner handles, maintain aspect ratio with shift key (optional - always maintain for now on corners)
      if (mode === 'resize-nw' || mode === 'resize-ne' || mode === 'resize-sw' || mode === 'resize-se') {
        if (isKeyframeMode) {
          // Calculate scale values for keyframes
          const widthRatio = newWidth / dragState.startWidth;
          const heightRatio = newHeight / dragState.startHeight;
          applyChange('scaleX', Math.max(0.1, widthRatio * dragState.startScaleX));
          applyChange('scaleY', Math.max(0.1, heightRatio * dragState.startScaleY));
          applyChange('x', newX);
          applyChange('y', newY);
        } else {
          // For shapes, update width/height
          // For text, update scale
          // For images/videos, update scaleX/scaleY
          // Use throttled updates for smoother drag performance
          if (dragState.clipType === 'text') {
            // Calculate scale based on the larger dimension change
            const widthRatio = newWidth / dragState.startWidth;
            const heightRatio = newHeight / dragState.startHeight;
            const newScale = Math.max(0.1, dragState.startScaleX * Math.max(widthRatio, heightRatio));
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
            const newScaleX = Math.max(0.1, dragState.startScaleX * widthRatio);
            const newScaleY = Math.max(0.1, dragState.startScaleY * heightRatio);
            throttledTransformUpdate.scheduleUpdate(
              ({ id, transform }) => updateClipTransform(id, transform, true),
              { id: dragState.clipId, transform: { scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY } }
            );
          }
        }
      } else {
        // Side handles - single axis resize
        if (isKeyframeMode) {
          const widthRatio = newWidth / dragState.startWidth;
          const heightRatio = newHeight / dragState.startHeight;
          if (mode.includes('e') || mode.includes('w')) {
            applyChange('scaleX', Math.max(0.1, widthRatio * dragState.startScaleX));
          }
          if (mode.includes('n') || mode.includes('s')) {
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
            const scaleRatio = mode.includes('e') || mode.includes('w') ? widthRatio : heightRatio;
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
            if (mode.includes('e') || mode.includes('w')) {
              newScaleX = Math.max(0.1, dragState.startScaleX * widthRatio);
            }
            if (mode.includes('n') || mode.includes('s')) {
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
    });
  }, [dragState, getCanvasPosition, updateTextOverlayData, updateShapeOverlayData, updateClipTransform, currentTime, drawFrame, drawSelectionHandles, keyframePanelOpen, selectedClipId, clips, setClipKeyframe, throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate]);

  const handleMouseUp = useCallback(() => {
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
  }, [dragState, clips, updateTextOverlayData, updateShapeOverlayData, updateClipTransform, keyframePanelOpen, selectedClipId, throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate]);

  const handleMouseLeave = useCallback(() => {
    // Cancel any pending throttled updates when mouse leaves
    throttledTextUpdate.cancel();
    throttledShapeUpdate.cancel();
    throttledTransformUpdate.cancel();
    setDragState(null);
  }, [throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate]);

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
    }, 50);
    return () => clearTimeout(timeout);
  }, [videoUrlsKey, imageUrlsKey, isPlaying, drawFrame, drawSelectionHandles]);

  // Handle scrubbing (when not playing)
  // Key insight: Check cache first, then draw with current video frame, then update after seek completes
  // Frame caching provides instant scrubbing through previously viewed frames
  useEffect(() => {
    if (isPlaying) return;

    let cancelled = false;
    const frameCache = getFrameCache();

    const activeClips = getClipsAtTime(clips, tracks, currentTime);

    // First, try to draw from cache - this gives instant scrubbing for previously viewed frames
    // If cache hit, drawFrame returns early after drawing the cached frame
    drawFrame(currentTime, true);
    drawSelectionHandles(currentTime);
    setDisplayTime(currentTime);

    // If we got a cache hit, we're done - no need to seek or re-render
    if (frameCache.has(currentTime)) {
      return;
    }

    // If no active clips, we're done (black frame was drawn above)
    if (activeClips.length === 0) {
      return;
    }

    // Check for active transitions - need to also seek incoming clip
    const activeTransition = getActiveTransition(clips, tracks, currentTime);

    // Seek all active videos in background and redraw when ready
    const seekPromises: Promise<void>[] = [];

    // Helper to seek a video
    const seekVideoIfNeeded = (clip: Clip, sourceTime: number) => {
      const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
      if (sourceMedia?.mediaType === 'image' || sourceMedia?.mediaType === 'audio') return;

      const video = videoElementsRef.current.get(clip.sourceVideoId);
      if (!video) return;

      // Only seek if we're more than a small threshold away from target
      if (Math.abs(video.currentTime - sourceTime) > 0.05) {
        const seekPromise = new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            resolve();
          };
          video.addEventListener('seeked', onSeeked);
          video.currentTime = sourceTime;
          // Timeout fallback in case seeked event doesn't fire
          setTimeout(resolve, 150);
        });
        seekPromises.push(seekPromise);
      }
    };

    for (const { clip, clipTime } of activeClips) {
      const sourceTime = clip.startTime + clipTime;
      seekVideoIfNeeded(clip, sourceTime);
    }

    // Also seek incoming clip during transitions
    if (activeTransition) {
      const { incomingClip } = activeTransition;
      const incomingClipTime = Math.max(0, currentTime - incomingClip.timelinePosition);
      const incomingSourceTime = incomingClip.startTime + incomingClipTime;
      seekVideoIfNeeded(incomingClip, incomingSourceTime);
    }

    // If we need to seek, redraw after seeks complete for accurate frame
    if (seekPromises.length > 0) {
      Promise.all(seekPromises).then(() => {
        if (cancelled) return;
        // Redraw with properly seeked video frames (bypass cache to get fresh render)
        requestAnimationFrame(() => {
          if (cancelled) return;
          drawFrame(currentTime, false); // Force fresh render, don't use cache
          drawSelectionHandles(currentTime);

          // Cache the freshly rendered frame for instant scrubbing later
          const canvas = canvasRef.current;
          if (canvas) {
            frameCache.cacheFromCanvas(currentTime, canvas);
          }
        });
      });
    } else {
      // No seeks needed - videos were already at correct position
      // Cache this frame for future scrubbing
      const canvas = canvasRef.current;
      if (canvas) {
        frameCache.cacheFromCanvas(currentTime, canvas);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [currentTime, isPlaying, clips, tracks, drawFrame, drawSelectionHandles, sourceVideos]);

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

      // Draw the current frame when paused to ensure we don't show black
      requestAnimationFrame(() => {
        drawFrame(currentTimeRef.current);
        drawSelectionHandles(currentTimeRef.current);
      });
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
      video.muted = track?.muted ?? false;
      video.volume = track?.volume ?? 1;

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
      audio.volume = clipData.track?.volume ?? 1;
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

      // Check if we've reached the end of the timeline
      if (newTimelineTime >= timelineDuration) {
        if (loopPlaybackRef.current) {
          // Loop back to the beginning
          // Reset playback start time to now, starting from timeline position 0
          playbackStartTime = performance.now();
          startTimelineTime = 0;

          // Reset all videos to beginning and restart them
          videoElementsRef.current.forEach(video => {
            video.currentTime = 0;
            video.pause();
          });

          // Reset all audio clips
          audioElementsRef.current.forEach(audio => {
            audio.currentTime = 0;
            audio.pause();
          });

          // Update display and continue
          setCurrentTime(0);
          setDisplayTime(0);
          lastActiveClipIds = new Set();
          lastStoreUpdateTime = 0;

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
          video.muted = track?.muted ?? false;
          video.volume = track?.volume ?? 1;

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

          audio.volume = clipData.track?.volume ?? 1;

          // Make sure audio is playing
          if (audio.paused) {
            audio.play().catch(console.error);
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
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMoveForCursor}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
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
