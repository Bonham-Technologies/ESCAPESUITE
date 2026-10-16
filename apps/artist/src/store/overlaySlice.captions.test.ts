// `addCaptionCues` (ESCSUITE-293): a whole caption file onto the caption track
// in one write. `addTextOverlayClip` pushes a history entry and moves the
// selection per call, so an import of three hundred cues through it would be
// three hundred undo steps; this is one.
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import { DEFAULT_TEXT_OVERLAY_DATA } from './types'
import { captionStyleFor, type CaptionCue } from '../core/captions'

const state = () => useEditorStore.getState()
const style = captionStyleFor({ width: 1920, height: 1080 })

const cues: CaptionCue[] = [
  { start: 1, end: 2.5, text: 'Hello there.' },
  { start: 3, end: 4, text: 'Two lines\nof text.' },
]

beforeEach(() => {
  state().resetProject()
  useEditorStore.setState({ history: { past: [], future: [] }, selectedClipId: null })
})

describe('addCaptionCues (ESCSUITE-293)', () => {
  it('creates one Captions track at the top, marked as the caption track, on the first import', () => {
    const [first] = state().project.timeline.tracks

    const result = state().addCaptionCues(cues, style)

    const tracks = state().project.timeline.tracks
    expect(tracks).toHaveLength(2)
    const captions = tracks[1]
    expect(captions).toMatchObject({ name: 'Captions', kind: 'captions', index: first.index + 1, locked: false, visible: true })
    expect(result).toEqual({ trackId: captions.id, added: 2 })
  })

  it('does not take an empty ordinary track, the way a text clip would', () => {
    // The default project's one track is empty: `findEmptyTrack` would hand it
    // to `addTextOverlayClip`. A caption import keeps to its own track.
    const [first] = state().project.timeline.tracks
    const { trackId } = state().addCaptionCues(cues, style)!
    expect(trackId).not.toBe(first.id)
  })

  it('makes each cue an ordinary text clip at its own time, in the caption style', () => {
    const { trackId } = state().addCaptionCues(cues, style)!

    const clips = state().project.timeline.clips
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({
      sourceVideoId: '',
      overlayType: 'text',
      name: 'Hello there.',
      trackId,
      timelinePosition: 1,
      duration: 1.5,
      startTime: 0,
      endTime: 1.5,
      blendMode: 'normal',
      textData: { ...DEFAULT_TEXT_OVERLAY_DATA, ...style, text: 'Hello there.' },
    })
    expect(clips[1]).toMatchObject({ timelinePosition: 3, duration: 1, textData: { text: 'Two lines\nof text.', y: 0.88 } })
    expect(new Set(clips.map((clip) => clip.id)).size).toBe(2)
    expect(state().project.timeline.duration).toBe(4)
  })

  it('is one undo step, and leaves the selection where it was', () => {
    useEditorStore.setState({ selectedClipId: 'something-else' })

    state().addCaptionCues(cues, style)

    expect(state().history.past).toHaveLength(1)
    expect(state().selectedClipId).toBe('something-else')

    state().undo()
    expect(state().project.timeline.clips).toHaveLength(0)
    expect(state().project.timeline.tracks.some((track) => track.kind === 'captions')).toBe(false)
  })

  it('appends to the caption track it already has, never making a second one', () => {
    const { trackId } = state().addCaptionCues(cues, style)!

    const again = state().addCaptionCues([{ start: 5, end: 6, text: 'More.' }], style)

    expect(again).toEqual({ trackId, added: 1 })
    expect(state().project.timeline.tracks.filter((track) => track.kind === 'captions')).toHaveLength(1)
    expect(state().project.timeline.clips.map((clip) => clip.trackId)).toEqual([trackId, trackId, trackId])
    expect(state().history.past).toHaveLength(2)
  })

  it('still adds to a hidden caption track — hiding it is how a sidecar-only caption is kept off the picture', () => {
    const { trackId } = state().addCaptionCues(cues, style)!
    state().updateTrack(trackId, { visible: false })

    expect(state().addCaptionCues(cues, style)).toEqual({ trackId, added: 2 })
  })

  // Review M2: emptied of captions, the track is still the caption track. A
  // title or a video looking for an empty track must not land there — the
  // sidecar would write a title as a caption, and the next import would sit
  // beside a video.
  it('is never handed out as an empty track once its captions are gone', () => {
    const title = state().addTextOverlayClip({ text: 'Title' })!
    const { trackId } = state().addCaptionCues(cues, style)!
    for (const clip of state().project.timeline.clips.filter((c) => c.trackId === trackId)) {
      state().removeClipFromTimeline(clip.id)
    }

    const next = state().addTextOverlayClip({ text: 'Another' })!

    expect(next.trackId).not.toBe(trackId)
    expect(next.trackId).not.toBe(title.trackId)
    expect(state().project.timeline.tracks.find((track) => track.id === next.trackId)?.name).toBe('Text')
  })

  it('refuses when the caption track is locked, writing nothing', () => {
    const { trackId } = state().addCaptionCues(cues, style)!
    state().updateTrack(trackId, { locked: true })
    const project = state().project
    const entries = state().history.past.length

    expect(state().addCaptionCues(cues, style)).toBeNull()

    expect(state().project).toBe(project)
    expect(state().history.past).toHaveLength(entries)
  })
})
