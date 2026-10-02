// The WebM export pipeline. Unlike the MP4 path this one seeks HTMLVideoElements
// directly rather than decoding through WebCodecs, so the interesting
// behaviour is the frame loop, the VP9/VP8/Opus muxing and probing, and what
// it does when things go wrong (ESCSUITE-29 Mechanism 1 gave this exporter
// the same codec ladder and error-surfacing shape exportMP4.ts already had).
// Real storage, real canvas renderer, real animation engine; doubles for
// WebCodecs, the media elements, the 2D context, mediabunny and the audio
// mixer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToWebM } from './exportWebM'
import { ExportAbortedError, ExportError } from './exportTypes'
import { extractAndMixAudio } from './audioMixer'
import { storeVideo } from './storage'
import {
  getMediabunnyState,
  lastMediabunnyOutput,
  resetMediabunnyDouble,
} from '../test/doubles/mediabunny'
import {
  destBox,
  getLastCanvasContext,
  installCanvasDouble,
  installOffscreenCanvasDouble,
  uninstallCanvasDouble,
  type OffscreenCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import {
  allFramesClosed,
  installWebCodecsDoubles,
  removeWebCodecsGlobals,
  webcodecsCallLog,
  type WebCodecsDoubles,
} from '../test/doubles/webcodecs'
import {
  makeClip,
  makeExportOptions,
  makeShapeData,
  makeSourceVideo,
  makeTextData,
  makeTrack,
} from '../test/fixtures/clipFixtures'
import type { Clip, ExportOptions, ExportProgress, SourceVideo, Track } from '../store/types'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('./audioMixer', () => ({
  extractAndMixAudio: vi.fn(async () => null),
}))

const mixAudio = vi.mocked(extractAndMixAudio)

/** 6 frames at 30fps. */
const CLIP_DURATION = 0.2
const SAMPLE_RATE = 48000

let media: MediaDoubles
let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

const audioFor = (seconds: number) => new Float32Array(Math.round(seconds * SAMPLE_RATE) * 2)

async function storeSource(id: string, type = 'video/webm'): Promise<void> {
  await storeVideo(id, new Blob([new Uint8Array(8)], { type }), makeSourceVideo({ id }))
}

interface RunOptions {
  clips?: Clip[]
  sources?: SourceVideo[]
  options?: Partial<ExportOptions>
  tracks?: Track[]
  signal?: AbortSignal
  projectResolution?: { width: number; height: number }
  onProgress?: (p: ExportProgress) => void
}

function run({
  clips = [makeClip({ duration: CLIP_DURATION, endTime: CLIP_DURATION })],
  sources = [makeSourceVideo({ width: 640, height: 360 })],
  options = {},
  tracks = [makeTrack()],
  signal,
  projectResolution,
  onProgress = vi.fn(),
}: RunOptions = {}): Promise<Blob> {
  return exportToWebM(
    clips,
    sources,
    makeExportOptions({ format: 'webm', ...options }),
    onProgress,
    tracks,
    signal,
    projectResolution
  )
}

const ctx = () => getLastCanvasContext() as RecordingCanvasRenderingContext2D

beforeEach(async () => {
  resetMediabunnyDouble()
  mixAudio.mockReset()
  mixAudio.mockResolvedValue(null)
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  webcodecs = installWebCodecsDoubles()
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await storeSource('video1')
})

afterEach(() => {
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  warns.mockRestore()
  errors.mockRestore()
})

describe('exportToWebM preconditions', () => {
  it('refuses to run without WebCodecs', async () => {
    const restore = removeWebCodecsGlobals()

    await expect(run()).rejects.toThrow('WebM export requires WebCodecs API (Chrome/Edge)')

    restore()
  })

  it('refuses to export an empty timeline', async () => {
    await expect(run({ clips: [] })).rejects.toThrow('No clips to export')
  })

  it('throws ExportAbortedError for a signal that is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(run({ signal: controller.signal })).rejects.toBeInstanceOf(ExportAbortedError)
    expect(getMediabunnyState().outputs).toHaveLength(0)
  })

  it('rejects a 0x0 resolved resolution before any encoder is built (ESCSUITE-152)', async () => {
    const error = await run({ projectResolution: { width: 0, height: 0 } }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toMatch(/resolution/i)
    expect(webcodecs.videoEncoders).toHaveLength(0)
  })
})

describe('exportToWebM muxing', () => {
  it('produces a WebM blob carrying the muxed bytes', async () => {
    const blob = await run()

    expect(blob.type).toBe('video/webm')
    expect(blob.size).toBe(128)
  })

  it('muxes a WebM with one VP9 video track', async () => {
    await run()

    const output = lastMediabunnyOutput()
    expect(output.format).toMatchObject({ name: 'webm' })
    expect(output.tracks).toHaveLength(1)
    expect(output.tracks[0]).toMatchObject({ kind: 'video', options: { frameRate: 30 } })
    expect(getMediabunnyState().videoSources[0].codec).toBe('vp9')
  })

  it('configures the encoder for VP9 at the requested resolution and bitrate', async () => {
    await run({ options: { resolution: '720p', quality: 'low' } })

    expect(webcodecs.videoEncoders[0].configs[0]).toEqual({
      codec: 'vp09.00.10.08',
      width: 1280,
      height: 720,
      bitrate: 2_000_000,
      framerate: 30,
      latencyMode: 'quality',
    })
  })

  it('encodes at the project resolution when asked for it', async () => {
    await run({
      options: { resolution: 'project' },
      projectResolution: { width: 1024, height: 768 },
    })

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ width: 1024, height: 768 })
  })

  it('starts the output before encoding and finalizes it after', async () => {
    await run()

    expect(getMediabunnyState().callLog).toEqual([
      'Output.addVideoTrack',
      'Output.start',
      'Output.finalize',
    ])
  })

  it('adds one packet per frame, keyframed once a second', async () => {
    await run()

    expect(getMediabunnyState().videoSources[0].packets).toHaveLength(6)
    expect(webcodecs.videoEncoders[0].encodes.map((e) => e.keyFrame)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('timestamps frames from the start of the export, in microseconds', async () => {
    await run()

    expect(webcodecs.videoEncoders[0].encodes.map((e) => e.timestamp)).toEqual([
      0, 33333, 66667, 100000, 133333, 166667,
    ])
  })

  it('flushes and closes both encoders before finalizing', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))

    await run()

    expect(webcodecs.videoEncoders[0].flushes).toBe(1)
    expect(webcodecs.videoEncoders[0].state).toBe('closed')
    expect(webcodecs.audioEncoders[0].flushes).toBe(1)
    expect(webcodecs.audioEncoders[0].state).toBe('closed')
  })

  it('fails when the muxer wrote no bytes', async () => {
    getMediabunnyState().producesBuffer = false

    await expect(run()).rejects.toThrow('Export failed: no data was written to buffer')
  })
})

