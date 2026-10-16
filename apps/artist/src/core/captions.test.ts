// Caption files (ESCSUITE-293): SRT and WebVTT in, the same two formats out.
//
// `parseCaptions` is written from the two formats themselves. What it keeps is
// timing and words; what it cannot represent on an ordinary text clip
// (positioning, styling, regions, notes, speaker names) it drops and names, so
// the importer can say so once. A file it cannot read at all is refused with a
// `CaptionParseError` whose message names the line.
import { describe, it, expect } from 'vitest'
import {
  CaptionParseError,
  captionStyleFor,
  describeDroppedFeatures,
  parseCaptions,
  serializeCaptions,
  wrapCaptionText,
  type CaptionCue,
} from './captions'
import { FONT_OPTIONS } from './fontStacks'

/** The refusal's message, or a failure if it parsed. */
function refusal(text: string, format: 'srt' | 'vtt'): string {
  try {
    parseCaptions(text, format)
  } catch (error) {
    expect(error).toBeInstanceOf(CaptionParseError)
    expect((error as Error).name).toBe('CaptionParseError')
    return (error as Error).message
  }
  throw new Error('expected a CaptionParseError')
}

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:02,500',
  'Hello there.',
  '',
  '2',
  '00:00:03,000 --> 00:00:04,000',
  'Two lines',
  'of text.',
  '',
].join('\n')

describe('parseCaptions — SRT', () => {
  it('reads cues in seconds, with a newline between source lines', () => {
    expect(parseCaptions(SRT, 'srt')).toEqual({
      cues: [
        { start: 1, end: 2.5, text: 'Hello there.' },
        { start: 3, end: 4, text: 'Two lines\nof text.' },
      ],
      dropped: [],
    })
  })

  it('accepts CRLF, a lone CR, a UTF-8 BOM and extra blank lines', () => {
    const messy = '﻿\r\n\r\n1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n\r\n\r\n\r\n2\r00:00:03,000 --> 00:00:04,000\rB\r\n'
    expect(parseCaptions(messy, 'srt').cues).toEqual([
      { start: 1, end: 2, text: 'A' },
      { start: 3, end: 4, text: 'B' },
    ])
  })

  it('treats a blank line of spaces as a block break', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nA\n   \n2\n00:00:03,000 --> 00:00:04,000\nB'
    expect(parseCaptions(text, 'srt').cues.map((c) => c.text)).toEqual(['A', 'B'])
  })

  it('takes indices as optional and in any order, keeping the file order', () => {
    const text = '7\n00:00:05,000 --> 00:00:06,000\nlate\n\n00:00:01,000 --> 00:00:02,000\nno index\n\n2\n00:00:03,000 --> 00:00:04,000\nmiddle'
    expect(parseCaptions(text, 'srt').cues).toEqual([
      { start: 5, end: 6, text: 'late' },
      { start: 1, end: 2, text: 'no index' },
      { start: 3, end: 4, text: 'middle' },
    ])
  })

  it('accepts a full stop as the millisecond separator, short fractions and no hours', () => {
    const text = '00:00:01.5 --> 00:00:02.25\nA\n\n01:02,003 --> 01:03,000\nB'
    expect(parseCaptions(text, 'srt').cues).toEqual([
      { start: 1.5, end: 2.25, text: 'A' },
      { start: 62.003, end: 63, text: 'B' },
    ])
  })

  it('reads hours', () => {
    expect(parseCaptions('01:00:00,000 --> 01:00:01,000\nA', 'srt').cues).toEqual([
      { start: 3600, end: 3601, text: 'A' },
    ])
  })

  it('keeps overlapping cues as they are', () => {
    const text = '00:00:01,000 --> 00:00:03,000\nA\n\n00:00:02,000 --> 00:00:04,000\nB'
    expect(parseCaptions(text, 'srt').cues).toEqual([
      { start: 1, end: 3, text: 'A' },
      { start: 2, end: 4, text: 'B' },
    ])
  })

  it('strips <i>/<b>/<font> tags, keeps the words, and records styling once', () => {
    const text = '00:00:01,000 --> 00:00:02,000\n<i>Hello</i> <b>there</b>\n\n00:00:03,000 --> 00:00:04,000\n<font color="#ff0000">red</font>'
    expect(parseCaptions(text, 'srt')).toEqual({
      cues: [
        { start: 1, end: 2, text: 'Hello there' },
        { start: 3, end: 4, text: 'red' },
      ],
      dropped: ['styling'],
    })
  })

  it('drops coordinates after the timing as positioning', () => {
    expect(parseCaptions('00:00:01,000 --> 00:00:02,000 X1:100 X2:200\nA', 'srt')).toEqual({
      cues: [{ start: 1, end: 2, text: 'A' }],
      dropped: ['positioning'],
    })
  })

  it('leaves entities alone in SRT, which has none', () => {
    expect(parseCaptions('00:00:01,000 --> 00:00:02,000\nTom &amp; Jerry', 'srt').cues[0].text).toBe('Tom &amp; Jerry')
  })

  it('keeps a lone < that opens no tag', () => {
    expect(parseCaptions('00:00:01,000 --> 00:00:02,000\nI <3 this', 'srt').cues[0].text).toBe('I <3 this')
  })

  it('drops a cue that is empty once its tags are gone, and records it', () => {
    const text = '00:00:01,000 --> 00:00:02,000\n<i></i>\n\n00:00:03,000 --> 00:00:04,000\nkept'
    expect(parseCaptions(text, 'srt')).toEqual({
      cues: [{ start: 3, end: 4, text: 'kept' }],
      dropped: ['styling', 'empty-cues'],
    })
  })

  it('drops a cue with timing and no text at all', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\nkept'
    expect(parseCaptions(text, 'srt')).toEqual({
      cues: [{ start: 3, end: 4, text: 'kept' }],
      dropped: ['empty-cues'],
    })
  })

  it('drops one empty line of a two-line cue and keeps the other', () => {
    expect(parseCaptions('00:00:01,000 --> 00:00:02,000\n<i></i>\nkept', 'srt').cues[0].text).toBe('kept')
  })

  it('drops cues that end at or before they start, and records them once', () => {
    const text = [
      '00:00:02,000 --> 00:00:01,000', 'backwards', '',
      '00:00:03,000 --> 00:00:03,000', 'zero', '',
      '00:00:04,000 --> 00:00:05,000', 'kept',
    ].join('\n')
    expect(parseCaptions(text, 'srt')).toEqual({
      cues: [{ start: 4, end: 5, text: 'kept' }],
      dropped: ['inverted-cues'],
    })
  })

  it('treats a text line containing --> after the timing as text', () => {
    expect(parseCaptions('1\n00:00:01,000 --> 00:00:02,000\na --> b', 'srt').cues[0].text).toBe('a --> b')
  })
})

