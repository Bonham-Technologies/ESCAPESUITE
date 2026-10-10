// Every write the clip inspector can make, driven through the hook rather than
// through the rendered panel.
//
// The store is the real one. Each action is replaced, for the duration of a
// test, by `vi.fn(theRealAction)` — so the argument assertions below are the
// exact object the handler built (the `?? 0.5` / `'ease-out'` / `'ease-in'`
// fallbacks are otherwise invisible, because the store's own defaults happen to
// be the same values), while the state assertions confirm the write really
// landed. Nothing is mocked out: remove the `toHaveBeenCalledWith` lines and
// the suite would still be driving a working editor.
//
// The trailing `false` several of those assertions carry is the `skipHistory`
// flag of ESCSUITE-75: a handler called straight from here is a write inside no
// slider gesture, so it pushes its own undo entry — the behaviour every one of
// these tests described before the flag existed. The gesture itself is pinned
// below ("one undo step per slider gesture") and end to end in
// `ClipEditor.sliderHistory.test.tsx`.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useClipEditorActions } from './useClipEditorActions'
import { useEditorStore } from '../../store/projectStore'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import { DEFAULT_CLIP_MASK_RADIUS } from '../../store/types'
import { MAX_CROP_INSET, cropUpdateFor } from '../../core/clipCrop'
import {
  cropCompensatesCentre,
  cropForHandleMove,
  cropWriteFor,
  sourceDelta,
  type CropHandle,
} from '../../core/cropDrag'
import { getOverlayBounds } from '../Preview/previewGeometry'
import type { Clip, SourceVideo } from '../../store/types'

/** The store actions the hook reaches for, wrapped so their arguments are visible. */
const ACTIONS = [
  'removeClipFromTimeline',
  'splitClip',
  'setCurrentTime',
  'updateClipTransform',
  'updateClipBlendMode',
  'updateClipEffects',
  'updateClipTransition',
  'updateClipAnimation',
  'updateClip',
  'duplicateClip',
  'updateTextOverlayData',
  'updateShapeOverlayData',
  'addTextOverlayClip',
  'addShapeOverlayClip',
  'setKeyframePanelOpen',
] as const

type ActionName = (typeof ACTIONS)[number]
type EditorState = ReturnType<typeof useEditorStore.getState>
type AnyFn = (...args: never[]) => unknown

const originals = {} as Record<ActionName, AnyFn>
let captured = false
let spies = {} as Record<ActionName, Mock>
let confirmSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetStoreForTest()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  const state = useEditorStore.getState() as unknown as Record<ActionName, AnyFn>
  if (!captured) {
    for (const name of ACTIONS) originals[name] = state[name]
    captured = true
  }

  spies = {} as Record<ActionName, Mock>
  const patch: Record<string, unknown> = {}
  for (const name of ACTIONS) {
    spies[name] = vi.fn(originals[name])
    patch[name] = spies[name]
  }
  useEditorStore.setState(patch as Partial<EditorState>)
})

afterEach(() => {
  confirmSpy.mockRestore()
  useEditorStore.setState(originals as unknown as Partial<EditorState>)
})

const mount = () => renderHook(() => useClipEditorActions())

/**
 * The one slider these tests press. The gesture belongs to the element that
 * opened it (ESCSUITE-267), so a press and its release name the same target.
 */
const slider = { currentTarget: new EventTarget() }

/** Select a clip and forget the writes that setting the scene made. */
function select(clip: Clip): Clip {
  store().setSelectedClipId(clip.id)
  for (const name of ACTIONS) spies[name].mockClear()
  return clip
}

/** A plain media clip on the default source video, selected. */
function mediaClip(position = 0, duration = 2): Clip {
  return select(addClip('clip1', position, duration))
}

/** A text overlay clip, selected (the store selects it on creation). */
function textClip(): Clip {
  store().addTextOverlayClip()
  return select(store().project.timeline.clips[0])
}

/** A shape overlay clip, selected. */
function shapeClip(): Clip {
  store().addShapeOverlayClip({ type: 'rectangle' })
  return select(store().project.timeline.clips[0])
}

const clipNow = (id: string): Clip =>
  useEditorStore.getState().project.timeline.clips.find((c) => c.id === id)!

describe('useClipEditorActions with nothing selected', () => {
  it('writes nothing to the store just by being mounted', () => {
    mediaClip()
    const before = useEditorStore.getState().project
    const history = useEditorStore.getState().history.past.length

    mount()

    for (const name of ACTIONS) expect(spies[name]).not.toHaveBeenCalled()
    expect(useEditorStore.getState().project).toBe(before)
    expect(useEditorStore.getState().history.past.length).toBe(history)
  })

  it('reports the empty-selection defaults', () => {
    const { result } = mount()

    expect(result.current.selectedClip).toBeUndefined()
    expect(result.current.sourceVideo).toBeNull()
    expect(result.current.track).toBeNull()
    expect(result.current.trackLocked).toBe(false)
    expect(result.current.clipPosition).toBe(0)
    // The scaleLocked selector falls back to true when it finds no clip.
    expect(result.current.scaleLocked).toBe(true)
    expect(result.current.clipTypeLabel).toBe('Video Clip')
  })

  it('every clip handler is a no-op without a selection', () => {
    const { result } = mount()

    act(() => {
      result.current.handleSplitAtPlayhead()
      result.current.handleDeleteClip()
      result.current.handleGoToClip()
      result.current.handleTransformChange('x', 0.1)
      result.current.handleDuplicate()
      result.current.handleBlendModeChange('multiply')
      result.current.handleBlurChange(4)
      result.current.handleTransitionTypeChange('fade')
      result.current.handleTransitionDurationChange(1)
      result.current.handleAnimationInTypeChange('fade')
      result.current.handleAnimationInDurationChange(1)
      result.current.handleAnimationInEasingChange('linear')
      result.current.handleAnimationOutTypeChange('fade')
      result.current.handleAnimationOutDurationChange(1)
      result.current.handleAnimationOutEasingChange('linear')
      result.current.handleResetTransform()
      result.current.handleFitToCanvas()
      result.current.handleTextDataChange({ text: 'x' })
      result.current.handleShapeDataChange({ strokeWidth: 2 })
      result.current.handleMaskChange({ kind: 'circle' })
      result.current.handleStrokeChange({ color: '#ffffff', width: 0.004 })
      result.current.handleCropChange({ left: 0.25, top: 0, right: 0, bottom: 0 })
    })

    for (const name of ACTIONS) expect(spies[name]).not.toHaveBeenCalled()
  })

  it('adds a text overlay clip', () => {
    const { result } = mount()

    act(() => result.current.handleAddText())

    expect(spies.addTextOverlayClip).toHaveBeenCalledWith()
    expect(store().project.timeline.clips[0].overlayType).toBe('text')
  })

  it('adds a shape overlay clip of the type it is given', () => {
    const { result } = mount()

    act(() => result.current.handleAddShape('ellipse'))

    expect(spies.addShapeOverlayClip).toHaveBeenCalledWith({ type: 'ellipse' })
    expect(store().project.timeline.clips[0].shapeData?.type).toBe('ellipse')
  })
})

