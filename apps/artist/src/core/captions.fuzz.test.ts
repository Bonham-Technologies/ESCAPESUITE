// Seeded mutation fuzz for the caption parser (ESCSUITE-293), on the house
// harness (src/test/fuzz.ts, ESCSUITE-294). Every input starts as a real .srt
// or .vtt, is turned into bytes, truncated, bit-flipped, has four bytes read
// as a little-endian length and moved, or has two ranges swapped, and is then
// decoded back to text the way a browser decodes a dropped file — UTF-8, not
// fatal, so a broken sequence becomes U+FFFD rather than an error.
//
// The contract: `parseCaptions` returns, or throws a `CaptionParseError` with
// a message (which the importer shows as it is); nothing else escapes. What it
// returns is cues an editor can hold — finite, non-negative times with the end
// after the start, words on every line, each dropped feature once — and
// `serializeCaptions` writes them out in that format so that they read back as
// exactly the same cues, save for the writer's documented changes (a `-->`
// written as `→`; in SRT, tag-shaped text read back as markup), where every
// cue read back is still one that was written, in order.
//
// A failure prints the seed, the iteration and the mutation; rerun this file
// to reproduce it.
import { describe, it } from 'vitest'
import {
  CaptionParseError,
  parseCaptions,
  serializeCaptions,
  type CaptionFormat,
  type DroppedFeature,
  type ParsedCaptions,
} from './captions'
import {
  createRng,
  expectNamedRefusal,
  expectTallyAtLeast,
  flipBit,
  fuzzFailure,
  resizeDeclared,
  swapRanges,
  truncateAt,
  type FuzzContext,
  type Mutated,
  type Rng,
} from '../test/fuzz'

const ITERATIONS = 1000
const SEEDS: Record<CaptionFormat, number> = { srt: 0x5eed2930, vtt: 0x5eed2931 }
// Each loop's outcomes on its committed seed, measured 2026-10-16: SRT parsed
// 409 mutated files and refused 591; WebVTT parsed 449 and refused 551.
// Re-measured the same day after review round 1: SRT 416 / 584, WebVTT
// unchanged at 449 / 551. The seven SRT files that moved are truncations that
// end on the next cue's lone index, which the M5 ruling ignores rather than
// refuses; the timing-line split (I2) and the bounded tag grammar (M1) moved
// no outcome on either seed. The floors
// ARE those counts: the seed is fixed, so a parser that turns lenient anywhere
// (a timestamp check skipped) drops `refused` below its floor, and one that
// turns strict drops `accepted`. A change that moves an input across the line
// on purpose updates the numbers here and says why, as a per-frame ceiling does.
const FLOORS: Record<CaptionFormat, { accepted: number; refused: number }> = {
  srt: { accepted: 416, refused: 584 },
  vtt: { accepted: 449, refused: 551 },
}

const BASES: Record<CaptionFormat, string> = {
  srt: [
    '\uFEFF1',
    '00:00:01,000 --> 00:00:02,500',
    '<i>Hello</i> there.',
    '',
    '2',
    '00:00:03,000 --> 00:00:04,000 X1:10 X2:20',
    'Two lines',
    'of <b>text</b>.',
    '',
    '3',
    '01:00:05,250 --> 01:00:06,000',
    'Ünïcödé — and a <3',
    '',
  ].join('\r\n'),
  vtt: [
    'WEBVTT - fuzz',
    'Kind: captions',
    '',
    'STYLE',
    '::cue { color: yellow }',
    '',
    'NOTE a comment',
    '',
    'cue-1',
    '00:01.000 --> 00:02.500 align:start line:90%',
    '<v Ann>Hello</v> <c.loud>there</c>.',
    '',
    '00:00:03.000 --> 00:00:04.000',
    'Tom &amp; Jerry',
    '<00:00:03.500>two',
    '',
    'REGION',
    'id:r width:40%',
    '',
    '01:00:05.250 --> 01:00:06.000',
    'Ünïcödé — &lt;3',
    '',
  ].join('\n'),
}

const VOCABULARY = new Set<DroppedFeature>([
  'positioning', 'styling', 'regions', 'notes', 'voice-tags', 'empty-cues', 'inverted-cues',
])

const encode = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(bytes)

