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
    expect(result.current.clipPosition).toBe(3)
    expect(result.current.isVideo).toBe(true)
    expect(result.current.isOverlay).toBe(false)
    expect(result.current.clipTypeLabel).toBe('Video Clip')
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

    expect(spies.updateTextOverlayData).toHaveBeenCalledWith(clip.id, { x: 0.5, y: 0.5 })
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
    })
    expect(clipNow(clip.id).shapeData).toMatchObject({ width: 0.2, height: 0.2, rotation: 0 })
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
        in: { type: 'none', duration: 1.5, easing: 'linear' },
      })
    })
    spies.updateClipAnimation.mockClear()
    const { result } = mount()

    act(() => result.current.handleAnimationInTypeChange('slide-left'))

    expect(spies.updateClipAnimation).toHaveBeenCalledWith(clip.id, {
      in: { type: 'slide-left', duration: 1.5, easing: 'linear' },
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
    act(() => result.current.sliderGesture.onPointerDown())
    act(() => result.current.handleBlurChange(1))
    act(() => result.current.handleBlurChange(2))
    act(() => result.current.handleBlurChange(3))
    act(() => result.current.sliderGesture.onPointerUp())

    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(1, clip.id, { blur: 1 }, false)
    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(2, clip.id, { blur: 2 }, true)
    expect(spies.updateClipEffects).toHaveBeenNthCalledWith(3, clip.id, { blur: 3 }, true)
  })

  it('reports the project frame width the stroke is a fraction of', () => {
    mediaClip()
    const { result } = mount()

    // Derived from the `resolution` selector this hook has always had — no new
    // subscription, which is the rule `ClipEditor.rerender.test.tsx` holds.
    expect(result.current.frameWidth).toBe(store().project.resolution.width)
  })
})