describe('exportToWebM audio', () => {
  it('exports without an audio track when the mixer found no audio', async () => {
    await run()

    expect(lastMediabunnyOutput().tracks.map((t) => t.kind)).toEqual(['video'])
    expect(webcodecs.audioEncoders).toHaveLength(0)
  })

  it('adds an Opus track and encodes the mix in one-second chunks', async () => {
    mixAudio.mockResolvedValue(audioFor(1.5))

    await run()

    expect(lastMediabunnyOutput().tracks.map((t) => t.kind)).toEqual(['video', 'audio'])
    expect(getMediabunnyState().audioSources[0].codec).toBe('opus')
    expect(webcodecs.audioEncoders[0].configs[0]).toEqual({
      codec: 'opus',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate: 192_000,
    })
    expect(webcodecs.audioEncoders[0].encodes).toEqual([
      { timestamp: 0, numberOfFrames: SAMPLE_RATE },
      { timestamp: 1_000_000, numberOfFrames: SAMPLE_RATE / 2 },
    ])
    expect(getMediabunnyState().audioSources[0].packets).toHaveLength(2)
  })

  it('deinterleaves each chunk into planar float data and closes it', async () => {
    const mix = audioFor(0.5)
    mix[0] = 0.25
    mix[1] = -0.25
    mix[2] = 0.5
    mixAudio.mockResolvedValue(mix)

    await run()

    const data = webcodecs.audioData[0]
    expect(data.format).toBe('f32-planar')
    expect(data.data[0]).toBeCloseTo(0.25, 6)
    expect(data.data[1]).toBeCloseTo(0.5, 6)
    expect(data.data[data.numberOfFrames]).toBeCloseTo(-0.25, 6)
    expect(webcodecs.audioData.every((d) => d.closed)).toBe(true)
  })

  it('slices the mixed audio down to the selected range', async () => {
    const mix = audioFor(1)
    mix[Math.floor(0.5 * SAMPLE_RATE) * 2] = 0.75
    mixAudio.mockResolvedValue(mix)

    await run({
      clips: [makeClip({ duration: 1, endTime: 1 })],
      options: { timeRange: { start: 0.5, end: 1 } },
    })

    expect(webcodecs.audioData[0].numberOfFrames).toBe(SAMPLE_RATE / 2)
    expect(webcodecs.audioData[0].data[0]).toBeCloseTo(0.75, 6)
  })
})

