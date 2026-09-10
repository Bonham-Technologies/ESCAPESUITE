import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toolbar } from './Toolbar'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import styles from './Toolbar.module.css'

const button = (title: RegExp | string) => screen.getByTitle(title)

function renderToolbar() {
  const onShowShortcuts = vi.fn()
  const view = render(<Toolbar onShowShortcuts={onShowShortcuts} />)
  return { ...view, onShowShortcuts }
}

/** Two clips on separate tracks, both selected. */
function selectTwoClips() {
  addClip('clip1', 0, 2)
  store().addTrack()
  const secondTrack = store().project.timeline.tracks[1]
  addClip('clip2', 0, 2, secondTrack.id)
  store().selectClipsInRange(['clip1', 'clip2'])
}

describe('Toolbar', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  describe('tools', () => {
    it('starts on the selection tool', () => {
      renderToolbar()

      expect(store().activeTool).toBe('select')
      expect(button(/Selection Tool/)).toHaveClass(styles.active)
      expect(button(/Razor Tool/)).not.toHaveClass(styles.active)
    })

    it('switches to the razor tool', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(button(/Razor Tool/))

      expect(store().activeTool).toBe('razor')
      expect(button(/Razor Tool/)).toHaveClass(styles.active)
    })

    it('switches to the ripple tool', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(button(/Ripple Edit/))

      expect(store().activeTool).toBe('ripple')
      expect(button(/Ripple Edit/)).toHaveClass(styles.active)
    })

    it('switches back to the selection tool', async () => {
      const user = userEvent.setup()
      store().setActiveTool('razor')
      renderToolbar()

      await user.click(button(/Selection Tool/))

      expect(store().activeTool).toBe('select')
    })
  })

  describe('history', () => {
    it('disables undo and redo with nothing in the history', () => {
      useEditorStore.setState({ history: { past: [], future: [] } })
      renderToolbar()

      expect(button(/Undo/)).toBeDisabled()
      expect(button(/Redo/)).toBeDisabled()
    })

    it('undoes the last edit', async () => {
      const user = userEvent.setup()
      addClip('clip1', 0, 2)
      renderToolbar()

      expect(button(/Undo/)).toBeEnabled()
      await user.click(button(/Undo/))

      expect(store().project.timeline.clips).toHaveLength(0)
    })

    it('redoes an undone edit', async () => {
      const user = userEvent.setup()
      addClip('clip1', 0, 2)
      store().undo()
      renderToolbar()

      expect(button(/Redo/)).toBeEnabled()
      await user.click(button(/Redo/))

      expect(store().project.timeline.clips.map((c) => c.id)).toEqual(['clip1'])
    })
  })

  describe('toggles', () => {
    it('turns snapping off and back on', async () => {
      const user = userEvent.setup()
      renderToolbar()

      expect(button(/Snapping On/)).toHaveTextContent('On')
      await user.click(button(/Snapping On/))
      expect(store().snapEnabled).toBe(false)
      expect(button(/Snapping Off/)).toHaveTextContent('Off')

      await user.click(button(/Snapping Off/))
      expect(store().snapEnabled).toBe(true)
    })

    it('turns loop playback on and back off', async () => {
      const user = userEvent.setup()
      renderToolbar()

      expect(button(/Loop Playback Off/)).toHaveTextContent('Off')
      await user.click(button(/Loop Playback Off/))
      expect(store().loopPlayback).toBe(true)
      expect(button(/Loop Playback On/)).toHaveTextContent('On')

      await user.click(button(/Loop Playback On/))
      expect(store().loopPlayback).toBe(false)
    })
  })

  it('adds a marker at the playhead', async () => {
    const user = userEvent.setup()
    store().setCurrentTime(3.5)
    renderToolbar()

    await user.click(button(/Add Marker at Playhead/))

    expect(store().markers.map((m) => m.time)).toEqual([3.5])
  })

  describe('in and out points', () => {
    it('sets the in point at the playhead and shows it in the tooltip', async () => {
      const user = userEvent.setup()
      store().setCurrentTime(2)
      renderToolbar()

      await user.click(button(/Set in point/))

      expect(store().inPoint).toBe(2)
      expect(button(/Set in point/).title).toBe('Set in point (I) — 00:02.000')
      expect(button(/Set in point/)).toHaveClass(styles.active)
    })

    it('sets the out point at the playhead', async () => {
      const user = userEvent.setup()
      store().setCurrentTime(5)
      renderToolbar()

      await user.click(button(/Set out point/))

      expect(store().outPoint).toBe(5)
      expect(button(/Set out point/).title).toBe('Set out point (O) — 00:05.000')
    })

    it('clicking the in point again at the same playhead clears both points', async () => {
      const user = userEvent.setup()
      store().setCurrentTime(2)
      renderToolbar()

      await user.click(button(/Set in point/))
      await user.click(button(/Set in point/))

      expect(store().inPoint).toBeNull()
      expect(store().outPoint).toBeNull()
    })

    it('clicking the out point again at the same playhead clears both points', async () => {
      const user = userEvent.setup()
      store().setCurrentTime(4)
      renderToolbar()

      await user.click(button(/Set out point/))
      await user.click(button(/Set out point/))

      expect(store().outPoint).toBeNull()
    })

    it('offers a clear button only once a point is set', async () => {
      const user = userEvent.setup()
      store().setCurrentTime(1)
      renderToolbar()

      expect(screen.queryByTitle('Clear in/out points')).not.toBeInTheDocument()

      await user.click(button(/Set in point/))
      await user.click(screen.getByTitle('Clear in/out points'))

      expect(store().inPoint).toBeNull()
      expect(screen.queryByTitle('Clear in/out points')).not.toBeInTheDocument()
    })
  })

  describe('multi-selection actions', () => {
    it('hides the group until more than one clip is selected', () => {
      addClip('clip1', 0, 2)
      store().setSelectedClipId('clip1')
      renderToolbar()

      expect(screen.queryByText(/clips selected/)).not.toBeInTheDocument()
    })

    it('reports how many clips are selected', () => {
      selectTwoClips()
      renderToolbar()

      expect(screen.getByText('2 clips selected')).toBeInTheDocument()
    })

    it('mutes the tracks holding the selected clips', async () => {
      const user = userEvent.setup()
      selectTwoClips()
      renderToolbar()

      await user.click(screen.getByTitle('Mute selected clips'))

      expect(store().project.timeline.tracks.map((t) => t.muted)).toEqual([true, true])
    })

    it('unmutes the tracks holding the selected clips', async () => {
      const user = userEvent.setup()
      selectTwoClips()
      store().muteSelectedClips()
      renderToolbar()

      await user.click(screen.getByTitle('Unmute selected clips'))

      expect(store().project.timeline.tracks.map((t) => t.muted)).toEqual([false, false])
    })

    it('deletes every selected clip', async () => {
      const user = userEvent.setup()
      selectTwoClips()
      renderToolbar()

      await user.click(screen.getByTitle(/Delete selected clips/))

      expect(store().project.timeline.clips).toHaveLength(0)
    })

    it('clears the selection', async () => {
      const user = userEvent.setup()
      selectTwoClips()
      renderToolbar()

      await user.click(screen.getByRole('button', { name: 'Clear' }))

      expect(useEditorStore.getState().selectedClipIds.size).toBe(0)
      expect(screen.queryByText(/clips selected/)).not.toBeInTheDocument()
    })
  })

  it('asks the host to show the shortcuts sheet', async () => {
    const user = userEvent.setup()
    const { onShowShortcuts } = renderToolbar()

    await user.click(screen.getByRole('button', { name: /Shortcuts/ }))

    expect(onShowShortcuts).toHaveBeenCalledTimes(1)
  })
})
