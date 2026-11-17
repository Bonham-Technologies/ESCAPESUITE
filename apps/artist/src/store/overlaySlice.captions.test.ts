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

  // ESCSUITE-442: transcribing a second time used to stack a second copy of
  // every caption. "Replace" takes the old cues off and puts the new ones on
  // in the same write, so one undo puts the old ones back.
  describe('with replace (ESCSUITE-442)', () => {
    const newer: CaptionCue[] = [{ start: 0.5, end: 2, text: 'A newer take.' }]
    const onCaptions = (trackId: string) =>
      state().project.timeline.clips.filter((clip) => clip.trackId === trackId)

    it('takes every clip off the Captions track and adds the new cues, as one undo step', () => {
      const { trackId } = state().addCaptionCues(cues, style)!
      const before = onCaptions(trackId)
      const entries = state().history.past.length

      expect(state().addCaptionCues(newer, style, { replace: true })).toEqual({ trackId, added: 1 })

      expect(onCaptions(trackId).map((clip) => clip.name)).toEqual(['A newer take.'])
      expect(state().history.past).toHaveLength(entries + 1)
      expect(state().project.timeline.duration).toBe(2)

      state().undo()
      expect(onCaptions(trackId)).toEqual(before)
    })

    it('leaves every other track alone', () => {
      const title = state().addTextOverlayClip({ text: 'Title' })!
      state().addCaptionCues(cues, style)

      state().addCaptionCues(newer, style, { replace: true })

      expect(state().project.timeline.clips.map((clip) => clip.id)).toContain(title.id)
      expect(state().project.timeline.clips).toHaveLength(2)
    })

    it('keeps a video or audio clip the user moved onto the Captions track', () => {
      // `moveClipToTrack` does not check the track's kind, so a non-text clip
      // can sit there. It is not a caption, and Replace must not delete it.
      const { trackId } = state().addCaptionCues(cues, style)!
      const [cue] = onCaptions(trackId)
      const { overlayType: _overlay, textData: _text, ...rest } = cue
      const audio = { ...rest, id: 'moved-audio', sourceVideoId: 'source-1', name: 'speech.wav' }
      useEditorStore.setState({
        project: {
          ...state().project,
          timeline: { ...state().project.timeline, clips: [...state().project.timeline.clips, audio] },
        },
      })

      state().addCaptionCues(newer, style, { replace: true })

      expect(onCaptions(trackId).map((clip) => clip.id)).toContain('moved-audio')
      expect(onCaptions(trackId).filter((clip) => clip.overlayType === 'text').map((clip) => clip.name)).toEqual([
        'A newer take.',
      ])
    })

    it('drops a removed cue from the selection', () => {
      const { trackId } = state().addCaptionCues(cues, style)!
      const [first, second] = onCaptions(trackId)
      useEditorStore.setState({ selectedClipId: first.id, selectedClipIds: new Set([first.id, second.id]) })

      state().addCaptionCues(newer, style, { replace: true })

      expect(state().selectedClipId).toBeNull()
      expect(state().selectedClipIds.size).toBe(0)
    })

    it('creates the track as an ordinary import does when there is none yet', () => {
      const result = state().addCaptionCues(newer, style, { replace: true })

      expect(result?.added).toBe(1)
      expect(state().project.timeline.tracks.filter((track) => track.kind === 'captions')).toHaveLength(1)
      expect(state().history.past).toHaveLength(1)
    })

    it('refuses on a locked Captions track, removing nothing', () => {
      const { trackId } = state().addCaptionCues(cues, style)!
      state().updateTrack(trackId, { locked: true })
      const project = state().project

      expect(state().addCaptionCues(newer, style, { replace: true })).toBeNull()
      expect(state().project).toBe(project)
    })
  })
})

// ESCSUITE-473: a caption track says what language it is in.
describe('addCaptionCues with a language (ESCSUITE-473)', () => {
  const captionTrack = () => state().project.timeline.tracks.find((track) => track.kind === 'captions')!

  it('marks a new caption track with it, and an import without one leaves the track unmarked', () => {
    state().addCaptionCues(cues, style)
    expect('language' in captionTrack()).toBe(false)
    state().resetProject()
    state().addCaptionCues(cues, style, { language: 'en-US' })
    expect(captionTrack().language).toBe('en-US')
  })

  it('names an unmarked track on an add, keeps a marked one on an add, and takes the new one on a replace', () => {
    state().addCaptionCues(cues, style)
    state().addCaptionCues(cues, style, { language: 'de-DE' })
    expect(captionTrack().language).toBe('de-DE')
    state().addCaptionCues(cues, style, { language: 'fr-FR' })
    expect(captionTrack().language).toBe('de-DE')
    state().addCaptionCues(cues, style, { language: 'fr-FR', replace: true })
    expect(captionTrack().language).toBe('fr-FR')
    state().undo()
    expect(captionTrack().language).toBe('de-DE')
  })
})

