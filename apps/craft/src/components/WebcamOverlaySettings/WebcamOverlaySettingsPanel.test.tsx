// The overlay panel's own subscription.
//
// The blocked reason is the panel's to compute, not App's: App must not gain a
// selector for a field only this leaf draws (see `App.rerender.test.tsx` and
// the `SourceTogglesPanel` precedent).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WebcamOverlaySettingsPanel } from './WebcamOverlaySettingsPanel'
import { useRecorderStore } from '../../store/recorderStore'
import { defaultConfig } from '../../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
} from '../../test/doubles/webcodecs'
import {
  installTrackProcessorDouble,
  uninstallTrackProcessorDouble,
} from '../../test/doubles/mediastream'

function renderPanel() {
  render(
    <WebcamOverlaySettingsPanel
      config={{ ...defaultConfig, screenEnabled: true, webcamEnabled: true }}
      disabled={false}
      onChange={vi.fn()}
    />
  )
}

afterEach(() => {
  uninstallTrackProcessorDouble()
  uninstallWebCodecsDoubles()
})

describe('WebcamOverlaySettingsPanel', () => {
  it('offers the toggle where the browser and the storage both allow it', () => {
    installWebCodecsDoubles()
    installTrackProcessorDouble()
    useRecorderStore.setState({ hasSeparateTracksSpace: true })

    renderPanel()

    expect(
      screen.getByRole('button', { name: 'Record webcam as a separate track' })
    ).toBeEnabled()
  })

  it('disables it with the storage reason when there is no room for two tracks', () => {
    installWebCodecsDoubles()
    installTrackProcessorDouble()
    useRecorderStore.setState({ hasSeparateTracksSpace: false })

    renderPanel()

    expect(
      screen.getByRole('button', { name: 'Record webcam as a separate track' })
    ).toBeDisabled()
    expect(
      screen.getByText('Not enough storage for separate tracks — delete a recording first.')
    ).toBeInTheDocument()
  })

  it('disables it with the browser reason where WebCodecs is missing', () => {
    // jsdom, i.e. Firefox and Safari: no VideoEncoder at all.
    useRecorderStore.setState({ hasSeparateTracksSpace: true })

    renderPanel()

    expect(
      screen.getByText('This browser cannot record two tracks at once — Chrome or Edge can.')
    ).toBeInTheDocument()
  })
})
