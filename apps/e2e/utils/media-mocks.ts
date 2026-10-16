import { Page } from '@playwright/test'

/**
 * Utilities for mocking media APIs in Playwright tests
 */

/**
 * Every init script below that wants to override a `navigator.mediaDevices`
 * method replaces the **whole** `mediaDevices` property rather than
 * assigning one method on it (`navigator.mediaDevices.foo = fn`) — in the
 * committed specs that used the assignment form, the override was
 * demonstrably not in effect by the time the app called it (the WebKit
 * recording specs failed with the browser's own `NotAllowedError`, which only
 * fires from the native `getUserMedia`). A minimal repro of the bare
 * assignment on a fresh page does not reproduce a dropped override on any of
 * the three engines, so the precise mechanism is not established — but
 * `Object.defineProperty(navigator, 'mediaDevices', { value: {...} })` is
 * strictly more robust regardless (it replaces the property outright instead
 * of relying on whatever `navigator.mediaDevices` happens to return being
 * mutable), so that is the form used everywhere here (ESCSUITE-177).
 *
 * `{ ...navigator.mediaDevices, ...overrides }` is **not** that: `MediaDevices`'
 * own methods live on `MediaDevices.prototype`, and object spread copies only
 * *own enumerable* properties, of which a fresh `navigator.mediaDevices` has
 * none — `Object.keys({ ...navigator.mediaDevices })` is `[]` on all three
 * engines. Every override below therefore goes through
 * `window.__layerMediaDevices(overrides)`, installed once per document by
 * `installMediaDevicesLayer()` (idempotent — a second call's init script sees
 * the helper already there and does nothing), which *walks the prototype
 * chain* binding each native method to the original object before layering
 * `overrides` on top:
 *
 *     for (let o = native; o && o !== Object.prototype; o = getPrototypeOf(o))
 *       for (const key of getOwnPropertyNames(o)) layered[key] = bind(native[key])
 *
 * `Object.create(native)` is not a substitute — a native method invoked with
 * `this` bound to a derived object throws "Illegal invocation". Binding is
 * also why every override layers onto whatever is already there instead of
 * erasing it: `mockGetUserMedia`/`mockSyntheticMedia`'s `getUserMedia`/
 * `getDisplayMedia` land on top of `mockMediaDevices`'s `enumerateDevices`,
 * and `error-mocks.ts`'s wrappers land on top of a real, callable
 * `getUserMedia` to fall back to.
 */
export async function installMediaDevicesLayer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __layerMediaDevices?: (overrides: Record<string, unknown>) => void
    }
    if (w.__layerMediaDevices) return

    w.__layerMediaDevices = (overrides: Record<string, unknown>) => {
      const native = navigator.mediaDevices as unknown as Record<string, unknown>
      const layered: Record<string, unknown> = {}
      for (
        let proto: object | null = native;
        proto && proto !== Object.prototype;
        proto = Object.getPrototypeOf(proto)
      ) {
        for (const key of Object.getOwnPropertyNames(proto)) {
          if (key === 'constructor' || key in layered) continue
          const value = native[key]
          layered[key] =
            typeof value === 'function'
              ? (value as (...args: unknown[]) => unknown).bind(native)
              : value
        }
      }
      Object.assign(layered, overrides)
      Object.defineProperty(navigator, 'mediaDevices', { value: layered, configurable: true })
    }
  })
}

/**
 * Report a camera and a microphone from `enumerateDevices`.
 *
 * ESCAPECRAFT's capability detection (`apps/craft/src/core/permissions.ts`)
 * marks the webcam and microphone unavailable when no matching input device is
 * enumerated, which renders their source toggles `disabled`. A CI runner has no
 * camera or microphone attached, so those toggles are dead there while they are
 * live on a developer laptop — any test that clicks one passes locally and
 * times out in CI. Stubbing the device list makes the toggles behave the same
 * either way.
 *
 * This only says the devices *exist*. Whether they can be opened is
 * `getUserMedia`'s business, so a test that mocks it to reject still exercises
 * exactly the failure it was written for.
 *
 * Must be called BEFORE navigating.
 */
