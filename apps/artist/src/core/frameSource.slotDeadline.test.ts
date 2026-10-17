// ESCSUITE-325 x ESCSUITE-313: a source's further `<video>` element — slot 1
// onwards, made over the object URL its first element already reads — goes
// through the same 15 s load deadline as the first.
//
// ESCSUITE-325 put a deadline on the first element's load (`create`, and
// `loadVideoElement` for WebM and GIF). ESCSUITE-313, landing beside it, made a
// source's further elements lazily, through a load of their own; without the
// deadline there, a further element the browser neither decodes nor rejects
// parks every frame that asks for its slot for ever — an MP4 export with a
// picture-in-picture copy of the source, or a split clip crossfading into
// itself, hangs at the first frame that needs the second element. Such a slot
// is now treated as any further element that will not load: warned about once,
// the slot answers `null` (its clip left out), and — unlike a timed-out first
// element — the URL is not revoked, because slot 0 still reads it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HTMLVideoFrameSource } from './frameSource'
import { loadVideoElementFromUrl, MediaLoadTimeoutError } from './exportTypes'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'

let media: MediaDoubles
let warns: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360, duration: 20 } })
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(URL.createObjectURL).mockClear()
  vi.mocked(URL.revokeObjectURL).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  media.uninstall()
  warns.mockRestore()
})

const blob = () => new Blob([new Uint8Array(8)], { type: 'video/mp4' })
const secondElementWarnings = () =>
  warns.mock.calls.filter((call: unknown[]) => String(call[0]).includes('second element'))

describe('HTMLVideoFrameSource: a further slot whose element never loads (ESCSUITE-325, 313)', () => {
  it('answers null at the 15 s deadline, warns once, and keeps the URL slot 0 reads', async () => {
    const source = await HTMLVideoFrameSource.create('rec', blob())
    media.script({ video: { silent: true } })
    vi.useFakeTimers()

    const settled: unknown[] = []
    void source.getFrame(10, 1).then((frame) => settled.push(frame))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toEqual([])
    await vi.advanceTimersByTimeAsync(2)
    expect(settled).toEqual([null])

    // Torn down, and not one of the source's elements any more.
    const second = media.videos[1]
    expect(second.onloadeddata).toBeNull()
    expect(second.onerror).toBeNull()
    expect(second.getAttribute('src')).toBeNull()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(secondElementWarnings()).toHaveLength(1)

    // Given up on for good: the next frames answer at once, with no new element
    // and no second warning, and slot 0 is still served from its own element.
    await expect(source.getFrame(10 + 1 / 30, 1)).resolves.toBeNull()
    await expect(source.getFrame(10 + 2 / 30, 1)).resolves.toBeNull()
    expect(media.videos).toHaveLength(2)
    expect(secondElementWarnings()).toHaveLength(1)
    await expect(source.getFrame(1 / 30, 0)).resolves.toBe(media.videos[0])

    // The shared URL is revoked once, by the source, at dispose.
    await source.dispose()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('keeps a further element that loads at 14.9 s', async () => {
    const source = await HTMLVideoFrameSource.create('rec', blob())
    media.script({ video: { silent: true } })
    vi.useFakeTimers()

    const settled: unknown[] = []
    void source.getFrame(10, 1).then((frame) => settled.push(frame))
    await vi.advanceTimersByTimeAsync(14_900)
    media.videos[1].dispatchEvent(new Event('loadeddata'))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(settled).toEqual([media.videos[1]])
    expect(media.videos[1].load).not.toHaveBeenCalled()
    expect(secondElementWarnings()).toHaveLength(0)
  })
})

describe('loadVideoElementFromUrl (the element exporters\' further slots)', () => {
  it('rejects with MediaLoadTimeoutError at 15 s without revoking the URL it does not own', async () => {
    media.script({ video: { silent: true } })
    vi.useFakeTimers()

    const settled: string[] = []
    void loadVideoElementFromUrl('blob:shared', 'rec').then(
      () => settled.push('resolved'),
      (e: Error) => settled.push(`${e.name}: ${e.message}`)
    )
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toEqual([])
    await vi.advanceTimersByTimeAsync(2)

    expect(settled).toEqual([
      'MediaLoadTimeoutError: Could not read rec — the browser did not report its metadata within 15 s',
    ])
    expect(new MediaLoadTimeoutError('x')).toBeInstanceOf(Error)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})
