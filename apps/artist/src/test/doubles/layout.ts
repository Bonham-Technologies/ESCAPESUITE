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
