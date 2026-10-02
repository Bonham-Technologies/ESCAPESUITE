// ESCSUITE-89 — every control in the clip inspector carries an accessible name.
//
// The panel used to lay each row out as `<label>Blur</label><input …/>` siblings
// with no `htmlFor`, so a screen reader met most of the inspector as an unnamed
// slider, an unnamed dropdown and an unnamed swatch. This file is that fix's
// contract, and it is deliberately a *sweep* rather than a control-by-control
// list: it walks every input, select, textarea and button the panel renders for
// one clip and demands a non-empty name for each, so a control added later is
// covered the day it lands rather than the day someone remembers to add a case
// here.
//
// It is also the reason the sibling suites did not have to change. They keep
// addressing controls through `test/domQueries`' row helpers — by the visible
// text beside them — which is what they have always done; this file is about
// the names, not about how a test finds a control.
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditor } from './ClipEditor'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import { makeAnimation } from '../../test/fixtures/clipFixtures'
import styles from './ClipEditor.module.css'

/** Collapse runs of whitespace the way a name computation does. */
const flatten = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

/**
 * The accessible name of `el`, computed the way a browser computes it — the
 * subset of accname that this panel's markup can reach.
 *
 * `computeAccessibleName` from `dom-accessibility-api` would be the obvious
 * tool, but that package is a transitive dependency of @testing-library/dom
 * rather than one of this package's own, so it is not resolvable from here;
 * declaring it for one assertion would put a lockfile change in a ticket about
 * labels. The precedence below is accname's, stopping where the inspector
 * stops: aria-labelledby → aria-label → an associated <label> → the element's
 * own text (buttons name themselves from their content; a form field does not)
 * → title.
 */
function accessibleName(el: HTMLElement): string {
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => flatten(document.getElementById(id)?.textContent ?? null))
      .filter(Boolean)
      .join(' ')
    if (text) return text
  }

  const ariaLabel = flatten(el.getAttribute('aria-label'))
  if (ariaLabel) return ariaLabel

  if (el.id) {
    // Compared field by field rather than through a `label[for="…"]` selector:
    // `useId()` decides what these ids look like, and a generated id is not
    // necessarily a legal CSS identifier.
    const associated = Array.from(document.querySelectorAll('label')).find(
      (label) => label.htmlFor === el.id
    )
    const text = flatten(associated?.textContent ?? null)
    if (text) return text
  }

  const wrapping = flatten(el.closest('label')?.textContent ?? null)
  if (wrapping) return wrapping

  if (el.tagName === 'BUTTON') {
    const own = flatten(el.textContent)
    if (own) return own
  }

  return flatten(el.getAttribute('title'))
}

/** Everything in the panel a user can operate. */
const CONTROLS = 'input, select, textarea, button'

/**
 * The controls whose names have to be distinct from one another: the value
 * controls. Two buttons called "Reset" are told apart by where they are, but a
 * screen-reader user moving between form fields hears only the name, and three
 * sliders called "Duration" are three indistinguishable rows.
 */
const VALUE_CONTROLS = 'input[type="range"], input[type="number"], input[type="color"]'

/** A control described well enough to find it in the source when this fails. */
function describeControl(el: HTMLElement): string {
  const type = el instanceof HTMLInputElement ? `[${el.type}]` : ''
  const row = flatten(el.parentElement?.textContent ?? null).slice(0, 40)
  return `${el.tagName.toLowerCase()}${type} in "${row}"`
}

const controlsIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(CONTROLS))

const unnamed = (container: HTMLElement) =>
  controlsIn(container)
    .filter((el) => accessibleName(el) === '')
    .map(describeControl)

/** Names carried by more than one value control. */
function duplicateNames(container: HTMLElement): string[] {
  const names = Array.from(container.querySelectorAll<HTMLElement>(VALUE_CONTROLS)).map(
    accessibleName
  )
  return names.filter((name, index) => names.indexOf(name) !== index)
}

/**
 * Open every section that is currently closed, so the audit sees the whole
 * panel rather than the four sections that happen to default open.
 *
 * Found by class rather than by title: the point is to reach whatever the panel
 * renders for this clip, and a list of titles here would go stale the next time
 * a section is added.
 */
