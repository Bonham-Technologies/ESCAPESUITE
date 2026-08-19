import { Page, Route } from '@playwright/test'

/**
 * Utilities for mocking error scenarios in E2E tests
 */

/**
 * Mock network failure for specific URL patterns
 * @param page - Playwright Page object
 * @param urlPattern - URL pattern to intercept (string or regex)
 */
export async function mockNetworkFailure(
  page: Page,
  urlPattern: string | RegExp
): Promise<void> {
  await page.route(urlPattern, (route) => {
    route.abort('failed')
  })
}

/**
 * Mock network timeout for specific URL patterns
 * @param page - Playwright Page object
 * @param urlPattern - URL pattern to intercept
 * @param delayMs - Delay before timeout (default 30000)
 */
export async function mockNetworkTimeout(
  page: Page,
  urlPattern: string | RegExp,
  delayMs: number = 30000
): Promise<void> {
  await page.route(urlPattern, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    route.abort('timedout')
  })
}

/**
 * Mock API error response
 * @param page - Playwright Page object
 * @param urlPattern - URL pattern to intercept
 * @param status - HTTP status code (e.g., 400, 401, 403, 404, 500)
 * @param message - Error message to return
 */
export async function mockAPIError(
  page: Page,
  urlPattern: string | RegExp,
  status: number,
  message: string
): Promise<void> {
  await page.route(urlPattern, (route) => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        error: message,
        message,
        statusCode: status,
      }),
    })
  })
}

/**
 * Mock permission denied for camera
 */
export async function mockCameraPermissionDenied(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    )

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.video) {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
      return originalGetUserMedia(constraints)
    }
  })
}

/**
 * Mock permission denied for microphone
 */
export async function mockMicrophonePermissionDenied(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    )

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio) {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
      return originalGetUserMedia(constraints)
    }
  })
}

/**
 * Mock permission denied for screen capture
 */
export async function mockScreenShareDenied(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }
  })
}

/**
 * Mock all media permissions denied
 */
export async function mockAllMediaPermissionsDenied(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }

    navigator.mediaDevices.getDisplayMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }

    navigator.mediaDevices.enumerateDevices = async () => {
      return []
    }
  })
}

/**
 * Mock device not found error
 */
export async function mockDeviceNotFound(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Requested device not found', 'NotFoundError')
    }
  })
}

/**
 * Mock device in use error
 */
export async function mockDeviceInUse(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Could not start video source', 'NotReadableError')
    }
  })
}

/**
 * Mock storage quota exceeded error
 */
export async function mockStorageQuotaExceeded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Override IndexedDB put to throw quota exceeded
    const originalOpen = indexedDB.open.bind(indexedDB)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    indexedDB.open = function (name: string, version?: number): any {
      const request = originalOpen(name, version)

      const originalResult = Object.getOwnPropertyDescriptor(
        IDBRequest.prototype,
        'result'
      )

      Object.defineProperty(request, 'result', {
        get() {
          const db = originalResult?.get?.call(this)
          if (!db) return db

          // Wrap transactions to throw quota errors on writes
          const originalTransaction = db.transaction.bind(db)
          db.transaction = function (
            storeNames: string | string[],
            mode?: IDBTransactionMode
          ) {
            const tx = originalTransaction(storeNames, mode)

            if (mode === 'readwrite') {
              const originalObjectStore = tx.objectStore.bind(tx)
              tx.objectStore = function (name: string) {
                const store = originalObjectStore(name)
                const originalPut = store.put.bind(store)

                store.put = function () {
                  throw new DOMException('QuotaExceededError', 'QuotaExceededError')
                }

                return store
              }
            }

            return tx
          }

          return db
        },
      })

      return request
    }
  })
}

/**
 * Mock WebCodecs API not available
 */
export async function mockWebCodecsUnavailable(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Remove WebCodecs APIs
    // @ts-ignore
    delete window.VideoEncoder
    // @ts-ignore
    delete window.VideoDecoder
    // @ts-ignore
    delete window.AudioEncoder
    // @ts-ignore
    delete window.AudioDecoder
    // @ts-ignore
    delete window.VideoFrame
    // @ts-ignore
    delete window.EncodedVideoChunk
    // @ts-ignore
    delete window.EncodedAudioChunk
  })
}

/**
 * Mock codec not supported
 */
export async function mockCodecNotSupported(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (typeof VideoEncoder !== 'undefined') {
      VideoEncoder.isConfigSupported = async () => ({
        supported: false,
        config: null,
      })
    }

    if (typeof VideoDecoder !== 'undefined') {
      VideoDecoder.isConfigSupported = async () => ({
        supported: false,
        config: null,
      })
    }
  })
}

/**
 * Mock slow network conditions
 * @param page - Playwright Page object
 * @param latencyMs - Additional latency in milliseconds
 */
export async function mockSlowNetwork(page: Page, latencyMs: number = 3000): Promise<void> {
  await page.route('**/*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, latencyMs))
    await route.continue()
  })
}

/**
 * Mock offline mode
 */
export async function mockOffline(page: Page): Promise<void> {
  await page.context().setOffline(true)
}

/**
 * Restore online mode
 */
export async function mockOnline(page: Page): Promise<void> {
  await page.context().setOffline(false)
}

/**
 * Mock export failure
 */
export async function mockExportFailure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Mock VideoEncoder to fail during encoding
    if (typeof VideoEncoder !== 'undefined') {
      const OriginalVideoEncoder = VideoEncoder

      // @ts-ignore
      window.VideoEncoder = class MockVideoEncoder {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(init: any) {
          // Call the original constructor pattern but throw during encode
          this._init = init
          this.state = 'unconfigured'
        }

        _init: any
        state: string

        configure(config: any) {
          this.state = 'configured'
        }

        encode(frame: any) {
          // Simulate error during encoding
          if (this._init.error) {
            this._init.error(new DOMException('Encoding failed', 'EncodingError'))
          }
        }

        flush() {
          return Promise.reject(new DOMException('Flush failed', 'EncodingError'))
        }

        close() {
          this.state = 'closed'
        }

        static isConfigSupported = OriginalVideoEncoder.isConfigSupported
      }
    }
  })
}

/**
 * Clear all route mocks
 */
export async function clearRouteMocks(page: Page): Promise<void> {
  await page.unrouteAll()
}
