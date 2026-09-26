// The benchmark scene, as a unit-test fixture.
//
// This is the same 12-clip, 13-second timeline the real-browser benchmarks in
// `apps/e2e/tests/perf/` play and export (`apps/e2e/utils/perf.ts` builds it
// there). Keeping the two in step is the whole point: the numbers the
// `*.perf.test.ts` files pin — canvas calls per frame, animation lookups per
// frame, frames created vs closed — describe the same work the browser
// benchmark reports wall-clock timings for, so a per-frame ceiling here and a
// millisecond figure there are talking about one scene.
//
// Deterministic by construction: everything varies by clip index, nothing by
// clock or random source.
//
// Lives under src/test/ so neither the vitest `include` glob (which would treat
// it as a suite containing no tests) nor the coverage `include` glob (which
// would score test scaffolding as production code) picks it up.
import type { Clip, ClipMask, ClipStroke, Project, SourceVideo, Track } from '../../store/types'

/** Project canvas the scene renders at — 720p, as in the browser benchmark. */
export const SCENE_RESOLUTION = { width: 1280, height: 720 } as const

/** The source every media clip draws from: one small video, reused 12 times. */
export const SCENE_SOURCE_WIDTH = 64
export const SCENE_SOURCE_HEIGHT = 48

/** Media clips in the scene, split evenly across the two media tracks. */
export const MEDIA_CLIPS = 12
const CLIPS_PER_TRACK = MEDIA_CLIPS / 2
/** Seconds each clip occupies on the timeline. */
const CLIP_SECONDS = 2
/** Track 1's clips are offset by half a clip so the two tracks composite together. */
const TRACK_1_OFFSET = CLIP_SECONDS / 2

/**
 * Scale that makes a `V1` clip fill the canvas width.
 *
 * Scale 1 means *native pixel size* in this editor, not fill-canvas, so a
 * 64x48 source at scale 1 would paint 0.3% of a 720p frame — the wrong thing
 * to measure. 1280/64 = 20 puts a clip across the full canvas.
 */
const FULL_FRAME_SCALE = SCENE_RESOLUTION.width / SCENE_SOURCE_WIDTH
/** Picture-in-picture clips on `V2`, at roughly a third of the frame width. */
const PIP_SCALE = FULL_FRAME_SCALE / 3

/** Total timeline length: V2's last clip ends half a clip after V1's. */
export const SCENE_DURATION_SECONDS =
  (CLIPS_PER_TRACK - 1) * CLIP_SECONDS + TRACK_1_OFFSET + CLIP_SECONDS

export const SCENE_SOURCE_ID = 'perf-source'

/**
 * A frame with the two heaviest media paths on screen at once: the blurred
 * `V1` clip (i=3, 6–8 s) under the `screen`-blended `V2` clip (i=9, 7–9 s),
 * both overlays on top. No transition is running here.
 */
export const EFFECTS_FRAME_TIME = 7.5

/**
 * A frame with exactly one media clip live: V1's first clip runs 0-2 s and V2's
 * first does not start until 1 s, so only one clip is asking the shared <video>
 * element for a position. The two overlays are drawn as always; neither seeks.
 */
export const SINGLE_CLIP_FRAME_TIME = 0.5

/**
 * A frame inside the scene's one transition: `V1`'s third clip (4–6 s) carries
 * a 0.5 s fade, so 5.5–6 s cross-dissolves it into the fourth while `V2`'s
 * third clip (5–7 s) and both overlays draw as usual.
 */
export const TRANSITION_FRAME_TIME = 5.75

/** Tracks the scene puts on the timeline: two media, one text, one shape. */
export const SCENE_TRACKS: Track[] = [
  { id: 'perf-track-0', name: 'V1', index: 0 },
  { id: 'perf-track-1', name: 'V2', index: 1 },
  { id: 'perf-track-text', name: 'Text', index: 2 },
  { id: 'perf-track-shape', name: 'Shape', index: 3 },
].map(({ id, name, index }) => ({
  id,
  name,
  index,
  visible: true,
  locked: false,
  muted: false,
  volume: 1,
  height: 64,
}))

export const sceneSource: SourceVideo = {
  id: SCENE_SOURCE_ID,
  name: 'perf.mp4',
  duration: CLIP_SECONDS,
  width: SCENE_SOURCE_WIDTH,
  height: SCENE_SOURCE_HEIGHT,
  frameRate: 30,
  mimeType: 'video/mp4',
  size: 4096,
}

/**
 * The scene's clips: 12 media clips over two tracks, one text overlay and one
 * shape overlay, each overlay on its own track and spanning the timeline.
 *
 * Every fourth media clip carries a 4 px blur and every fifth a `screen` blend,
 * so the filter and blend paths are both exercised; the third `V1` clip carries
 * the one 0.5 s fade transition.
 */
