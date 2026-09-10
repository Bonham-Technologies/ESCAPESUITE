// Shared fixtures for the animation test files.
//
// Deliberately not named *.test.ts: vite.config's `include` glob would
// otherwise pick it up as a suite containing no tests.
import type { ClipEffects, ClipTransform } from '../store/types'

export const baseTransform: ClipTransform = {
  x: 0.5,
  y: 0.5,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
}

export const baseEffects: ClipEffects = {
  blur: 0,
}
