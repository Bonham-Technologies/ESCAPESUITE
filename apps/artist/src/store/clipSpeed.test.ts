// Clip speed (ESCSUITE-471): a clip plays `speed` seconds of source per second
// of timeline, so its length is its source span over its speed, and every edit
// that maps timeline time to source time — split, trim, ripple delete, Remove
// silences — maps it through the speed.
import { describe, it, expect, beforeEach } from 'vitest'
import { addClip, resetStoreForTest, store, video } from '../test/fixtures/projectStore'
import { audioSource } from '../test/renderPreview'
import { makeClip } from '../test/fixtures/clipFixtures'
import {
  canHaveSpeed,
  clipSpeed,
  clipTimelineLength,
  formatClipSpeed,
  isAudibleSpeed,
  isValidClipSpeed,
  sourceTimeAt,
} from './clipSpeed'
import { cutTimeRanges } from './rippleRanges'
import { computeTrimUpdate } from '../components/Timeline/timelineGeometry'
import { clampTrimToNeighbours } from './timelineSnapping'
import { parseProject } from './projectMigration'
import { encodeProjectFile, readProjectFileIndex } from '../core/projectFileFormat'
import type { Clip } from './types'

const clipById = (id: string): Clip => store().project.timeline.clips.find((c) => c.id === id)!

/** A 10 s two-part take — screen and microphone, the mic captured `micOffset` s later — at 0. */
function placeTake(micOffset = 0) {
  store().placeTakeOnTimeline([
    { sourceVideoId: video.id, name: 'screen', duration: 10, startOffset: 0, width: 1920, height: 1080 },
    { sourceVideoId: audioSource.id, name: 'mic', duration: 10 - micOffset, startOffset: micOffset, width: 0, height: 0, mediaType: 'audio' },
  ])
  const clips = store().project.timeline.clips
  return { screen: clips.find((c) => c.name === 'screen')!, mic: clips.find((c) => c.name === 'mic')! }
}

beforeEach(() => {
  resetStoreForTest()
  store().addSourceVideo(audioSource)
})

describe('clip speed helpers', () => {
  it('reads an absent, out-of-range or overlay speed as 1', () => {
    expect(clipSpeed({})).toBe(1)
    expect(clipSpeed({ speed: 2 })).toBe(2)
    expect(clipSpeed({ speed: 8 })).toBe(1)
    expect(clipSpeed({ speed: Number.NaN })).toBe(1)
    expect(clipSpeed({ speed: 2, overlayType: 'text' })).toBe(1)
  })

  it('accepts 0.25 to 4 and nothing else', () => {
    expect([0.25, 1, 1.37, 4].every(isValidClipSpeed)).toBe(true)
    expect([0.2, 4.01, -1, Infinity, '2', null].some(isValidClipSpeed)).toBe(false)
  })

  it('maps clip time to source time through the speed', () => {
    expect(sourceTimeAt({ startTime: 3, speed: 2 }, 1.5)).toBe(6)
    expect(sourceTimeAt({ startTime: 3 }, 1.5)).toBe(4.5)
    expect(clipTimelineLength({ startTime: 2, endTime: 12, speed: 2 })).toBe(5)
    expect(clipTimelineLength({ startTime: 2, endTime: 12, speed: 0.5 })).toBe(20)
  })

  it('keeps the sound up to 2× and silences it above', () => {
    expect(isAudibleSpeed(2)).toBe(true)
    expect(isAudibleSpeed(0.25)).toBe(true)
    expect(isAudibleSpeed(4)).toBe(false)
  })

  it('formats a speed without trailing zeros', () => {
    expect(formatClipSpeed(2)).toBe('2×')
    expect(formatClipSpeed(0.25)).toBe('0.25×')
    expect(formatClipSpeed(1.5)).toBe('1.5×')
  })

  it('gives a speed to video and audio clips only', () => {
    const sources = [video, audioSource, { id: 'img', mediaType: 'image' as const }]
    expect(canHaveSpeed(makeClip({ sourceVideoId: video.id }), sources)).toBe(true)
    expect(canHaveSpeed(makeClip({ sourceVideoId: audioSource.id }), sources)).toBe(true)
    expect(canHaveSpeed(makeClip({ sourceVideoId: 'img' }), sources)).toBe(false)
    expect(canHaveSpeed(makeClip({ sourceVideoId: '', overlayType: 'text' }), sources)).toBe(false)
  })
})

