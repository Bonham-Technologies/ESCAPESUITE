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
  and no encoder. The `StreamTarget` writes into `createChunkCollector`, which keeps each chunk as
  a separate Blob part (overwriting in place where the muxer writes back a size, Duration or the
  SeekHead) and joins them into one Blob at the end, so the output is never one contiguous
  `ArrayBuffer` — a `BufferTarget` would have been gigabytes for a long take, and an allocation
  that fails is an out-of-memory crash nothing can catch (review round 1). Mediabunny's muxer starts a Cluster at key frames and writes one CuePoint per
  Cluster, except that it **forces** a Cluster on a delta frame once one would pass 32.767 s; the
  video cue on such a Cluster is dropped (ESCSUITE-359, below). The result keeps the original's MIME type. **Alpha is preserved**: Mediabunny reads a
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

## Cues on delta frames (ESCSUITE-359)

Mediabunny 1.61.6 forces a new Cluster once one would pass 32.767 s (a block's timestamp is an
int16 of ms from its Cluster's), whatever frame comes next, and still writes a CuePoint for every
track in it. A MediaRecorder take can go minutes between key frames, so between 2026-10-17 and
this fix the remux stored most of a long take's Clusters with a **video cue on a delta frame**.
Chromium trusts a cue as a key frame: a seek onto one leaves the VP8/VP9 decoder nothing to start
from, the element plays on (audio, `currentTime`) and never presents another picture. Every far
seek lands on another bad cue, so the preview froze for good until a reload (user-reported).

- **The cure** (`core/webmDeltaFrameCues.ts`'s `dropDeltaFrameCues`): drop each video
  CueTrackPositions whose Cluster's first block of that track is not a key frame (a SimpleBlock
  without the key flag, or a BlockGroup with a ReferenceBlock), and a CuePoint left with none.
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
  the preview's read (`persistRepair: true`) writes them back under the same id and metadata, so
  a row is read wrong once. Export and the audio mix repair in memory only (an export must not
  rewrite the shared database). A project file saved before the fix carries the bad bytes; loading
  it stores them, and the preview's first read repairs the row.
- **Pinned by** `webmDeltaFrameCues.test.ts` (every video cue of a remux checked against the key
  flag of the block it names, with a test-side EBML walker), `storage.test.ts` (repair on read,
  write-back only when asked) and `apps/e2e/tests/regressions/ESCSUITE-359.spec.ts` (a fresh
  import and a pre-fix row: click the ruler at 45 s, play, and the canvas must change; both stay on
  one frame before the fix). Firefox seeking a re-indexed file is owner-checked.
- **Upstream**: the forced Cluster's cue is Mediabunny's; watched on its own ticket.
