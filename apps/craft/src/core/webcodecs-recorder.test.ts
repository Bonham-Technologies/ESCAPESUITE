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

    it('emits a keyframe once per second and delta frames in between', () => {
      recorder.start()
      vi.advanceTimersByTime(1000) // 30 more frames at 33.3ms

      const encodes = lastVideoEncoder().encodes
      expect(encodes.length).toBeGreaterThanOrEqual(31)
      expect(encodes[0].options).toEqual({ keyFrame: true })
      expect(encodes[1].options).toEqual({ keyFrame: false })
      expect(encodes[29].options).toEqual({ keyFrame: false })
      expect(encodes[30].options).toEqual({ keyFrame: true })
    })

    it('advances the frame timestamp by one frame duration each time', () => {
      recorder.start()
      vi.advanceTimersByTime(100)

      const encodes = lastVideoEncoder().encodes
      expect(encodes[0].data.timestamp).toBe(0)
      expect(encodes[1].data.timestamp).toBe(33333)
      expect(encodes[2].data.timestamp).toBe(66666)
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

      frameCallbacks.pop()!()
      frameCallbacks.pop()!()
      frameCallbacks.pop()!()

      const encodes = lastVideoEncoder().encodes
      expect(encodes).toHaveLength(3)
      expect(encodes.map(e => e.data.timestamp)).toEqual([0, 33333, 66666])
      expect(encodes.map(e => e.options)).toEqual([
        { keyFrame: true },
        { keyFrame: false },
        { keyFrame: false },
      ])
      expect(allFramesClosed()).toBe(true)
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
    it('reports zero for absent analysers', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      expect(callbacks.onAudioLevels).toHaveBeenLastCalledWith({ microphone: 0, system: 0 })
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
      await recorder.initialize(screenStream, null, null, defaultConfig)
      const before = callbacks.onAudioLevels.mock.calls.length

      recorder.dispose()
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

    it('only warns when the track ends before recording starts', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)

      videoTrack.end()
      await flush()

      expect(consoleWarn).toHaveBeenCalledWith('Video track ended: Screen 1')
      expect(consoleWarn).not.toHaveBeenCalledWith('Video track ended during recording, stopping...')
      expect(callbacks.onStop).not.toHaveBeenCalled()
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

    it('tracks elapsed time while recording', () => {
      recorder.start()
      vi.advanceTimersByTime(2000)
      expect(recorder.getDuration()).toBeCloseTo(2, 1)
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
      vi.advanceTimersByTime(1000)
      recorder.pause()
      vi.advanceTimersByTime(5000)
      expect(recorder.getDuration()).toBeCloseTo(1, 1)

      recorder.resume()
      vi.advanceTimersByTime(1000)
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
})
