<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Seek index repair at import (ESCSUITE-305)

Firefox will not seek a WebM with no Cues index into a Cluster that does not start with a key
frame (see "Black Flash Prevention"). Chrome's MediaRecorder starts a Cluster about every second
whatever the key frames are, and `webm-duration-fix`, which ESCAPECRAFT runs over every
MediaRecorder take, records a cue only for a video **SimpleBlock** — but Chrome writes every frame
of the compositor's canvas stream as a **BlockGroup** (VP9 with alpha carries BlockAdditions), so
every composited-PiP take ESCAPECRAFT has stored carries an **empty** Cues element
(`1c53bb6b 80`). Measured on such a take, the same bytes with a real Cues index seek 48/48 on
Firefox and its WebM export draws every frame. ESCSUITE-322 fixes ESCAPECRAFT's save; this repairs
what is already stored.

- **What is probed** (`core/webmSeekIndex.ts`'s `needsSeekIndexRepair`): only a blob whose type
  is `video/webm` or `audio/webm` (any `;codecs=`), by reading its first 64 KiB: the EBML header,
  the Segment, then each top-level element up to the first Cluster — the Cues element itself if
  it comes first, or the SeekHead's Cues entry, whose target is read with one more 12-byte slice.
  A Cues element with something in it means **leave the file byte-identical** — every
  Mediabunny-written file, every ESCAPECRAFT WebCodecs take; the common case costs one header
  read. An empty Cues, or a first Cluster with no Cues before it and no SeekHead entry for one,
  means repair. Anything it cannot read as a WebM — junk, a truncated header, a head that ends
  before the media — is left alone. Mediabunny's `Input` does not expose its cue points, so this
  is a small EBML walk of its own.
- **What is remuxed** (`remuxWithSeekIndex`): every track's encoded packets, copied through
  Mediabunny (`Input` + `BlobSource` -> `EncodedPacketSink` -> `EncodedVideoPacketSource` /
  `EncodedAudioPacketSource` -> `Output` + `WebMOutputFormat` + `StreamTarget`) with no decoder
  and no encoder. The `StreamTarget` writes into `createChunkCollector` (`core/chunkCollector.ts` since
  ESCSUITE-367, which the MP4 and WebM exporters write through too), which keeps each chunk as
  a separate Blob part (overwriting in place where the muxer writes back a size, Duration or the
  SeekHead) and joins them into one Blob at the end, so the output is never one contiguous
  `ArrayBuffer` — a `BufferTarget` would have been gigabytes for a long take, and an allocation
  that fails is an out-of-memory crash nothing can catch (review round 1). Mediabunny's muxer starts a Cluster at key frames and writes one CuePoint per
  Cluster, except that it **forces** a Cluster on a delta frame once one would pass 32.767 s; the
  video cue on such a Cluster is dropped (ESCSUITE-359, below). The result keeps the original's MIME type.
  **Packet bytes are copied exactly** since Mediabunny 1.66.0: up to 1.65 its muxer also rewrote
  every VP9 key frame header's `color_space` (`fixVP9ColorSpace`) from the matrix of the decoder
  configuration it was handed. The remux hands it the source track's, whose matrix is the Colour
  element's where that names one, and otherwise the one the first key frame header implies. So up
  to 1.65 the header took the Colour element's matrix where VP9 has a code for it (BT.709 2,
  BT.470BG 1, SMPTE 170M 3, RGB 7) and 0, "unknown", where it has none (BT.2020); a file with no
  Colour element kept its header, except that a BT.2020 header (5) became 0. The remux does not
  restore that — the export does, for frames it encodes (`webm-export-reliability.md`,
  ESCSUITE-284) — so a remuxed take's headers stay as its encoder wrote them (an ESCAPECRAFT
  WebCodecs take's already carry the reported matrix). See **Colour after repair** below for the
  measurement (ESCSUITE-504): the repair shifts no colour. **Alpha is preserved**: Mediabunny reads a
  BlockGroup's BlockAdditional (BlockAddID 1) on an `AlphaMode` 1 track as `sideData.alpha` and
  writes it back the same way on a track it marks `AlphaMode` 1 — pinned over a hand-built
  BlockGroup+BlockAdditions WebM (`test/fixtures/webmFixture.ts`) by packet count, timestamp,
  key flag, bytes and alpha bytes, and checked by hand over the real 15.5 s take (434 VP9 packets,
  every one with alpha, and 258 Opus packets identical; 45 ms for 2 MB). Only an inferred block
  *duration* can differ, at a Cluster's last block — the demuxer infers it from the next block.
- **Where**: once, at import, never at export load (an export must not rewrite the shared
  database). `finishVideoFile` stores the repaired bytes, with
  `metadata.size` set to their size, and makes its thumbnail from them, so the thumbnail seeks
  on Firefox too. The `?loadVideo=` handoff (`app/takeImport.ts`) repairs the take's **primary**
  and rewrites ESCAPECRAFT's own row **in place**, `storeVideo` under the same id with the same
  metadata and the new size: the content is the same packets, and a wedged seek cannot be cured
  any other way. A take already in the library is refused before this, and a primary that needs
  no repair is never written. A rewrite that cannot be stored warns `Could not store the
  re-indexed copy of "<name>":` and the import carries on with the repaired bytes in hand.
