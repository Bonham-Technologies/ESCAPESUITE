// The audio mixer decodes each clip's source, mixes it into one stereo
// interleaved timeline buffer, and normalises the result. Everything here runs
// the real mixing loop against real IndexedDB (fake-indexeddb) and the real
// keyframe interpolator; only the browser APIs jsdom lacks — OfflineAudioContext
// and the bundled export Worker — are doubles.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractAndMixAudio, extractAndMixAudioWithWorker } from './audioMixer'
import { storeVideo } from './storage'
import { resetWorkerSupportCache } from '../utils/workerSupport'
import {
  createAudioBufferDouble,
  installOfflineAudioContextDouble,
  type AudioBufferDouble,
  type OfflineAudioContextDoubles,
} from '../test/doubles/audio'
import { installWorkerDouble, type WorkerDouble } from '../test/doubles/worker'
import {
  scriptedWorkerState,
  resetScriptedWorker,
  type ScriptedWorkerInstance,
} from '../test/doubles/worker'
import { removeGlobal } from '../test/doubles/globals'
import {
  makeAnimation,
  makeClip,
  makeSourceVideo,
  makeTrack,
} from '../test/fixtures/exportPipeline'
import type { Clip } from '../store/types'

vi.mock('../workers/exportWorker?worker', async () => {
  const { createScriptedWorkerModule } = await import('../test/doubles/worker')
  return createScriptedWorkerModule()
})

const SAMPLE_RATE = 48000
/** 480 samples of timeline — small enough to assert on sample by sample. */
const TOTAL_DURATION = 0.01

/**
 * Fake only setTimeout/clearTimeout. The mixer's worker timeouts are the point
 * of these tests, but fake-indexeddb and the worker double both need real
 * microtasks and real immediates to make progress.
 */
function useTimeoutFakes(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

/** Sample index n of the timeline, in the interleaved output buffer. */
const at = (sample: number, channel: 0 | 1) => sample * 2 + channel

function ramp(length: number, sign = 1): Float32Array {
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = (sign * (i + 1)) / 1000
  return data
}

/** A ramp loud enough that a few stacked copies exceed full scale. */
function loudRamp(length: number): Float32Array {
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = (i + 1) / 250
  return data
}

/** Store a source video whose blob is `bytes` bytes long, so decodes can be told apart. */
async function storeSource(id: string, bytes: number): Promise<void> {
  await storeVideo(id, new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), {
    ...makeSourceVideo({ id }),
    size: bytes,
  })
}

