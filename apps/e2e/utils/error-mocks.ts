import { Page } from '@playwright/test'
import { installMediaDevicesLayer } from './media-mocks'

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
 *
 * Replaces the whole `navigator.mediaDevices` property via
 * `window.__layerMediaDevices` (installed by `installMediaDevicesLayer`, see
 * `media-mocks.ts`'s module comment), rather than assigning one method on it
 * — a plain `navigator.mediaDevices.getUserMedia = fn` is not what the
 * committed WebKit specs needed (ESCSUITE-177).
 */
export async function mockCameraPermissionDenied(page: Page): Promise<void> {
  await installMediaDevicesLayer(page)
  await page.addInitScript(() => {
    // Optional with a fallback: the layer always binds a real getUserMedia
    // from the prototype chain, but a layer that genuinely has none (a
    // browser missing the API entirely) must not make this script throw.
    const originalGetUserMedia =
      navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices) ??
      (async () => {
        throw new DOMException('No getUserMedia implementation', 'NotFoundError')
      })

    const getUserMedia: typeof navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.video) {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
      return originalGetUserMedia(constraints)
    }

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ getUserMedia })
  })
}

/**
 * Mock permission denied for microphone
 */
export async function mockMicrophonePermissionDenied(page: Page): Promise<void> {
  await installMediaDevicesLayer(page)
  await page.addInitScript(() => {
    const originalGetUserMedia =
      navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices) ??
      (async () => {
        throw new DOMException('No getUserMedia implementation', 'NotFoundError')
      })

    const getUserMedia: typeof navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio) {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
      return originalGetUserMedia(constraints)
    }

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ getUserMedia })
  })
}

/**
 * Mock permission denied for screen capture
 */
export async function mockScreenShareDenied(page: Page): Promise<void> {
  await installMediaDevicesLayer(page)
  await page.addInitScript(() => {
    const getDisplayMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ getDisplayMedia })
  })
}

/**
 * Mock all media permissions denied
 */
export async function mockAllMediaPermissionsDenied(page: Page): Promise<void> {
  await installMediaDevicesLayer(page)
  await page.addInitScript(() => {
    const getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }

    const getDisplayMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }

    const enumerateDevices = async () => {
      return [] as MediaDeviceInfo[]
    }

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ getUserMedia, getDisplayMedia, enumerateDevices })
  })
}

/**
 * Mock device not found error
 */
export async function mockDeviceNotFound(page: Page): Promise<void> {
  await installMediaDevicesLayer(page)
  await page.addInitScript(() => {
    const getUserMedia = async () => {
      throw new DOMException('Requested device not found', 'NotFoundError')
    }

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ getUserMedia })
  })
}

/**
 * Mock device in use error
 */
export async function mockDeviceInUse(page: Page): Promise<void> {
  await installMediaDevicesLayer(page)
  await page.addInitScript(() => {
    const getUserMedia = async () => {
      throw new DOMException('Could not start video source', 'NotReadableError')
    }

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ getUserMedia })
  })
}

/**
 * Mock storage quota exceeded error.
 *
 * Poisons `IDBObjectStore.prototype.put`, `.add` and `IDBCursor.prototype.update`
 * — once, at the prototype, rather than re-wrapping a store on every
 * `transaction()`/`objectStore()` call — for any `readwrite` transaction of
 * the app's own `video-editor-db` only; every other database (and every
 * `readonly` transaction of this one) is untouched.
 *
 * `.delete` is deliberately NOT poisoned: deleting frees quota rather than
 * consuming it, and the five write call sites in this repo
 * (`packages/shared/src/storage/index.ts`, `apps/artist/src/core/storage.ts`)
 * are all `db.put` — there is no `db.add`/cursor-`update` write path today
 * (K-U3, ESCSUITE-207) — but a future one that used `add` or a cursor would
 * otherwise escape this mock silently.
 *
 * `localStorage` is NOT covered by this mock at all. ESCAPEARTIST writes two
 * UI preferences to it directly (`app/timelineHeight.ts`,
 * `components/KeyframePanel/hooks/useDraggablePanel.ts`) and those writes
 * still succeed under "storage quota exceeded" — this mock only simulates
 * IndexedDB running out of room.
 */
