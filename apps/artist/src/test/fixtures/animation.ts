// Shared fixtures for the animation test files.
//
// Lives under src/test/ so neither the vitest `include` glob (which would treat
// it as a suite containing no tests) nor the coverage `include` glob (which
// would score test scaffolding as production code) picks it up.
import type { ClipEffects, ClipTransform } from '../../store/types'

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