/** One random mutation of `base`'s bytes. */
function mutateBytes(rng: Rng, base: Uint8Array<ArrayBuffer>): Mutated<Uint8Array<ArrayBuffer>> {
  const size = base.length
  switch (rng.int(5)) {
    case 0: {
      const at = rng.int(size + 1)
      return { value: truncateAt(base, at), description: `truncateAt ${at} of ${size}` }
    }
    case 1: {
      const bit = rng.int(size * 8)
      return { value: flipBit(base, bit), description: `flipBit ${bit} (byte ${bit >> 3})` }
    }
    case 2: {
      // A few flips at once: one bit is often a dull change of one letter.
      let value = base
      const bits: number[] = []
      for (let n = 2 + rng.int(6); n > 0; n--) {
        bits.push(rng.int(size * 8))
        value = flipBit(value, bits[bits.length - 1])
      }
      return { value, description: `flipBit ${bits.join(', ')}` }
    }
    case 3: {
      // Text has no length fields; this moves four arbitrary bytes by an
      // arithmetic amount, which lands on digits, separators and line breaks.
      const offset = rng.int(size - 3)
      const delta = rng.pick([1, -1, 9, -9, 0x100, -0x100, 0x10000, 0x1000000, -0x1000000])
      return { value: resizeDeclared(base, offset, delta), description: `resizeDeclared at ${offset} by ${delta}` }
    }
    default: {
      const [p0, p1, p2, p3] = [rng.int(size + 1), rng.int(size + 1), rng.int(size + 1), rng.int(size + 1)].sort((x, y) => x - y)
      const a = { offset: p0, length: p1 - p0 }
      const b = { offset: p2, length: p3 - p2 }
      return { value: swapRanges(base, a, b), description: `swapRanges [${p0}, ${p1}) with [${p2}, ${p3})` }
    }
  }
}

/** The shape half of the contract, for one parse that returned. */
function checkParsed(parsed: ParsedCaptions, format: CaptionFormat, context: FuzzContext): void {
  if (parsed.cues.length === 0) throw fuzzFailure(context, 'returned no cues instead of refusing')
  for (const [i, cue] of parsed.cues.entries()) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || !(cue.end > cue.start)) {
      throw fuzzFailure(context, `cue ${i} has times ${cue.start} --> ${cue.end}`)
    }
    if (cue.text.split('\n').some((line) => line.trim() === '' || line !== line.trim())) {
      throw fuzzFailure(context, `cue ${i} has a blank or untrimmed line: ${JSON.stringify(cue.text)}`)
    }
  }
  if (new Set(parsed.dropped).size !== parsed.dropped.length || parsed.dropped.some((d) => !VOCABULARY.has(d))) {
    throw fuzzFailure(context, `dropped is not a set of known features: ${parsed.dropped.join(', ')}`)
  }
  // The writer's documented changes: a `-->` is written as `→` (both formats),
  // and SRT, which has no escapes, writes tag-shaped text as it is, to be read
  // back as markup. WebVTT escapes it (fix round 3). So WebVTT reads back
  // exactly unless a cue holds a `-->`, and SRT unless one holds a `-->` or a
  // `<`; otherwise words may be lost, and a cue left with none is dropped, but
  // every cue that comes back is one that was written, in order.
  const written = serializeCaptions(parsed.cues, format)
  const mayChange = parsed.cues.some((cue) => (format === 'vtt' ? /-->/ : /-->|</).test(cue.text))
  // Only SRT's tag-shape loss can take a cue's every word, and so every cue
  // (a `-->` written as `→` loses nothing); any other refusal of the writer's
  // own output breaks the contract.
  const mayLoseWords = format === 'srt' && parsed.cues.some((cue) => cue.text.includes('<'))
  let reread: ParsedCaptions
  try {
    reread = parseCaptions(written, format)
  } catch (error) {
    if (mayLoseWords && error instanceof CaptionParseError) return
    throw fuzzFailure(context, `its own serialization was refused: ${(error as Error).message}`)
  }
  if (!mayChange) {
    if (JSON.stringify(reread.cues) !== JSON.stringify(parsed.cues)) {
      throw fuzzFailure(context, 'its serialization read back as different cues')
    }
    return
  }
  let w = 0
  for (const cue of reread.cues) {
    while (w < parsed.cues.length && (parsed.cues[w].start !== cue.start || parsed.cues[w].end !== cue.end)) w++
    if (w === parsed.cues.length) throw fuzzFailure(context, `its serialization read back a cue it did not write: ${cue.start} --> ${cue.end}`)
    w++
  }
}

const isCaptionParseError = (error: unknown) => error instanceof CaptionParseError

describe.each(['srt', 'vtt'] as const)('parseCaptions (%s) under seeded mutation (ESCSUITE-293)', (format) => {
  const base = encode(BASES[format])
  const seed = SEEDS[format]

  it('parses the unmutated file, so every mutation starts from a real one', () => {
    checkParsed(parseCaptions(BASES[format], format), format, { seed, iteration: -1, mutation: 'none' })
  })

  it(`parses or refuses ${ITERATIONS} mutated files with a CaptionParseError, and nothing else`, async () => {
    const rng = createRng(seed)
    const tally = { accepted: 0, refused: 0 }
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const { value, description } = mutateBytes(rng, base)
      const context = { seed, iteration, mutation: description }
      const outcome = await expectNamedRefusal(() => parseCaptions(decode(value), format), isCaptionParseError, context)
      if (outcome.ok) {
        checkParsed(outcome.value, format, context)
        tally.accepted++
      } else {
        tally.refused++
      }
    }
    expectTallyAtLeast(tally, FLOORS[format], seed)
  })
})
