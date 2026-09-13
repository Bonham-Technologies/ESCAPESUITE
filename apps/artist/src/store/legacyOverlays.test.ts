import { describe, it, expect } from 'vitest'
import { convertLegacyOverlays } from './legacyOverlays'
import { DEFAULT_EFFECTS, DEFAULT_TRANSFORM, DEFAULT_TRANSITION } from './types'
import type { Clip, ShapeOverlay, TextOverlay, Timeline, Track } from './types'

const track = (id: string, index: number): Track => ({
  id, name: `Track ${index + 1}`, index,
  visible: true, locked: false, muted: false, volume: 1, height: 60,
})

const clip = (id: string, trackId: string, timelinePosition = 0, duration = 2): Clip => ({
  id, sourceVideoId: 'video1', name: id,
  startTime: 0, endTime: duration, duration,
  trackId, timelinePosition,
  blendMode: 'normal',
  transform: { ...DEFAULT_TRANSFORM },
  effects: { ...DEFAULT_EFFECTS },
  transition: { ...DEFAULT_TRANSITION },
})

const timeline = (over: Partial<Timeline> = {}): Timeline => ({
  tracks: [track('t0', 0)],
  clips: [],
  textOverlays: [],
  shapeOverlays: [],
  duration: 0,
  ...over,
})

const text = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 'text1', text: 'Hello',
  x: 0.25, y: 0.75,
  fontFamily: 'Georgia', fontSize: 36, fontWeight: 'bold', fontStyle: 'italic',
  color: '#ff0000', backgroundColor: '#0000ff80', textAlign: 'left',
  startTime: 1, endTime: 3, opacity: 0.5,
  ...over,
})

const shape = (over: Partial<ShapeOverlay> = {}): ShapeOverlay => ({
  id: 'shape1', type: 'ellipse',
  x: 0.4, y: 0.6, width: 0.3, height: 0.2,
  fillColor: '#00ff00ff', strokeColor: '#000000', strokeWidth: 4,
  startTime: 0, endTime: 2, opacity: 0.8, rotation: 15,
  ...over,
})