describe('useClipEditorActions derived values', () => {
  it('resolves the clip, its source and its track', () => {
    const clip = mediaClip(3, 2)
    const { result } = mount()

    expect(result.current.selectedClip?.id).toBe(clip.id)
    expect(result.current.sourceVideo?.id).toBe(video.id)
    expect(result.current.track?.id).toBe(clip.trackId)
    expect(result.current.trackLocked).toBe(false)
    expect(result.current.clipPosition).toBe(3)
    expect(result.current.isVideo).toBe(true)
    expect(result.current.isOverlay).toBe(false)
    expect(result.current.clipTypeLabel).toBe('Video Clip')
  })

  it('reports trackLocked when the selected clip sits on a locked track (ESCSUITE-84)', () => {
    const clip = mediaClip(3, 2)
    store().updateTrack(clip.trackId, { locked: true })
    const { result } = mount()

    expect(result.current.trackLocked).toBe(true)
  })

  it('reports trackLocked as false when the clip names a track that does not exist', () => {
    const clip = mediaClip(3, 2)
    store().updateClip(clip.id, { trackId: 'no-such-track' })
    const { result } = mount()

    expect(result.current.track).toBeUndefined()
    expect(result.current.trackLocked).toBe(false)
  })

  it('classifies a text overlay, which has no source video', () => {
    textClip()
    const { result } = mount()

    expect(result.current.isTextOverlay).toBe(true)
    expect(result.current.isOverlay).toBe(true)
    expect(result.current.isVideo).toBe(false)
    expect(result.current.sourceVideo).toBeUndefined()
    expect(result.current.clipTypeLabel).toBe('Text Overlay')
  })

  it('classifies a shape overlay', () => {
    shapeClip()
    const { result } = mount()

    expect(result.current.isShapeOverlay).toBe(true)
    expect(result.current.clipTypeLabel).toBe('Shape Overlay')
  })

  // The playhead used to be one of the hook's selectors, feeding a `timeInClip`
  // the Split button read. It is not any more: the button subscribes to its own
  // disabled state (`SplitButton`) so a playback tick cannot re-render the
  // panel. The hook returns a fresh object on every render, so an unchanged
  // identity across a seek is the whole assertion — see
  // `ClipEditor.rerender.test.tsx` for the render counts themselves.
  it('is not re-run by the playhead moving', () => {
    mediaClip(3, 2)
    const { result } = mount()
    const before = result.current

    act(() => store().setCurrentTime(4))
    expect(result.current).toBe(before)

    act(() => store().setCurrentTime(5))
    expect(result.current).toBe(before)
  })

  it('reads scaleLocked off the selected clip, defaulting to true', () => {
    const clip = mediaClip()
    const { result } = mount()

    expect(result.current.scaleLocked).toBe(true)

    act(() => result.current.setScaleLocked(false))

    expect(spies.updateClipTransform).toHaveBeenCalledWith(clip.id, { scaleLocked: false })
    expect(result.current.scaleLocked).toBe(false)
    expect(clipNow(clip.id).transform.scaleLocked).toBe(false)
  })

  it('setScaleLocked does nothing when the selection has gone', () => {
    mediaClip()
    const { result } = mount()
    const locked = result.current.setScaleLocked

    act(() => store().setSelectedClipId(null))
    act(() => locked(false))

    expect(spies.updateClipTransform).not.toHaveBeenCalled()
  })

  it('follows the keyframe panel flag', () => {
    mediaClip()
    const { result } = mount()

    expect(result.current.keyframePanelOpen).toBe(false)

    act(() => result.current.handleKeyframePanelToggle())

    expect(spies.setKeyframePanelOpen).toHaveBeenCalledWith(true)
    expect(result.current.keyframePanelOpen).toBe(true)

    act(() => result.current.handleKeyframePanelToggle())

    expect(spies.setKeyframePanelOpen).toHaveBeenLastCalledWith(false)
  })
})

describe('useClipEditorActions clip actions', () => {
  it('splits at the playhead when it sits inside the clip', () => {
    const clip = mediaClip(3, 2)
    act(() => store().setCurrentTime(4))
    const { result } = mount()

    act(() => result.current.handleSplitAtPlayhead())

    expect(spies.splitClip).toHaveBeenCalledWith(clip.id, 1)
    expect(store().project.timeline.clips).toHaveLength(2)
  })

  it('refuses to split on the clip\'s first frame or outside it', () => {
    mediaClip(3, 2)
    const { result } = mount()

    // Outside the clip: timeInClip is null.
    act(() => result.current.handleSplitAtPlayhead())
    // Exactly on the start: timeInClip is 0, which the guard also rejects.
    act(() => store().setCurrentTime(3))
    act(() => result.current.handleSplitAtPlayhead())

    expect(spies.splitClip).not.toHaveBeenCalled()
    expect(store().project.timeline.clips).toHaveLength(1)
  })

  it('deletes the clip once the confirmation is accepted', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleDeleteClip())

    expect(confirmSpy).toHaveBeenCalledWith(`Delete clip "${clip.name}"?`)
    expect(spies.removeClipFromTimeline).toHaveBeenCalledWith(clip.id)
    expect(store().project.timeline.clips).toHaveLength(0)
  })

  it('keeps the clip when the confirmation is declined', () => {
    mediaClip()
    confirmSpy.mockReturnValue(false)
    const { result } = mount()

    act(() => result.current.handleDeleteClip())

    expect(confirmSpy).toHaveBeenCalled()
    expect(spies.removeClipFromTimeline).not.toHaveBeenCalled()
    expect(store().project.timeline.clips).toHaveLength(1)
  })

  it('moves the playhead to the clip\'s start', () => {
    mediaClip(3, 2)
    const { result } = mount()

    act(() => result.current.handleGoToClip())

    expect(spies.setCurrentTime).toHaveBeenCalledWith(3)
    expect(store().currentTime).toBe(3)
  })

  it('rebuilds handleGoToClip when the selected clip changes under it', () => {
    mediaClip(3, 2)
    store().addTrack('second')
    const secondTrack = store().project.timeline.tracks[1].id
    addClip('clip2', 3, 2, secondTrack)
    const { result } = mount()
    const before = result.current.handleGoToClip

    store().setSelectedClipId('clip2')

    // Both clips start at 3s, so the position the callback writes has not
    // moved: the only thing that changed is the clip it closes over, and it
    // has to be in the dependency array for that to be visible at all.
    expect(result.current.selectedClip!.id).toBe('clip2')
    expect(result.current.selectedClip!.timelinePosition).toBe(3)
    expect(result.current.handleGoToClip).not.toBe(before)
  })

  it('duplicates the clip', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleDuplicate())

    expect(spies.duplicateClip).toHaveBeenCalledWith(clip.id)
    expect(store().project.timeline.clips).toHaveLength(2)
  })
})

