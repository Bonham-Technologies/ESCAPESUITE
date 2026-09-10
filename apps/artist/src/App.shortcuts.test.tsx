// Every global keyboard shortcut App installs on window.
//
// The handler reads e.key and the modifier flags directly, so the tests
// dispatch precise KeyboardEvents rather than typing: a chord like
// Ctrl+Shift+Z has to arrive with exactly those flags, and user-event's
// key mapping would decide for itself whether that is 'z' or 'Z'.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { useEditorStore } from './store/projectStore'
import { resetStoreForTest, store, addClip } from './test/fixtures/projectStore'
import { renderApp } from './test/renderApp'
import { installCanvasDouble, uninstallCanvasDouble } from './test/doubles/canvas'
import { installMediaPlaybackStubs } from './test/doubles/media'
import { saveProject, showOpenProjectDialog } from './core/projectManager'

vi.mock('./core/storage', async () => (await import('./test/appDoubles')).storageDouble())
vi.mock('./core/projectManager', async () =>
  (await import('./test/appDoubles')).projectManagerDouble()
)
vi.mock('./utils/integration', async () => (await import('./test/appDoubles')).integrationDouble())
vi.mock('./core/videoProcessor', async () =>
  (await import('./test/appDoubles')).videoProcessorDouble()
)

// jsdom's <video> pause()/play()/load() only report "Not implemented" to the
// virtual console, and the preview player pauses on every clip change. Patch
// them for the whole file — including the unmount that testing-library's
// cleanup triggers, which is outside any afterEach this file could own.
installMediaPlaybackStubs()