describe('convertLegacyOverlays', () => {
  describe('nothing to convert', () => {
    it('returns the very same timeline object when both arrays are empty', () => {
      const input = timeline()
      expect(convertLegacyOverlays(input)).toBe(input)
    })

    it('returns the very same timeline object when both arrays are absent', () => {
      // A modern project file carries no overlay arrays at all — the headless kit's
      // fixture included, which is why the no-op has to be an identity and not a copy.
      const input = { tracks: [track('t0', 0)], clips: [], duration: 0 } as unknown as Timeline
      expect(convertLegacyOverlays(input)).toBe(input)
    })
  })

  describe('field mapping', () => {
    it('turns a legacy text overlay into an overlay clip, field for field', () => {
      const result = convertLegacyOverlays(timeline({ textOverlays: [text()] }))

      expect(result.clips).toEqual([{
        id: 'legacy-text-text1',
        sourceVideoId: '',
        name: 'Hello',
        startTime: 0,
        endTime: 2,
        duration: 2,
        trackId: 'legacy-overlay-track-1',
        timelinePosition: 1,
        blendMode: 'normal',
        transform: { ...DEFAULT_TRANSFORM, opacity: 0.5 },
        effects: { ...DEFAULT_EFFECTS },
        transition: { ...DEFAULT_TRANSITION },
        overlayType: 'text',
        textData: {
          text: 'Hello',
          x: 0.25, y: 0.75,
          fontFamily: 'Georgia', fontSize: 36, fontWeight: 'bold', fontStyle: 'italic',
          color: '#ff0000', backgroundColor: '#0000ff80', textAlign: 'left',
          // From the defaults, and exactly what the legacy preview loop passed for a text.
          rotation: 0, scale: 1,
        },
      }])
      // A legacy overlay has no keyframes and no preset: the key must be absent,
      // not present-and-undefined (toEqual would not notice the difference).
      expect('animation' in result.clips[0]).toBe(false)
      expect(result.textOverlays).toEqual([])
      expect(result.shapeOverlays).toEqual([])
    })

    it('turns a legacy shape overlay into an overlay clip, field for field', () => {
      const result = convertLegacyOverlays(timeline({ shapeOverlays: [shape()] }))

      expect(result.clips).toEqual([{
        id: 'legacy-shape-shape1',
        sourceVideoId: '',
        name: 'Ellipse',
        startTime: 0,
        endTime: 2,
        duration: 2,
        trackId: 'legacy-overlay-track-1',
        timelinePosition: 0,
        blendMode: 'normal',
        transform: { ...DEFAULT_TRANSFORM, opacity: 0.8 },
        effects: { ...DEFAULT_EFFECTS },
        transition: { ...DEFAULT_TRANSITION },
        overlayType: 'shape',
        shapeData: {
          type: 'ellipse',
          x: 0.4, y: 0.6, width: 0.3, height: 0.2,
          fillColor: '#00ff00ff', strokeColor: '#000000', strokeWidth: 4,
          rotation: 15,
          blurAmount: 0,
        },
      }])
      expect('animation' in result.clips[0]).toBe(false)
    })

    it('gives a blur shape a working blur radius and keeps its stored fill and stroke', () => {
      // The legacy preview's shape loop passed no canvas, so a legacy 'blur' shape
      // drew NOTHING — no fill, no stroke, no blur. Reproducing that faithfully would
      // mean an invisible clip wasting a track, so the conversion deliberately makes
      // it a working blur region at the live default radius of 10 — the value the
      // renderer substitutes for 0 anyway and the one ShapeSection's slider shows.
      // addShapeOverlayClip's other blur overrides (fill '#00000000', strokeWidth 0)
      // are NOT applied: fill and stroke are carried through as stored, so they
      // survive a later type change (they are invisible while the type is 'blur').
      const result = convertLegacyOverlays(timeline({
        shapeOverlays: [shape({ type: 'blur', fillColor: '#123456ff', strokeWidth: 3 })],
      }))

      expect(result.clips[0].name).toBe('Blur Region')
      expect(result.clips[0].shapeData).toMatchObject({
        type: 'blur', fillColor: '#123456ff', strokeWidth: 3, strokeColor: '#000000', blurAmount: 10,
      })
    })

    it('names a clip converted from an empty legacy text \'Text\'', () => {
      // A nameless clip on the timeline is unclickable-looking; addTextOverlayClip
      // falls back the same way. The stored text itself stays verbatim.
      const result = convertLegacyOverlays(timeline({ textOverlays: [text({ text: '   ' })] }))

      expect(result.clips[0].name).toBe('Text')
      expect(result.clips[0].textData?.text).toBe('   ')
    })

    it('clamps a zero-or-negative window to the minimum clip duration', () => {
      const result = convertLegacyOverlays(timeline({ textOverlays: [text({ startTime: 4, endTime: 4 })] }))

      expect(result.clips[0]).toMatchObject({ timelinePosition: 4, duration: 0.1, startTime: 0, endTime: 0.1 })
    })

    it('clamps a negative start time to the beginning of the timeline', () => {
      const result = convertLegacyOverlays(timeline({ textOverlays: [text({ startTime: -2, endTime: 3 })] }))

      expect(result.clips[0]).toMatchObject({ timelinePosition: 0, duration: 5 })
    })

    it('recomputes the timeline duration from the converted clips', () => {
      const result = convertLegacyOverlays(timeline({
        duration: 2,
        clips: [clip('a', 't0', 0, 2)],
        textOverlays: [text({ startTime: 8, endTime: 12 })],
      }))

      // An overlay that reached past the stored duration now extends the timeline —
      // which is the point: that is what gets it exported.
      expect(result.duration).toBe(12)
    })
  })

  describe('track placement', () => {
    it('puts shapes on a lower track than overlapping text, matching the legacy draw order', () => {
      const result = convertLegacyOverlays(timeline({
        textOverlays: [text({ startTime: 0, endTime: 4 })],
        shapeOverlays: [shape({ startTime: 0, endTime: 4 })],
      }))

      expect(result.tracks).toEqual([
        track('t0', 0),
        { id: 'legacy-overlay-track-1', name: 'Overlay', index: 1, visible: true, locked: false, muted: false, volume: 1, height: 60 },
        { id: 'legacy-overlay-track-2', name: 'Overlay 2', index: 2, visible: true, locked: false, muted: false, volume: 1, height: 60 },
      ])
      // Shapes drew under text in the legacy loop; a lower track index is how that
      // same stacking survives as clips.
      expect(result.clips.map((c) => [c.id, c.trackId])).toEqual([
        ['legacy-shape-shape1', 'legacy-overlay-track-1'],
        ['legacy-text-text1', 'legacy-overlay-track-2'],
      ])
    })

    it('stacks converted tracks above every existing track and leaves existing clips alone', () => {
      const existing = [clip('a', 't0', 0, 2), clip('b', 't5', 1, 2)]
      const result = convertLegacyOverlays(timeline({
        tracks: [track('t0', 0), track('t5', 5)],
        clips: existing,
        duration: 3,
        textOverlays: [text()],
      }))

      expect(result.tracks[2].index).toBe(6)
      expect(result.clips.slice(0, 2)).toEqual(existing)
      expect(result.clips[0]).toBe(existing[0]) // untouched, not even copied
      expect(result.clips[2].trackId).toBe('legacy-overlay-track-1')
    })

    it('starts at index 0 when the timeline has no tracks at all', () => {
      const bare = { clips: undefined, tracks: undefined, textOverlays: [text()], shapeOverlays: [], duration: 0 } as unknown as Timeline

      const result = convertLegacyOverlays(bare)

      expect(result.tracks).toEqual([expect.objectContaining({ id: 'legacy-overlay-track-1', index: 0 })])
      expect(result.clips).toHaveLength(1)
    })

    it('spills two overlapping same-kind overlays onto two tracks, the later one above', () => {
      const result = convertLegacyOverlays(timeline({
        textOverlays: [text({ id: 'a', startTime: 0, endTime: 4 }), text({ id: 'b', startTime: 3, endTime: 6 })],
      }))

      expect(result.clips.map((c) => [c.id, c.trackId])).toEqual([
        ['legacy-text-a', 'legacy-overlay-track-1'],
        ['legacy-text-b', 'legacy-overlay-track-2'],
      ])
      expect(result.tracks.map((t) => t.index)).toEqual([0, 1, 2])
    })

    it('shares one track between two same-kind overlays whose windows do not overlap', () => {
      const result = convertLegacyOverlays(timeline({
        textOverlays: [text({ id: 'a', startTime: 0, endTime: 4 }), text({ id: 'b', startTime: 4, endTime: 6 })],
      }))

      // Touching at second 4 is not an overlap: the first clip's window is [0, 4).
      expect(result.clips.map((c) => c.trackId)).toEqual(['legacy-overlay-track-1', 'legacy-overlay-track-1'])
      expect(result.tracks).toHaveLength(2)
    })

    it('keeps every text above every shape even when a shape spills onto a higher track', () => {
      // The inversion this pins: with one shared pool, T (whose window only touches
      // X's) would be reused onto X's low track while S sat above it — a caption
      // vanishing behind a blur region. Shapes and texts get separate reuse pools,
      // so every text track is created after every shape track.
      const result = convertLegacyOverlays(timeline({
        shapeOverlays: [
          shape({ id: 'X', startTime: 0, endTime: 2 }),
          shape({ id: 'S', startTime: 1, endTime: 3 }),
        ],
        textOverlays: [text({ id: 'T', startTime: 2, endTime: 4 })],
      }))

      const indexOf = (trackId: string) => result.tracks.find((t) => t.id === trackId)!.index
      const trackOf = (clipId: string) => indexOf(result.clips.find((c) => c.id === clipId)!.trackId)

      expect(trackOf('legacy-shape-X')).toBe(1)
      expect(trackOf('legacy-shape-S')).toBe(2) // overlaps X, so it spills up
      expect(trackOf('legacy-text-T')).toBe(3)  // above BOTH shapes, not reused onto X's track
      const shapeIndices = ['legacy-shape-X', 'legacy-shape-S'].map(trackOf)
      expect(trackOf('legacy-text-T')).toBeGreaterThan(Math.max(...shapeIndices))
    })

    it('puts a shape and a non-overlapping text on different tracks', () => {
      // The cost of the per-kind pools: these two could have shared one track. A
      // guaranteed text-above-shape ordering is worth the extra track.
      const result = convertLegacyOverlays(timeline({
        shapeOverlays: [shape({ startTime: 0, endTime: 2 })],
        textOverlays: [text({ startTime: 4, endTime: 6 })],
      }))

      expect(result.clips.map((c) => [c.id, c.trackId])).toEqual([
        ['legacy-shape-shape1', 'legacy-overlay-track-1'],
        ['legacy-text-text1', 'legacy-overlay-track-2'],
      ])
    })

    it('skips a track id the timeline already uses', () => {
      const result = convertLegacyOverlays(timeline({
        tracks: [track('legacy-overlay-track-1', 0), track('legacy-overlay-track-2', 1)],
        textOverlays: [text()],
      }))

      expect(result.tracks[2]).toMatchObject({ id: 'legacy-overlay-track-3', name: 'Overlay', index: 2 })
    })
  })

  describe('determinism and idempotence', () => {
    it('produces the same output for two separate copies of the same input', () => {
      const input = timeline({ textOverlays: [text()], shapeOverlays: [shape()] })

      const first = convertLegacyOverlays(structuredClone(input))
      const second = convertLegacyOverlays(structuredClone(input))

      // No uuid anywhere: ids derive from the legacy ids, so a headless render of
      // the same file is byte-reproducible.
      expect(second).toEqual(first)
    })

    it('converges when converted a second time', () => {
      const once = convertLegacyOverlays(timeline({ textOverlays: [text()], shapeOverlays: [shape()] }))

      const twice = convertLegacyOverlays(once)

      expect(twice).toEqual(once)
      expect(twice).toBe(once) // the arrays are empty by now, so it is the identity path
    })

    it('skips a legacy overlay whose converted clip is already on the timeline', () => {
      const already = { ...clip('legacy-text-text1', 't0', 1, 2), overlayType: 'text' as const }
      const result = convertLegacyOverlays(timeline({ clips: [already], duration: 3, textOverlays: [text()] }))

      // Half-converted input converges instead of duplicating: no second clip, no new
      // track, and the arrays are emptied so the next load is a no-op.
      expect(result.clips).toEqual([already])
      expect(result.tracks).toHaveLength(1)
      expect(result.duration).toBe(3)
      expect(result.textOverlays).toEqual([])
      expect(result.shapeOverlays).toEqual([])
    })

    it('converts only the entries that are not already present', () => {
      const already = { ...clip('legacy-shape-shape1', 't0', 0, 2), overlayType: 'shape' as const }
      const result = convertLegacyOverlays(timeline({
        clips: [already],
        shapeOverlays: [shape()],
        textOverlays: [text()],
      }))

      expect(result.clips.map((c) => c.id)).toEqual(['legacy-shape-shape1', 'legacy-text-text1'])
    })
  })
})
