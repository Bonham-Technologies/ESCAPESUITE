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
  AudioEncoderDouble,
  VideoEncoderDouble,
  VideoFrameDouble,
} from '../test/doubles/webcodecs'
import { getMediabunnyState, resetMediabunnyDouble } from '../test/doubles/mediabunny'
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
import {
  createTrackDouble,
  createStreamDouble,
  installTrackProcessorDouble,
  uninstallTrackProcessorDouble,
} from '../test/doubles/mediastream'

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
  separateTracks: false,
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

    it('costs a silent take one sample and nothing more', async () => {
      // No microphone, no system audio: there is no analyser to read, so every
      // sample would be a hard-coded {microphone: 0, system: 0} written to the
      // store 60 times a second, re-rendering the app for a meter that cannot
      // move. Exactly one of those is worth sending — it zeroes whatever the
      // previous take left in the store — and it is sent per take, not per
      // frame.
      await recorder.initialize(screenStream, null, null, baseConfig)

      expect(onAudioLevels).toHaveBeenCalledTimes(1)
      expect(onAudioLevels).toHaveBeenCalledWith({ microphone: 0, system: 0 })
      // Exact: nothing scheduled means nothing to run, and nothing to cancel.
      expect(raf.pending()).toBe(0)
      // Measured 2026-09-15: 0 further emissions per 60 frames, for the rest
      // of the take, however long it runs (60 before).
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

  describe('one take of separate tracks', () => {
    /**
     * Frames offered to each pipeline. The track-processor path is driven by
     * hand here (rather than the setTimeout canvas path the suites above use),
     * because what is being counted is per-encoder conservation and this is the
     * path a real separate-tracks take runs on.
     */
    const FRAMES_PER_TRACK = 30

    it('encodes each frame once per encoder, closes every frame, flushes twice', async () => {
      const processor = installTrackProcessorDouble()
      const webcamStream = createStreamDouble([
        createTrackDouble('video', { id: 'webcam-video', settings: { width: 640, height: 480 } }),
      ])
      try {
        await recorder.initialize(screenStream, webcamStream, micStream, {
          ...baseConfig,
          webcamEnabled: true,
          separateTracks: true,
          microphoneEnabled: true,
          systemAudioEnabled: true,
        })
        recorder.start()

        for (let i = 0; i < FRAMES_PER_TRACK; i++) {
          now += 1000 / CAPTURE_FPS
          processor.pushFrameTo('screen-video', new VideoFrameDouble({}, { timestamp: 0 }))
          processor.pushFrameTo('webcam-video', new VideoFrameDouble({}, { timestamp: 0 }))
          await flush()
        }

        const [screen, webcam] = VideoEncoderDouble.instances
        // Exact conservation, per encoder: one encode per frame offered, and
        // nothing encoded twice. A frame counted on the wrong encoder is a
        // frame in the wrong file.
        expect(VideoEncoderDouble.instances).toHaveLength(2)
        expect(screen.encodes).toHaveLength(FRAMES_PER_TRACK)
        expect(webcam.encodes).toHaveLength(FRAMES_PER_TRACK)
        // Exact: every VideoFrame the take made is closed — the source frames
        // the reader handed over and the re-stamped ones handed to the encoders.
        // A VideoFrame that outlives its encode pins a decoded image in memory,
        // and this mode makes two of them per tick.
        expect(allFramesClosed()).toBe(true)
        // Measured 2026-09-25: 120 VideoFrames for 60 offered (one source frame
        // plus one re-stamped frame per pipeline per tick). Ceiling at 2x.
        expect(getCreatedFrames('VideoFrame').length).toBeLessThanOrEqual(
          4 * 2 * FRAMES_PER_TRACK
        )

        await recorder.stop()

        // Exact: one flush per encoder, one finalize per output. Three audio
        // encoders and four outputs, because this take really has three audio
        // pipelines — the mix on the primary, and one file each for the
        // microphone and the system audio (slice 3). The mix is still the
        // primary's, which is what keeps a screen-only download audible.
        expect(screen.flushCalls).toBe(1)
        expect(webcam.flushCalls).toBe(1)
        // Audio encoders are constructed mix, then mic, then system
        // (`initializeAudioCompanion`'s call order), so `lastAudioEncoder()`
        // here is the system companion's, not the mix's — every audio
        // encoder flushes exactly once regardless of which one this checks.
        expect(lastAudioEncoder().flushCalls).toBe(1)
        expect(AudioEncoderDouble.instances).toHaveLength(3)
        // The two audio companions are offered no buffer by this suite, so
        // they encoded nothing and their parts are left out on purpose — an
        // empty Opus file is a library row that plays nothing.
        // The four-finalize case is 'one take of audio companions', below.
        expect(getMediabunnyState().outputs.map(o => o.finalizeCalls)).toEqual([1, 1, 0, 0])
        // Exact conservation (ESCSUITE-66): every started output is either
        // finalized or cancelled, exactly once, and never both. A companion
        // left out of the take still has a muxer holding its encoders and its
        // target open until Mediabunny is told the file is over.
        expect(getMediabunnyState().outputs.map(o => o.cancelCalls)).toEqual([0, 0, 1, 1])
        expect(getMediabunnyState().outputs.map(o => o.state)).toEqual([
          'finalized',
          'finalized',
          'canceled',
          'canceled',
        ])
        // Exact conservation: five codecs constructed, five closed, once each.
        // `close()` on an already-closed codec throws InvalidStateError, so a
        // second close is as wrong as none.
        const codecs = [...VideoEncoderDouble.instances, ...AudioEncoderDouble.instances]
        expect(codecs).toHaveLength(5)
        expect(codecs.map(c => c.closeCalls)).toEqual([1, 1, 1, 1, 1])
        // Exact conservation: five source nodes connected — the mix's two taps
        // and its destination, plus one per audio companion — and five
        // disconnected. A MediaStreamAudioSourceNode is otherwise released only
        // when the AudioContext closes.
        const sourceNodes = lastAudioContext().mediaStreamSourceNodes
        expect(sourceNodes).toHaveLength(5)
        expect(sourceNodes.map(n => n.disconnect.mock.calls.length)).toEqual([1, 1, 1, 1, 1])
        // Exact conservation: two frame readers, cancelled once each. stop()
        // releases and drops them, so the cleanup that follows finds nothing.
        expect(processor.cancelCalls()).toBe(2)
        // Exact: one AudioContext, closed. Two video pipelines must not mean
        // two audio graphs.
        expect(audio.contexts).toHaveLength(1)
        expect(audio.contexts.every(c => c.state === 'closed')).toBe(true)
        expect(raf.pending()).toBe(0)
      } finally {
        uninstallTrackProcessorDouble()
      }
    })
  })

  describe('one take of audio companions', () => {
    /** Buffers offered to each audio pipeline. */
    const BUFFERS_PER_PIPELINE = 12

    it('encodes each buffer once per pipeline, closes every AudioData, flushes each encoder once', async () => {
      const processor = installTrackProcessorDouble()
      const webcamStream = createStreamDouble([
        createTrackDouble('video', { id: 'webcam-video', settings: { width: 640, height: 480 } }),
      ])
      try {
        await recorder.initialize(screenStream, webcamStream, micStream, {
          ...baseConfig,
          webcamEnabled: true,
          separateTracks: true,
          microphoneEnabled: true,
          systemAudioEnabled: true,
        })
        recorder.start()

        // One frame down each video pipeline, so both have something worth
        // finalizing and this suite counts four outputs rather than two.
        now += 1000 / CAPTURE_FPS
        processor.pushFrameTo('screen-video', new VideoFrameDouble({}, { timestamp: 0 }))
        processor.pushFrameTo('webcam-video', new VideoFrameDouble({}, { timestamp: 0 }))
        await flush()

        const nodes = lastAudioContext().scriptProcessors
        for (let i = 0; i < BUFFERS_PER_PIPELINE; i++) {
          for (const node of nodes) {
            node.onaudioprocess!({
              inputBuffer: createAudioBufferDouble({ length: AUDIO_BUFFER_FRAMES }),
            })
          }
        }
        await flush()

        const [mix, mic, system] = AudioEncoderDouble.instances
        const audioData = getCreatedFrames('AudioData')

        // Exact conservation, per pipeline: one AudioData per callback, each
        // encoded once by its own encoder and closed. An AudioData that
        // outlives its encode pins a decoded buffer in memory, and this mode
        // makes three of them per buffer period.
        expect(AudioEncoderDouble.instances).toHaveLength(3)
        expect(lastAudioContext().scriptProcessors).toHaveLength(3)
        for (const encoder of [mix, mic, system]) {
          expect(encoder.encodes).toHaveLength(BUFFERS_PER_PIPELINE)
        }
        expect(audioData).toHaveLength(3 * BUFFERS_PER_PIPELINE)
        expect(audioData.every(d => d.closed)).toBe(true)
        // Measured 2026-09-26: one Float32Array per callback per pipeline — the
        // interleave of the two input channels into planar layout — so 36 for
        // 36 callbacks. The ScriptProcessor fires ~11 times a second at 4096
        // samples, so this is not a per-frame cost; a scratch buffer reused
        // across callbacks would take it to zero. Ceiling at 2x.
        const planarBuffers = new Set(audioData.map(d => d.source))
        expect(planarBuffers.size).toBeLessThanOrEqual(2 * 3 * BUFFERS_PER_PIPELINE)
        expect(planarBuffers.size).toBe(audioData.length)

        await recorder.stop()

        // Exact: one flush per encoder, one finalize per output. Four outputs:
        // screen, webcam, microphone, system audio.
        for (const encoder of [mix, mic, system]) {
          expect(encoder.flushCalls).toBe(1)
          expect(encoder.closeCalls).toBe(1)
        }
        expect(getMediabunnyState().outputs.map(o => o.finalizeCalls)).toEqual([1, 1, 1, 1])
        // Exact conservation (ESCSUITE-66): four outputs finalized and none
        // cancelled — every part of this take is worth storing, so `cleanup()`
        // must not cancel a single finished file behind them.
        expect(getMediabunnyState().outputs.map(o => o.cancelCalls)).toEqual([0, 0, 0, 0])
        // Exact conservation: five source nodes — the system tap, the
        // microphone tap and the mixed destination the primary encoder reads,
        // plus one per audio companion — disconnected once each.
        const sourceNodes = lastAudioContext().mediaStreamSourceNodes
        expect(sourceNodes).toHaveLength(5)
        expect(sourceNodes.map(n => n.disconnect.mock.calls.length)).toEqual([1, 1, 1, 1, 1])
        // Exact: one AudioContext for the whole take, closed. Three audio
        // pipelines must not mean three audio graphs.
        expect(audio.contexts).toHaveLength(1)
        expect(audio.contexts.every(c => c.state === 'closed')).toBe(true)
        // Exact: two analysers, the mix's own. A companion adds a tap, never a
        // meter — the Sources panel draws two bars and a third would be a
        // store write per animation frame for a meter nothing renders.
        expect(lastAudioContext().analysers).toHaveLength(2)
        expect(raf.pending()).toBe(0)
      } finally {
        uninstallTrackProcessorDouble()
      }
    })
  })

  describe('one cancelled take', () => {
    // The take nobody keeps: a countdown cancelled, a Cancel pressed, an
    // unmount. It reaches none of stop()'s flushes or finalizes, so everything
    // it holds is released by cleanup() alone — and a separate-tracks take
    // holds more than any other (ESCSUITE-66). Every number here is an exact
    // conservation law, not a ceiling: what was acquired was released, once.
    it('releases every codec, output, source node and reader it acquired', async () => {
      const trackProcessor = installTrackProcessorDouble()
      const webcamStream = createStreamDouble([
        createTrackDouble('video', { id: 'webcam-video', settings: { width: 640, height: 480 } }),
      ])
      try {
        await recorder.initialize(screenStream, webcamStream, micStream, {
          ...baseConfig,
          webcamEnabled: true,
          separateTracks: true,
          microphoneEnabled: true,
          systemAudioEnabled: true,
        })
        recorder.start()

        now += 1000 / CAPTURE_FPS
        trackProcessor.pushFrameTo('screen-video', new VideoFrameDouble({}, { timestamp: 0 }))
        trackProcessor.pushFrameTo('webcam-video', new VideoFrameDouble({}, { timestamp: 0 }))
        for (const node of lastAudioContext().scriptProcessors) {
          node.onaudioprocess!({
            inputBuffer: createAudioBufferDouble({ length: AUDIO_BUFFER_FRAMES }),
          })
        }
        await flush()

        recorder.dispose()
        await flush()

        // Five codecs — two VideoEncoders, three AudioEncoders — closed once
        // each. Each one left open is a hardware encoder session held until the
        // page goes away, and closing one twice throws InvalidStateError.
        const codecs = [...VideoEncoderDouble.instances, ...AudioEncoderDouble.instances]
        expect(codecs).toHaveLength(5)
        expect(codecs.map(c => c.closeCalls)).toEqual([1, 1, 1, 1, 1])
        expect(codecs.every(c => c.state === 'closed')).toBe(true)
        // Four outputs started, four cancelled, none finalized: a cancelled
        // take has no file to write, and Mediabunny holds each output's
        // encoders and its target open until it is told so.
        const outputs = getMediabunnyState().outputs
        expect(outputs).toHaveLength(4)
        expect(outputs.map(o => o.startCalls)).toEqual([1, 1, 1, 1])
        expect(outputs.map(o => o.cancelCalls)).toEqual([1, 1, 1, 1])
        expect(outputs.map(o => o.finalizeCalls)).toEqual([0, 0, 0, 0])
        // Five source nodes and three ScriptProcessors, disconnected once each.
        const sourceNodes = lastAudioContext().mediaStreamSourceNodes
        expect(sourceNodes).toHaveLength(5)
        expect(sourceNodes.map(n => n.disconnect.mock.calls.length)).toEqual([1, 1, 1, 1, 1])
        const processors = lastAudioContext().scriptProcessors
        expect(processors).toHaveLength(3)
        expect(processors.map(n => n.disconnect.mock.calls.length)).toEqual([1, 1, 1])
        // Two frame readers, cancelled once each — the two cameras' worth of
        // capture this take was reading.
        expect(trackProcessor.cancelCalls()).toBe(2)
        // One AudioContext, closed; nothing left scheduled on rAF; and every
        // VideoFrame and AudioData the take built closed.
        expect(audio.contexts).toHaveLength(1)
        expect(audio.contexts.every(c => c.state === 'closed')).toBe(true)
        expect(raf.pending()).toBe(0)
        expect(allFramesClosed()).toBe(true)
      } finally {
        uninstallTrackProcessorDouble()
      }
    })
  })
})
