// One row of the track stack, rendered from props alone.
//
// The row's job is to place clips: `Timeline` decides *which* clips belong to
// it and owns the drag and trim gestures, so what is asserted here is the
// translation from those props into DOM — the position and width a clip is
// drawn at, the classes that mark it selected / dragging / trimming, the icon
// its media type earns, the ghost a clip dragged in from another track leaves
// — and that a grab of a clip or of a trim handle reaches the caller intact.
import type React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { TimelineTrack } from './TimelineTrack'
import { installCanvasDouble, uninstallCanvasDouble } from '../../test/doubles/canvas'
import { resetStoreForTest, store, addClip, video } from '../../test/fixtures/projectStore'
import { DEFAULT_SHAPE_OVERLAY_DATA } from '../../store/types'
import type { Clip, SourceVideo, Track } from '../../store/types'
import type { DragState, TrimState } from './types'
import styles from './Timeline.module.css'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50

const TRACK_ID = 'track-1'

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: TRACK_ID,
    name: 'Track 1',
    index: 0,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
    ...overrides,
  }
}

/** A real store-built clip, placed on this row unless told otherwise. */
function makeClip(id: string, position: number, duration = 2, overrides: Partial<Clip> = {}): Clip {
  return { ...addClip(id, position, duration), trackId: TRACK_ID, ...overrides }
}

function makeDrag(overrides: Partial<DragState> = {}): DragState {
  return {
    clipId: 'clip1',
    originalTrackId: TRACK_ID,
    originalPosition: 0,
    currentTrackId: TRACK_ID,
    currentPosition: 0,
    snappedPosition: null,
    offsetX: 0,
    ...overrides,
  }
}

function makeCallbacks() {
  return {
    onClipMouseDown: vi.fn<(e: React.MouseEvent, clip: Clip) => void>(),
    onTrimMouseDown: vi.fn<(e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') => void>(),
  }
}

function renderTrack(
  opts: {
    track?: Track
    clips?: Clip[]
    allClips?: Clip[]
    sourceVideos?: SourceVideo[]
    selectedClipId?: string | null
    selectedClipIds?: Set<string>
    dragState?: DragState | null
    trimState?: TrimState | null
  } = {}
): { root: HTMLElement; calls: ReturnType<typeof makeCallbacks> } {
  const clips = opts.clips ?? []
  const calls = makeCallbacks()
  const { container } = render(
    <TimelineTrack
      track={opts.track ?? makeTrack()}
      clips={clips}
      allClips={opts.allClips ?? clips}
      sourceVideos={opts.sourceVideos ?? [video]}
      pixelsPerSecond={PPS}
      selectedClipId={opts.selectedClipId ?? null}
      selectedClipIds={opts.selectedClipIds ?? new Set()}
      dragState={opts.dragState ?? null}
      trimState={opts.trimState ?? null}
      {...calls}
    />
  )
  return { root: container.firstElementChild as HTMLElement, calls }
}

function clipEls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-clip-id]'))
}

describe('TimelineTrack row', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('carries the track id the timeline hunts for, and the track height', () => {
    const { root } = renderTrack({ track: makeTrack({ height: 72 }) })

    expect(root).toHaveAttribute('data-track-id', TRACK_ID)
    expect(root).toHaveClass(styles.track)
    expect(root).toHaveStyle({ height: '72px' })
    expect(root).not.toHaveClass(styles.trackHidden)
    expect(root).not.toHaveClass(styles.trackLocked)
  })

  it('marks a hidden track and a locked track', () => {
    const { root } = renderTrack({ track: makeTrack({ visible: false, locked: true }) })

    expect(root).toHaveClass(styles.trackHidden)
    expect(root).toHaveClass(styles.trackLocked)
  })

  it('draws nothing when the row has no clips', () => {
    const { root } = renderTrack()

    expect(root).toBeEmptyDOMElement()
  })
})

