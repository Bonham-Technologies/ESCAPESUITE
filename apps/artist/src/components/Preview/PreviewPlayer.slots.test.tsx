// Which element the mounted preview draws each clip from (ESCSUITE-323).
//
// The render loop decides each live clip's slot stickily — a clip keeps its
// `<video>` for as long as it stays live — and writes the one shared map the
// frame's draw and the crop chrome read. `usePreviewRenderLoop.test.ts` pins
// the loop's own seeks; these pin that the two readers, through the real
// preview, read the loop's map rather than working the slots out afresh.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { installPreviewDoubles, renderPreview, type Preview, type PreviewDoubles } from '../../test/renderPreview'
import { CROP_DIM_ALPHA } from './cropOverlay'
import type { Clip } from '../../store/types'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/**
 * A picture-in-picture of one recording: `u`, video1 from 10 s on a track
 * above, live from 0; `l`, video1 from 0 s on the track below, live from 0.5.
 * At 1 both are live, `l` first in track order — so the stateless rule would
 * give `l` the source's own element and `u` the second, while `u`, live alone
 * from 0, has held the source's own element all along.
 */
function pipStartingBelow(): { u: Clip; l: Clip } {
  addClip('l', 0.5, 3.5)
  store().addClipToTimeline(
    { id: 'u', sourceVideoId: 'video1', name: 'u', startTime: 10, endTime: 14, duration: 4 },
    undefined,
    0
  )
  const [u, l] = ['u', 'l'].map((id) => store().project.timeline.clips.find((c) => c.id === id)!)
  const indexOf = (trackId: string) => store().project.timeline.tracks.find((t) => t.id === trackId)!.index
  expect(indexOf(u.trackId)).toBeGreaterThan(indexOf(l.trackId))
  return { u, l }
}

/** The crop chrome's dim pass: the source drawn at the dim alpha. */
const dimDraws = (preview: Preview) =>
  preview.calls('drawImage').filter((c) => c.state.globalAlpha === CROP_DIM_ALPHA)

describe('the preview\'s element for each clip (ESCSUITE-323)', () => {
  it('draws the upper clip from the element it kept and the lower one from the second', async () => {
    pipStartingBelow()
    store().setSelectedClipId(null)
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    expect(doubles.media.videos).toHaveLength(2)
    // Track order: `l` below is drawn first, then `u`. Compared by index:
    // `toEqual` would take two lookalike <video> elements as equal.
    const drawn = preview.frame(-1).argsFor('drawImage').map((args) => doubles.media.videos.indexOf(args[0] as HTMLVideoElement))
    expect(drawn).toEqual([1, 0])
  })

  it('dims a cropped clip from the element the render loop kept it on', async () => {
    const { u } = pipStartingBelow()
    store().setSelectedClipId(u.id)
    store().setCropClipId(u.id)
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    const [dim] = dimDraws(preview)
    expect(doubles.media.videos).toHaveLength(2)
    expect(dim.args[0]).toBe(doubles.media.videos[0])
  })
})