describe('useClipEditorActions transform', () => {
  it('writes both scale axes while the lock is on', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleTransformChange('scaleX', 2))

    expect(spies.updateClipTransform).toHaveBeenCalledWith(clip.id, { scaleX: 2, scaleY: 2 }, false)
    expect(clipNow(clip.id).transform).toMatchObject({ scaleX: 2, scaleY: 2 })
  })

  it('writes one scale axis once the lock is off', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.setScaleLocked(false))
    spies.updateClipTransform.mockClear()
    act(() => result.current.handleTransformChange('scaleY', 3))

    expect(spies.updateClipTransform).toHaveBeenCalledWith(clip.id, { scaleY: 3 }, false)
    expect(clipNow(clip.id).transform).toMatchObject({ scaleX: 1, scaleY: 3 })
  })

  it('writes a single key for the non-scale properties even while locked', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleTransformChange('x', 0.25))
    act(() => result.current.handleTransformChange('opacity', 0.4))

    expect(spies.updateClipTransform).toHaveBeenNthCalledWith(1, clip.id, { x: 0.25 }, false)
    expect(spies.updateClipTransform).toHaveBeenNthCalledWith(2, clip.id, { opacity: 0.4 }, false)
  })

  it('the section Reset restores position, scale and opacity but not rotation', () => {
    const clip = mediaClip()
    act(() => {
      store().updateClipTransform(clip.id, { x: 0.1, scaleX: 3, opacity: 0.2, rotation: 45 })
    })
    spies.updateClipTransform.mockClear()
    const { result } = mount()

    act(() => result.current.handleResetTransform())

    expect(spies.updateClipTransform).toHaveBeenCalledWith(clip.id, {
      x: 0.5,
      y: 0.5,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    })
    // Rotation is not in the payload, so it survives the reset.
    expect(clipNow(clip.id).transform).toMatchObject({ x: 0.5, scaleX: 1, opacity: 1, rotation: 45 })
    expect(spies.updateTextOverlayData).not.toHaveBeenCalled()
    expect(spies.updateShapeOverlayData).not.toHaveBeenCalled()
  })

  it('the section Reset also recentres a text overlay\'s own position', () => {
    const clip = textClip()
    const { result } = mount()

    act(() => result.current.handleResetTransform())

    // `true`: the second write of one click, so the transform write above it is
    // the one that pushed the entry both halves undo to (ESCSUITE-77).
    expect(spies.updateTextOverlayData).toHaveBeenCalledWith(clip.id, { x: 0.5, y: 0.5 }, true)
    expect(clipNow(clip.id).textData).toMatchObject({ x: 0.5, y: 0.5 })
  })

  it('the section Reset restores a shape overlay\'s size and rotation too', () => {
    const clip = shapeClip()
    const { result } = mount()

    act(() => result.current.handleResetTransform())

    // The 0.2 / 0.2 / 0 box is hard-coded in the handler, not read from a constant.
    expect(spies.updateShapeOverlayData).toHaveBeenCalledWith(clip.id, {
      x: 0.5,
      y: 0.5,
      width: 0.2,
      height: 0.2,
      rotation: 0,
    }, true)
    expect(clipNow(clip.id).shapeData).toMatchObject({ width: 0.2, height: 0.2, rotation: 0 })
  })

  it('the section Reset on a text overlay is one undo entry, not two', () => {
    const clip = textClip()
    store().updateClipTransform(clip.id, { x: 0.1, opacity: 0.2 })
    store().updateTextOverlayData(clip.id, { x: 0.1, y: 0.9 })
    useEditorStore.setState({ history: { past: [], future: [] } })
    const { result } = mount()

    act(() => result.current.handleResetTransform())

    // Two store writes, one undo step: the overlay write passes `skipHistory`,
    // so a single Ctrl+Z puts both the transform and the overlay's own
    // coordinates back.
    expect(useEditorStore.getState().history.past).toHaveLength(1)
    act(() => store().undo())
    expect(clipNow(clip.id).transform).toMatchObject({ x: 0.1, opacity: 0.2 })
    expect(clipNow(clip.id).textData).toMatchObject({ x: 0.1, y: 0.9 })
  })

  it('the section Reset on a shape overlay is one undo entry, not two', () => {
    const clip = shapeClip()
    store().updateClipTransform(clip.id, { x: 0.1, opacity: 0.2 })
    store().updateShapeOverlayData(clip.id, { x: 0.1, width: 0.7, rotation: 30 })
    useEditorStore.setState({ history: { past: [], future: [] } })
    const { result } = mount()

    act(() => result.current.handleResetTransform())

    expect(useEditorStore.getState().history.past).toHaveLength(1)
    act(() => store().undo())
    expect(clipNow(clip.id).transform).toMatchObject({ x: 0.1, opacity: 0.2 })
    expect(clipNow(clip.id).shapeData).toMatchObject({ x: 0.1, width: 0.7, rotation: 30 })
  })

  it('the scale row\'s Reset spreads the whole default transform, rotation included', () => {
    const clip = mediaClip()
    act(() => {
      store().updateClipTransform(clip.id, { rotation: 45, scaleLocked: false, x: 0.1 })
    })
    spies.updateClipTransform.mockClear()
    const { result } = mount()

    act(() => result.current.handleResetToDefaults())

    expect(spies.updateClipTransform).toHaveBeenCalledWith(clip.id, {
      x: 0.5,
      y: 0.5,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      scaleLocked: true,
    })
    expect(clipNow(clip.id).transform).toMatchObject({ rotation: 0, scaleLocked: true, x: 0.5 })
    // Unlike handleResetTransform, it never touches the overlay data.
    expect(spies.updateShapeOverlayData).not.toHaveBeenCalled()
  })

  it('fits the source frame inside the canvas', () => {
    const uhd: SourceVideo = { ...video, id: 'uhd', width: 3840, height: 2160 }
    store().addSourceVideo(uhd)
    store().addClipToTimeline(
      { id: 'big', sourceVideoId: uhd.id, name: 'big', startTime: 0, endTime: 2, duration: 2 },
      undefined,
      0
    )
    const clip = select(store().project.timeline.clips.find((c) => c.id === 'big')!)
    const { result } = mount()

    act(() => result.current.handleFitToCanvas())

    // min(1920/3840, 1080/2160) === 0.5
    expect(spies.updateClipTransform).toHaveBeenCalledWith(clip.id, { scaleX: 0.5, scaleY: 0.5 })
    expect(clipNow(clip.id).transform).toMatchObject({ scaleX: 0.5, scaleY: 0.5 })
  })

  it('fits the cropped region rather than the whole source (MINOR 2, final review)', () => {
    // A wide, short source so width stays the controlling axis both before and
    // after the crop, and the arithmetic reads cleanly: uncropped, the picture
    // is 2000px wide and Fit to Canvas picks 1920/2000 = 0.96; cropped to half
    // its width, the picture actually drawn is 1000px wide, so the scale that
    // fits it is exactly double.
    const wide: SourceVideo = { ...video, id: 'wide', width: 2000, height: 100 }
    store().addSourceVideo(wide)
    store().addClipToTimeline(
      {
        id: 'wideClip',
        sourceVideoId: wide.id,
        name: 'wideClip',
        startTime: 0,
        endTime: 2,
        duration: 2,
        crop: { left: 0, top: 0, right: 0.5, bottom: 0 },
      },
      undefined,
      0
    )
    const clip = select(store().project.timeline.clips.find((c) => c.id === 'wideClip')!)
    const { result } = mount()

    act(() => result.current.handleFitToCanvas())

    expect(spies.updateClipTransform).toHaveBeenCalledWith(clip.id, { scaleX: 1.92, scaleY: 1.92 })
    expect(clipNow(clip.id).transform).toMatchObject({ scaleX: 1.92, scaleY: 1.92 })
  })

  it('does not fit a clip that has no source video', () => {
    shapeClip()
    const { result } = mount()

    act(() => result.current.handleFitToCanvas())

    expect(spies.updateClipTransform).not.toHaveBeenCalled()
  })
})

