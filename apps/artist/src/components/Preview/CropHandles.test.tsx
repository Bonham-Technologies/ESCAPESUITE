// The crop handle layer: where the eight handles sit, and what dragging one
// writes (ESCSUITE-157).
//
// Rendered on its own over a canvas with a layout box, the way
// `InlineTextEditorAnchor.test.tsx` renders the inline editor: the store is
// real, so the assertions are about the clip the drag actually produced.
//
// The scene throughout: the default 1920x1080 source and project, a canvas laid
// out at 960x540 — so one CSS pixel is two project pixels and nothing is
// letterboxed — and a clip at the default centre and scale, whose kept region
// is therefore the whole frame and whose frame box is the whole 960x540 box.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CropHandles } from './CropHandles'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import { makeClip, makeTransitionInfo } from '../../test/fixtures/clipFixtures'
import { installCanvasDouble, uninstallCanvasDouble } from '../../test/doubles/canvas'
import { setRect } from '../../test/doubles/layout'
import {
  installResizeObserverDouble,
  type ResizeObserverDouble,
} from '../../test/doubles/resizeObserver'
import type { TransitionInfo } from '../../core/exportTypes'
import type { Clip } from '../../store/types'

let observer: ResizeObserverDouble

beforeEach(() => {
  installCanvasDouble()
  observer = installResizeObserverDouble()
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  observer.uninstall()
  uninstallCanvasDouble()
})

const clipNow = (id: string): Clip => store().project.timeline.clips.find((c) => c.id === id)!

const past = (): number => store().history.past.length

/** The canvas the handles are positioned over: 1920x1080 project in a 960x540 box. */
function previewCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1920
  canvas.height = 1080
  setRect(canvas, { left: 0, top: 0, width: 960, height: 540 })
  return canvas
}

interface Mounted {
  clip: Clip
  onLeave: ReturnType<typeof vi.fn>
  handle(name: string): HTMLButtonElement
}

function mount({ locked = false }: { locked?: boolean } = {}): Mounted {
  const clip = addClip('clip1', 0, 4)
  const onLeave = vi.fn()
  render(
    <CropHandles
      clip={clip}
      source={video}
      canvas={previewCanvas()}
      projectSize={{ width: 1920, height: 1080 }}
      time={1}
      locked={locked}
      onLeave={onLeave}
    />
  )
  return {
    clip,
    onLeave,
    handle: (name) => screen.getByRole('button', { name }) as HTMLButtonElement,
  }
}

/** Drag one handle by a displacement in the canvas element's own CSS pixels. */
function drag(handle: HTMLButtonElement, dx: number, dy: number, shiftKey = false): void {
  fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(document, { clientX: dx, clientY: dy, shiftKey })
  fireEvent.mouseUp(document)
}

/**
 * Let the throttler's animation frame run, so the move it is holding reaches the
 * store.
 *
 * The `drag` helper above never needs this — `mouseup` flushes the pending move
 * synchronously, so a whole drag is one write. A case that wants SEVERAL writes
 * inside one drag has to let the frames in between actually fire, which is what
 * this is for.
 */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