describe('addCaptionTranslation (ESCSUITE-473)', () => {
  const setup = () => {
    const { trackId } = state().addCaptionCues(
      [
        { start: 1.234567, end: 2.5, text: 'Hello there.' },
        { start: 3, end: 4.000001, text: 'Two lines\nof text.' },
      ],
      style,
      { language: 'en-US' }
    )!
    const source = state().project.timeline.clips.filter((clip) => clip.trackId === trackId)
    useEditorStore.setState({ history: { past: [], future: [] } })
    return { trackId, source }
  }

  it('adds a second caption track, marked with its language, whose cues keep the source times exactly', () => {
    const { trackId, source } = setup()
    const result = state().addCaptionTranslation(
      trackId,
      source.map((clip, i) => ({ clipId: clip.id, text: ['Hola.', 'Dos líneas\nde texto.'][i] })),
      { language: 'es', trackName: 'Captions (Spanish)' }
    )!
    const tracks = state().project.timeline.tracks
    const translation = tracks.find((track) => track.id === result.trackId)!
    expect(result.added).toBe(2)
    expect(translation).toMatchObject({ kind: 'captions', language: 'es', name: 'Captions (Spanish)', visible: true, locked: false })
    const added = state().project.timeline.clips.filter((clip) => clip.trackId === result.trackId)
    expect(added.map((clip) => [clip.timelinePosition, clip.duration, clip.startTime, clip.endTime])).toEqual(
      source.map((clip) => [clip.timelinePosition, clip.duration, clip.startTime, clip.endTime])
    )
    expect(added.map((clip) => clip.textData!.text)).toEqual(['Hola.', 'Dos líneas\nde texto.'])
    expect(added.map((clip) => clip.name)).toEqual(['Hola.', 'Dos líneas\nde texto.'])
    // The source's style carries over; only the words change.
    expect({ ...added[0].textData, text: '' }).toEqual({ ...source[0].textData, text: '' })
    expect(added.every((clip) => !source.some((s) => s.id === clip.id))).toBe(true)
    // The source is untouched, and still the first caption track (the one imports and transcription use).
    expect(state().project.timeline.clips.filter((clip) => clip.trackId === trackId)).toEqual(source)
    expect(tracks.find((track) => track.kind === 'captions')!.id).toBe(trackId)
  })

  it('goes directly below the source in the timeline, moving every track from the source up', () => {
    state().addTrack('Above')
    const before = state().project.timeline.tracks
    const { trackId, source } = setup()
    const sourceIndex = state().project.timeline.tracks.find((track) => track.id === trackId)!.index
    const { trackId: translationId } = state().addCaptionTranslation(trackId, [{ clipId: source[0].id, text: 'Hola.' }], {
      language: 'es',
      trackName: 'Captions (Spanish)',
    })!
    const tracks = state().project.timeline.tracks
    const index = (id: string) => tracks.find((track) => track.id === id)!.index
    expect(index(translationId)).toBe(sourceIndex)
    expect(index(trackId)).toBe(sourceIndex + 1)
    for (const track of before) expect(index(track.id)).toBe(track.index)
    expect(new Set(tracks.map((track) => track.index)).size).toBe(tracks.length)
  })

  it('is one undo step, and leaves the selection where it was', () => {
    const { trackId, source } = setup()
    useEditorStore.setState({ selectedClipId: source[0].id })
    const before = state().project
    state().addCaptionTranslation(trackId, source.map((clip) => ({ clipId: clip.id, text: 'x' })), {
      language: 'es',
      trackName: 'Captions (Spanish)',
      sourceLanguage: 'en',
    })
    expect(state().history.past).toHaveLength(1)
    expect(state().selectedClipId).toBe(source[0].id)
    state().undo()
    expect(state().project.timeline).toEqual(before.timeline)
  })

  it('writes a confirmed source language to the source track, unless it is locked', () => {
    state().addCaptionCues(cues, style)
    const source = state().project.timeline.tracks.find((track) => track.kind === 'captions')!
    const clip = state().project.timeline.clips.find((c) => c.trackId === source.id)!
    state().addCaptionTranslation(source.id, [{ clipId: clip.id, text: 'Hola' }], { language: 'es', trackName: 'S', sourceLanguage: 'en' })
    expect(state().project.timeline.tracks.find((track) => track.id === source.id)!.language).toBe('en')

    state().resetProject()
    state().addCaptionCues(cues, style)
    const locked = state().project.timeline.tracks.find((track) => track.kind === 'captions')!
    const lockedClip = state().project.timeline.clips.find((c) => c.trackId === locked.id)!
    state().updateTrack(locked.id, { locked: true })
    const result = state().addCaptionTranslation(locked.id, [{ clipId: lockedClip.id, text: 'Hola' }], {
      language: 'es',
      trackName: 'S',
      sourceLanguage: 'en',
    })
    // A locked source still gets its translation (a new track); only its own marker is left alone.
    expect(result?.added).toBe(1)
    expect('language' in state().project.timeline.tracks.find((track) => track.id === locked.id)!).toBe(false)
  })

  it('writes nothing when the source track is gone or none of the named clips is on it', () => {
    const { trackId } = setup()
    expect(state().addCaptionTranslation('no-such-track', [], { language: 'es', trackName: 'S' })).toBeNull()
    expect(state().addCaptionTranslation(trackId, [{ clipId: 'gone', text: 'x' }], { language: 'es', trackName: 'S' })).toBeNull()
    expect(state().history.past).toHaveLength(0)
    expect(state().project.timeline.tracks.filter((track) => track.kind === 'captions')).toHaveLength(1)
  })
})
