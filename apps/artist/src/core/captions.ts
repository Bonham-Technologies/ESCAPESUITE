// Caption files (ESCSUITE-293): SubRip (.srt) and WebVTT (.vtt), read into
// cues and written back out. Pure — no DOM, no store — so the importer, the
// export dialog's sidecar and the fuzz test all drive the same functions.
//
// Written from the two formats themselves. What survives an import is what an
// ordinary text clip can carry: when a caption starts and ends, and its words,
// a line break wherever the source had one. Everything else a file can say —
// where a cue sits, how it is styled, regions, comments, who is speaking — is
// dropped and *named* (`DroppedFeature`), so the importer can tell the user once
// what did not come across. A file that cannot be read at all is refused with a
// `CaptionParseError` whose message names the line.
import type { TextOverlayData } from '../store/types';
import { FONT_OPTIONS } from './fontStacks';

export type CaptionFormat = 'srt' | 'vtt';

/** One caption: seconds from the start of the timeline, and its text with `\n` between lines. */
export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

/** Something a caption file said that an import does not keep. */
export type DroppedFeature =
  | 'positioning'
  | 'styling'
  | 'regions'
  | 'notes'
  | 'voice-tags'
  | 'empty-cues'
  | 'inverted-cues';

/** The order `parseCaptions` lists them in, whatever order the file raised them. */
const DROPPED_ORDER: readonly DroppedFeature[] = [
  'positioning',
  'styling',
  'regions',
  'notes',
  'voice-tags',
  'empty-cues',
  'inverted-cues',
];

export interface ParsedCaptions {
  cues: CaptionCue[];
  /** Each feature the file used that was not imported, once. */
  dropped: DroppedFeature[];
}

/** The one refusal `parseCaptions` makes; its message is shown to the user as it is. */
export class CaptionParseError extends Error {
  name = 'CaptionParseError';
}

/**
 * `[hh:]mm:ss(,|.)fff`. Hours are optional in both formats (WebVTT allows it,
 * and an SRT without them is unambiguous); at most five digits of them, so a
 * mangled file cannot read as `Infinity` seconds. The fraction is one to three
 * digits of a second, `.5` being half of one.
 */
const TIMESTAMP = /^(?:(\d{1,5}):)?([0-5]\d):([0-5]\d)[,.](\d{1,3})$/;

/** Any markup tag: `<b>`, `</i>`, `<c.yellow>`, `<v Name>`, `<00:00:03.000>`, `<font color=…>`. */
const TAG = /<[^>]*>/g;

/** A voice tag, opening or closing — the speaker's name is in it, and goes with it. */
const VOICE_TAG = /^<\/?v[\s.>]/;

/** The WebVTT escapes, decoded in one pass so `&amp;lt;` reads as `&lt;` and not `<`. */
const VTT_ENTITY = /&(amp|lt|gt|nbsp|lrm|rlm);/g;
const VTT_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: '\u00a0',
  lrm: '\u200e',
  rlm: '\u200f',
};

/** A WebVTT block that is not a cue, and the feature dropping it records. */
const VTT_SPECIAL_BLOCK = /^(NOTE|STYLE|REGION)(?:[ \t]|$)/;
const VTT_SPECIAL_DROPS: Record<string, DroppedFeature> = {
  NOTE: 'notes',
  STYLE: 'styling',
  REGION: 'regions',
};

const VTT_HEADER = /^WEBVTT(?:[ \t].*)?$/;

/** Line breaks in any of the three spellings, as `\n`. */
const lines = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n');

interface Block {
  /** 1-based line number of the block's first line. */
  line: number;
  lines: string[];
}

/** The file's lines grouped into blocks, a blank (or whitespace-only) line between each. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  lines(text).forEach((content, i) => {
    if (content.trim() === '') {
      current = null;
      return;
    }
    if (!current) {
      current = { line: i + 1, lines: [] };
      blocks.push(current);
    }
    current.lines.push(content);
  });
  return blocks;
}

/** A timestamp in seconds, or `null` when the token is not one. */
function readTimestamp(token: string): number | null {
  const match = TIMESTAMP.exec(token);
  if (!match) return null;
  const [, hours = '0', minutes, seconds, fraction] = match;
  const ms =
    Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(fraction.padEnd(3, '0'));
  return ms / 1000;
}

function parseTimestamp(token: string, line: number): number {
  const seconds = readTimestamp(token);
  if (seconds === null) {
    throw new CaptionParseError(`Line ${line}: "${token.slice(0, 40)}" is not a caption timestamp.`);
  }
  return seconds;
}

/** The text either side of a timing line's first `-->`: the start, then the end and any settings. */
function timingParts(line: string, arrow: number): [start: string, end: string, settings: string[]] {
  const [end, ...settings] = line.slice(arrow + 3).trim().split(/[ \t]+/);
  return [line.slice(0, arrow).trim(), end, settings];
}

