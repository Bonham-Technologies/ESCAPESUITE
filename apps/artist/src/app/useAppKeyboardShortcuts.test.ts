// Every branch of the global keyboard cascade, driven the way a browser
// delivers a chord.
//
// `fireEvent.keyDown` returns false when a listener called `preventDefault`,
// which is how the tests tell "this shortcut claimed the key" from "this key
// was left to the browser" — the four page-zoom chords depend on the latter,
// and so does the Escape cascade's first branch, which deliberately does not
// prevent the default.
//
// Everything the cascade calls is a plain `vi.fn()`; only the playhead is
// real, because four branches read it through `useEditorStore.getState()`
// rather than taking it as a parameter.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, renderHook } from '@testing-library/react'
import { useAppKeyboardShortcuts, type AppKeyboardShortcutsDeps } from './useAppKeyboardShortcuts'
import { useEditorStore } from '../store/projectStore'
import { addClip, resetStoreForTest } from '../test/fixtures/projectStore'
import type { Clip } from '../store/types'

interface Chord {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/** Send a key to the window the way a browser would while nothing is focused. */
const press = (key: string, chord: Chord = {}) => fireEvent.keyDown(window, { key, ...chord })

/** Send a key from inside a focused field, which the cascade ignores. */
const pressInto = (el: Element, key: string, chord: Chord = {}) =>
  fireEvent.keyDown(el, { key, ...chord, bubbles: true })

let deps: AppKeyboardShortcutsDeps
let clip: Clip

const mountShortcuts = (overrides: Partial<AppKeyboardShortcutsDeps> = {}) => {
  deps = { ...deps, ...overrides }
  return renderHook((props: AppKeyboardShortcutsDeps = deps) => useAppKeyboardShortcuts(props), {
    initialProps: deps,
  })
}

/** Move the playhead the branches that read `getState().currentTime` see. */
const movePlayhead = (time: number) => useEditorStore.getState().setCurrentTime(time)

beforeEach(() => {
  resetStoreForTest()
  clip = addClip('clip-1', 0, 4)
  deps = {
    canUndo: vi.fn(() => true),
    canRedo: vi.fn(() => true),
    undo: vi.fn(),
    redo: vi.fn(),
    selectedClipId: null,
    removeClipFromTimeline: vi.fn(),
    rippleDeleteClip: vi.fn(),
    activeTool: 'select',
    duplicateClip: vi.fn(),
    handleSaveProject: vi.fn(),
    handleLoadProject: vi.fn(),
    clips: [clip],
    handleZoomIn: vi.fn(),
    handleZoomOut: vi.fn(),
    showNotification: vi.fn(),
    modalOpen: false,
    keyframePanelOpen: false,
    setKeyframePanelOpen: vi.fn(),
    setSelectedClipId: vi.fn(),
    setActiveTool: vi.fn(),
    snapEnabled: true,
    setSnapEnabled: vi.fn(),
    addMarker: vi.fn(),
    goToNextMarker: vi.fn(),
    goToPreviousMarker: vi.fn(),
    showShortcuts: false,
    setShowShortcuts: vi.fn(),
    setShowExport: vi.fn(),
    splitClip: vi.fn(),
    selectedClipIds: new Set<string>(),
    deleteSelectedClips: vi.fn(),
    copySelectedClips: vi.fn(),
    pasteClips: vi.fn(),
    clipboard: null,
    clearMultiSelection: vi.fn(),
    setInPoint: vi.fn(),
    setOutPoint: vi.fn(),
    clearInOutPoints: vi.fn(),
    inPoint: null,
    outPoint: null,
  }
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('the typing guard', () => {
  it('ignores keys typed into a text input', () => {
    mountShortcuts()
    const input = document.createElement('input')
    document.body.appendChild(input)

    pressInto(input, 'v')

    expect(deps.setActiveTool).not.toHaveBeenCalled()
  })

  it('ignores keys typed into a textarea', () => {
    mountShortcuts()
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)

    pressInto(textarea, 'c')

    expect(deps.setActiveTool).not.toHaveBeenCalled()
  })

  it('ignores keys chosen in a select', () => {
    mountShortcuts()
    const select = document.createElement('select')
    document.body.appendChild(select)

    pressInto(select, 'v')

    expect(deps.setActiveTool).not.toHaveBeenCalled()
  })
})

describe('undo and redo', () => {
  it('Ctrl+Z undoes', () => {
    mountShortcuts()

    expect(press('z', { ctrlKey: true })).toBe(false)
    expect(deps.undo).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('Undo', 'info')
  })

  it('Cmd+Z undoes too', () => {
    mountShortcuts()

    press('z', { metaKey: true })

    expect(deps.undo).toHaveBeenCalled()
  })

  it('Ctrl+Z with nothing to undo still claims the key', () => {
    mountShortcuts({ canUndo: vi.fn(() => false) })

    expect(press('z', { ctrlKey: true })).toBe(false)
    expect(deps.undo).not.toHaveBeenCalled()
    expect(deps.showNotification).not.toHaveBeenCalled()
  })

  it('Ctrl+Y redoes', () => {
    mountShortcuts()

    press('y', { ctrlKey: true })

    expect(deps.redo).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('Redo', 'info')
  })

  it('Ctrl+Shift+Z redoes', () => {
    mountShortcuts()

    press('z', { ctrlKey: true, shiftKey: true })

    expect(deps.redo).toHaveBeenCalled()
    expect(deps.undo).not.toHaveBeenCalled()
  })

  it('Ctrl+Y with nothing to redo still claims the key', () => {
    mountShortcuts({ canRedo: vi.fn(() => false) })

    expect(press('y', { ctrlKey: true })).toBe(false)
    expect(deps.redo).not.toHaveBeenCalled()
  })
})

describe('deleting', () => {
  it('Delete removes a multi-selection, pluralised', () => {
    mountShortcuts({ selectedClipIds: new Set(['a', 'b']) })

    press('Delete')

    expect(deps.deleteSelectedClips).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('2 clips deleted', 'info')
  })

  it('Delete removes the single selected clip', () => {
    mountShortcuts({ selectedClipId: 'clip-1' })

    press('Delete')

    expect(deps.removeClipFromTimeline).toHaveBeenCalledWith('clip-1')
    expect(deps.showNotification).toHaveBeenCalledWith('Clip deleted', 'info')
  })

  it('Backspace ripple-deletes while the ripple tool is active', () => {
    mountShortcuts({ selectedClipId: 'clip-1', activeTool: 'ripple' })

    press('Backspace')

    expect(deps.rippleDeleteClip).toHaveBeenCalledWith('clip-1')
    expect(deps.removeClipFromTimeline).not.toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('Clip deleted (ripple)', 'info')
  })

  it('Delete with nothing selected leaves the key to the browser', () => {
    mountShortcuts()

    expect(press('Delete')).toBe(true)
    expect(deps.deleteSelectedClips).not.toHaveBeenCalled()
    expect(deps.removeClipFromTimeline).not.toHaveBeenCalled()
  })
})

describe('copy, paste and duplicate', () => {
  it('Ctrl+C copies the selection, pluralised', () => {
    mountShortcuts({ selectedClipIds: new Set(['a']) })

    press('c', { ctrlKey: true })

    expect(deps.copySelectedClips).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('1 clip copied', 'info')
  })

  it('Ctrl+C with nothing selected does not fall through to the razor tool', () => {
    mountShortcuts()

    press('c', { ctrlKey: true })

    expect(deps.copySelectedClips).not.toHaveBeenCalled()
    expect(deps.setActiveTool).not.toHaveBeenCalled()
  })

  it('Ctrl+V pastes the clipboard, pluralised', () => {
    mountShortcuts({ clipboard: [clip] })

    press('v', { ctrlKey: true })

    expect(deps.pasteClips).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('1 clip pasted', 'info')
  })

  it('Ctrl+V with an empty clipboard does not fall through to the selection tool', () => {
    mountShortcuts({ clipboard: [] })

    press('v', { ctrlKey: true })

    expect(deps.pasteClips).not.toHaveBeenCalled()
    expect(deps.setActiveTool).not.toHaveBeenCalled()
  })

  it('Ctrl+D duplicates the selected clip', () => {
    mountShortcuts({ selectedClipId: 'clip-1' })

    press('d', { ctrlKey: true })

    expect(deps.duplicateClip).toHaveBeenCalledWith('clip-1')
    expect(deps.showNotification).toHaveBeenCalledWith('Clip duplicated', 'info')
  })

  it('Ctrl+D with nothing selected duplicates nothing', () => {
    mountShortcuts()

    press('d', { ctrlKey: true })

    expect(deps.duplicateClip).not.toHaveBeenCalled()
  })
})

describe('the file and export chords', () => {
  it('Ctrl+S saves', () => {
    mountShortcuts()

    press('s', { ctrlKey: true })

    expect(deps.handleSaveProject).toHaveBeenCalled()
    expect(deps.setSnapEnabled).not.toHaveBeenCalled()
  })

  it('Ctrl+O opens', () => {
    mountShortcuts()

    press('o', { ctrlKey: true })

    expect(deps.handleLoadProject).toHaveBeenCalled()
    expect(deps.setOutPoint).not.toHaveBeenCalled()
  })

  it('Ctrl+E exports when there is something on the timeline', () => {
    mountShortcuts()

    press('e', { ctrlKey: true })

    expect(deps.setShowExport).toHaveBeenCalledWith(true)
  })

  it('Ctrl+E does nothing on an empty timeline', () => {
    mountShortcuts({ clips: [] })

    expect(press('e', { ctrlKey: true })).toBe(true)
    expect(deps.setShowExport).not.toHaveBeenCalled()
  })
})

describe('zoom', () => {
  it('+ and = zoom in', () => {
    mountShortcuts()

    press('+')
    press('=')

    expect(deps.handleZoomIn).toHaveBeenCalledTimes(2)
  })

  it('- zooms out', () => {
    mountShortcuts()

    press('-')

    expect(deps.handleZoomOut).toHaveBeenCalled()
  })

  it.each([
    ['=', { ctrlKey: true }],
    ['+', { metaKey: true }],
    ['-', { ctrlKey: true }],
    ['-', { metaKey: true }],
  ] as const)('leaves the browser its own page zoom: %s', (key, chord) => {
    mountShortcuts()

    // Not prevented — the browser still gets to zoom the page.
    expect(press(key, chord)).toBe(true)
    expect(deps.handleZoomIn).not.toHaveBeenCalled()
    expect(deps.handleZoomOut).not.toHaveBeenCalled()
  })
})

describe('the tool and panel keys', () => {
  it('K opens the keyframe panel', () => {
    mountShortcuts({ keyframePanelOpen: false })

    press('k')

    expect(deps.setKeyframePanelOpen).toHaveBeenCalledWith(true)
    expect(deps.showNotification).toHaveBeenCalledWith('Keyframe panel opened', 'info')
  })

  it('K closes it again', () => {
    mountShortcuts({ keyframePanelOpen: true })

    press('k')

    expect(deps.setKeyframePanelOpen).toHaveBeenCalledWith(false)
    expect(deps.showNotification).toHaveBeenCalledWith('Keyframe panel closed', 'info')
  })

  it.each(['v', 'V'])('%s picks the selection tool', (key) => {
    mountShortcuts()

    press(key)

    expect(deps.setActiveTool).toHaveBeenCalledWith('select')
    expect(deps.showNotification).toHaveBeenCalledWith('Selection Tool', 'info')
  })

  it('C picks the razor tool', () => {
    mountShortcuts()

    press('c')

    expect(deps.setActiveTool).toHaveBeenCalledWith('razor')
    expect(deps.showNotification).toHaveBeenCalledWith('Razor Tool', 'info')
  })

  it.each(['b', 'B'])('%s picks the ripple tool', (key) => {
    mountShortcuts()

    press(key)

    expect(deps.setActiveTool).toHaveBeenCalledWith('ripple')
    expect(deps.showNotification).toHaveBeenCalledWith('Ripple Edit Tool', 'info')
  })

  it('S turns snapping off when it is on', () => {
    mountShortcuts({ snapEnabled: true })

    press('s')

    expect(deps.setSnapEnabled).toHaveBeenCalledWith(false)
    expect(deps.showNotification).toHaveBeenCalledWith('Snapping Off', 'info')
  })

  it('S turns snapping on when it is off', () => {
    mountShortcuts({ snapEnabled: false })

    press('s')

    expect(deps.setSnapEnabled).toHaveBeenCalledWith(true)
    expect(deps.showNotification).toHaveBeenCalledWith('Snapping On', 'info')
  })
})

describe('Ctrl+B, splitting at the playhead', () => {
  it('splits the selected clip at the playhead offset', () => {
    mountShortcuts({ selectedClipId: 'clip-1' })
    movePlayhead(2)

    press('b', { ctrlKey: true })

    expect(deps.splitClip).toHaveBeenCalledWith('clip-1', 2)
    expect(deps.showNotification).toHaveBeenCalledWith('Clip split', 'info')
  })

  it('does nothing with the playhead outside the clip', () => {
    mountShortcuts({ selectedClipId: 'clip-1' })
    movePlayhead(0)

    press('b', { ctrlKey: true })

    expect(deps.splitClip).not.toHaveBeenCalled()
  })

  it('does nothing when the selected id is not on the timeline', () => {
    mountShortcuts({ selectedClipId: 'gone' })
    movePlayhead(2)

    press('b', { ctrlKey: true })

    expect(deps.splitClip).not.toHaveBeenCalled()
  })
})

describe('markers and in/out points', () => {
  it('M drops a marker at the playhead', () => {
    mountShortcuts()
    movePlayhead(3)

    press('m')

    expect(deps.addMarker).toHaveBeenCalledWith(3)
    expect(deps.showNotification).toHaveBeenCalledWith('Marker added', 'info')
  })

  it('Shift+M goes to the next marker', () => {
    mountShortcuts()

    press('M', { shiftKey: true })

    expect(deps.goToNextMarker).toHaveBeenCalled()
    expect(deps.addMarker).not.toHaveBeenCalled()
  })

  it('Ctrl+M goes to the previous marker', () => {
    mountShortcuts()

    press('m', { ctrlKey: true })

    expect(deps.goToPreviousMarker).toHaveBeenCalled()
  })

  it('I sets the in point and names the time', () => {
    mountShortcuts()
    movePlayhead(4)

    press('i')

    expect(deps.setInPoint).toHaveBeenCalledWith(4)
    expect(deps.showNotification).toHaveBeenCalledWith('In point: 0:04', 'info')
  })

  it('O sets the out point and names the time', () => {
    mountShortcuts()
    movePlayhead(4)

    press('o')

    expect(deps.setOutPoint).toHaveBeenCalledWith(4)
    expect(deps.showNotification).toHaveBeenCalledWith('Out point: 0:04', 'info')
  })
})

describe('the shortcuts sheet', () => {
  it('? opens it', () => {
    mountShortcuts()

    press('?')

    expect(deps.setShowShortcuts).toHaveBeenCalledWith(true)
  })

  it('Shift+/ opens it too', () => {
    mountShortcuts()

    press('/', { shiftKey: true })

    expect(deps.setShowShortcuts).toHaveBeenCalledWith(true)
  })

  it('? closes it again', () => {
    mountShortcuts({ showShortcuts: true })

    press('?')

    expect(deps.setShowShortcuts).toHaveBeenCalledWith(false)
  })
})

describe('the Escape cascade, in order', () => {
  /** Everything Escape could act on, all at once. */
  const everything = {
    showShortcuts: true,
    inPoint: 1,
    outPoint: 3,
    selectedClipIds: new Set(['a']),
    selectedClipId: 'clip-1',
  }

  it('first closes the shortcuts sheet — and leaves the key unclaimed', () => {
    mountShortcuts(everything)

    // The only branch of the cascade that does not call preventDefault.
    expect(press('Escape')).toBe(true)
    expect(deps.setShowShortcuts).toHaveBeenCalledWith(false)
    expect(deps.clearInOutPoints).not.toHaveBeenCalled()
  })

  it('then clears the in/out points', () => {
    mountShortcuts({ ...everything, showShortcuts: false })

    expect(press('Escape')).toBe(false)
    expect(deps.clearInOutPoints).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('In/Out points cleared', 'info')
    expect(deps.clearMultiSelection).not.toHaveBeenCalled()
  })

  it('clears them from an out point alone', () => {
    mountShortcuts({ ...everything, showShortcuts: false, inPoint: null })

    press('Escape')

    expect(deps.clearInOutPoints).toHaveBeenCalled()
  })

  it('then clears the multi-selection', () => {
    mountShortcuts({ ...everything, showShortcuts: false, inPoint: null, outPoint: null })

    press('Escape')

    expect(deps.clearMultiSelection).toHaveBeenCalled()
    expect(deps.setSelectedClipId).not.toHaveBeenCalled()
  })

  it('then deselects the single clip', () => {
    mountShortcuts({
      ...everything,
      showShortcuts: false,
      inPoint: null,
      outPoint: null,
      selectedClipIds: new Set<string>(),
    })

    press('Escape')

    expect(deps.setSelectedClipId).toHaveBeenCalledWith(null)
  })

  it('and with nothing to clear, leaves the key alone', () => {
    mountShortcuts()

    expect(press('Escape')).toBe(true)
    expect(deps.setSelectedClipId).not.toHaveBeenCalled()
    expect(deps.clearMultiSelection).not.toHaveBeenCalled()
  })
})

describe('a modal in front of the editor', () => {
  /** Everything the cascade could act on, so a silent key is the gate and not an empty store. */
  const loaded = {
    modalOpen: true,
    selectedClipId: 'clip-1',
    selectedClipIds: new Set(['clip-1']),
    clipboard: [] as Clip[],
    inPoint: 1,
    outPoint: 3,
  }

  it('takes no key at all', () => {
    mountShortcuts(loaded)

    // Each of these claims the key and acts on it when nothing is in front.
    expect(press('z', { ctrlKey: true })).toBe(true)
    expect(press('Delete')).toBe(true)
    expect(press('v')).toBe(true)
    expect(press('?')).toBe(true)
    expect(press('Escape')).toBe(true)

    expect(deps.undo).not.toHaveBeenCalled()
    expect(deps.deleteSelectedClips).not.toHaveBeenCalled()
    expect(deps.removeClipFromTimeline).not.toHaveBeenCalled()
    expect(deps.setActiveTool).not.toHaveBeenCalled()
    expect(deps.setShowShortcuts).not.toHaveBeenCalled()
    expect(deps.clearInOutPoints).not.toHaveBeenCalled()
    expect(deps.showNotification).not.toHaveBeenCalled()
  })

  it('takes them again the moment the modal closes', () => {
    const { rerender } = mountShortcuts(loaded)

    press('v')
    expect(deps.setActiveTool).not.toHaveBeenCalled()

    rerender({ ...deps, modalOpen: false })
    press('v')

    expect(deps.setActiveTool).toHaveBeenCalledWith('select')
  })
})

describe('the listener itself', () => {
  it('holds exactly one keydown listener while mounted', () => {
    const add = vi.spyOn(window, 'addEventListener')
    mountShortcuts()

    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1)
  })

  it('re-binds when a dependency changes, so the handler is never stale', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { rerender } = mountShortcuts()

    rerender({ ...deps, selectedClipId: 'clip-1' })

    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(2)
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1)
    // And the new handler is the live one.
    press('Delete')
    expect(deps.removeClipFromTimeline).toHaveBeenCalledWith('clip-1')
  })

  it('stops listening on unmount', () => {
    const { unmount } = mountShortcuts()

    unmount()
    press('v')

    expect(deps.setActiveTool).not.toHaveBeenCalled()
  })
})
