// Give one element a layout box.
//
// jsdom performs no layout: every getBoundingClientRect() returns an all-zero
// rect, so any component that converts a mouse coordinate into a position
// inside an element (the timeline's pixels-to-time maths, for one) cannot be
// driven at all. These helpers give a specific element the box it would have in
// a browser, so a mousedown at clientX 250 lands where the test says it does.
export interface Box {
  left?: number
  top?: number
  width?: number
  height?: number
}

/**
 * Make `el` report the given box from getBoundingClientRect().
 *
 * right/bottom are derived, so a caller only states the origin and the size.
 * The override lives on the element instance, which React keeps across
 * re-renders, so it survives every state change that does not unmount the node.
 */
export function setRect(el: Element, { left = 0, top = 0, width = 0, height = 0 }: Box): void {
  const rect: DOMRect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
  el.getBoundingClientRect = () => rect
}

/** Give each element in `boxes` its box, keyed by element. */
export function setRects(boxes: Array<[Element, Box]>): void {
  for (const [el, box] of boxes) setRect(el, box)
}

/**
 * Make every element report a non-empty `getClientRects()`.
 *
 * jsdom performs no layout, so `HTMLElement.getClientRects()` returns an
 * empty list even for elements plainly on screen. The shared focus trap
 * (`useDialogBehaviour` in `@escapesuite/shared/hooks`) uses
 * `getClientRects().length > 0` to skip controls CSS has hidden, so under
 * jsdom it would otherwise find nothing focusable in any dialog at all.
 *
 * Report one rect for every element instead — what a rendered element's
 * `getClientRects()` would return — and hand back the undo.
 *
 * ESCSUITE-208 (I-U3): this used to stub `offsetParent` instead, because the
 * trap used to filter on `offsetParent !== null` — which a real browser also
 * sets to `null` for any `position: fixed` control, dropping it from the trap
 * entirely rather than merely treating it as hidden. The trap now reads
 * `getClientRects()`, so this double moved onto the same property; the name
 * stays the same because callers only care that it makes elements visible to
 * the trap, not which DOM property it does that through.
 */
export function pretendElementsAreVisible(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getClientRects')
  Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{} as DOMRect],
  })
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'getClientRects', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'getClientRects')
  }
}