export function buildSceneClips(): Clip[] {
  const clips: Clip[] = []

  for (let i = 0; i < MEDIA_CLIPS; i++) {
    const onSecondTrack = i >= CLIPS_PER_TRACK
    const slot = i % CLIPS_PER_TRACK
    const position = slot * CLIP_SECONDS + (onSecondTrack ? TRACK_1_OFFSET : 0)

    clips.push({
      id: `perf-clip-${i}`,
      sourceVideoId: SCENE_SOURCE_ID,
      name: `perf-${i}`,
      startTime: 0,
      endTime: CLIP_SECONDS,
      duration: CLIP_SECONDS,
      trackId: onSecondTrack ? 'perf-track-1' : 'perf-track-0',
      timelinePosition: position,
      blendMode: i % 5 === 4 ? 'screen' : 'normal',
      transform: onSecondTrack
        ? {
            x: 0.2 + slot * 0.1,
            y: 0.3,
            scaleX: PIP_SCALE,
            scaleY: PIP_SCALE,
            rotation: slot * 3,
            opacity: 0.85,
            scaleLocked: true,
          }
        : {
            x: 0.5,
            y: 0.5,
            scaleX: FULL_FRAME_SCALE,
            scaleY: FULL_FRAME_SCALE,
            rotation: 0,
            opacity: 1,
            scaleLocked: true,
          },
      effects: { blur: i % 4 === 3 ? 4 : 0 },
      transition:
        i === 2 ? { type: 'fade', duration: 0.5 } : { type: 'none', duration: 0.5 },
    })
  }

  clips.push({
    id: 'perf-clip-text',
    sourceVideoId: '',
    name: 'ESCAPE perf',
    startTime: 0,
    endTime: SCENE_DURATION_SECONDS,
    duration: SCENE_DURATION_SECONDS,
    trackId: 'perf-track-text',
    timelinePosition: 0,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, scaleLocked: true },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
    overlayType: 'text',
    textData: {
      text: 'ESCAPE perf',
      x: 0.5,
      y: 0.8,
      fontFamily: 'Arial',
      fontSize: 48,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#ffffff',
      backgroundColor: '#00000080',
      textAlign: 'center',
      rotation: 0,
      scale: 1,
    },
  })

  clips.push({
    id: 'perf-clip-shape',
    sourceVideoId: '',
    name: 'perf shape',
    startTime: 0,
    endTime: SCENE_DURATION_SECONDS,
    duration: SCENE_DURATION_SECONDS,
    trackId: 'perf-track-shape',
    timelinePosition: 0,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, scaleLocked: true },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
    overlayType: 'shape',
    shapeData: {
      type: 'rectangle',
      x: 0.2,
      y: 0.2,
      width: 0.25,
      height: 0.2,
      fillColor: '#1e90ffcc',
      strokeColor: '#ffffff',
      strokeWidth: 4,
      rotation: 12,
      blurAmount: 0,
    },
  })

  return clips
}

/** The whole scene as a project, ready for `setProject`. */
export function buildSceneProject(): Project {
  return {
    id: 'perf-scene',
    name: 'Perf Scene',
    created: 0,
    modified: 0,
    resolution: { ...SCENE_RESOLUTION },
    timeline: {
      tracks: SCENE_TRACKS.map((t) => ({ ...t })),
      clips: buildSceneClips(),
      textOverlays: [],
      shapeOverlays: [],
      duration: SCENE_DURATION_SECONDS,
    },
  }
}

/**
 * The mask and stroke the masked variant of the scene puts on every media clip
 * (ESCSUITE-65) — the handoff's own pair, so the variant measures the shape a
 * real user most often has: a circular webcam clip with ESCAPECRAFT's white
 * border.
 */
export const MASKED_SCENE_MASK: ClipMask = { kind: 'circle' }
export const MASKED_SCENE_STROKE: ClipStroke = {
  color: 'rgba(255, 255, 255, 0.8)',
  width: 3 / 1280,
}

/**
 * Media clips live at `EFFECTS_FRAME_TIME`, and over the export range the MP4
 * ceilings measure: the full-frame V1 clip (6-8 s) and the `screen`-blended
 * picture-in-picture V2 clip (7-9 s). The two overlays are live too but take
 * neither field — media clips only (decision 3) — so the per-frame delta the
 * ceilings expect is this many times the per-clip cost.
 */
export const MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME = 2

/**
 * The scene's clips with every **media** clip masked and stroked.
 *
 * A variant, deliberately, and never an edit to `buildSceneClips`: adding a mask
 * to an existing perf-scene clip would move the plain ceilings and break the
 * "same scene as the browser benchmark" contract this file opens with —
 * `apps/e2e/utils/perf.ts` builds the same twelve clips in a real browser and
 * the millisecond figures it reports are about that scene.
 *
 * The overlays are left alone because they cannot take either field.
 */
export function buildMaskedSceneClips(): Clip[] {
  return buildSceneClips().map((clip) =>
    clip.overlayType === undefined
      ? { ...clip, mask: { ...MASKED_SCENE_MASK }, stroke: { ...MASKED_SCENE_STROKE } }
      : clip
  )
}

/** The masked variant as a project, ready for `setProject`. */
export function buildMaskedSceneProject(): Project {
  const project = buildSceneProject()
  return {
    ...project,
    id: 'perf-scene-masked',
    name: 'Perf Scene (masked)',
    timeline: { ...project.timeline, clips: buildMaskedSceneClips() },
  }
}
