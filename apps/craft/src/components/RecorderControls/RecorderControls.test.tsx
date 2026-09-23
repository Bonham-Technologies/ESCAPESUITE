// The transport bar, driven by props only — with one exception it does not
// own: the elapsed number inside the timer span is `RecordingDurationReadout`,
// which subscribes to the store itself so the once-a-second tick cannot
// re-render this bar (see `RecordingDurationReadout.test.tsx` and
// `App.rerender.test.tsx`). The span and its classes are still this
// component's, so the tests that care about the number set the store.
//
// Every control here is conditional on the recorder's state, so the tests walk
// the state machine one value at a time: which buttons exist, what the record
// button means, what it is titled and labelled, and when it refuses to do
// anything at all. The `preparing` and `saving` states are the interesting
// ones — the button is disabled *and* has no handler — and each is asserted on
// its own rather than folded into an "inactive" case.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecorderControls } from './RecorderControls'
import { useRecorderStore } from '../../store/recorderStore'
import type { RecordingState } from '../../store/types'
import styles from '../../App.module.css'

// The store is a module singleton, so a duration set by one test would
// otherwise be read by the next.
beforeEach(() => {
  useRecorderStore.setState({ currentDuration: 0 })
})

function makeCallbacks() {
  return {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onCancel: vi.fn(),
  }
}

const activeStates: RecordingState[] = ['countdown', 'recording', 'paused']

function renderControls(
  options: { state?: RecordingState; blockedReason?: string | null } = {}
) {
  const state = options.state ?? 'idle'
  const calls = makeCallbacks()
  const { container } = render(
    <RecorderControls
      state={state}
      isRecordingActive={activeStates.includes(state)}
      blockedReason={options.blockedReason ?? null}
      {...calls}
    />
  )
  return { calls, container }
}

function recordButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^(start|stop) recording$/i }) as HTMLButtonElement
}

describe('RecorderControls while idle', () => {
  it('offers only the record button, and nothing to pause or cancel', () => {
    renderControls()

    const record = recordButton()
    expect(record).toHaveAccessibleName('Start recording')
    expect(record).toHaveAttribute('title', 'Record (R)')
    expect(record).toBeEnabled()
    expect(record).not.toHaveClass(styles.recording)
    expect(screen.queryByRole('button', { name: 'Cancel recording' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /recording$/i })).toBe(record)
  })

  it('starts a take when the record button is pressed', async () => {
    const user = userEvent.setup()
    const { calls } = renderControls()

    await user.click(recordButton())

    expect(calls.onStart).toHaveBeenCalledTimes(1)
    expect(calls.onStop).not.toHaveBeenCalled()
  })

  it('shows a resting timer', () => {
    const { container } = renderControls()

    const timer = container.querySelector(`.${styles.timer}`) as HTMLElement
    expect(timer).toHaveTextContent('00:00')
    expect(timer).not.toHaveClass(styles.recording)
  })
})

