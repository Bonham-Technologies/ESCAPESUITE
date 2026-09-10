// The export worker runs inside a Web Worker in production, but it is a plain
// module that talks to `self` — so importing it in jsdom (where `self` is the
// window) and driving `self.onmessage` directly exercises the real message
// protocol. Everything it computes is its own: it deliberately duplicates the
// animation and timeline logic so the worker has no DOM imports.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import './exportWorker'
import type { AudioClipMeta, FrameRenderData, WorkerRequest, WorkerResponse } from './exportWorker'
import {
  createAudioBufferDouble,
  installOfflineAudioContextDouble,
  type AudioBufferDouble,
  type OfflineAudioContextDoubles,
} from '../test/doubles/audio'
import { makeAnimation, makeClip, makeTrack } from '../test/fixtures/exportPipeline'
import type { AnimationPresetType, Clip, EasingType, Track } from '../store/types'

const SAMPLE_RATE = 48000

let posted: WorkerResponse[] = []
let transfers: unknown[] = []
let closed = 0
let handler: (event: { data: WorkerRequest }) => Promise<void>

beforeAll(() => {
  // The module registered its handler at import time; capture it before the
  // stubs below replace anything else on `self`.
  handler = self.onmessage as unknown as typeof handler
  expect(typeof handler).toBe('function')
})

