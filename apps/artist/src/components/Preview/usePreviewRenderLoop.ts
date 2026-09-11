// What decides *when* the preview canvas is painted.
//
// Three things ask for a frame, and they must not fight over it:
//
//  - a media URL changed (an undo brought a clip back, say) — redraw once the
//    elements have had a moment to pick the new source up;
//  - the playhead moved while paused — seek every active video, draw the best
//    frame available immediately, then draw again the moment the seeks report
//    back, so a scrub is responsive without ending on a stale frame;
//  - playback is running — a requestAnimationFrame loop drives the clock,
//    keeps the media elements in sync with it, and paints each frame.
//
// The loop runs off `performance.now()` rather than React state: the store
// learns the new time only every 200ms, while `displayTime` (returned here)
// updates every frame for the timecode readout.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useEditorStore, getClipsAtTime } from '../../store/projectStore';
import { getFrameCache } from '../../core/frameCache';
import { getAnimatedVolume } from '../../utils/animation';
import type { Clip, Track } from '../../store/types';
import { getActiveTransition } from './transitions';

/** Everything the render loop needs that does not come from the store. */
export interface PreviewRenderLoopDeps {
  /** Paint one composited frame; `useCache` is the frame cache opt-out. */
  drawFrame: (time: number, useCache?: boolean) => void;
  /** Paint the selected clip's transform handles over the frame. */
  drawSelectionHandles: (time: number) => void;
  /** Paint the multi-selection's bounding boxes over the frame. */
  drawMultiSelectHandles: (time: number) => void;
  videoElementsRef: RefObject<Map<string, HTMLVideoElement>>;
  audioElementsRef: RefObject<Map<string, HTMLAudioElement>>;
  /** Mirrors of the store's playback state, read inside the rAF loop. */
  isPlayingRef: RefObject<boolean>;
  currentTimeRef: RefObject<number>;
  /** Changes when the loaded video/image sources change — a redraw cue. */
  videoUrlsKey: string;
  imageUrlsKey: string;
}

export interface PreviewRenderLoop {
  /** The playhead position to show, updated every frame during playback. */
  displayTime: number;
}

/**
 * Drive the preview canvas: redraw on media change, on scrub, and on play.
 */
export function usePreviewRenderLoop({
  drawFrame,
  drawSelectionHandles,
  drawMultiSelectHandles,
  videoElementsRef,
  audioElementsRef,
  isPlayingRef,
  currentTimeRef,
  videoUrlsKey,
  imageUrlsKey,
}: PreviewRenderLoopDeps): PreviewRenderLoop {
  const animationFrameRef = useRef<number | null>(null);
  const loopPlaybackRef = useRef(false);
  const inPointRef = useRef<number | null>(null);
  const outPointRef = useRef<number | null>(null);
  const [displayTime, setDisplayTime] = useState(0);

  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const currentTime = useEditorStore((state) => state.currentTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const timelineDuration = useEditorStore((state) => state.project.timeline.duration);
  const loopPlayback = useEditorStore((state) => state.loopPlayback);
  const inPoint = useEditorStore((state) => state.inPoint);
  const outPoint = useEditorStore((state) => state.outPoint);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying);

  // Keep refs in sync
  useEffect(() => {
    loopPlaybackRef.current = loopPlayback;
  }, [loopPlayback]);

  useEffect(() => {
    inPointRef.current = inPoint;
    outPointRef.current = outPoint;
  }, [inPoint, outPoint]);

  // Redraw frame when media URLs change (e.g., after undo)
  // Only trigger on URL changes, not on every currentTime or clips change
  useEffect(() => {
    if (isPlaying) return;
    // Give video/image elements time to update after URL changes
    const timeout = setTimeout(() => {
      drawFrame(currentTimeRef.current);
      drawSelectionHandles(currentTimeRef.current);
      drawMultiSelectHandles(currentTimeRef.current);
    }, 50);
    return () => clearTimeout(timeout);
  }, [videoUrlsKey, imageUrlsKey, isPlaying, drawFrame, drawSelectionHandles, drawMultiSelectHandles, currentTimeRef]);

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
  }, [currentTime, isPlaying, clips, tracks, drawFrame, drawSelectionHandles, drawMultiSelectHandles, sourceVideos, videoElementsRef]);

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
  }, [isPlaying, clips, tracks, timelineDuration, setIsPlaying, setCurrentTime, drawFrame, sourceVideos, videoElementsRef, audioElementsRef, isPlayingRef]);

  return { displayTime };
}
