<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Captions (`src/core/captions.ts`, ESCSUITE-293)

Captions are **ordinary text clips** on one marked track. That is the whole design: they draw
through `core/canvasRenderer.ts`'s `drawTextOverlayToCanvasAnimated` like any title, so the
preview, the MP4, WebM and GIF exporters and the headless bundle agree by construction, and they
can be edited, moved, restyled, keyframed or deleted with the tools that already exist. No renderer
change was made; a pin in each exporter's suite and one in `components/Preview/drawFrame.test.ts`
holds that a caption is drawn while its cue is up and not a frame before or after.

- **Formats.** `parseCaptions(text, 'srt' | 'vtt')` → `{ cues, dropped }`, pure, written from the
  two formats themselves. A cue is `{ start, end, text }` in seconds, `\n` between source lines.
  Accepted: SRT indices optional and out of order, `,` or `.` before the milliseconds in either
  format, hours optional (at most five digits, so a mangled file cannot read as `Infinity`), a
  one-to-three digit fraction (`.5` is half a second), CRLF / CR, a UTF-8 BOM, any blank-line
  layout (a whitespace-only line is blank), overlapping cues (kept, in file order). WebVTT's six
  escapes (`&amp; &lt; &gt; &nbsp; &lrm; &rlm;`) are decoded in one pass; SRT has none. A timing
  line — a `-->` with a timestamp on each side — met inside a cue's text starts the next cue (the
  WebVTT rule, applied to both formats; in SRT a line of digits right before it is that cue's
  index), so a file missing the blank line between two cues does not import as one caption with
  the next timing burned in as words (review I2); the writer, for its part, writes a `-->` in cue
  text as `→` so that its own output never meets this rule. A lone index ending an SRT file — a hand-edited
  file often stops there — is ignored rather than refused (review M5).
- **Dropped, and named once each** (`DroppedFeature`, listed in a fixed order): cue settings or
  SRT coordinates after the timing → `positioning`; the formats' own tags inside text, words kept
  → `styling` — WebVTT's `b`, `i`, `u`, `c`, `v`, `ruby`, `rt`, `lang` (a class after `.`, an
  annotation after a space), their closing forms and its timestamp tags (`<00:03.000>`,
  `<00:00:03.000>`), plus SRT's `<font …>`, in either case; a `<v Name>` voice tag, the name with
  it → `voice-tags`. **Any other `<…>` is caption text** (`Press <Enter> now` keeps `<Enter>`), and
  nothing inside a tag may be a `<`, `>` or line break, so a line of nothing but `<` is read in one
  linear pass (review M1). Stripping is one pass, so a tag that only appears once another is
  stripped (`<<b>i>`) stays as text; WebVTT `STYLE` / `REGION` / `NOTE` blocks →
  `styling` / `regions` / `notes`; a cue with no words left → `empty-cues`; a cue with `end <=
  start` → `inverted-cues`. Tags are stripped line by line. `{\an8}`-style SSA codes in SRT are
  **not** recognised (they stay as text) — out of the brief's scope.
- **Refused** with one `CaptionParseError` whose message the importer shows as it is: an empty
  file, a `.vtt` whose first block is not `WEBVTT` (optionally followed by a space and text), a
  timestamp that does not parse (`Line N: "…" is not a caption timestamp.`), a block with no timing
  line in its first two lines (bar the lone trailing SRT index above), and a file with no cue left
  once the drops are made.
- **Writing.** `serializeCaptions(cues, format)`: SRT with 1-based indices and `,`, WebVTT with the
  header and `.`, milliseconds rounded, never negative. It leaves out what a reader would drop (a
  cue with no words, or no length once rounded), trims each line and leaves out blank lines. In both
  formats a `-->` in cue text is written as `→` (U+2192): neither format can carry that token in cue
  text — the parser takes a timing line inside a cue as the start of the next one (above) — and the
  arrow keeps the meaning. WebVTT then escapes `&`, `<` and `>` with its own escapes (fix round 3),
  which the parser decodes, so a WebVTT sidecar reads back **exactly** bar the `→` — tag-shaped
  text, a literal `<Enter>` and `&` included. SRT has no escapes, so its text is written **as it
  is** — no padding, since a sidecar is a file people open and hand to platforms (fix round 2) —
  with **one documented loss**: caption text shaped like a tag the formats recognise (`<i>`, `<b>`,
  `<c.x>`, `<v Name>` …) is stripped as markup when the `.srt` is re-imported. Non-tag brackets like
  `<Enter>` read back unchanged. The fuzz holds exact read-back for WebVTT unless a cue holds a
  `-->`, and for SRT unless one holds a `-->` or a `<`.
- **The track marker.** `Track.kind?: 'captions'` (absent on every other track and in every older
  file). `parseProject` refuses a present `kind` that is not exactly `'captions'` with
  `timeline.tracks[i].kind must be 'captions'`; the migration passes tracks through by spread, so
  the marker survives every load path. The headless kit needed no change.