describe('TimelineTrack clips', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('places each clip at its timeline position, sized by its duration', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 1, 2), makeClip('clip2', 4, 3)] })

    const drawn = clipEls(root)
    expect(drawn.map((el) => el.dataset.clipId)).toEqual(['clip1', 'clip2'])
    expect(drawn[0]).toHaveStyle({ left: '50px', width: '100px' })
    expect(drawn[1]).toHaveStyle({ left: '200px', width: '150px' })
  })

  it('scales with the timeline zoom', () => {
    const clips = [makeClip('clip1', 1, 2)]
    const { container } = render(
      <TimelineTrack
        track={makeTrack()}
        clips={clips}
        allClips={clips}
        sourceVideos={[video]}
        pixelsPerSecond={PPS * 4}
        selectedClipId={null}
        selectedClipIds={new Set()}
        dragState={null}
        trimState={null}
        onClipMouseDown={vi.fn()}
        onTrimMouseDown={vi.fn()}
      />
    )

    expect(container.querySelector('[data-clip-id]')).toHaveStyle({ left: '200px', width: '400px' })
  })

  it('names each clip and stamps its duration', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0, 65)] })

    expect(root.querySelector(`.${styles.clipName}`)).toHaveTextContent('clip1')
    expect(root.querySelector(`.${styles.clipDuration}`)).toHaveTextContent('1:05')
  })

  it('skips a clip that belongs to another track', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { trackId: 'other-track' }), makeClip('clip2', 4)],
    })

    expect(clipEls(root).map((el) => el.dataset.clipId)).toEqual(['clip2'])
  })

  it('marks the single selection and the rest of a multi-selection differently', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0), makeClip('clip2', 4), makeClip('clip3', 8)],
      selectedClipId: 'clip1',
      selectedClipIds: new Set(['clip1', 'clip2']),
    })

    const [one, two, three] = clipEls(root)
    expect(one).toHaveClass(styles.clipSelected)
    expect(one).not.toHaveClass(styles.clipMultiSelected)
    expect(two).toHaveClass(styles.clipMultiSelected)
    expect(two).not.toHaveClass(styles.clipSelected)
    expect(three).not.toHaveClass(styles.clipMultiSelected)
  })

  it('marks the clip whose edge is being trimmed', () => {
    const trimState: TrimState = {
      clipId: 'clip2',
      edge: 'end',
      origin: { startTime: 0, endTime: 2, timelinePosition: 4 },
    }
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0), makeClip('clip2', 4)],
      trimState,
    })

    const [one, two] = clipEls(root)
    expect(one).not.toHaveClass(styles.clipTrimming)
    expect(two).toHaveClass(styles.clipTrimming)
  })

  it('reports a grab of a clip, with the clip that was grabbed', () => {
    const clip = makeClip('clip1', 0)
    const { root, calls } = renderTrack({ clips: [clip] })

    fireEvent.mouseDown(clipEls(root)[0])

    expect(calls.onClipMouseDown).toHaveBeenCalledTimes(1)
    expect(calls.onClipMouseDown.mock.calls[0][1]).toBe(clip)
  })

  it('reports a grab of either trim handle with the edge it sits on', () => {
    const clip = makeClip('clip1', 0)
    const { root, calls } = renderTrack({ clips: [clip] })

    // A handle sits inside the clip, so the timeline's real handler stops the
    // event propagating; these spies do not, hence no count on onClipMouseDown.
    const handles = clipEls(root)[0].querySelectorAll(`.${styles.trimHandle}`)
    expect(handles[0]).toHaveStyle({ left: '0px' })
    expect(handles[1]).toHaveStyle({ right: '0px' })
    fireEvent.mouseDown(handles[0])
    fireEvent.mouseDown(handles[1])

    expect(calls.onTrimMouseDown.mock.calls.map((c) => c[2])).toEqual(['start', 'end'])
    expect(calls.onTrimMouseDown.mock.calls[0][1]).toBe(clip)
  })
})

