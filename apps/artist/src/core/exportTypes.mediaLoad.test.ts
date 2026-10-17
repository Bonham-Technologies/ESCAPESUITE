// ESCSUITE-328: the image load gets the same 15 s deadline `waitForVideoLoad`
// has had since ESCSUITE-325, through the one shared `waitForMediaLoad`. The
// media double's `silent` on an image is a file the browser neither decodes
// nor rejects.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadImageElement, waitForVideoLoad } from './exportTypes'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'

let media: MediaDoubles

beforeEach(() => {
  media = installMediaElementDoubles({ image: { silent: true }, video: { silent: true } })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  media.uninstall()
  vi.restoreAllMocks()
})

const IMAGE = () => new Blob(['i'], { type: 'image/png' })

function settle<T>(promise: Promise<T>): { outcome: string[] } {
  const outcome: string[] = []
  promise.then(
    () => outcome.push('resolved'),
    (e: Error) => outcome.push(`${e.name}: ${e.message}`)
  )
  return { outcome }
}

describe('loadImageElement deadline (ESCSUITE-328)', () => {
  it('rejects with a MediaLoadTimeoutError naming the source at 15 s, the image torn down', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { outcome } = settle(loadImageElement(IMAGE(), 'logo.png'))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(outcome).toEqual([])
    await vi.advanceTimersByTimeAsync(2)
    expect(outcome).toEqual([
      'MediaLoadTimeoutError: Could not read logo.png — the browser did not report its metadata within 15 s',
    ])
    const img = media.images[0]
    expect(img.onload).toBeNull()
    expect(img.onerror).toBeNull()
    expect(img.getAttribute('src')).toBeNull()
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('ignores a load or error that arrives after expiry', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { outcome } = settle(loadImageElement(IMAGE(), 'logo.png'))
    await vi.advanceTimersByTimeAsync(15_000)
    media.images[0].dispatchEvent(new Event('load'))
    media.images[0].dispatchEvent(new Event('error'))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(outcome).toHaveLength(1)
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('resolves a load at 14.9 s and clears the deadline timer', async () => {
    const set = vi.spyOn(globalThis, 'setTimeout')
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { outcome } = settle(loadImageElement(IMAGE(), 'logo.png'))
    await vi.advanceTimersByTimeAsync(14_900)
    const deadline = set.mock.results[set.mock.calls.findIndex((c) => c[1] === 15_000)].value
    media.images[0].dispatchEvent(new Event('load'))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(outcome).toEqual(['resolved'])
    expect(clear.mock.calls.filter((c) => c[0] === deadline)).toHaveLength(1)
    expect(revoke).not.toHaveBeenCalled()
  })

  it('rejects an error event at once with the plain failure, the timer cleared, the URL revoked once', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { outcome } = settle(loadImageElement(IMAGE(), 'logo.png'))
    media.images[0].dispatchEvent(new Event('error'))
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toEqual(['Error: Failed to load image'])
    expect(clear).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(outcome).toHaveLength(1)
    expect(revoke).toHaveBeenCalledTimes(1)
  })
})

describe('waitForVideoLoad through the shared helper (ESCSUITE-328)', () => {
  it('still keeps the URL when it does not own it', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const video = document.createElement('video')
    const { outcome } = settle(waitForVideoLoad(video, 'blob:x', 'clip.webm', false))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(outcome[0]).toContain('MediaLoadTimeoutError')
    expect(revoke).not.toHaveBeenCalled()
    expect(video.load).toHaveBeenCalledTimes(1)
  })
})
