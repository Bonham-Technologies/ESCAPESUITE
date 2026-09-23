// The elapsed-take readout.
//
// It has no props at all: the number comes from the store, which is the whole
// point of the component — the once-a-second `setCurrentDuration` re-renders
// this and nothing above it (`App.rerender.test.tsx` counts that). What is
// asserted here is that it draws the store's value, keeps drawing the store's
// value as it ticks, and adds no markup of its own — `RecorderControls` owns
// the timer span around it.
import { describe, it, expect, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { RecordingDurationReadout } from './RecordingDurationReadout'
import { useRecorderStore } from '../../store/recorderStore'

beforeEach(() => {
  useRecorderStore.setState({ currentDuration: 0 })
})

describe('RecordingDurationReadout', () => {
  it('draws the resting duration as bare text, with no element of its own', () => {
    const { container } = render(<RecordingDurationReadout />)

    expect(container.textContent).toBe('00:00')
    expect(container.firstElementChild).toBeNull()
  })

  it('formats whatever the store holds', () => {
    useRecorderStore.setState({ currentDuration: 65 })
    const { container } = render(<RecordingDurationReadout />)

    expect(container.textContent).toBe('01:05')
  })

  it('follows the tick, unprompted by any parent', () => {
    const { container } = render(<RecordingDurationReadout />)

    act(() => {
      useRecorderStore.getState().setCurrentDuration(3_600)
    })

    expect(container.textContent).toBe('60:00')
  })
})