describe('extractAndMixAudio', () => {
  let offline: OfflineAudioContextDoubles
  let stereo: AudioBufferDouble
  let warn: ReturnType<typeof vi.spyOn>
  let patchedBlobRead: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(async () => {
    patchedBlobRead = null
    stereo = createAudioBufferDouble([ramp(480), ramp(480, -1)], SAMPLE_RATE)
    offline = installOfflineAudioContextDouble(() => stereo)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await storeSource('video1', 16)
  })

  afterEach(() => {
    // Restore here, not at the end of the test body: a failing assertion must
    // not leave the patched prototype behind for the next test.
    patchedBlobRead?.mockRestore()
    offline.uninstall()
    warn.mockRestore()
  })

  it('sizes the render context and the output buffer from the timeline duration', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(offline.constructions).toEqual([
      { numberOfChannels: 2, length: 480, sampleRate: SAMPLE_RATE },
    ])
    expect(mixed).not.toBeNull()
    expect(mixed!.length).toBe(960)
  })

  it('writes the clip at its timeline position, reading from its trim start', async () => {
    // 0.002s in on the timeline (sample 96), starting 0.001s into the source
    // (sample 48), for 0.005s (240 samples).
    const clip = makeClip({
      timelinePosition: 0.002,
      startTime: 0.001,
      duration: 0.005,
      endTime: 0.006,
    })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed[at(95, 0)]).toBe(0) // before the clip: silence
    expect(mixed[at(96, 0)]).toBeCloseTo(stereo.getChannelData(0)[48], 6)
    expect(mixed[at(96, 1)]).toBeCloseTo(stereo.getChannelData(1)[48], 6)
    expect(mixed[at(200, 0)]).toBeCloseTo(stereo.getChannelData(0)[152], 6)
    expect(mixed[at(335, 0)]).toBeCloseTo(stereo.getChannelData(0)[287], 6)
    expect(mixed[at(336, 0)]).toBe(0) // one past the last mixed sample
  })

  it('scales every sample by the track volume', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const full = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!
    const half = (await extractAndMixAudio(
      [clip],
      [makeTrack({ volume: 0.5 })],
      TOTAL_DURATION,
      vi.fn()
    ))!

    expect(half[at(10, 0)]).toBeCloseTo(full[at(10, 0)] * 0.5, 6)
    expect(half[at(10, 1)]).toBeCloseTo(full[at(10, 1)] * 0.5, 6)
  })

  it('treats a track with no volume set as full volume', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })
    const track = makeTrack()
    delete (track as Partial<typeof track>).volume

    const mixed = (await extractAndMixAudio([clip], [track], TOTAL_DURATION, vi.fn()))!

    expect(mixed[at(10, 0)]).toBeCloseTo(stereo.getChannelData(0)[10], 6)
  })

  it('skips a muted track entirely, without decoding its source', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio(
      [clip],
      [makeTrack({ muted: true })],
      TOTAL_DURATION,
      vi.fn()
    )

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('mixes a clip whose track is missing at full volume', async () => {
    const clip = makeClip({ trackId: 'gone', duration: 0.005, endTime: 0.005 })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed[at(10, 0)]).toBeCloseTo(stereo.getChannelData(0)[10], 6)
  })

  it('copies a mono source into both channels', async () => {
    offline.decode = () => createAudioBufferDouble([ramp(480)], SAMPLE_RATE)
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed[at(10, 0)]).toBeCloseTo(0.011, 6)
    expect(mixed[at(10, 1)]).toBeCloseTo(mixed[at(10, 0)], 6)
  })

  it('applies volume keyframes per sample on top of the track volume', async () => {
    const clip: Clip = makeClip({
      duration: 0.005,
      endTime: 0.005,
      animation: makeAnimation({
        keyframes: {
          volume: [
            { time: 0, value: 0, easing: 'linear' },
            { time: 0.005, value: 1, easing: 'linear' },
          ],
        },
      }),
    })

    const mixed = (await extractAndMixAudio(
      [clip],
      [makeTrack({ volume: 0.5 })],
      TOTAL_DURATION,
      vi.fn()
    ))!

    const source = stereo.getChannelData(0)
    expect(mixed[at(0, 0)]).toBeCloseTo(0, 6) // ramp starts at volume 0
    // Half way through the clip (sample 120 of 240) the keyframe ramp is at 0.5,
    // and the track is at 0.5 on top of that.
    expect(mixed[at(120, 0)]).toBeCloseTo(source[120] * 0.5 * 0.5, 5)
    expect(mixed[at(239, 0)]).toBeCloseTo(source[239] * 0.5 * (239 / 240), 5)
  })

  it('sums overlapping clips and normalises the peak back under 1', async () => {
    await storeSource('video2', 32)
    // Each ramp peaks at 0.96, so four stacked copies clip well past 1.
    const loud = createAudioBufferDouble([loudRamp(480), loudRamp(480)], SAMPLE_RATE)
    offline.decode = () => loud
    const clips = [
      makeClip({ id: 'a', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'b', sourceVideoId: 'video2', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'c', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'd', sourceVideoId: 'video2', duration: 0.005, endTime: 0.005 }),
    ]

    const mixed = (await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn()))!

    const peak = Math.max(...Array.from(mixed, Math.abs))
    expect(peak).toBeCloseTo(0.95, 5)
    // Normalisation is a single uniform scale, so the shape is preserved.
    expect(mixed[at(10, 0)] / mixed[at(20, 0)]).toBeCloseTo(
      loud.getChannelData(0)[10] / loud.getChannelData(0)[20],
      5
    )
  })

  it('leaves audio that never exceeds 1 untouched', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed[at(239, 0)]).toBeCloseTo(stereo.getChannelData(0)[239], 6)
  })

  it('drops samples that fall outside the timeline buffer', async () => {
    const clip = makeClip({ timelinePosition: 0.02, duration: 0.005, endTime: 0.005 })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed.every((s) => s === 0)).toBe(true)
  })

  it('returns null when no clip yielded decodable audio', async () => {
    offline.decode = () => null
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(1)
  })

  it('skips a clip whose source is not in storage', async () => {
    const clip = makeClip({ sourceVideoId: 'missing', duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('warns and carries on when reading a clip blob fails', async () => {
    patchedBlobRead = vi
      .spyOn(Blob.prototype, 'arrayBuffer')
      .mockRejectedValueOnce(new Error('read failed'))
    const clips = [
      makeClip({ id: 'a', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'b', duration: 0.005, endTime: 0.005 }),
    ]

    const mixed = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(warn).toHaveBeenCalledWith(
      'Failed to extract audio from clip:',
      expect.objectContaining({ message: 'read failed' })
    )
    // The second clip still made it into the mix.
    expect(mixed).not.toBeNull()
  })

  it('reports progress once per clip, ending at 100', async () => {
    const onProgress = vi.fn()
    const clips = [
      makeClip({ id: 'a', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'b', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'c', duration: 0.005, endTime: 0.005 }),
    ]

    await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, onProgress)

    expect(onProgress.mock.calls.map((c) => Math.round(c[0]))).toEqual([33, 67, 100])
  })
})

describe('extractAndMixAudioWithWorker', () => {
  let offline: OfflineAudioContextDoubles
  let worker: WorkerDouble
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    resetScriptedWorker()
    resetWorkerSupportCache()
    offline = installOfflineAudioContextDouble(() =>
      createAudioBufferDouble([ramp(480), ramp(480, -1)], SAMPLE_RATE)
    )
    // The real worker-support probe runs against this global Worker double; the
    // bundled export worker itself is the module mock at the top of the file.
    worker = installWorkerDouble({ kind: 'reply', data: 'ok' })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await storeSource('video1', 16)
    await storeSource('video2', 32)
  })

  afterEach(() => {
    // Unconditionally, not at the end of the timeout tests' bodies: a failing
    // assertion must not leak fake timers into the tests that follow.
    vi.useRealTimers()
    worker.uninstall()
    offline.uninstall()
    warn.mockRestore()
    resetWorkerSupportCache()
  })

  it('hands the worker one blob per source and one meta entry per clip', async () => {
    const clips = [
      makeClip({ id: 'a', duration: 1, endTime: 1, timelinePosition: 0 }),
      makeClip({ id: 'b', duration: 1, endTime: 1, timelinePosition: 1 }),
      makeClip({ id: 'c', sourceVideoId: 'video2', duration: 2, endTime: 2, timelinePosition: 2 }),
    ]

    await extractAndMixAudioWithWorker(clips, [makeTrack({ volume: 0.4 })], 4, vi.fn())

    const [init, extract, terminate] = scriptedWorkerState.posted.map((p) => p.message) as Array<
      Record<string, unknown>
    >
    expect(init).toMatchObject({ type: 'INIT', totalDuration: 4 })
    expect(extract.type).toBe('EXTRACT_AUDIO')
    // video1 is shared by two clips, so it is read and transferred once.
    expect((extract.audioBlobs as ArrayBuffer[])).toHaveLength(2)
    expect(extract.clipMeta).toEqual([
      expect.objectContaining({ clipId: 'a', sourceIndex: 0, trackVolume: 0.4, trackMuted: false }),
      expect.objectContaining({ clipId: 'b', sourceIndex: 0, timelinePosition: 1 }),
      expect.objectContaining({ clipId: 'c', sourceIndex: 1, clipDuration: 2 }),
    ])
    expect(terminate).toEqual({ type: 'TERMINATE' })
  })

  it('transfers the audio blobs rather than copying them', async () => {
    const clips = [makeClip({ duration: 1, endTime: 1 })]

    await extractAndMixAudioWithWorker(clips, [makeTrack()], 1, vi.fn())

    const extract = scriptedWorkerState.posted[1]
    expect(extract.options).toEqual({
      transfer: (extract.message as { audioBlobs: ArrayBuffer[] }).audioBlobs,
    })
  })

  it('returns the worker mix and forwards its progress', async () => {
    const mix = new Float32Array([0.1, 0.2, 0.3, 0.4])
    scriptedWorkerState.audio = { buffer: mix, hasAudio: true }
    const onProgress = vi.fn()

    const result = await extractAndMixAudioWithWorker(
      [makeClip({ duration: 1, endTime: 1 })],
      [makeTrack()],
      1,
      onProgress
    )

    expect(result).toBe(mix)
    expect(onProgress).toHaveBeenCalledWith(50)
    expect(offline.decodeCalls).toHaveLength(0) // never touched the main thread
  })

  it('returns null when the worker reports no audio', async () => {
    scriptedWorkerState.audio = { buffer: new Float32Array(4), hasAudio: false }

    const result = await extractAndMixAudioWithWorker(
      [makeClip({ duration: 1, endTime: 1 })],
      [makeTrack()],
      1,
      vi.fn()
    )

    expect(result).toBeNull()
  })

  it('terminates the worker on the happy path', async () => {
    await extractAndMixAudioWithWorker(
      [makeClip({ duration: 1, endTime: 1 })],
      [makeTrack()],
      1,
      vi.fn()
    )

    expect(scriptedWorkerState.terminated).toBe(1)
  })

  it('skips clips with no source and clips on a track that no longer exists', async () => {
    const clips = [
      makeClip({ id: 'overlay', sourceVideoId: '', duration: 1, endTime: 1 }),
      makeClip({ id: 'orphan', trackId: 'gone', duration: 1, endTime: 1 }),
      makeClip({ id: 'kept', duration: 1, endTime: 1 }),
      makeClip({ id: 'unstored', sourceVideoId: 'missing', duration: 1, endTime: 1 }),
    ]

    await extractAndMixAudioWithWorker(clips, [makeTrack()], 1, vi.fn())

    const extract = scriptedWorkerState.posted[1].message as { clipMeta: Array<{ clipId: string }> }
    expect(extract.clipMeta.map((m) => m.clipId)).toEqual(['kept'])
  })

  it('falls back to the main thread when workers are unsupported', async () => {
    const restoreWorker = removeGlobal('Worker')
    resetWorkerSupportCache()

    const result = await extractAndMixAudioWithWorker(
      [makeClip({ duration: 0.005, endTime: 0.005 })],
      [makeTrack()],
      TOTAL_DURATION,
      vi.fn()
    )

    expect(scriptedWorkerState.instances).toHaveLength(0)
    expect(offline.decodeCalls).toHaveLength(1)
    expect(result).not.toBeNull()
    restoreWorker()
  })

  it('falls back to the main thread when the worker reports an error', async () => {
    scriptedWorkerState.respond = (message, w: ScriptedWorkerInstance) => {
      if ((message as { type: string }).type === 'INIT') {
        w.reply({ type: 'ERROR', error: 'no OfflineAudioContext in worker' })
      }
    }

    const result = await extractAndMixAudioWithWorker(
      [makeClip({ duration: 0.005, endTime: 0.005 })],
      [makeTrack()],
      TOTAL_DURATION,
      vi.fn()
    )

    expect(warn).toHaveBeenCalledWith(
      'Worker audio extraction failed, falling back to main thread:',
      expect.objectContaining({ message: 'no OfflineAudioContext in worker' })
    )
    expect(offline.decodeCalls).toHaveLength(1)
    expect(result).not.toBeNull()
  })

  it('falls back to the main thread when the worker itself errors out', async () => {
    scriptedWorkerState.respond = (_message, w: ScriptedWorkerInstance) => {
      w.fail('script load failed')
    }

    const result = await extractAndMixAudioWithWorker(
      [makeClip({ duration: 0.005, endTime: 0.005 })],
      [makeTrack()],
      TOTAL_DURATION,
      vi.fn()
    )

    expect(warn).toHaveBeenCalledWith(
      'Worker audio extraction failed, falling back to main thread:',
      expect.objectContaining({ message: 'Worker error: script load failed' })
    )
    expect(result).not.toBeNull()
  })

  it('falls back to the main thread when the worker cannot be constructed', async () => {
    scriptedWorkerState.constructorError = new Error('Refused to create a worker')

    const result = await extractAndMixAudioWithWorker(
      [makeClip({ duration: 0.005, endTime: 0.005 })],
      [makeTrack()],
      TOTAL_DURATION,
      vi.fn()
    )

    expect(offline.decodeCalls).toHaveLength(1)
    expect(result).not.toBeNull()
  })

  it('falls back to the main thread when the worker never answers INIT', async () => {
    useTimeoutFakes()
    scriptedWorkerState.respond = () => {}
    const onProgress = vi.fn()

    const pending = extractAndMixAudioWithWorker(
      [makeClip({ duration: 0.005, endTime: 0.005 })],
      [makeTrack()],
      TOTAL_DURATION,
      onProgress
    )
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    const result = await pending

    expect(warn).toHaveBeenCalledWith(
      'Worker audio extraction failed, falling back to main thread:',
      expect.objectContaining({ message: 'Worker init timeout' })
    )
    expect(result).not.toBeNull()
    expect(onProgress).toHaveBeenCalledWith(100) // the main-thread mixer ran
  })

  it('falls back to the main thread when the audio request times out', async () => {
    useTimeoutFakes()
    scriptedWorkerState.respond = (message, w: ScriptedWorkerInstance) => {
      if ((message as { type: string }).type === 'INIT') w.reply({ type: 'INIT_COMPLETE' })
    }
    const onProgress = vi.fn()

    const pending = extractAndMixAudioWithWorker(
      [makeClip({ duration: 0.005, endTime: 0.005 })],
      [makeTrack()],
      TOTAL_DURATION,
      onProgress
    )
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60000)
    const result = await pending

    expect(warn).toHaveBeenCalledWith(
      'Worker audio extraction failed, falling back to main thread:',
      expect.objectContaining({ message: 'Audio extraction timeout' })
    )
    expect(result).not.toBeNull()
    expect(onProgress).toHaveBeenCalledWith(100)
  })

  it('falls back to the main thread when the worker errors during extraction', async () => {
    scriptedWorkerState.respond = (message, w: ScriptedWorkerInstance) => {
      const type = (message as { type: string }).type
      if (type === 'INIT') w.reply({ type: 'INIT_COMPLETE' })
      if (type === 'EXTRACT_AUDIO') w.reply({ type: 'ERROR', error: 'decode blew up' })
    }

    const result = await extractAndMixAudioWithWorker(
      [makeClip({ duration: 0.005, endTime: 0.005 })],
      [makeTrack()],
      TOTAL_DURATION,
      vi.fn()
    )

    expect(warn).toHaveBeenCalledWith(
      'Worker audio extraction failed, falling back to main thread:',
      expect.objectContaining({ message: 'decode blew up' })
    )
    expect(offline.decodeCalls).toHaveLength(1)
    expect(result).not.toBeNull()
  })
})
