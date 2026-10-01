import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useEditorStore } from './projectStore'
import type { SourceVideo } from './types'
import { addClip, resetStoreForTest, store, video } from '../test/fixtures/projectStore'

describe('projectStore integration', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useEditorStore.getState().resetProject()
    // Clear history after reset
    useEditorStore.setState({ history: { past: [], future: [] } })
  })

  describe('source video management', () => {
    it('adds a source video', () => {
      const video: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      useEditorStore.getState().addSourceVideo(video)

      const state = useEditorStore.getState()
      expect(state.sourceVideos).toHaveLength(1)
      expect(state.sourceVideos[0].id).toBe('video1')
      expect(state.sourceVideos[0].name).toBe('test.mp4')
    })

    it('replaces a source video whose id it already holds, rather than listing it twice', () => {
      const video: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      useEditorStore.getState().addSourceVideo(video)
      useEditorStore.getState().addSourceVideo({ ...video, name: 'renamed.mp4', duration: 42 })

      // Source videos are keyed by id everywhere downstream — the media library renders
      // one element per id, and every clip names the source it plays by id — so a second
      // entry under an id the store already holds is never the media the caller meant to
      // add. It is the same media, seen again: keep one entry, carrying the newer metadata.
      const state = useEditorStore.getState()
      expect(state.sourceVideos).toHaveLength(1)
      expect(state.sourceVideos[0]).toMatchObject({ id: 'video1', name: 'renamed.mp4', duration: 42 })
    })

    it('keeps the order of the other source videos when it replaces one', () => {
      const make = (id: string): SourceVideo => ({
        id,
        name: `${id}.mp4`,
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      })

      useEditorStore.getState().addSourceVideo(make('a'))
      useEditorStore.getState().addSourceVideo(make('b'))
      useEditorStore.getState().addSourceVideo(make('c'))
      useEditorStore.getState().addSourceVideo({ ...make('b'), name: 'b-again.mp4' })

      expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).toEqual(['a', 'b', 'c'])
      expect(useEditorStore.getState().sourceVideos[1].name).toBe('b-again.mp4')
    })

    describe('a re-add that changes nothing', () => {
      // A restored session overlapping the library re-adds media the store
      // already holds, field for field. That is not an edit, so it must not
      // land on the undo stack — an undo that restores an identical library
      // looks to the user like undo did nothing.
      const sameVideo = (): SourceVideo => ({
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
        thumbnailUrl: 'blob:thumb',
        waveformData: [
          { min: -1, max: 1 },
          { min: 0, max: 0.5 },
        ],
      })

      it('leaves the library and the undo history untouched', () => {
        useEditorStore.getState().addSourceVideo(sameVideo())
        const { sourceVideos, history } = useEditorStore.getState()

        // A fresh object with the same contents, down to a new waveform array.
        useEditorStore.getState().addSourceVideo(sameVideo())

        const after = useEditorStore.getState()
        expect(after.history.past).toHaveLength(history.past.length)
        expect(after.sourceVideos).toBe(sourceVideos)
      })

      const realChanges: [string, Partial<SourceVideo>][] = [
        ['a renamed file', { name: 'renamed.mp4' }],
        ['a fresh thumbnail', { thumbnailUrl: 'blob:newer' }],
        ['a re-read duration', { duration: 42 }],
        ['re-analysed audio', { waveformData: [{ min: -0.5, max: 0.5 }, { min: 0, max: 0.5 }] }],
        ['a shorter waveform', { waveformData: [{ min: -1, max: 1 }] }],
        ['no waveform at all', { waveformData: undefined }],
      ]

      it.each(realChanges)('still replaces and records a step for %s', (_label, change) => {
        useEditorStore.getState().addSourceVideo(sameVideo())
        const before = useEditorStore.getState().history.past.length

        useEditorStore.getState().addSourceVideo({ ...sameVideo(), ...change })

        const after = useEditorStore.getState()
        expect(after.history.past).toHaveLength(before + 1)
        expect(after.sourceVideos).toHaveLength(1)
        expect(after.sourceVideos[0]).toMatchObject(change)
      })

      // ESCSUITE-113 (review round 2): a replace-in-place is the one way a
      // source's thumbnailUrl changes without the source itself ever leaving
      // the library — addSourceVideo owns freeing the URL it replaces, but
      // only when it actually changes.
      describe('revoking the replaced thumbnail', () => {
        beforeEach(() => {
          vi.mocked(URL.revokeObjectURL).mockClear()
        })

        it('does not revoke when a changed re-add keeps the same thumbnail URL', () => {
          useEditorStore.getState().addSourceVideo(sameVideo())

          useEditorStore.getState().addSourceVideo({ ...sameVideo(), name: 'renamed.mp4' })

          expect(URL.revokeObjectURL).not.toHaveBeenCalled()
        })

        it('revokes the previous thumbnail URL exactly once when a re-add carries a new one', () => {
          useEditorStore.getState().addSourceVideo(sameVideo())

          useEditorStore.getState().addSourceVideo({ ...sameVideo(), thumbnailUrl: 'blob:newer' })

          expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
          expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb')
        })

        // Undo/redo never revoke on their own, but the history entry this
        // replace pushed captured the source with its old (now-dead)
        // 'blob:thumb' — scrubDeadThumbnails is what stops undo from handing
        // it back.
        it('does not revoke again on undo, and undo brings the source back with no thumbnail rather than the dead handle', () => {
          useEditorStore.getState().addSourceVideo(sameVideo())
          useEditorStore.getState().addSourceVideo({ ...sameVideo(), thumbnailUrl: 'blob:newer' })
          expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
          vi.mocked(URL.revokeObjectURL).mockClear()

          useEditorStore.getState().undo()

          expect(URL.revokeObjectURL).not.toHaveBeenCalled()
          const restored = useEditorStore.getState().sourceVideos.find((v) => v.id === 'video1')
          expect(restored).toBeDefined()
          expect(restored?.thumbnailUrl).toBeUndefined()
        })
      })
    })

    it('removes a source video', () => {
      const video: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      useEditorStore.getState().addSourceVideo(video)
      expect(useEditorStore.getState().sourceVideos).toHaveLength(1)

      useEditorStore.getState().removeSourceVideo('video1')
      expect(useEditorStore.getState().sourceVideos).toHaveLength(0)
    })

    // ESCSUITE-113: the removed source's thumbnailUrl is a live
    // URL.createObjectURL handle, and nothing else was ever going to free it.
    describe('revoking the removed source\'s thumbnail', () => {
      beforeEach(() => {
        vi.mocked(URL.revokeObjectURL).mockClear()
      })

      it('revokes it exactly once', () => {
        useEditorStore.getState().addSourceVideo({
          id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
          frameRate: 30, mimeType: 'video/mp4', size: 1000000, thumbnailUrl: 'blob:thumb-1',
        })

        useEditorStore.getState().removeSourceVideo('video1')

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1')
      })

      it('does nothing when the removed source has no thumbnail', () => {
        useEditorStore.getState().addSourceVideo({
          id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
          frameRate: 30, mimeType: 'video/mp4', size: 1000000,
        })

        useEditorStore.getState().removeSourceVideo('video1')

        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      })

      it('does not touch a non-blob thumbnail URL', () => {
        useEditorStore.getState().addSourceVideo({
          id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
          frameRate: 30, mimeType: 'video/mp4', size: 1000000,
          thumbnailUrl: 'https://example.com/thumb.jpg',
        })

        useEditorStore.getState().removeSourceVideo('video1')

        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      })

      it('leaves a kept source\'s thumbnail alone', () => {
        useEditorStore.getState().addSourceVideo({
          id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
          frameRate: 30, mimeType: 'video/mp4', size: 1000000, thumbnailUrl: 'blob:removed',
        })
        useEditorStore.getState().addSourceVideo({
          id: 'video2', name: 'kept.mp4', duration: 10, width: 1920, height: 1080,
          frameRate: 30, mimeType: 'video/mp4', size: 1000000, thumbnailUrl: 'blob:kept',
        })

        useEditorStore.getState().removeSourceVideo('video1')

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:removed')
      })

      // Undo/redo never revoke on their own — a source coming back via redo
      // still needs its URL to work — but a removal's own revoke must not
      // leave a *later* undo handing that source back a handle nothing can
      // open (ESCSUITE-113): the history snapshot removeSourceVideo just
      // pushed is scrubbed of that same dead URL.
      it('does not revoke again on undo, and undo brings the source back with no thumbnail rather than a dead one', () => {
        useEditorStore.getState().addSourceVideo({
          id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
          frameRate: 30, mimeType: 'video/mp4', size: 1000000, thumbnailUrl: 'blob:thumb-1',
        })
        useEditorStore.getState().removeSourceVideo('video1')
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
        vi.mocked(URL.revokeObjectURL).mockClear()

        useEditorStore.getState().undo()

        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
        const restored = useEditorStore.getState().sourceVideos.find((v) => v.id === 'video1')
        expect(restored).toBeDefined()
        expect(restored?.thumbnailUrl).toBeUndefined()
      })

      // An id naming no source is a no-op, not an edit (ESCSUITE-113 review
      // round 2): nothing to revoke, and nothing else changes either.
      it('does nothing for an id naming no source', () => {
        useEditorStore.getState().addSourceVideo({
          id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
          frameRate: 30, mimeType: 'video/mp4', size: 1000000, thumbnailUrl: 'blob:thumb-1',
        })
        const before = useEditorStore.getState()

        useEditorStore.getState().removeSourceVideo('no-such-id')

        const after = useEditorStore.getState()
        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
        expect(after.sourceVideos).toBe(before.sourceVideos)
        expect(after.history.past).toHaveLength(before.history.past.length)
      })
    })

    // ESCSUITE-100: a clipboard entry that used to point at this source can
    // never be pasted back once the source — and every clip that used it — is
    // gone, so removeSourceVideo drops it the same way removeTrack drops a
    // clipboard entry for a track it removes.
    it('drops clipboard entries that reference the source it removes', () => {
      const removed: SourceVideo = {
        id: 'removed-video',
        name: 'removed.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }
      useEditorStore.getState().addSourceVideo({
        id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
        frameRate: 30, mimeType: 'video/mp4', size: 1000000,
      })
      useEditorStore.getState().addSourceVideo(removed)
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline(
        { id: 'clip-kept', sourceVideoId: 'video1', name: 'Kept', startTime: 0, endTime: 5, duration: 5 },
        trackId, 0
      )
      useEditorStore.getState().addClipToTimeline(
        { id: 'clip-removed', sourceVideoId: 'removed-video', name: 'Removed', startTime: 0, endTime: 5, duration: 5 },
        trackId, 5
      )

      useEditorStore.getState().toggleClipSelection('clip-kept')
      useEditorStore.getState().toggleClipSelection('clip-removed')
      useEditorStore.getState().copySelectedClips()
      expect(useEditorStore.getState().clipboard).toHaveLength(2)

      useEditorStore.getState().removeSourceVideo('removed-video')

      const clipboard = useEditorStore.getState().clipboard!
      expect(clipboard).toHaveLength(1)
      expect(clipboard[0].id).toBe('clip-kept')
    })

    it('leaves the clipboard untouched when nothing copied used the removed source', () => {
      const removed: SourceVideo = {
        id: 'removed-video',
        name: 'removed.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }
      useEditorStore.getState().addSourceVideo({
        id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
        frameRate: 30, mimeType: 'video/mp4', size: 1000000,
      })
      useEditorStore.getState().addSourceVideo(removed)
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id

      useEditorStore.getState().addClipToTimeline(
        { id: 'clip-kept', sourceVideoId: 'video1', name: 'Kept', startTime: 0, endTime: 5, duration: 5 },
        trackId, 0
      )
      useEditorStore.getState().toggleClipSelection('clip-kept')
      useEditorStore.getState().copySelectedClips()
      const clipboardBefore = useEditorStore.getState().clipboard

      useEditorStore.getState().removeSourceVideo('removed-video')

      expect(useEditorStore.getState().clipboard).toBe(clipboardBefore)
    })

    // ESCSUITE-117: a source restored by undo carries `thumbnailUrl:
    // undefined` — ESCSUITE-113 scrubbed the dead handle out of the history
    // snapshots (pinned by resetProject's "undo brings the source back with no
    // thumbnail rather than a dead one" below) — so the media library rebuilds
    // it from storage and hands it back through here. A rebuilt thumbnail is
    // not an edit: it records no undo step.
    describe('setSourceThumbnail', () => {
      const thumbless = (overrides: Partial<SourceVideo> = {}): SourceVideo => ({
        id: 'video1', name: 'test.mp4', duration: 10, width: 1920, height: 1080,
        frameRate: 30, mimeType: 'video/mp4', size: 1000000, ...overrides,
      })

      it('sets the thumbnail URL on the matching source', () => {
        useEditorStore.getState().addSourceVideo(thumbless())

        useEditorStore.getState().setSourceThumbnail('video1', 'blob:rebuilt')

        expect(useEditorStore.getState().sourceVideos[0].thumbnailUrl).toBe('blob:rebuilt')
      })

      it('records no undo step', () => {
        useEditorStore.getState().addSourceVideo(thumbless())
        const before = useEditorStore.getState().history.past.length

        useEditorStore.getState().setSourceThumbnail('video1', 'blob:rebuilt')

        expect(useEditorStore.getState().history.past).toHaveLength(before)
      })

      it('leaves every other source alone', () => {
        useEditorStore.getState().addSourceVideo(thumbless())
        useEditorStore.getState().addSourceVideo(thumbless({ id: 'video2', name: 'other.mp4' }))

        useEditorStore.getState().setSourceThumbnail('video2', 'blob:rebuilt')

        const sources = useEditorStore.getState().sourceVideos
        expect(sources.find((v) => v.id === 'video1')?.thumbnailUrl).toBeUndefined()
        expect(sources.find((v) => v.id === 'video2')?.thumbnailUrl).toBe('blob:rebuilt')
      })

      it('is a no-op for an id naming no source, and does not revoke what it was handed', () => {
        useEditorStore.getState().addSourceVideo(thumbless())
        const before = useEditorStore.getState()
        vi.mocked(URL.revokeObjectURL).mockClear()

        useEditorStore.getState().setSourceThumbnail('no-such-video', 'blob:rebuilt')

        // The caller owns a handle for a source that is gone; it revokes that
        // itself (it knows whether the source left or the read simply lost a
        // race), so this must not free it underneath.
        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
        expect(useEditorStore.getState().sourceVideos).toBe(before.sourceVideos)
        expect(useEditorStore.getState().history.past).toHaveLength(before.history.past.length)
      })

      // The rebuild raced a real load — an import, or a session restore — that
      // put a live handle on the source while the read was in flight. The
      // library's is the one on screen, so the incoming one is freed rather
      // than replacing it.
      it('revokes the incoming URL and changes nothing when the source already has a different live one', () => {
        useEditorStore.getState().addSourceVideo(thumbless({ thumbnailUrl: 'blob:live' }))
        const before = useEditorStore.getState()
        vi.mocked(URL.revokeObjectURL).mockClear()

        useEditorStore.getState().setSourceThumbnail('video1', 'blob:rebuilt')

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rebuilt')
        expect(useEditorStore.getState().sourceVideos).toBe(before.sourceVideos)
        expect(useEditorStore.getState().sourceVideos[0].thumbnailUrl).toBe('blob:live')
      })

      it('changes nothing, and revokes nothing, when the source already has that same URL', () => {
        useEditorStore.getState().addSourceVideo(thumbless({ thumbnailUrl: 'blob:rebuilt' }))
        const before = useEditorStore.getState()
        vi.mocked(URL.revokeObjectURL).mockClear()

        useEditorStore.getState().setSourceThumbnail('video1', 'blob:rebuilt')

        // Revoking here would kill the handle the library is showing.
        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
        expect(useEditorStore.getState().sourceVideos).toBe(before.sourceVideos)
      })
    })

    // ESCSUITE-149: a storage clear (Clear Unused / Clear All) deletes the
    // source's bytes from IndexedDB itself, so it must not be undoable the way
    // `removeSourceVideo` is — an undo that handed a `SourceVideo` back after
    // this would restore a tile nothing can play, place or export. Modelled on
    // ESCSUITE-117's `setSourceThumbnail`: it bypasses `pushToHistory`
    // entirely, and — because the clear can reach back past edits that are
    // already on the undo stack — it also scrubs every existing snapshot
    // (`scrubRemovedSources`) so no future undo/redo can resurrect the ids.
    describe('removeSourceVideosPermanently', () => {
      const made = (id: string, overrides: Partial<SourceVideo> = {}): SourceVideo => ({
        id, name: `${id}.mp4`, duration: 10, width: 1920, height: 1080,
        frameRate: 30, mimeType: 'video/mp4', size: 1000000, ...overrides,
      })

      beforeEach(() => {
        vi.mocked(URL.revokeObjectURL).mockClear()
      })

      it('removes every named source in one write', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))
        useEditorStore.getState().addSourceVideo(made('video2'))
        useEditorStore.getState().addSourceVideo(made('video3'))

        useEditorStore.getState().removeSourceVideosPermanently(['video1', 'video2'])

        expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).toEqual(['video3'])
      })

      it('revokes every removed source\'s thumbnail URL', () => {
        useEditorStore.getState().addSourceVideo(made('video1', { thumbnailUrl: 'blob:thumb-1' }))
        useEditorStore.getState().addSourceVideo(made('video2', { thumbnailUrl: 'blob:thumb-2' }))

        useEditorStore.getState().removeSourceVideosPermanently(['video1', 'video2'])

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1')
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-2')
      })

      it('removes any clip that references a removed source, and recalculates duration', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))
        const trackId = useEditorStore.getState().project.timeline.tracks[0].id
        useEditorStore.getState().addClipToTimeline(
          { id: 'clip1', sourceVideoId: 'video1', name: 'Clip1', startTime: 0, endTime: 5, duration: 5 },
          trackId, 0
        )

        useEditorStore.getState().removeSourceVideosPermanently(['video1'])

        const state = useEditorStore.getState()
        expect(state.project.timeline.clips).toHaveLength(0)
        expect(state.project.timeline.duration).toBe(0)
      })

      it('leaves a clip that references a kept source alone', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))
        useEditorStore.getState().addSourceVideo(made('video2'))
        const trackId = useEditorStore.getState().project.timeline.tracks[0].id
        useEditorStore.getState().addClipToTimeline(
          { id: 'clip1', sourceVideoId: 'video2', name: 'Clip1', startTime: 0, endTime: 5, duration: 5 },
          trackId, 0
        )

        useEditorStore.getState().removeSourceVideosPermanently(['video1'])

        expect(useEditorStore.getState().project.timeline.clips.map((c) => c.id)).toEqual(['clip1'])
      })

      it('prunes the selection when the selected clip\'s source is removed (ESCSUITE-101)', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))
        const trackId = useEditorStore.getState().project.timeline.tracks[0].id
        useEditorStore.getState().addClipToTimeline(
          { id: 'clip1', sourceVideoId: 'video1', name: 'Clip1', startTime: 0, endTime: 5, duration: 5 },
          trackId, 0
        )
        useEditorStore.getState().setSelectedClipId('clip1')

        useEditorStore.getState().removeSourceVideosPermanently(['video1'])

        expect(useEditorStore.getState().selectedClipId).toBeNull()
      })

      it('records no undo step of its own', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))
        const before = useEditorStore.getState().history.past.length

        useEditorStore.getState().removeSourceVideosPermanently(['video1'])

        expect(useEditorStore.getState().history.past).toHaveLength(before)
      })

      it('is a no-op for an empty id list', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))
        const before = useEditorStore.getState()

        useEditorStore.getState().removeSourceVideosPermanently([])

        expect(useEditorStore.getState().sourceVideos).toBe(before.sourceVideos)
        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      })

      it('ignores an id naming no source without affecting the rest', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))

        useEditorStore.getState().removeSourceVideosPermanently(['no-such-id', 'video1'])

        expect(useEditorStore.getState().sourceVideos).toHaveLength(0)
      })

      // The headline bug: an undo entry already on the stack before the clear
      // must not be able to hand the cleared source back.
      it('scrubs the removed ids out of every existing undo snapshot, so undo cannot restore them', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))
        const pastLengthBeforeClear = useEditorStore.getState().history.past.length
        expect(pastLengthBeforeClear).toBeGreaterThan(0)

        useEditorStore.getState().removeSourceVideosPermanently(['video1'])

        // No new entry, and canUndo() reflects the history exactly as it
        // stood before the clear.
        expect(useEditorStore.getState().history.past).toHaveLength(pastLengthBeforeClear)
        expect(useEditorStore.getState().canUndo()).toBe(true)

        useEditorStore.getState().undo()

        expect(useEditorStore.getState().sourceVideos.find((v) => v.id === 'video1')).toBeUndefined()
      })

      it('scrubs a clip referencing the removed source out of an existing undo snapshot too', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))
        const trackId = useEditorStore.getState().project.timeline.tracks[0].id
        useEditorStore.getState().addClipToTimeline(
          { id: 'clip1', sourceVideoId: 'video1', name: 'Clip1', startTime: 0, endTime: 5, duration: 5 },
          trackId, 0
        )

        useEditorStore.getState().removeSourceVideosPermanently(['video1'])
        // The one snapshot on the stack is the one taken just before
        // `addClipToTimeline` — the source is there, the clip is not yet.
        useEditorStore.getState().undo()

        const state = useEditorStore.getState()
        expect(state.sourceVideos.find((v) => v.id === 'video1')).toBeUndefined()
        expect(state.project.timeline.clips.some((c) => c.sourceVideoId === 'video1')).toBe(false)
      })

      // A plain, single-item removal is a different action and must stay
      // undoable — pin it here so the two paths cannot be confused with one
      // another.
      it('does not change what a plain removeSourceVideo does: that stays undoable', () => {
        useEditorStore.getState().addSourceVideo(made('video1'))

        useEditorStore.getState().removeSourceVideo('video1')
        expect(useEditorStore.getState().sourceVideos).toHaveLength(0)

        useEditorStore.getState().undo()
        expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).toEqual(['video1'])
      })
    })
  })

  describe('undo/redo', () => {
    it('can undo an action', () => {
      const video: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      useEditorStore.getState().addSourceVideo(video)
      expect(useEditorStore.getState().sourceVideos).toHaveLength(1)

      useEditorStore.getState().undo()
      expect(useEditorStore.getState().sourceVideos).toHaveLength(0)
    })

    it('can redo an undone action', () => {
      const video: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      useEditorStore.getState().addSourceVideo(video)
      useEditorStore.getState().undo()
      expect(useEditorStore.getState().sourceVideos).toHaveLength(0)

      useEditorStore.getState().redo()
      expect(useEditorStore.getState().sourceVideos).toHaveLength(1)
    })

    it('clears future history when new action is taken after undo', () => {
      const video1: SourceVideo = {
        id: 'video1',
        name: 'test1.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      const video2: SourceVideo = {
        id: 'video2',
        name: 'test2.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }

      useEditorStore.getState().addSourceVideo(video1)
      useEditorStore.getState().undo()

      // Future should have the video1 action
      expect(useEditorStore.getState().history.future).toHaveLength(1)

      // Add a different video - should clear future
      useEditorStore.getState().addSourceVideo(video2)
      expect(useEditorStore.getState().history.future).toHaveLength(0)
    })
  })

  // ESCSUITE-101: paste selects the new clip; undo removes it from the
  // timeline without telling the selection; Delete then found a selection
  // that still named it, deleted nothing, and pushed an undo entry anyway —
  // which cleared the redo stack `undo` had just built and left the past
  // one entry longer for no real edit. The fix is `pruneSelection` running
  // inside `undo` (so the ghost id is already gone by the time Delete asks)
  // and `deleteSelectedClips` itself refusing a selection of nothing but
  // ghosts, belt-and-braces, the same shape as `pasteClips`'s own guards.
  describe('paste, undo, then Delete (ESCSUITE-101)', () => {
    it('keeps canRedo() true and pushes no history entry when Delete finds only ghosts', () => {
      resetStoreForTest()
      addClip('clip1', 0, 2)
      store().toggleClipSelection('clip1')
      store().copySelectedClips()

      store().pasteClips()
      const pastedId = [...store().selectedClipIds][0]
      expect(store().project.timeline.clips.some((c) => c.id === pastedId)).toBe(true)

      store().undo()
      expect(store().project.timeline.clips.some((c) => c.id === pastedId)).toBe(false)
      expect(store().canRedo()).toBe(true)

      const pastLength = store().history.past.length

      store().deleteSelectedClips()

      expect(store().canRedo()).toBe(true)
      expect(store().history.past.length).toBe(pastLength)
    })
  })

  describe('playback controls', () => {
    it('sets current time', () => {
      useEditorStore.getState().setCurrentTime(5.5)
      expect(useEditorStore.getState().currentTime).toBe(5.5)
    })

    it('toggles play state', () => {
      expect(useEditorStore.getState().isPlaying).toBe(false)

      useEditorStore.getState().setIsPlaying(true)
      expect(useEditorStore.getState().isPlaying).toBe(true)

      useEditorStore.getState().setIsPlaying(false)
      expect(useEditorStore.getState().isPlaying).toBe(false)
    })
  })

  describe('selection', () => {
    it('selects and deselects clips', () => {
      useEditorStore.getState().setSelectedClipId('clip1')
      expect(useEditorStore.getState().selectedClipId).toBe('clip1')

      useEditorStore.getState().setSelectedClipId(null)
      expect(useEditorStore.getState().selectedClipId).toBeNull()
    })

    it('selects and deselects tracks', () => {
      useEditorStore.getState().setSelectedTrackId('track1')
      expect(useEditorStore.getState().selectedTrackId).toBe('track1')

      useEditorStore.getState().setSelectedTrackId(null)
      expect(useEditorStore.getState().selectedTrackId).toBeNull()
    })

    // Selecting a clip used to also clear a separate overlay selection, which the
    // deleted OverlayEditor was the only thing that ever set. Nothing selects an
    // overlay any more: overlays are clips, so `selectedClipId` is the whole of it.
    it('touches no overlay-selection state, which no longer exists', () => {
      useEditorStore.getState().setSelectedClipId('clip1')
      const state = useEditorStore.getState() as unknown as Record<string, unknown>

      expect('selectedOverlayId' in state).toBe(false)
      expect('selectedOverlayType' in state).toBe(false)
      expect('setSelectedOverlay' in state).toBe(false)
      expect(state.selectedClipId).toBe('clip1')
      expect(state.selectedClipIds).toEqual(new Set())
    })
  })

  describe('zoom and snap', () => {
    it('sets zoom level', () => {
      useEditorStore.getState().setZoom(2)
      expect(useEditorStore.getState().zoom).toBe(2)
    })

    it('clamps zoom to valid range', () => {
      useEditorStore.getState().setZoom(0.01)
      expect(useEditorStore.getState().zoom).toBe(0.1) // Min zoom

      useEditorStore.getState().setZoom(100)
      expect(useEditorStore.getState().zoom).toBe(10) // Max zoom
    })

    it('toggles snap', () => {
      expect(useEditorStore.getState().snapEnabled).toBe(true)

      useEditorStore.getState().setSnapEnabled(false)
      expect(useEditorStore.getState().snapEnabled).toBe(false)
    })
  })

  describe('clip transform', () => {
    const mockVideo: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }

    beforeEach(() => {
      useEditorStore.getState().addSourceVideo(mockVideo)
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)
    })

    it('updates clip transform', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipTransform(clipId, {
        x: 0.25,
        y: 0.75,
        scaleX: 0.5,
        opacity: 0.8,
      })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.transform.x).toBe(0.25)
      expect(clip.transform.y).toBe(0.75)
      expect(clip.transform.scaleX).toBe(0.5)
      expect(clip.transform.opacity).toBe(0.8)
    })

    it('updates clip blend mode', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipBlendMode(clipId, 'multiply')

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.blendMode).toBe('multiply')
    })

    it('updates clip effects', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipEffects(clipId, { blur: 10 })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.effects.blur).toBe(10)
    })

    it('updates clip transition', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipTransition(clipId, {
        type: 'fade',
        duration: 1,
      })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.transition.type).toBe('fade')
      expect(clip.transition.duration).toBe(1)
    })

    // A foreign or hand-edited project file can carry a clip with no `transition` at all —
    // `Clip.transition` is required, but `loadProject` validates only the version number, and
    // the migration backfill runs only when tracks or the legacy overlay arrays are missing.
    // Picking a type for such a clip must not write a transition without a duration:
    // `TransitionSection` renders `transition.duration.toFixed(1)`, which throws on undefined.
    it('seeds the default transition when the clip carries none, so the duration is never lost', () => {
      const state = useEditorStore.getState()
      const legacyClip: Partial<Clip> = { ...state.project.timeline.clips[0] }
      delete legacyClip.transition
      useEditorStore.setState({
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            clips: [legacyClip as Clip],
          },
        },
      })
      const clipId = useEditorStore.getState().project.timeline.clips[0].id

      useEditorStore.getState().updateClipTransition(clipId, { type: 'fade' })

      const clip = useEditorStore.getState().project.timeline.clips[0]
      expect(clip.transition.type).toBe('fade')
      expect(typeof clip.transition.duration).toBe('number')
      expect(clip.transition.duration).toBe(0.5)
    })
  })

  describe('overlay clips', () => {
    it('adds text overlay clip', () => {
      const clip = useEditorStore.getState().addTextOverlayClip({
        text: 'Hello World',
      })!

      expect(clip.overlayType).toBe('text')
      expect(clip.textData?.text).toBe('Hello World')
      expect(clip.sourceVideoId).toBe('') // Empty for overlays
    })

    it('adds shape overlay clip', () => {
      const clip = useEditorStore.getState().addShapeOverlayClip({
        type: 'ellipse',
      })!

      expect(clip.overlayType).toBe('shape')
      expect(clip.shapeData?.type).toBe('ellipse')
      expect(clip.name).toBe('Ellipse')
    })

    it('updates text overlay data', () => {
      const clip = useEditorStore.getState().addTextOverlayClip({
        text: 'Original',
      })!

      useEditorStore.getState().updateTextOverlayData(clip.id, {
        text: 'Updated',
        fontSize: 72,
      })

      const updated = useEditorStore.getState().project.timeline.clips[0]
      expect(updated.textData?.text).toBe('Updated')
      expect(updated.textData?.fontSize).toBe(72)
    })

    it('updates shape overlay data', () => {
      const clip = useEditorStore.getState().addShapeOverlayClip({
        type: 'rectangle',
      })!

      useEditorStore.getState().updateShapeOverlayData(clip.id, {
        fillColor: '#ff0000ff',
        blurAmount: 10,
      })

      const updated = useEditorStore.getState().project.timeline.clips[0]
      expect(updated.shapeData?.fillColor).toBe('#ff0000ff')
      expect(updated.shapeData?.blurAmount).toBe(10)
    })

    describe('a locked track (ESCSUITE-84)', () => {
      const past = () => useEditorStore.getState().history.past.length
      const clipsRef = () => useEditorStore.getState().project.timeline.clips

      /** Assert the action wrote nothing: same clips array, no history entry. */
      const refuses = (act: () => void) => {
        const before = clipsRef(); const entries = past()
        act()
        expect(clipsRef()).toBe(before)
        expect(past()).toBe(entries)
      }

      it('adds no text overlay to an explicit locked track', () => {
        const lockedId = useEditorStore.getState().project.timeline.tracks[0].id
        useEditorStore.getState().updateTrack(lockedId, { locked: true })

        let clip: unknown
        refuses(() => { clip = useEditorStore.getState().addTextOverlayClip(undefined, lockedId) })
        expect(clip).toBeNull()
      })

      it('adds no shape overlay to an explicit locked track', () => {
        const lockedId = useEditorStore.getState().project.timeline.tracks[0].id
        useEditorStore.getState().updateTrack(lockedId, { locked: true })

        let clip: unknown
        refuses(() => { clip = useEditorStore.getState().addShapeOverlayClip({ type: 'rectangle' }, lockedId) })
        expect(clip).toBeNull()
      })

      it('refuses to update text overlay data once its track is locked, and says so', () => {
        const clip = useEditorStore.getState().addTextOverlayClip({ text: 'Hi' })!
        useEditorStore.getState().updateTrack(clip.trackId, { locked: true })

        // ESCSUITE-87: `false` back to the caller, not just an untouched state.
        refuses(() => expect(
          useEditorStore.getState().updateTextOverlayData(clip.id, { text: 'Bye' })
        ).toBe(false))
      })

      it('refuses to update shape overlay data once its track is locked, and says so', () => {
        const clip = useEditorStore.getState().addShapeOverlayClip({ type: 'rectangle' })!
        useEditorStore.getState().updateTrack(clip.trackId, { locked: true })

        refuses(() => expect(
          useEditorStore.getState().updateShapeOverlayData(clip.id, { fillColor: '#ff0000ff' })
        ).toBe(false))
      })

      // ESCSUITE-87's other half: a write that landed reports `true`, so a
      // gesture can tell the two apart.
      it('reports true when the overlay data really was written', () => {
        const text = useEditorStore.getState().addTextOverlayClip({ text: 'Hi' })!
        const shape = useEditorStore.getState().addShapeOverlayClip({ type: 'rectangle' })!

        expect(useEditorStore.getState().updateTextOverlayData(text.id, { text: 'Bye' })).toBe(true)
        expect(useEditorStore.getState().updateShapeOverlayData(shape.id, { fillColor: '#ff0000ff' })).toBe(true)
      })

      it('lands a text overlay on a new track when the only empty track is locked', () => {
        const lockedId = useEditorStore.getState().project.timeline.tracks[0].id
        useEditorStore.getState().updateTrack(lockedId, { locked: true })

        const clip = useEditorStore.getState().addTextOverlayClip()

        expect(clip).not.toBeNull()
        expect(clip!.trackId).not.toBe(lockedId)
        expect(useEditorStore.getState().project.timeline.tracks).toHaveLength(2)
      })
    })
  })
})