describe('useClipEditorActions appearance', () => {
  it('sets the blend mode', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleBlendModeChange('multiply'))

    expect(spies.updateClipBlendMode).toHaveBeenCalledWith(clip.id, 'multiply')
    expect(clipNow(clip.id).blendMode).toBe('multiply')
  })

  it('sets the blur effect', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleBlurChange(12))

    expect(spies.updateClipEffects).toHaveBeenCalledWith(clip.id, { blur: 12 }, false)
    expect(clipNow(clip.id).effects?.blur).toBe(12)
  })

  it('sets the transition type and duration independently', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleTransitionTypeChange('dissolve'))
    act(() => result.current.handleTransitionDurationChange(0.75))

    expect(spies.updateClipTransition).toHaveBeenNthCalledWith(1, clip.id, { type: 'dissolve' })
    expect(spies.updateClipTransition).toHaveBeenNthCalledWith(2, clip.id, { duration: 0.75 }, false)
    expect(clipNow(clip.id).transition).toMatchObject({ type: 'dissolve', duration: 0.75 })
  })

  it('writes text overlay data straight through', () => {
    const clip = textClip()
    const { result } = mount()

    act(() => result.current.handleTextDataChange({ text: 'Hello', fontSize: 64 }))

    expect(spies.updateTextOverlayData).toHaveBeenCalledWith(clip.id, { text: 'Hello', fontSize: 64 }, false)
    expect(clipNow(clip.id).textData).toMatchObject({ text: 'Hello', fontSize: 64 })
  })

  it('writes shape overlay data straight through', () => {
    const clip = shapeClip()
    const { result } = mount()

    act(() => result.current.handleShapeDataChange({ fillColor: '#ff0000ff', strokeWidth: 4 }))

    expect(spies.updateShapeOverlayData).toHaveBeenCalledWith(
      clip.id,
      { fillColor: '#ff0000ff', strokeWidth: 4 },
      false
    )
    expect(clipNow(clip.id).shapeData).toMatchObject({ fillColor: '#ff0000ff', strokeWidth: 4 })
  })
})