export async function mockMediaDevices(page: Page) {
  await installMediaDevicesLayer(page)
  await page.addInitScript(() => {
    const enumerateDevices = async () =>
      [
        { deviceId: 'mock-camera', kind: 'videoinput', label: 'Mock Camera', groupId: 'mock' },
        { deviceId: 'mock-mic', kind: 'audioinput', label: 'Mock Microphone', groupId: 'mock' },
        { deviceId: 'mock-speaker', kind: 'audiooutput', label: 'Mock Speaker', groupId: 'mock' },
      ].map((device) => ({ ...device, toJSON: () => device })) as MediaDeviceInfo[]

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ enumerateDevices })
  })
}

/** What a captured track builder installed on `window.__syntheticMedia` offers. */
interface SyntheticMediaBuilders {
  makeVideoTrack(): MediaStreamTrack
  makeAudioTrack(): MediaStreamTrack
}

/** Seconds between sync markers when `markers` is on — a flash and a beep each. */
export const MARKER_PERIOD_MS = 10_000

/** How long each flash and each beep lasts when `markers` is on. */
export const MARKER_PULSE_MS = 100

/**
 * The marker schedule a `markers: true` document keeps on
 * `window.__markers`: `t0` is the `performance.now()` the schedule counts
 * from, `scheduled` every beep placed (its index, the context time it was
 * placed at and the wall time it stands for), `missed` the indices skipped
 * because their time had already passed when they were scheduled.
 */
export interface MarkerState {
  t0: number
  period: number
  pulse: number
  scheduled: { k: number; contextTime: number; wallMs: number }[]
  missed: number[]
}

/** Options shared by `installSyntheticMediaBuilders` and `mockSyntheticMedia`. */
export interface SyntheticMediaOptions {
  width?: number
  height?: number
  painter?: 'interval' | 'raf'
  /**
   * A/V drift rig only (ESCSUITE-296, `tests/perf/craft-av-drift.spec.ts`):
   * paint the whole frame white and gate a 1 kHz tone on for
   * {@link MARKER_PULSE_MS} at the head of every {@link MARKER_PERIOD_MS},
   * both on one `performance.now()` schedule, with the tone silent in between;
   * and stamp every frame with its paint time as a 32-cell timecode strip
   * along the top-left edge (decoded by `scripts/av-drift-report.mjs`).
   * Off by default; with it off nothing about the synthetic media changes.
   */
  markers?: boolean
}

/**
 * Install `window.__syntheticMedia` — a real canvas-backed video track
 * builder and a silent oscillator-backed audio track builder — once per
 * document (idempotent, the same pattern as `installMediaDevicesLayer`
 * above). `mockGetUserMedia` and `mockSyntheticMedia` both layer their
 * `getUserMedia`/`getDisplayMedia` overrides on top of this, so there is
 * exactly one implementation of "what a captured track actually is"
 * (ESCSUITE-207).
 *
 * Must be called BEFORE navigating.
 */
