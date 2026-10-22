// The inspector's Unlink action (ESCSUITE-355): shown only for a clip linked
// to others, and it takes the clip out of its link group.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditor } from './ClipEditor'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'

const clip = (id: string) => store().project.timeline.clips.find((c) => c.id === id)!

describe('ClipEditor Unlink', () => {
  beforeEach(() => {
    resetStoreForTest()
    addClip('screen', 0, 4)
    addClip('mic', 0, 4, store().addTrack('Mic').id)
  })

  it('is not offered for a clip linked to nothing', () => {
    store().setSelectedClipId('screen')
    render(<ClipEditor />)

    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument()
  })

  it('unlinks a linked clip, and then is gone', async () => {
    store().updateClip('screen', { linkGroupId: 'take' })
    store().updateClip('mic', { linkGroupId: 'take' })
    store().setSelectedClipId('screen')
    const user = userEvent.setup()
    render(<ClipEditor />)

    await user.click(screen.getByRole('button', { name: 'Unlink' }))

    expect(clip('screen').linkGroupId).toBeUndefined()
    expect(clip('mic').linkGroupId).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument()
  })

  it('is disabled on a locked track', () => {
    store().updateClip('screen', { linkGroupId: 'take' })
    store().updateClip('mic', { linkGroupId: 'take' })
    store().updateTrack(clip('screen').trackId, { locked: true })
    store().setSelectedClipId('screen')
    render(<ClipEditor />)

    expect(screen.getByRole('button', { name: 'Unlink' })).toBeDisabled()
  })
})