describe('useClipEditorActions animation', () => {
  // Each of the six handlers sends a whole in/out preset, filling the two
  // fields it is not changing from the clip — or, on a clip with no animation
  // yet, from the literals in the handler.
  it('fills the in preset from the handler\'s own fallbacks on a fresh clip', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleAnimationInTypeChange('fade'))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
    })
    expect(clipNow(clip.id).animation?.in).toMatchObject({
      type: 'fade',
      duration: 0.5,
      easing: 'ease-out',
    })
  })

  it('fills the out preset from the handler\'s own fallbacks on a fresh clip', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleAnimationOutTypeChange('fade'))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      out: { type: 'fade', duration: 0.5, easing: 'ease-in' },
    })
  })

  it('fills the in duration change from the handler\'s own fallbacks on a fresh clip', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleAnimationInDurationChange(1.1))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      in: { type: 'none', duration: 1.1, easing: 'ease-out' },
    }, false)
  })

  it('fills the out duration change from the handler\'s own fallbacks on a fresh clip', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleAnimationOutDurationChange(1.1))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      out: { type: 'none', duration: 1.1, easing: 'ease-in' },
    }, false)
  })

  it('carries the clip\'s existing in duration and easing through a type change', () => {
    const clip = mediaClip()
    act(() => {
      store().updateClipAnimation(clip.id, {
        in: { type: 'none', duration: 0.5, easing: 'linear' },
      })
    })
    spies.updateClipAnimation.mockClear()
    const { result } = mount()

    act(() => result.current.handleAnimationInTypeChange('slide-left'))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      in: { type: 'slide-left', duration: 0.5, easing: 'linear' },
    })
  })

  // ESCSUITE-125: a preset type or easing change used to write back whatever
  // duration the clip already carried (or the handler's own 0.5s fallback) with
  // no bound, so choosing a preset on a clip shorter than 1s stored a duration
  // the clip could not hold — `generateOutPresetKeyframes` then computed a
  // negative `startTime` and the clip opened mid-animation. Clamped the same way
  // `trimAnimation` clamps a kept preset: `maxPresetDuration(selectedClip.duration)`,
  // exempting a `type: 'none'` preset (its duration does nothing, so clamping it
  // would throw away a number the UI never used).
  describe('clamping a preset\'s duration to what the clip can hold (ESCSUITE-125)', () => {
    it('clamps a fresh out preset chosen on a clip shorter than 1s', () => {
      const clip = mediaClip(0, 0.4)
      const { result } = mount()

      act(() => result.current.handleAnimationOutTypeChange('fade'))

      expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
        out: { type: 'fade', duration: 0.2, easing: 'ease-in' },
      })
      expect(clipNow(clip.id).animation?.out).toMatchObject({ type: 'fade', duration: 0.2 })
    })

    it('clamps a fresh in preset chosen on a clip shorter than 1s', () => {
      const clip = mediaClip(0, 0.4)
      const { result } = mount()

      act(() => result.current.handleAnimationInTypeChange('fade'))

      expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
        in: { type: 'fade', duration: 0.2, easing: 'ease-out' },
      })
    })

    it('re-clamps an already-oversized out preset\'s duration on an easing change', () => {
      const clip = mediaClip(0, 0.4)
      act(() => {
        store().updateClipAnimation(clip.id, {
          out: { type: 'fade', duration: 0.5, easing: 'linear' },
        })
      })
      spies.updateClipAnimation.mockClear()
      const { result } = mount()

      act(() => result.current.handleAnimationOutEasingChange('ease-in-out'))

      expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
        out: { type: 'fade', duration: 0.2, easing: 'ease-in-out' },
      })
    })

    it('re-clamps an already-oversized in preset\'s duration on an easing change', () => {
      const clip = mediaClip(0, 0.4)
      act(() => {
        store().updateClipAnimation(clip.id, {
          in: { type: 'fade', duration: 0.5, easing: 'linear' },
        })
      })
      spies.updateClipAnimation.mockClear()
      const { result } = mount()

      act(() => result.current.handleAnimationInEasingChange('ease-in-out'))

      expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
        in: { type: 'fade', duration: 0.2, easing: 'ease-in-out' },
      })
    })

    it('leaves a switched-off IN preset\'s duration unclamped too (review of ESCSUITE-125)', () => {
      const clip = mediaClip(0, 0.4)
      act(() => {
        store().updateClipAnimation(clip.id, {
          in: { type: 'fade', duration: 1.5, easing: 'linear' },
        })
      })
      spies.updateClipAnimation.mockClear()
      const { result } = mount()

      act(() => result.current.handleAnimationInTypeChange('none'))

      expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
        in: { type: 'none', duration: 1.5, easing: 'linear' },
      })
    })

    it('leaves a switched-off preset\'s duration unclamped, the exemption trimAnimation also makes', () => {
      const clip = mediaClip(0, 0.4)
      act(() => {
        store().updateClipAnimation(clip.id, {
          out: { type: 'fade', duration: 1.5, easing: 'linear' },
        })
      })
      spies.updateClipAnimation.mockClear()
      const { result } = mount()

      act(() => result.current.handleAnimationOutTypeChange('none'))

      expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
        out: { type: 'none', duration: 1.5, easing: 'linear' },
      })
    })
  })

  it('changes the in duration, keeping type and easing', () => {
    const clip = mediaClip()
    act(() => {
      store().updateClipAnimation(clip.id, {
        in: { type: 'fade', duration: 0.5, easing: 'linear' },
      })
    })
    spies.updateClipAnimation.mockClear()
    const { result } = mount()

    act(() => result.current.handleAnimationInDurationChange(1.25))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      in: { type: 'fade', duration: 1.25, easing: 'linear' },
    }, false)
    expect(clipNow(clip.id).animation?.in).toMatchObject({ type: 'fade', duration: 1.25 })
  })

  it('changes the in easing, keeping type and duration', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleAnimationInEasingChange('ease-in-out'))

    // No animation on the clip yet, so type and duration come from the fallbacks.
    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      in: { type: 'none', duration: 0.5, easing: 'ease-in-out' },
    })
  })

  it('changes the out duration, keeping type and easing', () => {
    const clip = mediaClip()
    act(() => {
      store().updateClipAnimation(clip.id, {
        out: { type: 'fade', duration: 0.5, easing: 'linear' },
      })
    })
    spies.updateClipAnimation.mockClear()
    const { result } = mount()

    act(() => result.current.handleAnimationOutDurationChange(0.9))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      out: { type: 'fade', duration: 0.9, easing: 'linear' },
    }, false)
    expect(clipNow(clip.id).animation?.out).toMatchObject({ duration: 0.9 })
  })

  it('changes the out easing, keeping type and duration', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleAnimationOutEasingChange('linear'))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      out: { type: 'none', duration: 0.5, easing: 'linear' },
    })
  })
})

describe('useClipEditorActions handler identity', () => {
  it('memoises the handlers, except the two that were inline arrows', () => {
    mediaClip()
    const { result, rerender } = mount()
    const first = result.current

    rerender()

    expect(result.current.handleAddText).toBe(first.handleAddText)
    expect(result.current.handleDeleteClip).toBe(first.handleDeleteClip)
    expect(result.current.setScaleLocked).toBe(first.setScaleLocked)
    // These two are plain closures, as they were when they lived in the JSX.
    expect(result.current.handleResetToDefaults).not.toBe(first.handleResetToDefaults)
    expect(result.current.handleKeyframePanelToggle).not.toBe(first.handleKeyframePanelToggle)
  })
})

