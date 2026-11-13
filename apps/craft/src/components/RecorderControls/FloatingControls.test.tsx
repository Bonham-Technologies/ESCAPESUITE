// What the "Float controls" window draws (ESCSUITE-400), outside the window:
// the component is an ordinary subtree, so it renders here like any other and
// `App.floatingControls.test.tsx` covers it inside a real portal.
//
// The rule under test is the meters' — the same one the Sources panel draws
// by: only while a take is live, Mic only when the microphone is on and
// capturable, System whenever it was asked for.
import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { FloatingControls } from './FloatingControls'
import { useRecorderStore } from '../../store/recorderStore'
import { defaultConfig, type Recording, type RecordingConfig, type RecordingState } from '../../store/types'
import { allCapabilities } from '../../test/appDoubles'
import styles from '../../App.module.css'

const noop = () => {}

function floatingFor(state: RecordingState, blockedReason: string | null = null) {
  return (
    <FloatingControls
      state={state}
      isRecordingActive={state === 'countdown' || state === 'recording' || state === 'paused'}
      onPause={noop}
      onResume={noop}
      onStart={noop}
      onStop={noop}
      onCancel={noop}
      blockedReason={blockedReason}
    />
  )
}

function renderFloating(isRecordingActive = true) {
  return render(floatingFor(isRecordingActive ? 'recording' : 'idle'))
}

/** The window's polite live region: what a screen reader there is told. */
function liveRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>('[aria-live="polite"]')
  if (!region) throw new Error('no polite live region in the floating window')
  return region
}

function meterLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll(`.${styles.meterLabel}`)].map((label) => label.textContent ?? '')
}

function setStore(config: Partial<RecordingConfig>, options: { microphone?: boolean; ready?: boolean } = {}) {
  useRecorderStore.setState({
    config: { ...defaultConfig, ...config },
    capabilities: { ...allCapabilities(), microphone: options.microphone ?? true },
    capabilitiesReady: options.ready ?? true,
    audioLevels: { microphone: 0, system: 0 },
    systemAudioShared: true,
    currentDuration: 0,
    countdownValue: 0,
    recordings: [],
  })
}

beforeEach(() => {
  setStore({})
})

describe('FloatingControls', () => {
  it('is one landmark, named by a hidden level-one heading, holding the transport bar', () => {
    renderFloating()

    const main = screen.getByRole('main', { name: 'Recorder controls' })
    expect(main).toHaveClass(styles.floatingControls)
    expect(screen.getByRole('heading', { level: 1, name: 'Recorder controls' })).toHaveClass(styles.srOnly)
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument()
  })

  it('draws both meters during a take with the microphone and system audio on', () => {
    setStore({ microphoneEnabled: true, systemAudioEnabled: true })
    const { container } = renderFloating()

    expect(meterLabels(container)).toEqual(['Mic', 'System'])
  })

  it('leaves out the Mic meter when the microphone cannot be captured', () => {
    setStore({ microphoneEnabled: true, systemAudioEnabled: true }, { microphone: false })
    const { container } = renderFloating()

    expect(meterLabels(container)).toEqual(['System'])
  })

  it('keeps the Mic meter before detection has answered, as the Sources panel does', () => {
    setStore({ microphoneEnabled: true, systemAudioEnabled: false }, { microphone: false, ready: false })
    const { container } = renderFloating()

    expect(meterLabels(container)).toEqual(['Mic'])
  })

  it('draws no meters when there is no audio source', () => {
    setStore({ microphoneEnabled: false, systemAudioEnabled: false })
    const { container } = renderFloating()

    expect(container.querySelector(`.${styles.audioMeters}`)).toBeNull()
  })

  it('draws no meters while no take is live', () => {
    setStore({ microphoneEnabled: true, systemAudioEnabled: true })
    const { container } = renderFloating(false)

    expect(container.querySelector(`.${styles.audioMeters}`)).toBeNull()
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument()
  })

  // ESCSUITE-440: the window is what the user is looking at while the page sits
  // behind the thing being recorded, so it carries the countdown, the state
  // phrases and the blocked reason itself.
  it('shows the countdown number in place of the timer during the countdown', () => {
    useRecorderStore.setState({ countdownValue: 3, currentDuration: 0 })
    const { container } = render(floatingFor('countdown'))

    const timer = container.querySelector(`.${styles.timer}`)
    expect(timer).toHaveTextContent(/^3$/)
    act(() => useRecorderStore.setState({ countdownValue: 2 }))
    expect(timer).toHaveTextContent(/^2$/)
  })

  it('goes back to the elapsed time once the take is recording', () => {
    useRecorderStore.setState({ countdownValue: 1, currentDuration: 0 })
    const { container } = render(floatingFor('recording'))

    expect(container.querySelector(`.${styles.timer}`)).toHaveTextContent(/^00:00$/)
  })

  it('announces the countdown, recording, paused, saving and saved through a polite live region', () => {
    useRecorderStore.setState({ countdownValue: 3 })
    const { container, rerender } = render(floatingFor('idle'))
    const region = liveRegion(container)
    expect(region).toHaveAttribute('aria-atomic', 'true')
    expect(region).toHaveTextContent(/^$/)

    rerender(floatingFor('countdown'))
    expect(region).toHaveTextContent('Recording starts in 3')

    rerender(floatingFor('recording'))
    expect(region).toHaveTextContent(/^Recording$/)

    rerender(floatingFor('paused'))
    expect(region).toHaveTextContent(/^Paused$/)

    rerender(floatingFor('saving'))
    expect(region).toHaveTextContent(/^Saving\.\.\.$/)

    act(() => useRecorderStore.setState({ recordings: [{ id: 'new-take' } as Recording] }))
    rerender(floatingFor('idle'))
    expect(region).toHaveTextContent(/^Saved$/)

    // The next take replaces it.
    rerender(floatingFor('countdown'))
    expect(region).toHaveTextContent('Recording starts in 3')
  })

  it('does not say Saved when the save put nothing new in the library', () => {
    const { container, rerender } = render(floatingFor('saving'))
    const region = liveRegion(container)

    rerender(floatingFor('idle'))
    expect(region).toHaveTextContent(/^$/)
  })

  it('does not say Saved when the newest take is deleted during a save that adds nothing', () => {
    useRecorderStore.setState({ recordings: [{ id: 'newest' } as Recording, { id: 'older' } as Recording] })
    const { container, rerender } = render(floatingFor('saving'))
    const region = liveRegion(container)

    act(() => useRecorderStore.setState({ recordings: [{ id: 'older' } as Recording] }))
    rerender(floatingFor('idle'))
    expect(region).toHaveTextContent(/^$/)
  })

  it('prints why Record is blocked and describes the button with it', () => {
    render(floatingFor('idle', 'Turn on a source before recording'))

    expect(screen.getByText('Turn on a source before recording')).toBeVisible()
    const record = screen.getByRole('button', { name: 'Start recording' })
    expect(record).toBeDisabled()
    expect(record).toHaveAccessibleDescription('Turn on a source before recording')
  })

  it('prints no reason while Record is available', () => {
    const { container } = render(floatingFor('idle'))

    expect(container.querySelector(`.${styles.recordBlockedReason}`)).toBeNull()
    expect(screen.getByRole('button', { name: 'Start recording' })).not.toHaveAttribute('aria-describedby')
  })
})
