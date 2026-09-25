import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { WebCodecsRecorder, isWebCodecsRecordingSupported } from './webcodecs-recorder'
import type { RecordingConfig } from '../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  lastAudioEncoder,
  getCreatedFrames,
  allFramesClosed,
  webcodecsCallLog,
  VideoFrameDouble,
  VideoEncoderDouble,
  AudioEncoderDouble,
} from '../test/doubles/webcodecs'
import {
  getMediabunnyState,
  lastMediabunnyOutput,
  resetMediabunnyDouble,
} from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  lastAudioContext,
  createAudioBufferDouble,
  type AudioContextDoubleControl,
} from '../test/doubles/audio'
import {
  installVideoElementDouble,
  uninstallVideoElementDouble,
  getLastVideoDouble,
} from '../test/doubles/video'
import { getCanvasContext } from '../test/doubles/canvas'
import {
  createTrackDouble,
  createStreamDouble,
  installTrackProcessorDouble,
  uninstallTrackProcessorDouble,
  type TrackDouble,
  type TrackProcessorControl,
} from '../test/doubles/mediastream'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

const defaultConfig: RecordingConfig = {
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

/** Let queued microtasks (the frame-reader loop, encoder outputs) settle. */
async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

// rAF drives the audio-level monitor, which reschedules itself forever. The
// double keeps the pending callback under test control so it can never fire
// into a torn-down environment.
const rafCallbacks = new Map<number, FrameRequestCallback>()
let nextRafHandle = 1
let originalRaf: typeof globalThis.requestAnimationFrame
let originalCancelRaf: typeof globalThis.cancelAnimationFrame

function tickAnimationFrames(): void {
  const pending = [...rafCallbacks.values()]
  rafCallbacks.clear()
  for (const cb of pending) cb(0)
}

describe('isWebCodecsRecordingSupported', () => {
  afterEach(() => {
    uninstallWebCodecsDoubles()
  })

  it('is true when every WebCodecs global the recorder needs is present', () => {
    installWebCodecsDoubles()
    expect(isWebCodecsRecordingSupported()).toBe(true)
  })

  it('is false when VideoEncoder is missing', () => {
    installWebCodecsDoubles()
    const g = globalThis as unknown as Record<string, unknown>
    const saved = g.VideoEncoder
    delete g.VideoEncoder
    try {
      expect(isWebCodecsRecordingSupported()).toBe(false)
    } finally {
      g.VideoEncoder = saved
    }
  })
})

describe('WebCodecsRecorder', () => {
  let recorder: WebCodecsRecorder
  let callbacks: {
    onStart: Mock
    onPause: Mock
    onResume: Mock
    onStop: Mock
    onError: Mock
    onAudioLevels: Mock
  }
  let audio: AudioContextDoubleControl
  let videoTrack: TrackDouble
  let systemAudioTrack: TrackDouble
  let screenStream: MediaStream
  let micStream: MediaStream
  let consoleLog: ReturnType<typeof vi.spyOn>
  let consoleWarn: ReturnType<typeof vi.spyOn>
  let consoleError: ReturnType<typeof vi.spyOn>
  let now = 0

  beforeEach(() => {
    vi.useFakeTimers()
    now = 100_000

    rafCallbacks.clear()
    nextRafHandle = 1
    originalRaf = globalThis.requestAnimationFrame
    originalCancelRaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const handle = nextRafHandle++
      rafCallbacks.set(handle, cb)
      return handle
    }) as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = ((handle: number) => {
      rafCallbacks.delete(handle)
    }) as typeof globalThis.cancelAnimationFrame

    installWebCodecsDoubles()
    resetWebCodecsDoubles()
    resetMediabunnyDouble()
    installVideoElementDouble()
    audio = installAudioContextDouble()

    // `now` moves only where a test moves it, and most tests never do. The
    // audio level monitor gates itself to one sample per 80ms of
    // `performance.now()`, so a test that ticks rAF without advancing `now`
    // sees exactly one sample per take — the immediate one
    // `startAudioLevelMonitoring()` takes before the first frame — and
    // `tickAnimationFrames()` will never produce another. A test that wants
    // repeated emissions has to advance `now` between ticks; the per-second
    // rates live in core/webcodecsRecorder.perf.test.ts, which does exactly
    // that. The frame-timing tests advance it too: since this fix `now` is the
    // clock every frame timestamp and `getDuration()` are read from, while
    // `vi.advanceTimersByTime()` drives the capture timer and nothing else.
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    callbacks = {
      onStart: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
      onAudioLevels: vi.fn(),
    }

    videoTrack = createTrackDouble('video', { id: 'screen-video', label: 'Screen 1' })
    systemAudioTrack = createTrackDouble('audio', { id: 'system-audio' })
    screenStream = createStreamDouble([videoTrack, systemAudioTrack])
    micStream = createStreamDouble([createTrackDouble('audio', { id: 'mic-audio' })])

    recorder = new WebCodecsRecorder(callbacks)
  })

  afterEach(() => {
    recorder.dispose()
    uninstallTrackProcessorDouble()
    uninstallVideoElementDouble()
    uninstallAudioContextDouble()
    uninstallWebCodecsDoubles()
    globalThis.requestAnimationFrame = originalRaf
    globalThis.cancelAnimationFrame = originalCancelRaf
    rafCallbacks.clear()
    // Restore spies (performance.now among them) before handing the timers
    // back, so nothing is left pointing at a faked clock.
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // --- initialize ----------------------------------------------------------

  describe('initialize', () => {
    it('refuses to initialize when WebCodecs is unavailable', async () => {
      const g = globalThis as unknown as Record<string, unknown>
      const saved = g.VideoEncoder
      delete g.VideoEncoder
      try {
        await expect(recorder.initialize(screenStream, null, null, defaultConfig)).rejects.toThrow(
          'WebCodecs recording is not supported in this browser'
        )
      } finally {
        g.VideoEncoder = saved
      }
    })

    it('throws when neither stream offers a video track', async () => {
      await expect(recorder.initialize(null, null, null, defaultConfig)).rejects.toThrow(
        'No video track available for recording'
      )
    })

    it('throws when the enabled stream has no video track', async () => {
      await expect(
        recorder.initialize(createStreamDouble([]), null, null, defaultConfig)
      ).rejects.toThrow('No video track available for recording')
    })

    it('prefers the webcam track when the screen is disabled', async () => {
      const webcamTrack = createTrackDouble('video', {
        id: 'webcam-video',
        settings: { width: 640, height: 480 },
      })
      await recorder.initialize(null, createStreamDouble([webcamTrack]), null, {
        ...defaultConfig,
        screenEnabled: false,
        webcamEnabled: true,
      })

      expect(lastVideoEncoder().configureCalls[0]).toMatchObject({ width: 640, height: 480 })
    })

    it('falls back to 1920x1080 when the track reports no dimensions', async () => {
      const track = createTrackDouble('video', { settings: {} })
      await recorder.initialize(createStreamDouble([track]), null, null, defaultConfig)

      expect(lastVideoEncoder().configureCalls[0]).toMatchObject({ width: 1920, height: 1080 })
    })

    it('builds a WebM output with a VP9 video track and starts it before encoding', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)

      const state = getMediabunnyState()
      expect(state.formats.map(f => f.name)).toEqual(['webm'])
      expect(state.videoSources[0].codec).toBe('vp9')
      expect(lastMediabunnyOutput().tracks[0]).toMatchObject({ kind: 'video', options: { frameRate: 30 } })
      expect(state.callLog.indexOf('Output.start')).toBeGreaterThan(
        state.callLog.indexOf('Output.addVideoTrack')
      )
      expect(lastVideoEncoder().configureCalls[0]).toMatchObject({ codec: 'vp09.00.10.08' })
    })

    it.each([
      [1920, 1080, 8_000_000],
      [1280, 720, 5_000_000],
      [640, 480, 2_500_000],
    ])('picks the %ix%i bitrate (%i bps)', async (width, height, bitrate) => {
      const track = createTrackDouble('video', { settings: { width, height } })
      await recorder.initialize(createStreamDouble([track]), null, null, defaultConfig)

      expect(lastVideoEncoder().configureCalls[0]).toMatchObject({ bitrate })
    })

    it('adds an Opus audio track and configures the audio encoder when audio is mixed in', async () => {
      await recorder.initialize(screenStream, micStream, micStream, {
        ...defaultConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      })

      expect(getMediabunnyState().audioSources[0].codec).toBe('opus')
      expect(lastAudioEncoder().configureCalls[0]).toEqual({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      })
      // one analyser per audio source (system + microphone)
      expect(lastAudioContext().analysers).toHaveLength(2)
    })

    it('skips the audio track entirely when the mix has no audio', async () => {
      audio.destinationTrackCount = 0
      await recorder.initialize(screenStream, null, null, defaultConfig)

      expect(getMediabunnyState().audioSources).toHaveLength(0)
      expect(lastMediabunnyOutput().addAudioTrack).not.toHaveBeenCalled()
      expect(AudioEncoderDouble.instances).toHaveLength(0)
      expect(lastAudioContext().scriptProcessors).toHaveLength(0)
    })

    it('resumes a suspended AudioContext', async () => {
      audio.initialState = 'suspended'
      await recorder.initialize(screenStream, null, null, defaultConfig)

      expect(lastAudioContext().resume).toHaveBeenCalledTimes(1)
      expect(lastAudioContext().state).toBe('running')
    })

    it('does not resume an already-running AudioContext', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      expect(lastAudioContext().resume).not.toHaveBeenCalled()
    })

    it('ignores system audio when the config disables it', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      expect(lastAudioContext().analysers).toHaveLength(0)
    })

    it('uses the video-element fallback when MediaStreamTrackProcessor is absent', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)

      expect(consoleLog).toHaveBeenCalledWith('Falling back to video element for frame capture')
      const video = getLastVideoDouble()!
      expect(document.body.contains(video.element)).toBe(true)
      expect(video.play).toHaveBeenCalled()
    })
  })

  // --- start / capture (video element + setTimeout) ------------------------

  describe('frame capture via video element and setTimeout', () => {
    /** One frame interval of the recorder's 30fps target, in milliseconds. */
    const FRAME_MS = 1000 / 30

    /**
     * Let the capture timer fire `count` more times, moving the recording
     * clock on by one frame interval each time. The timers and
     * `performance.now()` are separate faked clocks here, so a test that only
     * advanced the timers would drive the loop against a frozen clock.
     */
    function captureFrames(count: number): void {
      for (let i = 0; i < count; i++) {
        now += FRAME_MS
        // One timer step per iteration: 34ms is past the 33.3ms timer and
        // short of the one after it, so exactly one frame lands per call.
        vi.advanceTimersByTime(Math.ceil(FRAME_MS))
      }
    }

    beforeEach(async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
    })

    it('throws when start() is called before initialize()', () => {
      const fresh = new WebCodecsRecorder(callbacks)
      expect(() => fresh.start()).toThrow('Recorder not initialized')
      fresh.dispose()
    })

    it('encodes the first frame immediately and reports onStart', () => {
      recorder.start()

      expect(callbacks.onStart).toHaveBeenCalledTimes(1)
      expect(recorder.isRecording()).toBe(true)
      const encoder = lastVideoEncoder()
      expect(encoder.encodes).toHaveLength(1)
      expect(encoder.encodes[0].options).toEqual({ keyFrame: true })
      expect(encoder.encodes[0].data.timestamp).toBe(0)
    })

    it('draws the live video into the capture canvas at the track resolution', () => {
      recorder.start()
      const video = getLastVideoDouble()!
      const frame = getCreatedFrames('VideoFrame')[0]

      // The frame is built from the capture canvas, sized to the track.
      const canvas = frame.source as HTMLCanvasElement
      expect(canvas.width).toBe(1920)
      expect(canvas.height).toBe(1080)
      expect(getCanvasContext(canvas)!.drawImage).toHaveBeenCalledWith(
        video.element,
        0,
        0,
        1920,
        1080
      )
    })

    // Pins keyframes to *elapsed time*, not to a frame count: the first frame
    // at or past each whole second of the recording clock is a keyframe. The
    // count-based rule this replaced (`frameCount % 30`) only coincided with
    // one keyframe per second while the source really delivered 30fps.
    it('emits a keyframe once per elapsed second and delta frames in between', () => {
      recorder.start()
      captureFrames(30) // one second of the recording clock

      const encodes = lastVideoEncoder().encodes
      expect(encodes.length).toBeGreaterThanOrEqual(31)
      expect(encodes[0].options).toEqual({ keyFrame: true })
      expect(encodes[1].options).toEqual({ keyFrame: false })
      expect(encodes[29].options).toEqual({ keyFrame: false })
      expect(encodes[30].options).toEqual({ keyFrame: true })
    })

    // Was "advances the frame timestamp by one frame duration each time":
    // frame N was stamped N x 33333us whenever it was actually captured. Now
    // the stamp is the recording clock at capture, so a source running slower
    // than 30fps produces a video track as long as the take (the rounding of
    // 33.333ms is why the third frame is 66667 and not 66666).
    it('stamps each frame with the recording clock', () => {
      recorder.start()
      captureFrames(2)

      const encodes = lastVideoEncoder().encodes
      expect(encodes[0].data.timestamp).toBe(0)
      expect(encodes[1].data.timestamp).toBe(33333)
      expect(encodes[2].data.timestamp).toBe(66667)
    })

    it('closes every VideoFrame it creates', () => {
      recorder.start()
      vi.advanceTimersByTime(200)

      expect(getCreatedFrames('VideoFrame').length).toBeGreaterThan(1)
      expect(allFramesClosed()).toBe(true)
    })

    it('muxes each encoded chunk into the video packet source', async () => {
      recorder.start()
      vi.advanceTimersByTime(100)
      await flush()

      const source = getMediabunnyState().videoSources[0]
      expect(source.packets.length).toBe(lastVideoEncoder().encodes.length)
      expect(source.packets[0].packet).toMatchObject({ type: 'key' })
    })

    it('stops encoding while paused and resumes afterwards', () => {
      recorder.start()
      const encoder = lastVideoEncoder()
      const beforePause = encoder.encodes.length

      recorder.pause()
      expect(callbacks.onPause).toHaveBeenCalled()
      expect(recorder.isPaused()).toBe(true)
      vi.advanceTimersByTime(200)
      expect(encoder.encodes).toHaveLength(beforePause)

      recorder.resume()
      expect(callbacks.onResume).toHaveBeenCalled()
      vi.advanceTimersByTime(200)
      expect(encoder.encodes.length).toBeGreaterThan(beforePause)
    })

    it('ignores pause()/resume() when not recording', () => {
      recorder.pause()
      recorder.resume()
      expect(callbacks.onPause).not.toHaveBeenCalled()
      expect(callbacks.onResume).not.toHaveBeenCalled()
    })

    it('logs and keeps going when a frame fails to encode', () => {
      recorder.start()
      lastVideoEncoder().failAt = 'encodeThrow'
      vi.advanceTimersByTime(100)

      expect(consoleError).toHaveBeenCalledWith('Frame capture error:', expect.any(Error))
      // The capture timer is still armed despite the failure.
      expect(recorder.isRecording()).toBe(true)
    })

    it('surfaces an asynchronous encoder error through onError', () => {
      recorder.start()
      lastVideoEncoder().emitError('boom')

      expect(consoleError).toHaveBeenCalledWith('Video encoder error:', expect.any(Error))
      expect(callbacks.onError).toHaveBeenCalledWith(new Error('Video encoder error: boom'))
    })
  })

  // --- start / capture (video element + requestVideoFrameCallback) ---------

  describe('frame capture via requestVideoFrameCallback', () => {
    let frameCallbacks: Array<() => void>

    /**
     * Present one video frame to the capture loop, `ms` after the previous
     * one. This is the path that shows the row's bug: `getDisplayMedia` hands
     * over frames whenever the window repaints, which for a screen capture is
     * routinely 5-15 a second rather than 30.
     */
    function presentFrame(ms = 0): void {
      now += ms
      frameCallbacks.pop()!()
    }

    /** The timestamp, in microseconds, of every frame encoded so far. */
    function timestamps(): Array<number | undefined> {
      return lastVideoEncoder().encodes.map(e => e.data.timestamp)
    }

    beforeEach(async () => {
      frameCallbacks = []
      Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
        configurable: true,
        writable: true,
        value: (cb: () => void) => {
          frameCallbacks.push(cb)
          return frameCallbacks.length
        },
      })
      await recorder.initialize(screenStream, null, null, defaultConfig)
    })

    afterEach(() => {
      delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).requestVideoFrameCallback
    })

    it('captures one frame per presented video frame', () => {
      // start() only arms the callback; nothing is encoded until a frame lands.
      recorder.start()
      expect(frameCallbacks).toHaveLength(1)
      expect(lastVideoEncoder().encodes).toHaveLength(0)

      presentFrame()
      presentFrame(1000 / 30)
      presentFrame(1000 / 30)

      const encodes = lastVideoEncoder().encodes
      expect(encodes).toHaveLength(3)
      // The recording clock at capture, not the frame index x 33333us.
      expect(timestamps()).toEqual([0, 33333, 66667])
      expect(encodes.map(e => e.options)).toEqual([
        { keyFrame: true },
        { keyFrame: false },
        { keyFrame: false },
      ])
      expect(allFramesClosed()).toBe(true)
    })

    it('spans wall time when the source only delivers 15 frames a second', () => {
      // The row's failure: a window capture running at half the target rate.
      // Counting frames made 15 frames span half a second of video against a
      // whole second of audio - playback at 2x, with the audio lagging.
      recorder.start()

      presentFrame()
      presentFrame(1000 / 15)
      presentFrame(1000 / 15)

      expect(timestamps()).toEqual([0, 66667, 133333])
    })

    it('keeps timestamps strictly increasing when the clock does not move', () => {
      // Mediabunny rejects a packet that does not advance on the one before
      // it, so a coarse or frozen clock must not be allowed to stall the mux.
      recorder.start()

      presentFrame()
      presentFrame()
      presentFrame()

      expect(timestamps()).toEqual([0, 1, 2])
      expect(lastVideoEncoder().encodes.map(e => e.options)).toEqual([
        { keyFrame: true },
        { keyFrame: false },
        { keyFrame: false },
      ])
    })

    it('emits a keyframe once per elapsed second however few frames arrive', () => {
      // 2.5fps: the old count-based rule (every 30th frame) would have put one
      // keyframe every twelve seconds into a take like this.
      recorder.start()

      presentFrame()
      presentFrame(400)
      presentFrame(400)
      presentFrame(400)

      expect(timestamps()).toEqual([0, 400_000, 800_000, 1_200_000])
      expect(lastVideoEncoder().encodes.map(e => e.options?.keyFrame)).toEqual([
        true,
        false,
        false,
        true,
      ])
    })

    it('excludes paused time from the frame timestamps', () => {
      recorder.start()

      presentFrame()
      presentFrame(100)
      recorder.pause()
      now += 5000
      recorder.resume()
      presentFrame(100)

      // The frame after the resume carries on from where the take left off:
      // five seconds of paused wall time are not five seconds of video.
      expect(timestamps()).toEqual([0, 100_000, 200_000])
    })

    it('skips paused frames but keeps the callback loop alive', () => {
      recorder.start()
      recorder.pause()

      frameCallbacks.pop()!()

      expect(lastVideoEncoder().encodes).toHaveLength(0)
      expect(frameCallbacks).toHaveLength(1)
    })

    it('stops requesting frames once recording ends', async () => {
      recorder.start()
      await recorder.stop()

      frameCallbacks.pop()!()
      expect(frameCallbacks).toHaveLength(0)
    })

    it('logs a frame error without tearing down the loop', () => {
      recorder.start()
      lastVideoEncoder().failAt = 'encodeThrow'

      frameCallbacks.pop()!()

      expect(consoleError).toHaveBeenCalledWith('Frame capture error:', expect.any(Error))
      expect(frameCallbacks).toHaveLength(1)
    })
  })

  // --- start / capture (MediaStreamTrackProcessor) -------------------------

  describe('frame capture via MediaStreamTrackProcessor', () => {
    let processor: TrackProcessorControl

    beforeEach(async () => {
      processor = installTrackProcessorDouble()
      await recorder.initialize(screenStream, null, null, defaultConfig)
    })

    it('reads frames straight off the track instead of a video element', () => {
      expect(consoleLog).toHaveBeenCalledWith('Using MediaStreamTrackProcessor for frame capture')
      expect(processor.tracks).toEqual([videoTrack])
      expect(document.body.querySelector('video')).toBeNull()
    })

    it('re-times each source frame and closes both the source and the copy', async () => {
      recorder.start()
      const source = new VideoFrameDouble('raw-0', { timestamp: 999_999 })
      processor.pushFrame(source)
      await flush()

      const encodes = lastVideoEncoder().encodes
      expect(encodes).toHaveLength(1)
      expect(encodes[0].data.timestamp).toBe(0)
      expect(encodes[0].options).toEqual({ keyFrame: true })
      expect(encodes[0].data.source).toBe(source)
      expect(source.closed).toBe(true)
      expect(allFramesClosed()).toBe(true)
    })

    it('drops frames that arrive faster than the target frame rate', async () => {
      recorder.start()
      processor.pushFrame(new VideoFrameDouble('raw-0', { timestamp: 0 }))
      await flush()
      expect(lastVideoEncoder().encodes).toHaveLength(1)

      // Same instant — inside the 26.6ms throttle window.
      const dropped = new VideoFrameDouble('raw-1', { timestamp: 1 })
      processor.pushFrame(dropped)
      await flush()
      expect(lastVideoEncoder().encodes).toHaveLength(1)
      expect(dropped.closed).toBe(true)

      now += 40
      processor.pushFrame(new VideoFrameDouble('raw-2', { timestamp: 2 }))
      await flush()
      expect(lastVideoEncoder().encodes).toHaveLength(2)
      // ...and the frame that survived the throttle is stamped with the
      // recording clock, 40ms in. This is the only path a Chrome/Edge screen
      // take actually runs on, so it is the one that has to prove it tracks
      // wall time: under the old `frameCount x 33333us` rule the second
      // encoded frame was 33333 however long it took to arrive.
      expect(lastVideoEncoder().encodes.map(e => e.data.timestamp)).toEqual([0, 40_000])
    })

    it('discards frames that arrive while paused', async () => {
      recorder.start()
      recorder.pause()
      now += 100
      const paused = new VideoFrameDouble('raw-paused', { timestamp: 0 })
      processor.pushFrame(paused)
      await flush()

      expect(lastVideoEncoder().encodes).toHaveLength(0)
      expect(paused.closed).toBe(true)
    })

    it('discards frames once the encoder has closed', async () => {
      recorder.start()
      lastVideoEncoder().close()
      now += 100
      const late = new VideoFrameDouble('raw-late', { timestamp: 0 })
      processor.pushFrame(late)
      await flush()

      expect(lastVideoEncoder().encodes).toHaveLength(0)
      expect(late.closed).toBe(true)
    })

    it('logs and closes the source frame when encoding throws', async () => {
      recorder.start()
      lastVideoEncoder().failAt = 'encodeThrow'
      const source = new VideoFrameDouble('raw-0', { timestamp: 0 })
      processor.pushFrame(source)
      await flush()

      expect(consoleError).toHaveBeenCalledWith('Frame encoding error:', expect.any(Error))
      expect(source.closed).toBe(true)
    })

    it('ends the read loop when the track stream finishes', async () => {
      recorder.start()
      processor.finish()
      await flush()

      now += 100
      processor.pushFrame(new VideoFrameDouble('raw-after-done', { timestamp: 0 }))
      await flush()
      expect(lastVideoEncoder().encodes).toHaveLength(0)
    })

    it('warns when the reader fails while still recording', async () => {
      recorder.start()
      processor.failNextRead(new Error('track torn down'))
      await flush()

      expect(consoleWarn).toHaveBeenCalledWith('Track processor read error:', expect.any(Error))
    })

    it('cancels the reader on stop()', async () => {
      recorder.start()
      await recorder.stop()

      expect(processor.cancelCalls()).toBeGreaterThanOrEqual(1)
    })
  })

  // --- audio capture -------------------------------------------------------

  describe('audio capture', () => {
    beforeEach(async () => {
      await recorder.initialize(screenStream, null, micStream, {
        ...defaultConfig,
        microphoneEnabled: true,
      })
    })

    it('wires a script processor between the mixed stream and the destination', () => {
      const ctx = lastAudioContext()
      expect(ctx.scriptProcessors).toHaveLength(1)
      expect(ctx.scriptProcessors[0].bufferSize).toBe(4096)
      expect(ctx.scriptProcessors[0].connect).toHaveBeenCalledWith(ctx.destination)
    })

    it('encodes interleaved-to-planar audio and advances the timestamp', () => {
      recorder.start()
      const node = lastAudioContext().scriptProcessors[0]
      const buffer = createAudioBufferDouble({ length: 4, sample: (c, i) => c * 10 + i })

      node.onaudioprocess!({ inputBuffer: buffer })
      node.onaudioprocess!({ inputBuffer: buffer })

      const encodes = lastAudioEncoder().encodes
      expect(encodes).toHaveLength(2)
      const first = encodes[0].data.init!
      expect(first.format).toBe('f32-planar')
      expect(first.numberOfFrames).toBe(4)
      expect(first.timestamp).toBe(0)
      // planar layout: [L0..L3, R0..R3]
      expect(Array.from(first.data as Float32Array)).toEqual([0, 1, 2, 3, 10, 11, 12, 13])
      // 4 frames at 48kHz = 83.33µs
      expect(encodes[1].data.init!.timestamp).toBeCloseTo((4 / 48000) * 1_000_000, 5)
      expect(getCreatedFrames('AudioData').every(f => f.closed)).toBe(true)
    })

    it('ignores audio callbacks before start and while paused', () => {
      const node = lastAudioContext().scriptProcessors[0]
      const buffer = createAudioBufferDouble({ length: 4 })

      node.onaudioprocess!({ inputBuffer: buffer })
      expect(lastAudioEncoder().encodes).toHaveLength(0)

      recorder.start()
      recorder.pause()
      node.onaudioprocess!({ inputBuffer: buffer })
      expect(lastAudioEncoder().encodes).toHaveLength(0)
    })

    it('logs an audio encoding failure instead of throwing out of the callback', () => {
      recorder.start()
      lastAudioEncoder().failAt = 'encodeThrow'
      const node = lastAudioContext().scriptProcessors[0]

      expect(() =>
        node.onaudioprocess!({ inputBuffer: createAudioBufferDouble({ length: 4 }) })
      ).not.toThrow()
      expect(consoleError).toHaveBeenCalledWith('Audio encoding error:', expect.any(Error))
    })

    it('logs an asynchronous audio encoder error', () => {
      lastAudioEncoder().emitError('audio boom')
      expect(consoleError).toHaveBeenCalledWith('Audio encoder error:', expect.any(Error))
    })

    it('muxes encoded audio into the Opus packet source', async () => {
      recorder.start()
      const node = lastAudioContext().scriptProcessors[0]
      node.onaudioprocess!({ inputBuffer: createAudioBufferDouble({ length: 4 }) })
      await flush()

      expect(getMediabunnyState().audioSources[0].packets).toHaveLength(1)
    })
  })

  // --- audio level monitoring ---------------------------------------------

  describe('audio level monitoring', () => {
    it('zeroes the meters once for a take with no audio, then runs no loop', async () => {
      // Previously this reported { microphone: 0, system: 0 } on every
      // animation frame. With no analyser wired up there is nothing to
      // measure, so there is no loop — but the one sample still has to be
      // sent: the store keeps the last take's levels, and a take that asked
      // for system audio and did not get it would otherwise show the previous
      // take's bar, frozen.
      await recorder.initialize(screenStream, null, null, defaultConfig)

      expect(callbacks.onAudioLevels).toHaveBeenCalledTimes(1)
      expect(callbacks.onAudioLevels).toHaveBeenCalledWith({ microphone: 0, system: 0 })
      expect(rafCallbacks.size).toBe(0)

      tickAnimationFrames()
      expect(callbacks.onAudioLevels).toHaveBeenCalledTimes(1)
    })

    it('reports zero for the source that is absent', async () => {
      audio.analyserLevel = 128
      await recorder.initialize(screenStream, null, micStream, {
        ...defaultConfig,
        microphoneEnabled: true,
      })

      expect(callbacks.onAudioLevels).toHaveBeenLastCalledWith({ microphone: 1, system: 0 })
    })

    it('normalises analyser RMS into a 0-1 level for each source', async () => {
      audio.analyserLevel = 128
      await recorder.initialize(screenStream, null, micStream, {
        ...defaultConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      })

      tickAnimationFrames()

      expect(callbacks.onAudioLevels).toHaveBeenLastCalledWith({ microphone: 1, system: 1 })
      expect(lastAudioContext().analysers.every(a => a.fftSize === 256)).toBe(true)
    })

    it('stops the monitor loop on dispose', async () => {
      // A take with a microphone, so there is a loop to stop: initialised with
      // no audio at all the monitor never starts, and this test would pass
      // whether dispose() cancelled anything or not.
      await recorder.initialize(screenStream, null, micStream, {
        ...defaultConfig,
        microphoneEnabled: true,
      })
      tickAnimationFrames()
      expect(rafCallbacks.size).toBe(1)
      const before = callbacks.onAudioLevels.mock.calls.length

      recorder.dispose()

      // Nothing left scheduled — and so nothing left to emit.
      expect(rafCallbacks.size).toBe(0)
      tickAnimationFrames()
      expect(callbacks.onAudioLevels.mock.calls).toHaveLength(before)
    })
  })

  // --- stop ---------------------------------------------------------------

  describe('stop', () => {
    beforeEach(async () => {
      await recorder.initialize(screenStream, null, micStream, {
        ...defaultConfig,
        microphoneEnabled: true,
      })
    })

    it('flushes both encoders, closes them, finalizes the muxer, then emits the blob', async () => {
      recorder.start()
      await recorder.stop()

      expect(webcodecsCallLog.filter(c => c.endsWith('flush'))).toEqual([
        'VideoEncoder.flush',
        'AudioEncoder.flush',
      ])
      expect(webcodecsCallLog.indexOf('VideoEncoder.flush')).toBeLessThan(
        webcodecsCallLog.indexOf('VideoEncoder.close')
      )
      expect(webcodecsCallLog.indexOf('AudioEncoder.flush')).toBeLessThan(
        webcodecsCallLog.indexOf('AudioEncoder.close')
      )
      expect(lastMediabunnyOutput().finalizeCalls).toBe(1)

      const blob = callbacks.onStop.mock.calls[0][0] as Blob
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('video/webm')
      expect(blob.size).toBe(128)
      expect(callbacks.onError).not.toHaveBeenCalled()
    })

    it('does nothing when the recorder was never started', async () => {
      await recorder.stop()
      expect(callbacks.onStop).not.toHaveBeenCalled()
      expect(lastMediabunnyOutput().finalizeCalls).toBe(0)
    })

    it('reports an error when the muxer produced no bytes', async () => {
      getMediabunnyState().producesBuffer = false
      recorder.start()
      await recorder.stop()

      expect(callbacks.onStop).not.toHaveBeenCalled()
      expect(callbacks.onError).toHaveBeenCalledWith(new Error('Recording failed: no data was written'))
    })

    it('reports a finalize failure through onError', async () => {
      getMediabunnyState().finalizeError = new Error('muxer exploded')
      recorder.start()
      await recorder.stop()

      expect(consoleError).toHaveBeenCalledWith('Error finalizing recording:', expect.any(Error))
      expect(callbacks.onError).toHaveBeenCalledWith(new Error('muxer exploded'))
    })

    it('skips encoders that are already closed', async () => {
      recorder.start()
      const video = lastVideoEncoder()
      const audioEncoder = lastAudioEncoder()
      video.close()
      audioEncoder.close()

      await recorder.stop()

      expect(video.flushCalls).toBe(0)
      expect(audioEncoder.flushCalls).toBe(0)
      expect(callbacks.onStop).toHaveBeenCalled()
    })

    it('releases the capture element, audio graph and track listener', async () => {
      recorder.start()
      const video = getLastVideoDouble()!
      const node = lastAudioContext().scriptProcessors[0]

      await recorder.stop()

      expect(document.body.contains(video.element)).toBe(false)
      expect(video.pause).toHaveBeenCalled()
      expect(node.disconnect).toHaveBeenCalled()
      expect(videoTrack.listenerCount('ended')).toBe(0)
      expect(recorder.isRecording()).toBe(false)
    })
  })

  // --- track ended --------------------------------------------------------

  describe('source track ending', () => {
    it('stops the recording when the user stops sharing mid-recording', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      recorder.start()

      videoTrack.end()
      await flush()

      expect(consoleWarn).toHaveBeenCalledWith('Video track ended: Screen 1')
      expect(consoleWarn).toHaveBeenCalledWith('Video track ended during recording, stopping...')
      expect(callbacks.onStop).toHaveBeenCalled()
    })

    it('stops and delivers the take when sharing stops while paused', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      recorder.start()
      recorder.pause()

      videoTrack.end()
      await flush()

      // Paused is still an active take: the capture is dead and cannot be
      // resumed, so what has been encoded so far has to be finalized.
      expect(consoleWarn).toHaveBeenCalledWith('Video track ended during recording, stopping...')
      // `null`, not absent: WebCodecsRecorder always reports whether the take
      // had a webcam companion, and an ordinary take says it had none.
      expect(callbacks.onStop).toHaveBeenCalledWith(expect.any(Blob), null)
      expect(recorder.isPaused()).toBe(false)
    })

    it('reports an error when the track ends before recording starts', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)

      videoTrack.end()
      await flush()

      expect(consoleWarn).toHaveBeenCalledWith('Video track ended: Screen 1')
      expect(consoleWarn).not.toHaveBeenCalledWith('Video track ended during recording, stopping...')
      expect(callbacks.onStop).not.toHaveBeenCalled()
      // Nothing was captured — but the countdown is still running upstream and
      // must be told, or it starts a take with no source.
      expect(callbacks.onError).toHaveBeenCalledWith(
        new Error('Capture ended before recording started')
      )
    })

    it('ignores the track ending after the take has already been stopped', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      recorder.start()

      const stopping = recorder.stop()
      // stop() drops isRecordingActive on its first line but then awaits the
      // reader cancel, both encoder flushes and output.finalize(); the 'ended'
      // listener is only removed by the finally. A user who presses Stop and
      // then clicks "Stop sharing" fires the event inside that window — and an
      // onError there would dispose the muxer mid-finalize and lose the take.
      videoTrack.end()
      await stopping
      await flush()

      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onStop).toHaveBeenCalledWith(expect.any(Blob), null)
    })

    it('survives the track ending before start with no callbacks registered', async () => {
      const bare = new WebCodecsRecorder()
      await bare.initialize(screenStream, null, null, defaultConfig)

      expect(() => videoTrack.end()).not.toThrow()
      await flush()

      bare.dispose()
    })
  })

  // --- duration & state ---------------------------------------------------

  describe('duration and state', () => {
    beforeEach(async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
    })

    it('is zero before start', () => {
      expect(recorder.getDuration()).toBe(0)
      expect(recorder.isRecording()).toBe(false)
      expect(recorder.isPaused()).toBe(false)
    })

    // The duration and the frame timestamps read one clock — `performance.now()`
    // — so what the user is told the take is worth and what is written into the
    // container cannot drift apart. These tests advance that clock, not the
    // timers: the two are faked separately here.
    it('tracks elapsed time while recording', () => {
      recorder.start()
      now += 2000
      expect(recorder.getDuration()).toBeCloseTo(2, 1)
    })

    it('reports the duration from the clock the frames are stamped with', () => {
      recorder.start()
      now += 1500
      vi.advanceTimersByTime(34) // let the capture timer stamp one more frame

      const last = lastVideoEncoder().encodes.at(-1)!.data.timestamp
      expect(last).toBe(1_500_000)
      expect(recorder.getDuration()).toBeCloseTo(last! / 1_000_000, 5)
    })

    it('never reports recording and paused at the same time', () => {
      recorder.start()
      expect(recorder.isRecording()).toBe(true)
      expect(recorder.isPaused()).toBe(false)

      recorder.pause()
      expect(recorder.isRecording()).toBe(false)
      expect(recorder.isPaused()).toBe(true)

      recorder.resume()
      expect(recorder.isRecording()).toBe(true)
      expect(recorder.isPaused()).toBe(false)
    })

    it('excludes paused time from the duration, live and after resume', () => {
      recorder.start()
      now += 1000
      recorder.pause()
      now += 5000
      expect(recorder.getDuration()).toBeCloseTo(1, 1)

      recorder.resume()
      now += 1000
      expect(recorder.getDuration()).toBeCloseTo(2, 1)
    })
  })

  // --- dispose ------------------------------------------------------------

  describe('dispose', () => {
    it('tears down an active recording without finalizing a blob', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      recorder.start()

      recorder.dispose()
      vi.advanceTimersByTime(500)

      expect(recorder.isRecording()).toBe(false)
      expect(callbacks.onStop).not.toHaveBeenCalled()
      expect(lastAudioContext().close).toHaveBeenCalled()
      expect(document.body.querySelector('video')).toBeNull()
    })

    it('is safe to call repeatedly, initialized or not', async () => {
      expect(() => {
        recorder.dispose()
        recorder.dispose()
      }).not.toThrow()

      await recorder.initialize(screenStream, null, null, defaultConfig)
      expect(() => {
        recorder.dispose()
        recorder.dispose()
      }).not.toThrow()
    })

    it('works without any callbacks registered', async () => {
      const bare = new WebCodecsRecorder()
      await bare.initialize(screenStream, null, null, defaultConfig)
      bare.start()
      await expect(bare.stop()).resolves.toBeUndefined()
      bare.dispose()
      expect(VideoEncoderDouble.instances.length).toBeGreaterThan(0)
    })
  })

  // --- separate tracks (ESCSUITE-14) ---------------------------------------

  describe('separate tracks', () => {
    const separateConfig: RecordingConfig = {
      ...defaultConfig,
      webcamEnabled: true,
      separateTracks: true,
    }

    let processor: TrackProcessorControl
    let webcamTrack: TrackDouble
    let webcamStream: MediaStream

    beforeEach(() => {
      processor = installTrackProcessorDouble()
      webcamTrack = createTrackDouble('video', {
        id: 'webcam-video',
        label: 'FaceTime HD',
        settings: { width: 640, height: 480 },
      })
      webcamStream = createStreamDouble([webcamTrack])
    })

    /** A frame as the track processor delivers one. */
    function sourceFrame(): VideoFrame {
      return new VideoFrameDouble({}, { timestamp: 0 }) as unknown as VideoFrame
    }

    /** The screen encoder is constructed first, so instances are [screen, webcam]. */
    const screenEncoder = () => VideoEncoderDouble.instances[0]
    const webcamEncoder = () => VideoEncoderDouble.instances[1]

    /**
     * Make the Nth VideoEncoder the recorder constructs refuse its
     * `configure()`, as a browser that will not encode those dimensions does.
     * Subclassing the installed double rather than reaching for an instance,
     * because both encoders are constructed inside one `initialize()` await
     * chain — there is no moment between them for a test to reach in. Hands
     * back the restore.
     */
    function refuseEncoderConfigure(nth: 1 | 2): () => void {
      const g = globalThis as unknown as Record<string, unknown>
      const Installed = g.VideoEncoder as typeof VideoEncoderDouble
      class RefusingEncoder extends Installed {
        constructor(...args: ConstructorParameters<typeof VideoEncoderDouble>) {
          super(...args)
          // The base constructor has already registered `this`, so the count
          // is this encoder's own ordinal.
          if (VideoEncoderDouble.instances.length === nth) this.failAt = 'configure'
        }
      }
      g.VideoEncoder = RefusingEncoder
      return () => {
        g.VideoEncoder = Installed
      }
    }

    /**
     * Make the Nth AudioEncoder the recorder constructs refuse its
     * `configure()`. The mirror of `refuseEncoderConfigure`, and subclassing
     * for the same reason: every encoder in a take is constructed inside one
     * `initialize()` await chain, so there is no moment between them for a
     * test to reach in. Hands back the restore.
     */
    function refuseAudioEncoderConfigure(nth: 1 | 2 | 3): () => void {
      const g = globalThis as unknown as Record<string, unknown>
      const Installed = g.AudioEncoder as typeof AudioEncoderDouble
      class RefusingAudioEncoder extends Installed {
        constructor(...args: ConstructorParameters<typeof AudioEncoderDouble>) {
          super(...args)
          if (AudioEncoderDouble.instances.length === nth) this.failAt = 'configure'
        }
      }
      g.AudioEncoder = RefusingAudioEncoder
      return () => {
        g.AudioEncoder = Installed
      }
    }

    it('builds a second encoder and a second WebM output, the webcam one silent', async () => {
      await recorder.initialize(screenStream, webcamStream, micStream, {
        ...separateConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      })

      const state = getMediabunnyState()
      // Four outputs and three audio encoders, because this take really has
      // three audio pipelines since slice 3: the mix on the primary, and one
      // file each for the microphone and the system audio. The two *video*
      // pipelines are what this test is about, and they are unchanged.
      expect(state.outputs).toHaveLength(4)
      expect(state.formats.map(f => f.name)).toEqual(['webm', 'webm', 'webm', 'webm'])
      expect(VideoEncoderDouble.instances).toHaveLength(2)
      // Sized from its own track, not from the screen's.
      expect(screenEncoder().configureCalls[0]).toMatchObject({ width: 1920, height: 1080 })
      expect(webcamEncoder().configureCalls[0]).toMatchObject({ width: 640, height: 480 })
      // Slice 1, and still true: the mix stays on the primary, and the webcam
      // companion is silent.
      expect(state.outputs[0].addAudioTrack).toHaveBeenCalledTimes(1)
      expect(state.outputs[1].addAudioTrack).not.toHaveBeenCalled()
      expect(AudioEncoderDouble.instances).toHaveLength(3)
    })

    it('stamps both encoders from the one clock — same tick, same timestamp', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()

      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      // One clock: the two blobs are aligned by construction rather than by
      // measurement, which is the whole reason this is one recorder and not two.
      expect(screenEncoder().encodes[0].data.timestamp).toBe(40_000)
      expect(webcamEncoder().encodes[0].data.timestamp).toBe(40_000)
      // Per-encoder keyframe schedules: each stream's first frame is a keyframe,
      // because each will be decoded on its own.
      expect(screenEncoder().encodes[0].options).toEqual({ keyFrame: true })
      expect(webcamEncoder().encodes[0].options).toEqual({ keyFrame: true })
    })

    it('excludes paused time from both pipelines', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 100
      recorder.pause()
      now += 500
      recorder.resume()
      now += 100

      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      expect(screenEncoder().encodes[0].data.timestamp).toBe(200_000)
      expect(webcamEncoder().encodes[0].data.timestamp).toBe(200_000)
    })

    it('flushes both encoders, finalizes both outputs and delivers two blobs', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      await recorder.stop()

      expect(screenEncoder().flushCalls).toBe(1)
      expect(webcamEncoder().flushCalls).toBe(1)
      expect(getMediabunnyState().outputs.every(o => o.finalizeCalls === 1)).toBe(true)
      const [blob, companions] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      // A take can have up to three companions now (ESCSUITE-14 slice 3), so
      // the callback carries a list in role order — webcam, mic, system.
      expect(companions).toEqual([
        {
          role: 'webcam',
          blob: expect.any(Blob),
          startOffset: 0,
        },
      ])
    })

    it('keeps recording the screen when the webcam dies mid-take', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('webcam-video', sourceFrame())
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      webcamTrack.end()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      // The camera stopping is not the take stopping: the screen keeps going
      // and the webcam half simply ends where the camera did. The webcam has
      // its own 'ended' handler for exactly that reason — the primary's ends
      // the take.
      expect(consoleWarn).toHaveBeenCalledWith('Webcam track ended: FaceTime HD')
      expect(consoleWarn).not.toHaveBeenCalledWith(
        'Video track ended during recording, stopping...'
      )
      expect(recorder.isRecording()).toBe(true)
      expect(screenEncoder().encodes).toHaveLength(2)
      expect(webcamEncoder().encodes).toHaveLength(1)

      await recorder.stop()
      expect(callbacks.onStop.mock.calls[0][1]).toMatchObject([{ role: 'webcam' }])
    })

    it('delivers no companion when the webcam never produced a frame', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      await recorder.stop()

      // An empty webcam file would be a library row that plays nothing and a
      // second source ARTIST would import for no reason.
      expect(callbacks.onStop.mock.calls[0][1]).toBeNull()
    })

    it('still delivers the primary when the companion cannot be written', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      // The companion's output is the second one; make its finalize throw.
      getMediabunnyState().outputs[1].finalize.mockRejectedValueOnce(new Error('muxer died'))

      await recorder.stop()

      const [blob, companion] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companion).toBeNull()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith(
        'The webcam companion could not be finalized:',
        expect.any(Error)
      )
    })

    it('still delivers the primary when the companion encoder will not flush', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      webcamEncoder().failAt = 'flush'

      await recorder.stop()

      // The companion's flush is the take's last chance to be lost: it runs
      // before the primary's own finalize, so a rejection there used to skip
      // the finalize altogether and report onError over a finished recording.
      expect(getMediabunnyState().outputs[0].finalizeCalls).toBe(1)
      const [blob, companion] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companion).toBeNull()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith(
        'The webcam companion could not be flushed:',
        expect.any(Error)
      )
    })

    it('keeps recording the screen when the companion encoder errors', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      webcamEncoder().emitError('camera encoder died')
      await flush()

      // The primary's encoder dying *is* the take dying, so its error goes to
      // onError — which disposes the recorder. The webcam's must not: a camera
      // hiccup at minute four of a screen recording cannot throw the screen
      // recording away.
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith('Webcam track encoder failed: camera encoder died')
      expect(recorder.isRecording()).toBe(true)

      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()
      expect(screenEncoder().encodes).toHaveLength(2)

      await recorder.stop()
      const [blob, companion] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companion).toBeNull()
    })

    it('builds no companion when the screen stream never arrived', async () => {
      // `screenEnabled` with no screen stream is a real state: useMediaStreams
      // only asks for display capture when it can, and a take may start with
      // just one of its enabled sources. The primary is then the webcam itself
      // — a companion on that same track would encode one camera into two
      // files and leave a second 'ended' listener attached for good.
      await recorder.initialize(null, webcamStream, null, separateConfig)

      expect(VideoEncoderDouble.instances).toHaveLength(1)
      expect(getMediabunnyState().outputs).toHaveLength(1)
      expect(webcamTrack.listenerCount('ended')).toBe(1)

      recorder.start()
      now += 40
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()
      expect(lastVideoEncoder().encodes).toHaveLength(1)

      await recorder.stop()

      const [blob, companion] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companion).toBeNull()
      // ...and the single listener is the single listener cleanup removes.
      expect(webcamTrack.listenerCount('ended')).toBe(0)
    })

    it('sizes a companion the camera gives no dimensions for at 1280x720', async () => {
      // The primary falls back to 1920x1080 because a screen capture is a
      // screen; a webcam that will not say is far likelier to be 720p.
      const vague = createTrackDouble('video', { id: 'webcam-video', settings: {} })
      await recorder.initialize(screenStream, createStreamDouble([vague]), null, separateConfig)

      expect(webcamEncoder().configureCalls[0]).toMatchObject({ width: 1280, height: 720 })
    })

    it('delivers no companion when the companion muxer wrote no bytes', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      // Finalizes without complaint and leaves the target empty — the third
      // way to end up with no companion, and the one that would otherwise
      // hand the save path a Blob built from nothing.
      getMediabunnyState().outputs[1].finalize.mockResolvedValueOnce(undefined)

      await recorder.stop()

      const [blob, companion] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companion).toBeNull()
      expect(callbacks.onError).not.toHaveBeenCalled()
    })

    it('records the screen alone when the webcam stream has no video track', async () => {
      await recorder.initialize(screenStream, createStreamDouble([]), null, separateConfig)

      expect(VideoEncoderDouble.instances).toHaveLength(1)
      expect(getMediabunnyState().outputs).toHaveLength(1)
      expect(consoleWarn).toHaveBeenCalledWith(
        'Separate tracks asked for, but the webcam stream has no video track — recording the screen alone'
      )
    })

    it('records the screen alone where there is no MediaStreamTrackProcessor', async () => {
      uninstallTrackProcessorDouble()

      await recorder.initialize(screenStream, webcamStream, null, separateConfig)

      // The gate on the toggle asks the same question
      // (`canRecordSeparateTracks`), so reaching here means the API went away
      // between the click and the take — the take is still recorded.
      expect(VideoEncoderDouble.instances).toHaveLength(1)
      expect(consoleWarn).toHaveBeenCalledWith(
        'No MediaStreamTrackProcessor — recording the screen alone'
      )
    })

    it('records the screen alone when the webcam pipeline cannot be set up', async () => {
      // `canRecordSeparateTracks()` proves the two APIs exist; it cannot prove
      // the camera's dimensions are an encodable VP9 config. A refusal here
      // used to reject initialize() and cost the user the whole take —
      // START_FAILED, back to idle, and no way to record at all until they
      // found the toggle and un-ticked it.
      const restore = refuseEncoderConfigure(2)
      try {
        await expect(
          recorder.initialize(screenStream, webcamStream, null, separateConfig)
        ).resolves.toBeUndefined()
      } finally {
        restore()
      }

      expect(consoleWarn).toHaveBeenCalledWith(
        'Webcam track could not be set up:',
        expect.any(Error)
      )
      expect(callbacks.onError).not.toHaveBeenCalled()
      // The camera is let go rather than left held by a reader nothing will
      // ever cancel: with `companion` back to null, neither stop() nor
      // cleanup() can reach it.
      expect(processor.cancelCalls()).toBe(1)

      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      // Exactly one encoder is capturing — the refused one is closed and gets
      // no frames — and the take is an ordinary single-file one.
      expect(VideoEncoderDouble.instances).toHaveLength(2)
      expect(screenEncoder().encodes).toHaveLength(1)
      expect(webcamEncoder().encodes).toHaveLength(0)

      await recorder.stop()

      const [blob, companion] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companion).toBeNull()
      expect(callbacks.onError).not.toHaveBeenCalled()
    })

    it('still fails the take when the screen encoder refuses its configuration', async () => {
      // The guard above is the companion's alone. The primary pipeline *is*
      // the take: a screen that cannot be encoded has to fail loudly, so the
      // controller says START_FAILED rather than recording nothing.
      const restore = refuseEncoderConfigure(1)
      try {
        await expect(
          recorder.initialize(screenStream, webcamStream, null, separateConfig)
        ).rejects.toThrow('VideoEncoder configuration failed')
      } finally {
        restore()
      }

      expect(consoleWarn).not.toHaveBeenCalledWith(
        'Webcam track could not be set up:',
        expect.any(Error)
      )
    })

    it('ignores the flag for a webcam-only take', async () => {
      await recorder.initialize(null, webcamStream, null, {
        ...separateConfig,
        screenEnabled: false,
      })

      // There is nothing to separate the webcam *from*: it is the take.
      expect(VideoEncoderDouble.instances).toHaveLength(1)
      expect(getMediabunnyState().outputs).toHaveLength(1)
    })

    // --- audio companions (slice 3) ---------------------------------------

    /** A separate-tracks take with both audio sources really present. */
    async function initializeWithAudioCompanions(): Promise<void> {
      await recorder.initialize(screenStream, webcamStream, micStream, {
        ...separateConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      })
    }

    /** The ScriptProcessor each pipeline drives: 0 is the mix, then mic, then system. */
    const processorFor = (index: number) => lastAudioContext().scriptProcessors[index]
    const audioBuffer = (length = 4) =>
      createAudioBufferDouble({ length, sample: (c, i) => c * 10 + i })

    it('gives the microphone and the system audio an Opus-only WebM each', async () => {
      await initializeWithAudioCompanions()

      const state = getMediabunnyState()
      // Primary, webcam, mic, system — in that order, so the webcam companion
      // is still outputs[1] for every test that addresses it that way.
      expect(state.outputs).toHaveLength(4)
      expect(state.formats.map(f => f.name)).toEqual(['webm', 'webm', 'webm', 'webm'])
      // The two audio companions carry one audio track and no video track at
      // all: every ARTIST read path and CRAFT's own converter are single-track
      // by construction, which is the whole reason these are separate files.
      for (const output of [state.outputs[2], state.outputs[3]]) {
        expect(output.tracks.map(t => t.kind)).toEqual(['audio'])
        expect(output.startCalls).toBe(1)
      }
      expect(state.audioSources.map(s => s.codec)).toEqual(['opus', 'opus', 'opus'])
      // ...and the mix is exactly where it was: on the primary.
      expect(state.outputs[0].addAudioTrack).toHaveBeenCalledTimes(1)
      expect(state.outputs[1].addAudioTrack).not.toHaveBeenCalled()
      // One encoder for the mix, one per companion.
      expect(AudioEncoderDouble.instances).toHaveLength(3)
      for (const encoder of AudioEncoderDouble.instances) {
        expect(encoder.configureCalls[0]).toMatchObject({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      }
    })

    it('feeds each audio companion its own source, through its own processor', async () => {
      await initializeWithAudioCompanions()

      const ctx = lastAudioContext()
      // The mix's processor, then the microphone's, then the system audio's.
      expect(ctx.scriptProcessors).toHaveLength(3)
      for (const node of ctx.scriptProcessors) {
        expect(node.bufferSize).toBe(4096)
        expect(node.connect).toHaveBeenCalledWith(ctx.destination)
      }
      // Two analysers and no more: the meters read the mix's own sources, and
      // a companion must not add a third meter to a panel that draws two.
      expect(ctx.analysers).toHaveLength(2)
    })

    it('stamps every pipeline from the same origin, one buffer at a time', async () => {
      await initializeWithAudioCompanions()
      recorder.start()

      for (const index of [0, 1, 2]) {
        processorFor(index).onaudioprocess!({ inputBuffer: audioBuffer() })
        processorFor(index).onaudioprocess!({ inputBuffer: audioBuffer() })
      }

      const [mix, mic, system] = AudioEncoderDouble.instances
      for (const encoder of [mix, mic, system]) {
        expect(encoder.encodes).toHaveLength(2)
        // Every pipeline's first buffer is the take's zero, and every
        // pipeline's second is one buffer later — 4 frames at 48kHz. One
        // origin and one sample-rate arithmetic is what "the same clock"
        // means here; a shared counter would have three callbacks stamping
        // each other's audio.
        expect(encoder.encodes[0].data.init!.timestamp).toBe(0)
        expect(encoder.encodes[1].data.init!.timestamp).toBeCloseTo(
          (4 / 48000) * 1_000_000,
          5
        )
        expect(encoder.encodes[0].data.init!.format).toBe('f32-planar')
        // Planar layout, interleaved input: [L0..L3, R0..R3].
        expect(Array.from(encoder.encodes[0].data.init!.data as Float32Array)).toEqual([
          0, 1, 2, 3, 10, 11, 12, 13,
        ])
      }
      expect(getCreatedFrames('AudioData').every(f => f.closed)).toBe(true)
    })

    it('ignores audio companion callbacks before start and while paused', async () => {
      await initializeWithAudioCompanions()

      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[1].encodes).toHaveLength(0)

      recorder.start()
      recorder.pause()
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[1].encodes).toHaveLength(0)

      recorder.resume()
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[1].encodes).toHaveLength(1)
      // Paused time is excluded from every pipeline the same way: the buffers
      // dropped while paused were never counted, so the first buffer after a
      // resume is still the second buffer of the recording.
      expect(AudioEncoderDouble.instances[1].encodes[0].data.init!.timestamp).toBe(0)
    })

    it("muxes each companion's audio into its own Opus packet source", async () => {
      await initializeWithAudioCompanions()
      recorder.start()

      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      processorFor(2).onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      const [mixSource, micSource, systemSource] = getMediabunnyState().audioSources
      expect(mixSource.packets).toHaveLength(0)
      expect(micSource.packets).toHaveLength(1)
      expect(systemSource.packets).toHaveLength(1)
    })

    it('delivers the take as four parts, in role order', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      processorFor(2).onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      await recorder.stop()

      const [blob, companions] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companions).toEqual([
        { role: 'webcam', blob: expect.any(Blob), startOffset: 0 },
        { role: 'mic', blob: expect.any(Blob), startOffset: 0 },
        { role: 'system', blob: expect.any(Blob), startOffset: 0 },
      ])
      // An audio companion is an audio file, and the save path reads the
      // blob's own type into the stored mimeType.
      expect(companions[1].blob.type).toBe('audio/webm')
      expect(companions[2].blob.type).toBe('audio/webm')
      expect(companions[0].blob.type).toBe('video/webm')
    })

    it('builds a companion only for the audio sources the take really has', async () => {
      // The microphone is on but was never acquired, and system audio is off.
      // The mix asks the same two questions, so the companions and the mix can
      // never disagree about what the take is recording.
      await recorder.initialize(screenStream, webcamStream, null, {
        ...separateConfig,
        microphoneEnabled: true,
        systemAudioEnabled: false,
      })

      // One encoder — the mix's own, which the AudioContext double's mixed
      // destination always offers a track for — and no companion's. Two
      // outputs: the screen and the webcam.
      expect(AudioEncoderDouble.instances).toHaveLength(1)
      expect(getMediabunnyState().outputs).toHaveLength(2)
    })

    it('builds a system companion only when the display capture carries audio', async () => {
      // Ticking "System Audio" only *asks* for it: the browser's share dialog
      // has the tick box, and the stream comes back with no audio track when
      // the user leaves it clear (ESCSUITE-62).
      const silentScreen = createStreamDouble([videoTrack])
      await recorder.initialize(silentScreen, webcamStream, micStream, {
        ...separateConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      })

      // The mix (mic only) and the microphone companion. No system anything.
      expect(AudioEncoderDouble.instances).toHaveLength(2)
      expect(getMediabunnyState().outputs).toHaveLength(3)
    })

    it('logs an audio companion encode failure instead of throwing out of the callback', async () => {
      // The mirror of the mix's own guard: a ScriptProcessor callback that
      // throws tears the node's whole graph down, which for this take would
      // take the mix and the other companion with it.
      await initializeWithAudioCompanions()
      recorder.start()
      AudioEncoderDouble.instances[1].failAt = 'encodeThrow'

      expect(() =>
        processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      ).not.toThrow()

      expect(consoleError).toHaveBeenCalledWith('Audio encoding error:', expect.any(Error))
      expect(AudioEncoderDouble.instances[1].encodes).toHaveLength(0)

      // The buffer that threw advanced neither the count nor the clock, so the
      // next one is still this pipeline's first — an encoder that recovers must
      // not leave a hole where the failed buffer was.
      AudioEncoderDouble.instances[1].failAt = null
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[1].encodes[0].data.init!.timestamp).toBe(0)
      // ...and the other pipelines never noticed.
      processorFor(2).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[2].encodes).toHaveLength(1)
      expect(recorder.isRecording()).toBe(true)
    })

    it('keeps the take when an audio companion encoder gives up', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      processorFor(2).onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      const micNode = processorFor(1)
      const encodesBefore = AudioEncoderDouble.instances[1].encodes.length
      const audioDataBefore = getCreatedFrames('AudioData').length

      AudioEncoderDouble.instances[1].emitError('mic encoder died')
      await flush()

      // A microphone hiccup at minute four of a screen recording cannot throw
      // the screen recording — or the camera, or the system audio — away.
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith('Microphone track encoder failed: mic encoder died')
      expect(recorder.isRecording()).toBe(true)

      // ...and the dead pipeline stops working, the way the webcam's reader
      // does. A WebCodecs error closes the codec, so every later buffer would
      // interleave 4096 frames into a fresh 32KB planar array, build an
      // AudioData, throw InvalidStateError out of encode() — leaking that
      // AudioData, because close() is the statement after it — and log once
      // per buffer, ~11.7 times a second for the rest of the take. The
      // cheapest possible failure must not be the take's most expensive thing.
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[1].encodes).toHaveLength(encodesBefore)
      expect(getCreatedFrames('AudioData')).toHaveLength(audioDataBefore)
      expect(getCreatedFrames('AudioData').every(f => f.closed)).toBe(true)
      expect(consoleError).not.toHaveBeenCalled()
      // The node itself is let go too, rather than left driving a callback that
      // only ever returns at its first line.
      expect(micNode.disconnect).toHaveBeenCalledTimes(1)

      // The other two audio pipelines are untouched — still connected, still
      // encoding. Isolation is the whole point of a per-pipeline failure.
      expect(processorFor(0).disconnect).not.toHaveBeenCalled()
      expect(processorFor(2).disconnect).not.toHaveBeenCalled()
      processorFor(2).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[2].encodes).toHaveLength(2)

      await recorder.stop()

      const companions = callbacks.onStop.mock.calls[0][1]
      expect(companions.map((part: { role: string }) => part.role)).toEqual([
        'webcam',
        'system',
      ])
    })

    it('leaves out an audio companion that never got a buffer', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      await recorder.stop()

      // A take shorter than one 4096-sample buffer, or a source that went
      // silent at the socket: an empty Opus file is a library row that plays
      // nothing.
      const companions = callbacks.onStop.mock.calls[0][1]
      expect(companions.map((part: { role: string }) => part.role)).toEqual([
        'webcam',
        'mic',
      ])
    })

    it('still delivers the take when an audio companion will not flush', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      AudioEncoderDouble.instances[1].failAt = 'flush'

      await recorder.stop()

      expect(getMediabunnyState().outputs[0].finalizeCalls).toBe(1)
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith(
        'The microphone companion could not be flushed:',
        expect.any(Error)
      )
      expect(callbacks.onStop.mock.calls[0][1]).toBeNull()
    })

    it('records the take without the microphone when its pipeline cannot be set up', async () => {
      // `canRecordSeparateTracks()` proves WebCodecs is there; it cannot prove
      // this browser will configure a third Opus encoder. A refusal here costs
      // one track, never the take.
      const restore = refuseAudioEncoderConfigure(2)
      try {
        await expect(initializeWithAudioCompanions()).resolves.toBeUndefined()
      } finally {
        restore()
      }

      expect(consoleWarn).toHaveBeenCalledWith(
        'Microphone track could not be set up:',
        expect.any(Error)
      )
      expect(callbacks.onError).not.toHaveBeenCalled()

      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      // The system companion is the third processor no more — the microphone's
      // was never connected.
      lastAudioContext().scriptProcessors[1].onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      await recorder.stop()

      const companions = callbacks.onStop.mock.calls[0][1]
      expect(companions.map((part: { role: string }) => part.role)).toEqual([
        'webcam',
        'system',
      ])
    })

    it('disconnects every audio companion processor when the take is torn down', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      const processors = [...lastAudioContext().scriptProcessors]

      recorder.dispose()

      // Three processors, three disconnects — the mix's included. A live
      // ScriptProcessorNode keeps its whole graph running after the recording
      // is over, and this take builds three of them.
      for (const node of processors) {
        expect(node.disconnect).toHaveBeenCalledTimes(1)
      }
    })

    // --- per-role "could not be set up" warning (ESCSUITE-72 item 3) -------
    //
    // Each role's setup-failure warning is `${trackLabel} track could not be
    // set up:`, one template shared across `COMPANION_PARTS`. The webcam and
    // microphone cases were already pinned by value elsewhere in this file;
    // this table adds the system-audio case beside them so a fourth role
    // added to the table later gets the same coverage rather than a grep.
    it.each([
      {
        role: 'webcam',
        message: 'Webcam track could not be set up:',
        setup: async () => {
          const restore = refuseEncoderConfigure(2)
          try {
            await recorder.initialize(screenStream, webcamStream, null, separateConfig)
          } finally {
            restore()
          }
        },
      },
      {
        role: 'microphone',
        message: 'Microphone track could not be set up:',
        setup: async () => {
          const restore = refuseAudioEncoderConfigure(2)
          try {
            await initializeWithAudioCompanions()
          } finally {
            restore()
          }
        },
      },
      {
        role: 'system audio',
        message: 'System audio track could not be set up:',
        setup: async () => {
          const restore = refuseAudioEncoderConfigure(3)
          try {
            await initializeWithAudioCompanions()
          } finally {
            restore()
          }
        },
      },
    ])('warns "$message" when the $role pipeline cannot be set up', async ({ setup, message }) => {
      await setup()

      expect(consoleWarn).toHaveBeenCalledWith(message, expect.any(Error))
      // A companion that cannot be set up costs that one track, never the
      // take — the same contract for all three roles.
      expect(callbacks.onError).not.toHaveBeenCalled()
    })
  })
})