export async function installSyntheticMediaBuilders(
  page: Page,
  options: SyntheticMediaOptions = {}
): Promise<void> {
  const width = options.width ?? 640
  const height = options.height ?? 360
  // ESCSUITE-86: which loop paints the source canvas. `'interval'` is the
  // historical painter — a bare `setInterval(…, 33)` (30.3 Hz) racing the
  // 30 Hz `captureStream` sampler, which the ESCAPECRAFT recording benchmarks'
  // sub-30fps numbers were suspected to be beating against rather than a real
  // recorder cost. `'raf'` paints once per `requestAnimationFrame` callback
  // instead, which cannot beat against the capture rate the way a fixed
  // interval can. Selected by `PERF_PAINTER` in `tests/perf/craft-recording.spec.ts`
  // for a paired before/after; every other caller leaves this unset and gets
  // the unchanged `'interval'` behaviour.
  const painter = options.painter ?? 'interval'
  // A/V drift rig (ESCSUITE-296): opt-in sync markers. Off unless a caller
  // asks, and every marker branch below is behind it, so the benchmarks and
  // every other spec paint and sound exactly as before.
  const markers = options.markers === true

  await page.addInitScript(
    ({ width, height, painter, markers, period, pulse }) => {
      const w = window as unknown as {
        __syntheticMedia?: SyntheticMediaBuilders
        __markers?: MarkerState
      }
      if (w.__syntheticMedia) return

      // One wall-clock schedule for every track this document opens: a flash
      // and a beep at `t0 + k * period` for `pulse` ms, keyed off
      // `performance.now()` — the clock the WebCodecs recorder stamps video
      // with, so the schedule is "the truth" both tracks are measured against.
      if (markers && !w.__markers) {
        w.__markers = { t0: performance.now(), period, pulse, scheduled: [], missed: [] }
      }
      const markerState = markers ? w.__markers! : undefined

      const makeVideoTrack = (): MediaStreamTrack => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!

        // Animate so every captured frame differs (encoders need real motion)
        let frame = 0
        const paintPattern = () => {
          ctx.fillStyle = `hsl(${frame % 360}, 70%, 45%)`
          ctx.fillRect(0, 0, width, height)
          ctx.fillStyle = '#ffffff'
          ctx.font = `${Math.round(height / 8)}px sans-serif`
          ctx.fillText(`E2E ${frame}`, 40, height / 2)
        }
        // Markers: a flash at the head of every period, and on every frame a
        // timecode — the paint's `performance.now() − t0` in whole ms, 31 bits
        // MSB first plus an even-parity bit, as 32 black/white square cells of
        // width/40 px along the top-left edge — so the analysis can read, for
        // any frame that survived, the wall time it was painted at, however
        // many frames around it the recorder dropped.
        const cell = Math.floor(width / 40)
        const paintMarkers = (state: MarkerState) => {
          const elapsed = performance.now() - state.t0
          if (elapsed % state.period < state.pulse) {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, width, height)
          } else {
            paintPattern()
          }
          const value = Math.max(0, Math.round(elapsed)) % 0x80000000
          let parity = 0
          for (let bit = 0; bit < 32; bit++) {
            const on = bit < 31 ? Math.floor(value / 2 ** (30 - bit)) % 2 : parity
            if (bit < 31) parity ^= on
            ctx.fillStyle = on ? '#ffffff' : '#000000'
            ctx.fillRect(bit * cell, 0, cell, cell)
          }
        }
        const paint = () => {
          frame += 1
          if (markerState) paintMarkers(markerState)
          else paintPattern()
        }

        // ESCSUITE-86: stop painting when the track stops. Before this, every
        // `getDisplayMedia`/`getUserMedia` call started a new loop and the
        // previous one — from a track a test had already stopped — kept
        // painting (and, for the interval painter, kept an interval alive) for
        // the rest of the page's life; a test that opened the mock more than
        // once leaked one loop per open. It was invisible for the interval
        // painter, whose rate nothing here counts, but the rAF painter's loop
        // calls `requestAnimationFrame` itself, and the paired benchmark's own
        // `rafPerSecond` counter (a `requestAnimationFrame` wrapper) saw every
        // leaked loop's callbacks alongside the live one's — see the
        // `rafPerSecond` readings of 120/180/240 across a round's three takes
        // in the ESCSUITE-86 baseline note. `stop()` is the normal path, but a
        // recorder can also end a track another way, so `ended` is covered too.
        let running = true
        let intervalId: ReturnType<typeof setInterval> | undefined
        const stopPainting = () => {
          running = false
          if (intervalId !== undefined) clearInterval(intervalId)
        }

        if (painter === 'raf') {
          const loop = () => {
            if (!running) return
            paint()
            requestAnimationFrame(loop)
          }
          requestAnimationFrame(loop)
        } else {
          intervalId = setInterval(paint, 33)
        }

        const track = (canvas as HTMLCanvasElement & {
          captureStream(fps?: number): MediaStream
        })
          .captureStream(30)
          .getVideoTracks()[0]

        const nativeStop = track.stop.bind(track)
        track.stop = () => {
          stopPainting()
          nativeStop()
        }
        track.addEventListener('ended', stopPainting)

        return track
      }

      const makeAudioTrack = (): MediaStreamTrack => {
        const audioContext = new AudioContext()
        const destination = audioContext.createMediaStreamDestination()
        const oscillator = audioContext.createOscillator()
        if (!markerState) {
          oscillator.frequency.value = 440
          oscillator.connect(destination)
          oscillator.start()
          return destination.stream.getAudioTracks()[0]
        }
        return makeMarkerAudioTrack(audioContext, destination, oscillator, markerState)
      }

      /**
       * A 1 kHz tone gated to silence except for a `pulse`-ms beep at the head
       * of every marker period. Each beep is placed on the wall-clock schedule
       * by mapping its `performance.now()` time into this context's time with
       * `getOutputTimestamp()` — re-read every 250 ms and only ever used for
       * beeps at most 2.5 s ahead, so a context whose clock runs off
       * `performance.now()` still beeps on the wall-clock schedule rather than
       * on its own. A beep whose context time has already passed by the time
       * it is scheduled (a main thread stalled for longer than the lookahead)
       * is skipped and logged in `missed`, never sounded late.
       */
      const makeMarkerAudioTrack = (
        audioContext: AudioContext,
        destination: MediaStreamAudioDestinationNode,
        oscillator: OscillatorNode,
        state: MarkerState
      ): MediaStreamTrack => {
        oscillator.frequency.value = 1000
        const gate = audioContext.createGain()
        gate.gain.value = 0
        oscillator.connect(gate)
        gate.connect(destination)
        oscillator.start()

        const done = new Set<number>()
        const contextTimeAt = (wallMs: number): number => {
          const stamp = audioContext.getOutputTimestamp()
          if (stamp.performanceTime && stamp.contextTime !== undefined) {
            return stamp.contextTime + (wallMs - stamp.performanceTime) / 1000
          }
          return audioContext.currentTime + (wallMs - performance.now()) / 1000
        }
        const schedule = () => {
          const now = performance.now()
          const first = Math.ceil((now - state.t0) / state.period)
          const last = Math.floor((now + 2500 - state.t0) / state.period)
          for (let k = first; k <= last; k++) {
            if (done.has(k)) continue
            done.add(k)
            const at = contextTimeAt(state.t0 + k * state.period)
            if (at <= audioContext.currentTime + 0.005) {
              state.missed.push(k)
              continue
            }
            gate.gain.setValueAtTime(1, at)
            gate.gain.setValueAtTime(0, at + state.pulse / 1000)
            state.scheduled.push({ k, contextTime: at, wallMs: state.t0 + k * state.period })
          }
        }
        schedule()
        const timer = setInterval(schedule, 250)

        const track = destination.stream.getAudioTracks()[0]
        const nativeStop = track.stop.bind(track)
        track.stop = () => {
          clearInterval(timer)
          nativeStop()
        }
        track.addEventListener('ended', () => clearInterval(timer))
        return track
      }

      w.__syntheticMedia = { makeVideoTrack, makeAudioTrack }
    },
    { width, height, painter, markers, period: MARKER_PERIOD_MS, pulse: MARKER_PULSE_MS }
  )
}