describe('setClipSpeed', () => {
  it('lays a 10 s clip at 2× over 5 s of timeline, keeping its source span', () => {
    addClip('a', 3, 10)
    expect(store().setClipSpeed('a', 2)).toBe(true)
    const a = clipById('a')
    expect(a).toMatchObject({ speed: 2, duration: 5, startTime: 0, endTime: 10, timelinePosition: 3 })
    expect(store().project.timeline.duration).toBe(8)
  })

  it('slows a clip down to 0.5×, 20 s of timeline', () => {
    addClip('a', 0, 10)
    store().setClipSpeed('a', 0.5)
    expect(clipById('a').duration).toBe(20)
  })

  it('drops the key when set back to 1, leaving the clip it was', () => {
    const before = addClip('a', 0, 10)
    store().setClipSpeed('a', 2)
    store().setClipSpeed('a', 1)
    expect(clipById('a')).toEqual(before)
    expect('speed' in clipById('a')).toBe(false)
  })

  it('refuses an out-of-range speed, the same speed, an overlay and an image', () => {
    addClip('a', 0, 10)
    expect(store().setClipSpeed('a', 5)).toBe(false)
    expect(store().setClipSpeed('a', 0.1)).toBe(false)
    expect(store().setClipSpeed('a', 1)).toBe(false)
    expect(store().setClipSpeed('missing', 2)).toBe(false)
    store().addTextOverlayClip()
    const overlay = store().project.timeline.clips.find((c) => c.overlayType === 'text')!
    expect(store().setClipSpeed(overlay.id, 2)).toBe(false)
    store().addSourceVideo({ ...video, id: 'img', mediaType: 'image' })
    store().addClipToTimeline({ id: 'still', sourceVideoId: 'img', name: 'still', startTime: 0, endTime: 5, duration: 5 }, undefined, 20)
    expect(store().setClipSpeed('still', 2)).toBe(false)
  })

  it('is one undo step', () => {
    addClip('a', 0, 10)
    store().setClipSpeed('a', 2)
    store().undo()
    expect(clipById('a').duration).toBe(10)
    expect(clipById('a').speed).toBeUndefined()
  })

  it('moves the clips after it on its row by the length it gained or lost', () => {
    const a = addClip('a', 0, 10)
    addClip('b', 10, 4, a.trackId)
    addClip('c', 2, 4) // another row: stays put
    store().setClipSpeed('a', 2)
    expect(clipById('b').timelinePosition).toBe(5)
    expect(clipById('c').timelinePosition).toBe(2)
    store().setClipSpeed('a', 0.5)
    expect(clipById('a').duration).toBe(20)
    expect(clipById('b').timelinePosition).toBe(20)
  })

  it('refuses on a locked track', () => {
    const a = addClip('a', 0, 10)
    store().updateTrack(a.trackId, { locked: true })
    expect(store().setClipSpeed('a', 2)).toBe(false)
    expect(clipById('a').duration).toBe(10)
  })

  it('scales keyframes so each stays on its source moment, and caps the presets', () => {
    addClip('a', 0, 10)
    store().updateClipAnimation('a', {
      in: { type: 'fade', duration: 2, easing: 'linear' },
      keyframes: { opacity: [{ time: 4, value: 0.5, easing: 'linear' }, { time: 8, value: 1, easing: 'linear' }] },
    })
    store().setClipSpeed('a', 4)
    const animation = clipById('a').animation!
    expect(animation.keyframes.opacity!.map((k) => k.time)).toEqual([1, 2])
    // 2.5 s long now: a preset is capped at half of it.
    expect(animation.in.duration).toBe(1.25)
  })

  it('caps a transition to the shorter clip', () => {
    addClip('a', 0, 4)
    store().updateClipTransition('a', { type: 'fade', duration: 2 })
    store().setClipSpeed('a', 4)
    expect(clipById('a').transition.duration).toBe(0.5)
  })

  describe('on a linked take', () => {
    it('changes the linked microphone with the screen, in step', () => {
      const { screen, mic } = placeTake()
      expect(store().setClipSpeed(screen.id, 2)).toBe(true)
      expect(clipById(screen.id)).toMatchObject({ speed: 2, duration: 5 })
      expect(clipById(mic.id)).toMatchObject({ speed: 2, duration: 5 })
    })

    it('keeps a part captured later in step: its offset is scaled too', () => {
      const { screen, mic } = placeTake(1)
      expect(clipById(mic.id).timelinePosition).toBe(1)
      store().setClipSpeed(screen.id, 2)
      const s = clipById(screen.id)
      const m = clipById(mic.id)
      expect(m.timelinePosition).toBe(0.5)
      // The same take instant, 6 s in, is under one timeline time on both rows.
      const screenAt = s.timelinePosition + (6 - s.startTime) / 2
      const micAt = m.timelinePosition + (6 - 1 - m.startTime) / 2
      expect(micAt).toBeCloseTo(screenAt, 9)
    })

    it('refuses when a linked part is on a locked track', () => {
      const { screen, mic } = placeTake()
      store().updateTrack(mic.trackId, { locked: true })
      expect(store().setClipSpeed(screen.id, 2)).toBe(false)
    })

    it('refuses a slow-down that would run into a clip it does not move', () => {
      // The mic ends at 9; a clip at 9.5 on its row sits before the take's
      // end (10), so it does not move, and a slow-down would cover it.
      const { screen, mic } = placeTake()
      store().trimClip(mic.id, 'end', { endTime: 9 }, { startTime: 0, endTime: 10, timelinePosition: 0 })
      store().addClipToTimeline({ id: 'x', sourceVideoId: audioSource.id, name: 'x', startTime: 0, endTime: 0.4, duration: 0.4 }, mic.trackId, 9.5)
      expect(store().setClipSpeed(screen.id, 0.5)).toBe(false)
      expect(store().setClipSpeed(screen.id, 2)).toBe(true)
    })
  })
})

