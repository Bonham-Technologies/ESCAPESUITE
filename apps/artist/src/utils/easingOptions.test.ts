// The easing table shared by the clip inspector and the keyframe panel.
//
// Its order is the order the <option>s appear in, and tests elsewhere address
// those selects by index, so these assertions pin the order as well as the
// contents — a reordered table would otherwise pass silently.
import { describe, it, expect } from 'vitest'
import { EASING_TYPES } from './easingOptions'

describe('easingOptions', () => {
  it('offers the linear and cubic easings, in the order they are shown', () => {
    expect(EASING_TYPES).toEqual([
      { value: 'linear', label: 'Linear' },
      { value: 'ease-in', label: 'Ease In' },
      { value: 'ease-out', label: 'Ease Out' },
      { value: 'ease-in-out', label: 'Ease In-Out' },
      { value: 'ease-in-cubic', label: 'Ease In (Cubic)' },
      { value: 'ease-out-cubic', label: 'Ease Out (Cubic)' },
      { value: 'ease-in-out-cubic', label: 'Ease In-Out (Cubic)' },
    ])
  })

  it('leaves the quad easings out, though the engine understands them', () => {
    expect(EASING_TYPES.map((e) => e.value)).not.toContain('ease-in-quad')
    expect(EASING_TYPES.map((e) => e.value)).not.toContain('ease-out-quad')
    expect(EASING_TYPES.map((e) => e.value)).not.toContain('ease-in-out-quad')
  })
})