describe('exportToWebM rendering', () => {
  it('clears each frame to black before compositing', async () => {
    await run()

    const fills = ctx().argsFor('fillRect')
    expect(fills).toHaveLength(6)
    expect(fills[0]).toEqual([0, 0, 640, 360])
    expect(ctx().stateFor('fillRect')[0].fillStyle).toBe('#000000')
  })

  it('rewinds every source before the frame loop, then seeks it per frame', async () => {
    await run({
      clips: [makeClip({ startTime: 2, duration: CLIP_DURATION, endTime: 2 + CLIP_DURATION })],
    })

    expect(media.seeks[0]).toBe(0) // rewound during setup
    expect(media.seeks.slice(1)).toEqual([
      2,
      2 + 1 / 30,
      2 + 2 / 30,
      2 + 3 / 30,
      2 + 4 / 30,
      2 + 5 / 30,
    ])
  })

  it('draws the video element for each timeline frame', async () => {
    await run()

    expect(ctx().argsFor('drawImage')).toHaveLength(6)
    expect(ctx().argsFor('drawImage')[0][0]).toBe(media.videos[0])
  })

  it('draws nothing for a video that has no frame data', async () => {
    media.script({ video: { readyState: 1 } })

    // One frame only: the exporter waits out its 300ms frame-data timeout for
    // each frame of a video that never decodes one.
    await run({ clips: [makeClip({ duration: 1 / 30, endTime: 1 / 30 })] })

    expect(ctx().argsFor('drawImage')).toHaveLength(0)
  })

  it('draws an image source', async () => {
    await storeSource('image1', 'image/png')

    await run({
      clips: [makeClip({ sourceVideoId: 'image1', duration: CLIP_DURATION, endTime: CLIP_DURATION })],
      sources: [makeSourceVideo({ id: 'image1', mediaType: 'image' })],
    })

    expect(media.images).toHaveLength(1)
    expect(ctx().argsFor('drawImage')[0][0]).toBe(media.images[0])
  })

  it('never loads an audio-only source as video', async () => {
    await storeSource('audio1', 'audio/mp3')

    await run({
      clips: [makeClip({ sourceVideoId: 'audio1', duration: CLIP_DURATION, endTime: CLIP_DURATION })],
      sources: [makeSourceVideo({ id: 'audio1', mediaType: 'audio' })],
    })

    expect(media.videos).toHaveLength(0)
    expect(ctx().argsFor('drawImage')).toHaveLength(0)
  })

  it('retries an unloadable video as an image', async () => {
    media.script({ video: { fail: true } })

    await run()

    expect(warns.mock.calls[0][0]).toBe('Failed to load video video1, trying as image:')
    expect(ctx().argsFor('drawImage')[0][0]).toBe(media.images[0])
  })

  it('gives up on media that loads as neither video nor image', async () => {
    media.script({ video: { fail: true }, image: { fail: true } })

    await run()

    expect(warns).toHaveBeenCalledWith('Failed to load media video1')
    expect(ctx().argsFor('drawImage')).toHaveLength(0)
  })

  it('skips a source that is not in storage', async () => {
    await run({
      clips: [makeClip({ sourceVideoId: 'gone', duration: CLIP_DURATION, endTime: CLIP_DURATION })],
    })

    expect(media.videos).toHaveLength(0)
  })

  it('falls back to a single default track when the caller supplies none', async () => {
    await exportToWebM(
      [makeClip({ trackId: 'default', duration: CLIP_DURATION, endTime: CLIP_DURATION })],
      [makeSourceVideo({ width: 640, height: 360 })],
      makeExportOptions({ format: 'webm' }),
      vi.fn()
    )

    expect(ctx().argsFor('drawImage')).toHaveLength(6)
  })

  it('draws overlays over the media, bottom track first', async () => {
    const clips = [
      makeClip({ duration: CLIP_DURATION, endTime: CLIP_DURATION }),
      makeClip({
        id: 'shape',
        sourceVideoId: '',
        trackId: 'track2',
        overlayType: 'shape',
        shapeData: makeShapeData({ type: 'ellipse' }),
        duration: CLIP_DURATION,
        endTime: CLIP_DURATION,
      }),
      makeClip({
        id: 'text',
        sourceVideoId: '',
        trackId: 'track3',
        overlayType: 'text',
        textData: makeTextData({ text: 'Overlay' }),
        duration: CLIP_DURATION,
        endTime: CLIP_DURATION,
      }),
    ]
    const tracks = [
      makeTrack(),
      makeTrack({ id: 'track2', index: 1 }),
      makeTrack({ id: 'track3', index: 2 }),
    ]

    await run({ clips, tracks })

    const methods = ctx().calls.map((c) => c.method)
    // A frame is ['setTransform', 'fillRect', ...draws], so the second frame
    // starts at the second clear — searched from index 2, past the first one.
    const firstFrame = methods.slice(0, methods.indexOf('fillRect', 2))
    expect(firstFrame.indexOf('drawImage')).toBeLessThan(firstFrame.indexOf('ellipse'))
    expect(firstFrame.indexOf('ellipse')).toBeLessThan(firstFrame.indexOf('fillText'))
    expect(ctx().argsFor('fillText')[0][0]).toBe('Overlay')
  })

  // ESCSUITE-124: the preview interleaves media and overlays by track index
  // (`components/Preview/drawFrame.ts`), so an overlay on a *lower* track than
  // a media clip is invisible on screen — the export must draw it in the same
  // place in the same order, not hoist every overlay above every media clip
  // regardless of track index.
  it('draws an overlay on a lower track before a media clip on a higher one', async () => {
    const clips = [
      makeClip({
        id: 'shape',
        sourceVideoId: '',
        trackId: 'track1',
        overlayType: 'shape',
        shapeData: makeShapeData({ type: 'ellipse' }),
        duration: CLIP_DURATION,
        endTime: CLIP_DURATION,
      }),
      makeClip({
        id: 'media',
        trackId: 'track2',
        duration: CLIP_DURATION,
        endTime: CLIP_DURATION,
      }),
    ]
    const tracks = [
      makeTrack({ id: 'track1', index: 0 }),
      makeTrack({ id: 'track2', index: 1 }),
    ]

    await run({ clips, tracks })

    const methods = ctx().calls.map((c) => c.method)
    // A frame is ['setTransform', 'fillRect', ...draws], so the second frame
    // starts at the second clear — searched from index 2, past the first one.
    const firstFrame = methods.slice(0, methods.indexOf('fillRect', 2))
    expect(firstFrame.indexOf('ellipse')).toBeLessThan(firstFrame.indexOf('drawImage'))
  })

  it('draws both sides of an active transition', async () => {
    await storeSource('video2')
    const clips = [
      makeClip({
        id: 'a',
        duration: 0.2,
        endTime: 0.2,
        timelinePosition: 0,
        transition: { type: 'fade', duration: 0.2 },
      }),
      makeClip({
        id: 'b',
        sourceVideoId: 'video2',
        duration: 0.2,
        endTime: 0.2,
        timelinePosition: 0.2,
      }),
    ]
    const sources = [
      makeSourceVideo({ width: 640, height: 360 }),
      makeSourceVideo({ id: 'video2', width: 640, height: 360 }),
    ]

    await run({ clips, sources, options: { timeRange: { start: 0, end: 0.1 } } })

    expect(ctx().argsFor('drawImage')).toHaveLength(6)
    const alphas = ctx().stateFor('drawImage').map((s) => s.globalAlpha)
    expect(alphas[0]).toBe(1)
    expect(alphas[1]).toBe(0)
  })

  it('encodes only the selected range, restamped from zero', async () => {
    await run({
      clips: [makeClip({ duration: 1, endTime: 1 })],
      options: { timeRange: { start: 0.5, end: 0.6 } },
    })

    const encodes = webcodecs.videoEncoders[0].encodes
    expect(encodes).toHaveLength(3)
    expect(encodes.map((e) => e.timestamp)).toEqual([0, 33333, 66667])
  })

  it('closes every VideoFrame it captured from the canvas', async () => {
    await run()

    expect(allFramesClosed()).toBe(true)
  })

  it('releases exactly the object URLs it created for the media', async () => {
    const create = vi.mocked(URL.createObjectURL)
    const revoke = vi.mocked(URL.revokeObjectURL)
    create.mockClear()
    revoke.mockClear()

    await run()

    // One source, so one URL out and the same one back in.
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke.mock.calls).toEqual([[create.mock.results[0].value]])
  })
})