- **Failure keeps the original**: `withSeekIndex(blob, name)` hands back the very same object
  for a non-WebM or an indexed WebM, the remux for one that needs it, and — when the probe or the
  remux throws (a codec Mediabunny cannot name, a track that is neither video nor audio) — the
  original, with one `console.warn` naming the file. The import continues; on Firefox an export of
  that source then fails by name (`SOURCE_NOT_SEEKABLE`), and Chromium works as before. A record
  with no blob at all is kept as it came, not thrown on.
- **Order (ESCSUITE-324)**: at import the repair runs **before** any metadata probe, on every
  entry that loads a WebM into an element — `processVideoFile` and `processMediaFile` (the
  uploader, `?video=` and `LOAD_VIDEO`), for `video/webm` and `audio/webm` alike — through one
  `withSeekIndexFirst`. A WebM from outside ESCAPECRAFT with neither a Duration nor Cues is the
  file whose **end-seek** wedges on Firefox: `loadedmetadata` arrives (so the 15 s metadata
  deadline never fires for this shape), the seek never lands, and the import used to fail on the
  duration probe's 5 s deadline with "Could not determine the duration of <name>" before the remux
  that would have made it seekable. Now the metadata probe, the thumbnail, the waveform and
  `storeVideo` (`finishVideoFile`, or `finishAudioFile` for audio and a video-typed file with no
  picture) all see the repaired bytes, and the remux runs at most once per import. An indexed WebM
  and every other type come back as the same object. Pinned by
  `videoProcessor.seekIndexFirst.test.ts` (media doubles that wedge only while they hold the raw
  file).

## Colour after repair (ESCSUITE-504)

