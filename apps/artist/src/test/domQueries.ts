// Queries for the inspector panels' label/control rows.
//
// ClipEditor and OverlayEditor lay their controls out as a row that holds a
// <label> (or a <span>) and an unlabelled <input> — the label is never wired to
// the input with htmlFor/id, so getByLabelText cannot reach these controls and
// they carry no accessible name of their own. These helpers walk from the
// visible text to the control that sits in the same row, which is the closest
// a test can get to "the slider the user sees next to that word".
//
// Lives under src/test/ so neither the vitest `include` glob nor the coverage
// `include` glob picks it up as production code.
import { screen } from '@testing-library/react'

/**
 * The control in the same row as the exact text `labelText`.
 *
 * Searches every <label>/<span> carrying that text and returns the first
 * matching descendant control of its parent, so it works both for a row that
 * holds label + input directly and for a section whose label sits above a
 * nested slider row.
 */
export function rowControl(
  labelText: string,
  selector = 'input[type="range"]'
): HTMLInputElement {
  const labels = screen.getAllByText(labelText, { selector: 'label, span' })
  for (const label of labels) {
    const found = label.parentElement?.querySelector(selector)
    if (found) return found as HTMLInputElement
  }
  throw new Error(`No ${selector} in a row labelled "${labelText}"`)
}

/** The <select> in the same row as the exact text `labelText`. */
export function rowSelect(labelText: string): HTMLSelectElement {
  return rowControl(labelText, 'select') as unknown as HTMLSelectElement
}

/** The number <input> in the same row as the exact text `labelText`. */
export function rowNumber(labelText: string): HTMLInputElement {
  return rowControl(labelText, 'input[type="number"]')
}

/** The colour <input> in the same row as the exact text `labelText`. */
export function rowColor(labelText: string): HTMLInputElement {
  return rowControl(labelText, 'input[type="color"]')
}