// ESCSUITE-94. The canvas is the size of the **output**; everything
// `canvasRenderer` draws is in **project** pixels (a clip's size is its native
// source pixels times its scale, its position a fraction of the frame). One
// transform per frame carries the one space onto the other, exactly as
// `drawPreviewFrame` does. Before this the exporter composited straight into
// output pixels, so every resolution but "Project" was wrong: a larger raster
// pillar/letterboxed the picture in black, a smaller one cropped it.
describe('exportToWebM output raster', () => {
  it('scales the project onto a larger preset raster instead of pillarboxing it', async () => {
    media.script({ video: { videoWidth: 1280, videoHeight: 720 } })

    await run({
      sources: [makeSourceVideo({ width: 1280, height: 720 })],
      options: { resolution: '1080p' },
      projectResolution: { width: 1280, height: 720 },
    })

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ width: 1920, height: 1080 })
    // 1920 / 1280, and no translation: 1080p of a 16:9 project is the same
    // shape, so there are no bars to centre the picture between.
    expect(ctx().argsFor('setTransform')[0]).toEqual([1.5, 0, 0, 1.5, 0, 0])
    // Project pixels from here on. The clear is the project rect and the clip,
    // at scale 1, is its own 1280x720 — 1.5x each under the transform, which is
    // exactly the 1920x1080 frame.
    expect(ctx().argsFor('fillRect')[0]).toEqual([0, 0, 1280, 720])
    expect(destBox(ctx().argsFor('drawImage')[0])).toEqual([0, 0, 1280, 720])
  })

  it('scales a 4K project down to 1080p instead of cropping it', async () => {
    media.script({ video: { videoWidth: 3840, videoHeight: 2160 } })

    await run({
      sources: [makeSourceVideo({ width: 3840, height: 2160 })],
      options: { resolution: '1080p' },
      projectResolution: { width: 3840, height: 2160 },
    })

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ width: 1920, height: 1080 })
    expect(ctx().argsFor('setTransform')[0]).toEqual([0.5, 0, 0, 0.5, 0, 0])
    // The whole picture, halved — not the middle 1920x1080 of it.
    expect(destBox(ctx().argsFor('drawImage')[0])).toEqual([0, 0, 3840, 2160])
  })

  // The old "letterboxes deliberately when the output aspect really differs"
  // case lived here, driven through options.resolution: 'original' — the one
  // resolution that took the bottom clip's own source size rather than
  // following the project's aspect. ESCSUITE-111 dropped 'original': every
  // resolution left ties its output aspect to the project's, via the same
  // `projectResolution` parameter this file's `run()` passes to both the
  // canvas' project space and `getResolution`'s output size, so the two agree
  // to no more than rounding now — about one output pixel of bar, never a real
  // letterbox. The letterbox mechanism itself (`openOutputFrame` /
  // `setOutputTransform`) is unchanged and still directly covered, hand-built
  // sizes included, by `outputTransform.test.ts`.

  it('leaves a sub-pixel bar when a preset\'s round-to-even width just misses the project aspect', async () => {
    // 480p of a 1280x720 (16:9) project is 854x480 (getResolution rounds 853.33
    // up to the nearest even number), and 854/1280 (0.66719) is not quite
    // 480/720 (0.66667) — the gap `projectToOutputScale`'s own doc comment
    // names as "a third of an output pixel of pillar bar on each side". This is
    // `getResolution`'s round-to-even, not a resolution that ignores the
    // project's aspect (there is no longer one of those, ESCSUITE-111) — it is
    // the one non-zero-offset case still reachable through the exporter's
    // public options.
    media.script({ video: { videoWidth: 1280, videoHeight: 720 } })

    await run({
      sources: [makeSourceVideo({ width: 1280, height: 720 })],
      options: { resolution: '480p' },
      projectResolution: { width: 1280, height: 720 },
    })

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ width: 854, height: 480 });
    // The x offset is 1/3 of an output pixel arrived at through division, not
    // the literal — close-enough rather than exact avoids pinning a specific
    // float rounding artifact that isn't the point of this test.
    const transform = ctx().argsFor('setTransform')[0];
    expect(transform.slice(0, 4)).toEqual([2 / 3, 0, 0, 2 / 3]);
    expect(transform[4]).toBeCloseTo(1 / 3, 9);
    expect(transform[5]).toBe(0);
    // The clear is the whole raster in project coordinates: 1281x720 (854 /
    // (2/3)), centred half a project-pixel either side of the 1280-wide frame.
    const fillRect = ctx().argsFor('fillRect')[0];
    expect(fillRect[0]).toBeCloseTo(-0.5, 9);
    expect(fillRect.slice(1)).toEqual([0, 1281, 720]);
  })

  it('exports at 1:1 with no transform offsets for the project resolution', async () => {
    media.script({ video: { videoWidth: 1280, videoHeight: 720 } })

    await run({
      sources: [makeSourceVideo({ width: 1280, height: 720 })],
      options: { resolution: 'project' },
      projectResolution: { width: 1280, height: 720 },
    })

    expect(ctx().argsFor('setTransform')[0]).toEqual([1, 0, 0, 1, 0, 0])
    expect(ctx().argsFor('fillRect')[0]).toEqual([0, 0, 1280, 720])
  })

  it('asks for a blur in output pixels, not in project pixels', async () => {
    // `ctx.filter` is the one length the transform does not reach, so a
    // project-space blur radius has to be converted the way the preview
    // converts it — or a 1080p export of a 720p project would blur 1.5x too
    // little for the frame it lands in.
    media.script({ video: { videoWidth: 1280, videoHeight: 720 } })

    await run({
      clips: [makeClip({ duration: CLIP_DURATION, endTime: CLIP_DURATION, effects: { blur: 4 } })],
      sources: [makeSourceVideo({ width: 1280, height: 720 })],
      options: { resolution: '1080p' },
      projectResolution: { width: 1280, height: 720 },
    })

    expect(ctx().stateFor('drawImage')[0].filter).toBe('blur(6px)')
  })
})