describe('TimelineTrack clip kinds', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  const audio: SourceVideo = { ...video, id: 'audio1', mediaType: 'audio' }
  const image: SourceVideo = { ...video, id: 'image1', mediaType: 'image' }

  it('colours an audio clip and gives it a note icon', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { sourceVideoId: audio.id })],
      sourceVideos: [video, audio],
    })

    const [drawn] = clipEls(root)
    expect(drawn).toHaveClass(styles.clipAudio)
    expect(drawn.querySelector(`.${styles.clipIcon} circle`)).not.toBeNull()
  })

  it('colours an image clip', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { sourceVideoId: image.id })],
      sourceVideos: [video, image],
    })

    expect(clipEls(root)[0]).toHaveClass(styles.clipImage)
  })

  it('leaves a video clip with no media icon at all', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)] })

    const [drawn] = clipEls(root)
    expect(drawn).not.toHaveClass(styles.clipAudio)
    expect(drawn).not.toHaveClass(styles.clipImage)
    expect(drawn.querySelectorAll(`.${styles.clipIcon}`)).toHaveLength(0)
  })

  it('colours a text overlay', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { overlayType: 'text' })],
    })

    expect(clipEls(root)[0]).toHaveClass(styles.clipText)
    expect(clipEls(root)[0].querySelectorAll(`.${styles.clipIcon}`)).toHaveLength(1)
  })

  it('gives a blur shape a different icon from every other shape', () => {
    const blur = renderTrack({
      clips: [
        makeClip('clip1', 0, 2, {
          overlayType: 'shape',
          shapeData: { ...DEFAULT_SHAPE_OVERLAY_DATA, type: 'blur' },
        }),
      ],
    })
    const rect = renderTrack({
      clips: [
        makeClip('clip2', 0, 2, {
          overlayType: 'shape',
          shapeData: { ...DEFAULT_SHAPE_OVERLAY_DATA, type: 'rectangle' },
        }),
      ],
    })

    expect(clipEls(blur.root)[0]).toHaveClass(styles.clipShape)
    expect(clipEls(blur.root)[0].querySelectorAll(`.${styles.clipIcon} circle`)).toHaveLength(2)
    expect(clipEls(rect.root)[0].querySelectorAll(`.${styles.clipIcon} rect`)).toHaveLength(1)
  })
})

describe('TimelineTrack waveforms', () => {
  beforeEach(() => {
    resetStoreForTest()
    installCanvasDouble()
  })

  afterEach(() => {
    uninstallCanvasDouble()
  })

  const withAudio: SourceVideo = {
    ...video,
    hasAudio: true,
    waveformData: [
      { min: -0.5, max: 0.5 },
      { min: -0.8, max: 0.8 },
    ],
  }

  it('draws a waveform inside a clip whose source has peaks', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withAudio] })

    const canvas = root.querySelector('canvas')
    expect(canvas).not.toBeNull()
    // The waveform is exactly as tall as the clip box: the 60px row, less
    // `.track`'s 1px bottom border, less `.clip`'s 8px inset.
    expect(canvas).toHaveStyle({ height: '51px' })
  })

  it('draws the waveform no taller than the clip box it sits in', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withAudio] })

    const canvas = root.querySelector('canvas')!
    // `AudioWaveform` writes the same number to the backing store and to the CSS
    // height, so the two never disagree and nothing is ever rescaled. What
    // matters is whether that number fits: `.clip` is `overflow: hidden`, so a
    // canvas taller than the box has its bottom cut off and its centreline —
    // which is the middle of the canvas — sits below the middle of the box.
    //
    // 60px row − 1px `.track` border-bottom − 8px `.clip` inset = 51. The old
    // `track.height - 4` gave 56: five pixels too tall, so the lower peaks were
    // clipped and the whole waveform sat ~2.5px low.
    expect(canvas).toHaveAttribute('height', '51')
    expect(canvas.style.height).toBe('51px')
  })

  it('never shrinks the waveform below the clip box’s own minimum height', () => {
    const { root } = renderTrack({
      track: makeTrack({ height: 30 }),
      clips: [makeClip('clip1', 0)],
      sourceVideos: [withAudio],
    })

    // `.clip` has `min-height: 40px`, so a track dragged shorter than that stops
    // shrinking the box — and the canvas has to stop shrinking with it, exactly
    // as the thumbnail does (see the thumbnail clamp test below). 30 − 1 − 8 = 21
    // would be a 21px waveform in a 40px box, floating against its top edge.
    const canvas = root.querySelector('canvas')!
    expect(canvas).toHaveAttribute('height', '40')
    expect(canvas.style.height).toBe('40px')
  })

  it('draws no waveform when the source has audio but no peaks', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0)],
      sourceVideos: [{ ...video, hasAudio: true, waveformData: [] }],
    })

    expect(root.querySelector('canvas')).toBeNull()
  })

  it('draws no waveform for a clip with no source media at all', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [] })

    expect(root.querySelector('canvas')).toBeNull()
  })
})

