// ESCSUITE-313: two clips of ONE source on screen at once, exported through
// the `<video>` path of every element-drawing exporter.
//
// A clip split and crossfaded into a later part of itself, and the same
// recording duplicated on a track above as a zoom or picture-in-picture, both
// put two clips of one source in one frame. Each exporter used to give a source
// exactly one `<video>`, seek it for the first clip, seek it again for the
// second and draw both from wherever the second seek left it — so both clips
// showed the second clip's moment. These cases read where each drawn element
// sat at the moment `drawImage` was handed it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4 } from './exportMP4'
import { exportToWebM } from './exportWebM'
import { exportToGIF } from './exportGIF'
import { storeVideo } from './storage'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installCanvasDouble,
  installOffscreenCanvasDouble,
  uninstallCanvasDouble,
  type OffscreenCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { installWebCodecsDoubles, type WebCodecsDoubles } from '../test/doubles/webcodecs'
import { makeClip, makeExportOptions, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})
vi.mock('./audioMixer', () => ({ extractAndMixAudio: vi.fn(async () => null) }))

let media: MediaDoubles
let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let spies: Array<ReturnType<typeof vi.spyOn>>
/** `currentTime` of each `<video>` at the moment it was drawn, in draw order. */
let drawnAt: number[]
let restoreGetContext: () => void

beforeEach(async () => {
  resetMediabunnyDouble()
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  webcodecs = installWebCodecsDoubles()
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ]
  drawnAt = []
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: (...a: unknown[]) => unknown }
  const original = proto.getContext
  proto.getContext = function (this: HTMLCanvasElement, ...a: unknown[]) {
    const ctx = original.apply(this, a) as RecordingCanvasRenderingContext2D
    const draw = ctx.drawImage
    ;(ctx as unknown as { drawImage: (...x: unknown[]) => unknown }).drawImage = (...x: unknown[]) => {
      if (x[0] instanceof HTMLVideoElement) drawnAt.push(x[0].currentTime)
      return draw(...(x as []))
    }
    return ctx
  }
  restoreGetContext = () => {
    proto.getContext = original
  }
  await storeVideo(
    'rec',
    new Blob([new Uint8Array(8)], { type: 'video/webm' }),
    makeSourceVideo({ id: 'rec', mimeType: 'video/webm', duration: 20 })
  )
})

afterEach(() => {
  restoreGetContext()
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  for (const spy of spies) spy.mockRestore()
})

// Clip A shows the recording from 0 s; clip B, on the track above (a cropped
// zoom, say), the same recording from 10 s. Both are on screen for the first
// 0.1 s of the timeline.
const zoomed = [
  makeClip({ id: 'A', sourceVideoId: 'rec', trackId: 'tA', startTime: 0, endTime: 0.1, duration: 0.1 }),
  makeClip({ id: 'B', sourceVideoId: 'rec', trackId: 'tB', startTime: 10, endTime: 10.1, duration: 0.1 }),
]
const twoTracks = [makeTrack({ id: 'tA', index: 0 }), makeTrack({ id: 'tB', index: 1 })]

// The recording split at 0.3 s, the second piece starting 5 s further in (a
// jump cut), with a 0.2 s fade from the first piece into the second.
const split = [
  makeClip({
    id: 'A', sourceVideoId: 'rec', trackId: 'tA', startTime: 0, endTime: 0.3, duration: 0.3,
    transition: { type: 'fade', duration: 0.2 },
  }),
  makeClip({ id: 'B', sourceVideoId: 'rec', trackId: 'tA', startTime: 5, endTime: 5.3, duration: 0.3, timelinePosition: 0.3 }),
]
const oneTrack = [makeTrack({ id: 'tA', index: 0 })]
const sources = [makeSourceVideo({ id: 'rec', mimeType: 'video/webm', duration: 20 })]

describe('two clips of one source in one frame', () => {
  it('MP4 (the in-page <video> path): each clip is drawn from its own source time', async () => {
    await exportToMP4(zoomed, sources, makeExportOptions(), () => {}, twoTracks)

    expect(drawnAt.slice(0, 2)).toEqual([expect.closeTo(0, 2), expect.closeTo(10, 2)])
  })

  it('WebM: each clip is drawn from its own source time', async () => {
    await exportToWebM(zoomed, sources, makeExportOptions({ format: 'webm' }), () => {}, twoTracks)

    expect(drawnAt.slice(0, 2)).toEqual([expect.closeTo(0, 2), expect.closeTo(10, 2)])
  })

  it('GIF: each clip is drawn from its own source time', async () => {
    await exportToGIF(zoomed, sources, makeExportOptions({ format: 'gif', fps: 10 }), () => {}, twoTracks)

    expect(drawnAt.slice(0, 2)).toEqual([expect.closeTo(0, 2), expect.closeTo(10, 2)])
  })
})

describe('a split clip crossfading into its own later part', () => {
  // Frame 3 (t = 0.1 s) is the first inside the fade: the outgoing side is
  // drawn, then the incoming one, held on its first frame until the cut.
  it('MP4: the outgoing side keeps its own time and the incoming side its own', async () => {
    await exportToMP4(split, sources, makeExportOptions(), () => {}, oneTrack)

    expect(drawnAt.slice(3, 5)).toEqual([expect.closeTo(0.1, 2), expect.closeTo(5, 2)])
  })

  it('WebM: the outgoing side keeps its own time and the incoming side its own', async () => {
    await exportToWebM(split, sources, makeExportOptions({ format: 'webm' }), () => {}, oneTrack)

    expect(drawnAt.slice(3, 5)).toEqual([expect.closeTo(0.1, 2), expect.closeTo(5, 2)])
  })
})