describe('exportToWebM progress', () => {
  it('reports the phases in order, never going backwards', async () => {
    const progress: ExportProgress[] = []

    await run({ onProgress: (p) => progress.push(p) })

    expect(progress[0]).toMatchObject({ phase: 'preparing', progress: 0 })
    expect(progress[progress.length - 1]).toEqual({
      phase: 'complete',
      progress: 100,
      message: 'Export complete!',
    })
    const order = ['preparing', 'encoding', 'muxing', 'complete']
    const phases = progress.map((p) => order.indexOf(p.phase))
    expect(phases).toEqual([...phases].sort((a, b) => a - b))
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].progress).toBeGreaterThanOrEqual(progress[i - 1].progress)
    }
  })

  it('forwards the audio mixer progress into the preparing phase', async () => {
    mixAudio.mockImplementation(async (_clips, _tracks, _duration, onProgress) => {
      onProgress(50)
      return null
    })
    const progress: ExportProgress[] = []

    await run({ onProgress: (p) => progress.push(p) })

    expect(progress).toContainEqual({
      phase: 'preparing',
      progress: 6,
      message: 'Extracting audio...',
    })
  })

  it('caps encoding progress at 88 before muxing', async () => {
    const progress: ExportProgress[] = []

    await run({ onProgress: (p) => progress.push(p) })

    const encoding = progress.filter((p) => p.phase === 'encoding')
    expect(Math.max(...encoding.map((p) => p.progress))).toBeLessThanOrEqual(88)
    expect(progress.filter((p) => p.phase === 'muxing')[0]).toMatchObject({ progress: 92 })
  })
})