/**
 * Whether a line is a timing line: a `-->` with a timestamp on each side.
 * Met inside a cue's text it starts the next cue — the WebVTT rule, applied to
 * both formats, so a file missing the blank line between two cues does not
 * import as one caption carrying the second's timing as words (review I2).
 */
function isTimingLine(line: string): boolean {
  const arrow = line.indexOf('-->');
  if (arrow < 0) return false;
  const [start, end] = timingParts(line, arrow);
  return readTimestamp(start) !== null && readTimestamp(end) !== null;
}

/**
 * Parse an `.srt` or `.vtt` file's text.
 *
 * Accepted as the formats are found in the wild: SRT indices optional and in
 * any order, `,` or `.` before the milliseconds in either format, hours
 * optional, CRLF or CR line breaks, a UTF-8 byte-order mark, any number of
 * blank lines, overlapping cues (kept as they are, in file order).
 *
 * Dropped and recorded: cue settings after the timing (`positioning`), markup
 * tags with their words kept (`styling`; a `<v Name>` voice tag drops the name,
 * `voice-tags`), WebVTT `STYLE` / `REGION` / `NOTE` blocks, a cue with no words
 * left (`empty-cues`) and a cue that ends at or before it starts
 * (`inverted-cues`).
 *
 * Refused, with the line: an empty file, a `.vtt` that does not open with
 * `WEBVTT`, a timestamp that does not parse, a block with no timing line, and a
 * file with no cue left once the drops are made.
 */