// Test helper functions
import {
  getClipsAtTime,
  getClipAtTime,
  getClipPosition,
  selectTimelineDuration,
  selectClipCount,
  selectSelectedClip,
  selectSelectedTrack,
} from './projectStore'
import type { Clip, Track } from './types'

describe('projectStore helper functions', () => {
  const createMockClip = (id: string, trackId: string, position: number, duration: number): Clip => ({
    id,
    sourceVideoId: 'video1',
    name: `Clip ${id}`,
    startTime: 0,
    endTime: duration,
    duration,
    trackId,
    timelinePosition: position,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
  })

  const createMockTrack = (id: string, index: number, visible = true): Track => ({
    id,
    name: `Track ${index + 1}`,
    index,
    visible,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
  })

  describe('getClipsAtTime', () => {
    it('returns clips at the given time', () => {
      const tracks = [createMockTrack('t1', 0), createMockTrack('t2', 1)]
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't2', 2, 5),
      ]

      const result = getClipsAtTime(clips, tracks, 3)

      expect(result).toHaveLength(2)
      expect(result[0].clip.id).toBe('c1')
      expect(result[1].clip.id).toBe('c2')
    })

    it('excludes clips on hidden tracks', () => {
      const tracks = [createMockTrack('t1', 0), createMockTrack('t2', 1, false)]
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't2', 0, 5),
      ]

      const result = getClipsAtTime(clips, tracks, 2)

      expect(result).toHaveLength(1)
      expect(result[0].clip.id).toBe('c1')
    })

    it('sorts by track index', () => {
      const tracks = [createMockTrack('t1', 1), createMockTrack('t2', 0)]
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't2', 0, 5),
      ]

      const result = getClipsAtTime(clips, tracks, 2)

      expect(result[0].clip.trackId).toBe('t2') // Lower index first
      expect(result[1].clip.trackId).toBe('t1')
    })

    it('calculates clipTime correctly', () => {
      const tracks = [createMockTrack('t1', 0)]
      const clips = [createMockClip('c1', 't1', 5, 10)]

      const result = getClipsAtTime(clips, tracks, 8)

      expect(result[0].clipTime).toBe(3) // 8 - 5
    })
  })

  describe('getClipAtTime', () => {
    it('returns the clip at the given time', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 5, 5),
      ]

      const result = getClipAtTime(clips, 3)

      expect(result?.clip.id).toBe('c1')
      expect(result?.clipTime).toBe(3)
    })

    it('returns null if no clip at time', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      const result = getClipAtTime(clips, 10)

      expect(result).toBeNull()
    })
  })

  describe('getClipPosition', () => {
    it('returns the timeline position of a clip', () => {
      const clips = [
        createMockClip('c1', 't1', 5, 10),
        createMockClip('c2', 't1', 20, 5),
      ]

      expect(getClipPosition(clips, 'c1')).toBe(5)
      expect(getClipPosition(clips, 'c2')).toBe(20)
    })

    it('returns -1 for non-existent clip', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      expect(getClipPosition(clips, 'nonexistent')).toBe(-1)
    })
  })

  describe('selectors', () => {
    beforeEach(() => {
      useEditorStore.getState().resetProject()
      useEditorStore.setState({ history: { past: [], future: [] } })
    })

    it('selectTimelineDuration returns duration', () => {
      const state = useEditorStore.getState()
      expect(selectTimelineDuration(state)).toBe(0)
    })

    it('selectClipCount returns clip count', () => {
      const state = useEditorStore.getState()
      expect(selectClipCount(state)).toBe(0)
    })

    it('selectSelectedClip returns selected clip', () => {
      const video: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }
      useEditorStore.getState().addSourceVideo(video)

      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)

      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      useEditorStore.getState().setSelectedClipId(clipId)

      const state = useEditorStore.getState()
      expect(selectSelectedClip(state)?.id).toBe(clipId)
    })

    it('selectSelectedTrack returns selected track', () => {
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().setSelectedTrackId(trackId)

      const state = useEditorStore.getState()
      expect(selectSelectedTrack(state)?.id).toBe(trackId)
    })
  })

  describe('updateClipTransform with skipHistory', () => {
    const mockVideo: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }

    beforeEach(() => {
      useEditorStore.getState().addSourceVideo(mockVideo)
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        animation: undefined,
      }, trackId, 0)
    })

    it('adds to history when skipHistory is false', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      const initialPastLength = useEditorStore.getState().history.past.length

      useEditorStore.getState().updateClipTransform(clipId, { x: 0.5 }, false)

      expect(useEditorStore.getState().history.past.length).toBe(initialPastLength + 1)
    })

    it('skips history when skipHistory is true', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      const initialPastLength = useEditorStore.getState().history.past.length

      useEditorStore.getState().updateClipTransform(clipId, { x: 0.5 }, true)

      expect(useEditorStore.getState().history.past.length).toBe(initialPastLength)
      // But the transform should still be updated
      expect(useEditorStore.getState().project.timeline.clips[0].transform.x).toBe(0.5)
    })

    it('defaults to adding history when skipHistory is undefined', () => {
      const clipId = useEditorStore.getState().project.timeline.clips[0].id
      const initialPastLength = useEditorStore.getState().history.past.length

      useEditorStore.getState().updateClipTransform(clipId, { x: 0.5 })

      expect(useEditorStore.getState().history.past.length).toBe(initialPastLength + 1)
    })
  })

  describe('markers', () => {
    beforeEach(() => {
      useEditorStore.getState().clearMarkers()
    })

    it('adds a marker', () => {
      const marker = useEditorStore.getState().addMarker(5, 'Test Marker', '#ff0000')

      expect(marker.time).toBe(5)
      expect(marker.label).toBe('Test Marker')
      expect(marker.color).toBe('#ff0000')
      expect(useEditorStore.getState().markers).toHaveLength(1)
    })

    it('adds markers in sorted order by time', () => {
      useEditorStore.getState().addMarker(10, 'Second')
      useEditorStore.getState().addMarker(5, 'First')
      useEditorStore.getState().addMarker(15, 'Third')

      const markers = useEditorStore.getState().markers
      expect(markers[0].time).toBe(5)
      expect(markers[1].time).toBe(10)
      expect(markers[2].time).toBe(15)
    })

    it('uses default values for label and color', () => {
      const marker = useEditorStore.getState().addMarker(5)

      expect(marker.label).toBe('')
      expect(marker.color).toBe('#ffcc00')
    })

    it('removes a marker', () => {
      const marker = useEditorStore.getState().addMarker(5, 'Test')
      expect(useEditorStore.getState().markers).toHaveLength(1)

      useEditorStore.getState().removeMarker(marker.id)
      expect(useEditorStore.getState().markers).toHaveLength(0)
    })

    it('updates a marker', () => {
      const marker = useEditorStore.getState().addMarker(5, 'Original')

      useEditorStore.getState().updateMarker(marker.id, { label: 'Updated', time: 10 })

      const updated = useEditorStore.getState().markers[0]
      expect(updated.label).toBe('Updated')
      expect(updated.time).toBe(10)
    })

    it('clears all markers', () => {
      useEditorStore.getState().addMarker(5, 'First')
      useEditorStore.getState().addMarker(10, 'Second')
      expect(useEditorStore.getState().markers).toHaveLength(2)

      useEditorStore.getState().clearMarkers()
      expect(useEditorStore.getState().markers).toHaveLength(0)
    })

    it('goToNextMarker moves to the next marker', () => {
      useEditorStore.getState().addMarker(5)
      useEditorStore.getState().addMarker(10)
      useEditorStore.getState().setCurrentTime(0)

      useEditorStore.getState().goToNextMarker()
      expect(useEditorStore.getState().currentTime).toBe(5)

      useEditorStore.getState().goToNextMarker()
      expect(useEditorStore.getState().currentTime).toBe(10)
    })

    it('goToNextMarker does nothing when no next marker exists', () => {
      useEditorStore.getState().addMarker(5)
      useEditorStore.getState().setCurrentTime(10)

      useEditorStore.getState().goToNextMarker()
      expect(useEditorStore.getState().currentTime).toBe(10)
    })

    it('goToPreviousMarker moves to the previous marker', () => {
      useEditorStore.getState().addMarker(5)
      useEditorStore.getState().addMarker(10)
      useEditorStore.getState().setCurrentTime(15)

      useEditorStore.getState().goToPreviousMarker()
      expect(useEditorStore.getState().currentTime).toBe(10)

      useEditorStore.getState().goToPreviousMarker()
      expect(useEditorStore.getState().currentTime).toBe(5)
    })

    it('goToPreviousMarker does nothing when no previous marker exists', () => {
      useEditorStore.getState().addMarker(10)
      useEditorStore.getState().setCurrentTime(5)

      useEditorStore.getState().goToPreviousMarker()
      expect(useEditorStore.getState().currentTime).toBe(5)
    })
  })

  describe('UI state', () => {
    it('sets active tool', () => {
      expect(useEditorStore.getState().activeTool).toBe('select')

      useEditorStore.getState().setActiveTool('razor')
      expect(useEditorStore.getState().activeTool).toBe('razor')

      useEditorStore.getState().setActiveTool('ripple')
      expect(useEditorStore.getState().activeTool).toBe('ripple')
    })

    it('sets loop playback', () => {
      expect(useEditorStore.getState().loopPlayback).toBe(false)

      useEditorStore.getState().setLoopPlayback(true)
      expect(useEditorStore.getState().loopPlayback).toBe(true)

      useEditorStore.getState().setLoopPlayback(false)
      expect(useEditorStore.getState().loopPlayback).toBe(false)
    })
  })
})

