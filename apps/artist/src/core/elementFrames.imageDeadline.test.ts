// ESCSUITE-328: an image the browser neither decodes nor rejects gets the same
// 15 s deadline a `<video>` has (ESCSUITE-325). The element exporters (WebM,
// GIF) keep the oracle's rule — warn and skip — for it, where the MP4 export
// fails by name (exportMP4.fallbackFailure.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadElementSources } from './elementFrames'
import { storeVideo } from './storage'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { makeClip, makeSourceVideo } from '../test/fixtures/clipFixtures'

let media: MediaDoubles

beforeEach(async () => {
  media = installMediaElementDoubles({ image: { silent: true } })
  await storeVideo('img1', new Blob([new Uint8Array(8)], { type: 'image/png' }), makeSourceVideo({ id: 'img1' }))
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  media.uninstall()
  vi.restoreAllMocks()
})

const load = () =>
  loadElementSources(
    [makeClip({ sourceVideoId: 'img1' })],
    new Map([['img1', makeSourceVideo({ id: 'img1', name: 'logo.png', mediaType: 'image' })]])
  )

describe('an image that never settles in the element exporters (ESCSUITE-328)', () => {
  it('is warned about and skipped at 15 s, the image torn down', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let sources: Awaited<ReturnType<typeof load>> | undefined
    void load().then((s) => (sources = s))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(sources).toBeUndefined()
    await vi.advanceTimersByTimeAsync(2)
    expect(sources).toBeDefined()
    expect(sources!.imageElements.size).toBe(0)
    expect(warn).toHaveBeenCalledWith('Failed to load media img1')
    expect(media.images[0].onload).toBeNull()
    expect(media.images[0].getAttribute('src')).toBeNull()
  })

  it('is kept when it loads at 14.9 s, the timer cleared', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const set = vi.spyOn(globalThis, 'setTimeout')
    let sources: Awaited<ReturnType<typeof load>> | undefined
    void load().then((s) => (sources = s))
    await vi.advanceTimersByTimeAsync(14_900)
    const deadline = set.mock.results[set.mock.calls.findIndex((c) => c[1] === 15_000)].value
    media.images[0].dispatchEvent(new Event('load'))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(sources!.imageElements.get('img1')).toBe(media.images[0])
    expect(clear.mock.calls.filter((c) => c[0] === deadline)).toHaveLength(1)
  })
})