describe('TimelineTrack keyframes', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('shows a clip’s keyframes on the row', () => {
    const clip = makeClip('clip1', 2, 4)
    store().setClipKeyframe(clip.id, 'opacity', { time: 1, value: 0.5, easing: 'linear' })
    const animated = { ...store().project.timeline.clips[0], trackId: TRACK_ID }

    const { root } = renderTrack({ clips: [animated] })

    // Keyframes are placed within the clip, so their offsets are clip-relative.
    const diamonds = root.querySelectorAll('[title^="Keyframe @"]')
    expect([...diamonds].map((d) => (d as HTMLElement).style.left)).toEqual(['0px', '50px'])
  })
})

describe('TimelineTrack clip thumbnails', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  /** A source with a thumbnail, which is what `processVideoFile` writes. */
  const withThumb: SourceVideo = { ...video, thumbnailUrl: 'blob:thumb-video' }
  /**
   * An audio source that somehow has one. `extractAudioMetadata` writes no
   * thumbnail, so the gate below is asserted against data that *would* draw if
   * the gate were only "has a thumbnail" — the absence of the field is not what
   * is under test.
   */
  const audioWithThumb: SourceVideo = {
    ...withThumb,
    id: 'audio1',
    mediaType: 'audio',
    thumbnailUrl: 'blob:thumb-audio',
  }

  function thumbOf(root: HTMLElement): HTMLImageElement | null {
    return root.querySelector<HTMLImageElement>(`img.${styles.clipThumb}`)
  }

  it('draws the source thumbnail at the head of a video clip', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withThumb] })

    const thumb = thumbOf(root)
    expect(thumb).not.toBeNull()
    expect(thumb).toHaveAttribute('src', 'blob:thumb-video')
    // 60px track → a 51px clip box: `.track` is `border-box` with a 1px
    // `border-bottom`, and `.clip` is `top: 4px; height: calc(100% - 8px)` of
    // that element's *padding* box. 16:9 of 51 rounds to 91. On the attributes
    // rather than in the style, so the element has its box and its ratio before
    // the blob URL decodes.
    expect(thumb).toHaveAttribute('height', '51')
    expect(thumb).toHaveAttribute('width', '91')
  })

  it('draws it for an image clip too', () => {
    // Its own URL, and it is the *second* source in the list: a row that drew
    // "the first source that has a thumbnail" rather than this clip's own source
    // would pass with `blob:thumb-video` and fail here.
    const image: SourceVideo = {
      ...withThumb,
      id: 'image1',
      mediaType: 'image',
      thumbnailUrl: 'blob:thumb-image',
    }
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { sourceVideoId: image.id })],
      sourceVideos: [withThumb, image],
    })

    expect(thumbOf(root)).toHaveAttribute('src', 'blob:thumb-image')
  })

  it('is decoration, not content, and cannot be dragged', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withThumb] })

    const thumb = thumbOf(root)!
    // The clip's name is already its label; announcing the picture too would say
    // the same thing twice. `alt=""` is also what keeps the e2e suite's
    // `checkImageAltText` counting this as decorative rather than as an image
    // missing alt text (apps/e2e/utils/accessibility.ts).
    expect(thumb).toHaveAttribute('alt', '')
    expect(thumb).toHaveAttribute('aria-hidden', 'true')
    // A native image drag would race the timeline's own clip drag.
    expect(thumb).toHaveAttribute('draggable', 'false')
    // The virtualiser unmounts and remounts clips as the timeline scrolls, so
    // these <img>s are created in bursts. Decoding off the main thread keeps a
    // burst off the gesture path — nothing here is waiting on the picture.
    expect(thumb).toHaveAttribute('decoding', 'async')
  })

  it('sits inside .clipContent, where the hit geometry cannot see it', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withThumb] })

    const thumb = thumbOf(root)!
    expect(thumb.parentElement).toHaveClass(styles.clipContent)
    // The timeline finds the clip under the pointer with
    // `target.closest('[data-clip-id]')` (useTimelineSeek.ts:108,
    // useTimelineMarquee.ts:190) and measures only `[data-track-id]` rows and
    // the container (useTrackAreaCache.ts:73), so an element *inside* a clip
    // changes neither. This is that claim, asserted.
    expect(thumb.closest('[data-clip-id]')).toBe(clipEls(root)[0])
    // And the trim handles are still the row's outermost interactive children.
    expect(clipEls(root)[0].querySelectorAll(`.${styles.trimHandle}`)).toHaveLength(2)
  })

  it('clips the thumbnail to the clip’s own circle, and writes nothing else', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { mask: { kind: 'circle' } })],
      sourceVideos: [withThumb],
    })

    // The whole inline style, not just the clip-path: this is also the pin that
    // the *stroke* is not drawn on the thumbnail in v1 (no border, no outline,
    // no box-shadow). A stroked clip is the next case.
    expect(thumbOf(root)).toHaveAttribute('style', 'clip-path: circle(25.5px at 25.5px 50%);')
  })

  it('leaves a stroked clip’s thumbnail unstroked (v1)', () => {
    const { root } = renderTrack({
      clips: [
        makeClip('clip1', 0, 2, {
          mask: { kind: 'circle' },
          stroke: { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 },
        }),
      ],
      sourceVideos: [withThumb],
    })

    // The border stays in the frame. The thumbnail shows the shape.
    expect(thumbOf(root)).toHaveAttribute('style', 'clip-path: circle(25.5px at 25.5px 50%);')
  })

  it('rounds the corners by the same fraction the frame uses', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { mask: { kind: 'rounded', radius: 0.25 } })],
      sourceVideos: [withThumb],
    })

    // 0.25 of the thumb's 51px shorter side is 12.75px — the same fraction, of
    // the same shorter side, that `core/clipMask.ts` resolves against the drawn
    // box.
    expect(thumbOf(root)).toHaveAttribute('style', 'clip-path: inset(0 round 12.75px);')
  })

  it('leaves an unmasked clip’s thumbnail unclipped', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withThumb] })

    // No `clip-path: none` — no style attribute at all, so the element is
    // byte-identical to an element that never had one.
    expect(thumbOf(root)!.getAttribute('style')).toBeNull()
  })

  it('never shrinks below the clip box’s own minimum height', () => {
    const { root } = renderTrack({
      track: makeTrack({ height: 30 }),
      clips: [makeClip('clip1', 0)],
      sourceVideos: [withThumb],
    })

    // `.clip` has `min-height: 40px`, so a shorter track stops shrinking the
    // box and the thumb has to stop shrinking with it — otherwise the picture
    // would float in a box taller than itself.
    expect(thumbOf(root)).toHaveAttribute('height', '40')
    expect(thumbOf(root)).toHaveAttribute('width', '71')
  })

  it('draws no thumbnail for an audio clip, even one whose source has one', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { sourceVideoId: audioWithThumb.id })],
      sourceVideos: [video, audioWithThumb],
    })

    // Media clips only (decision 3). An audio part carries no picture.
    expect(thumbOf(root)).toBeNull()
  })

  it.each<['text' | 'shape']>([['text'], ['shape']])(
    'draws no thumbnail for a %s overlay',
    (overlayType) => {
      const { root } = renderTrack({
        clips: [makeClip('clip1', 0, 2, { overlayType })],
        sourceVideos: [withThumb],
      })

      // An overlay has no drawn box a mask could mean anything against, which is
      // the same reason `ClipEditor` hides the Mask & Stroke section for one.
      expect(thumbOf(root)).toBeNull()
    }
  )

  it.each<[string, SourceVideo[]]>([
    ['the source has no thumbnail', [video]],
    ['the clip has no source at all', []],
  ])('draws no thumbnail when %s', (_label, sourceVideos) => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos })

    expect(thumbOf(root)).toBeNull()
  })
})

