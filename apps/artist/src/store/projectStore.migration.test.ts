import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useEditorStore } from './projectStore'
import { parseProject } from './projectMigration'
import { DEFAULT_ANIMATION } from './types'
import type { Project } from './types'
import { buildMaskedSceneProject } from '../test/fixtures/perfScene'
import { getSessionState, saveSessionState, type SessionState } from '../core/storage'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'

/** A project as an older ARTIST version saved it: overlays in the two legacy arrays. */
const projectWithLegacyOverlays = (): Project => ({
  id: 'p',
  name: 'Has legacy overlays',
  created: 1,
  modified: 1,
  resolution: { width: 1920, height: 1080 },
  timeline: {
    tracks: [
      { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
    ],
    clips: [],
    textOverlays: [
      {
        id: 'text1', text: 'Legacy', x: 0.25, y: 0.5, fontFamily: 'Arial', fontSize: 48,
        fontWeight: 'normal', fontStyle: 'normal', color: '#ffffff',
        backgroundColor: '#00000000', textAlign: 'center', startTime: 1, endTime: 3, opacity: 0.5,
      },
    ],
    shapeOverlays: [
      {
        id: 'shape1', type: 'rectangle', x: 0.5, y: 0.5, width: 0.2, height: 0.2,
        fillColor: '#ff0000ff', strokeColor: '#ffffff', strokeWidth: 2,
        startTime: 0, endTime: 2, opacity: 1, rotation: 0,
      },
    ],
    duration: 0,
  },
})

describe('projectStore remaining behaviours', () => {
  beforeEach(resetStoreForTest)

  describe('setProject migration', () => {
    it('leaves a modern project alone but fills in missing overlay arrays', () => {
      const modern = {
        id: 'p',
        name: 'Modern',
        created: 1,
        modified: 1,
        resolution: { width: 1280, height: 720 },
        timeline: {
          tracks: [
            { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
          ],
          clips: [],
          duration: 0,
        },
      }

      store().setProject(modern as unknown as Project)

      expect(store().project.timeline.tracks).toHaveLength(1)
      expect(store().project.timeline.textOverlays).toEqual([])
      expect(store().project.timeline.shapeOverlays).toEqual([])
    })

    it('gives a project with no resolution the 1080p default', () => {
      const legacy = {
        id: 'p',
        name: 'Legacy',
        created: 1,
        modified: 1,
        timeline: {
          tracks: [
            { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
          ],
          clips: [],
          textOverlays: [],
          shapeOverlays: [],
          duration: 0,
        },
      }

      store().setProject(legacy as unknown as Project)

      expect(store().project.resolution).toEqual({ width: 1920, height: 1080 })
    })

    it('lays trackless clips out sequentially on a new default track', () => {
      const legacy = {
        id: 'p',
        name: 'Ancient',
        created: 1,
        modified: 1,
        resolution: { width: 1920, height: 1080 },
        timeline: {
          tracks: [],
          clips: [
            { id: 'a', sourceVideoId: 'video1', name: 'a', startTime: 0, endTime: 3, duration: 3 },
            { id: 'b', sourceVideoId: 'video1', name: 'b', startTime: 0, endTime: 2, duration: 2 },
          ],
          duration: 0,
        },
      }

      store().setProject(legacy as unknown as Project)

      const timeline = store().project.timeline
      expect(timeline.tracks).toHaveLength(1)
      const trackId = timeline.tracks[0].id
      expect(timeline.clips.map((c) => [c.id, c.timelinePosition, c.trackId])).toEqual([
        ['a', 0, trackId],
        ['b', 3, trackId],
      ])
      expect(timeline.clips[0].blendMode).toBe('normal')
      expect(timeline.clips[0].transform).toBeDefined()
      expect(timeline.clips[0].effects).toBeDefined()
      expect(timeline.clips[0].transition).toBeDefined()
      expect(timeline.duration).toBe(5)
      expect(timeline.textOverlays).toEqual([])
      expect(timeline.shapeOverlays).toEqual([])
    })

    it('converts legacy overlay arrays into overlay clips and empties the arrays', () => {
      store().setProject(projectWithLegacyOverlays())

      const timeline = store().project.timeline
      expect(timeline.clips).toHaveLength(2)
      expect(timeline.clips.map((c) => [c.id, c.overlayType])).toEqual([
        ['legacy-shape-shape1', 'shape'],
        ['legacy-text-text1', 'text'],
      ])
      expect(timeline.textOverlays).toEqual([])
      expect(timeline.shapeOverlays).toEqual([])
    })

    it('converts a trackless legacy project\'s overlays too', () => {
      // The other return path of ensureTimelineHasTracks: a project old enough to
      // predate tracks carries overlays in the arrays as well.
      const ancient = projectWithLegacyOverlays()
      ancient.timeline.tracks = []
      ancient.timeline.clips = [
        { id: 'a', sourceVideoId: 'video1', name: 'a', startTime: 0, endTime: 3, duration: 3 },
      ] as unknown as Project['timeline']['clips']

      store().setProject(ancient)

      const timeline = store().project.timeline
      expect(timeline.clips.map((c) => c.id)).toEqual(['a', 'legacy-shape-shape1', 'legacy-text-text1'])
      expect(timeline.tracks).toHaveLength(3)
      expect(timeline.textOverlays).toEqual([])
      expect(timeline.shapeOverlays).toEqual([])
    })

    it('pushes exactly one history entry, so a single undo returns to the previous project', () => {
      const before = store().project
      const entriesBefore = useEditorStore.getState().history.past.length

      store().setProject(projectWithLegacyOverlays())
      expect(store().project.timeline.clips).toHaveLength(2)
      expect(useEditorStore.getState().history.past).toHaveLength(entriesBefore + 1)

      store().undo()

      // The conversion happens inside the load, not as a second undoable step.
      expect(store().project).toEqual(before)
      expect(useEditorStore.getState().history.past).toHaveLength(entriesBefore)
    })

    it('converts a session restored from storage, which comes back through setProject', () => {
      // buildSessionSnapshot persists state.project whole, so a session autosaved
      // before this change still holds the legacy arrays; it heals on restore.
      const session: SessionState = {
        project: projectWithLegacyOverlays(),
        sourceVideos: [],
        currentTime: 0,
        selectedClipId: null,
        zoom: 1,
        timestamp: 1,
      }

      return saveSessionState(session)
        .then(getSessionState)
        .then((restored) => {
          store().setProject(restored!.project)

          const timeline = store().project.timeline
          expect(timeline.clips.map((c) => c.overlayType)).toEqual(['shape', 'text'])
          expect(timeline.textOverlays).toEqual([])
          expect(timeline.shapeOverlays).toEqual([])
        })
    })

    it('keeps positions that legacy clips already carried', () => {
      const legacy = {
        id: 'p',
        name: 'Ancient',
        created: 1,
        modified: 1,
        resolution: { width: 1920, height: 1080 },
        timeline: {
          tracks: [],
          clips: [
            { id: 'a', sourceVideoId: 'video1', name: 'a', startTime: 0, endTime: 3, duration: 3, timelinePosition: 10 },
            { id: 'b', sourceVideoId: 'video1', name: 'b', startTime: 0, endTime: 2, duration: 2 },
          ],
          duration: 0,
        },
      }

      store().setProject(legacy as unknown as Project)

      expect(store().project.timeline.clips.map((c) => c.timelinePosition)).toEqual([10, 0])
    })
  })

  describe('a mask and a stroke through storage (ESCSUITE-65)', () => {
    /** A project as every ARTIST before ESCSUITE-65 wrote it: clips with no mask field. */
    const preMaskProject = (): Project => ({
      id: 'p',
      name: 'Pre-mask',
      created: 1,
      modified: 1,
      resolution: { width: 1920, height: 1080 },
      timeline: {
        tracks: [
          { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
        ],
        clips: [
          {
            id: 'old-clip',
            sourceVideoId: 'video1',
            name: 'old-clip',
            startTime: 0,
            endTime: 2,
            duration: 2,
            trackId: 't1',
            timelinePosition: 0,
            blendMode: 'normal',
            transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
            effects: { blur: 0 },
            transition: { type: 'none', duration: 0.5 },
          },
        ],
        textOverlays: [],
        shapeOverlays: [],
        duration: 2,
      },
    })

    it('loads a pre-mask project with neither field, not with a default one', () => {
      store().setProject(preMaskProject())

      const clip = store().project.timeline.clips[0]
      // Absent, not `{ kind: 'none' }`: `undefined === none` is the whole reason
      // `ensureTimelineHasTracks` needs no new line for this feature, and it is
      // what keeps a clip that has never been masked identical to one whose mask
      // was removed. The unmasked *draw* is pinned in
      // core/canvasRenderer.clips.test.ts, which asserts such a clip records
      // exactly the three calls it has always recorded.
      expect(clip.mask).toBeUndefined()
      expect(clip.stroke).toBeUndefined()
      expect('mask' in clip).toBe(false)
      expect('stroke' in clip).toBe(false)
    })

    it('carries both fields through the existing updateClip action and its undo step', () => {
      store().setProject(preMaskProject())
      store().clearHistory()

      store().updateClip('old-clip', {
        mask: { kind: 'rounded', radius: 0.1 },
        stroke: { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 },
      })

      const clip = store().project.timeline.clips[0]
      expect(clip.mask).toEqual({ kind: 'rounded', radius: 0.1 })
      expect(clip.stroke).toEqual({ color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 })
      // `updateClip` already pushes history (clipSlice.ts:281), which is why this
      // feature needs no new store action and no new member in ClipSlice's Pick.
      expect(store().history.past).toHaveLength(1)

      store().undo()

      expect(store().project.timeline.clips[0].mask).toBeUndefined()
      expect(store().project.timeline.clips[0].stroke).toBeUndefined()
    })

    it('carries both fields onto a duplicated clip', () => {
      store().setProject(preMaskProject())
      store().updateClip('old-clip', {
        mask: { kind: 'circle' },
        stroke: { color: '#ff0000', width: 0.004 },
      })

      store().duplicateClip('old-clip')

      // `cloneClip` is `structuredClone` (utils/deepClone.ts), so this holds by
      // construction rather than by a field list somebody has to remember to
      // extend — which is exactly why it is worth one test.
      const copy = store().project.timeline.clips.find((c) => c.id !== 'old-clip')!
      expect(copy.mask).toEqual({ kind: 'circle' })
      expect(copy.stroke).toEqual({ color: '#ff0000', width: 0.004 })
    })

    it('loads a project written before crops existed with no crop on any clip', () => {
      // `crop` is optional with `undefined === none`, so no migration line was
      // added and DB_VERSION stayed 1. This is the proof.
      store().setProject(preMaskProject())

      expect(store().project.timeline.clips.every((c) => c.crop === undefined)).toBe(true)
    })
  })
})

describe('parseProject (ESCSUITE-102)', () => {
  /** A project that passes every check without migration doing any work. */
  const validProject = (): Project => ({
    id: 'p',
    name: 'Valid',
    created: 1,
    modified: 1,
    resolution: { width: 1920, height: 1080 },
    timeline: {
      tracks: [
        { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
      ],
      clips: [
        {
          id: 'c1', sourceVideoId: 'v1', name: 'c1', startTime: 0, endTime: 2, duration: 2,
          trackId: 't1', timelinePosition: 0, blendMode: 'normal',
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
          effects: { blur: 0 }, transition: { type: 'none', duration: 0.5 },
        },
      ],
      textOverlays: [],
      shapeOverlays: [],
      duration: 2,
    },
  })

  it('accepts a well-formed project and returns it migrated', () => {
    const result = parseProject(validProject())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.clips).toHaveLength(1)
      expect(result.project.timeline.tracks).toHaveLength(1)
    }
  })

  it('round-trips a rich, already-valid project unchanged — keyframes, mask, stroke, text and shape overlays (review round 1)', () => {
    // buildMaskedSceneProject already carries a mask and a stroke on every media
    // clip plus a text overlay clip and a shape overlay clip (perfScene.ts); the
    // only thing it has none of is keyframes, added here on one clip so this
    // fixture exercises everything the ticket named without inventing a second
    // scene builder.
    const base = buildMaskedSceneProject()
    const rich: Project = {
      ...base,
      timeline: {
        ...base.timeline,
        clips: base.timeline.clips.map((clip, index) =>
          index === 0
            ? {
                ...clip,
                animation: {
                  ...DEFAULT_ANIMATION,
                  keyframes: {
                    opacity: [
                      { time: 0, value: 0, easing: 'ease-out' },
                      { time: 1, value: 1, easing: 'linear' },
                    ],
                  },
                },
              }
            : clip
        ),
      },
    }
    // Sanity on the fixture itself, so a future change to perfScene.ts that
    // quietly drops one of these can't turn this into a test of nothing.
    expect(rich.timeline.clips.some((c) => c.mask && c.stroke)).toBe(true)
    expect(rich.timeline.clips.some((c) => c.overlayType === 'text')).toBe(true)
    expect(rich.timeline.clips.some((c) => c.overlayType === 'shape')).toBe(true)
    expect(rich.timeline.clips.some((c) => c.animation?.keyframes.opacity)).toBe(true)

    const result = parseProject(rich)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(rich)
    }
  })

  it('rejects a project whose timeline has no tracks or clips arrays', () => {
    const result = parseProject({
      id: 'p', name: 'Bad', created: 1, modified: 1,
      resolution: { width: 1920, height: 1080 },
      timeline: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/clip/i)
    }
  })

  it('rejects a timeline whose tracks is present but not a list (ESCSUITE-102 review round 2)', () => {
    const result = parseProject({
      id: 'p', name: 'Bad', created: 1, modified: 1,
      resolution: { width: 1920, height: 1080 },
      timeline: { tracks: { not: 'an array' }, clips: [] },
    })

    expect(result).toEqual({ ok: false, reason: 'Timeline tracks is not a list' })
  })

  it.each([
    ['a clip with no id at all', {}],
    ['a clip whose id is not a string', { id: 42 }],
  ])('rejects %s (ESCSUITE-102 review round 2)', (_label, badClip) => {
    const result = parseProject({
      id: 'p', name: 'Bad', created: 1, modified: 1,
      resolution: { width: 1920, height: 1080 },
      timeline: { tracks: [], clips: [badClip] },
    })

    expect(result).toEqual({ ok: false, reason: 'A clip is missing an id' })
  })

  it('migrates a project with no tracks at all, rather than rejecting it', () => {
    // ensureTimelineHasTracks's own migration branch handles an absent/empty
    // `tracks` array — parseProject must let that through, not reject it.
    const result = parseProject({
      id: 'p', name: 'Trackless', created: 1, modified: 1,
      resolution: { width: 1920, height: 1080 },
      timeline: { clips: [] },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.tracks).toHaveLength(1)
    }
  })

  it('rejects a clip whose trackId names a track that does not exist', () => {
    const bad = validProject()
    bad.timeline.clips[0].trackId = 'no-such-track'

    const result = parseProject(bad)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/track/i)
    }
  })

  it('rejects duplicate clip ids', () => {
    const bad = validProject()
    const second = { ...bad.timeline.clips[0] }
    bad.timeline.clips = [bad.timeline.clips[0], second]

    const result = parseProject(bad)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/duplicate/i)
    }
  })

  it('rejects input with no timeline at all', () => {
    const result = parseProject({ id: 'p', name: 'No timeline' })

    expect(result.ok).toBe(false)
  })

  it('rejects a non-object payload', () => {
    expect(parseProject(null).ok).toBe(false)
    expect(parseProject('a string').ok).toBe(false)
    expect(parseProject(42).ok).toBe(false)
  })

  it('does not reject a clip whose sourceVideoId matches nothing — media is re-linked separately', () => {
    const project = validProject()
    project.timeline.clips[0].sourceVideoId = 'not-in-any-library'

    const result = parseProject(project)

    expect(result.ok).toBe(true)
  })

  it('accepts a clip carrying a valid crop', () => {
    const good = validProject()
    good.timeline.clips[0].crop = { left: 0.25, top: 0, right: 0.1, bottom: 0 }

    const result = parseProject(good)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.clips[0].crop).toEqual({
        left: 0.25,
        top: 0,
        right: 0.1,
        bottom: 0,
      })
    }
  })

  it('accepts a clip with no crop at all', () => {
    // Which is every clip in every project saved before ESCSUITE-6: absent is
    // not malformed.
    expect(parseProject(validProject()).ok).toBe(true)
  })

  it.each([
    ['a crop that is not an object', 0.5],
    ['a crop that is null', null],
    ['a crop missing an edge', { left: 0.1, top: 0, right: 0 }],
    ['a crop with a non-numeric edge', { left: '0.1', top: 0, right: 0, bottom: 0 }],
    ['a crop with a NaN edge', { left: Number.NaN, top: 0, right: 0, bottom: 0 }],
    ['a crop with a negative edge', { left: -0.1, top: 0, right: 0, bottom: 0 }],
    ['a crop that leaves no picture', { left: 0.6, top: 0, right: 0.6, bottom: 0 }],
    ['a crop that over-crops vertically', { left: 0, top: 0.6, right: 0, bottom: 0.6 }],
  ])('rejects %s, naming the clip (ESCSUITE-6)', (_label, badCrop) => {
    const bad = validProject()
    // The cast is the point: this is what JSON.parse hands over, and the type
    // checker is not what stops it reaching the renderer.
    bad.timeline.clips[0].crop = badCrop as never

    expect(parseProject(bad)).toEqual({ ok: false, reason: 'Clip "c1" has an invalid crop' })
  })

  describe('transform validation (ESCSUITE-173)', () => {
    it('accepts a clip carrying a valid transform', () => {
      expect(parseProject(validProject()).ok).toBe(true)
    })

    it('accepts a clip with no transform at all', () => {
      const noTransform = validProject()
      delete (noTransform.timeline.clips[0] as Partial<typeof noTransform.timeline.clips[0]>).transform

      expect(parseProject(noTransform).ok).toBe(true)
    })

    it.each([
      ['a transform that is not an object', 0.5],
      ['a transform that is null', null],
      ['a transform missing scaleY', { x: 0.5, y: 0.5, scaleX: 1, rotation: 0, opacity: 1 }],
      ['a transform with a non-numeric scaleX', { x: 0.5, y: 0.5, scaleX: '1', scaleY: 1, rotation: 0, opacity: 1 }],
      ['a transform with a NaN scaleX', { x: 0.5, y: 0.5, scaleX: NaN, scaleY: 1, rotation: 0, opacity: 1 }],
      ['a transform with scaleX of zero', { x: 0.5, y: 0.5, scaleX: 0, scaleY: 1, rotation: 0, opacity: 1 }],
      ['a transform with a negative scaleY', { x: 0.5, y: 0.5, scaleX: 1, scaleY: -1, rotation: 0, opacity: 1 }],
      ['a transform with a non-finite rotation', { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: Infinity, opacity: 1 }],
      ['a transform with a non-numeric x', { x: '0.5', y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }],
      ['a transform with a NaN y', { x: 0.5, y: NaN, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }],
      ['a transform with a null rotation', { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: null, opacity: 1 }],
      ['a transform with a non-finite opacity', { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: Infinity }],
      // Rereview NIT: the earlier four rows left `Number.isFinite(x)`,
      // `typeof y === 'number'` and `Number.isFinite(scaleY)`'s false sides
      // unreached (the `scaleX: NaN` row above hits `Number.isFinite(scaleX)`
      // instead, and `scaleY: -1` fails on `> 0`, not finiteness).
      ['a transform with a non-finite x', { x: Infinity, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }],
      ['a transform with a non-numeric y', { x: 0.5, y: 'a', scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }],
      ['a transform with a non-finite scaleY', { x: 0.5, y: 0.5, scaleX: 1, scaleY: NaN, rotation: 0, opacity: 1 }],
    ])('rejects %s, naming the clip (ESCSUITE-173)', (_label, badTransform) => {
      const bad = validProject()
      // The cast is the point: this is what JSON.parse hands over, and the
      // type checker is not what stops a `scaleX: 0` reaching
      // `cropDrag.ts`'s `sourceDelta`, which divides by it.
      bad.timeline.clips[0].transform = badTransform as never

      expect(parseProject(bad)).toEqual({ ok: false, reason: 'Clip "c1" has an invalid transform' })
    })
  })

  describe('duration and position validation (ESCSUITE-257)', () => {
    it.each([
      ['zero', 0],
      ['negative', -1],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a string', '2'],
      ['null', null],
    ])('rejects a clip whose duration is %s, naming the clip', (_label, badDuration) => {
      const bad = validProject()
      bad.timeline.clips[0].duration = badDuration as never

      expect(parseProject(bad)).toEqual({ ok: false, reason: 'Clip "c1" has an invalid duration' })
    })

    it('accepts a positive duration', () => {
      const good = validProject()
      good.timeline.clips[0].duration = 0.001

      expect(parseProject(good).ok).toBe(true)
    })

    it.each([
      ['NaN', NaN],
      ['a string', '1'],
      ['null', null],
      ['Infinity', Infinity],
    ])('rejects a clip whose timelinePosition is %s, naming the clip', (_label, badPosition) => {
      const bad = validProject()
      bad.timeline.clips[0].timelinePosition = badPosition as never

      expect(parseProject(bad)).toEqual({ ok: false, reason: 'Clip "c1" has an invalid timelinePosition' })
    })

    it('accepts an absent timelinePosition, which migration defaults', () => {
      const good = validProject()
      delete (good.timeline.clips[0] as Partial<typeof good.timeline.clips[0]>).timelinePosition

      expect(parseProject(good).ok).toBe(true)
    })
  })

  describe('resolution validation (ESCSUITE-152)', () => {
    it.each([
      ['null', null],
      ['a string', '1080p'],
      ['0x0', { width: 0, height: 0 }],
      ['negative dimensions', { width: -1920, height: -1080 }],
      ['NaN dimensions', { width: NaN, height: NaN }],
      ['a missing width', { height: 1080 }],
      ['one more than 8K wide', { width: 7681, height: 4320 }],
    ])('rejects a project whose resolution is %s', (_label, badResolution) => {
      const bad = { ...validProject(), resolution: badResolution }

      const result = parseProject(bad)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toMatch(/resolution/i)
      }
    })

    it('still accepts odd dimensions — the exporters round those to even (ESCSUITE-111)', () => {
      const odd = validProject()
      odd.resolution = { width: 1921, height: 1081 }

      const result = parseProject(odd)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.project.resolution).toEqual({ width: 1921, height: 1081 })
      }
    })

    it('accepts the 8K ceiling exactly', () => {
      const atCeiling = validProject()
      atCeiling.resolution = { width: 7680, height: 4320 }

      const result = parseProject(atCeiling)

      expect(result.ok).toBe(true)
    })

    it('leaves a project with no resolution at all to the migration default (1920x1080)', () => {
      const noResolution: Record<string, unknown> = { ...validProject() }
      delete noResolution.resolution

      const result = parseProject(noResolution)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.project.resolution).toEqual({ width: 1920, height: 1080 })
      }
    })
  })
})

