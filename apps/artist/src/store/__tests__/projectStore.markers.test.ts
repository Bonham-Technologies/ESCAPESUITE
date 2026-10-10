import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../projectStore'

describe('setMarkers (ESCSUITE-245)', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.getState().clearHistory()
  })

  it('replaces the whole list in one write and pushes no undo entry', () => {
    useEditorStore.getState().addMarker(9, 'old')
    useEditorStore.getState().clearHistory()
    const list = [
      { id: 'a', time: 1, label: 'A', color: '#111111' },
      { id: 'b', time: 2, label: 'B', color: '#222222' },
    ]

    useEditorStore.getState().setMarkers(list)

    expect(useEditorStore.getState().markers).toEqual(list)
    expect(useEditorStore.getState().canUndo).toBe(false)
  })

  it('an empty list clears the markers', () => {
    useEditorStore.getState().addMarker(3)
    useEditorStore.getState().setMarkers([])
    expect(useEditorStore.getState().markers).toEqual([])
  })
})