describe('projectStore remaining behaviours', () => {
  beforeEach(resetStoreForTest)

  describe('setProject', () => {
    // ESCSUITE-115: setProject replaces the whole project — a different clip
    // list — without ever reconciling the selection against it. Project
    // load, LOAD_PROJECT from a host and session restore all go through
    // this action, so a selection from the previous project could outlive
    // it as a ghost the same way ESCSUITE-101 found for every other way a
    // clip leaves the timeline.
    it('prunes the selection against the incoming project', () => {
      addClip('clip1', 0, 2)
      store().toggleClipSelection('clip1')
      expect(store().selectedClipId).toBe('clip1')

      const nextProject = {
        ...store().project,
        timeline: { ...store().project.timeline, clips: [], duration: 0 },
      }
      store().setProject(nextProject)

      expect(store().selectedClipId).toBeNull()
      expect(store().selectedClipIds.size).toBe(0)
    })
  })

  describe('resetProject', () => {
    it('clears markers so they do not survive onto the next project', () => {
      store().addMarker(3, 'Old cue')
      store().addMarker(7, 'Another')
      expect(store().markers).toHaveLength(2)

      store().resetProject()

      expect(store().markers).toEqual([])
    })

    it('rewinds the playhead and drops the selection', () => {
      addClip('clip1', 0, 4)
      store().setCurrentTime(3)
      store().setSelectedClipId('clip1')

      store().resetProject()

      expect(store().currentTime).toBe(0)
      expect(store().selectedClipId).toBeNull()
      expect(store().project.timeline.clips).toEqual([])
    })

    // ESCSUITE-113: every source leaving the library on a reset may hold a
    // live URL.createObjectURL handle, and nothing else was ever going to
    // free it.
    it('revokes every current source\'s thumbnail URL', () => {
      store().addSourceVideo({ ...video, thumbnailUrl: 'blob:thumb-1' })
      store().addSourceVideo({ ...video, id: 'video2', thumbnailUrl: 'blob:thumb-2' })
      vi.mocked(URL.revokeObjectURL).mockClear()

      store().resetProject()

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-2')
    })

    it('does not revoke again on undo, and undo brings the source back with no thumbnail rather than a dead one', () => {
      store().addSourceVideo({ ...video, thumbnailUrl: 'blob:thumb-1' })
      vi.mocked(URL.revokeObjectURL).mockClear()

      store().resetProject()
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
      vi.mocked(URL.revokeObjectURL).mockClear()

      store().undo()

      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      const restored = store().sourceVideos.find((v) => v.id === video.id)
      expect(restored).toBeDefined()
      expect(restored?.thumbnailUrl).toBeUndefined()
    })
  })

  describe('history size cap', () => {
    it('drops the oldest snapshot once 50 are stored', () => {
      // Each undoable action snapshots the state *before* it, so 60 calls push
      // the initial state plus widths 100..158 — 60 entries, capped at 50.
      for (let i = 0; i < 60; i++) store().setProjectResolution(100 + i, 100)

      expect(store().history.past).toHaveLength(50)
      // The ten oldest snapshots, including the initial state, have aged out.
      expect(store().history.past[0].project.resolution.width).toBe(109)
      expect(store().history.past[49].project.resolution.width).toBe(158)
    })
  })

  describe('markers', () => {
    it('updates a marker and keeps the list sorted by time', () => {
      const first = store().addMarker(1, 'A')
      store().addMarker(5, 'B')

      store().updateMarker(first.id, { time: 8, label: 'Moved' })

      expect(store().markers.map((m) => [m.time, m.label])).toEqual([
        [5, 'B'],
        [8, 'Moved'],
      ])
    })
  })
})
