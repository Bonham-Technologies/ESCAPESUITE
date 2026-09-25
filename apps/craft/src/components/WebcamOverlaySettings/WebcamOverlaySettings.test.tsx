// The webcam-overlay panel, driven by props only.
//
// Every control here reports a config patch and nothing else, so the tests are
// about two things: which button is marked current for a given config, and
// what patch each control hands back. The size slider gets the most attention
// because it is the one control with an id — the App suite finds it by its
// label — and because its value goes through parseFloat on the way out.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WebcamOverlaySettings } from './WebcamOverlaySettings'
import { defaultConfig, type RecordingConfig } from '../../store/types'
import styles from '../../App.module.css'

function renderSettings(
  options: {
    config?: Partial<RecordingConfig>
    disabled?: boolean
    separateTracksReason?: string | null
  } = {}
) {
  const onChange = vi.fn<(config: Partial<RecordingConfig>) => void>()
  render(
    <WebcamOverlaySettings
      config={{ ...defaultConfig, ...options.config }}
      disabled={options.disabled ?? false}
      separateTracksReason={options.separateTracksReason ?? null}
      onChange={onChange}
    />
  )
  return { onChange }
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

function slider(): HTMLInputElement {
  return screen.getByLabelText('Webcam overlay size') as HTMLInputElement
}

const positions = [
  ['top left', 'top-left'],
  ['top right', 'top-right'],
  ['bottom left', 'bottom-left'],
  ['bottom right', 'bottom-right'],
] as const

describe('WebcamOverlaySettings position', () => {
  it('offers the four corners, spelled without their hyphen', () => {
    renderSettings()

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Webcam Overlay')
    for (const [label] of positions) expect(button(label)).toBeInTheDocument()
  })

  it('marks the configured corner as the active one', () => {
    renderSettings({ config: { webcamPosition: 'top-right' } })

    expect(button('top right')).toHaveClass(styles.active)
    expect(button('top left')).not.toHaveClass(styles.active)
    expect(button('bottom left')).not.toHaveClass(styles.active)
    expect(button('bottom right')).not.toHaveClass(styles.active)
  })

  it.each(positions)('%s patches the config to %s', async (label, value) => {
    const user = userEvent.setup()
    const { onChange } = renderSettings()

    await user.click(button(label))

    expect(onChange).toHaveBeenCalledWith({ webcamPosition: value })
  })
})

describe('WebcamOverlaySettings size', () => {
  it('is a labelled range over the documented 10%-40% band', () => {
    renderSettings({ config: { webcamSize: 0.2 } })

    const input = slider()
    expect(input).toHaveAttribute('id', 'webcam-size-slider')
    expect(input).toHaveAttribute('type', 'range')
    expect(input).toHaveAttribute('min', '0.1')
    expect(input).toHaveAttribute('max', '0.4')
    expect(input).toHaveAttribute('step', '0.05')
    expect(input).toHaveValue('0.2')
    expect(screen.getByText('Size')).toHaveAttribute('for', 'webcam-size-slider')
  })

  it('patches the config with the slider value as a number', () => {
    const { onChange } = renderSettings({ config: { webcamSize: 0.2 } })

    fireEvent.change(slider(), { target: { value: '0.35' } })

    expect(onChange).toHaveBeenCalledWith({ webcamSize: 0.35 })
  })
})

describe('WebcamOverlaySettings shape', () => {
  it('marks the configured shape as the active one', () => {
    renderSettings({ config: { webcamShape: 'rectangle' } })

    expect(button('rectangle')).toHaveClass(styles.active)
    expect(button('circle')).not.toHaveClass(styles.active)
  })

  it.each(['circle', 'rectangle'] as const)('%s patches the config', async (shape) => {
    const user = userEvent.setup()
    const { onChange } = renderSettings()

    await user.click(button(shape))

    expect(onChange).toHaveBeenCalledWith({ webcamShape: shape })
  })
})

describe('WebcamOverlaySettings mid-take', () => {
  it('freezes every control while a take is running', () => {
    renderSettings({ disabled: true })

    for (const [label] of positions) expect(button(label)).toBeDisabled()
    expect(button('circle')).toBeDisabled()
    expect(button('rectangle')).toBeDisabled()
    expect(slider()).toBeDisabled()
  })

  it('leaves every control usable otherwise', () => {
    renderSettings({ disabled: false })

    for (const [label] of positions) expect(button(label)).toBeEnabled()
    expect(button('circle')).toBeEnabled()
    expect(slider()).toBeEnabled()
  })
})

describe('the separate-tracks toggle', () => {
  it('is off by default, and says what the mode costs', () => {
    renderSettings({ separateTracksReason: null })

    const toggle = screen.getByRole('button', { name: 'Record webcam as a separate track' })
    expect(toggle).toBeEnabled()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    // The cost is said before the choice, not after it — the same shape as the
    // silent-MP4 note under the library.
    expect(
      screen.getByText(
        'Records the screen and the webcam as two files, so the webcam can be moved, resized or removed in the editor. Uses about twice the CPU and storage.'
      )
    ).toBeInTheDocument()
  })

  it('reports the config patch when switched on', async () => {
    const { onChange } = renderSettings({ separateTracksReason: null })

    await userEvent.click(
      screen.getByRole('button', { name: 'Record webcam as a separate track' })
    )

    expect(onChange).toHaveBeenCalledWith({ separateTracks: true })
  })

  it('marks itself pressed once the config says it is on', () => {
    renderSettings({ separateTracksReason: null, config: { separateTracks: true } })

    const toggle = screen.getByRole('button', { name: 'Record webcam as a separate track' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveClass(styles.active)
  })

  it('stays on screen, disabled, with the reason said out loud', () => {
    renderSettings({
      separateTracksReason: 'This browser cannot record two tracks at once — Chrome or Edge can.',
    })

    const toggle = screen.getByRole('button', { name: 'Record webcam as a separate track' })
    expect(toggle).toBeDisabled()
    // Say why, do not hide: the reason is in the title AND in the paragraph the
    // toggle's aria-describedby points at, exactly as the record button and the
    // MP4 button do it.
    expect(
      screen.getByText('This browser cannot record two tracks at once — Chrome or Edge can.')
    ).toBeInTheDocument()
    expect(toggle).toHaveAttribute(
      'aria-describedby',
      screen.getByText('This browser cannot record two tracks at once — Chrome or Edge can.').id
    )
  })

  it('is disabled mid-take like every other overlay control', () => {
    renderSettings({ separateTracksReason: null, disabled: true })

    expect(
      screen.getByRole('button', { name: 'Record webcam as a separate track' })
    ).toBeDisabled()
  })
})
