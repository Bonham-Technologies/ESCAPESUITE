// The MP4 export pipeline, driven end to end: real storage (fake-indexeddb),
// real frame manager and HTMLVideoElement frame source, real canvas renderer,
// real animation engine. The doubles stand in only for what jsdom has no
// implementation of — WebCodecs encoders, VideoFrame, the media elements and
// the 2D context — plus mediabunny, which would otherwise write a real
// container, and the audio mixer, whose own behaviour is covered next door.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4, ExportError } from './exportMP4'
import { ExportAbortedError } from './exportTypes'
import { extractAndMixAudio } from './audioMixer'
import { storeVideo } from './storage'
import {
  fromEncodedChunk,
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

/** 6 frames at 30fps — enough for a keyframe, progress ticks and an abort. */
const CLIP_DURATION = 0.2
const SAMPLE_RATE = 48000

let media: MediaDoubles
let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let logs: ReturnType<typeof vi.spyOn>
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

/** Stereo interleaved audio covering `seconds` of timeline. */
const audioFor = (seconds: number) => new Float32Array(Math.round(seconds * SAMPLE_RATE) * 2)

async function storeSource(id: string, type = 'video/mp4'): Promise<void> {
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
  return exportToMP4(
    clips,
    sources,
    makeExportOptions(options),
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
  logs = vi.spyOn(console, 'log').mockImplementation(() => {})
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await storeSource('video1')
})

afterEach(() => {
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  logs.mockRestore()
  warns.mockRestore()
  errors.mockRestore()
})

describe('exportToMP4 preconditions', () => {
  it('refuses to run without WebCodecs', async () => {
    const restore = removeWebCodecsGlobals()

    await expect(run()).rejects.toThrow('MP4 export requires WebCodecs API (Chrome/Edge)')

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

describe('exportToMP4 muxing', () => {
  it('produces an MP4 blob carrying the muxed bytes', async () => {
    const blob = await run()

    expect(blob.type).toBe('video/mp4')
    expect(blob.size).toBe(128)
  })

  it('muxes an in-memory fast-start MP4 with one AVC video track', async () => {
    await run()

    const output = lastMediabunnyOutput()
    expect(output.format).toMatchObject({ name: 'mp4', options: { fastStart: 'in-memory' } })
    expect(output.tracks).toHaveLength(1)
    expect(output.tracks[0]).toMatchObject({ kind: 'video', options: { frameRate: 30 } })
    expect(getMediabunnyState().videoSources[0].codec).toBe('avc')
  })

  it('starts the output before encoding and finalizes it after', async () => {
    await run()

    expect(getMediabunnyState().callLog).toEqual([
      'Output.addVideoTrack',
      'Output.start',
      'Output.finalize',
    ])
  })

  it('adds one packet per frame, with a keyframe first', async () => {
    await run()

    const packets = getMediabunnyState().videoSources[0].packets
    expect(packets).toHaveLength(6)
    // Each packet wraps the chunk the encoder emitted for that frame.
    expect(fromEncodedChunk).toHaveBeenCalledTimes(6)
    expect(packets.map((p) => (p.packet as { chunk: unknown }).chunk)).toEqual(
      webcodecs.videoEncoders[0].emitted
    )
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

  it('fails when the muxer wrote no bytes', async () => {
    getMediabunnyState().producesBuffer = false

    await expect(run()).rejects.toThrow('Export failed: no data was written to buffer')
  })
})

describe('exportToMP4 codec selection', () => {
  it('prefers High Profile Level 4.0 on hardware', async () => {
    await run()

    expect(webcodecs.encoder.configs).toHaveLength(1)
    expect(webcodecs.encoder.configs[0]).toMatchObject({
      codec: 'avc1.640028',
      hardwareAcceleration: 'prefer-hardware',
      width: 640,
      height: 360,
      framerate: 30,
      latencyMode: 'quality',
    })
    expect(logs).toHaveBeenCalledWith('[MP4 Export] Using H.264 codec: avc1.640028 (prefer-hardware)')
  })

  it('falls down the profile ladder when the best profile is unsupported', async () => {
    webcodecs.encoder.answer = (c) => c.codec === 'avc1.42001f'

    await run()

    expect((webcodecs.encoder.configs as Array<{ codec: string }>).map((c) => c.codec)).toEqual([
      'avc1.640028',
      'avc1.4d0028',
      'avc1.42001f',
    ])
    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ codec: 'avc1.42001f' })
  })

  it('reaches Level 5.1 for frames larger than 1080p', async () => {
    // Level 4.0 tops out at 1920x1080, so a 4K export needs the 5.1 profiles.
    webcodecs.encoder.answer = (c) => c.codec.endsWith('0033')

    await run({ sources: [makeSourceVideo({ width: 3840, height: 2160 })] })

    expect((webcodecs.encoder.configs as Array<{ codec: string }>).map((c) => c.codec)).toEqual([
      'avc1.640028',
      'avc1.4d0028',
      'avc1.42001f',
      'avc1.640033',
    ])
    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({
      codec: 'avc1.640033',
      width: 3840,
      height: 2160,
    })
  })

  it('makes a second pass without hardware acceleration before giving up', async () => {
    webcodecs.encoder.answer = (c) =>
      (c as VideoEncoderConfig).hardwareAcceleration === 'no-preference'

    await run()

    const configs = webcodecs.encoder.configs as VideoEncoderConfig[]
    expect(configs).toHaveLength(6) // all five hardware probes, then the first software one
    expect(configs.slice(0, 5).every((c) => c.hardwareAcceleration === 'prefer-hardware')).toBe(true)
    expect(configs[5]).toMatchObject({
      codec: 'avc1.640028',
      hardwareAcceleration: 'no-preference',
    })
  })

  it('skips a codec whose support probe throws', async () => {
    webcodecs.encoder.answer = (c) =>
      c.codec === 'avc1.640028' ? Promise.reject(new Error('probe blew up')) : true

    await run()

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ codec: 'avc1.4d0028' })
  })

  it('gives up when no H.264 profile is supported at all', async () => {
    webcodecs.encoder.answer = () => false

    await expect(run()).rejects.toThrow(
      'No supported H.264 codec found. MP4 export requires H.264 support.'
    )
    expect(webcodecs.encoder.configs).toHaveLength(10) // 5 profiles x 2 acceleration modes
  })

  it('encodes at the requested resolution and quality bitrate', async () => {
    await run({ options: { resolution: '720p', quality: 'high' } })

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({
      width: 1280,
      height: 720,
      bitrate: 10_000_000,
    })
  })

  it('encodes at the project resolution when asked for it', async () => {
    await run({
      options: { resolution: 'project' },
      projectResolution: { width: 1024, height: 768 },
    })

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ width: 1024, height: 768 })
  })
})

describe('exportToMP4 audio', () => {
  it('exports without an audio track when the mixer found no audio', async () => {
    await run()

    expect(lastMediabunnyOutput().tracks.map((t) => t.kind)).toEqual(['video'])
    expect(webcodecs.audio.configs).toHaveLength(0)
    expect(webcodecs.audioEncoders).toHaveLength(0)
  })

  it('adds an AAC track and encodes the mix in one-second chunks', async () => {
    mixAudio.mockResolvedValue(audioFor(1.5))

    await run()

    expect(lastMediabunnyOutput().tracks.map((t) => t.kind)).toEqual(['video', 'audio'])
    expect(getMediabunnyState().audioSources[0].codec).toBe('aac')
    expect(webcodecs.audioEncoders[0].configs[0]).toMatchObject({
      codec: 'mp4a.40.2',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate: 192_000,
    })
    // 1.5s of audio = two chunks: a full second and a half second.
    expect(webcodecs.audioEncoders[0].encodes).toEqual([
      { timestamp: 0, numberOfFrames: SAMPLE_RATE },
      { timestamp: 1_000_000, numberOfFrames: SAMPLE_RATE / 2 },
    ])
    expect(getMediabunnyState().audioSources[0].packets).toHaveLength(2)
  })

  it('deinterleaves each chunk into planar float data and closes it', async () => {
    const mix = audioFor(0.5)
    mix[0] = 0.25 // left, sample 0
    mix[1] = -0.25 // right, sample 0
    mix[2] = 0.5 // left, sample 1
    mixAudio.mockResolvedValue(mix)

    await run()

    const data = webcodecs.audioData[0]
    expect(data.format).toBe('f32-planar')
    expect(data.numberOfFrames).toBe(SAMPLE_RATE / 2)
    expect(data.data[0]).toBeCloseTo(0.25, 6)
    expect(data.data[1]).toBeCloseTo(0.5, 6)
    expect(data.data[data.numberOfFrames]).toBeCloseTo(-0.25, 6)
    expect(webcodecs.audioData.every((d) => d.closed)).toBe(true)
  })

  it('scales the AAC bitrate with the quality setting', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))

    await run({ options: { quality: 'low' } })

    expect(webcodecs.audio.configs[0]).toMatchObject({ bitrate: 128_000 })
  })

  it('drops the audio when AAC is not supported', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))
    webcodecs.audio.answer = () => false

    await run()

    expect(warns).toHaveBeenCalledWith('AAC not supported, exporting without audio')
    expect(lastMediabunnyOutput().tracks.map((t) => t.kind)).toEqual(['video'])
    expect(webcodecs.audioEncoders).toHaveLength(0)
  })

  it('drops the audio when the AAC support probe throws', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))
    webcodecs.audio.answer = () => Promise.reject(new Error('probe blew up'))

    await run()

    expect(warns).toHaveBeenCalledWith(
      'Failed to check AAC support, exporting without audio:',
      expect.objectContaining({ message: 'probe blew up' })
    )
    expect(lastMediabunnyOutput().tracks.map((t) => t.kind)).toEqual(['video'])
  })

  it('mixes the whole timeline even when only part of it is exported', async () => {
    mixAudio.mockResolvedValue(audioFor(1))
    const clips = [makeClip({ duration: 1, endTime: 1 })]

    await run({ clips, options: { timeRange: { start: 0.5, end: 0.7 } } })

    expect(mixAudio).toHaveBeenCalledWith(clips, expect.any(Array), 1, expect.any(Function))
  })
})