/**
 * Layer `getUserMedia`/`getDisplayMedia` overrides that build real streams
 * from `window.__syntheticMedia` (installed by `installSyntheticMediaBuilders`,
 * which the caller must have awaited first).
 */
async function installSyntheticGetUserMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const api = (window as unknown as { __syntheticMedia: SyntheticMediaBuilders }).__syntheticMedia

    const getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
      const stream = new MediaStream([api.makeVideoTrack()])
      if (constraints?.audio) stream.addTrack(api.makeAudioTrack())
      return stream
    }

    const getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const tracks: MediaStreamTrack[] = []
      if (constraints?.video) tracks.push(api.makeVideoTrack())
      if (constraints?.audio) tracks.push(api.makeAudioTrack())
      return new MediaStream(tracks)
    }

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ getUserMedia, getDisplayMedia })
  })
}

/**
 * Mock getUserMedia to return a fake video stream.
 *
 * Used to be an inert object literal shaped like a `MediaStream`
 * (`getTracks()` etc. returning empty arrays) rather than a real one. That
 * broke the instant any caller treated it as one: ESCAPECRAFT's preview does
 * `previewRef.current.srcObject = previewStream` (`useMediaStreams.ts`),
 * and assigning a plain object there throws `TypeError: Failed to set the
 * 'srcObject' property on 'HTMLMediaElement': The provided value is not of
 * type '(MediaSourceHandle or MediaStream)'` — synchronously, inside a
 * passive effect, with no error boundary above it. `WebCodecsRecorder` then
 * fails its own way on the same empty-tracks stream ("No video track
 * available for recording"). Neither failure was what any of this mock's
 * specs were testing for (ESCSUITE-207; see the Jira comment on the
 * ESCSUITE-201 review that flagged the object-literal shape in the first
 * place).
 *
 * Fixed by building on the same real track builders `mockSyntheticMedia`
 * uses — a `canvas.captureStream()` video track and a silent `AudioContext`
 * oscillator/`MediaStreamDestination` track when audio is requested — via
 * `installSyntheticMediaBuilders`/`installSyntheticGetUserMedia` above, so a
 * real `MediaStream` reaches `srcObject` and the recorder. This is NOT a
 * synonym for `mockSyntheticMedia`: that helper additionally accepts a
 * `width`/`height`/`painter` for benchmark-grade control over what gets
 * painted, where this one takes no options and is meant for every other
 * spec that just needs the recorder to not crash when it opens a camera.
 */