describe('useClipEditorActions mask and stroke (ESCSUITE-65)', () => {
  it('stores a circle with no radius, whatever radius the section reported', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleMaskChange({ kind: 'circle', radius: 0.2 }))

    // The section reports what the user did; the handler decides what is stored.
    // A radius on a circle is noise the renderer never reads, so it is dropped
    // here rather than carried in every project file from now on.
    expect(spies.updateClip).toHaveBeenCalledWith(clip.id, { mask: { kind: 'circle' } }, false)
    expect(clipNow(clip.id).mask).toEqual({ kind: 'circle' })
  })

  it('stores a rounded mask with its radius, defaulting one that is missing', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleMaskChange({ kind: 'rounded', radius: 0.3 }))
    expect(clipNow(clip.id).mask).toEqual({ kind: 'rounded', radius: 0.3 })

    act(() => result.current.handleMaskChange({ kind: 'rounded' }))
    expect(clipNow(clip.id).mask).toEqual({ kind: 'rounded', radius: DEFAULT_CLIP_MASK_RADIUS })
  })

  it('removes the mask rather than storing kind none', () => {
    const clip = mediaClip()
    const { result } = mount()
    act(() => result.current.handleMaskChange({ kind: 'circle' }))

    act(() => result.current.handleMaskChange({ kind: 'none', radius: 0.2 }))

    // So a clip that was never masked and one whose mask was removed are the
    // same object, and `undefined === none` stays the only rule the renderer and
    // the migration need to know.
    expect(spies.updateClip).toHaveBeenLastCalledWith(clip.id, { mask: undefined }, false)
    expect(clipNow(clip.id).mask).toBeUndefined()
  })

  it('removes the stroke rather than storing a width of zero', () => {
    const clip = mediaClip()
    const { result } = mount()
    act(() => result.current.handleStrokeChange({ color: '#ffffff', width: 0.004 }))
    expect(clipNow(clip.id).stroke).toEqual({ color: '#ffffff', width: 0.004 })

    act(() => result.current.handleStrokeChange({ color: '#ffffff', width: 0 }))

    expect(spies.updateClip).toHaveBeenLastCalledWith(clip.id, { stroke: undefined }, false)
    expect(clipNow(clip.id).stroke).toBeUndefined()
  })

  it('pushes one history entry per change, through the action that already existed', () => {
    const clip = mediaClip()
    const { result } = mount()
    useEditorStore.setState({ history: { past: [], future: [] } })

    act(() => result.current.handleMaskChange({ kind: 'circle' }))
    act(() => result.current.handleStrokeChange({ color: '#ffffff', width: 0.004 }))

    // `updateClip` pushes history itself (clipSlice.ts:281), which is why this
    // feature adds no store action and no member to ClipSlice's Pick — and why
    // one Ctrl+Z takes the stroke off and leaves the mask on.
    expect(useEditorStore.getState().history.past).toHaveLength(2)
    act(() => store().undo())
    expect(clipNow(clip.id).stroke).toBeUndefined()
    expect(clipNow(clip.id).mask).toEqual({ kind: 'circle' })
  })

  it('asks the slider gesture what each write should do about history', () => {
    const clip = mediaClip()
    const { result } = mount()

    // The listeners the sections spread onto their sliders. A press opens the
    // gesture; the first write then pushes and the rest of the drag skips, so
    // the whole drag is one entry captured before it started.
    act(() => result.current.sliderGesture.onPointerDown(slider))
    act(() => result.current.handleBlurChange(1))
    act(() => result.current.handleBlurChange(2))
    act(() => result.current.handleBlurChange(3))
    act(() => result.current.sliderGesture.onPointerUp(slider))

    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(1, clip.id, { blur: 1 }, false)
    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(2, clip.id, { blur: 2 }, true)
    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(3, clip.id, { blur: 3 }, true)
  })

  // ESCSUITE-87. The gesture's undo entry follows the first write that LANDED,
  // not the first that was attempted. Driven through the hook because the panel
  // makes it unreachable: a locked row disables the whole fieldset, so there is
  // no slider to press. The store's own refusal is what this exercises, and a row
  // can be unlocked while a press is still held.
  it('gives the undo entry to the first write that lands, when a locked row refused the first', () => {
    const clip = mediaClip()
    const { result } = mount()
    act(() => store().updateTrack(clip.trackId, { locked: true }))
    useEditorStore.setState({ history: { past: [], future: [] } })

    act(() => result.current.sliderGesture.onPointerDown(slider))
    act(() => result.current.handleBlurChange(1))

    // Refused: no blur, and no entry for a later write to join.
    expect(clipNow(clip.id).effects.blur).toBe(0)
    expect(useEditorStore.getState().history.past).toHaveLength(0)

    act(() => store().updateTrack(clip.trackId, { locked: false }))
    useEditorStore.setState({ history: { past: [], future: [] } })

    act(() => result.current.handleBlurChange(2))
    act(() => result.current.handleBlurChange(3))
    act(() => result.current.sliderGesture.onPointerUp(slider))

    // The write that landed is the one that pushed. Before this, the refused
    // first write had claimed the push and both of these would have skipped,
    // leaving the drag off the undo stack entirely.
    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(1, clip.id, { blur: 1 }, false)
    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(2, clip.id, { blur: 2 }, false)
    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(3, clip.id, { blur: 3 }, true)
    expect(useEditorStore.getState().history.past).toHaveLength(1)
    expect(clipNow(clip.id).effects.blur).toBe(3)

    // And it is one entry, holding the clip as the gesture found it.
    act(() => store().undo())
    expect(clipNow(clip.id).effects.blur).toBe(0)
  })

  it('reports the project frame width the stroke is a fraction of', () => {
    mediaClip()
    const { result } = mount()

    // Derived from the `resolution` selector this hook has always had — no new
    // subscription, which is the rule `ClipEditor.rerender.test.tsx` holds.
    expect(result.current.frameWidth).toBe(store().project.resolution.width)
  })
})

