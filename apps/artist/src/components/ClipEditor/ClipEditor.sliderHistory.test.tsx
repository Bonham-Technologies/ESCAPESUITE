// One drag of an inspector slider is one undo step (ESCSUITE-75).
//
// Every slider in the clip inspector writes to the store on each `input`
// event — a blur drag is 0–50 in steps of 0.5, so around a hundred writes —
// and the three store actions behind them pushed an undo entry each time. A
// single drag therefore filled the whole 50-entry `MAX_HISTORY_SIZE` stack with
// its own intermediate values (and paid a full-project `structuredClone` per
// entry), evicting everything the user had done before it, and Ctrl+Z stepped
// back a pixel at a time.
//
// The rule these tests hold is the one ESCSUITE-52 established for a preview
// transform drag: the gesture's **first** write pushes history — so the entry
// snapshots the state as it was *before* the drag — and every write after it
// passes `skipHistory`. Nothing extra happens on release.
//
// The events are fired rather than driven through `userEvent` on purpose: a
// range input's thumb cannot be dragged in jsdom, so a drag *is* its event
// sequence — a `pointerdown`, a run of `input`s, a `pointerup` — and that
// sequence is exactly what the gesture reads.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditor } from './ClipEditor'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import { rowControl } from '../../test/domQueries'

/** How many undo entries the stack holds right now. */
const past = () => store().history.past.length

const clipNow = () => store().project.timeline.clips[0]

/** Open a collapsible section by its title. */
async function openSection(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: title }))
}

/** One `input` event carrying a new slider value, as a real drag delivers it. */
function slide(input: HTMLInputElement, value: number) {
  fireEvent.input(input, { target: { value: String(value) } })
}

/** A whole pointer drag: press, a run of values, release. */
function drag(input: HTMLInputElement, values: number[]) {
  fireEvent.pointerDown(input)
  for (const value of values) slide(input, value)
  fireEvent.pointerUp(input)
}

/** The eight values a short drag of the blur slider delivers. */
const BLUR_DRAG = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]

async function selectedClipEditor() {
  const user = userEvent.setup()
  const clip = addClip('clip1', 0, 4)
  store().setSelectedClipId(clip.id)
  render(<ClipEditor />)
  return { user, clip }
}

describe('an inspector slider drag and the undo stack', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('records one entry for a blur drag, not one per input event', async () => {
    const { user } = await selectedClipEditor()
    await openSection(user, 'Effects')
    const before = past()

    drag(rowControl('Blur'), BLUR_DRAG)

    // The drag really happened — otherwise "one entry" would pass by writing
    // nothing at all.
    expect(clipNow().effects?.blur).toBe(4)
    expect(past() - before).toBe(1)
  })

  it('records one entry for a corner-radius drag', async () => {
    const { user, clip } = await selectedClipEditor()
    store().updateClip(clip.id, { mask: { kind: 'rounded', radius: 0.1 } })
    await openSection(user, 'Mask & Stroke')
    const before = past()

    drag(rowControl('Corner Radius'), [0.12, 0.15, 0.2, 0.25, 0.3])

    expect(clipNow().mask).toEqual({ kind: 'rounded', radius: 0.3 })
    expect(past() - before).toBe(1)
  })

  it('records one entry for a stroke-width drag', async () => {
    const { user } = await selectedClipEditor()
    await openSection(user, 'Mask & Stroke')
    const before = past()

    drag(rowControl('Stroke Width'), [0.002, 0.004, 0.006, 0.008, 0.01])

    expect(clipNow().stroke?.width).toBe(0.01)
    expect(past() - before).toBe(1)
  })

  it('records one entry for an opacity drag', async () => {
    await selectedClipEditor()
    const before = past()

    drag(rowControl('Opacity'), [0.9, 0.8, 0.7, 0.6, 0.5])

    expect(clipNow().transform.opacity).toBe(0.5)
    expect(past() - before).toBe(1)
  })

  it('records one entry for a single arrow-key press', async () => {
    const { user } = await selectedClipEditor()
    await openSection(user, 'Effects')
    const blur = rowControl('Blur')
    const before = past()

    fireEvent.keyDown(blur, { key: 'ArrowRight' })
    slide(blur, 0.5)
    fireEvent.keyUp(blur, { key: 'ArrowRight' })

    expect(clipNow().effects?.blur).toBe(0.5)
    expect(past() - before).toBe(1)
  })

  it('records one entry for a held arrow key, which repeats', async () => {
    const { user } = await selectedClipEditor()
    await openSection(user, 'Effects')
    const blur = rowControl('Blur')
    const before = past()

    // A held key fires keydown over and over, every repetition after the first
    // carrying `repeat: true`, with one input event each. That is one gesture.
    fireEvent.keyDown(blur, { key: 'ArrowRight' })
    slide(blur, 0.5)
    for (const value of [1, 1.5, 2, 2.5, 3]) {
      fireEvent.keyDown(blur, { key: 'ArrowRight', repeat: true })
      slide(blur, value)
    }
    fireEvent.keyUp(blur, { key: 'ArrowRight' })

    expect(clipNow().effects?.blur).toBe(3)
    expect(past() - before).toBe(1)
  })

  it('records two entries for two separate drags', async () => {
    const { user } = await selectedClipEditor()
    await openSection(user, 'Effects')
    const blur = rowControl('Blur')
    const before = past()

    drag(blur, [1, 2, 3])
    drag(blur, [4, 5, 6])

    expect(past() - before).toBe(2)
  })

  it('undoes the whole drag, back to the value the slider started at', async () => {
    const { user, clip } = await selectedClipEditor()
    store().updateClipEffects(clip.id, { blur: 10 })
    await openSection(user, 'Effects')

    drag(rowControl('Blur'), BLUR_DRAG)
    expect(clipNow().effects?.blur).toBe(4)

    store().undo()

    // The entry was captured before the first write, so one undo lands on the
    // pre-drag radius and not on the last intermediate value the drag passed
    // through.
    expect(clipNow().effects?.blur).toBe(10)
  })

  it('still records one entry per write outside a gesture', async () => {
    const { user } = await selectedClipEditor()
    await openSection(user, 'Effects')
    const blur = rowControl('Blur')
    const before = past()

    // No pointer or key gesture around these: a programmatic value change, or
    // a click on the slider track, is a change on its own and keeps its own
    // undo entry.
    slide(blur, 1)
    slide(blur, 2)

    expect(past() - before).toBe(2)
  })

  it('ends a gesture on blur as well as on release', async () => {
    const { user } = await selectedClipEditor()
    await openSection(user, 'Effects')
    const blur = rowControl('Blur')
    const before = past()

    // A press whose release never arrives — the pointer left the window, or
    // focus moved on — must not leave the gesture open for the next write to
    // join.
    fireEvent.pointerDown(blur)
    slide(blur, 1)
    fireEvent.blur(blur)
    fireEvent.pointerDown(blur)
    slide(blur, 2)
    fireEvent.pointerUp(blur)

    expect(past() - before).toBe(2)
  })
})
