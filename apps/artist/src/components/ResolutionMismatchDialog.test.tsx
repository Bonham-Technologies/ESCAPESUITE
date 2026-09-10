import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResolutionMismatchDialog } from './ResolutionMismatchDialog'

const project = { width: 1920, height: 1080 }

function renderDialog(overrides: {
  mediaName?: string
  mediaDimensions?: { width: number; height: number }
  isOpen?: boolean
} = {}) {
  const onScaleToFit = vi.fn()
  const onKeepOriginal = vi.fn()
  render(
    <ResolutionMismatchDialog
      isOpen={overrides.isOpen ?? true}
      mediaName={overrides.mediaName ?? 'clip.mp4'}
      mediaDimensions={overrides.mediaDimensions ?? { width: 3840, height: 2160 }}
      projectDimensions={project}
      onScaleToFit={onScaleToFit}
      onKeepOriginal={onKeepOriginal}
    />
  )
  return { onScaleToFit, onKeepOriginal }
}

describe('ResolutionMismatchDialog', () => {
  it('renders nothing while closed', () => {
    renderDialog({ isOpen: false })

    expect(screen.queryByTestId('resolution-mismatch-dialog')).not.toBeInTheDocument()
  })

  it('describes media with more pixels than the project as larger', () => {
    renderDialog({ mediaDimensions: { width: 3840, height: 2160 } })

    expect(screen.getByText(/This video \(3840x2160\) is larger than/)).toBeInTheDocument()
    expect(screen.getByText(/your project \(1920x1080\)/)).toBeInTheDocument()
  })

  it('describes media with fewer pixels than the project as smaller', () => {
    renderDialog({ mediaDimensions: { width: 640, height: 480 } })

    expect(screen.getByText(/is smaller than/)).toBeInTheDocument()
  })

  it('calls the media an image when the file extension is a known image type', () => {
    renderDialog({ mediaName: 'Holiday Photo.JPEG', mediaDimensions: { width: 4000, height: 3000 } })

    expect(screen.getByText(/This image \(4000x3000\)/)).toBeInTheDocument()
  })

  it('falls back to calling the media a video for an unknown extension', () => {
    renderDialog({ mediaName: 'recording.mkv' })

    expect(screen.getByText(/This video/)).toBeInTheDocument()
  })

  it('falls back to calling the media a video when the name has no extension', () => {
    renderDialog({ mediaName: 'recording' })

    expect(screen.getByText(/This video/)).toBeInTheDocument()
  })

  it('reports the scale-to-fit choice', async () => {
    const user = userEvent.setup()
    const { onScaleToFit, onKeepOriginal } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Scale to Fit' }))

    expect(onScaleToFit).toHaveBeenCalledTimes(1)
    expect(onKeepOriginal).not.toHaveBeenCalled()
  })

  it('reports the keep-original choice', async () => {
    const user = userEvent.setup()
    const { onScaleToFit, onKeepOriginal } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Keep Original Size' }))

    expect(onKeepOriginal).toHaveBeenCalledTimes(1)
    expect(onScaleToFit).not.toHaveBeenCalled()
  })
})