describe('TimelineTrack drag', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('draws the dragged clip at the pointer position, not its own', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 1, 2)],
      dragState: makeDrag({ originalPosition: 1, currentPosition: 5 }),
    })

    const [drawn] = clipEls(root)
    expect(drawn).toHaveClass(styles.clipDragging)
    expect(drawn).toHaveStyle({ left: '250px' })
  })

  it('drops a clip dragged off this row', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 1, 2), makeClip('clip2', 6)],
      dragState: makeDrag({ currentTrackId: 'other-track', originalPosition: 1, currentPosition: 5 }),
    })

    expect(clipEls(root).map((el) => el.dataset.clipId)).toEqual(['clip2'])
  })

  it('carries the rest of a multi-selection along by the same delta', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 1, 2), makeClip('clip2', 6), makeClip('clip3', 10)],
      selectedClipIds: new Set(['clip1', 'clip2']),
      dragState: makeDrag({ originalPosition: 1, currentPosition: 3 }),
    })

    const [one, two, three] = clipEls(root)
    expect(one).toHaveStyle({ left: '150px' })
    // clip2 travels with it: 6s + 2s of delta.
    expect(two).toHaveClass(styles.clipDragging)
    expect(two).toHaveStyle({ left: '400px' })
    // clip3 is not selected, so it stays put.
    expect(three).not.toHaveClass(styles.clipDragging)
    expect(three).toHaveStyle({ left: '500px' })
  })

  it('leaves a lone selected clip’s neighbours alone', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 1, 2), makeClip('clip2', 6)],
      selectedClipIds: new Set(['clip1']),
      dragState: makeDrag({ originalPosition: 1, currentPosition: 3 }),
    })

    expect(clipEls(root)[1]).toHaveStyle({ left: '300px' })
  })

  it('ghosts a clip being dragged in from another track', () => {
    const incoming = makeClip('clip9', 0, 3, { trackId: 'other-track' })
    const { root } = renderTrack({
      clips: [],
      allClips: [incoming],
      dragState: makeDrag({
        clipId: 'clip9',
        originalTrackId: 'other-track',
        currentTrackId: TRACK_ID,
        currentPosition: 2,
      }),
    })

    const preview = root.querySelector(`.${styles.clipPreview}`)
    expect(preview).toHaveStyle({ left: '100px', width: '150px' })
  })

  it('ghosts nothing when the drag started on this very track', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 3)],
      dragState: makeDrag({ currentPosition: 2 }),
    })

    expect(root.querySelector(`.${styles.clipPreview}`)).toBeNull()
  })

  it('gives the ghost no width when the dragged clip is gone', () => {
    const { root } = renderTrack({
      clips: [],
      allClips: [],
      dragState: makeDrag({
        clipId: 'vanished',
        originalTrackId: 'other-track',
        currentTrackId: TRACK_ID,
        currentPosition: 2,
      }),
    })

    expect(root.querySelector(`.${styles.clipPreview}`)).toHaveStyle({ width: '0px' })
  })
})
