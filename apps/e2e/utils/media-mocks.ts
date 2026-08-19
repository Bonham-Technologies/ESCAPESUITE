import { Page } from '@playwright/test'

/**
 * Utilities for mocking media APIs in Playwright tests
 */

/**
 * Mock getUserMedia to return a fake video stream
 */
export async function mockGetUserMedia(page: Page) {
  await page.addInitScript(() => {
    // Create a mock MediaStream
    const mockStream = {
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
      addTrack: () => {},
      removeTrack: () => {},
      active: true,
    }

    // Override getUserMedia
    navigator.mediaDevices.getUserMedia = async () => mockStream as unknown as MediaStream

    // Override getDisplayMedia for screen capture
    navigator.mediaDevices.getDisplayMedia = async () => mockStream as unknown as MediaStream
  })
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

      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        // Mock constructor
      }

      start(timeslice?: number) {
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

    // @ts-ignore
    window.MediaRecorder = MockMediaRecorder
  })
}

/**
 * Replace the capture APIs with *real* synthetic media.
 *
 * Unlike `mockGetUserMedia` (an inert stub with no tracks), this hands back a
 * live canvas-backed video track and an oscillator-backed audio track, so the
 * app's real recording pipeline — WebCodecs or MediaRecorder — produces a
 * genuine, decodable file. Use it when a test needs actual recorded output.
 *
 * Must be called BEFORE navigating.
 */
export async function mockSyntheticMedia(
  page: Page,
  options: { width?: number; height?: number } = {}
) {
  const width = options.width ?? 640
  const height = options.height ?? 360

  await page.addInitScript(
    ({ width, height }) => {
      const makeVideoTrack = (): MediaStreamTrack => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!

        // Animate so every captured frame differs (encoders need real motion)
        let frame = 0
        setInterval(() => {
          frame += 1
          ctx.fillStyle = `hsl(${frame % 360}, 70%, 45%)`
          ctx.fillRect(0, 0, width, height)
          ctx.fillStyle = '#ffffff'
          ctx.font = `${Math.round(height / 8)}px sans-serif`
          ctx.fillText(`E2E ${frame}`, 40, height / 2)
        }, 33)

        return (canvas as HTMLCanvasElement & {
          captureStream(fps?: number): MediaStream
        })
          .captureStream(30)
          .getVideoTracks()[0]
      }

      const makeAudioTrack = (): MediaStreamTrack => {
        const audioContext = new AudioContext()
        const destination = audioContext.createMediaStreamDestination()
        const oscillator = audioContext.createOscillator()
        oscillator.frequency.value = 440
        oscillator.connect(destination)
        oscillator.start()
        return destination.stream.getAudioTracks()[0]
      }

      navigator.mediaDevices.getDisplayMedia = async (
        constraints?: DisplayMediaStreamOptions
      ) => {
        const stream = new MediaStream([makeVideoTrack()])
        if (constraints?.audio) stream.addTrack(makeAudioTrack())
        return stream
      }

      navigator.mediaDevices.getUserMedia = async (
        constraints?: MediaStreamConstraints
      ) => {
        const tracks: MediaStreamTrack[] = []
        if (constraints?.video) tracks.push(makeVideoTrack())
        if (constraints?.audio) tracks.push(makeAudioTrack())
        return new MediaStream(tracks)
      }
    },
    { width, height }
  )
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
