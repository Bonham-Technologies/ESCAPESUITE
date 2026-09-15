// Per-frame and per-second work ceilings for the WebCodecs recorder.
//
// WebCodecsRecorder runs for the whole length of a take, on whatever machine
// the user has, and three of its loops repeat: the frame capture (30/s), the
// ScriptProcessor's audio callback (~12/s at 4096 samples), and the
// audio-level monitor. The monitor is the one that used to be free-running —
// one emission per animation frame, each one a store write that re-rendered
// ESCAPECRAFT's tree, plus a fresh Uint8Array per analyser for the FFT to be
// copied into. `Recorder` (MediaRecorder) has gated its monitor to 80 ms since
// it was written; this file is where the two are held to the same bargain.
//
// What is asserted here is *counts*, not milliseconds, so nothing depends on
// the runner's speed and everything can be enforced in CI like any other test.
// Conservation laws — every VideoFrame closed, one encode per captured frame,
// one flush per take, the AudioContext closed — are exact. The rest are
// ceilings, each carrying the value it was measured at and the date.
//
// Measured through the same doubles the recorder's behaviour tests use, with a
// hand-driven rAF and a scripted `performance.now()`.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { WebCodecsRecorder } from './webcodecs-recorder'
import type { RecordingConfig } from '../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  lastAudioEncoder,
  getCreatedFrames,
  allFramesClosed,
} from '../test/doubles/webcodecs'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  lastAudioContext,
  createAudioBufferDouble,
  type AnalyserDouble,
  type AudioContextDoubleControl,
} from '../test/doubles/audio'
import { installVideoElementDouble, uninstallVideoElementDouble } from '../test/doubles/video'
import { getCanvasContext } from '../test/doubles/canvas'
import { installRafDouble, type RafDouble } from '../test/doubles/raf'
import { createTrackDouble, createStreamDouble } from '../test/doubles/mediastream'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

/** A browser offering frames at 60Hz. */
const RAF_INTERVAL_MS = 1000 / 60
const TICKS_PER_SECOND = 60
/** What the recorder captures and encodes at. */
const CAPTURE_FPS = 30
/** The ScriptProcessor's buffer: 4096 samples at 48kHz is ~85ms of audio. */
const AUDIO_BUFFER_FRAMES = 4096

const baseConfig: RecordingConfig = {
  screenEnabled: true,
  webcamEnabled: false,
  microphoneEnabled: false,
  systemAudioEnabled: false,
  countdownSeconds: 0,
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'circle',
}

/** Let queued microtasks (encoder outputs, the muxer) settle. */
async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

