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
// learns the new time only every 200ms, and once more, exactly, when a pause
// stops the loop (ESCSUITE-281) — unless a seek came with the pause, which
// keeps its target (ESCSUITE-287); the loop calls no React setter at all per
// frame. The timecode readout instead subscribes to the playhead
// (`subscribeDisplayTime` / `getDisplayTime`), so a frame re-renders one span
// rather than the whole preview subtree — and only ten times a second.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useEditorStore, getClipsAtTime } from '../../store/projectStore';
import { getAnimatedVolume } from '../../utils/animation';
import type { Clip, Track } from '../../store/types';
import { getActiveTransition } from './transitions';
import { createStickySlotAssigner, videoForSlot } from '../../core/elementSlots';
import { previewVideoForSlot } from './usePreviewMedia';

/** Everything the render loop needs that does not come from the store. */
export interface PreviewRenderLoopDeps {
  /** Paint one composited frame. */
  drawFrame: (time: number) => void;
  /** Paint the selected clip's transform handles over the frame. */
  drawSelectionHandles: (time: number) => void;
  /** Paint the multi-selection's bounding boxes over the frame. */
  drawMultiSelectHandles: (time: number) => void;
  videoElementsRef: RefObject<Map<string, HTMLVideoElement>>;
  /**
   * Each video source's further elements, slot 1 onwards (ESCSUITE-313): the
   * loop makes one, through `previewVideoForSlot`, the first time a second
   * clip of a source is live at the playhead, and seeks, plays and pauses it
   * like any other.
   */
  extraVideoElementsRef: RefObject<Map<string, HTMLVideoElement[]>>;
  /**
   * Each live clip's slot (ESCSUITE-313) — which of its source's elements it
   * is. The loop writes it, through its sticky assignment (ESCSUITE-323),
   * before every seek, play and paint, and the frame's draw reads it, so the
   * draw shows each clip from the element the loop moved for it.
   */
  elementSlotsRef: RefObject<Map<string, number>>;
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
 * The shortest loop region playback will loop (ESCSUITE-246): one frame at the
 * fastest rate the preview targets. A shorter region — the in and out points
 * on the same time, most often — is past its out point on every animation
 * frame, so looping it jumped back to the in point and wrote the store once a
 * frame while appearing to play. Playback stops at the out point instead.
 */
const MIN_LOOP_LENGTH_S = 1 / 60;

/**
 * Drive the preview canvas: redraw on media change, on scrub, and on play.
 */
export function usePreviewRenderLoop({
  drawFrame,
  drawSelectionHandles,
  drawMultiSelectHandles,
  videoElementsRef,
  extraVideoElementsRef,
  elementSlotsRef,
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

  // Which of its source's elements each live clip is (ESCSUITE-313), decided
  // stickily (ESCSUITE-323, `core/elementSlots.ts`): a clip keeps its element
  // for as long as it stays live, because a preview element is a playing
  // playhead and moving a clip onto another one costs that one a seek — a
  // stall on a clip that had not changed. One assignment for the hook's life,
  // written into `elementSlotsRef` by the scrub, the readiness listener, the
  // playback loop and its crossfade hold alike, so all four, and the draw that
  // reads the map, agree on which element a clip is.
  const [slotAssigner] = useState(createStickySlotAssigner);
  const projectId = useEditorStore((state) => state.project.id);

  // Forget every remembered slot when the project changes, before the effects
  // below assign again: the next assignment starts afresh, in track order.
  //
  // Not when the element set (`videoUrlsKey`) changes, and not when playback
  // stops. A slot names an element by index — the source's own, or its k-th
  // further one, made lazily by `previewVideoForSlot` — resolved afresh on
  // every lookup, so a remembered slot can never bind an element that is gone;
  // and every assignment forgets each clip it does not name, so a clip that
  // left takes its slot with it. Re-packing on either would move a
  // picture-in-picture's two clips onto each other's elements: paused, both
  // would seek; playing, nothing re-seeks the live clips until the live set
  // changes, so the draw would show each clip from the other's playing element.
  useEffect(() => {
    slotAssigner.reset();
  }, [slotAssigner, projectId]);

  /** Every preview `<video>`, each source's further elements included. */
  const forEachVideo = useCallback((visit: (video: HTMLVideoElement) => void) => {
    videoElementsRef.current.forEach((video) => visit(video));
    extraVideoElementsRef.current.forEach((extras) => extras.forEach((video) => visit(video)));
  }, [videoElementsRef, extraVideoElementsRef]);

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
    // The store has moved on since this render: a pause published the loop's
    // last frame from the playback effect's cleanup, which runs in the same
    // commit before this effect (ESCSUITE-281). The run for the newer time
    // follows at once, so this one would only seek every video back to a
    // position up to 200 ms stale and paint it.
    if (useEditorStore.getState().currentTime !== currentTime) return;

    publishDisplayTime(currentTime, true);

    // Where each <video> element has to be for this frame.
    //
    // Collected per *element*: per element, and a source has one element per
    // live clip (ESCSUITE-313). Two live clips off one source — a
    // picture-in-picture arrangement, the same clip duplicated on two tracks,
    // a split clip crossfading into itself — used to share the source's one
    // element: the first clip's seek moved it, the second clip's target was a
    // second away, and both clips drew whichever target won. Each now has its
    // own element, chosen by the same slot assignment the frame draws by
    // (`core/elementSlots.ts`), made here the first time it is needed, so
    // each element has exactly one target and no write overwrites another.
    const seekTargets = new Map<HTMLVideoElement, number>();
    const activeClips = getClipsAtTime(clips, tracks, currentTime);

    if (activeClips.length > 0) {
      const activeTransition = getActiveTransition(clips, tracks, currentTime);
      const slots = elementSlotsRef.current;
      slotAssigner.assign(activeClips, activeTransition, slots);

      const wantSeek = (clip: Clip, sourceTime: number) => {
        const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
        if (sourceMedia?.mediaType === 'image' || sourceMedia?.mediaType === 'audio') return;

        const video = previewVideoForSlot(
          videoElementsRef.current, extraVideoElementsRef.current, clip.sourceVideoId, slots.get(clip.id)!
        );
        if (!video) return;

        seekTargets.set(video, sourceTime);
      };

      for (const { clip, clipTime } of activeClips) {
        if (clip.overlayType) continue; // Text/shape overlays don't need seeking
        wantSeek(clip, clip.startTime + clipTime);
      }

      if (activeTransition) {
        const { incomingClip } = activeTransition;
        const inClipTime = Math.max(0, currentTime - incomingClip.timelinePosition);
        wantSeek(incomingClip, incomingClip.startTime + inClipTime);
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
  }, [currentTime, isPlaying, clips, tracks, videoUrlsKey, drawFrame, drawSelectionHandles, drawMultiSelectHandles, sourceVideos, videoElementsRef, extraVideoElementsRef, elementSlotsRef, slotAssigner, publishDisplayTime]);

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
    // not among them — each on the element its slot names, a source's second
    // live clip on that source's second element (ESCSUITE-313). An overlay
    // has no element under its source id, so the lookup itself skips it.
    const activeClips = getClipsAtTime(clips, tracks, currentTime);
    const activeTransition = getActiveTransition(clips, tracks, currentTime);
    const slots = elementSlotsRef.current;
    slotAssigner.assign(activeClips, activeTransition, slots);
    const waiting = new Set<HTMLVideoElement>();
    const watch = (clip: Clip) => {
      const video = videoForSlot(
        videoElementsRef.current, extraVideoElementsRef.current, clip.sourceVideoId, slots.get(clip.id)!
      );
      if (video && video.readyState < HAVE_CURRENT_DATA) waiting.add(video);
    };
    for (const { clip } of activeClips) {
      watch(clip);
    }
    if (activeTransition) watch(activeTransition.incomingClip);

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
  }, [currentTime, isPlaying, clips, tracks, videoUrlsKey, drawFrame, drawSelectionHandles, drawMultiSelectHandles, videoElementsRef, extraVideoElementsRef, elementSlotsRef, slotAssigner]);