describe('parseCaptions — WebVTT', () => {
  const VTT = 'WEBVTT\n\n00:01.000 --> 00:02.500\nHello there.\n\nid-2\n00:00:03.000 --> 00:00:04.000\nTwo lines\nof text.\n'

  it('reads the header, optional hours and optional cue identifiers', () => {
    expect(parseCaptions(VTT, 'vtt')).toEqual({
      cues: [
        { start: 1, end: 2.5, text: 'Hello there.' },
        { start: 3, end: 4, text: 'Two lines\nof text.' },
      ],
      dropped: [],
    })
  })

  it('accepts header text and header metadata lines', () => {
    const text = 'WEBVTT - Some title\nKind: captions\nLanguage: en\n\n00:01.000 --> 00:02.000\nA'
    expect(parseCaptions(text, 'vtt').cues).toEqual([{ start: 1, end: 2, text: 'A' }])
  })

  it('accepts a comma as the millisecond separator', () => {
    expect(parseCaptions('WEBVTT\n\n00:01,000 --> 00:02,000\nA', 'vtt').cues).toEqual([{ start: 1, end: 2, text: 'A' }])
  })

  it('drops cue settings after the timing as positioning', () => {
    const text = 'WEBVTT\n\n00:01.000 --> 00:02.000 line:10% position:50% align:start size:80% vertical:rl\nA'
    expect(parseCaptions(text, 'vtt')).toEqual({ cues: [{ start: 1, end: 2, text: 'A' }], dropped: ['positioning'] })
  })

  it('drops STYLE, REGION and NOTE blocks and records each', () => {
    const text = [
      'WEBVTT', '',
      'STYLE', '::cue { color: red }', '',
      'REGION', 'id:fred width:40%', '',
      'NOTE this is a comment', 'that runs on', '',
      'NOTE', '',
      '00:01.000 --> 00:02.000', 'A',
    ].join('\n')
    expect(parseCaptions(text, 'vtt')).toEqual({
      cues: [{ start: 1, end: 2, text: 'A' }],
      dropped: ['styling', 'regions', 'notes'],
    })
  })

  it('strips <c>, <b>, <i>, <u>, <ruby>, <rt>, <lang> and timestamp tags, keeping the words', () => {
    const text = 'WEBVTT\n\n00:01.000 --> 00:05.000\n<c.yellow>one</c> <b>two</b> <i>three</i> <u>four</u>\n<ruby>five<rt>5</rt></ruby> <00:00:03.000>six <lang en>seven</lang>'
    expect(parseCaptions(text, 'vtt')).toEqual({
      cues: [{ start: 1, end: 5, text: 'one two three four\nfive5 six seven' }],
      dropped: ['styling'],
    })
  })

  it('drops a voice tag and its speaker name, keeping the words', () => {
    const text = 'WEBVTT\n\n00:01.000 --> 00:02.000\n<v Roger Bingham>We are in New York City</v>\n\n00:03.000 --> 00:04.000\n<v.loud Neil>Hi'
    expect(parseCaptions(text, 'vtt')).toEqual({
      cues: [
        { start: 1, end: 2, text: 'We are in New York City' },
        { start: 3, end: 4, text: 'Hi' },
      ],
      dropped: ['voice-tags'],
    })
  })

  it('decodes the escapes the format defines', () => {
    const text = 'WEBVTT\n\n00:01.000 --> 00:02.000\nTom &amp; Jerry &lt;3 &gt; a&nbsp;b &lrm;&rlm;&quot;'
    expect(parseCaptions(text, 'vtt').cues[0].text).toBe('Tom & Jerry <3 > a b ‎‏&quot;')
  })

  it('lists every dropped feature once, in a fixed order, however often each occurred', () => {
    const text = [
      'WEBVTT', '',
      'NOTE a', '', 'NOTE b', '',
      '00:02.000 --> 00:01.000', 'inverted', '',
      '00:01.000 --> 00:02.000 align:start', '<v A><b></b></v>', '',
      'REGION', 'id:r', '',
      '00:03.000 --> 00:04.000 line:0', '<i>kept</i>',
    ].join('\n')
    expect(parseCaptions(text, 'vtt').dropped).toEqual([
      'positioning', 'styling', 'regions', 'notes', 'voice-tags', 'empty-cues', 'inverted-cues',
    ])
  })

  it('does not treat NOTE, STYLE or REGION as anything special in SRT', () => {
    expect(refusal('NOTE x\n\n00:00:01,000 --> 00:00:02,000\nA', 'srt')).toBe(
      'Line 1: this caption has no timing line (start --> end).'
    )
  })

  it('does not take NOTES (a longer word) for a NOTE block', () => {
    expect(refusal('WEBVTT\n\nNOTES\nx', 'vtt')).toBe('Line 3: this caption has no timing line (start --> end).')
  })
})