interface Chord {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/** Send a key to the window the way a browser would while nothing is focused. */
const press = (key: string, chord: Chord = {}) => fireEvent.keyDown(window, { key, ...chord })

const notification = () => screen.queryByRole('status')?.textContent

describe('App keyboard shortcuts', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
  })

  afterEach(() => {
    uninstallCanvasDouble()
    vi.clearAllMocks()
  })

  describe('the typing guard', () => {
    it('ignores a shortcut aimed at a text field', async () => {
      addClip('clip1', 0, 2)
      store().setSelectedClipId('clip1')
      await renderApp()

      fireEvent.keyDown(screen.getByLabelText('Project name'), { key: 'Delete' })

      expect(store().project.timeline.clips).toHaveLength(1)
    })

    it('ignores a shortcut aimed at a textarea', async () => {
      const clip = store().addTextOverlayClip()
      await renderApp()
      const textarea = screen.getByPlaceholderText('Enter text...')

      fireEvent.keyDown(textarea, { key: 'Delete' })
      fireEvent.keyDown(textarea, { key: 'm' })

      expect(store().project.timeline.clips.map((c) => c.id)).toEqual([clip.id])
      expect(store().markers).toHaveLength(0)
    })
  })

  describe('undo and redo', () => {
    beforeEach(() => {
      addClip('clip1', 0, 2)
    })

    it('undoes the last edit with ctrl+z', async () => {
      await renderApp()

      press('z', { ctrlKey: true })

      expect(store().project.timeline.clips).toHaveLength(0)
      expect(notification()).toBe('Undo')
    })

    it('undoes with cmd+z as well', async () => {
      await renderApp()

      press('z', { metaKey: true })

      expect(store().project.timeline.clips).toHaveLength(0)
    })

    it('does nothing when there is nothing to undo', async () => {
      store().clearHistory()
      await renderApp()

      press('z', { ctrlKey: true })

      expect(store().project.timeline.clips).toHaveLength(1)
      expect(notification()).toBeUndefined()
    })

    it('redoes with ctrl+shift+z', async () => {
      await renderApp()
      press('z', { ctrlKey: true })

      press('z', { ctrlKey: true, shiftKey: true })

      expect(store().project.timeline.clips).toHaveLength(1)
      expect(notification()).toBe('Redo')
    })

    it('redoes with ctrl+y', async () => {
      await renderApp()
      press('z', { ctrlKey: true })

      press('y', { ctrlKey: true })

      expect(store().project.timeline.clips).toHaveLength(1)
    })

    it('does nothing when there is nothing to redo', async () => {
      await renderApp()

      press('y', { ctrlKey: true })

      expect(store().project.timeline.clips).toHaveLength(1)
      expect(notification()).toBeUndefined()
    })
  })

  describe('deleting clips', () => {
    it.each(['Delete', 'Backspace'])('removes the selected clip with %s', async (key) => {
      addClip('clip1', 0, 2)
      store().setSelectedClipId('clip1')
      await renderApp()

      press(key)

      expect(store().project.timeline.clips).toHaveLength(0)
      expect(notification()).toBe('Clip deleted')
    })

    it('ripple-deletes while the ripple tool is out', async () => {
      addClip('clip1', 0, 2)
      const trackId = store().project.timeline.clips[0].trackId
      addClip('clip2', 2, 2, trackId)
      store().setSelectedClipId('clip1')
      store().setActiveTool('ripple')
      await renderApp()

      press('Delete')

      expect(notification()).toBe('Clip deleted (ripple)')
      expect(store().project.timeline.clips[0]).toMatchObject({ id: 'clip2', timelinePosition: 0 })
    })

    it('removes the whole multi-selection', async () => {
      addClip('clip1', 0, 2)
      addClip('clip2', 4, 2)
      store().selectClipsInRange(['clip1', 'clip2'])
      await renderApp()

      press('Delete')

      expect(store().project.timeline.clips).toHaveLength(0)
      expect(notification()).toBe('2 clips deleted')
    })

    it('does nothing with no clip selected', async () => {
      addClip('clip1', 0, 2)
      store().setSelectedClipId(null)
      await renderApp()

      press('Delete')

      expect(store().project.timeline.clips).toHaveLength(1)
    })
  })

  describe('copy, paste and duplicate', () => {
    beforeEach(() => {
      addClip('clip1', 0, 2)
    })

    it('copies the multi-selection', async () => {
      store().selectClipsInRange(['clip1'])
      await renderApp()

      press('c', { ctrlKey: true })

      expect(store().clipboard).toHaveLength(1)
      expect(notification()).toBe('1 clip copied')
    })

    it('copies nothing with no multi-selection', async () => {
      store().setSelectedClipId('clip1')
      await renderApp()

      press('c', { ctrlKey: true })

      expect(store().clipboard).toBeNull()
    })

    it('pastes what was copied', async () => {
      store().selectClipsInRange(['clip1'])
      await renderApp()
      press('c', { ctrlKey: true })

      press('v', { ctrlKey: true })

      expect(store().project.timeline.clips).toHaveLength(2)
      expect(notification()).toBe('1 clip pasted')
    })

    it('pastes nothing with an empty clipboard', async () => {
      await renderApp()

      press('v', { ctrlKey: true })

      expect(store().project.timeline.clips).toHaveLength(1)
    })

    it('duplicates the selected clip', async () => {
      store().setSelectedClipId('clip1')
      await renderApp()

      press('d', { ctrlKey: true })

      expect(store().project.timeline.clips).toHaveLength(2)
      expect(notification()).toBe('Clip duplicated')
    })

    it('duplicates nothing with no clip selected', async () => {
      store().setSelectedClipId(null)
      await renderApp()

      press('d', { ctrlKey: true })

      expect(store().project.timeline.clips).toHaveLength(1)
    })
  })

  describe('project shortcuts', () => {
    it('saves the project with ctrl+s', async () => {
      await renderApp()

      press('s', { ctrlKey: true })

      await waitFor(() => expect(notification()).toBe('Project saved successfully'))
      expect(saveProject).toHaveBeenCalledWith(store().project, store().sourceVideos)
    })

    it('reports a failed save', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(saveProject).mockRejectedValueOnce(new Error('disk full'))
      await renderApp()

      press('s', { ctrlKey: true })

      await waitFor(() => expect(notification()).toBe('Failed to save project'))
      expect(consoleError).toHaveBeenCalledWith('Save failed:', expect.any(Error))
      consoleError.mockRestore()
    })

    it('opens the project picker with ctrl+o', async () => {
      await renderApp()

      press('o', { ctrlKey: true })

      await waitFor(() => expect(showOpenProjectDialog).toHaveBeenCalled())
    })

    it('opens the export dialog with ctrl+e once there is something to export', async () => {
      addClip('clip1', 0, 2)
      await renderApp()

      press('e', { ctrlKey: true })

      expect(await screen.findByRole('heading', { name: 'Export Video' })).toBeInTheDocument()
    })

    it('leaves the export dialog shut with an empty timeline', async () => {
      await renderApp()

      press('e', { ctrlKey: true })

      expect(screen.queryByRole('heading', { name: 'Export Video' })).not.toBeInTheDocument()
    })
  })

  describe('zoom', () => {
    it.each(['+', '='])('zooms in with %s', async (key) => {
      await renderApp()

      press(key)

      expect(store().zoom).toBeCloseTo(1.25)
    })

    it('zooms out with -', async () => {
      await renderApp()

      press('-')

      expect(store().zoom).toBeCloseTo(0.8)
    })
  })

  describe('panels and tools', () => {
    it('toggles the keyframe panel with k', async () => {
      await renderApp()

      press('k')
      expect(store().keyframePanelState.isOpen).toBe(true)
      expect(notification()).toBe('Keyframe panel opened')

      press('k')
      expect(store().keyframePanelState.isOpen).toBe(false)
      expect(notification()).toBe('Keyframe panel closed')
    })

    it.each(['v', 'V'])('picks the selection tool with %s', async (key) => {
      store().setActiveTool('razor')
      await renderApp()

      press(key)

      expect(store().activeTool).toBe('select')
      expect(notification()).toBe('Selection Tool')
    })

    it('picks the razor tool with c', async () => {
      await renderApp()

      press('c')

      expect(store().activeTool).toBe('razor')
      expect(notification()).toBe('Razor Tool')
    })

    it.each(['b', 'B'])('picks the ripple tool with %s', async (key) => {
      await renderApp()

      press(key)

      expect(store().activeTool).toBe('ripple')
      expect(notification()).toBe('Ripple Edit Tool')
    })

    it('toggles snapping with s', async () => {
      await renderApp()

      press('s')
      expect(store().snapEnabled).toBe(false)
      expect(notification()).toBe('Snapping Off')

      press('s')
      expect(store().snapEnabled).toBe(true)
      expect(notification()).toBe('Snapping On')
    })

    it('shows and hides the shortcut sheet with ?', async () => {
      await renderApp()

      press('?')
      expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()

      press('?')
      expect(screen.queryByRole('heading', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument()
    })

    it('shows the shortcut sheet for shift+/ too', async () => {
      await renderApp()

      press('/', { shiftKey: true })

      expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
    })
  })

  describe('markers', () => {
    it('drops a marker at the playhead with m', async () => {
      store().setCurrentTime(3)
      await renderApp()

      press('m')

      expect(store().markers).toMatchObject([{ time: 3 }])
      expect(notification()).toBe('Marker added')
    })

    it('jumps to the next marker with shift+m', async () => {
      store().addMarker(2)
      store().addMarker(6)
      await renderApp()

      press('M', { shiftKey: true })

      expect(store().currentTime).toBe(2)
    })

    it('jumps to the previous marker with ctrl+m', async () => {
      store().addMarker(2)
      store().addMarker(6)
      store().setCurrentTime(8)
      await renderApp()

      press('m', { ctrlKey: true })

      expect(store().currentTime).toBe(6)
    })
  })

  describe('in and out points', () => {
    beforeEach(() => {
      addClip('clip1', 0, 10)
      store().setCurrentTime(4)
    })

    it('sets the in point with i', async () => {
      await renderApp()

      press('i')

      expect(store().inPoint).toBe(4)
      expect(notification()).toBe('In point: 0:04')
    })

    it('sets the out point with o', async () => {
      await renderApp()

      press('o')

      expect(store().outPoint).toBe(4)
      expect(notification()).toBe('Out point: 0:04')
    })
  })

  describe('escape', () => {
    it('closes the shortcut sheet first', async () => {
      addClip('clip1', 0, 2)
      store().setSelectedClipId('clip1')
      await renderApp()
      press('?')

      press('Escape')

      expect(screen.queryByRole('heading', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument()
      expect(store().selectedClipId).toBe('clip1')
    })

    it('clears the in and out points next', async () => {
      addClip('clip1', 0, 10)
      store().setSelectedClipId('clip1')
      store().setInPoint(1)
      store().setOutPoint(4)
      await renderApp()

      press('Escape')

      expect(store().inPoint).toBeNull()
      expect(store().outPoint).toBeNull()
      expect(notification()).toBe('In/Out points cleared')
      expect(store().selectedClipId).toBe('clip1')
    })

    it('clears the multi-selection next', async () => {
      addClip('clip1', 0, 2)
      addClip('clip2', 4, 2)
      store().selectClipsInRange(['clip1', 'clip2'])
      await renderApp()

      press('Escape')

      expect(store().selectedClipIds.size).toBe(0)
    })

    it('deselects the single selected clip last', async () => {
      addClip('clip1', 0, 2)
      store().setSelectedClipId('clip1')
      await renderApp()

      press('Escape')

      expect(store().selectedClipId).toBeNull()
    })

    it('does nothing with a clean slate', async () => {
      await renderApp()

      press('Escape')

      expect(useEditorStore.getState().selectedClipId).toBeNull()
    })
  })
})