  // Handle playback
  useEffect(() => {
    if (!isPlaying) {
      // Stop all videos
      forEachVideo(video => {
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

    // Where this run of the loop starts, on the timeline.
    let startTimelineTime = currentTime;

    // Find active clips and set up audio
    const activeClips = getClipsAtTime(clips, tracks, currentTime);

    if (activeClips.length === 0) {
      // No clips at current position, find next clip
      const nextClip = clips
        .filter(c => c.timelinePosition > currentTime)
        .sort((a, b) => a.timelinePosition - b.timelinePosition)[0];

      if (!nextClip) {
        setIsPlaying(false);
        setCurrentTime(timelineDuration);
        return;
      }

      // Play on from the next clip (ESCSUITE-280). The loop starts there in
      // this same run, on its own clock: `currentTime` is not a dependency of
      // this effect, so returning here after the store write left playback
      // "playing" with no loop running. The store gets the jumped-to time once
      // so the timeline playhead moves; nothing is active yet, so the loop's
      // first frame starts the clip's media through its clipsChanged branch.
      startTimelineTime = nextClip.timelinePosition;
      setCurrentTime(startTimelineTime);
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

    // Decided once per run: a timeline with no transition on it has nothing to
    // hold, and the loop then asks for no transition at all, frame after frame.
    const anyTransition = clips.some(c => c.transition.type !== 'none' && c.transition.duration > 0);

    // Which of its source's elements each live clip plays on (ESCSUITE-313):
    // two clips of one source are two elements, both playing — and both
    // sounding, as the export's mix has them. Assigned again only when the set
    // of live clips changes, or a transition's incoming side is first held
    // below; either way a clip still live keeps its element (ESCSUITE-323), so
    // a clip starting below a playing one, or a held incoming side going live
    // at its cut, never moves another clip. Each assignment names the running
    // transition, whose sides the frame's draw reads from the same map. An
    // overlay has no slot and no element under its empty source id, so the
    // lookups return before reading one.
    const slots = elementSlotsRef.current;
    slotAssigner.assign(activeClips, anyTransition ? getActiveTransition(clips, tracks, currentTime) : null, slots);
    const elementFor = (clip: Clip) =>
      previewVideoForSlot(videoElementsRef.current, extraVideoElementsRef.current, clip.sourceVideoId, slots.get(clip.id)!);

    // Start all active videos at correct positions (skip images and audio)
    for (const { clip, clipTime } of activeClips) {
      const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
      // Skip image and audio clips - they don't need video playback
      if (sourceMedia?.mediaType === 'image' || sourceMedia?.mediaType === 'audio') continue;

      const video = elementFor(clip);
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
    // The last time this loop wrote to the store, and the time of the frame it
    // last drew — what a pause publishes (ESCSUITE-281).
    let lastStoreUpdateTime = startTimelineTime;
    let frameTime = startTimelineTime;
    // The store's seek count as of that write (ESCSUITE-287). Re-read at each
    // of the loop's own writes, not only here: a seek made mid-play without a
    // pause (a marker jump, a clip-preview scrub) is overwritten by the next
    // 200 ms write, and must not stop a later plain pause from publishing.
    let seekSequenceAtLastWrite = useEditorStore.getState().seekSequence;

    // Track last active clips to detect transitions
    let lastActiveClipIds = new Set(activeClips.map(c => c.clip.id));

    // The incoming side of a running transition has not started, so it shows
    // its first frame, held — on the element its slot names, which for a
    // split clip crossfading into itself is a second element of the one
    // source (ESCSUITE-313), and which it keeps once it goes live at the cut
    // (ESCSUITE-323), so the hold is not wasted. Positioned once per
    // transition, when its incoming clip changes, rather than every frame; an
    // incoming clip that is already live (on another track) is playing on its
    // own slot and is left alone.
    let heldIncomingId: string | null = null;
    const holdIncoming = (
      transition: ReturnType<typeof getActiveTransition>,
      liveClips: typeof activeClips,
      liveClipIds: Set<string>
    ) => {
      const holding = transition && !liveClipIds.has(transition.incomingClip.id) ? transition : null;
      const incomingId = holding ? holding.incomingClip.id : null;
      if (incomingId === heldIncomingId) return;
      heldIncomingId = incomingId;
      if (!holding) return;
      const incoming = holding.incomingClip;
      slotAssigner.assign(liveClips, holding, slots);
      const slot = slots.get(incoming.id)!;
      const video = previewVideoForSlot(videoElementsRef.current, extraVideoElementsRef.current, incoming.sourceVideoId, slot);
      if (!video) return;
      video.pause();
      if (Math.abs(video.currentTime - incoming.startTime) > 0.1) {
        video.currentTime = incoming.startTime;
      }
    };

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
        // A region shorter than one frame does not loop: it stops at its end,
        // like the end of the timeline with the loop off.
        if (loopPlaybackRef.current && loopEnd - loopStart >= MIN_LOOP_LENGTH_S) {
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
          forEachVideo(video => {
            video.pause();
          });
          audioElementsRef.current.forEach(audio => {
            audio.pause();
          });

          // Update display and continue
          setCurrentTime(loopStart);
          publishDisplayTime(loopStart, true);
          lastActiveClipIds = new Set();
          heldIncomingId = null;
          lastStoreUpdateTime = loopStart;
          seekSequenceAtLastWrite = useEditorStore.getState().seekSequence;
          frameTime = loopStart;

          // Continue animation loop
          animationFrameRef.current = requestAnimationFrame(animate);
          return;
        } else {
          // Stop playback at the end — of the timeline, or of a loop region
          // too short to loop (loopEnd is the timeline's end with the loop off)
          forEachVideo(video => video.pause());
          audioElementsRef.current.forEach(audio => audio.pause());
          setIsPlaying(false);
          setCurrentTime(loopEnd);
          publishDisplayTime(loopEnd, true);
          return;
        }
      }

      // Get current active clips
      const currentActiveClips = getClipsAtTime(clips, tracks, newTimelineTime);
      const currentClipIds = new Set(currentActiveClips.map(c => c.clip.id));
      const transition = anyTransition ? getActiveTransition(clips, tracks, newTimelineTime) : null;

      // Check if clip set has changed (new clips appeared or old clips ended)
      const clipsChanged = currentClipIds.size !== lastActiveClipIds.size ||
        [...currentClipIds].some(id => !lastActiveClipIds.has(id)) ||
        [...lastActiveClipIds].some(id => !currentClipIds.has(id));

      if (clipsChanged) {
        // Clips changed - need to update video playback and audio routing
        lastActiveClipIds = currentClipIds;
        slotAssigner.assign(currentActiveClips, transition, slots);

        // Pause videos that are no longer active — by element, since a source
        // can have one per live clip (ESCSUITE-313).
        const activeVideos = new Set<HTMLVideoElement>();
        for (const { clip } of currentActiveClips) {
          const video = elementFor(clip);
          if (video) activeVideos.add(video);
        }
        forEachVideo((video) => {
          if (!activeVideos.has(video)) {
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

          const video = elementFor(clip);
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
            const video = videoForSlot(
              videoElementsRef.current, extraVideoElementsRef.current, clip.sourceVideoId, slots.get(clip.id)!
            );
            if (video && !track?.muted) {
              video.volume = combinedVolume;
            }
          }
        }
      }

      holdIncoming(transition, currentActiveClips, currentClipIds);

      // Tell the readout where the playhead is — throttled, and never a
      // React setter on this path.
      publishDisplayTime(newTimelineTime);

      // Update store less frequently (every 200ms)
      if (newTimelineTime - lastStoreUpdateTime > 0.2) {
        setCurrentTime(newTimelineTime);
        lastStoreUpdateTime = newTimelineTime;
        seekSequenceAtLastWrite = useEditorStore.getState().seekSequence;
      }

      // Draw the composited frame (even if there are no active clips - shows black)
      frameTime = newTimelineTime;
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

      // A pause resumes from the frame on screen (ESCSUITE-281). The store has
      // only the loop's last 200 ms write, so publish the last frame's time
      // once, here, as the loop stops — every pauser (Space, the Pause button,
      // a grab of the playhead) goes through this cleanup. Only when this is a
      // pause (the effect is not just restarting for an edit, or unmounting
      // mid-playback) and only when no seek has happened since the loop's own
      // last write: a pause that came with a seek — a ruler click, Home, a
      // step, a marker — wrote its target in the same batch, and must keep it.
      // That is also why the pause branch above writes nothing.
      //
      // A seek is seen two ways. The seek count (ESCSUITE-287) catches every
      // seeker, a seek to the time the store already held included — Home in
      // the first 200 ms of playing from 0, a marker on the in point just
      // after a loop-back — which the value alone cannot. The value check
      // stays for the loop's own stop arms: the end of the timeline and a loop
      // region shorter than one frame call `setIsPlaying(false)` and
      // `setCurrentTime(loopEnd)` without counting a seek, and only the value
      // check keeps this cleanup from overwriting `loopEnd` with the earlier
      // frame time (pinned by "stops at the end of the timeline when loop
      // playback is off"). It also catches any other write that bypasses
      // `seekTo`. Do not drop it in favour of the count.
      const { isPlaying: stillPlaying, currentTime: storeTime, seekSequence } = useEditorStore.getState();
      if (!stillPlaying && storeTime === lastStoreUpdateTime && seekSequence === seekSequenceAtLastWrite) {
        setCurrentTime(frameTime);
      }
    };
  }, [isPlaying, clips, tracks, timelineDuration, setIsPlaying, setCurrentTime, drawFrame, sourceVideos, videoElementsRef, extraVideoElementsRef, elementSlotsRef, slotAssigner, audioElementsRef, isPlayingRef, publishDisplayTime, forEachVideo]);

  return useMemo(
    () => ({ subscribeDisplayTime, getDisplayTime }),
    [subscribeDisplayTime, getDisplayTime]
  );
}