export function parseCaptions(text: string, format: CaptionFormat): ParsedCaptions {
  const blocks = blocksOf(text.replace(/^\uFEFF/, ''));
  if (blocks.length === 0) throw new CaptionParseError('The caption file is empty.');

  const dropped = new Set<DroppedFeature>();
  const cues: CaptionCue[] = [];
  const vtt = format === 'vtt';

  if (vtt) {
    const [header] = blocks;
    if (!VTT_HEADER.test(header.lines[0])) {
      throw new CaptionParseError(`Line ${header.line}: a WebVTT file must start with "WEBVTT".`);
    }
  }

  // The WebVTT header block (and any metadata lines in it) is not a cue. A
  // block that holds a second cue is split, the rest going next in line.
  const work = vtt ? blocks.slice(1) : blocks;
  for (let b = 0; b < work.length; b++) {
    const block = work[b];
    const special = vtt ? VTT_SPECIAL_BLOCK.exec(block.lines[0]) : null;
    if (special) {
      dropped.add(VTT_SPECIAL_DROPS[special[1]]);
      continue;
    }

    // The timing line is the first line, or the second after an identifier
    // (an SRT index, a WebVTT cue id).
    const timingAt = block.lines[0].includes('-->') ? 0 : block.lines[1]?.includes('-->') ? 1 : -1;
    if (timingAt < 0) {
      throw new CaptionParseError(`Line ${block.line}: this caption has no timing line (start --> end).`);
    }
    const timing = block.lines[timingAt];
    const timingLine = block.line + timingAt;
    const [startToken, endToken, settings] = timingParts(timing, timing.indexOf('-->'));
    const start = parseTimestamp(startToken, timingLine);
    const end = parseTimestamp(endToken, timingLine);
    if (settings.length > 0) dropped.add('positioning');

    // The cue's text runs to the next timing line, if the block has one. In
    // SRT a line of digits just before it is that next cue's index.
    let textEnd = block.lines.length;
    const next = block.lines.findIndex((line, i) => i > timingAt && isTimingLine(line));
    if (next >= 0) {
      textEnd = !vtt && /^\d+$/.test(block.lines[next - 1].trim()) ? next - 1 : next;
      work.splice(b + 1, 0, { line: block.line + textEnd, lines: block.lines.slice(textEnd) });
    }

    const words = block.lines
      .slice(timingAt + 1, textEnd)
      .map((line) => {
        const stripped = line.replace(TAG, (tag) => {
          dropped.add(VOICE_TAG.test(tag) ? 'voice-tags' : 'styling');
          return '';
        });
        return (vtt ? stripped.replace(VTT_ENTITY, (_, name: string) => VTT_ENTITIES[name]) : stripped).trim();
      })
      .filter((line) => line !== '');

    if (words.length === 0) {
      dropped.add('empty-cues');
    } else if (end <= start) {
      dropped.add('inverted-cues');
    } else {
      cues.push({ start, end, text: words.join('\n') });
    }
  }

  if (cues.length === 0) throw new CaptionParseError('The file has no captions to import.');
  return { cues, dropped: DROPPED_ORDER.filter((feature) => dropped.has(feature)) };
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** Whole milliseconds, never below zero — both formats write the same rounding. */
const toMs = (seconds: number): number => Math.max(0, Math.round(seconds * 1000));

function formatTimestamp(ms: number, separator: ',' | '.'): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${separator}${pad(ms % 1000, 3)}`;
}

/**
 * How each format writes one line of a cue's text so `parseCaptions` reads
 * back exactly that line — line by line, because that is how it reads tags.
 */
const WRITE_LINE: Record<CaptionFormat, (line: string) => string> = {
  // SRT has no escapes: a tag in the text would be read as markup, so it is
  // left out, as any SRT reader would treat it.
  // A line that would read as timing is written with an empty tag inside its
  // arrow, which the parser strips: it reads back as the same text, not as
  // the start of another cue (review I2). WebVTT's escaped `>` already does it.
  srt: (line) => {
    const stripped = line.replace(TAG, '');
    return isTimingLine(stripped) ? stripped.replace(/-->/g, '--<i></i>>') : stripped;
  },
  vtt: (line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
};

/**
 * Write cues as an `.srt` (1-based indices, `,` before the milliseconds) or a
 * `.vtt` (the `WEBVTT` header, `.`), in the order given.
 *
 * Round-trip stable on its own output: `parseCaptions` reads it back to cues
 * that write out to the same text. So a cue a reader would drop — no words, or
 * no length once rounded to the millisecond — is not written, a blank line
 * inside a cue's text (which would end the block) is left out, and each line is
 * trimmed the way the parser trims it.
 */
export function serializeCaptions(cues: CaptionCue[], format: CaptionFormat): string {
  const separator = format === 'srt' ? ',' : '.';
  const blocks: string[] = [];
  for (const cue of cues) {
    const start = toMs(cue.start);
    const end = toMs(cue.end);
    const text = lines(cue.text)
      .map((line) => WRITE_LINE[format](line).trim())
      .filter((line) => line !== '');
    if (text.length === 0 || end <= start) continue;
    const timing = `${formatTimestamp(start, separator)} --> ${formatTimestamp(end, separator)}`;
    blocks.push([...(format === 'srt' ? [String(blocks.length + 1)] : []), timing, ...text].join('\n'));
  }
  const body = blocks.map((block) => `${block}\n`).join('\n');
  return format === 'vtt' ? `WEBVTT\n${body === '' ? '' : `\n${body}`}` : body;
}

/**
 * A caption's text with every line longer than `maxChars` wrapped at word
 * boundaries — the text renderer draws each `\n` as a line and never wraps on
 * its own. Source line breaks are kept; a single word longer than the limit
 * stays whole on a line of its own; runs of spaces close up.
 */
export function wrapCaptionText(text: string, maxChars = 42): string {
  return text
    .split('\n')
    .map((line) => {
      const [first = '', ...rest] = line.split(' ').filter((word) => word !== '');
      const wrapped = [first];
      for (const word of rest) {
        const last = wrapped[wrapped.length - 1];
        if (last.length + 1 + word.length <= maxChars) {
          wrapped[wrapped.length - 1] = `${last} ${word}`;
        } else {
          wrapped.push(word);
        }
      }
      return wrapped.join('\n');
    })
    .join('\n');
}

/** The text-clip fields an imported caption is given; its text is the cue's own. */
export type CaptionStyle = Omit<TextOverlayData, 'text' | 'rotation' | 'scale'>;

/**
 * The caption look: white on translucent black, centred near the bottom, sized
 * to the project's height (`Math.round(height × 0.045)` — 49 px at 1080p, 32 at
 * 720p), in the first font the inspector offers (`FONT_OPTIONS[0]`, Arial), so
 * a caption reads like one and can still be restyled like any text clip.
 */
export function captionStyleFor(resolution: { width: number; height: number }): CaptionStyle {
  return {
    x: 0.5,
    y: 0.88,
    textAlign: 'center',
    fontSize: Math.round(resolution.height * 0.045),
    fontFamily: FONT_OPTIONS[0].value,
    color: '#ffffff',
    backgroundColor: '#000000b3',
    fontWeight: 'normal',
    fontStyle: 'normal',
  };
}

/** Each dropped feature in words, with the verb it takes on its own. */
const DROPPED_WORDS: Record<DroppedFeature, [words: string, verb: 'was' | 'were']> = {
  positioning: ['positioning', 'was'],
  styling: ['styling', 'was'],
  regions: ['regions', 'were'],
  notes: ['notes', 'were'],
  'voice-tags': ['speaker names', 'were'],
  'empty-cues': ['empty captions', 'were'],
  'inverted-cues': ['captions that end before they start', 'were'],
};

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The importer's one sentence about what a file had that was not imported —
 * "Positioning and styling were not imported." `dropped` is non-empty: the
 * importer says nothing at all when nothing was dropped.
 */
export function describeDroppedFeatures(dropped: DroppedFeature[]): string {
  const words = dropped.map((feature) => DROPPED_WORDS[feature][0]);
  if (words.length === 1) return `${capitalise(words[0])} ${DROPPED_WORDS[dropped[0]][1]} not imported.`;
  const list = `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `${capitalise(list)} were not imported.`;
}