describe('a session carrying a non-finite transform is repaired (ESCSUITE-255)', () => {
  beforeEach(resetStoreForTest)

  const sessionWith = (transform: Record<string, unknown>) => ({
    id: 'p',
    name: 'Saved before the fix',
    created: 1,
    modified: 1,
    resolution: { width: 1920, height: 1080 },
    timeline: {
      tracks: [
        { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
      ],
      clips: [
        {
          id: 'c1', sourceVideoId: 'v1', name: 'c1', startTime: 0, endTime: 2, duration: 2,
          trackId: 't1', timelinePosition: 0, blendMode: 'normal',
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, ...transform },
          effects: { blur: 0 }, transition: { type: 'none', duration: 0.5 },
        },
      ],
      textOverlays: [],
      shapeOverlays: [],
      duration: 2,
    },
  })

  it('replaces an infinite or non-positive scale with 1 and warns once, naming the clip', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    store().setProject(sessionWith({ scaleX: Infinity, scaleY: 0 }) as unknown as Project)

    const t = store().project.timeline.clips[0].transform
    expect(t.scaleX).toBe(1)
    expect(t.scaleY).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0].join(' ')).toContain('c1')
    warn.mockRestore()
  })

  it('replaces a non-finite x, y, rotation and opacity with the default, keeping the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    store().setProject(
      sessionWith({ x: NaN, y: Infinity, rotation: NaN, opacity: -Infinity, scaleX: 2 }) as unknown as Project
    )

    expect(store().project.timeline.clips[0].transform).toMatchObject({
      x: 0.5, y: 0.5, rotation: 0, opacity: 1, scaleX: 2,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('repairs a scale the structured clone turned into null or a string', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    store().setProject(sessionWith({ scaleX: null, opacity: '1' }) as unknown as Project)

    expect(store().project.timeline.clips[0].transform).toMatchObject({ scaleX: 1, opacity: 1 })
    warn.mockRestore()
  })

  it('leaves a healthy session untouched, the clip object included, and says nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const healthy = sessionWith({ scaleX: 0.5 })

    store().setProject(healthy as unknown as Project)

    expect(store().project.timeline.clips[0]).toBe(healthy.timeline.clips[0])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('repairs on the migration path (a track-less project) as well', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const legacy = sessionWith({ scaleX: Infinity })
    legacy.timeline.tracks = []

    store().setProject(legacy as unknown as Project)

    expect(store().project.timeline.clips[0].transform.scaleX).toBe(1)
    warn.mockRestore()
  })

  it('still refuses the same project as a file: scaleX null is parseProject\'s refusal', () => {
    const result = parseProject(sessionWith({ scaleX: null }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/transform/)
  })
})
