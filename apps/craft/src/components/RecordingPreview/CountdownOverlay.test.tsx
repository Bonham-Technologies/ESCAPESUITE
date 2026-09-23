// The 3-2-1 overlay.
//
// One prop (`state`) and one store field (`countdownValue`), and it draws only
// where both agree: during the countdown, with a number still to show. The
// zero case is the one that matters — the countdown interval writes 0 on its
// last step, and the overlay has to be gone by the time the take starts rather
// than showing a "0" frame.
import { describe, it, expect, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { CountdownOverlay } from './CountdownOverlay'
import { useRecorderStore } from '../../store/recorderStore'
import type { RecordingState } from '../../store/types'
import styles from '../../App.module.css'

beforeEach(() => {
  useRecorderStore.setState({ countdownValue: 0 })
})

describe('CountdownOverlay', () => {
  it('draws the number the store holds during a countdown', () => {
    useRecorderStore.setState({ countdownValue: 3 })
    const { container } = render(<CountdownOverlay state="countdown" />)

    expect(container.querySelector(`.${styles.countdown}`)).toBeInTheDocument()
    expect(container.querySelector(`.${styles.countdownNumber}`)).toHaveTextContent('3')
  })

  it('counts itself down, unprompted by any parent', () => {
    useRecorderStore.setState({ countdownValue: 3 })
    const { container } = render(<CountdownOverlay state="countdown" />)

    act(() => {
      useRecorderStore.getState().setCountdown(2)
    })

    expect(container.querySelector(`.${styles.countdownNumber}`)).toHaveTextContent('2')
  })

  it('stops drawing at zero, before the take starts', () => {
    const { container } = render(<CountdownOverlay state="countdown" />)

    expect(container.querySelector(`.${styles.countdownNumber}`)).toBeNull()
  })

  it.each(['idle', 'preparing', 'recording', 'paused', 'saving'] as RecordingState[])(
    'draws nothing while %s, whatever the number says',
    (state) => {
      useRecorderStore.setState({ countdownValue: 3 })
      const { container } = render(<CountdownOverlay state={state} />)

      expect(container.querySelector(`.${styles.countdownNumber}`)).toBeNull()
    }
  )
})
