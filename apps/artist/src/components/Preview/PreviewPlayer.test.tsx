// The preview's empty states.
//
// The drawing, selection, transform and playback behaviour each have a file of
// their own, as do the transport buttons; this one covers what the component
// shows when there is nothing to draw.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PreviewPlayer } from './PreviewPlayer'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { installPreviewDoubles, renderPreview, settle, type PreviewDoubles } from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  resetFrameCache()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('PreviewPlayer empty state', () => {
  it('shows the placeholder when there are no clips', async () => {
    render(<PreviewPlayer />)
    await settle(60)

    expect(screen.getByText('Add clips to the timeline to preview')).toBeInTheDocument()
    expect(document.querySelector('canvas')).toBeNull()
  })

  it('shows a zero timecode and no clip info', async () => {
    render(<PreviewPlayer />)
    await settle(60)

    expect(screen.getByText('00:00.000')).toBeInTheDocument()
  })

  it('shows the canvas once there is a clip to draw', async () => {
    addClip('clip1', 0, 10)
    store().setCurrentTime(5)

    const preview = await renderPreview()

    expect(screen.queryByText('Add clips to the timeline to preview')).not.toBeInTheDocument()
    expect(preview.canvas).toBeInTheDocument()
    expect(preview.view.getByText('1 clip • clip1')).toBeInTheDocument()
  })
})
