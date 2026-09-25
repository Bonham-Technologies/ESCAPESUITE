// Per-second work ceilings for the MediaRecorder recorder's audio-level monitor.
//
// `Recorder` and `WebCodecsRecorder` each run their own copy of the level
// monitor, and the two drifted: this one has gated itself to 80 ms since it was
// written, the other emitted on every animation frame. They are now the same
// shape, and the rate ceiling is asserted in both files (see
// `webcodecsRecorder.perf.test.ts`) precisely so the pair cannot drift apart
// again — a monitor added to either one at 60 Hz turns a test red here.
//
// Counts, not milliseconds, so nothing depends on the runner's speed.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { Recorder } from './recorder'
import type { RecordingConfig } from '../store/types'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  lastAudioContext,
  type AnalyserDouble,
} from '../test/doubles/audio'
import { installRafDouble, type RafDouble } from '../test/doubles/raf'
import { createTrackDouble, createStreamDouble } from '../test/doubles/mediastream'

/** A browser offering frames at 60Hz. */
const RAF_INTERVAL_MS = 1000 / 60
const TICKS_PER_SECOND = 60

const config: RecordingConfig = {
  screenEnabled: true,
  webcamEnabled: false,
  microphoneEnabled: true,
  systemAudioEnabled: true,
  countdownSeconds: 0,
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'circle',
  separateTracks: false,
}

describe('Recorder audio-level monitor ceilings', () => {
  let recorder: Recorder
  let onAudioLevels: Mock
  let raf: RafDouble
  let now = 0

  beforeEach(async () => {
    now = 100_000
    raf = installRafDouble()
    const audio = installAudioContextDouble()
    audio.analyserLevel = 64
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    onAudioLevels = vi.fn()
    recorder = new Recorder({ onAudioLevels })

    const screenStream = createStreamDouble([
      createTrackDouble('video', { id: 'screen-video' }),
      createTrackDouble('audio', { id: 'system-audio' }),
    ])
    const micStream = createStreamDouble([createTrackDouble('audio', { id: 'mic-audio' })])
    await recorder.initialize(screenStream, null, micStream, config)
  })

  afterEach(() => {
    recorder.dispose()
    uninstallAudioContextDouble()
    raf.uninstall()
    vi.restoreAllMocks()
  })

  /** Offer the monitor a second's worth of 60Hz animation frames. */
  function playOneSecond(): number {
    const before = onAudioLevels.mock.calls.length
    for (let tick = 0; tick < TICKS_PER_SECOND; tick++) {
      now += RAF_INTERVAL_MS
      raf.tick()
    }
    return onAudioLevels.mock.calls.length - before
  }

  it('pushes at most a dozen level samples a second, whatever the frame rate', () => {
    const emissions = playOneSecond()

    // The gate's own arithmetic rather than a 2x ceiling: 80 ms between
    // samples means at most ceil(1000 / 80) = 13 in a second, on any machine
    // at any frame rate. Measured 2026-09-15: 12 per 60 offered frames.
    expect(emissions).toBeLessThanOrEqual(13)
    // ...and the meter still moves.
    expect(emissions).toBeGreaterThanOrEqual(11)
  })

  it('still allocates a read buffer per analyser per sample', () => {
    const emissions = playOneSecond()
    const analysers: AnalyserDouble[] = lastAudioContext().analysers
    const buffers = new Set<unknown>()
    for (const analyser of analysers) {
      for (const call of analyser.getByteFrequencyData.mock.calls) buffers.add(call[0])
    }

    // This pins a FINDING, not a target. `WebCodecsRecorder` allocates each
    // analyser's byte buffer once and reuses it for the whole take (see
    // `webcodecsRecorder.perf.test.ts`); `Recorder` still builds a fresh
    // Uint8Array per analyser per sample. Measured 2026-09-15: 2 analysers x
    // 12 samples = 24 typed arrays a second, plus the one from the immediate
    // sample `startAudioLevelMonitoring()` takes before the first frame.
    // At 12.5 Hz that is a few hundred bytes a second and not a per-frame
    // cost, which is why it is recorded rather than fixed here. When it is
    // hoisted, this becomes `toBe(analysers.length)` — the same conservation
    // law the WebCodecs recorder is already held to.
    expect(analysers).toHaveLength(2)
    expect(buffers.size).toBe(analysers.length * (emissions + 1))
  })
})