describe('parseCaptions — refusals name the line', () => {
  it('refuses an empty file', () => {
    expect(refusal('', 'srt')).toBe('The caption file is empty.')
    expect(refusal('﻿ \r\n\n\t\n', 'vtt')).toBe('The caption file is empty.')
  })

  it('refuses a .vtt without the WEBVTT header', () => {
    expect(refusal('00:01.000 --> 00:02.000\nA', 'vtt')).toBe('Line 1: a WebVTT file must start with "WEBVTT".')
    expect(refusal('\n\nWEBVTTX\n\n00:01.000 --> 00:02.000\nA', 'vtt')).toBe(
      'Line 3: a WebVTT file must start with "WEBVTT".'
    )
  })

  it('refuses a timestamp that does not parse, naming it', () => {
    expect(refusal('1\n00:00:01,000 --> 00:00:02\nA', 'srt')).toBe('Line 2: "00:00:02" is not a caption timestamp.')
    expect(refusal('1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n0:61:00,000 --> 0:62:00,000\nB', 'srt')).toBe(
      'Line 6: "0:61:00,000" is not a caption timestamp.'
    )
    expect(refusal('WEBVTT\n\n00:01.000 -->\nA', 'vtt')).toBe('Line 3: "" is not a caption timestamp.')
  })

  it('refuses an absurd number of hours rather than reading Infinity', () => {
    expect(refusal(`${'9'.repeat(400)}:00:00,000 --> 00:00:01,000\nA`, 'srt')).toMatch(/^Line 1: ".*" is not a caption timestamp\.$/)
  })

  it('refuses a cue block with no timing line', () => {
    expect(refusal('1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\nB\nC', 'srt')).toBe(
      'Line 5: this caption has no timing line (start --> end).'
    )
    expect(refusal('just words', 'srt')).toBe('Line 1: this caption has no timing line (start --> end).')
  })

  it('refuses a file that yields no cues once the drops are made', () => {
    expect(refusal('WEBVTT\n\nNOTE only a note', 'vtt')).toBe('The file has no captions to import.')
    expect(refusal('WEBVTT', 'vtt')).toBe('The file has no captions to import.')
    expect(refusal('00:00:02,000 --> 00:00:01,000\nbackwards', 'srt')).toBe('The file has no captions to import.')
  })
})