async function openEverySection(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement
): Promise<void> {
  const sections = Array.from(container.querySelectorAll<HTMLElement>(`.${styles.collapsible}`))
  for (const section of sections) {
    if (section.querySelector(`.${styles.collapsibleContent}`)) continue
    await user.click(section.querySelector(`.${styles.collapsibleToggle}`) as HTMLElement)
  }
}

/** An animation with both presets set, so the duration and easing rows render. */
const bothPresets = makeAnimation({
  in: { type: 'fade', duration: 0.5, easing: 'ease-out' },
  out: { type: 'slide-left', duration: 0.8, easing: 'ease-in' },
})

const firstClipId = () => store().project.timeline.clips[0].id

/**
 * Render the panel with every section open, and hand back its container.
 *
 * The tripwire matters as much as the assertions do: a render that produced
 * nothing would report no unnamed controls either.
 */
async function openPanel(): Promise<HTMLElement> {
  const user = userEvent.setup()
  const { container } = render(<ClipEditor />)
  await openEverySection(user, container)
  expect(controlsIn(container).length).toBeGreaterThan(10)
  return container
}

describe('accessible names (ESCSUITE-89)', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  describe('a media clip', () => {
    beforeEach(() => {
      addClip('clip1', 3, 4)
      store().setSelectedClipId('clip1')
      // Every optional field set, so the rows that only exist for one — the
      // transition's duration, the mask's corner radius, both animation groups'
      // duration and easing — are on screen for the sweep to see.
      store().updateClip('clip1', {
        animation: bothPresets,
        transition: { type: 'fade', duration: 0.5 },
        mask: { kind: 'rounded', radius: 0.2 },
        stroke: { color: '#ffffff', width: 0.004 },
        crop: { left: 0.25, top: 0.1, right: 0, bottom: 0.05 },
        effects: { blur: 3 },
      })
    })

    it('names every control in the panel', async () => {
      expect(unnamed(await openPanel())).toEqual([])
    })

    it('gives no two sliders, numbers or swatches the same name', async () => {
      expect(duplicateNames(await openPanel())).toEqual([])
    })

    it('names both scale sliders once the aspect-ratio lock is open', async () => {
      // Scale X and Scale Y replace the single Scale row, so they are a second
      // shape of the same section and not covered by the case above.
      store().updateClipTransform('clip1', { scaleLocked: false })

      const container = await openPanel()

      expect(unnamed(container)).toEqual([])
      expect(duplicateNames(container)).toEqual([])
    })
  })

  describe('a text overlay', () => {
    beforeEach(() => {
      store().addTextOverlayClip()
      store().updateClip(firstClipId(), { animation: bothPresets })
    })

    it('names every control in the panel', async () => {
      expect(unnamed(await openPanel())).toEqual([])
    })

    it('gives no two sliders, numbers or swatches the same name', async () => {
      expect(duplicateNames(await openPanel())).toEqual([])
    })
  })

  describe('a shape overlay', () => {
    beforeEach(() => {
      store().addShapeOverlayClip({
        type: 'rectangle',
        fillColor: '#3b82f6ff',
        strokeColor: '#ffffff',
        strokeWidth: 2,
      })
      store().updateClip(firstClipId(), { animation: bothPresets })
    })

    it('names every control in the panel', async () => {
      expect(unnamed(await openPanel())).toEqual([])
    })

    it('gives no two sliders, numbers or swatches the same name', async () => {
      expect(duplicateNames(await openPanel())).toEqual([])
    })
  })

  describe('a blur region', () => {
    // The one shape whose section swaps its fill and stroke controls for a
    // single Blur Amount slider, so its controls are a different set again.
    beforeEach(() => {
      store().addShapeOverlayClip({ type: 'blur', fillColor: '#00000000', blurAmount: 10 })
      store().updateClip(firstClipId(), { animation: bothPresets })
    })

    it('names every control in the panel', async () => {
      expect(unnamed(await openPanel())).toEqual([])
    })

    it('gives no two sliders, numbers or swatches the same name', async () => {
      expect(duplicateNames(await openPanel())).toEqual([])
    })
  })
})