export async function mockGetUserMedia(page: Page) {
  // A stream the app can open implies devices it can enumerate; without this
  // the source toggles stay disabled on hardware-less runners.
  await mockMediaDevices(page)
  await installSyntheticMediaBuilders(page)
  await installSyntheticGetUserMedia(page)
}

/**
 * Mock MediaRecorder for recording tests
 */
export async function mockMediaRecorder(page: Page) {
  await page.addInitScript(() => {
    class MockMediaRecorder {
      state = 'inactive'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: ((error: Error) => void) | null = null

      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
        // Mock constructor
      }

      start(_timeslice?: number) {
        this.state = 'recording'
      }

      stop() {
        this.state = 'inactive'
        // Emit a mock blob
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['mock video data'], { type: 'video/webm' }) })
        }
        if (this.onstop) {
          this.onstop()
        }
      }

      pause() {
        this.state = 'paused'
      }

      resume() {
        this.state = 'recording'
      }

      static isTypeSupported(mimeType: string) {
        return mimeType.includes('webm')
      }
    }

    // @ts-expect-error — a deliberately partial stand-in for the real MediaRecorder class
    window.MediaRecorder = MockMediaRecorder
  })
}

/**
 * Replace the capture APIs with *real* synthetic media, with control over
 * what gets painted.
 *
 * `mockGetUserMedia` (above) now hands back the same kind of real track —
 * since ESCSUITE-207 it is no longer the inert, trackless stub this comment
 * used to contrast against — but takes no options. Reach for this one
 * instead when a test needs a specific `width`/`height`/`painter`, or simply
 * wants to say in its own `beforeEach` that it depends on a genuine,
 * decodable recorded file (WebCodecs or MediaRecorder, whichever the app's
 * `recorder-factory.ts` picks).
 *
 * Must be called BEFORE navigating.
 */
export async function mockSyntheticMedia(page: Page, options: SyntheticMediaOptions = {}) {
  // Same reason as mockGetUserMedia: capture that works implies devices that
  // enumerate, and hardware-less runners enumerate none.
  await mockMediaDevices(page)
  await installSyntheticMediaBuilders(page, options)
  await installSyntheticGetUserMedia(page)
}

/**
 * Grant media permissions without prompting.
 * Only works on Chromium — Firefox and WebKit don't support granting
 * camera/microphone permissions via Playwright, so we skip for those browsers.
 */
export async function grantMediaPermissions(page: Page) {
  const context = page.context()
  const browserName = context.browser()?.browserType().name()
  if (browserName !== 'chromium') return
  await context.grantPermissions(['camera', 'microphone'])
}
