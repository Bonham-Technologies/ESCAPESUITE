// `stackCaptions` (ESCSUITE-473): two visible caption tracks with cues up at
// once are drawn one above the other instead of on the same spot.
import { describe, it, expect } from 'vitest'
import { CAPTION_STACK_GAP, stackCaptions, type StackEntry } from './captionStack'
import { captionStyleFor } from './captions'
import { makeClip, makeTrack } from '../test/fixtures/clipFixtures'
import { DEFAULT_TEXT_OVERLAY_DATA, type Clip, type Track } from '../store/types'

const H = 1080
const style = captionStyleFor({ width: 1920, height: H })
const original = makeTrack({ id: 'original', name: 'Captions', index: 2, kind: 'captions', language: 'en' })
const translation = makeTrack({ id: 'translation', name: 'Captions (Spanish)', index: 1, kind: 'captions', language: 'es' })

const caption = (id: string, track: Track, text: string, more: Partial<Clip['textData']> = {}): StackEntry => ({
  clip: makeClip({
    id,
    sourceVideoId: '',
    trackId: track.id,
    overlayType: 'text',
    textData: { ...DEFAULT_TEXT_OVERLAY_DATA, ...style, text, ...more },
  }),
  track,
})

/** The drawn box, in pixels, as `drawTextOverlayToCanvasAnimated` draws it. */
const box = ({ clip }: StackEntry) => {
  const t = clip.textData!
  const tall = (t.text.split('\n').length * t.fontSize * 1.2 + t.fontSize * 0.6) * (t.scale ?? 1)
  return { top: t.y * H - tall / 2, bottom: t.y * H + tall / 2 }
}

describe('stackCaptions (ESCSUITE-473)', () => {
  it('leaves one caption track alone, returning the same array', () => {
    const active = [caption('a', original, 'Hello'), caption('b', original, 'Again')]
    expect(stackCaptions(active, H)).toBe(active)
  })

  it('keeps the track lower in the timeline in place and raises the one above it clear of it', () => {
    const active = [caption('es', translation, 'Hola'), caption('en', original, 'Hello')]
    const stacked = stackCaptions(active, H)
    const [es, en] = stacked
    expect(es).toBe(active[0])
    expect(es.clip.textData!.y).toBe(style.y)
    expect(en.clip.textData!.y).toBeLessThan(style.y)
    // No overlap, and the gap between them is the stacking gap exactly.
    expect(box(es).top - box(en).bottom).toBeCloseTo(CAPTION_STACK_GAP * H, 6)
    // The clip in the store is not touched: a copy carries the drawn position.
    expect(active[1].clip.textData!.y).toBe(style.y)
    expect(en.clip.id).toBe('en')
  })

  it('clears a two-line translation as well', () => {
    const stacked = stackCaptions([caption('en', original, 'Hello'), caption('es', translation, 'Hola\notra línea')], H)
    expect(box(stacked[1]).top - box(stacked[0]).bottom).toBeCloseTo(CAPTION_STACK_GAP * H, 6)
  })

  it('follows the timeline order, not the order of the list', () => {
    const swapped = [{ ...caption('en', original, 'Hello'), track: { ...original, index: 0 } }, caption('es', translation, 'Hola')]
    const [en, es] = stackCaptions(swapped, H)
    expect(en.clip.textData!.y).toBe(style.y)
    expect(es.clip.textData!.y).toBeLessThan(style.y)
  })

  it('never moves a caption that is already clear of the others', () => {
    const active = [caption('es', translation, 'Hola'), caption('en', original, 'Hello', { y: 0.1 })]
    expect(stackCaptions(active, H)).toBe(active)
  })

  it('ignores hidden tracks by never being handed them, titles on other tracks, and media clips', () => {
    const title = { clip: makeClip({ id: 't', sourceVideoId: '', overlayType: 'text', textData: { ...DEFAULT_TEXT_OVERLAY_DATA, ...style, text: 'Title' } }), track: makeTrack({ id: 'titles', index: 3 }) }
    const media = { clip: makeClip({ id: 'm' }), track: makeTrack({ id: 'video', index: 0 }) }
    const active = [media, caption('en', original, 'Hello'), title]
    expect(stackCaptions(active, H)).toBe(active)
  })

  it('stacks three tracks, each above the last', () => {
    const third = makeTrack({ id: 'third', index: 3, kind: 'captions', language: 'fr' })
    const [es, en, fr] = stackCaptions([caption('es', translation, 'Hola'), caption('en', original, 'Hello'), caption('fr', third, 'Bonjour')], H)
    expect(box(es).top).toBeGreaterThan(box(en).bottom)
    expect(box(en).top).toBeGreaterThan(box(fr).bottom)
  })

  it('does nothing for a frame with no height', () => {
    const active = [caption('es', translation, 'Hola'), caption('en', original, 'Hello')]
    expect(stackCaptions(active, 0)).toBe(active)
  })
})