describe('WebCodecsRecorder work ceilings', () => {
  let recorder: WebCodecsRecorder
  let onAudioLevels: Mock
  let audio: AudioContextDoubleControl
  let raf: RafDouble
  let screenStream: MediaStream
  let micStream: MediaStream
  let now = 0

  beforeEach(() => {
    vi.useFakeTimers()
    now = 100_000
    raf = installRafDouble()

    installWebCodecsDoubles()
    resetWebCodecsDoubles()
    resetMediabunnyDouble()
    installVideoElementDouble()
    audio = installAudioContextDouble()
    audio.analyserLevel = 64

    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    onAudioLevels = vi.fn()
    recorder = new WebCodecsRecorder({ onAudioLevels })

    screenStream = createStreamDouble([
      createTrackDouble('video', { id: 'screen-video', settings: { width: 1280, height: 720 } }),
      createTrackDouble('audio', { id: 'system-audio' }),
    ])
    micStream = createStreamDouble([createTrackDouble('audio', { id: 'mic-audio' })])
  })

  afterEach(() => {
    recorder.dispose()
    uninstallVideoElementDouble()
    uninstallAudioContextDouble()
    uninstallWebCodecsDoubles()
    raf.uninstall()
    // Restore the spies (performance.now among them) before the timers, so
    // nothing is left pointing at a faked clock.
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** A take with both audio sources, so both analysers exist. */
  async function initializeWithAudio(): Promise<void> {
    await recorder.initialize(screenStream, null, micStream, {
      ...baseConfig,
      microphoneEnabled: true,
      systemAudioEnabled: true,
    })
  }

  /** Offer the recorder a second's worth of 60Hz animation frames. */
  function playOneSecond(): number {
    const before = onAudioLevels.mock.calls.length
    for (let tick = 0; tick < TICKS_PER_SECOND; tick++) {
      now += RAF_INTERVAL_MS
      raf.tick()
    }
    return onAudioLevels.mock.calls.length - before
  }

  /** Capture `seconds` worth of frames through the setTimeout capture loop. */
  function captureSeconds(seconds: number): void {
    vi.advanceTimersByTime(seconds * 1000)
  }

  /** Frames the capture loop actually drew — one drawImage per captured frame. */
  function capturedFrames(): number {
    const ctx = getCanvasContext(
      (recorder as unknown as { canvas: HTMLCanvasElement }).canvas
    )
    if (!ctx) throw new Error('the recorder built no capture canvas')
    return ctx.calls.filter(c => c.method === 'drawImage').length
  }

  /** Every distinct Uint8Array the analysers were asked to fill. */
  function levelBuffers(): Set<unknown> {
    const analysers: AnalyserDouble[] = lastAudioContext().analysers
    const seen = new Set<unknown>()
    for (const analyser of analysers) {
      for (const call of analyser.getByteFrequencyData.mock.calls) seen.add(call[0])
    }
    return seen
  }

  describe('the audio-level monitor', () => {
    it('pushes at most a dozen level samples a second, whatever the frame rate', async () => {
      await initializeWithAudio()

      const emissions = playOneSecond()

      // Not a 2x ceiling but the gate's own arithmetic, the way the
      // compositor's "never faster than the target frame rate" is: an 80ms
      // gate can fit at most ceil(1000 / 80) = 13 emissions into a second, so
      // 13 is the most this can ever be, on any machine, at any frame rate.
      // Measured 2026-09-15: 12 per 60 offered frames (60 before the gate —
      // one store write and a whole-tree re-render per animation frame).
      expect(emissions).toBeLessThanOrEqual(13)
      // ...and the meter still moves: a gate that emitted nothing would pass
      // the ceiling above and show the user a dead level bar.
      expect(emissions).toBeGreaterThanOrEqual(11)
    })

    it('fills one buffer per analyser and reuses it for the whole take', async () => {
      await initializeWithAudio()

      const emissions = playOneSecond()
      const buffers = levelBuffers()

      // Exact conservation law: the byte buffer an analyser reads into depends
      // only on its frequencyBinCount, which never changes, so one per
      // analyser is all a take can ever need. It used to be one per analyser
      // per animation frame — 120 short-lived typed arrays a second, handed
      // straight to the garbage collector.
      expect(lastAudioContext().analysers).toHaveLength(2)
      expect(buffers.size).toBe(lastAudioContext().analysers.length)
      // ...and therefore never more than one allocation per emitted sample.
      // Measured 2026-09-15: 2 buffers for 12 samples (122 for 60 before).
      expect(buffers.size).toBeLessThanOrEqual(emissions)
    })

    it('costs a silent take nothing at all', async () => {
      // No microphone, no system audio: there is no analyser to read, so every
      // sample would be a hard-coded {microphone: 0, system: 0} written to the
      // store 60 times a second, re-rendering the app for a meter that cannot
      // move.
      await recorder.initialize(screenStream, null, null, baseConfig)

      expect(onAudioLevels).not.toHaveBeenCalled()
      // Exact: nothing scheduled means nothing to run, and nothing to cancel.
      expect(raf.pending()).toBe(0)
      expect(playOneSecond()).toBe(0)
    })
  })

  describe('one take of captured frames', () => {
    it('creates one VideoFrame per captured frame, encodes it once, and closes it', async () => {
      await initializeWithAudio()
      recorder.start()
      captureSeconds(1)
      playOneSecond()
      await flush()

      const frames = getCreatedFrames('VideoFrame')
      const encodes = lastVideoEncoder().encodes

      // start() draws one frame immediately, then the timer takes over at
      // 1000/30 ms.
      expect(capturedFrames()).toBe(CAPTURE_FPS + 1)
      // Exact, all three: a frame is made for each captured frame, encoded
      // once, and closed. A VideoFrame that outlives its encode pins a whole
      // decoded image in memory until the GC gets to it, which on a long take
      // is how a recorder runs a machine out of RAM.
      expect(frames).toHaveLength(capturedFrames())
      expect(encodes).toHaveLength(frames.length)
      expect(encodes.map(e => e.data)).toEqual(frames)
      expect(allFramesClosed()).toBe(true)
    })

    it('allocates one planar buffer per audio buffer and closes every AudioData', async () => {
      await initializeWithAudio()
      recorder.start()

      const node = lastAudioContext().scriptProcessors[0]
      const buffers = 12
      for (let i = 0; i < buffers; i++) {
        node.onaudioprocess!({
          inputBuffer: createAudioBufferDouble({ length: AUDIO_BUFFER_FRAMES }),
        })
      }
      await flush()

      const audioData = getCreatedFrames('AudioData')
      const planarBuffers = new Set(audioData.map(d => d.source))

      // Exact: one AudioData per callback, each encoded once and closed.
      expect(audioData).toHaveLength(buffers)
      expect(lastAudioEncoder().encodes).toHaveLength(buffers)
      expect(audioData.every(d => d.closed)).toBe(true)
      // Measured 2026-09-15: one Float32Array per callback — the interleave of
      // the two input channels into planar layout. The ScriptProcessor fires
      // ~11 times a second at 4096 samples, so this is not a per-frame cost; a
      // scratch buffer reused across callbacks would take it to zero.
      expect(planarBuffers.size).toBeLessThanOrEqual(buffers)
      expect(planarBuffers.size).toBe(audioData.length)
    })

    it('flushes each encoder once and closes the AudioContext when the take ends', async () => {
      await initializeWithAudio()
      recorder.start()
      captureSeconds(1)
      const node = lastAudioContext().scriptProcessors[0]
      node.onaudioprocess!({ inputBuffer: createAudioBufferDouble({ length: AUDIO_BUFFER_FRAMES }) })

      await recorder.stop()

      // Exact: one flush per encoder per take. Flushing twice would either
      // throw on a closed encoder or write the tail packets in twice.
      expect(lastVideoEncoder().flushCalls).toBe(1)
      expect(lastAudioEncoder().flushCalls).toBe(1)
      // Exact: every AudioContext the take opened is closed. A live
      // AudioContext holds the audio hardware open and keeps its whole node
      // graph — analysers, ScriptProcessor, the mix — running after the
      // recording is over.
      expect(audio.contexts).toHaveLength(1)
      expect(audio.contexts.every(c => c.state === 'closed')).toBe(true)
      expect(lastAudioContext().close).toHaveBeenCalledTimes(1)
      // ...and the monitor is not left scheduled behind it.
      expect(raf.pending()).toBe(0)
    })
  })
})
