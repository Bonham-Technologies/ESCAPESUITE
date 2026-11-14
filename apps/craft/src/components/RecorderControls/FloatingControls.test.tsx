// What the "Float controls" window draws (ESCSUITE-400), outside the window:
// the component is an ordinary subtree, so it renders here like any other and
// `App.floatingControls.test.tsx` covers it inside a real portal.
//
// The rule under test is the meters' — the same one the Sources panel draws
// by: only while a take is live, Mic only when the microphone is on and
// capturable, System whenever it was asked for.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FloatingControls } from './FloatingControls'
import { useRecorderStore } from '../../store/recorderStore'
import { defaultConfig, type RecordingConfig } from '../../store/types'
import { allCapabilities } from '../../test/appDoubles'
import styles from '../../App.module.css'

const noop = () => {}

function renderFloating(isRecordingActive = true) {
  return render(
    <FloatingControls
      state={isRecordingActive ? 'recording' : 'idle'}
      isRecordingActive={isRecordingActive}
      onPause={noop}
      onResume={noop}
      onStart={noop}
      onStop={noop}
      onCancel={noop}
      blockedReason={null}
    />
  )
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
})