- **The store.** `addCaptionCues(cues, style)` (`store/overlaySlice.ts`): the whole file in **one**
  `set` and **one** history entry, the selection untouched — not `addTextOverlayClip` in a loop,
  which pushes an entry and selects per call. The caption track is found by its marker, never by
  `findEmptyTrack`; the first import creates it at the top through `createTrackAtTop` ("Captions"),
  later imports append to it, and there is never a second one. A locked caption track refuses the
  whole import with `null` (ESCSUITE-84 / 87); a hidden one still takes it. `findEmptyTrack` never
  hands out the caption track, even emptied, so a title or a video looking for an empty track
  cannot land there and be read as a caption (review M2).
- **Overlapping cues and the gestures** (ESCSUITE-308). The import keeps overlapping cues where
  the file put them, on the one track, and does not move them apart. The timeline's gestures
  treat such a pair as an overlap they **found**: the long cue's trim handles run past the cue
  inside it (an end trim used to clamp to the inner cue's start), either cue can be dragged and
  keeps or changes its overlap with the other, and the two drag together as a selection — while a
  cue the dragged or trimmed one did not overlap still stops a trim and refuses a drop. Paste and
  duplicate still land a new clip in a free span. See "One row never holds two overlapping
  clips" below.
- **The style.** `captionStyleFor(resolution)`: `x 0.5`, `y 0.88`, centred,
  `fontSize Math.round(min(width, height) × 0.045)` (49 at 1920×1080, 1080×1080 and 1080×1920, 32 at
  720p; ESCSUITE-309 — it was the height alone, which gave 86 px on a portrait frame),
  `FONT_OPTIONS[0]` (Arial), white on `#000000b3`, normal weight and style. The renderer never
  wraps, so the importer runs every cue through `wrapCaptionText(text, captionWrapColumns(resolution,
  fontSize))` first: `floor(width × 0.92 / (fontSize × 0.55))` clamped to [20, 42] (0.92 leaves a 4 %
  gutter each side; 0.55 em is a conservative Arial advance — a 42-character line at 49 px measured
  961 px, 0.467 em, so 0.55 covers mixed-case text with margin; all-caps Arial averages about 0.68 em,
  so an all-capitals caption on a portrait frame can still run wide — a known limit). Landscape stays at
  42; 1080×1080 and 1080×1920 give 36 (a square project wrapped at 42 before ESCSUITE-309, the one
  existing shape this changes), 720×1280 gives 37. Measured
  before the fix, a 42-character Arial line was 1687 px on 1080×1920 (font 86), 1137 on 720×1280
  (58) and 1196 on 1080×1350 (61) against frames 1080, 720 and 1080 wide. Source line breaks kept,
  longer lines wrapped at word boundaries, a single over-long word left whole.
- **The import.** `components/VideoUploader.tsx` takes `.srt` / `.vtt` by extension, any case (a
  browser reports `.srt` with no MIME type); the picker's `accept` lists both. Captions and media
  may share a drop; a `.veditor` still wins and returns early. Each file is one notice: `Imported N
  caption(s) onto the Captions track.` (`success`), plus one `info` notice from
  `describeDroppedFeatures` when something was dropped ("Positioning and speaker names were not
  imported."); a refusal is the parser's own sentence (`error`); an unreadable file is
  `Could not read <name>.`; a locked caption track is `The Captions track is locked, so no captions
  were imported.` When the captions land on a hidden track, the success notice gains one sentence,
  `The Captions track is hidden.` (review M3). The file is read with `File.text()`, which decodes
  UTF-8 and never fails on a bad byte, so a file in another encoding (a Windows-1252 SRT, say)
  imports with replacement characters where its accented letters were rather than being refused
  (review M4, documented, not changed).
- **The sidecar.** The export dialog shows a "Captions" row (a labelled group, after the Advanced
  options) only when a caption track holds a clip whose `textData.text` is a string (a damaged clip
  with no text is left out rather than read — the dialog is always mounted, review I1): "Download .srt" and "Download .vtt" write
  that track's text clips as they stand now, in timeline order (`end = timelinePosition +
  duration`), named `${projectName || 'export'}.srt` / `.vtt`, through `utils/downloadBlob.ts` —
  which the video download now calls too. A **hidden** caption track is still offered: hiding it is
  how a caption is kept off the picture and shipped only as a file. The row reads the `clips` /
  `tracks` the dialog already subscribes to. The sidecar always covers the whole timeline; an
  "Export Section" range does not shift or trim it.
- **Fuzz.** `core/captions.fuzz.test.ts` (house harness): 1000 byte mutations per format, decoded
  non-fatally; every input parses or is a `CaptionParseError`, every parse is a valid cue list whose
  serialization reads back as the same cues — exactly for WebVTT unless a cue holds a `-->` (written
  as `→`), and for SRT unless one holds a `-->` or a `<` (tag-shaped text is lost); otherwise every
  cue read back is one that was written, in order, and only an SRT file whose tag-shaped text was all
  it had may come back refused — with exact tally floors on the committed seeds (SRT
  416 / 584, WebVTT 449 / 551 since review round 1).
- **Out of scope, and why:** automatic captioning (no speech model runs in the browser here);
  SCC, CEA-608/708 and TTML (broadcast formats no browser tool of this kind is asked for, each a
  parser of its own); captions muxed into the MP4/WebM as a text track (Mediabunny's output path
  here writes video and audio only, and burn-in plus a sidecar covers both uses); and a caption
  panel of its own (the clips are text clips, so the inspector already edits them).
