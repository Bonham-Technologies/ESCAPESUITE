// The arithmetic behind the File menu's roving focus (ESCSUITE-216), kept
// apart from the component so each key can be asserted on its own.

/**
 * Where the roving focus goes when `key` is pressed in a menu of `count`
 * focusable items with the item at `current` active.
 *
 * `null` means "this menu does not navigate on that key" — the caller leaves
 * the event alone, so Enter and Space stay the browser's own activation and
 * Tab stays the browser's own focus move.
 *
 * ArrowDown/ArrowUp wrap in both directions, the way the APG menu pattern
 * asks. `count` is the number of items that can take focus and is never 0 —
 * the File menu's first item is never disabled — so no empty-menu arm is
 * written here; `current` of -1 ("the active item was disabled out from under
 * us") is left to fall out of the same arithmetic.
 */
export function nextMenuIndex(current: number, key: string, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