beforeEach(() => {
  posted = []
  transfers = []
  closed = 0
  vi.spyOn(self, 'postMessage').mockImplementation(((message: WorkerResponse, options?: unknown) => {
    posted.push(message)
    transfers.push(options)
  }) as typeof self.postMessage)
  vi.spyOn(self, 'close').mockImplementation(() => {
    closed += 1
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const send = (request: WorkerRequest) => handler({ data: request })

const only = <T extends WorkerResponse['type']>(type: T) =>
  posted.filter((m) => m.type === type) as Extract<WorkerResponse, { type: T }>[]

async function init(clips: Clip[], tracks: Track[], totalDuration = 10): Promise<void> {
  await send({ type: 'INIT', clips, tracks, totalDuration })
}

async function frameAt(time: number): Promise<FrameRenderData> {
  posted = []
  await send({ type: 'COMPUTE_FRAME', frameTime: time })
  const [metadata] = only('FRAME_METADATA')
  return metadata.data
}

describe('INIT', () => {
  it('acknowledges the timeline it was given', async () => {
    await init([makeClip()], [makeTrack()])

    expect(posted).toEqual([{ type: 'INIT_COMPLETE' }])
  })
})

describe('TERMINATE', () => {
  it('closes the worker', async () => {
    await send({ type: 'TERMINATE' })

    expect(closed).toBe(1)
    expect(posted).toEqual([])
  })
})

describe('errors', () => {
  it('reports a failure back to the main thread instead of dying', async () => {
    // A clip with no transition is malformed; the frame computation trips on it.
    const broken = { ...makeClip(), transition: undefined } as unknown as Clip
    await init([broken], [makeTrack()])
    posted = []

    await send({ type: 'COMPUTE_FRAME', frameTime: 0 })

    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe('ERROR')
  })
})

describe('COMPUTE_FRAME clip selection', () => {
  it('returns the clips covering the frame time, with their clip-relative time', async () => {
    await init(
      [
        makeClip({ id: 'a', timelinePosition: 0, duration: 2, endTime: 2, startTime: 5 }),
        makeClip({ id: 'b', timelinePosition: 5, duration: 2, endTime: 2 }),
      ],
      [makeTrack()]
    )

    const data = await frameAt(1)

    expect(data.frameTime).toBe(1)
    expect(data.clips.map((c) => c.clipId)).toEqual(['a'])
    expect(data.clips[0]).toMatchObject({ clipTime: 1, sourceTime: 6, trackId: 'track1' })
  })

  it('excludes a clip that ends exactly at the frame time', async () => {
    await init([makeClip({ timelinePosition: 0, duration: 2, endTime: 2 })], [makeTrack()])

    expect((await frameAt(2)).clips).toEqual([])
  })

  it('excludes clips on a hidden track', async () => {
    await init([makeClip()], [makeTrack({ visible: false })])

    expect((await frameAt(1)).clips).toEqual([])
  })

  it('excludes clips whose track is gone', async () => {
    await init([makeClip({ trackId: 'nowhere' })], [makeTrack()])

    expect((await frameAt(1)).clips).toEqual([])
  })

  it('orders clips bottom track first', async () => {
    await init(
      [
        makeClip({ id: 'top', trackId: 'track2' }),
        makeClip({ id: 'bottom', trackId: 'track1' }),
      ],
      [makeTrack({ id: 'track1', index: 0 }), makeTrack({ id: 'track2', index: 5 })]
    )

    expect((await frameAt(1)).clips.map((c) => c.clipId)).toEqual(['bottom', 'top'])
  })

  it('passes overlay content straight through', async () => {
    const textData = { text: 'Hi' }
    await init(
      [
        makeClip({
          id: 'overlay',
          sourceVideoId: '',
          overlayType: 'text',
          textData: textData as Clip['textData'],
        }),
      ],
      [makeTrack()]
    )

    expect((await frameAt(1)).clips[0]).toMatchObject({
      isOverlay: true,
      overlayType: 'text',
      textData,
    })
  })
})

describe('COMPUTE_FRAME animation', () => {
  const animatedClip = (animation: Clip['animation'], overrides: Partial<Clip> = {}) =>
    makeClip({ duration: 4, endTime: 4, animation, ...overrides })

  /** An in-preset of the given type over `duration` seconds, and nothing else. */
  const inPreset = (type: string, duration = 2) =>
    makeAnimation({ in: { type: type as AnimationPresetType, duration, easing: 'linear' } })

  it('uses the clip transform untouched when there is no animation', async () => {
    await init(
      [makeClip({ transform: { x: 0.25, y: 0.75, scaleX: 2, scaleY: 3, rotation: 45, opacity: 0.5 } })],
      [makeTrack()]
    )

    expect((await frameAt(1)).clips[0]).toMatchObject({
      transform: { x: 0.25, y: 0.75, scaleX: 2, scaleY: 3, rotation: 45, opacity: 0.5 },
      opacity: 0.5,
      blur: 0,
    })
  })

  it('fades in over the in-animation duration', async () => {
    await init(
      [animatedClip(inPreset('fade'))],
      [makeTrack()]
    )

    expect((await frameAt(0.5)).clips[0].opacity).toBeCloseTo(0.25, 6)
    expect((await frameAt(3)).clips[0].opacity).toBe(1) // past the in animation
  })

  it('fades out over the out-animation duration', async () => {
    await init(
      [
        animatedClip(
          makeAnimation({ out: { type: 'fade', duration: 2, easing: 'linear' } })
        ),
      ],
      [makeTrack()]
    )

    expect((await frameAt(3)).clips[0].opacity).toBeCloseTo(0.5, 6)
  })

  it('slides in from each direction', async () => {
    const cases: Array<[string, 'x' | 'y', number]> = [
      ['slide-left', 'x', 0.25],
      ['slide-right', 'x', 0.75],
      ['slide-up', 'y', 0.25],
      ['slide-down', 'y', 0.75],
    ]

    for (const [type, axis, expected] of cases) {
      await init([animatedClip(inPreset(type))], [makeTrack()])
      expect((await frameAt(1)).clips[0].transform[axis]).toBeCloseTo(expected, 6)
    }
  })

  it('scales up, scales down and pops', async () => {
    const scaleOf = async (type: string) => {
      await init([animatedClip(inPreset(type))], [makeTrack()])
      return (await frameAt(1)).clips[0].transform.scaleX
    }

    expect(await scaleOf('scale')).toBeCloseTo(0.5, 6)
    expect(await scaleOf('scale-up')).toBeCloseTo(0.5, 6)
    expect(await scaleOf('scale-down')).toBeCloseTo(1.5, 6)
    expect(await scaleOf('pop')).toBeCloseTo(0.55, 6)
  })

  it('blurs in', async () => {
    await init(
      [animatedClip(inPreset('blur'))],
      [makeTrack()]
    )

    expect((await frameAt(1)).clips[0].blur).toBeCloseTo(5, 6)
  })

  it('ignores an unknown preset', async () => {
    await init(
      [animatedClip(inPreset('sparkle'))],
      [makeTrack()]
    )

    expect((await frameAt(1)).clips[0].opacity).toBe(1)
  })

  it('lets keyframes override a preset', async () => {
    await init(
      [
        animatedClip(
          makeAnimation({
            in: { type: 'fade', duration: 2, easing: 'linear' },
            keyframes: {
              opacity: [
                { time: 0, value: 0.2, easing: 'linear' },
                { time: 4, value: 0.2, easing: 'linear' },
              ],
            },
          })
        ),
      ],
      [makeTrack()]
    )

    expect((await frameAt(1)).clips[0].opacity).toBeCloseTo(0.2, 6)
  })

  it('interpolates keyframes with the requested easing', async () => {
    const valueAt = async (easing: string, time: number) => {
      await init(
        [
          animatedClip(
            makeAnimation({
              keyframes: {
                x: [
                  { time: 0, value: 0, easing: easing as EasingType },
                  { time: 4, value: 1, easing: 'linear' },
                ],
              },
            })
          ),
        ],
        [makeTrack()]
      )
      return (await frameAt(time)).clips[0].transform.x
    }

    expect(await valueAt('linear', 2)).toBeCloseTo(0.5, 6)
    expect(await valueAt('ease-in', 2)).toBeCloseTo(0.25, 6)
    expect(await valueAt('ease-out', 2)).toBeCloseTo(0.75, 6)
    expect(await valueAt('ease-in-cubic', 2)).toBeCloseTo(0.125, 6)
    expect(await valueAt('ease-out-cubic', 2)).toBeCloseTo(0.875, 6)
    expect(await valueAt('ease-in-out', 1)).toBeCloseTo(0.125, 6)
    expect(await valueAt('nonsense', 2)).toBeCloseTo(0.5, 6) // falls back to linear
  })

  it('holds the first and last keyframe outside their range', async () => {
    await init(
      [
        animatedClip(
          makeAnimation({
            keyframes: {
              x: [
                { time: 1, value: 0.2, easing: 'linear' },
                { time: 2, value: 0.8, easing: 'linear' },
              ],
            },
          })
        ),
      ],
      [makeTrack()]
    )

    expect((await frameAt(0.5)).clips[0].transform.x).toBe(0.2)
    expect((await frameAt(3)).clips[0].transform.x).toBe(0.8)
  })

  it('animates blur from keyframes', async () => {
    await init(
      [
        animatedClip(
          makeAnimation({
            keyframes: {
              blur: [
                { time: 0, value: 0, easing: 'linear' },
                { time: 4, value: 8, easing: 'linear' },
              ],
            },
          })
        ),
      ],
      [makeTrack()]
    )

    expect((await frameAt(2)).clips[0].blur).toBeCloseTo(4, 6)
  })

  it('ignores an empty keyframe list', async () => {
    await init(
      [animatedClip(makeAnimation({ keyframes: { x: [], blur: [] } }))],
      [makeTrack()]
    )

    expect((await frameAt(1)).clips[0].transform.x).toBe(0.5)
    expect((await frameAt(1)).clips[0].blur).toBe(0)
  })
})

describe('COMPUTE_FRAME transitions', () => {
  const withTransition = (overrides: Partial<Clip> = {}) =>
    makeClip({
      id: 'out',
      timelinePosition: 0,
      duration: 5,
      endTime: 5,
      transition: { type: 'fade', duration: 1 },
      ...overrides,
    })

  it('reports no transition on a plain timeline', async () => {
    await init([makeClip()], [makeTrack()])

    expect((await frameAt(1)).transition).toBeNull()
  })

  it('reports the transition and its progress inside the transition window', async () => {
    await init(
      [withTransition(), makeClip({ id: 'in', timelinePosition: 5, duration: 5, endTime: 5 })],
      [makeTrack()]
    )

    expect((await frameAt(4.5)).transition).toEqual({
      type: 'fade',
      progress: 0.5,
      outgoingClipId: 'out',
      incomingClipId: 'in',
    })
  })

  it('reports nothing before the transition window opens', async () => {
    await init(
      [withTransition(), makeClip({ id: 'in', timelinePosition: 5, duration: 5, endTime: 5 })],
      [makeTrack()]
    )

    expect((await frameAt(3.5)).transition).toBeNull()
  })

  it('ignores a transition with no duration', async () => {
    await init(
      [
        withTransition({ transition: { type: 'fade', duration: 0 } }),
        makeClip({ id: 'in', timelinePosition: 5, duration: 5, endTime: 5 }),
      ],
      [makeTrack()]
    )

    expect((await frameAt(4.5)).transition).toBeNull()
  })

  it('ignores a transition on a hidden track', async () => {
    await init(
      [withTransition(), makeClip({ id: 'in', timelinePosition: 5, duration: 5, endTime: 5 })],
      [makeTrack({ visible: false })]
    )

    expect((await frameAt(4.5)).transition).toBeNull()
  })

  it('reports nothing when nothing follows the outgoing clip', async () => {
    await init([withTransition()], [makeTrack()])

    expect((await frameAt(4.5)).transition).toBeNull()
  })

  it('falls back to the topmost clip on another track', async () => {
    await init(
      [
        withTransition(),
        makeClip({ id: 'mid', trackId: 'track2', timelinePosition: 0, duration: 10, endTime: 10 }),
        makeClip({ id: 'top', trackId: 'track3', timelinePosition: 0, duration: 10, endTime: 10 }),
        makeClip({
          id: 'overlay',
          trackId: 'track4',
          overlayType: 'text',
          timelinePosition: 0,
          duration: 10,
          endTime: 10,
        }),
      ],
      [
        makeTrack({ id: 'track1', index: 0 }),
        makeTrack({ id: 'track2', index: 1 }),
        makeTrack({ id: 'track3', index: 2 }),
        makeTrack({ id: 'track4', index: 3 }),
      ]
    )

    expect((await frameAt(4.5)).transition).toMatchObject({ incomingClipId: 'top' })
  })
})

describe('EXTRACT_AUDIO', () => {
  let offline: OfflineAudioContextDoubles
  let stereo: AudioBufferDouble
  let warn: ReturnType<typeof vi.spyOn>

  const meta = (overrides: Partial<AudioClipMeta> = {}): AudioClipMeta => ({
    sourceIndex: 0,
    clipId: 'a',
    trackId: 'track1',
    trackVolume: 1,
    trackMuted: false,
    sourceStartTime: 0,
    clipDuration: 0.005,
    timelinePosition: 0,
    ...overrides,
  })

  const ramp = (length: number, sign = 1) => {
    const data = new Float32Array(length)
    for (let i = 0; i < length; i++) data[i] = (sign * (i + 1)) / 1000
    return data
  }

  beforeEach(async () => {
    stereo = createAudioBufferDouble([ramp(480), ramp(480, -1)], SAMPLE_RATE)
    offline = installOfflineAudioContextDouble(() => stereo)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 480 samples of timeline.
    await init([], [], 0.01)
    posted = []
  })

  afterEach(() => {
    offline.uninstall()
    warn.mockRestore()
  })

  const extract = async (clipMeta: AudioClipMeta[], blobs = [new ArrayBuffer(8)]) => {
    await send({ type: 'EXTRACT_AUDIO', audioBlobs: blobs, clipMeta })
    return only('AUDIO_READY')[0]
  }

  it('mixes a clip into the timeline buffer and transfers the result', async () => {
    const ready = await extract([meta({ timelinePosition: 0.002, sourceStartTime: 0.001 })])

    expect(ready.hasAudio).toBe(true)
    expect(ready.audioBuffer).toHaveLength(960)
    expect(ready.audioBuffer[96 * 2]).toBeCloseTo(stereo.getChannelData(0)[48], 6)
    expect(ready.audioBuffer[96 * 2 + 1]).toBeCloseTo(stereo.getChannelData(1)[48], 6)
    expect(transfers[transfers.length - 1]).toEqual({ transfer: [ready.audioBuffer.buffer] })
  })

  it('scales each clip by its track volume', async () => {
    const ready = await extract([meta({ trackVolume: 0.25 })])

    expect(ready.audioBuffer[20]).toBeCloseTo(stereo.getChannelData(0)[10] * 0.25, 6)
  })

  it('skips a muted track without decoding it', async () => {
    const ready = await extract([meta({ trackMuted: true })])

    expect(ready.hasAudio).toBe(false)
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('skips a clip whose source blob is missing', async () => {
    const ready = await extract([meta({ sourceIndex: 3 })])

    expect(ready.hasAudio).toBe(false)
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('skips a source that will not decode', async () => {
    offline.decode = () => null

    const ready = await extract([meta()])

    expect(ready.hasAudio).toBe(false)
    expect(offline.decodeCalls).toHaveLength(1)
  })

  it('copies a mono source into both channels', async () => {
    offline.decode = () => createAudioBufferDouble([ramp(480)], SAMPLE_RATE)

    const ready = await extract([meta()])

    expect(ready.audioBuffer[20]).toBeCloseTo(0.011, 6)
    expect(ready.audioBuffer[21]).toBeCloseTo(ready.audioBuffer[20], 6)
  })

  it('drops samples that fall outside the timeline buffer', async () => {
    const ready = await extract([meta({ timelinePosition: 5 })])

    expect(ready.audioBuffer.every((s) => s === 0)).toBe(true)
  })

  it('normalises a mix that would clip', async () => {
    const loud = createAudioBufferDouble(
      [new Float32Array(480).fill(0.9), new Float32Array(480).fill(0.9)],
      SAMPLE_RATE
    )
    offline.decode = () => loud

    const ready = await extract([meta({ clipId: 'a' }), meta({ clipId: 'b' })])

    expect(Math.max(...Array.from(ready.audioBuffer, Math.abs))).toBeCloseTo(0.95, 5)
  })

  it('reports progress once per clip', async () => {
    await extract([meta({ clipId: 'a' }), meta({ clipId: 'b' }), meta({ clipId: 'c' })])

    expect(only('AUDIO_PROGRESS').map((m) => Math.round(m.progress))).toEqual([33, 67, 100])
  })

  it('warns and carries on when reading a decoded buffer blows up', async () => {
    offline.decode = () => ({
      numberOfChannels: 2,
      length: 480,
      sampleRate: SAMPLE_RATE,
      duration: 0.01,
      getChannelData: () => {
        throw new Error('channel exploded')
      },
    })

    const ready = await extract([meta({ clipId: 'a' }), meta({ clipId: 'b' })])

    expect(warn).toHaveBeenCalledWith(
      'Failed to extract audio from clip:',
      expect.objectContaining({ message: 'channel exploded' })
    )
    // The decode itself succeeded, so the run still counts as having audio.
    expect(ready.hasAudio).toBe(true)
    expect(only('AUDIO_PROGRESS')).toHaveLength(2)
  })
})