describe('edits on a sped clip', () => {
  it('splits at the source instant under the playhead, both halves keeping the speed', () => {
    addClip('a', 0, 10)
    store().setClipSpeed('a', 2)
    store().splitClip('a', 2) // 2 s of timeline = 4 s of source
    const [first, second] = [...store().project.timeline.clips].sort((x, y) => x.timelinePosition - y.timelinePosition)
    expect(first).toMatchObject({ startTime: 0, endTime: 4, duration: 2, speed: 2, timelinePosition: 0 })
    expect(second).toMatchObject({ startTime: 4, endTime: 10, duration: 3, speed: 2, timelinePosition: 2 })
  })

  it('trims the end by the pointer travel times the speed', () => {
    const clip = makeClip({ startTime: 0, endTime: 10, duration: 5, speed: 2 })
    const origin = { startTime: 0, endTime: 10, timelinePosition: 0, speed: 2 }
    const update = computeTrimUpdate({ edge: 'end', mouseTime: 4, clip, sourceVideo: video, origin })
    expect(update).toEqual({ endTime: 8 })
    store().addClipToTimeline({ ...clip, id: 't' }, undefined, 0)
    store().trimClip('t', 'end', update!, origin)
    expect(clipById('t').duration).toBe(4)
  })

  it('trims the start by the pointer travel times the speed', () => {
    const clip = makeClip({ startTime: 0, endTime: 10, duration: 5, speed: 2, timelinePosition: 1 })
    const origin = { startTime: 0, endTime: 10, timelinePosition: 1, speed: 2 }
    const update = computeTrimUpdate({ edge: 'start', mouseTime: 2, clip, sourceVideo: video, origin })
    expect(update).toEqual({ startTime: 2, timelinePosition: 2 })
    // The in point stops at source 0 and at timeline 0, both through the speed.
    const back = computeTrimUpdate({ edge: 'start', mouseTime: -5, clip: { ...clip, startTime: 4, timelinePosition: 3 }, sourceVideo: video, origin: { ...origin, startTime: 4, timelinePosition: 3 } })
    expect(back).toEqual({ startTime: 0, timelinePosition: 1 })
  })

  it('clamps a trim to its neighbour by the sped length', () => {
    const clip = makeClip({ id: 'a', startTime: 0, endTime: 10, duration: 5, speed: 2 })
    const next = makeClip({ id: 'b', timelinePosition: 6, duration: 2, endTime: 2 })
    const origin = { startTime: 0, endTime: 10, timelinePosition: 0, speed: 2 }
    expect(clampTrimToNeighbours([clip, next], clip, 'end', origin, 9)).toBe(6)
  })

  it('ripple-deletes by its length on the timeline', () => {
    const a = addClip('a', 0, 10)
    addClip('b', 10, 2, a.trackId)
    store().setClipSpeed('a', 2)
    expect(clipById('b').timelinePosition).toBe(5)
    store().rippleDeleteClip('a')
    expect(clipById('b').timelinePosition).toBe(0)
  })

  it('cuts a removed range out of the source through the speed', () => {
    const clip = makeClip({ id: 'a', startTime: 2, endTime: 12, duration: 5, speed: 2 })
    const cut = cutTimeRanges([clip], [video], new Set([clip.trackId]), [{ start: 1, end: 2 }])
    const pieces = [...cut].sort((x, y) => x.timelinePosition - y.timelinePosition)
    expect(pieces.map((p) => [p.timelinePosition, p.startTime, p.endTime, p.duration, p.speed])).toEqual([
      [0, 2, 4, 1, 2],
      [1, 6, 12, 3, 2],
    ])
  })
})