describe('exportToWebM failure handling', () => {
  it('aborts mid-encode and closes the encoder', async () => {
    const controller = new AbortController()
    const onProgress = (p: ExportProgress) => {
      if (p.message === 'Encoding frames...') controller.abort()
    }

    await expect(run({ signal: controller.signal, onProgress })).rejects.toBeInstanceOf(
      ExportAbortedError
    )
    expect(webcodecs.videoEncoders[0].state).toBe('closed')
    expect(allFramesClosed()).toBe(true)
  })

  // ESCSUITE-131: encode() has no try around it, so a frame the encoder throws
  // on is never closed — the catch below cleans up the media elements and the
  // encoders, but not the frame that was mid-flight.
  it('closes the frame it was encoding when the encoder throws', async () => {
    webcodecs.script.failVideoEncodeAt = [2]

    await expect(run()).rejects.toThrow('encode failed on attempt 2')

    expect(allFramesClosed()).toBe(true)
  })

  it('aborts during audio encoding and closes both encoders', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))
    const controller = new AbortController()
    const onProgress = (p: ExportProgress) => {
      if (p.message === 'Encoding audio...') controller.abort()
    }

    await expect(run({ signal: controller.signal, onProgress })).rejects.toBeInstanceOf(
      ExportAbortedError
    )
    expect(webcodecs.videoEncoders[0].state).toBe('closed')
    expect(webcodecs.audioEncoders[0].state).toBe('closed')
    expect(lastMediabunnyOutput().finalizeCalls).toBe(0)
  })

  it('honours an abort that arrives once muxing has started', async () => {
    // Cancelling late must still cancel: handing back a finished export is
    // wrong for the user, and in an embedded host it fires EXPORT_COMPLETE for
    // an export that was called off.
    mixAudio.mockResolvedValue(audioFor(0.2))
    const controller = new AbortController()
    const progress: ExportProgress[] = []
    const onProgress = (p: ExportProgress) => {
      progress.push(p)
      if (p.phase === 'muxing') controller.abort()
    }

    const result = await run({ signal: controller.signal, onProgress }).catch(
      (e: unknown) => e
    )

    expect(result).toBeInstanceOf(ExportAbortedError)
    expect(result).not.toBeInstanceOf(Blob)
    expect(progress.some((p) => p.phase === 'complete')).toBe(false)
    expect(lastMediabunnyOutput().finalizeCalls).toBeLessThanOrEqual(1)
    expect(webcodecs.videoEncoders[0].state).toBe('closed')
    expect(webcodecs.audioEncoders[0].state).toBe('closed')
    expect(allFramesClosed()).toBe(true)
  })

  it('rethrows a muxer failure as-is, after closing the encoder', async () => {
    getMediabunnyState().finalizeError = new Error('muxer exploded')

    await expect(run()).rejects.toThrow('muxer exploded')
    expect(webcodecs.videoEncoders[0].state).toBe('closed')
  })

  // ESCSUITE-156. Between the media load and the frame loop sit the muxer, two
  // `configure()` calls and the caller's own progress callback, and a throw from
  // any of them used to escape past the only `releaseElementSources` on the
  // error path — leaking a `<video>` or `<img>` and its object URL per source
  // for the life of the page, with nothing in the UI to say so.
  it('releases the media elements when the encoder refuses its configuration', async () => {
    const Encoder = globalThis.VideoEncoder as unknown as {
      prototype: { configure(config: unknown): void }
    }
    vi.spyOn(Encoder.prototype, 'configure').mockImplementation(() => {
      throw new DOMException('Unsupported configuration', 'NotSupportedError')
    })
    const revoke = vi.mocked(URL.revokeObjectURL)
    revoke.mockClear()

    await expect(run()).rejects.toThrow('Unsupported configuration')

    // One source, so one URL out and the same one back in — and the encoder
    // that was built before the throw is closed with it.
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(webcodecs.videoEncoders[0].state).toBe('closed')
  })

  it('releases the media elements when the setup fails before any encoder exists', async () => {
    const revoke = vi.mocked(URL.revokeObjectURL)
    revoke.mockClear()

    // The caller's own callback, throwing on the first report after the load.
    const onProgress = (p: ExportProgress) => {
      if (p.message === 'Initializing encoder...') throw new Error('dialog blew up')
    }

    await expect(run({ onProgress })).rejects.toThrow('dialog blew up')

    expect(revoke).toHaveBeenCalledTimes(1)
    expect(webcodecs.videoEncoders).toHaveLength(0)
  })

  // ESCSUITE-29 Mechanism 1: the error callback used to only console.error —
  // nothing ever read the flag it set, so a mid-export encoder failure never
  // failed the export. It now surfaces as an ExportError, the same shape
  // exportMP4.ts's own asynchronous-error test expects.
  it('surfaces an asynchronous video encoder error with the diagnostic log', async () => {
    webcodecs.script.videoErrorAfterEncodes = 2

    const error = (await run().catch((e: unknown) => e)) as ExportError

    expect(error).toBeInstanceOf(ExportError)
    expect(error.message).toBe('video encoder failed')
    expect(error.frameIndex).toBe(2)
    expect(error.totalFrames).toBe(6)
    expect(errors).toHaveBeenCalledWith('Video encoder error:', expect.any(Error))
    expect(error.exportLog.some((e) => e.phase === 'error')).toBe(true)
  })

  it('surfaces an asynchronous audio encoder error', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))
    webcodecs.script.audioErrorAfterEncodes = 1

    const error = (await run().catch((e: unknown) => e)) as ExportError

    expect(error).toBeInstanceOf(ExportError)
    expect(error.message).toBe('audio encoder failed')
    expect(errors).toHaveBeenCalledWith('Audio encoder error:', expect.any(Error))
  })

  // Coverage round: `waitForEncoderBackpressure`'s `getError` arrow — here,
  // `() => videoEncoderError` — is passed on every export, but its own `while`
  // loop body only runs `getError()` when `encodeQueueSize` actually exceeds
  // the threshold (20), which this suite's 6-frame fixture never naturally
  // does. A 12-frame clip gives an intermediate progress checkpoint
  // (frameCount 5 of 12) to force the queue over threshold at, well before
  // the frame whose own encode() call reports the error (6) — so the error
  // is live exactly when the backpressure wait's own check runs, not caught
  // by the top-of-loop check (which only ever sees it on the *next*
  // iteration) or the pre-finalize one (there are six frames left to encode).
  it('rejects with the encoder error raised while the backpressure wait is checking it', async () => {
    const clips = [makeClip({ duration: 12 / 30, endTime: 12 / 30 })]
    webcodecs.script.videoErrorAfterEncodes = 6
    const onProgress = vi.fn((p: ExportProgress) => {
      if (p.message === 'Encoding frame 5/12...') {
        webcodecs.videoEncoders[0].encodeQueueSize = 25
      }
    })

    const error = (await run({ clips, onProgress }).catch((e: unknown) => e)) as ExportError

    expect(error).toBeInstanceOf(ExportError)
    expect(error.message).toBe('video encoder failed')
    expect(
      error.exportLog.some((e) => e.detail === 'Encoder error during backpressure: video encoder failed')
    ).toBe(true)
  })

  // Review round 1, MAJOR 2(c): an error reported on the *last* frame's
  // encode() call lands after the frame loop has already run its final
  // iteration — there is no next iteration left for the top-of-loop check at
  // the top of the `for` to catch it on, and the queue never grows past the
  // backpressure threshold in this fixture — so only the pre-finalize check
  // can surface it. 6 is this fixture's frame count (CLIP_DURATION 0.2s @
  // 30fps); run() with the default clip is deliberate so this is exactly the
  // last encode() call.
  it('surfaces a video encoder error reported after the last frame, before finalizing', async () => {
    webcodecs.script.videoErrorAfterEncodes = 6

    const error = (await run().catch((e: unknown) => e)) as ExportError

    expect(error).toBeInstanceOf(ExportError)
    expect(error.message).toBe('video encoder failed')
    expect(
      error.exportLog.some((e) => e.detail === 'Video encoder error before finalize: video encoder failed')
    ).toBe(true)
  })
})

