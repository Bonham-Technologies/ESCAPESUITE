// A take's parts stay together (ESCSUITE-355). A take recorded with CRAFT's
// separate tracks lands as one clip per part on its own row; before this
// ticket nothing tied them, so a split, a delete or a drag on the picture left
// the microphone whole and the cut speech kept playing under the wrong frames.
import { describe, it, expect, beforeEach } from 'vitest'
import { resetStoreForTest, store, video } from '../test/fixtures/projectStore'
import { audioSource } from '../test/renderPreview'
import { parseProject } from './projectMigration'
import { withLinkedClips } from './linkedClips'
import type { Clip } from './types'

/** Each clip on a row as `[timelinePosition, startTime, endTime]`, in time order. */
function row(trackId: string): number[][] {
  return store()
    .project.timeline.clips.filter((c) => c.trackId === trackId)
    .sort((a, b) => a.timelinePosition - b.timelinePosition)
    .map((c) => [c.timelinePosition, c.startTime, c.endTime])
}

function clipsOn(trackId: string): Clip[] {
  return store()
    .project.timeline.clips.filter((c) => c.trackId === trackId)
    .sort((a, b) => a.timelinePosition - b.timelinePosition)
}

/** A 10 s two-part take — screen and microphone — placed at 0. */
function placeTake() {
  store().placeTakeOnTimeline([
    { sourceVideoId: video.id, name: 'screen', duration: 10, startOffset: 0, width: 1920, height: 1080 },
    { sourceVideoId: audioSource.id, name: 'mic', duration: 10, startOffset: 0, width: 0, height: 0, mediaType: 'audio' },
  ])
  const clips = store().project.timeline.clips
  const screen = clips.find((c) => c.name === 'screen')!
  const mic = clips.find((c) => c.name === 'mic')!
  return { screen, mic, screenRow: screen.trackId, micRow: mic.trackId }
}

beforeEach(() => {
  resetStoreForTest()
  store().addSourceVideo(audioSource)
})

describe('placing a take (ESCSUITE-355)', () => {
  it('links every part of a take to the others', () => {
    const { screen, mic } = placeTake()
    expect(screen.linkGroupId).toBeTruthy()
    expect(mic.linkGroupId).toBe(screen.linkGroupId)
  })

  it('links nothing for a take of one part', () => {
    store().placeTakeOnTimeline([
      { sourceVideoId: video.id, name: 'screen', duration: 10, startOffset: 0, width: 1920, height: 1080 },
    ])
    expect(store().project.timeline.clips[0].linkGroupId).toBeUndefined()
  })

  it('gives two takes two different links', () => {
    placeTake()
    placeTake()
    const groups = new Set(store().project.timeline.clips.map((c) => c.linkGroupId))
    expect(groups.size).toBe(2)
  })
})

describe('splitting a linked clip', () => {
  it('splits every linked clip at the same timeline time', () => {
    const { screen, screenRow, micRow } = placeTake()
    store().splitClip(screen.id, 3)
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 10]])
  })

  it('is one undo step', () => {
    const { screen, screenRow, micRow } = placeTake()
    store().splitClip(screen.id, 3)
    store().undo()
    expect(row(screenRow)).toEqual([[0, 0, 10]])
    expect(row(micRow)).toEqual([[0, 0, 10]])
  })

  it('links the left halves to each other and the right halves to each other', () => {
    const { screen, screenRow, micRow } = placeTake()
    store().splitClip(screen.id, 3)
    const [screenLeft, screenRight] = clipsOn(screenRow)
    const [micLeft, micRight] = clipsOn(micRow)
    expect(micLeft.linkGroupId).toBe(screenLeft.linkGroupId)
    expect(micRight.linkGroupId).toBe(screenRight.linkGroupId)
    expect(screenLeft.linkGroupId).not.toBe(screenRight.linkGroupId)
  })

  it('splits a linked clip that sits at a different offset at its own clip time', () => {
    const { screen, mic, screenRow, micRow } = placeTake()
    // The mic was captured half a second late.
    store().setClipTimelinePosition(mic.id, 0.5)
    store().splitClip(screen.id, 3)
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 10]])
    expect(row(micRow)).toEqual([[0.5, 0, 2.5], [3, 2.5, 10]])
  })

  it('leaves a linked clip the cut does not cross whole, on the side it falls', () => {
    const { screen, screenRow, micRow } = placeTake()
    store().splitClip(screen.id, 3)
    const right = clipsOn(screenRow)[1]
    store().splitClip(right.id, 3) // at timeline 6
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
    const groups = clipsOn(screenRow).map((c) => c.linkGroupId)
    expect(new Set(groups).size).toBe(3)
    expect(clipsOn(micRow).map((c) => c.linkGroupId)).toEqual(groups)
  })

  it('with `alone`, splits only the clip asked for', () => {
    const { screen, screenRow, micRow } = placeTake()
    store().splitClip(screen.id, 3, true)
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 10]])
    expect(row(micRow)).toEqual([[0, 0, 10]])
  })

  it('does not cut a linked clip a hair from its edge, and keeps it on its side', () => {
    store().placeTakeOnTimeline([
      { sourceVideoId: video.id, name: 'screen', duration: 10, startOffset: 0, width: 1920, height: 1080 },
      { sourceVideoId: audioSource.id, name: 'mic', duration: 6, startOffset: 2.9995, width: 0, height: 0, mediaType: 'audio' },
    ])
    const byName = (n: string) => store().project.timeline.clips.filter((c) => c.name.startsWith(n))
    store().splitClip(byName('screen')[0].id, 3)
    expect(byName('mic')).toHaveLength(1)
    const right = byName('screen').find((c) => c.timelinePosition > 0)!
    expect(byName('mic')[0].linkGroupId).toBe(right.linkGroupId)
  })

  it('leaves a linked clip on a locked track alone', () => {
    const { screen, micRow, screenRow } = placeTake()
    store().updateTrack(micRow, { locked: true })
    store().splitClip(screen.id, 3)
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 10]])
    expect(row(micRow)).toEqual([[0, 0, 10]])
  })
})