// ESCSUITE-6. `CropSection` reports what the user did; this handler decides what
// gets stored, so the store only ever holds canonical shapes — the same division
// of labour the mask and stroke handlers above have.
describe('useClipEditorActions crop (ESCSUITE-6)', () => {
  // The fixture source is 1920x1080 (test/fixtures/projectStore.ts).
  const CROP = { left: 0.25, top: 0.1, right: 0, bottom: 0 }

  it('stores the crop the section reported, through the action that already existed', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleCropChange({ ...CROP }))

    // ESCSUITE-171: the write carries the compensating centre the on-canvas
    // handles have always written, so the edges this crop is not moving stay
    // where they are. 25% off the left of a 1920-wide source and 10% off the top
    // of a 1080-tall one move the kept region's centre 240 and 54 source pixels,
    // which at scale 1 in a 1920x1080 project is 0.125 and 0.05 of the frame.
    expect(spies.updateClip).toHaveBeenCalledWith(
      clip.id,
      { crop: CROP, transform: { ...clip.transform, x: 0.625, y: 0.55 } },
      false
    )
    expect(clipNow(clip.id).crop).toEqual(CROP)
  })

  it('removes the crop rather than storing four zeroes', () => {
    const clip = mediaClip()
    const { result } = mount()
    act(() => result.current.handleCropChange({ ...CROP }))

    act(() => result.current.handleCropChange({ left: 0, top: 0, right: 0, bottom: 0 }))

    // So a clip that was never cropped and one whose crop was reset are the same
    // object, and `undefined === none` stays the only rule the renderer, the
    // geometry and the validator need to know.
    expect(spies.updateClip).toHaveBeenLastCalledWith(
      clip.id,
      // And the centre comes back with it (ESCSUITE-171): Reset puts the picture
      // back where it started rather than leaving the previous write's
      // compensation behind.
      { crop: undefined, transform: { ...clip.transform, x: 0.5, y: 0.5 } },
      false
    )
    expect(clipNow(clip.id).crop).toBeUndefined()
  })

  it('clamps an inset the section somehow reported past the maximum', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleCropChange({ left: 2, top: -1, right: 0, bottom: 0 }))

    expect(clipNow(clip.id).crop).toEqual({
      left: MAX_CROP_INSET,
      top: 0,
      right: 0,
      bottom: 0,
    })
    // ESCSUITE-171, MINOR 1 (review round 1): the compensating centre is
    // computed from the **clamped** crop, not from what the section reported.
    // 90% off a 1920-wide source puts the kept region's centre at 1824, which is
    // 864 source pixels right of 960 and at scale 1 is +0.45 of the frame.
    // Handing `cropWriteFor` the raw `{ left: 2, top: -1 }` instead computes the
    // centre from a region `croppedSourceRect` has floored to one source pixel
    // and lands at x 2.0002604166666664, y 0 — which every other case on this
    // branch passes over, because they all report insets `normaliseCrop` leaves
    // alone.
    expect(spies.updateClip).toHaveBeenCalledWith(
      clip.id,
      {
        crop: { left: MAX_CROP_INSET, top: 0, right: 0, bottom: 0 },
        transform: { ...clip.transform, x: 0.95, y: 0.5 },
      },
      false
    )
  })

  it('writes nothing for a crop that would leave less than a source pixel', () => {
    const clip = mediaClip()
    const { result } = mount()
    act(() => result.current.handleCropChange({ ...CROP }))
    spies.updateClip.mockClear()

    // Two sliders at their 90% maximum, which is reachable: the handler refuses
    // rather than silently moving one of them, and the stored crop is untouched.
    act(() => result.current.handleCropChange({ left: 0.9, top: 0, right: 0.9, bottom: 0 }))

    expect(spies.updateClip).not.toHaveBeenCalled()
    expect(clipNow(clip.id).crop).toEqual(CROP)
  })

  it('writes nothing for a clip with no source media', () => {
    // An overlay never carries a crop: there is no source frame for insets to be
    // fractions of. The guard is what makes that true rather than documented.
    textClip()
    const { result } = mount()

    act(() => result.current.handleCropChange({ ...CROP }))

    expect(spies.updateClip).not.toHaveBeenCalled()
  })

  // MINOR 4, final review. A media clip can name a source the library has
  // lost — a session restored against a cleared store — and `sourceVideo` is
  // then undefined even though the clip is not an overlay. There are no
  // dimensions to measure a real inset's one-pixel floor against, but an
  // all-zero write needs no dimensions at all: it means "no crop", and a
  // clip whose source is gone should not be stuck with one forever.
  it('clears a stored crop with an all-zero write even when the source has left the library', () => {
    store().addClipToTimeline(
      {
        id: 'clip1',
        sourceVideoId: 'gone',
        name: 'clip1',
        startTime: 0,
        endTime: 2,
        duration: 2,
        crop: { left: 0.2, top: 0, right: 0, bottom: 0 },
      },
      undefined,
      0
    )
    const clip = select(store().project.timeline.clips.find((c) => c.id === 'clip1')!)
    const { result } = mount()

    act(() => result.current.handleCropChange({ left: 0, top: 0, right: 0, bottom: 0 }))

    expect(spies.updateClip).toHaveBeenCalledWith(clip.id, { crop: undefined }, false)
    expect(clipNow(clip.id).crop).toBeUndefined()
  })

  it('still refuses a non-zero inset when the source has left the library', () => {
    store().addClipToTimeline(
      {
        id: 'clip1',
        sourceVideoId: 'gone',
        name: 'clip1',
        startTime: 0,
        endTime: 2,
        duration: 2,
        crop: { left: 0.2, top: 0, right: 0, bottom: 0 },
      },
      undefined,
      0
    )
    const clip = select(store().project.timeline.clips.find((c) => c.id === 'clip1')!)
    const { result } = mount()

    act(() => result.current.handleCropChange({ left: 0.3, top: 0, right: 0, bottom: 0 }))

    expect(spies.updateClip).not.toHaveBeenCalled()
    expect(clipNow(clip.id).crop).toEqual({ left: 0.2, top: 0, right: 0, bottom: 0 })
  })

  it('asks the slider gesture what each crop write should do about history', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.sliderGesture.onPointerDown(slider))
    act(() => result.current.handleCropChange({ left: 0.1, top: 0, right: 0, bottom: 0 }))
    act(() => result.current.handleCropChange({ left: 0.2, top: 0, right: 0, bottom: 0 }))
    act(() => result.current.sliderGesture.onPointerUp(slider))

    // One drag, one undo entry — and exactly two writes, so a third could not
    // slip past. Each write's compensating centre (ESCSUITE-171) is rebased from
    // what the previous one stored, which is why the second is written as
    // `0.55 + 96 / 1920` rather than 0.6: that telescope is exact, where the
    // literal 0.6 is a double's last bit away from it.
    expect(spies.updateClip).toHaveBeenCalledTimes(2)
    const [first, second] = spies.updateClip.mock.calls
    expect(first[0]).toBe(clip.id)
    expect(first[1]).toEqual({
      crop: { left: 0.1, top: 0, right: 0, bottom: 0 },
      transform: { ...clip.transform, x: 0.5 + 96 / 1920, y: 0.5 },
    })
    expect(first[2]).toBe(false)
    expect(second[0]).toBe(clip.id)
    expect(second[1]).toEqual({
      crop: { left: 0.2, top: 0, right: 0, bottom: 0 },
      transform: { ...clip.transform, x: 0.55 + 96 / 1920, y: 0.5 },
    })
    expect(second[2]).toBe(true)
  })

  it('one undo takes the crop off and leaves the mask on', () => {
    const clip = mediaClip()
    const { result } = mount()
    useEditorStore.setState({ history: { past: [], future: [] } })

    act(() => result.current.handleMaskChange({ kind: 'circle' }))
    act(() => result.current.handleCropChange({ ...CROP }))

    expect(useEditorStore.getState().history.past).toHaveLength(2)
    act(() => store().undo())
    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(clipNow(clip.id).mask).toEqual({ kind: 'circle' })
  })

  // ESCSUITE-171. The inspector used to write `{ crop }` and nothing else while
  // the on-canvas handles wrote `{ crop, transform }` through `cropWriteFor` —
  // so the same inset reached from the two surfaces put the picture in two
  // different places, and the Crop section's Reset left a handle drag's
  // compensating centre behind for good. All four writers (the sliders, the
  // number fields, the presets and Reset/None) now go through the one
  // `cropWriteFor` the handles use, rebased from the clip's CURRENT crop and
  // transform — each inspector write is its own gesture.
  //
  // Measured through `getOverlayBounds`, which is the one box the renderer, the
  // selection chrome, the hit test and the marquee all read: a 400x200 source at
  // scale 1 in the 1920x1080 project sits at 760...1160 across.
  describe('keeps the edges it is not changing where they are (ESCSUITE-171)', () => {
    const SMALL: SourceVideo = { ...video, id: 'small', width: 400, height: 200 }
    const PROJECT = { width: 1920, height: 1080 }

    /** A clip on the 400x200 source, selected. */
    function smallClip(): Clip {
      store().addSourceVideo(SMALL)
      store().addClipToTimeline(
        { id: 'small1', sourceVideoId: SMALL.id, name: 'small1', startTime: 0, endTime: 2, duration: 2 },
        undefined,
        0
      )
      return select(store().project.timeline.clips.find((c) => c.id === 'small1')!)
    }

    let canvas: HTMLCanvasElement

    beforeEach(() => {
      canvas = document.createElement('canvas')
      canvas.width = PROJECT.width
      canvas.height = PROJECT.height
    })

    /** Where the drawn picture's left and right edges are, in project pixels. */
    function edges(id: string): [number, number] {
      const bounds = getOverlayBounds(
        clipNow(id),
        canvas,
        0,
        useEditorStore.getState().sourceVideos,
        PROJECT
      )!
      return [bounds.centerX - bounds.width / 2, bounds.centerX + bounds.width / 2]
    }

    /**
     * One crop-handle drag, written exactly as `useCropHandleGesture` writes it:
     * the gesture's own arithmetic, `cropUpdateFor`, then `cropWriteFor`. The
     * drag path is not what this ticket changes — it is the path the inspector
     * now has to agree with.
     */
    function dragHandle(id: string, handle: CropHandle, delta: { x: number; y: number }): void {
      const live = clipNow(id)
      const next = cropForHandleMove(
        live.crop,
        handle,
        sourceDelta(delta, live.transform),
        SMALL
      )
      const update = cropUpdateFor(next, SMALL)!
      store().updateClip(
        id,
        cropWriteFor(
          { crop: live.crop, transform: live.transform },
          update.crop,
          SMALL,
          PROJECT,
          cropCompensatesCentre(live.animation)
        )
      )
    }

    it('puts the picture back where it started when Reset follows a handle crop', () => {
      const clip = smallClip()
      const { result } = mount()
      expect(edges(clip.id)).toEqual([760, 1160])

      // The `w` handle pulled 100 project pixels to the right: the left edge
      // follows the pointer and the right edge stays put.
      dragHandle(clip.id, 'w', { x: 100, y: 0 })
      const dragged = edges(clip.id)
      expect(dragged[0]).toBeCloseTo(860, 6)
      expect(dragged[1]).toBeCloseTo(1160, 6)

      // The Crop section's header Reset, and its "None" preset, both report
      // four zeroes.
      act(() => result.current.handleCropChange({ left: 0, top: 0, right: 0, bottom: 0 }))

      const [left, right] = edges(clip.id)
      expect(left).toBeCloseTo(760, 6)
      expect(right).toBeCloseTo(1160, 6)
    })

    it('pins the opposite edge when a slider crops one side', () => {
      const clip = smallClip()
      const { result } = mount()

      act(() => result.current.handleCropChange({ left: 0.25, top: 0, right: 0, bottom: 0 }))

      const [left, right] = edges(clip.id)
      expect(right).toBeCloseTo(1160, 6)
      expect(left).toBeCloseTo(860, 6)
    })

    it('pins the top when a slider crops the bottom', () => {
      // The other axis, and the other sign: `cropCentreFor` moves y as well as x.
      const clip = smallClip()
      const { result } = mount()
      const top = () => {
        const bounds = getOverlayBounds(
          clipNow(clip.id),
          canvas,
          0,
          useEditorStore.getState().sourceVideos,
          PROJECT
        )!
        return bounds.centerY - bounds.height / 2
      }
      expect(top()).toBe(440)

      act(() => result.current.handleCropChange({ left: 0, top: 0, right: 0, bottom: 0.25 }))

      expect(top()).toBeCloseTo(440, 6)
    })

    it('carries the rest of the transform across untouched', () => {
      // `cropWriteFor` is handed the whole transform rather than a patch, so
      // opacity, rotation and scaleLocked come across unchanged and the write
      // stays one `updateClip`.
      const clip = smallClip()
      store().updateClipTransform(clip.id, { rotation: 0, opacity: 0.5, scaleLocked: false })
      spies.updateClip.mockClear()
      const { result } = mount()

      act(() => result.current.handleCropChange({ left: 0.25, top: 0, right: 0, bottom: 0 }))

      const transform = clipNow(clip.id).transform
      expect(transform.opacity).toBe(0.5)
      expect(transform.scaleLocked).toBe(false)
      expect(transform.scaleX).toBe(1)
      // 50 source pixels of centre displacement, over the project's width.
      expect(transform.x).toBeCloseTo(0.5 + 50 / PROJECT.width, 10)
    })

    it('writes the crop alone on a clip whose placement is keyframed', () => {
      // `cropCompensatesCentre`'s false arm, which the handles already honour: a
      // static centre on an animated one fights the keyframes and loses at
      // playback, so the inspector writes the crop by itself exactly as a drag
      // does on such a clip (operator ruling, 2026-10-02).
      const clip = smallClip()
      store().setClipKeyframe(clip.id, 'x', { time: 0, value: 0.25, easing: 'linear' })
      spies.updateClip.mockClear()
      const { result } = mount()

      act(() => result.current.handleCropChange({ left: 0.25, top: 0, right: 0, bottom: 0 }))

      expect(spies.updateClip).toHaveBeenCalledWith(
        clip.id,
        { crop: { left: 0.25, top: 0, right: 0, bottom: 0 } },
        false
      )
    })
  })

  it('opens crop mode on the selected clip', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleCropOnCanvasToggle())

    expect(store().cropClipId).toBe(clip.id)
    expect(result.current.cropOnCanvas).toBe(true)
  })

  it('closes it again, rather than re-opening it on the same clip', () => {
    mediaClip()
    const { result } = mount()
    act(() => result.current.handleCropOnCanvasToggle())

    act(() => result.current.handleCropOnCanvasToggle())

    expect(store().cropClipId).toBeNull()
    expect(result.current.cropOnCanvas).toBe(false)
  })

  it('reads crop mode as off while the latch names another clip', () => {
    // The latch is never cleared on a selection change; the readers compare it
    // to the selection, and so does the toggle's own pressed state.
    const clip = mediaClip()
    store().setCropClipId('some-other-clip')
    const { result } = mount()

    expect(result.current.cropOnCanvas).toBe(false)

    act(() => result.current.handleCropOnCanvasToggle())

    expect(store().cropClipId).toBe(clip.id)
  })
})
