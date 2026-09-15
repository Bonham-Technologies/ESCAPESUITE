// The Sources panel, driven by props only.
//
// Four near-identical rows means four chances to wire the wrong capability
// slice to the wrong toggle, so every row is asserted on its own: which config
// flag it reflects, which capability disables it, which message it shows when
// the browser cannot offer it, and which source name it reports when clicked.
// The audio meters underneath have their own visibility rule — an audio source
// *and* a take in progress — and each of its combinations is covered.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SourceToggles, type RecordingSource } from './SourceToggles'
import { defaultConfig, type RecordingConfig } from '../../store/types'
import type {
  AudioLevels,
  DetailedCapabilities,
  EnvironmentCapabilities,
} from '../../store/types'
import styles from '../../App.module.css'

function allCapabilities(): EnvironmentCapabilities {
  return {
    screenCapture: true,
    webcam: true,
    microphone: true,
    systemAudio: true,
    mediaRecorder: true,
  }
}

function allDetailed(): DetailedCapabilities {
  return {
    screenCapture: { available: true },
    webcam: { available: true },
    microphone: { available: true },
    systemAudio: { available: true },
    mediaRecorder: { available: true },
  }
}

interface Options {
  config?: Partial<RecordingConfig>
  capabilities?: Partial<EnvironmentCapabilities>
  detailedCapabilities?: Partial<DetailedCapabilities>
  audioLevels?: AudioLevels
  isRecordingActive?: boolean
  systemAudioShared?: boolean
}

function renderToggles(options: Options = {}) {
  const onToggleSource = vi.fn<(source: RecordingSource) => void>()
  const { container } = render(
    <SourceToggles
      config={{ ...defaultConfig, ...options.config }}
      capabilities={{ ...allCapabilities(), ...options.capabilities }}
      detailedCapabilities={{ ...allDetailed(), ...options.detailedCapabilities }}
      audioLevels={options.audioLevels ?? { microphone: 0, system: 0 }}
      isRecordingActive={options.isRecordingActive ?? false}
      systemAudioShared={options.systemAudioShared ?? true}
      onToggleSource={onToggleSource}
    />
  )
  return { onToggleSource, container }
}