export async function mockStorageQuotaExceeded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const QUOTA_DB_NAME = 'video-editor-db'

    const isPoisonedWrite = (transaction: IDBTransaction | null): boolean =>
      !!transaction && transaction.mode === 'readwrite' && transaction.db.name === QUOTA_DB_NAME

    const quotaExceeded = () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    }

    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
      if (isPoisonedWrite(this.transaction)) quotaExceeded()
      // @ts-expect-error — forwarding the original call's arguments as-is
      return originalPut.apply(this, args)
    }

    const originalAdd = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, ...args: unknown[]) {
      if (isPoisonedWrite(this.transaction)) quotaExceeded()
      // @ts-expect-error — forwarding the original call's arguments as-is
      return originalAdd.apply(this, args)
    }

    const originalCursorUpdate = IDBCursor.prototype.update
    IDBCursor.prototype.update = function (this: IDBCursor, ...args: unknown[]) {
      const source = this.source as IDBObjectStore | IDBIndex
      const transaction = 'transaction' in source ? source.transaction : source.objectStore.transaction
      if (isPoisonedWrite(transaction)) quotaExceeded()
      // @ts-expect-error — forwarding the original call's arguments as-is
      return originalCursorUpdate.apply(this, args)
    }
  })
}

/**
 * Mock WebCodecs API not available
 */
export async function mockWebCodecsUnavailable(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Remove WebCodecs APIs
    // @ts-expect-error — deleting a non-optional global property
    delete window.VideoEncoder
    // @ts-expect-error — deleting a non-optional global property
    delete window.VideoDecoder
    // @ts-expect-error — deleting a non-optional global property
    delete window.AudioEncoder
    // @ts-expect-error — deleting a non-optional global property
    delete window.AudioDecoder
    // @ts-expect-error — deleting a non-optional global property
    delete window.VideoFrame
    // @ts-expect-error — deleting a non-optional global property
    delete window.EncodedVideoChunk
    // @ts-expect-error — deleting a non-optional global property
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
        config: undefined,
      })
    }

    if (typeof VideoDecoder !== 'undefined') {
      VideoDecoder.isConfigSupported = async () => ({
        supported: false,
        config: undefined,
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
 *
 * `MockVideoEncoder` is a deliberately partial stand-in for the real
 * `VideoEncoder` — it exists only to make `Export Failure Recovery`'s tests
 * fail the way a real encoder failure fails, not to reproduce every member
 * the class has.
 * The members the real exporters actually read from an encoder
 * (`core/exportTypes.ts`'s `waitForEncoderBackpressure`, and both exporters'
 * frame loops) are: `encodeQueueSize`, `state`, `encode`, `flush`, `close`
 * and the static `isConfigSupported`. Everything else a real `VideoEncoder`
 * has (e.g. `ondequeue`) is never read by this app and is not mocked here.
 * K-U4 (ESCSUITE-207): `encodeQueueSize` was missing entirely, so
 * `waitForEncoderBackpressure`'s `while (encoder.encodeQueueSize > threshold)`
 * read `undefined > 0` — always `false` — and its error/timeout/sleep body
 * never ran under this mock. It is declared and maintained now so a future
 * test *can* exercise that loop through this mock; the two existing
 * `Export Failure Recovery` tests do not read the queue and are unaffected.
 */
export async function mockExportFailure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Mock VideoEncoder to fail during encoding
    if (typeof VideoEncoder !== 'undefined') {
      const OriginalVideoEncoder = VideoEncoder

      // @ts-expect-error — a deliberately partial stand-in for the real VideoEncoder class
      window.VideoEncoder = class MockVideoEncoder {
        constructor(init: VideoEncoderInit) {
          // Call the original constructor pattern but throw during encode
          this._init = init
          this.state = 'unconfigured'
        }

        _init: VideoEncoderInit
        state: string
        encodeQueueSize = 0

        configure(_config: VideoEncoderConfig) {
          this.state = 'configured'
        }

        encode(_frame: VideoFrame) {
          this.encodeQueueSize += 1
          // Simulate error during encoding
          if (this._init.error) {
            this._init.error(new DOMException('Encoding failed', 'EncodingError'))
          }
        }

        flush() {
          this.encodeQueueSize = 0
          return Promise.reject(new DOMException('Flush failed', 'EncodingError'))
        }

        close() {
          this.state = 'closed'
          this.encodeQueueSize = 0
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