describe('exportToMP4 time range', () => {
  it('encodes only the selected range, restamped from zero', async () => {
    const clips = [makeClip({ duration: 1, endTime: 1 })]

    await run({ clips, options: { timeRange: { start: 0.5, end: 0.6 } } })

    const encodes = webcodecs.videoEncoders[0].encodes
    expect(encodes).toHaveLength(3)
    expect(encodes.map((e) => e.timestamp)).toEqual([0, 33333, 66667])
  })

  it('slices the mixed audio down to the selected range', async () => {
    const mix = audioFor(1)
    // Mark the first sample of the second half-second, so the slice is visible.
    mix[Math.floor(0.5 * SAMPLE_RATE) * 2] = 0.75
    mixAudio.mockResolvedValue(mix)
    const clips = [makeClip({ duration: 1, endTime: 1 })]

    await run({ clips, options: { timeRange: { start: 0.5, end: 1 } } })

    expect(webcodecs.audioData[0].numberOfFrames).toBe(SAMPLE_RATE / 2)
    expect(webcodecs.audioData[0].data[0]).toBeCloseTo(0.75, 6)
  })
})

describe('exportToMP4 rendering', () => {
  it('clears each frame to black before compositing', async () => {
    await run()

    const fills = ctx().argsFor('fillRect')
    expect(fills).toHaveLength(6)
    expect(fills[0]).toEqual([0, 0, 640, 360])
    expect(ctx().stateFor('fillRect')[0].fillStyle).toBe('#000000')
  })

  it('draws the decoded video frame for each timeline frame', async () => {
    await run()

    expect(ctx().argsFor('drawImage')).toHaveLength(6)
    expect(ctx().argsFor('drawImage')[0][0]).toBe(media.videos[0])
  })

  it('seeks the source to the clip trim offset, skipping seeks within one frame', async () => {
    await run({
      clips: [makeClip({ startTime: 2, duration: CLIP_DURATION, endTime: 2 + CLIP_DURATION })],
    })

    // The frame source leaves the element alone while the request is within one
    // frame of where it already is, so only every other frame seeks.
    expect(media.seeks).toEqual([2, 2 + 2 / 30, 2 + 4 / 30])
  })

  it('draws an image source without a frame source', async () => {
    await storeSource('image1', 'image/png')
    const sources = [makeSourceVideo({ id: 'image1', mediaType: 'image' })]

    await run({ clips: [makeClip({ sourceVideoId: 'image1', duration: CLIP_DURATION, endTime: CLIP_DURATION })], sources })

    expect(media.images).toHaveLength(1)
    expect(ctx().argsFor('drawImage')[0][0]).toBe(media.images[0])
  })

  it('falls back to a single default track when the caller supplies none', async () => {
    await exportToMP4(
      [makeClip({ trackId: 'default', duration: CLIP_DURATION, endTime: CLIP_DURATION })],
      [makeSourceVideo({ width: 640, height: 360 })],
      makeExportOptions(),
      vi.fn()
    )

    expect(ctx().argsFor('drawImage')).toHaveLength(6)
  })

  it('never loads an audio-only source as video', async () => {
    await storeSource('audio1', 'audio/mp3')
    const sources = [makeSourceVideo({ id: 'audio1', mediaType: 'audio' })]

    await run({ clips: [makeClip({ sourceVideoId: 'audio1', duration: CLIP_DURATION, endTime: CLIP_DURATION })], sources })

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

    // Each frame of the transition draws the outgoing clip and the incoming one.
    expect(ctx().argsFor('drawImage')).toHaveLength(6)
    const alphas = ctx().stateFor('drawImage').map((s) => s.globalAlpha)
    expect(alphas[0]).toBe(1)
    expect(alphas[1]).toBe(0)
  })

  it('closes every VideoFrame it captured from the canvas', async () => {
    await run()

    expect(allFramesClosed()).toBe(true)
  })
})