function toggle(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

/** The row element wrapping a toggle — the part that greys out. */
function row(name: string): HTMLElement {
  return toggle(name).parentElement as HTMLElement
}

const rows: Array<[string, RecordingSource, keyof RecordingConfig, keyof EnvironmentCapabilities]> = [
  ['Screen', 'screen', 'screenEnabled', 'screenCapture'],
  ['Webcam', 'webcam', 'webcamEnabled', 'webcam'],
  ['Microphone', 'microphone', 'microphoneEnabled', 'microphone'],
  ['System Audio', 'systemAudio', 'systemAudioEnabled', 'systemAudio'],
]

describe('SourceToggles rows', () => {
  it('lists the four sources under a Sources heading', () => {
    renderToggles()

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Sources')
    for (const [label] of rows) expect(toggle(label)).toBeInTheDocument()
  })

  it.each(rows)('%s reports its config flag as aria-pressed', (label, _source, flag) => {
    renderToggles({ config: { [flag]: true } as Partial<RecordingConfig> })
    expect(toggle(label)).toHaveAttribute('aria-pressed', 'true')
    expect(toggle(label)).toHaveClass(styles.active)
  })

  it.each(rows)('%s is unpressed and inactive when its flag is off', (label, _source, flag) => {
    renderToggles({ config: { [flag]: false } as Partial<RecordingConfig> })
    expect(toggle(label)).toHaveAttribute('aria-pressed', 'false')
    expect(toggle(label)).not.toHaveClass(styles.active)
  })

  it.each(rows)('%s reports itself to the caller when clicked', async (label, source) => {
    const user = userEvent.setup()
    const { onToggleSource } = renderToggles()

    await user.click(toggle(label))

    expect(onToggleSource).toHaveBeenCalledTimes(1)
    expect(onToggleSource).toHaveBeenCalledWith(source)
  })
})

describe('SourceToggles availability', () => {
  it.each(rows)('%s is disabled when the browser cannot capture it', (label, _source, _flag, capability) => {
    renderToggles({ capabilities: { [capability]: false } })
    expect(toggle(label)).toBeDisabled()
  })

  it.each(rows)('%s is disabled mid-take even though it is available', (label) => {
    renderToggles({ isRecordingActive: true })
    expect(toggle(label)).toBeDisabled()
  })

  it.each(rows)('%s is enabled when it is available and nothing is recording', (label) => {
    renderToggles()
    expect(toggle(label)).toBeEnabled()
  })

  it('greys a row out and explains why, with a struck-through icon', () => {
    const { container } = renderToggles({
      detailedCapabilities: {
        webcam: { available: false, reason: 'no_device', message: 'No camera found' },
      },
    })

    expect(row('Webcam')).toHaveClass(styles.sourceUnavailable)
    expect(row('Webcam')).toHaveAttribute('title', 'No camera found')
    expect(container.querySelectorAll(`.${styles.unavailableIcon}`)).toHaveLength(1)
  })

  it('leaves an available row plain, with no tooltip and no icon', () => {
    const { container } = renderToggles()

    for (const [label] of rows) {
      expect(row(label)).not.toHaveClass(styles.sourceUnavailable)
      expect(row(label)).not.toHaveAttribute('title')
    }
    expect(container.querySelectorAll(`.${styles.unavailableIcon}`)).toHaveLength(0)
  })

  it('marks every row unavailable when nothing at all is supported', () => {
    const { container } = renderToggles({
      detailedCapabilities: {
        screenCapture: { available: false, message: 'No screen capture' },
        webcam: { available: false, message: 'No webcam' },
        microphone: { available: false, message: 'No microphone' },
        systemAudio: { available: false, message: 'No system audio' },
      },
    })

    expect(row('Screen')).toHaveAttribute('title', 'No screen capture')
    expect(row('Microphone')).toHaveAttribute('title', 'No microphone')
    expect(row('System Audio')).toHaveAttribute('title', 'No system audio')
    expect(container.querySelectorAll(`.${styles.unavailableIcon}`)).toHaveLength(4)
  })
})

describe('SourceToggles audio meters', () => {
  function fills(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>(`.${styles.meterFill}`)]
  }

  it('hides the meters while idle, even with both audio sources on', () => {
    const { container } = renderToggles({
      config: { microphoneEnabled: true, systemAudioEnabled: true },
      isRecordingActive: false,
    })

    expect(fills(container)).toHaveLength(0)
  })

  it('hides the meters mid-take when no audio source is on', () => {
    const { container } = renderToggles({
      config: { microphoneEnabled: false, systemAudioEnabled: false },
      isRecordingActive: true,
    })

    expect(fills(container)).toHaveLength(0)
  })

  it('shows only the mic meter when only the mic is on', () => {
    const { container } = renderToggles({
      config: { microphoneEnabled: true, systemAudioEnabled: false },
      isRecordingActive: true,
      audioLevels: { microphone: 0.42, system: 0.9 },
    })

    expect(screen.getByText('Mic')).toBeInTheDocument()
    expect(screen.queryByText('System')).not.toBeInTheDocument()
    expect(fills(container)).toHaveLength(1)
    expect(fills(container)[0]).toHaveStyle({ width: '42%' })
  })

  it('shows only the system meter when only system audio is on', () => {
    const { container } = renderToggles({
      config: { microphoneEnabled: false, systemAudioEnabled: true },
      isRecordingActive: true,
      audioLevels: { microphone: 0.9, system: 0.25 },
    })

    expect(screen.queryByText('Mic')).not.toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(fills(container)).toHaveLength(1)
    expect(fills(container)[0]).toHaveStyle({ width: '25%' })
  })

  it('shows both meters, each at its own level', () => {
    const { container } = renderToggles({
      config: { microphoneEnabled: true, systemAudioEnabled: true },
      isRecordingActive: true,
      audioLevels: { microphone: 0.1, system: 1 },
    })

    const [mic, system] = fills(container)
    expect(mic).toHaveStyle({ width: '10%' })
    expect(system).toHaveStyle({ width: '100%' })
  })
})

describe('SourceToggles system audio that never arrived', () => {
  it('greys the System meter and says why when the browser shared no audio', () => {
    const { container } = renderToggles({
      config: { systemAudioEnabled: true },
      isRecordingActive: true,
      systemAudioShared: false,
    })

    const meter = screen.getByText('System').closest(`.${styles.audioMeter}`) as HTMLElement
    expect(meter).toHaveClass(styles.meterUnavailable)
    // Not the notice's wording: the meter greys for a webcam-only take too,
    // where there was no share dialog to miss a tick box in.
    expect(meter).toHaveAttribute('title', 'No system audio arrived for this take.')
    // The microphone meter beside it is untouched.
    const mic = screen.getByText('Mic').closest(`.${styles.audioMeter}`) as HTMLElement
    expect(mic).not.toHaveClass(styles.meterUnavailable)
    expect(container.querySelectorAll(`.${styles.meterUnavailable}`)).toHaveLength(1)
  })

  it('leaves the System meter alone when the audio did arrive', () => {
    renderToggles({
      config: { systemAudioEnabled: true },
      isRecordingActive: true,
      systemAudioShared: true,
    })

    const meter = screen.getByText('System').closest(`.${styles.audioMeter}`) as HTMLElement
    expect(meter).not.toHaveClass(styles.meterUnavailable)
    expect(meter).not.toHaveAttribute('title')
  })
})
