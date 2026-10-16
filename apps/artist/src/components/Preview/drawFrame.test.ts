// `drawPreviewFrame`, driven directly: everything it reads is a parameter, so a
// recording context and a scene are all a case needs. (Its per-frame cost is
// pinned separately, through the mounted preview, in `drawFrame.perf.test.ts`.)
import { describe, it, expect } from 'vitest'
import { drawPreviewFrame, type PreviewFrameScene } from './drawFrame'
import { createRecordingContext, type RecordingCanvasRenderingContext2D } from '../../test/doubles/canvas'
import { makeClip, makeTrack } from '../../test/fixtures/clipFixtures'
import { DEFAULT_TEXT_OVERLAY_DATA } from '../../store/types'
import { captionStyleFor } from '../../core/captions'

/** One frame at `time`, onto a fresh 640x360 recording context; the texts it drew. */
function textsDrawnAt(time: number, scene: PreviewFrameScene): string[] {
  const ctx: RecordingCanvasRenderingContext2D = createRecordingContext()
  ctx.canvas.width = 640
  ctx.canvas.height = 360
  drawPreviewFrame(
    ctx as unknown as CanvasRenderingContext2D,
    ctx.canvas,
    time,
    scene,
    { videoElements: new Map(), imageElements: new Map(), blurScratch: { current: null } }
  )
  return ctx.argsFor('fillText').map((args) => args[0] as string)
}

// ESCSUITE-293: a caption is an ordinary text clip on the `kind: 'captions'`
// track, drawn by the same text renderer as a title — so the preview shows it
// while its cue is up, and not before or after. No renderer change was needed.
describe('drawPreviewFrame — a caption (ESCSUITE-293)', () => {
  const scene: PreviewFrameScene = {
    projectSize: { width: 640, height: 360 },
    clips: [
      makeClip({
        id: 'caption',
        sourceVideoId: '',
        trackId: 'captions',
        overlayType: 'text',
        textData: { ...DEFAULT_TEXT_OVERLAY_DATA, ...captionStyleFor({ width: 640, height: 360 }), text: 'On screen' },
        timelinePosition: 1,
        duration: 2,
        endTime: 2,
      }),
    ],
    tracks: [makeTrack(), makeTrack({ id: 'captions', name: 'Captions', index: 1, kind: 'captions' })],
    sourceVideos: [],
    editingTextClipId: null,
  }

  it('is drawn while its cue is up', () => {
    expect(textsDrawnAt(1, scene)).toEqual(['On screen'])
    expect(textsDrawnAt(2.9, scene)).toEqual(['On screen'])
  })

  it('is not drawn before its cue or once it has ended', () => {
    expect(textsDrawnAt(0.9, scene)).toEqual([])
    expect(textsDrawnAt(3, scene)).toEqual([])
  })
})