// ESCSUITE-159. The `catch` owns everything built after the media load
// (ESCSUITE-156), and the Mediabunny `Output` is one of those things: a throw
// after `output.start()` left the muxer holding its writer and its unfinalised
// target with no handle left to release them by. `cancel()` is Mediabunny's own
// call for exactly that, and the state it is for is `'started'` — the output is
// still mid-file. Everything else is already done with: a `'pending'` output
// wrote nothing, a `'finalized'` one is a finished file whose target
// `finalize()` closed (asking anyway only logs "Output has already been
// finalized."), and a *rejected* `finalize()` leaves `'canceled'`, which has
// released what it had. The exporter reads mediabunny's own `state` rather than
// keeping its own flag, exactly as ESCAPECRAFT's recorder `cleanup()` does.
describe('exportToWebM muxer cancellation', () => {
  it('cancels the started muxer when the frame loop fails', async () => {
    webcodecs.script.videoErrorAfterEncodes = 2

    await expect(run()).rejects.toBeInstanceOf(ExportError)

    expect(lastMediabunnyOutput().cancelCalls).toBe(1)
    expect(lastMediabunnyOutput().finalizeCalls).toBe(0)
    expect(lastMediabunnyOutput().state).toBe('canceled')
  })

  it('closes its encoders before cancelling the muxer, so no late packet reaches it', async () => {
    // The ordinary cancellation path, in miniature. The audio chunks are encoded
    // in one synchronous loop and the pre-finalize error check throws
    // immediately after it, so a packet is still sitting undelivered inside the
    // audio encoder when the catch runs. Closing the encoders first abandons it;
    // cancelling the muxer first would let it arrive at a packet source that now
    // throws 'Output has been canceled.' from inside an `output:` callback
    // nobody awaits — an unhandled rejection on top of the failure being
    // reported.
    mixAudio.mockResolvedValue(audioFor(0.2))
    webcodecs.script.videoErrorAfterEncodes = 6

    await expect(run()).rejects.toBeInstanceOf(ExportError)
    // Let anything the encoders had queued arrive.
    await Promise.resolve()
    await Promise.resolve()

    expect(getMediabunnyState().lateAdds).toBe(0)
    const log = webcodecsCallLog
    expect(log).toContain('Output.cancel')
    expect(log.indexOf('VideoEncoder.close')).toBeLessThan(log.indexOf('Output.cancel'))
    expect(log.indexOf('AudioEncoder.close')).toBeLessThan(log.indexOf('Output.cancel'))
  })

  it('reports the export failure, not the muxer, when the cancel itself fails', async () => {
    webcodecs.script.videoErrorAfterEncodes = 2
    getMediabunnyState().cancelError = new Error('muxer would not let go')

    const error = (await run().catch((e: unknown) => e)) as ExportError

    // A muxer that will not release is not what the user needs told: the export
    // failed for its own reason, and the refusal goes to the console the way
    // ESCAPECRAFT's `cancelOutput` reports one.
    expect(error).toBeInstanceOf(ExportError)
    expect(error.message).toBe('video encoder failed')
    expect(warns).toHaveBeenCalledWith(
      'The export output could not be cancelled:',
      expect.any(Error)
    )
  })

  it('leaves a muxer a failed finalize already cancelled alone', async () => {
    getMediabunnyState().finalizeError = new Error('muxer exploded')

    await expect(run()).rejects.toThrow('muxer exploded')

    // Mediabunny's own `finalize()` catch sets the state to `'canceled'` and its
    // `finally` closes the targets, so by the time the exporter's catch runs
    // there is nothing left to release — a `cancel()` here would take the
    // library's first early return and do nothing at all.
    expect(lastMediabunnyOutput().state).toBe('canceled')
    expect(lastMediabunnyOutput().cancel).not.toHaveBeenCalled()
  })

  it('never cancels the muxer of an export that succeeded', async () => {
    await run()

    expect(lastMediabunnyOutput().finalizeCalls).toBe(1)
    expect(lastMediabunnyOutput().state).toBe('finalized')
    expect(lastMediabunnyOutput().cancel).not.toHaveBeenCalled()
  })

  it('leaves a finalized muxer alone when the abort lands during muxing', async () => {
    // The post-finalize abort check reaches the catch with the file already
    // written: there is nothing left for `cancel()` to release, and asking
    // anyway only puts "Output has already been finalized." on the console of
    // an export the user called off.
    const controller = new AbortController()
    const onProgress = (p: ExportProgress) => {
      if (p.phase === 'muxing') controller.abort()
    }

    await expect(run({ signal: controller.signal, onProgress })).rejects.toBeInstanceOf(
      ExportAbortedError
    )

    expect(lastMediabunnyOutput().finalizeCalls).toBe(1)
    expect(lastMediabunnyOutput().cancel).not.toHaveBeenCalled()
  })

  it('has no muxer to cancel when the setup fails before one exists', async () => {
    // The first report after the media load is made before the Output is
    // constructed, so the catch runs with nothing recorded — the other side of
    // the same question.
    const onProgress = (p: ExportProgress) => {
      if (p.message === 'Initializing encoder...') throw new Error('dialog blew up')
    }

    await expect(run({ onProgress })).rejects.toThrow('dialog blew up')

    expect(getMediabunnyState().outputs).toHaveLength(0)
  })
})