describe('RecorderControls mid-take', () => {
  it('offers pause, stop and cancel while recording', async () => {
    const user = userEvent.setup()
    useRecorderStore.setState({ currentDuration: 65 })
    const { calls, container } = renderControls({ state: 'recording' })

    const pause = screen.getByRole('button', { name: 'Pause recording' })
    expect(pause).toHaveAttribute('title', 'Pause (P)')
    expect(recordButton()).toHaveAccessibleName('Stop recording')
    expect(recordButton()).toHaveAttribute('title', 'Stop (S)')
    expect(recordButton()).toHaveClass(styles.recording)
    expect(container.querySelector(`.${styles.timer}`)).toHaveTextContent('01:05')
    expect(container.querySelector(`.${styles.timer}`)).toHaveClass(styles.recording)

    await user.click(pause)
    expect(calls.onPause).toHaveBeenCalledTimes(1)
    expect(calls.onResume).not.toHaveBeenCalled()
  })

  it('offers resume instead of pause once paused', async () => {
    const user = userEvent.setup()
    const { calls } = renderControls({ state: 'paused' })

    const resume = screen.getByRole('button', { name: 'Resume recording' })
    expect(resume).toHaveAttribute('title', 'Resume (P)')
    expect(screen.queryByRole('button', { name: 'Pause recording' })).not.toBeInTheDocument()

    await user.click(resume)
    expect(calls.onResume).toHaveBeenCalledTimes(1)
    expect(calls.onPause).not.toHaveBeenCalled()
  })

  it('stops the take from the record button', async () => {
    const user = userEvent.setup()
    const { calls } = renderControls({ state: 'recording' })

    await user.click(recordButton())

    expect(calls.onStop).toHaveBeenCalledTimes(1)
    expect(calls.onStart).not.toHaveBeenCalled()
  })

  it.each(activeStates)('offers cancel while %s', async (state) => {
    const user = userEvent.setup()
    const { calls } = renderControls({ state })

    const cancel = screen.getByRole('button', { name: 'Cancel recording' })
    expect(cancel).toHaveAttribute('title', 'Cancel (Esc)')

    await user.click(cancel)
    expect(calls.onCancel).toHaveBeenCalledTimes(1)
  })

  it('has nothing to pause during the countdown', () => {
    renderControls({ state: 'countdown' })

    expect(screen.queryByRole('button', { name: 'Pause recording' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume recording' })).not.toBeInTheDocument()
    expect(recordButton()).toHaveClass(styles.recording)
  })
})

describe('RecorderControls between states', () => {
  it.each(['preparing', 'saving'] as RecordingState[])(
    'disables the record button, with no handler at all, while %s',
    async (state) => {
      const user = userEvent.setup()
      const { calls } = renderControls({ state })

      const record = recordButton()
      expect(record).toBeDisabled()
      expect(record).toHaveAccessibleName('Stop recording')
      expect(record).not.toHaveClass(styles.recording)
      expect(screen.queryByRole('button', { name: 'Cancel recording' })).not.toBeInTheDocument()

      await user.click(record)
      expect(calls.onStart).not.toHaveBeenCalled()
      expect(calls.onStop).not.toHaveBeenCalled()
    }
  )

  it.each(['idle', 'countdown', 'recording', 'paused'] as RecordingState[])(
    'leaves the record button live while %s',
    (state) => {
      renderControls({ state })

      expect(recordButton()).toBeEnabled()
    }
  )
})

describe('RecorderControls when recording is blocked', () => {
  it('disables the button, names the reason, and refuses to start a take', async () => {
    const user = userEvent.setup()
    const { calls, container } = renderControls({ blockedReason: 'Checking what this browser can capture…' })

    const record = recordButton()
    expect(record).toBeDisabled()
    expect(record).toHaveAttribute('title', 'Checking what this browser can capture…')
    expect(record).toHaveAccessibleDescription('Checking what this browser can capture…')
    expect(container.querySelector(`.${styles.recordBlockedReason}`))
      .toHaveTextContent('Checking what this browser can capture…')

    await user.click(record)
    expect(calls.onStart).not.toHaveBeenCalled()
  })

  it('says nothing extra, and describes nothing, when there is no reason to block', () => {
    const { container } = renderControls()

    expect(recordButton()).not.toHaveAttribute('aria-describedby')
    expect(recordButton()).toHaveAttribute('title', 'Record (R)')
    expect(container.querySelector(`.${styles.recordBlockedReason}`)).toBeNull()
  })
})

describe('RecorderControls shortcuts hint', () => {
  it('lists the four window shortcuts', () => {
    const { container } = renderControls()

    const keys = [...container.querySelectorAll(`.${styles.shortcutKey}`)].map((k) => k.textContent)
    expect(keys).toEqual(['R', 'P', 'S', 'Esc'])
    const hints = [...container.querySelectorAll(`.${styles.shortcut}`)].map((s) => s.textContent)
    expect(hints).toEqual(['R Record', 'P Pause', 'S Stop', 'Esc Cancel'])
  })
})
