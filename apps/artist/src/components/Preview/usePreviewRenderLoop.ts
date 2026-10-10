// What decides *when* the preview canvas is painted.
//
// Three things ask for a frame, and they must not fight over it:
//
//  - a media URL changed (an undo brought a clip back, say) — redraw once the
//    elements have had a moment to pick the new source up;
//  - the playhead moved while paused, or a <video> arrived — seek every video
//    the frame draws, draw the best frame available immediately, then draw
//    again the moment the last seek reports back, so a scrub is responsive
//    without ending on a stale frame;
//  - playback is running — a requestAnimationFrame loop drives the clock,
//    keeps the media elements in sync with it, and paints each frame.
//
// The loop runs off `performance.now()` rather than React state: the store
// learns the new time only every 200ms, and the loop calls no React setter at
// all per frame. The timecode readout instead subscribes to the playhead
// (`subscribeDisplayTime` / `getDisplayTime`), so a frame re-renders one span
// rather than the whole preview subtree — and only ten times a second.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useEditorStore, getClipsAtTime } from '../../store/projectStore';
import { getAnimatedVolume } from '../../utils/animation';
import type { Clip, Track } from '../../store/types';
import { getActiveTransition } from './transitions';

/** Everything the render loop needs that does not come from the store. */
export interface PreviewRenderLoopDeps {
  /** Paint one composited frame. */
  drawFrame: (time: number) => void;
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
  /**
   * Watch the playhead position the readout should show. Returns the
   * unsubscribe. Listeners fire at most every `DISPLAY_TIME_PUBLISH_MS` during
   * playback, and immediately on a scrub or at a playback boundary.
   */
  subscribeDisplayTime: (listener: () => void) => () => void;
  /** The playhead position last published to the listeners. */
  getDisplayTime: () => number;
}

/**
 * How often, at most, playback tells the timecode readout the playhead moved.
 * Ten updates a second is more than the eye reads off a millisecond field, and
 * it keeps React out of the per-frame path entirely.
 */
const DISPLAY_TIME_PUBLISH_MS = 100;

/**
 * `HTMLMediaElement.HAVE_CURRENT_DATA`: the element has decoded the frame at
 * its current position, so `drawImage` has something to draw.
 */
