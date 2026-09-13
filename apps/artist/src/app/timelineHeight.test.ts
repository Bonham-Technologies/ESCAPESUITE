// timelineHeight on its own: no App, no DOM resize, just the maths and the
// localStorage read/write it wraps.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampTimelineHeight,
  heightFromPointer,
  readStoredTimelineHeight,
  storeTimelineHeight,
} from './timelineHeight';
import {
  DEFAULT_TIMELINE_HEIGHT,
  MAX_TIMELINE_HEIGHT,
  MIN_TIMELINE_HEIGHT,
  TIMELINE_HEIGHT_KEY,
} from './appConstants';

beforeEach(() => {
  localStorage.clear();
});

describe('clampTimelineHeight', () => {
  it('raises a value below the minimum up to it', () => {
    expect(clampTimelineHeight(MIN_TIMELINE_HEIGHT - 50)).toBe(MIN_TIMELINE_HEIGHT);
  });

  it('lowers a value above the maximum down to it', () => {
    expect(clampTimelineHeight(MAX_TIMELINE_HEIGHT + 50)).toBe(MAX_TIMELINE_HEIGHT);
  });

  it('leaves an in-range value untouched', () => {
    expect(clampTimelineHeight(400)).toBe(400);
  });
});

describe('heightFromPointer', () => {
  it('is the viewport height minus the pointer position', () => {
    expect(heightFromPointer(700, 900)).toBe(200);
  });
});

describe('readStoredTimelineHeight', () => {
  it('round-trips a stored value', () => {
    localStorage.setItem(TIMELINE_HEIGHT_KEY, '250');
    expect(readStoredTimelineHeight()).toBe(250);
  });

  it('falls back to the default when nothing is stored', () => {
    expect(readStoredTimelineHeight()).toBe(DEFAULT_TIMELINE_HEIGHT);
  });

  // Finding, not a target: a non-numeric stored value yields NaN today —
  // parseInt produces NaN and Math.max/Math.min propagate it rather than
  // being guarded against. Pinned here so a future isNaN guard is a
  // deliberate behaviour change, not an accidental one.
  it('propagates NaN for a non-numeric stored value', () => {
    localStorage.setItem(TIMELINE_HEIGHT_KEY, 'not-a-number');
    expect(readStoredTimelineHeight()).toBeNaN();
  });
});

describe('storeTimelineHeight', () => {
  it('persists the height as a string under the timeline height key', () => {
    storeTimelineHeight(275);
    expect(localStorage.getItem(TIMELINE_HEIGHT_KEY)).toBe('275');
  });
});