describe('serializeCaptions', () => {
  const cues: CaptionCue[] = [
    { start: 1, end: 2.5, text: 'Hello there.' },
    { start: 3661.007, end: 3662, text: 'Two lines\nof text.' },
  ]

  it('writes SRT with 1-based indices and a comma', () => {
    expect(serializeCaptions(cues, 'srt')).toBe(
      '1\n00:00:01,000 --> 00:00:02,500\nHello there.\n\n2\n01:01:01,007 --> 01:01:02,000\nTwo lines\nof text.\n'
    )
  })

  it('writes WebVTT with the header, a full stop and escaped text', () => {
    expect(serializeCaptions([...cues, { start: 5, end: 6, text: 'Tom & Jerry <3 >' }], 'vtt')).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello there.\n\n01:01:01.007 --> 01:01:02.000\nTwo lines\nof text.\n\n' +
        '00:00:05.000 --> 00:00:06.000\nTom &amp; Jerry &lt;3 &gt;\n'
    )
  })

  it('rounds to the millisecond and never writes a negative time', () => {
    expect(serializeCaptions([{ start: -0.2, end: 0.5, text: 'a' }, { start: 1.0006, end: 2, text: 'b' }], 'srt')).toBe(
      '1\n00:00:00,000 --> 00:00:00,500\na\n\n2\n00:00:01,001 --> 00:00:02,000\nb\n'
    )
  })

  it('writes nothing for a cue that rounds to no length, which a reader would drop', () => {
    expect(serializeCaptions([{ start: 3, end: 3.0004, text: 'gone' }, { start: 4, end: 5, text: 'kept' }], 'vtt')).toBe(
      'WEBVTT\n\n00:00:04.000 --> 00:00:05.000\nkept\n'
    )
  })

  it('leaves tags out of SRT, which has no way to write a literal one', () => {
    expect(serializeCaptions([{ start: 1, end: 2, text: 'a <b>bold</b> claim\n<i></i>' }], 'srt')).toBe(
      '1\n00:00:01,000 --> 00:00:02,000\na bold claim\n'
    )
  })

  it('writes hours past 99 in full', () => {
    expect(serializeCaptions([{ start: 360000, end: 360001, text: 'a' }], 'vtt')).toContain('100:00:00.000 --> 100:00:01.000')
  })

  it('writes nothing for a cue with no words, and no blank line inside a cue', () => {
    expect(serializeCaptions([{ start: 1, end: 2, text: ' \n ' }, { start: 3, end: 4, text: 'a\n\n b ' }], 'srt')).toBe(
      '1\n00:00:03,000 --> 00:00:04,000\na\nb\n'
    )
  })

  it('writes no cues as an empty file, or a bare header', () => {
    expect(serializeCaptions([], 'srt')).toBe('')
    expect(serializeCaptions([], 'vtt')).toBe('WEBVTT\n')
  })

  it.each(['srt', 'vtt'] as const)('is round-trip stable on its own output (%s)', (format) => {
    const messy: CaptionCue[] = [
      { start: 0.0004, end: 1.9996, text: 'Tom & Jerry <b>not a tag</b>' },
      { start: 1.5, end: 3, text: 'overlap\n  two lines ' },
      { start: 10, end: 12.3456, text: 'a --> b\r\nCR line' },
      { start: 13, end: 14, text: '&nbsp; literal \u00a0' },
      { start: 4, end: 4.0001, text: 'rounds to nothing' },
    ]
    const once = serializeCaptions(messy, format)
    const twice = serializeCaptions(parseCaptions(once, format).cues, format)
    expect(twice).toBe(once)
  })

  it('round-trips what it parsed, through either format', () => {
    const parsed = parseCaptions(SRT, 'srt').cues
    expect(parseCaptions(serializeCaptions(parsed, 'vtt'), 'vtt').cues).toEqual(parsed)
    expect(parseCaptions(serializeCaptions(parsed, 'srt'), 'srt').cues).toEqual(parsed)
  })
})

