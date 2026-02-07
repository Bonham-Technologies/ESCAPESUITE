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
 * Grant media permissions without prompting.
 * Only works on Chromium — Firefox and WebKit don't support granting
 * camera/microphone permissions via Playwright, so we silently skip.
 */
export async function grantMediaPermissions(page: Page) {
  const context = page.context()
  try {
    await context.grantPermissions(['camera', 'microphone'])
  } catch {
    // Firefox and WebKit don't support granting camera/microphone permissions
  }
}
