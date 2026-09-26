// The inspector's dropdown option tables.
//
// Each list's order is the order the user sees, and tests elsewhere address
// these selects by index, so these assertions pin the order as well as the
// contents — a reordered table would otherwise pass silently.
import { describe, it, expect } from 'vitest'
import {
  TRANSITION_TYPES,
  BLEND_MODES,
  CLIP_MASK_KINDS,
  ANIMATION_PRESETS,
  EASING_TYPES,
} from './clipEditorOptions'

describe('clipEditorOptions', () => {
  it('lists the transitions, None first', () => {
    expect(TRANSITION_TYPES).toEqual([
      { value: 'none', label: 'None' },
      { value: 'fade', label: 'Fade' },
      { value: 'dissolve', label: 'Dissolve' },
      { value: 'wipe-left', label: 'Wipe Left' },
      { value: 'wipe-right', label: 'Wipe Right' },
      { value: 'wipe-up', label: 'Wipe Up' },
      { value: 'wipe-down', label: 'Wipe Down' },
      { value: 'slide-left', label: 'Slide Left' },
      { value: 'slide-right', label: 'Slide Right' },
      { value: 'slide-up', label: 'Slide Up' },
      { value: 'slide-down', label: 'Slide Down' },
    ])
  })

  it('lists the blend modes, Normal first', () => {
    expect(BLEND_MODES).toEqual([
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'difference', label: 'Difference' },
      { value: 'add', label: 'Add' },
    ])
  })

  it('lists the mask kinds, None first', () => {
    expect(CLIP_MASK_KINDS).toEqual([
      { value: 'none', label: 'None' },
      { value: 'circle', label: 'Circle' },
      { value: 'rounded', label: 'Rounded Rectangle' },
    ])
  })

  it('lists the animation presets, None first', () => {
    expect(ANIMATION_PRESETS).toEqual([
      { value: 'none', label: 'None' },
      { value: 'fade', label: 'Fade' },
      { value: 'slide-left', label: 'Slide Left' },
      { value: 'slide-right', label: 'Slide Right' },
      { value: 'slide-up', label: 'Slide Up' },
      { value: 'slide-down', label: 'Slide Down' },
      { value: 'scale', label: 'Scale' },
      { value: 'scale-up', label: 'Scale Up' },
      { value: 'scale-down', label: 'Scale Down' },
      { value: 'pop', label: 'Pop' },
      { value: 'blur', label: 'Blur' },
    ])
  })

  it('offers the linear and cubic easings but not the quad ones', () => {
    expect(EASING_TYPES).toEqual([
      { value: 'linear', label: 'Linear' },
      { value: 'ease-in', label: 'Ease In' },
      { value: 'ease-out', label: 'Ease Out' },
      { value: 'ease-in-out', label: 'Ease In-Out' },
      { value: 'ease-in-cubic', label: 'Ease In (Cubic)' },
      { value: 'ease-out-cubic', label: 'Ease Out (Cubic)' },
      { value: 'ease-in-out-cubic', label: 'Ease In-Out (Cubic)' },
    ])
    expect(EASING_TYPES.map((e) => e.value)).not.toContain('ease-in-quad')
  })
})
