// The arithmetic behind the File menu's roving focus, on its own.
import { describe, it, expect } from 'vitest';
import { nextMenuIndex } from './menuNavigation';

describe('nextMenuIndex', () => {
  it('moves down one', () => {
    expect(nextMenuIndex(0, 'ArrowDown', 4)).toBe(1);
  });

  it('wraps from the last item back to the first on ArrowDown', () => {
    expect(nextMenuIndex(3, 'ArrowDown', 4)).toBe(0);
  });

  it('moves up one', () => {
    expect(nextMenuIndex(2, 'ArrowUp', 4)).toBe(1);
  });

  it('wraps from the first item round to the last on ArrowUp', () => {
    expect(nextMenuIndex(0, 'ArrowUp', 4)).toBe(3);
  });

  it('jumps to the first item on Home', () => {
    expect(nextMenuIndex(2, 'Home', 4)).toBe(0);
  });

  it('jumps to the last item on End', () => {
    expect(nextMenuIndex(1, 'End', 4)).toBe(3);
  });

  it.each(['Enter', ' ', 'Escape', 'Tab', 'ArrowLeft', 'a'])(
    'answers %s with null — the menu does not navigate on it',
    (key) => {
      expect(nextMenuIndex(1, key, 4)).toBeNull();
    }
  );

  it('stays put in a one-item menu, whichever way it is asked', () => {
    expect(nextMenuIndex(0, 'ArrowDown', 1)).toBe(0);
    expect(nextMenuIndex(0, 'ArrowUp', 1)).toBe(0);
    expect(nextMenuIndex(0, 'Home', 1)).toBe(0);
    expect(nextMenuIndex(0, 'End', 1)).toBe(0);
  });

  it('treats a current index of -1 as "before the first item"', () => {
    // The active item can be disabled out from under the roving index while
    // the menu is open; ArrowDown from nowhere lands on the first item.
    expect(nextMenuIndex(-1, 'ArrowDown', 4)).toBe(0);
  });
});