describe('a sped clip in the project file', () => {
  /** A one-clip project, as a file holds it. */
  const fileWith = (clip: Partial<Clip>) => ({
    id: 'p',
    name: 'P',
    created: 0,
    modified: 0,
    resolution: { width: 64, height: 48 },
    timeline: {
      tracks: [{ id: 't', name: 'T', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }],
      clips: [{ ...makeClip({ id: 'c', trackId: 't', startTime: 0, endTime: 10, duration: 10 }), ...clip }],
      textOverlays: [],
      shapeOverlays: [],
      duration: 10,
    },
  })

  it('opens a file written before speeds existed unchanged: no speed, the same clip', () => {
    const parsed = parseProject(fileWith({}))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const [clip] = parsed.project.timeline.clips
    expect('speed' in clip).toBe(false)
    expect(clip).toEqual(fileWith({}).timeline.clips[0])
    expect(clipSpeed(clip)).toBe(1)
  })

  it('round-trips a saved speed through the .veditor container', async () => {
    addClip('a', 0, 10)
    store().setClipSpeed('a', 2)
    const blob = new Blob(encodeProjectFile(store().project, undefined, []))
    const read = await readProjectFileIndex(blob)
    const parsed = parseProject(read!.index.project)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.project.timeline.clips.find((c) => c.id === 'a')).toMatchObject({ speed: 2, duration: 5, endTime: 10 })
  })

  it.each([
    [{ speed: 5, duration: 2 }, 'invalid speed'],
    [{ speed: 0.1, duration: 100 }, 'invalid speed'],
    [{ speed: '2' as unknown as number }, 'invalid speed'],
    [{ speed: 2 }, 'duration must be'],
    [{ speed: 2, duration: 5, overlayType: 'text' as const }, 'cannot have a speed'],
  ])('refuses %o', (clip, reason) => {
    const parsed = parseProject(fileWith(clip))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain(reason)
  })

  it('accepts a speed whose duration matches up to float noise', () => {
    expect(parseProject(fileWith({ speed: 3, duration: 10 / 3 + 1e-12 })).ok).toBe(true)
  })
})
