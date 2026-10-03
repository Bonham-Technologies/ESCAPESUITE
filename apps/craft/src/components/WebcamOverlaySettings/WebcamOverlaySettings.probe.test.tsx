// ESCSUITE-176 item 7 (probe m7). The webcam position and shape buttons said
// which one was selected with a CSS class only — no `aria-pressed` — so a
// screen-reader user could not tell where the webcam overlay sat or what
// shape it was. Every other toggle in CRAFT (the four Sources rows, and the
// separate-tracks toggle in this very panel) already carries `aria-pressed`;
// ESCSUITE-89 did the equivalent work for ARTIST's inspector.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WebcamOverlaySettings } from './WebcamOverlaySettings'
import { defaultConfig, type RecordingConfig } from '../../store/types'

function renderSettings(config: Partial<RecordingConfig> = {}) {
  render(
    <WebcamOverlaySettings
      config={{ ...defaultConfig, ...config }}
      disabled={false}
      separateTracksReason={null}
      onChange={vi.fn()}
    />
  )
}

describe('PROBE: WebcamOverlaySettings', () => {
  it('says which webcam position is selected', () => {
    renderSettings({ webcamPosition: 'bottom-right' })

    expect(
      screen.getByRole('button', { name: 'bottom right', pressed: true })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'top left', pressed: false })
    ).toBeInTheDocument()
  })

  it('says which webcam shape is selected', () => {
    renderSettings({ webcamShape: 'circle' })

    expect(screen.getByRole('button', { name: 'circle', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'rectangle', pressed: false })).toBeInTheDocument()
  })
})
