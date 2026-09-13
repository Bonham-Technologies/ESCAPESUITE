// Regression test for `ClipEditor.tsx`'s `selectedClip.effects?.blur ?? 0`:
// every other ClipEditor test selects a clip with no `effects` at all, so
// only the `?? 0` fallback ever ran. This one gives the clip a real blur so
// the other arm of that expression executes too.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditor } from './ClipEditor'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import { rowControl } from '../../test/domQueries'

describe('ClipEditor effects', () => {
  it('shows the clip\'s own blur radius, not the no-effects fallback', async () => {
    resetStoreForTest()
    const clip = addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')
    store().updateClipEffects(clip.id, { blur: 3.25 })

    const user = userEvent.setup()
    render(<ClipEditor />)
    await user.click(screen.getByRole('button', { name: 'Effects' }))

    expect(rowControl('Blur')).toHaveValue('3.25')
    expect(screen.getByText('3.3px')).toBeInTheDocument()
  })
})