describe('the crop handle layer', () => {
  it('draws eight handles with eight distinct names, in one named group', () => {
    mount()

    const group = screen.getByRole('group', { name: 'Crop handles' })
    const names = Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual([
      'Crop top left',
      'Crop top',
      'Crop top right',
      'Crop left',
      'Crop right',
      'Crop bottom left',
      'Crop bottom',
      'Crop bottom right',
    ])
    expect(new Set(names).size).toBe(8)
  })

  it('frames the kept region in the element\'s own CSS pixels', () => {
    mount()

    const frame = screen.getByRole('group', { name: 'Crop handles' })
    expect(frame.style.left).toBe('0px')
    expect(frame.style.top).toBe('0px')
    expect(frame.style.width).toBe('960px')
    expect(frame.style.height).toBe('540px')
  })

  it('shrinks the frame onto a cropped clip', () => {
    // Half the width cropped off the right: 960x1080 of source, drawn at scale 1
    // and still centred on the frame, so the picture spans project x 480…1440 —
    // 480 CSS pixels wide starting at 240.
    const clip = addClip('clip1', 0, 4)
    store().updateClip(clip.id, { crop: { left: 0, top: 0, right: 0.5, bottom: 0 } })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    const frame = screen.getByRole('group', { name: 'Crop handles' })
    expect(frame.style.left).toBe('240px')
    expect(frame.style.width).toBe('480px')
  })

  it('rotates the frame with the clip', () => {
    const clip = addClip('clip1', 0, 4)
    store().updateClipTransform(clip.id, { rotation: 30 })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    expect(screen.getByRole('group', { name: 'Crop handles' }).style.transform).toBe('rotate(30deg)')
  })

  it('follows the canvas when the element is resized under it', () => {
    const canvas = previewCanvas()
    render(
      <CropHandles
        clip={addClip('clip1', 0, 4)}
        source={video}
        canvas={canvas}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    setRect(canvas, { left: 0, top: 0, width: 480, height: 270 })
    // Inside act(): a ResizeObserver entry is not a React event, so the state it
    // sets is flushed asynchronously otherwise — `renderPreview`'s own `resize`
    // wraps its emit for the same reason.
    act(() => observer.emit(canvas, { width: 480, height: 270 }))

    expect(screen.getByRole('group', { name: 'Crop handles' }).style.width).toBe('480px')
  })

  it('crops from the left when the left handle is dragged right', () => {
    const { clip, handle } = mount()

    // 96 CSS pixels is 192 project pixels, which at scale 1 is 192 source
    // pixels — a tenth of a 1920-wide frame.
    drag(handle('Crop left'), 96, 0)

    expect(clipNow(clip.id).crop).toEqual({ left: 0.1, top: 0, right: 0, bottom: 0 })
  })

  it('moves the clip\'s centre so the edges it is not dragging stay still', () => {
    const { clip, handle } = mount()

    drag(handle('Crop left'), 96, 0)

    // The kept region is 1728 wide and its centre moved 96 project pixels, so
    // the right edge of the picture is exactly where it was.
    expect(clipNow(clip.id).transform.x).toBeCloseTo(0.55)
    expect(clipNow(clip.id).transform.y).toBeCloseTo(0.5)
  })

  it('crops from the top, and moves the centre down with it', () => {
    // The y half of the same arithmetic: 54 CSS pixels is 108 project pixels,
    // which is a tenth of a 1080-high frame. The kept region is 972 high and its
    // centre moved 54 project pixels, so the bottom edge of the picture is
    // exactly where it was — and x is untouched.
    const { clip, handle } = mount()

    drag(handle('Crop top'), 0, 54)

    expect(clipNow(clip.id).crop).toEqual({ left: 0, top: 0.1, right: 0, bottom: 0 })
    expect(clipNow(clip.id).transform.y).toBeCloseTo(0.55)
    expect(clipNow(clip.id).transform.x).toBe(0.5)
  })

  it('crops both axes from a corner, and moves the centre on both', () => {
    const { clip, handle } = mount()

    drag(handle('Crop top left'), 96, 54)

    expect(clipNow(clip.id).crop).toEqual({ left: 0.1, top: 0.1, right: 0, bottom: 0 })
    expect(clipNow(clip.id).transform.x).toBeCloseTo(0.55)
    expect(clipNow(clip.id).transform.y).toBeCloseTo(0.55)
  })

  it('reads a rotated clip\'s handles in the clip\'s own frame', () => {
    const clip = addClip('clip1', 0, 4)
    store().updateClipTransform(clip.id, { rotation: 90 })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    // Dragging DOWN on a clip rotated 90° is dragging along its own +x.
    drag(screen.getByRole('button', { name: 'Crop left' }) as HTMLButtonElement, 0, 96)

    // `toBeCloseTo`, not `toEqual`: cos(-90°) is 6.1e-17 rather than 0, so the
    // inset lands a few ulps off a tenth. The three insets the handle does not
    // own are untouched and so are exact.
    const crop = clipNow(clip.id).crop!
    expect(crop.left).toBeCloseTo(0.1)
    expect(crop.top).toBe(0)
    expect(crop.right).toBe(0)
    expect(crop.bottom).toBe(0)
  })

  it('writes the crop alone on a clip whose position is keyframed', () => {
    // A static centre written onto an animated one would fight its keyframes and
    // lose at playback, so the compensation is skipped and the picture shrinks
    // about its centre instead (operator ruling, 2026-10-02).
    const clip = addClip('clip1', 0, 4)
    store().setClipKeyframe(clip.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    drag(screen.getByRole('button', { name: 'Crop left' }) as HTMLButtonElement, 96, 0)

    expect(clipNow(clip.id).crop).toEqual({ left: 0.1, top: 0, right: 0, bottom: 0 })
    expect(clipNow(clip.id).transform.x).toBe(0.5)
  })

  it('holds the region\'s aspect while Shift is down', () => {
    const { clip, handle } = mount()

    // The frame is 16:9; cropping 192px off the left leaves 1728x1080, and
    // holding 16:9 takes the height to 972 — 54px off the top and the bottom.
    drag(handle('Crop left'), 96, 0, true)

    const crop = clipNow(clip.id).crop!
    expect(crop.left).toBeCloseTo(0.1)
    expect(crop.top).toBeCloseTo(0.05)
    expect(crop.bottom).toBeCloseTo(0.05)
  })

  it('leaves one undo entry for a drag, however many writes it took', async () => {
    // Five moves with a frame between each, so five writes actually reach the
    // store: this is `useGestureHistory`'s mechanism under load — the first
    // write unskipped and every later one `skipHistory` — and not the "one move,
    // one write" every other case here produces.
    const { clip, handle } = mount()
    const before = past()

    const button = handle('Crop left')
    fireEvent.mouseDown(button, { clientX: 0, clientY: 0 })
    // 48 CSS pixels a step is 96 project pixels, a twentieth of the 1920-wide
    // frame — so the fifth write is a quarter of it cropped away.
    for (let step = 1; step <= 5; step++) {
      fireEvent.mouseMove(document, { clientX: step * 48, clientY: 0 })
      await frame()
      // The inset as the gesture computes it, so the expectation carries no
      // rounding of its own: five twentieths, not five times 0.05.
      const left = (step * 96) / 1920
      expect(clipNow(clip.id).crop).toEqual({ left, top: 0, right: 0, bottom: 0 })
    }
    fireEvent.mouseUp(document)

    expect(past()).toBe(before + 1)
    expect(clipNow(clip.id).crop).toEqual({ left: 0.25, top: 0, right: 0, bottom: 0 })
  })

  it('is still one undo entry when Shift is released mid-drag (ESCSUITE-169)', async () => {
    // `onMouseDown` focuses the handle explicitly (so the arrow keys have
    // something to nudge once the mouse lets go), which means a Shift keyup —
    // released to drop the aspect lock without releasing the mouse — reaches
    // this component mid-drag. `onKeyUp` used to be `gestureHistory.end()` for
    // ANY key, which closed the gesture out from under the still-open mouse
    // drag: every write after it then pushed its own entry.
    const { clip, handle } = mount()
    const before = past()

    const button = handle('Crop left')
    fireEvent.mouseDown(button, { clientX: 0, clientY: 0 })
    for (let step = 1; step <= 5; step++) {
      fireEvent.mouseMove(document, { clientX: step * 48, clientY: 0 })
      if (step === 1) fireEvent.keyUp(button, { key: 'Shift' })
      await frame()
    }
    fireEvent.mouseUp(document)

    expect(past()).toBe(before + 1)
    expect(clipNow(clip.id).crop).toEqual({ left: 0.25, top: 0, right: 0, bottom: 0 })
  })

  it('is still one undo entry when blur reaches the handle mid-drag (ESCSUITE-169)', async () => {
    // `onBlur` is bound to the same callback as `onKeyUp`, so a focus change —
    // a window switch, say — mid-drag closed the gesture exactly as a keyup
    // did. The mouse is still driving the drag; only its own `mouseup` should
    // end it.
    const { clip, handle } = mount()
    const before = past()

    const button = handle('Crop left')
    fireEvent.mouseDown(button, { clientX: 0, clientY: 0 })
    for (let step = 1; step <= 5; step++) {
      fireEvent.mouseMove(document, { clientX: step * 48, clientY: 0 })
      if (step === 1) fireEvent.blur(button)
      await frame()
    }
    fireEvent.mouseUp(document)

    expect(past()).toBe(before + 1)
    expect(clipNow(clip.id).crop).toEqual({ left: 0.25, top: 0, right: 0, bottom: 0 })
  })

  it('derives every move from the crop the drag started with, not the one the last move wrote', async () => {
    // Constraint 8's other headline clause, and the one a stale-prop drag hides:
    // the component is re-rendered with the clip the FIRST write produced, and
    // the second move still lands where the pointer is rather than a second
    // tenth further on. A gesture that rebased on the clip it is editing would
    // read `left` 0.15 and `transform.x` 0.575 here — the ESCSUITE-110 trim bug,
    // in a different gesture.
    const clip = addClip('clip1', 0, 4)
    const rest = {
      source: video,
      canvas: previewCanvas(),
      projectSize: { width: 1920, height: 1080 },
      time: 1,
      locked: false,
      onLeave: vi.fn(),
    }
    const { rerender } = render(<CropHandles clip={clip} {...rest} />)
    const before = past()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Crop left' }), { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 48, clientY: 0 })
    await frame()

    // 48 CSS pixels in: half the eventual crop, and a centre moved half as far.
    expect(clipNow(clip.id).crop).toEqual({ left: 0.05, top: 0, right: 0, bottom: 0 })
    expect(clipNow(clip.id).transform.x).toBeCloseTo(0.525)
    rerender(<CropHandles clip={clipNow(clip.id)} {...rest} />)

    fireEvent.mouseMove(document, { clientX: 96, clientY: 0 })
    fireEvent.mouseUp(document)

    expect(clipNow(clip.id).crop).toEqual({ left: 0.1, top: 0, right: 0, bottom: 0 })
    expect(clipNow(clip.id).transform.x).toBeCloseTo(0.55)
    expect(past()).toBe(before + 1)
  })

  it('undoes the drag back to the uncropped clip, at the centre it started from', () => {
    const { clip, handle } = mount()

    drag(handle('Crop left'), 96, 0)
    store().undo()

    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(clipNow(clip.id).transform.x).toBe(0.5)
  })

  it('disables every handle on a locked track, and writes nothing', () => {
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(clip.trackId, { locked: true })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked
        onLeave={vi.fn()}
      />
    )
    const before = past()

    drag(screen.getByRole('button', { name: 'Crop left' }) as HTMLButtonElement, 96, 0)

    const group = screen.getByRole('group', { name: 'Crop handles' })
    for (const button of group.querySelectorAll('button')) expect(button).toBeDisabled()
    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(past()).toBe(before)
  })

  it('offers each handle its own resize cursor', () => {
    const { handle } = mount()

    expect(handle('Crop left').style.cursor).toBe('ew-resize')
    expect(handle('Crop top left').style.cursor).toBe('nwse-resize')
  })

  it('offers not-allowed instead on a locked track', () => {
    // ESCSUITE-88's answer for a locked row's handle. The cursor is computed
    // once, inline: the stylesheet's `:disabled` rule cannot reach past an inline
    // `style`, so a locked handle used to advertise a resize it would refuse.
    const { handle } = mount({ locked: true })

    expect(handle('Crop left').style.cursor).toBe('not-allowed')
    expect(handle('Crop top left').style.cursor).toBe('not-allowed')
  })

  it('clamps a drag past the far edge to the stored maximum', () => {
    const { clip, handle } = mount()

    // `cropForHandleMove` stops one source pixel short of the opposite edge and
    // `normaliseCrop` then clamps to MAX_CROP_INSET, so the stored crop is the
    // clamp rather than the ask — and the handle simply stops moving.
    drag(handle('Crop left'), 9999, 0)

    expect(clipNow(clip.id).crop).toEqual({ left: 0.9, top: 0, right: 0, bottom: 0 })
  })

  it('writes nothing for an aspect-locked drag that would leave no pixel', () => {
    // The other side of `cropUpdateFor`'s refusal: an aspect-locked drag
    // DERIVES the dependent axis rather than clamping it, so Shift-dragging the
    // left handle to the far edge asks for a 1px-wide, 0.6px-high region —
    // `normaliseCrop` refuses it, and the gesture simply writes nothing rather
    // than storing a region the renderer could not read.
    const { clip, handle } = mount()
    const before = past()

    drag(handle('Crop left'), 9999, 0, true)

    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(past()).toBe(before)
  })

  it('renders nothing while the preview panel is collapsed to nothing', () => {
    // A preview whose panel has been dragged shut reports a 0x0 box — the case
    // ESCSUITE-90's `handleScreenScale` guards — and a content box with no area
    // is a scale of 0 for the gesture to divide a pointer displacement by, which
    // is an Infinity delta and a crop slammed to its clamp on the first move.
    // The layer renders nothing at all instead; every other case here is the
    // other side of it.
    const canvas = previewCanvas()
    setRect(canvas, { left: 0, top: 0, width: 0, height: 0 })
    render(
      <CropHandles
        clip={addClip('clip1', 0, 4)}
        source={video}
        canvas={canvas}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    expect(screen.queryByRole('group', { name: 'Crop handles' })).not.toBeInTheDocument()
  })

  it('renders nothing for a clip whose source it was not handed', () => {
    // `getOverlayBounds` has no box for a clip whose source is missing from the
    // list it is given. Crop mode cannot reach it — `cropTarget` looks the
    // source up off the clip — but the type says it can, and the layer answers
    // with no frame rather than a frame at NaN.
    render(
      <CropHandles
        clip={addClip('clip1', 0, 4)}
        source={{ ...video, id: 'someone-else' }}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    expect(screen.queryByRole('group', { name: 'Crop handles' })).not.toBeInTheDocument()
  })

  it('takes its listeners with it when it unmounts mid-drag', () => {
    const { clip, handle } = mount()
    fireEvent.mouseDown(handle('Crop left'), { clientX: 0, clientY: 0 })

    cleanup()
    fireEvent.mouseMove(document, { clientX: 96, clientY: 0 })

    expect(clipNow(clip.id).crop).toBeUndefined()
  })

  it('leaves crop mode on Escape, and claims the key', () => {
    const { onLeave, handle } = mount()

    expect(fireEvent.keyDown(handle('Crop left'), { key: 'Escape' })).toBe(false)
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  it('leaves every other key alone', () => {
    // Escape leaves crop mode and the four arrows nudge (the next describe
    // block), so Tab is what is left to prove falls through untouched — a
    // focused handle does not swallow the key that moves focus off it.
    const { onLeave, handle } = mount()

    expect(fireEvent.keyDown(handle('Crop left'), { key: 'Tab' })).toBe(true)
    expect(onLeave).not.toHaveBeenCalled()
  })
})

describe('nudging a crop handle from the keyboard', () => {
  /** What the live region is saying, with the re-read mark taken off. */
  const announced = (): string =>
    (screen.getByRole('status').textContent ?? '').replace(/\u200B$/, '')

  it('crops one source pixel per arrow press, in the direction the arrow points', () => {
    // The playhead must not step under a nudge that DOES move something, any
    // more than under one that does not (the swallow case below): the key is
    // claimed either way, so `fireEvent.keyDown` reports it as handled.
    const { clip, handle } = mount()

    expect(fireEvent.keyDown(handle('Crop left'), { key: 'ArrowRight' })).toBe(false)

    expect(clipNow(clip.id).crop).toEqual({ left: 1 / 1920, top: 0, right: 0, bottom: 0 })
  })

  it('crops ten with Shift', () => {
    const { clip, handle } = mount()

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowRight', shiftKey: true })

    expect(clipNow(clip.id).crop).toEqual({ left: 10 / 1920, top: 0, right: 0, bottom: 0 })
  })

  it('moves the handle back out again, towards the frame\'s edge', () => {
    const { clip, handle } = mount()
    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowRight', shiftKey: true })

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowLeft' })

    // Two divisions by 1920 and a subtraction do not land on 9/1920 exactly.
    expect(clipNow(clip.id).crop!.left).toBeCloseTo(9 / 1920, 6)
  })

  it('nudges both of a corner\'s insets', () => {
    const { clip, handle } = mount()

    fireEvent.keyDown(handle('Crop top left'), { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(handle('Crop top left'), { key: 'ArrowDown', shiftKey: true })

    expect(clipNow(clip.id).crop).toEqual({
      left: 10 / 1920,
      top: 10 / 1080,
      right: 0,
      bottom: 0,
    })
  })

  it('swallows an arrow the handle has no inset for, and does nothing with it', () => {
    // The playhead must not step out from under a user whose focus is on a crop
    // handle, so the key is claimed; there is simply nothing for it to move.
    // 'w' owns no y inset at all, so both of its unowned arrows are proved here.
    const { clip, handle } = mount()

    expect(fireEvent.keyDown(handle('Crop left'), { key: 'ArrowUp' })).toBe(false)
    expect(fireEvent.keyDown(handle('Crop left'), { key: 'ArrowDown' })).toBe(false)
    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(announced()).toBe('')
  })

  it('writes nothing when the nudge is already at the edge it came from', () => {
    const { clip, handle } = mount()
    const before = past()

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowLeft' })

    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(past()).toBe(before)
  })

  it('leaves one undo entry per press, and one for a held key', () => {
    const { clip, handle } = mount()
    const button = handle('Crop left')
    const before = past()

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyDown(button, { key: 'ArrowRight', repeat: true })
    fireEvent.keyDown(button, { key: 'ArrowRight', repeat: true })
    fireEvent.keyUp(button, { key: 'ArrowRight' })

    expect(past()).toBe(before + 1)
    // One undo entry, but the hold still moved three source pixels — not the
    // same one pixel written three times over, which would pass the line
    // above identically.
    expect(clipNow(clip.id).crop!.left).toBeCloseTo(3 / 1920, 6)
  })

  it('starts a fresh entry for the next press', () => {
    const { handle } = mount()
    const button = handle('Crop left')
    const before = past()

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyUp(button, { key: 'ArrowRight' })
    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyUp(button, { key: 'ArrowRight' })

    expect(past()).toBe(before + 2)
  })

  it('ends a held key\'s gesture on blur exactly as keyup does, so a later press starts a new one', () => {
    // `onKeyUp` is bound to both keyup AND blur (Task 4) — the sliders' own
    // rule, carried over in case focus ever leaves a handle mid-hold without a
    // keyup reaching it first (tabbing away, say). A held key that is still
    // continuing its own gesture when blur arrives must close out at exactly
    // one entry, the same as keyup would; a press that comes after that is a
    // new gesture, not a continuation of the one blur just closed.
    const { clip, handle } = mount()
    const button = handle('Crop left')
    const before = past()

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyDown(button, { key: 'ArrowRight', repeat: true })
    fireEvent.blur(button)

    expect(past()).toBe(before + 1)
    expect(clipNow(clip.id).crop!.left).toBeCloseTo(2 / 1920, 6)

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyUp(button, { key: 'ArrowRight' })

    expect(past()).toBe(before + 2)
    expect(clipNow(clip.id).crop!.left).toBeCloseTo(3 / 1920, 6)
  })

  it('announces the stored crop in source pixels', () => {
    // Percentages would read a one-pixel nudge of a 1920-wide source as "0%".
    const { handle } = mount()

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowRight' })

    expect(announced()).toBe('Crop left: left 1 px')
  })

  it('announces both of a corner\'s insets', () => {
    const { handle } = mount()

    fireEvent.keyDown(handle('Crop top left'), { key: 'ArrowRight', shiftKey: true })

    expect(announced()).toBe('Crop top left: left 10 px, top 0 px')
  })

  it('says the same thing twice audibly', () => {
    // An aria-atomic region whose text does not change is not re-read, which is
    // exactly the case a user repeating one nudge is in — here, an external
    // undo (not this hook's own announce) puts the crop back to what it was
    // before the first press, so the second press announces the identical
    // text with nothing of this hook's own in between.
    //
    // A same-handle ArrowLeft between the two ArrowRights, rather than an
    // undo, would also restore the crop to zero — but it is itself a second
    // genuine nudge, with its own (different) announcement in between, and
    // the mark's single-call toggle only ever disambiguates two IMMEDIATELY
    // adjacent identical announcements: three real announcements whose first
    // and third texts coincide land back on the same mark parity and the
    // live region's raw text collides. The arithmetic cases above cover that
    // round trip's crop value; this one isolates the mark.
    const { handle } = mount()
    const button = handle('Crop left')

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    const first = screen.getByRole('status').textContent
    store().undo()
    fireEvent.keyDown(button, { key: 'ArrowRight' })

    expect(screen.getByRole('status').textContent).not.toBe(first)
    expect(announced()).toBe('Crop left: left 1 px')
  })

  it('announces nothing when the store refuses the write', () => {
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(clip.trackId, { locked: true })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    // `locked={false}` with a locked track is the row-locked-mid-gesture case:
    // the button is live, the store refuses, and the live region must not claim
    // an edit that did not happen.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Crop left' }), { key: 'ArrowRight' })

    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(announced()).toBe('')
  })

  it('writes and announces nothing for a clip the store does not hold', () => {
    // `CropHandles` takes `clip` as a prop; nudging reads the live crop/transform
    // off the store by that id rather than off the prop (so a separate key press
    // sees what the one before it actually stored), and this is the other side
    // of that lookup: a prop naming an id the store has no clip for at all. Not
    // reachable from the UI today — `PreviewPlayer` derives the prop from the
    // same `clips` list the lookup reads, so the two cannot disagree across a
    // render — but the type says a caller could, and the nudge must do nothing
    // rather than throw reading a lookup that found nothing.
    const clip = addClip('clip1', 0, 4)
    render(
      <CropHandles
        clip={{ ...clip, id: 'gone' }}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'Crop left' }), { key: 'ArrowRight' })

    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(announced()).toBe('')
  })
})

describe('the crop frame during a transition (ESCSUITE-147)', () => {
  // `selectionOverlay.test.ts`' own fixture, over this file's scene: the clip's
  // last second slides out to the left, so at 3.5s its animation puts its centre
  // at x 0.25 — the 1920-wide picture's left edge 240 CSS pixels off the left of
  // a 960px-wide canvas — while the renderer, which suppresses the preset side
  // the transition has taken over, draws it centred. The handles sit on the
  // picture, so they have to arrive at the renderer's answer.
  function mountSliding(transition?: TransitionInfo | null): void {
    const clip = addClip('clip1', 0, 4)
    store().updateClipAnimation(clip.id, {
      out: { type: 'slide-left', duration: 1, easing: 'linear' },
    })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={3.5}
        locked={false}
        transition={transition}
        onLeave={vi.fn()}
      />
    )
  }

  const frameLeft = (): string =>
    screen.getByRole('group', { name: 'Crop handles' }).style.left

  it('frames the kept region where the transition draws it', () => {
    mountSliding(
      makeTransitionInfo({
        outgoingClip: makeClip({ id: 'clip1', duration: 4 }),
        incomingClip: makeClip({ id: 'next', timelinePosition: 4 }),
      })
    )

    expect(frameLeft()).toBe('0px')
  })

  it('frames it at the preset’s own position when no transition owns that side', () => {
    mountSliding()

    expect(frameLeft()).toBe('-240px')
  })
})
