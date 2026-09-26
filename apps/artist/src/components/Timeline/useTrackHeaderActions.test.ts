// The track header buttons: raising, lowering and deleting a track.
//
// Reordering is an index convention rather than an algorithm — the store counts
// from the bottom row up, the timeline draws from the top row down — so these
// tests assert the exact list handed to `reorderTracks` *and* the indices the
// store ends up with, because a reversal that is dropped or applied twice is
// invisible in one of the two alone.
//
// The scene is three tracks. In store order they are bottom, middle, top
// (indices 0, 1, 2); in the display order the hook is given, top comes first.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTrackHeaderActions, type TrackHeaderActionsDeps } from './useTrackHeaderActions'
import { useEditorStore } from '../../store/projectStore'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'

let reorderTracks: MockInstance
let removeTrack: MockInstance
let confirmSpy: MockInstance
let bottom: string
let middle: string
let top: string

beforeEach(() => {
  resetStoreForTest()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  bottom = useEditorStore.getState().project.timeline.tracks[0].id
  store().addTrack('middle')
  store().addTrack('top')
  const tracks = useEditorStore.getState().project.timeline.tracks
  middle = tracks[1].id
  top = tracks[2].id

  const state = useEditorStore.getState()
  reorderTracks = vi.fn(state.reorderTracks)
  removeTrack = vi.fn(state.removeTrack)
})

afterEach(() => {
  confirmSpy.mockRestore()
  vi.clearAllMocks()
})

/** The hook's inputs, read fresh from the store on every render. */
const deps = (): TrackHeaderActionsDeps => {
  const state = useEditorStore.getState()
  const tracks = state.project.timeline.tracks
  return {
    // What `Timeline` passes: display order, highest index first.
    sortedTracks: [...tracks].sort((a, b) => b.index - a.index),
    tracks,
    clips: state.project.timeline.clips,
    reorderTracks: reorderTracks as unknown as (trackIds: string[]) => void,
    removeTrack: removeTrack as unknown as (trackId: string) => void,
  }
}

const mountActions = () =>
  renderHook(() => {
    useEditorStore((state) => state.project.timeline.tracks)
    return useTrackHeaderActions(deps())
  })

/** The track ids in store order — index 0 first, the bottom row. */
const storeOrder = (): string[] =>
  [...useEditorStore.getState().project.timeline.tracks]
    .sort((a, b) => a.index - b.index)
    .map((t) => t.id)

describe('useTrackHeaderActions reordering', () => {
  it('raises a track by one row', () => {
    const { result } = mountActions()

    act(() => result.current.moveTrackUp(middle))

    // Display order was [top, middle, bottom]; the swap makes it
    // [middle, top, bottom], which the store is told bottom-first.
    expect(reorderTracks).toHaveBeenCalledWith([bottom, top, middle])
    expect(storeOrder()).toEqual([bottom, top, middle])
  })

  it('leaves the top track where it is', () => {
    const { result } = mountActions()

    act(() => result.current.moveTrackUp(top))

    expect(reorderTracks).not.toHaveBeenCalled()
    expect(storeOrder()).toEqual([bottom, middle, top])
  })

  it('lowers a track by one row', () => {
    const { result } = mountActions()

    act(() => result.current.moveTrackDown(middle))

    // Display order [top, middle, bottom] becomes [top, bottom, middle].
    expect(reorderTracks).toHaveBeenCalledWith([middle, bottom, top])
    expect(storeOrder()).toEqual([middle, bottom, top])
  })

  it('leaves the bottom track where it is', () => {
    const { result } = mountActions()

    act(() => result.current.moveTrackDown(bottom))

    expect(reorderTracks).not.toHaveBeenCalled()
    expect(storeOrder()).toEqual([bottom, middle, top])
  })

  it('ignores raising a track that is not on the timeline', () => {
    const { result } = mountActions()

    act(() => result.current.moveTrackUp('gone'))

    // findIndex returns -1, which `<= 0` already reads as "at the top".
    expect(reorderTracks).not.toHaveBeenCalled()
    expect(storeOrder()).toEqual([bottom, middle, top])
  })

  it('ignores lowering a track that is not on the timeline', () => {
    const { result } = mountActions()

    act(() => result.current.moveTrackDown('gone'))

    // findIndex returns -1, which the guard reads as "no such row" rather than
    // letting the swap write the top row's id to index -1 and lose a track.
    expect(reorderTracks).not.toHaveBeenCalled()
    expect(storeOrder()).toEqual([bottom, middle, top])
  })

  it('takes a track all the way up one row at a time', () => {
    const { result } = mountActions()

    act(() => result.current.moveTrackUp(bottom))
    act(() => result.current.moveTrackUp(bottom))

    expect(storeOrder()).toEqual([middle, top, bottom])
  })
})

describe('useTrackHeaderActions deleting', () => {
  it('deletes an empty track without asking', () => {
    const { result } = mountActions()

    act(() => result.current.handleDeleteTrack(middle))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(removeTrack).toHaveBeenCalledWith(middle)
    expect(storeOrder()).toEqual([bottom, top])
  })

  it('asks before deleting a track that still holds clips', () => {
    addClip('clip1', 0, 2, middle)
    addClip('clip2', 4, 2, middle)
    const { result } = mountActions()

    act(() => result.current.handleDeleteTrack(middle))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete track with 2 clip(s)? This cannot be undone.'
    )
    expect(removeTrack).toHaveBeenCalledWith(middle)
  })

  it('keeps the track when the question is answered no', () => {
    addClip('clip1', 0, 2, middle)
    confirmSpy.mockReturnValue(false)
    const { result } = mountActions()

    act(() => result.current.handleDeleteTrack(middle))

    expect(removeTrack).not.toHaveBeenCalled()
    expect(storeOrder()).toEqual([bottom, middle, top])
  })

  // ESCSUITE-84: the hook asks its question and calls through either way —
  // the store is the authority, and it keeps the track and its clips.
  it('leaves a locked track and its clips where they are', () => {
    addClip('clip1', 0, 2, middle)
    store().updateTrack(middle, { locked: true })
    const { result } = mountActions()

    act(() => result.current.handleDeleteTrack(middle))

    expect(removeTrack).toHaveBeenCalledWith(middle)
    expect(storeOrder()).toEqual([bottom, middle, top])
    expect(useEditorStore.getState().project.timeline.clips.map((c) => c.id)).toEqual(['clip1'])
  })

  it('refuses to delete the last track', () => {
    const { result } = mountActions()
    act(() => result.current.handleDeleteTrack(middle))
    act(() => result.current.handleDeleteTrack(top))
    removeTrack.mockClear()

    act(() => result.current.handleDeleteTrack(bottom))

    expect(removeTrack).not.toHaveBeenCalled()
    expect(storeOrder()).toEqual([bottom])
  })
})