// ESCSUITE-159. `releaseElementSources` runs once the frame loop and the muxer
// are done, and anything that throws *after* it reaches the catch, which
// releases again — two `revokeObjectURL` calls per source for one export. A
// handle freed twice reads, to anyone counting, as a handle something else still
// holds.
describe('exportToWebM release on the way out', () => {
  it('releases each media element once when the completion callback throws', async () => {
    const revoke = vi.mocked(URL.revokeObjectURL)
    revoke.mockClear()
    const onProgress = (p: ExportProgress) => {
      if (p.phase === 'complete') throw new Error('dialog blew up')
    }

    await expect(run({ onProgress })).rejects.toThrow('dialog blew up')

    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('releases each media element once when the muxer wrote no bytes', async () => {
    getMediabunnyState().producesBuffer = false
    const revoke = vi.mocked(URL.revokeObjectURL)
    revoke.mockClear()

    await expect(run()).rejects.toThrow('Export failed: no data was written to buffer')

    expect(revoke).toHaveBeenCalledTimes(1)
  })
})

describe('exportToWebM codec selection', () => {
  it('configures VP9 by default', async () => {
    await run()

    expect(webcodecs.encoder.configs).toHaveLength(1)
    expect(webcodecs.encoder.configs[0]).toMatchObject({ codec: 'vp09.00.10.08' })
    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ codec: 'vp09.00.10.08' })
    expect(getMediabunnyState().videoSources[0].codec).toBe('vp9')
  })

  it('falls back to VP8 when VP9 cannot be configured', async () => {
    webcodecs.encoder.answer = (c) => c.codec === 'vp8'

    await run()

    expect((webcodecs.encoder.configs as Array<{ codec: string }>).map((c) => c.codec)).toEqual([
      'vp09.00.10.08',
      'vp8',
    ])
    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ codec: 'vp8' })
    expect(getMediabunnyState().videoSources[0].codec).toBe('vp8')
  })

  it('skips a codec whose support probe throws', async () => {
    webcodecs.encoder.answer = (c) =>
      c.codec === 'vp09.00.10.08' ? Promise.reject(new Error('probe blew up')) : true

    await run()

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ codec: 'vp8' })
  })

  it('throws an ExportError before constructing any encoder when neither VP9 nor VP8 is supported', async () => {
    webcodecs.encoder.answer = () => false

    const error = (await run().catch((e: unknown) => e)) as ExportError

    expect(error).toBeInstanceOf(ExportError)
    expect(error.message).toBe('No supported video codec found. WebM export requires VP9 or VP8 support.')
    expect(webcodecs.encoder.configs).toHaveLength(2)
    expect(webcodecs.videoEncoders).toHaveLength(0)
    expect(getMediabunnyState().outputs).toHaveLength(0)
  })
})

describe('exportToWebM audio codec selection', () => {
  it('drops the audio when Opus is not supported', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))
    webcodecs.audio.answer = () => false

    await run()

    expect(warns).toHaveBeenCalledWith('Opus not supported, exporting without audio')
    expect(lastMediabunnyOutput().tracks.map((t) => t.kind)).toEqual(['video'])
    expect(webcodecs.audioEncoders).toHaveLength(0)
  })

  it('drops the audio when the Opus support probe throws', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))
    webcodecs.audio.answer = () => Promise.reject(new Error('probe blew up'))

    await run()

    expect(warns).toHaveBeenCalledWith(
      'Failed to check Opus support, exporting without audio:',
      expect.objectContaining({ message: 'probe blew up' })
    )
    expect(lastMediabunnyOutput().tracks.map((t) => t.kind)).toEqual(['video'])
  })
})