describe('wrapCaptionText', () => {
  it('leaves a line within the limit alone', () => {
    expect(wrapCaptionText('Short enough.')).toBe('Short enough.')
  })

  it('wraps a long line at word boundaries at 42 characters by default', () => {
    const line = 'The quick brown fox jumps over the lazy dog and keeps on running'
    const wrapped = wrapCaptionText(line)
    expect(wrapped).toBe('The quick brown fox jumps over the lazy\ndog and keeps on running')
    for (const part of wrapped.split('\n')) expect(part.length).toBeLessThanOrEqual(42)
  })

  it('fills a line to exactly the limit', () => {
    expect(wrapCaptionText('aaaa bbbb cccc', 9)).toBe('aaaa bbbb\ncccc')
  })

  it('keeps source line breaks and wraps each line on its own', () => {
    expect(wrapCaptionText('one two three\nfour five', 9)).toBe('one two\nthree\nfour five')
  })

  it('keeps a single word longer than the limit whole', () => {
    expect(wrapCaptionText('Supercalifragilistic is long', 10)).toBe('Supercalifragilistic\nis long')
    expect(wrapCaptionText('a Supercalifragilistic', 10)).toBe('a\nSupercalifragilistic')
  })

  it('collapses runs of spaces and keeps an empty line empty', () => {
    expect(wrapCaptionText('a    b\n\nc')).toBe('a b\n\nc')
  })
})

describe('captionStyleFor', () => {
  it('is centred near the bottom, white on translucent black, sized to the height', () => {
    expect(captionStyleFor({ width: 1920, height: 1080 })).toEqual({
      x: 0.5,
      y: 0.88,
      textAlign: 'center',
      fontSize: 49,
      fontFamily: 'Arial',
      color: '#ffffff',
      backgroundColor: '#000000b3',
      fontWeight: 'normal',
      fontStyle: 'normal',
    })
  })

  it('scales the font with the project height', () => {
    expect(captionStyleFor({ width: 1280, height: 720 }).fontSize).toBe(32)
    expect(captionStyleFor({ width: 3840, height: 2160 }).fontSize).toBe(97)
  })

  it('uses the first font the inspector offers', () => {
    expect(captionStyleFor({ width: 1, height: 1 }).fontFamily).toBe(FONT_OPTIONS[0].value)
  })
})

describe('describeDroppedFeatures', () => {
  it('names one feature with its own verb', () => {
    expect(describeDroppedFeatures(['positioning'])).toBe('Positioning was not imported.')
    expect(describeDroppedFeatures(['notes'])).toBe('Notes were not imported.')
  })

  it('names two with "and", and more with commas', () => {
    expect(describeDroppedFeatures(['positioning', 'styling'])).toBe('Positioning and styling were not imported.')
    expect(
      describeDroppedFeatures(['positioning', 'styling', 'regions', 'notes', 'voice-tags', 'empty-cues', 'inverted-cues'])
    ).toBe(
      'Positioning, styling, regions, notes, speaker names, empty captions and captions that end before they start were not imported.'
    )
  })
})