ESCSUITE-485 asked whether an imported, repaired Firefox VP9 recording previews with a colour
shift since Mediabunny 1.66 dropped the header rewrite, and answered from the code. Measured on
2026-11-23 in Firefox 159 and Chromium 159 (Playwright's headless builds, Linux): **the repair
shifts no colour.** In both browsers, ARTIST's preview and a plain `<video>` read the same colours
after the repair as before it, to the code value.

- **Firefox's MediaRecorder records no VP9.** Firefox 159 answers
  `MediaRecorder.isTypeSupported('video/webm;codecs=vp9')` false, and its constructor throws
  NotSupportedError for that type. It records VP8, with no Cues and no Colour element. A Firefox
  VP9 WebM comes only from WebCodecs (an ESCAPECRAFT take, an ARTIST export), which Mediabunny
  writes with Cues, so the import never repairs one. The 1.65 rewrite was VP9-only, so it never
  touched a Firefox MediaRecorder file either.
- **Chromium 159's MediaRecorder** writes VP9 with a Cues index the probe honours, so as made it
  is not repaired. It labels the file BT.709 full range in both places: the key frame header
  (`color_space` 2, `color_range` 1) and the Colour element (matrix 1, range 2, transfer 13,
  primaries 1). For that file 1.65 wrote back the 2 the header already held.
- **Method** (`apps/e2e/tests/regressions/ESCSUITE-504.spec.ts`, which runs in Chromium on every
  PR and in Firefox in the Nightly): eight colour patches are drawn on a 640x360 canvas and
  recorded with `canvas.captureStream()` and `MediaRecorder`. Both browsers' recordings are
  committed (`apps/e2e/fixtures/mediarecorder-colour`), so each browser imports the other's file
  as well as its own. The cases are Firefox's VP8 recording, and Chromium's VP9 recording with its
  Cues emptied in place, which is the shape `webm-duration-fix` left on ESCAPECRAFT's takes. A
  third case records afresh with the running browser's own MediaRecorder, using VP9 where the
  browser offers it, so a Firefox that gains VP9 is measured on its next run. Each file is
  imported into ARTIST and read four ways: by a plain `<video>` and by the preview canvas, each
  before the repair (the stored row's bytes put back and the session restored) and after it. The
  spec checks that the repair kept every video packet byte for byte and kept the Colour element.
  It fails if any reading after the repair is more than 2/255 from the one before.
- **Result**, as mean / max channel difference from the drawn RGB, out of 255. Each "before"
  figure is the same as its "after" figure, `<video>` and preview alike:

  | File | Firefox, before / after repair | Chromium, before / after repair |
  |---|---|---|
  | Firefox MediaRecorder, VP8 | 0.83 / 2, both | 0.83 / 2, both |
  | Chromium MediaRecorder, VP9, Cues emptied | **9.04 / 35, both** | 0.79 / 2, both |

  The 9.04 / 35 is **Firefox's decoder, not the repair**: it is there before the repair too.
  Firefox reads Chromium's full-range BT.709 VP9 as limited-range BT.601, which fits its reading
  to within a mean of 1.07. The drawn (228,61,99) reads (226,31,97). Not fixed here; it is a
  separate finding about Firefox decoding a full-range VP9 file.
- **Mediabunny 1.65 against 1.66, run over real bytes**: Chromium's recording and variants of it,
  remuxed in Node through each version's `EncodedPacketSink` and `EncodedVideoPacketSource`
  (the 1.65 package fetched for the comparison, not a dependency). Results under 1.65: header 0
  with Colour BT.709 became 2; header 5 with Colour BT.709 became 2; with no Colour element,
  header 0 stayed 0 and header 5 became 0. Under 1.66 every header stayed as it was. So a
  repaired file can preview differently than it did before 1.66 only in two cases. One is a VP9
  file with no usable Cues whose Colour element names a matrix its header does not. The other is
  a BT.2020 header with no Colour element, which 1.66 keeps and 1.65 turned into "unknown".
  Neither browser's MediaRecorder writes either one.

## Cues on delta frames (ESCSUITE-359)

Mediabunny up to 1.62.1 forces a new Cluster once one would pass 32.767 s (a block's timestamp
is an int16 of ms from its Cluster's), whatever frame comes next, and still writes a CuePoint for
every track in it. **From Mediabunny 1.63.0** (ARTIST ships 1.66.0) the muxer writes a cue only for
each track's first key block in a Cluster, so the remux no longer writes a bad cue by itself; see
**Upstream** below for why the drop stays. A MediaRecorder take can go minutes between key frames, so between 2026-10-17 and
this fix the remux stored most of a long take's Clusters with a **video cue on a delta frame**.
Chromium trusts a cue as a key frame: a seek onto one leaves the VP8/VP9 decoder nothing to start
from, the element plays on (audio, `currentTime`) and never presents another picture. Every far
seek lands on another bad cue, so the preview froze for good until a reload (user-reported).

- **The cure** (`core/webmDeltaFrameCues.ts`'s `dropDeltaFrameCues`): drop each video
  CueTrackPositions that names its Cluster's first block of that track (its CueTime is that
  block's time) when that block is not a key frame (a SimpleBlock without the key flag, or a
  BlockGroup with a ReferenceBlock), and a CuePoint left with none. A cue with a
  `CueRelativePosition`, or whose time is a later block's, is never dropped: that is a muxer
  indexing key frames itself (ESCAPECRAFT's `writeKeyframeCues`, ffmpeg), and its cue can rightly
  name a key frame inside a Cluster that opens on a delta frame (review round 1).
  Audio cues stay. A player then seeks to the last real key frame and decodes forward, as on the
  un-indexed file. The Cues element is rewritten **where it lies at the same length**, an EBML
  Void filling the room, so every other byte and every SeekHead position is unchanged and the
  output is the input's slices plus the new Cues (no copy of the file). A cue or Cluster it cannot
  read is kept: only a cue proven wrong is dropped.
- **What it reads**: the head (Tracks for the video track numbers, SeekHead for the Cues), the
  Cues, and only the Clusters a muxer may have had to force: the first, and any that starts 32 s
  or more after the one before. Mediabunny starts every other Cluster on a key frame on every
  track, so this finds every bad cue the remux wrote while a sound hour-long take costs a handful
  of reads.
- **Where**: `remuxWithSeekIndex` runs it over its own output; `withSeekIndex` runs it over a WebM
  that already has an index, so a `?loadVideo=` take whose CRAFT row was rewritten before the
  fix is repaired, and rewritten again, on its next handoff. **Already-stored rows** are repaired
  on read by ARTIST's `getVideoBlob` (`core/storage.ts`): every reader gets the repaired bytes, and
  the preview's read (`persistRepair: true`) writes them back, in one transaction and only over
  a row that still holds bytes of the size it read (a row deleted or replaced meanwhile is left as
  it is), keeping its metadata, so a row is read wrong once. Export and the audio mix repair in memory only (an export must not
  rewrite the shared database). A project file saved before the fix carries the bad bytes; loading
  it stores them, and the preview's first read repairs the row.
- **Pinned by** `webmDeltaFrameCues.test.ts` (every video cue of a remux checked against the key
  flag of the block it names, with a test-side EBML walker), `storage.test.ts` (repair on read,
  write-back only when asked) and `apps/e2e/tests/regressions/ESCSUITE-359.spec.ts` (a fresh
  import and a pre-fix row: click the ruler at 45 s, play, and the canvas must change; both stay on
  one frame before the fix). Firefox seeking a re-indexed file is owner-checked.
- **Upstream**: the forced Cluster's cue was Mediabunny's
  ([Vanilagy/mediabunny#597](https://github.com/Vanilagy/mediabunny/issues/597), watched on
  ESCSUITE-362), fixed in 1.63.0 (ESCSUITE-411). `dropDeltaFrameCues` stays in both places:
  in `remuxWithSeekIndex` as a guard against a regression, and on read in `core/storage.ts`
  because rows stored before the fix still carry the bad cues. `webmDeltaFrameCues.test.ts`
  ("Mediabunny's own muxer, without dropDeltaFrameCues") runs the remux with the drop turned off
  and fails if Mediabunny writes a video cue on a delta frame again (it fails on 1.62.1).
