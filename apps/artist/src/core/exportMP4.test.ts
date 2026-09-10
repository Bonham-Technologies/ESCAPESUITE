// The MP4 export pipeline, driven end to end: real storage (fake-indexeddb),
// real frame manager and HTMLVideoElement frame source, real canvas renderer,
// real animation engine. The doubles stand in only for what jsdom has no
// implementation of — WebCodecs encoders, VideoFrame, the media elements and
// the 2D context — plus mediabunny, which would otherwise write a real
// container, and the audio mixer, whose own behaviour is covered next door.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4, ExportError } from './exportMP4'
import { ExportAbortedError } from './exportTypes'
import { extractAndMixAudioWithWorker } from './audioMixer'
import { storeVideo } from './storage'
import { clearAnimationCache } from '../utils/animation'
import {
  fromEncodedChunk,
  getMediabunnyState,
  lastMediabunnyOutput,
  resetMediabunnyDouble,
} from '../test/doubles/mediabunny'
import {
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
} from '../test/fixtures/exportPipeline'
import type { Clip, ExportOptions, ExportProgress, SourceVideo, Track } from '../store/types'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('./audioMixer', () => ({
  extractAndMixAudioWithWorker: vi.fn(async () => null),
}))

const mixAudio = vi.mocked(extractAndMixAudioWithWorker)

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
  clearAnimationCache()
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
  clearAnimationCache()
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
    const firstFrame = methods.slice(0, methods.indexOf('fillRect', 1))
    expect(firstFrame.indexOf('drawImage')).toBeLessThan(firstFrame.indexOf('ellipse'))
    expect(firstFrame.indexOf('ellipse')).toBeLessThan(firstFrame.indexOf('fillText'))
    expect(ctx().argsFor('fillText')[0][0]).toBe('Overlay')
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