describe('deleting a linked clip', () => {
  /** Split the take at 3 and 6 and return the middle screen piece. */
  function cutMiddle() {
    const take = placeTake()
    store().splitClip(take.screen.id, 3)
    store().splitClip(clipsOn(take.screenRow)[1].id, 3)
    return { ...take, middle: clipsOn(take.screenRow)[1] }
  }

  it('removes the linked segments of the other parts in one undo step', () => {
    const { middle, screenRow, micRow } = cutMiddle()
    expect(store().removeClipFromTimeline(middle.id)).toBe(true)
    expect(row(screenRow)).toEqual([[0, 0, 3], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [6, 6, 10]])
    store().undo()
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })

  it('ripple deletes every linked segment and closes the gap on every row', () => {
    const { middle, screenRow, micRow } = cutMiddle()
    store().rippleDeleteClip(middle.id)
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 6, 10]])
  })

  it('deletes the linked clips of a multi-selection too', () => {
    const { middle, screenRow, micRow } = cutMiddle()
    store().selectClipsInRange([middle.id])
    expect(store().deleteSelectedClips()).toBe(true)
    expect(row(screenRow)).toEqual([[0, 0, 3], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [6, 6, 10]])
  })

  it('with `alone`, deletes only the clip asked for', () => {
    const { middle, screenRow, micRow } = cutMiddle()
    store().removeClipFromTimeline(middle.id, true)
    expect(row(screenRow)).toEqual([[0, 0, 3], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })

  it('with `alone`, ripple deletes only the clip asked for', () => {
    const { middle, screenRow, micRow } = cutMiddle()
    store().rippleDeleteClip(middle.id, true)
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })

  it('a delete leaves a linked clip on a locked track in place', () => {
    const { middle, screenRow, micRow } = cutMiddle()
    store().updateTrack(micRow, { locked: true })
    store().removeClipFromTimeline(middle.id)
    expect(row(screenRow)).toEqual([[0, 0, 3], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })

  it('a ripple delete with a linked clip on a locked track changes nothing', () => {
    // Closing the gap on one row only would put the later pieces out of step.
    const { middle, screenRow, micRow } = cutMiddle()
    store().updateTrack(micRow, { locked: true })
    store().rippleDeleteClip(middle.id)
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })
})

describe('moving a linked clip', () => {
  it('withLinkedClips adds every clip linked to one asked for', () => {
    const { screen, mic } = placeTake()
    const ids = withLinkedClips(store().project.timeline.clips, [screen.id])
    expect([...ids].sort()).toEqual([screen.id, mic.id].sort())
  })

  it('moveClips moves the clips named by one delta, as one undo step', () => {
    const { screen, mic, screenRow, micRow } = placeTake()
    store().moveClips(new Set([screen.id, mic.id]), 2, 0)
    expect(row(screenRow)).toEqual([[2, 0, 10]])
    expect(row(micRow)).toEqual([[2, 0, 10]])
    store().undo()
    expect(row(micRow)).toEqual([[0, 0, 10]])
  })
})

describe('unlinking', () => {
  it('unlinks a clip from the others, and the last one left', () => {
    const { screen, mic } = placeTake()
    expect(store().unlinkClip(screen.id)).toBe(true)
    const clips = store().project.timeline.clips
    expect(clips.find((c) => c.id === screen.id)!.linkGroupId).toBeUndefined()
    expect(clips.find((c) => c.id === mic.id)!.linkGroupId).toBeUndefined()
  })

  it('keeps the rest of a group of three linked', () => {
    store().placeTakeOnTimeline([
      { sourceVideoId: video.id, name: 'screen', duration: 10, startOffset: 0, width: 1920, height: 1080 },
      { sourceVideoId: audioSource.id, name: 'mic', duration: 10, startOffset: 0, width: 0, height: 0, mediaType: 'audio' },
      { sourceVideoId: audioSource.id, name: 'system', duration: 10, startOffset: 0, width: 0, height: 0, mediaType: 'audio' },
    ])
    const byName = (n: string) => store().project.timeline.clips.find((c) => c.name === n)!
    store().unlinkClip(byName('screen').id)
    expect(byName('screen').linkGroupId).toBeUndefined()
    expect(byName('mic').linkGroupId).toBeTruthy()
    expect(byName('mic').linkGroupId).toBe(byName('system').linkGroupId)
  })

  it('does not touch a last partner on a locked track', () => {
    const { screen, mic, micRow } = placeTake()
    store().updateTrack(micRow, { locked: true })
    expect(store().unlinkClip(screen.id)).toBe(true)
    const clips = store().project.timeline.clips
    expect(clips.find((c) => c.id === screen.id)!.linkGroupId).toBeUndefined()
    expect(clips.find((c) => c.id === mic.id)!.linkGroupId).toBe(mic.linkGroupId)
  })

  it('answers false for a clip that is not linked', () => {
    store().addClipToTimeline({ id: 'lone', sourceVideoId: video.id, name: 'lone', startTime: 0, endTime: 2, duration: 2 }, undefined, 0)
    expect(store().unlinkClip('lone')).toBe(false)
  })

  it('after unlinking, a split cuts only that clip', () => {
    const { screen, screenRow, micRow } = placeTake()
    store().unlinkClip(screen.id)
    store().splitClip(screen.id, 3)
    expect(row(screenRow)).toHaveLength(2)
    expect(row(micRow)).toEqual([[0, 0, 10]])
  })
})

describe('copies of a linked clip', () => {
  it('a duplicate is linked to nothing', () => {
    const { screen } = placeTake()
    store().duplicateClip(screen.id)
    const copy = store().project.timeline.clips.find((c) => c.name === 'screen (copy)')!
    expect(copy.linkGroupId).toBeUndefined()
  })

  it('a pasted linked pair is linked to each other, not to the originals', () => {
    const { screen, mic } = placeTake()
    store().selectClipsInRange([screen.id, mic.id])
    store().copySelectedClips()
    store().setCurrentTime(20)
    store().pasteClips()
    const pasted = store().project.timeline.clips.filter((c) => c.timelinePosition >= 20)
    expect(pasted).toHaveLength(2)
    expect(pasted[0].linkGroupId).toBeTruthy()
    expect(pasted[0].linkGroupId).toBe(pasted[1].linkGroupId)
    expect(pasted[0].linkGroupId).not.toBe(screen.linkGroupId)
  })
})

describe('saving and opening', () => {
  it('a project keeps its links through parseProject', () => {
    const { screen } = placeTake()
    const saved = JSON.parse(JSON.stringify(store().project))
    const parsed = parseProject(saved)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const groups = parsed.project.timeline.clips.map((c) => c.linkGroupId)
    expect(groups).toEqual([screen.linkGroupId, screen.linkGroupId])
  })

  it('a project with no links opens unchanged', () => {
    store().addClipToTimeline({ id: 'lone', sourceVideoId: video.id, name: 'lone', startTime: 0, endTime: 2, duration: 2 }, undefined, 0)
    const saved = JSON.parse(JSON.stringify(store().project))
    const parsed = parseProject(saved)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.project.timeline.clips[0]).not.toHaveProperty('linkGroupId')
  })

  it('refuses a link that is not a non-empty string', () => {
    const { screen } = placeTake()
    const saved = JSON.parse(JSON.stringify(store().project))
    saved.timeline.clips[0].linkGroupId = 42
    const parsed = parseProject(saved)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain(saved.timeline.clips[0].id)
    expect(screen).toBeDefined()
  })
})
