// The WebM export pipeline. Unlike the MP4 path this one seeks HTMLVideoElements
// directly and has no codec ladder, so the interesting behaviour is the frame
// loop, the VP9/Opus muxing, and what it does when things go wrong. Real
// storage, real canvas renderer, real animation engine; doubles for WebCodecs,
// the media elements, the 2D context, mediabunny and the audio mixer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToWebM } from './exportWebM'
import { ExportAbortedError } from './exportTypes'
import { extractAndMixAudioWithWorker } from './audioMixer'
import { storeVideo } from './storage'
import { clearAnimationCache } from '../utils/animation'
import {
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
  clearAnimationCache()
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
  clearAnimationCache()
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

  it('releases the object URLs it created for the media', async () => {
    const revoke = vi.mocked(URL.revokeObjectURL)
    revoke.mockClear()

    await run()

    expect(revoke).toHaveBeenCalled()
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

  it('rethrows a muxer failure as-is, after closing the encoder', async () => {
    getMediabunnyState().finalizeError = new Error('muxer exploded')

    await expect(run()).rejects.toThrow('muxer exploded')
    expect(webcodecs.videoEncoders[0].state).toBe('closed')
  })

  it('logs an encoder error without failing the export', async () => {
    webcodecs.script.videoErrorAfterEncodes = 2

    const blob = await run()

    expect(errors).toHaveBeenCalledWith('Video encoder error:', expect.any(Error))
    expect(blob.size).toBe(128)
  })

  it('logs an audio encoder error without failing the export', async () => {
    mixAudio.mockResolvedValue(audioFor(0.2))
    webcodecs.script.audioErrorAfterEncodes = 1

    const blob = await run()

    expect(errors).toHaveBeenCalledWith('Audio encoder error:', expect.any(Error))
    expect(blob.size).toBe(128)
  })
})