const HAVE_CURRENT_DATA = 2;

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
  const displayTimeListenersRef = useRef<Set<() => void>>(new Set());
  const displayTimeRef = useRef(0);
  const lastPublishAtRef = useRef(Number.NEGATIVE_INFINITY);

  /**
   * Hand a new playhead position to the readout. `immediate` skips the throttle
   * for the positions that must be exact the moment they happen: a scrub, the
   * loop point, and the end of the timeline.
   */
  const publishDisplayTime = useCallback((time: number, immediate = false) => {
    const now = performance.now();
    if (!immediate && now - lastPublishAtRef.current < DISPLAY_TIME_PUBLISH_MS) return;
    lastPublishAtRef.current = now;
    if (displayTimeRef.current === time) return;
    displayTimeRef.current = time;
    for (const listener of displayTimeListenersRef.current) listener();
  }, []);

  const subscribeDisplayTime = useCallback((listener: () => void) => {
    displayTimeListenersRef.current.add(listener);
    return () => {
      displayTimeListenersRef.current.delete(listener);
    };
  }, []);

  const getDisplayTime = useCallback(() => displayTimeRef.current, []);

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

  // The element set the scrub effect last ran against — so a run can tell an
  // element arriving from the playhead moving (below).
  const scrubVideoUrlsKeyRef = useRef(videoUrlsKey);

  // Handle scrubbing (when not playing): seek every video the frame draws to
  // the playhead, paint the best frame available at once, and paint again when
  // the last of those seeks reports back (ESCSUITE-275), with a 300 ms
  // fallback for a seek that never does.
  //
  // It also runs when the element set changes (`videoUrlsKey`), because a
  // <video> created while paused — a source restored by undo mid-clip, a
  // project opened with the playhead off 0, a frame step pressed before the
  // element existed — starts at source time 0 and nothing else seeks it. On
  // such a run every element already at its target (within 0.05 s) is left
  // alone, so an unchanged element costs one comparison, and the immediate
  // paint is left to the media-change effect above, which paints 50 ms after
  // any change of the set: the arrival paints once, as before, plus once after
  // its seek if it needed one.
  useEffect(() => {
    const elementsChanged = scrubVideoUrlsKeyRef.current !== videoUrlsKey;
    scrubVideoUrlsKeyRef.current = videoUrlsKey;
    if (isPlaying) return;

    publishDisplayTime(currentTime, true);

    // Where each <video> element has to be for this frame.
    //
    // Collected per *element*, not per clip: `usePreviewMedia` keeps one
    // element per source, so two live clips off one source — a
    // picture-in-picture arrangement, or the same clip duplicated on two
    // tracks — share it. Seeking per clip moved that element for the first
    // clip, then measured it against the second clip's target, decided a seek
    // was still needed and took the event-driven branch below, which paints
    // the frame twice for one move of the playhead.
    //
    // Later writes win, which is what the per-clip loop already did in effect
    // (each clip overwrote the element's currentTime), so the frame the user
    // sees is unchanged: the last live clip's target, or the incoming side of
    // a transition, which is applied after the clips for the same reason.
    const seekTargets = new Map<HTMLVideoElement, number>();
    const activeClips = getClipsAtTime(clips, tracks, currentTime);

    if (activeClips.length > 0) {
      const activeTransition = getActiveTransition(clips, tracks, currentTime);

      const wantSeek = (sourceVideoId: string, sourceTime: number) => {
        const sourceMedia = sourceVideos.find(s => s.id === sourceVideoId);
        if (sourceMedia?.mediaType === 'image' || sourceMedia?.mediaType === 'audio') return;

        const video = videoElementsRef.current.get(sourceVideoId);
        if (!video) return;

        seekTargets.set(video, sourceTime);
      };

      for (const { clip, clipTime } of activeClips) {
        if (clip.overlayType) continue; // Text/shape overlays don't need seeking
        wantSeek(clip.sourceVideoId, clip.startTime + clipTime);
      }

      if (activeTransition) {
        const { incomingClip } = activeTransition;
        const inClipTime = Math.max(0, currentTime - incomingClip.timelinePosition);
        wantSeek(incomingClip.sourceVideoId, incomingClip.startTime + inClipTime);
      }
    }

    // One comparison and at most one seek per element, and one 'seeked' to
    // wait for per element that is moving: one this run sent, or one an
    // earlier run sent that is still under way (`seeking`) — an earlier run's
    // listener went with its cleanup, and the element already reads the
    // target, so without this the paint after that seek would be lost.
    let settled = false;
    let pendingSeeks = 0;
    let finalPaintFrame = 0;

    // Paint once the last pending seek has reported back — not the first: with
    // two elements moving (picture-in-picture, a transition's two sides) the
    // one that lands second would otherwise keep its old frame until the next
    // scrub. Created on the first pending element, so a run with nothing to
    // seek — every run of a paused drag that moves no element — allocates no
    // closure at all. It only ever runs from a 'seeked' event, after this run
    // has returned and `paint` below exists.
    let seekedHandler: (() => void) | undefined;

    for (const [video, sourceTime] of seekTargets) {
      const offTarget = Math.abs(video.currentTime - sourceTime) > 0.05;
      if (offTarget) video.currentTime = sourceTime;
      if (offTarget || video.seeking) {
        pendingSeeks += 1;
        seekedHandler ??= () => {
          if (settled) return;
          pendingSeeks -= 1;
          if (pendingSeeks > 0) return;
          settled = true;
          finalPaintFrame = requestAnimationFrame(paint);
        };
        video.addEventListener('seeked', seekedHandler, { once: true });
      }
    }

    // The best frame available now, for a playhead move. For a change of the
    // element set the media-change effect paints it, 50 ms on — also when the
    // playhead moved in the same render, whose first paint is then 50 ms late.
    if (!elementsChanged) {
      drawFrame(currentTime);
      drawSelectionHandles(currentTime);
      drawMultiSelectHandles(currentTime);
    }

    if (!seekedHandler) return;
    const onSeeked = seekedHandler;

    const paint = () => {
      drawFrame(currentTime);
      drawSelectionHandles(currentTime);
      drawMultiSelectHandles(currentTime);
    };

    // Fallback: if a seek has not reported back within 300 ms, paint anyway.
    const fallbackTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        paint();
      }
    }, 300);

    // A newer playhead, element set or timeline supersedes this cycle: nothing
    // it was waiting for may paint, including a final paint already asked for.
    return () => {
      settled = true;
      clearTimeout(fallbackTimeout);
      cancelAnimationFrame(finalPaintFrame);
      for (const video of seekTargets.keys()) {
        video.removeEventListener('seeked', onSeeked);
      }
    };
  }, [currentTime, isPlaying, clips, tracks, videoUrlsKey, drawFrame, drawSelectionHandles, drawMultiSelectHandles, sourceVideos, videoElementsRef, publishDisplayTime]);

  // Paint once more when a paused frame's video decodes its first frame
  // (ESCSUITE-264).
  //
  // Every paint above draws whatever each element has. An element the
  // preview created a moment ago — a clip just added, its source just loaded —
  // can have metadata and no frame yet (`readyState` below HAVE_CURRENT_DATA),
  // which `isDrawableVideo` lets through and `drawImage` paints as nothing, so
  // the frame lands black. Playing, the next animation frame repaints; paused,
  // nothing else would, and the canvas stayed black (2 of 20 headless Chromium
  // runs). So each such element the frame draws gets one 'loadeddata' listener
  // that paints this frame once, and the cleanup takes every listener still
  // waiting off when the clips, the playhead, the elements or playback change.
  //
  // 'loadeddata' rather than requestVideoFrameCallback: 'loadeddata' is tied
  // to the readiness state itself — the first time the element reaches the
  // HAVE_CURRENT_DATA the paint lacked, once per load, in every engine —
  // where rVFC is tied to presentation to the compositor, which an engine may
  // throttle or skip for these elements, never inserted in the document. A seek is not
  // this effect's: the scrub effect above paints after the last 'seeked'. An
  // element both unready and off the playhead gets both paints, at the same
  // playhead time, the seek asked for before either fired: if its 'seeked'
  // lands within the scrub's 300 ms fallback, whichever of 'loadeddata' and
  // 'seeked' comes last paints the frame at the target; past the fallback the
  // late 'seeked' paints nothing and this readiness paint is the backstop. That
  // a browser applies a seek made at HAVE_NOTHING as the default playback start
  // position, after metadata and before the first frame's data, is the spec's
  // order and is not measured here in a real browser.
  useEffect(() => {
    if (isPlaying) return;

    // Every element the frame draws: the clips at the playhead, and the
    // incoming side of a transition, whose clip has not started yet and so is
    // not among them. An overlay has no element under its source id, so the
    // lookup itself skips it.
    const waiting = new Set<HTMLVideoElement>();
    const watch = (sourceVideoId: string) => {
      const video = videoElementsRef.current.get(sourceVideoId);
      if (video && video.readyState < HAVE_CURRENT_DATA) waiting.add(video);
    };
    for (const { clip } of getClipsAtTime(clips, tracks, currentTime)) {
      watch(clip.sourceVideoId);
    }
    const incomingClip = getActiveTransition(clips, tracks, currentTime)?.incomingClip;
    if (incomingClip) watch(incomingClip.sourceVideoId);

    const paint = () => {
      drawFrame(currentTime);
      drawSelectionHandles(currentTime);
      drawMultiSelectHandles(currentTime);
    };
    for (const video of waiting) {
      video.addEventListener('loadeddata', paint, { once: true });
    }
    return () => {
      for (const video of waiting) {
        video.removeEventListener('loadeddata', paint);
      }
    };
  }, [currentTime, isPlaying, clips, tracks, videoUrlsKey, drawFrame, drawSelectionHandles, drawMultiSelectHandles, videoElementsRef]);

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

          // Pause every element without seeking it here: loopStart is a
          // timeline time, not any of these elements' source time (ESCSUITE-129
          // — a clip not at timeline 0, or trimmed, wants
          // clip.startTime + (loopStart - clip.timelinePosition), not
          // loopStart itself). Emptying lastActiveClipIds below forces the
          // clipsChanged branch on the very next frame, which already computes
          // that per clip and seeks each element correctly.
          videoElementsRef.current.forEach(video => {
            video.pause();
          });
          audioElementsRef.current.forEach(audio => {
            audio.pause();
          });

          // Update display and continue
          setCurrentTime(loopStart);
          publishDisplayTime(loopStart, true);
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
          publishDisplayTime(timelineDuration, true);
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

      // Tell the readout where the playhead is — throttled, and never a
      // React setter on this path.
      publishDisplayTime(newTimelineTime);

      // Update store less frequently (every 200ms)
      if (newTimelineTime - lastStoreUpdateTime > 0.2) {
        setCurrentTime(newTimelineTime);
        lastStoreUpdateTime = newTimelineTime;
      }

      // Draw the composited frame (even if there are no active clips - shows black)
      drawFrame(newTimelineTime);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Let the first frame of this playback publish straight away, whatever the
    // last scrub left behind.
    lastPublishAtRef.current = Number.NEGATIVE_INFINITY;
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, clips, tracks, timelineDuration, setIsPlaying, setCurrentTime, drawFrame, sourceVideos, videoElementsRef, audioElementsRef, isPlayingRef, publishDisplayTime]);

  return useMemo(
    () => ({ subscribeDisplayTime, getDisplayTime }),
    [subscribeDisplayTime, getDisplayTime]
  );
}