// ESCSUITE-94, the MP4 half of it. Same claim as `exportWebM.test.ts`'s
// "output raster" block, over the pipeline that draws decoded frames rather
// than media elements: the canvas is the size of the output, the drawing is in
// project pixels, and one transform per frame joins them.
describe('exportToMP4 output raster', () => {
  it('scales the project onto a larger preset raster instead of pillarboxing it', async () => {
    media.script({ video: { videoWidth: 1280, videoHeight: 720 } })

    await run({
      sources: [makeSourceVideo({ width: 1280, height: 720 })],
      options: { resolution: '1080p' },
      projectResolution: { width: 1280, height: 720 },
    })

    expect(webcodecs.videoEncoders[0].configs[0]).toMatchObject({ width: 1920, height: 1080 })
    expect(ctx().argsFor('setTransform')[0]).toEqual([1.5, 0, 0, 1.5, 0, 0])
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

    expect(ctx().argsFor('setTransform')[0]).toEqual([0.5, 0, 0, 0.5, 0, 0])
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

    // The x offset is 1/3 of an output pixel arrived at through division, not
    // the literal — close-enough rather than exact avoids pinning a specific
    // float rounding artifact that isn't the point of this test.
    const transform = ctx().argsFor('setTransform')[0]
    expect(transform.slice(0, 4)).toEqual([2 / 3, 0, 0, 2 / 3])
    expect(transform[4]).toBeCloseTo(1 / 3, 9)
    expect(transform[5]).toBe(0)
    // The clear is the whole raster in project coordinates: 1281x720 (854 /
    // (2/3)), centred half a project-pixel either side of the 1280-wide frame.
    const fillRect = ctx().argsFor('fillRect')[0]
    expect(fillRect[0]).toBeCloseTo(-0.5, 9)
    expect(fillRect.slice(1)).toEqual([0, 1281, 720])
  })

  it('asks for a dissolve blur in output pixels, not in project pixels', async () => {
    // The frame-based transition path used to say, in a comment, that "an
    // export's canvas is always its own project" — which is the premise this
    // ticket falsified. A dissolve's blur is 3px at its midpoint in project
    // space, so 4.5 device pixels of a 1080p raster over a 720p project.
    await storeSource('video2')
    media.script({ video: { videoWidth: 1280, videoHeight: 720 } })
    const clips = [
      makeClip({
        id: 'a',
        duration: 0.2,
        endTime: 0.2,
        timelinePosition: 0,
        transition: { type: 'dissolve', duration: 0.2 },
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
      makeSourceVideo({ width: 1280, height: 720 }),
      makeSourceVideo({ id: 'video2', width: 1280, height: 720 }),
    ]

    await run({
      clips,
      sources,
      options: { resolution: '1080p', timeRange: { start: 0.1, end: 0.14 } },
      projectResolution: { width: 1280, height: 720 },
    })

    expect(ctx().stateFor('drawImage')[0].filter).toBe('blur(4.5px)')
  })
})

describe('exportToMP4 progress', () => {
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

  // ESCSUITE-153 / ESCSUITE-29 Mechanism 2 review (MINOR-4): the dialog's own
  // copy promises background-tab MP4 encoding, which is only true when
  // WebCodecs actually decoded the export. jsdom has neither Worker nor
  // VideoDecoder, so isWebCodecsAvailable() is false throughout this file —
  // exactly the "fell back to <video> decoding" case the message is for.
  it('tells the user it fell back to in-page decoding when WebCodecs is unavailable', async () => {
    const progress: ExportProgress[] = []

    await run({ onProgress: (p) => progress.push(p) })

    expect(progress).toContainEqual({
      phase: 'preparing',
      progress: 12,
      message: 'Decoding in the page; keep this tab in the foreground',
    })
  })
})

describe('exportToMP4 failure handling', () => {
  it('aborts mid-encode and closes the encoders', async () => {
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

  it('aborts during audio encoding', async () => {
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

  it('retries a failed frame as a keyframe', async () => {
    webcodecs.script.failVideoEncodeAt = [0]

    await run()

    const encodes = webcodecs.videoEncoders[0].encodes
    expect(encodes).toHaveLength(6)
    expect(encodes[0].keyFrame).toBe(true)
  })

  it('reports the frame it died on when the retry also fails', async () => {
    webcodecs.script.failVideoEncodeAt = [0, 1]

    const error = await run().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    const exportError = error as ExportError
    expect(exportError.message).toBe('Export failed at frame 0/6')
    expect(exportError.frameIndex).toBe(0)
    expect(exportError.totalFrames).toBe(6)
    expect(exportError.exportLog.map((e) => e.phase)).toContain('fatal')
    expect(allFramesClosed()).toBe(true)
  })

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
  // the threshold (5), which this suite's 6-frame fixture never naturally
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
        webcodecs.videoEncoders[0].encodeQueueSize = 10
      }
    })

    const error = (await run({ clips, onProgress }).catch((e: unknown) => e)) as ExportError

    expect(error).toBeInstanceOf(ExportError)
    expect(error.message).toBe('video encoder failed')
    expect(
      error.exportLog.some((e) => e.detail === 'Encoder error during backpressure: video encoder failed')
    ).toBe(true)
  })

  it('wraps a muxer failure in an ExportError carrying the log', async () => {
    getMediabunnyState().finalizeError = new Error('muxer exploded')

    const error = (await run().catch((e: unknown) => e)) as ExportError

    expect(error).toBeInstanceOf(ExportError)
    expect(error.message).toBe('muxer exploded')
    expect(error.frameIndex).toBe(6)
    expect(error.exportLog[0]).toMatchObject({ phase: 'init' })
    expect(webcodecs.videoEncoders[0].state).toBe('closed')
  })
})
