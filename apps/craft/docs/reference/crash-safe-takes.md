# Crash-safe takes

ESCSUITE-466. Before this, a take lived only in the page's memory until Stop: a tab that
crashed, was closed or lost power mid-take lost all of it. Now every take is also written to
the origin private file system (OPFS) as it records, and the next CRAFT that opens offers to
recover it.

## The pieces

| File | Job |
|---|---|
| `src/core/takeStoreWorker.ts` | The worker, shipped as a source string and started from a `blob:` URL. It writes through `FileSystemSyncAccessHandle`s and flushes every `TAKE_FLUSH_INTERVAL_MS` (2 s). |
| `src/core/takeStore.ts` | The page's half: `createTakeStore(journal)`, the Web Lock, `detachFromDisk`, `onTakeKept`. |
| `src/core/webmTrim.ts` | `trimToWholeBlocks`: cuts a WebM that stopped mid-write back to its last whole block. |
| `src/core/takeRecovery.ts` | Finds abandoned takes, repairs them, claims them under the lock. |
| `src/hooks/useTakeRecovery.ts` | Sequences the prompt against the app's state and its one notice channel. |
| `src/components/RecoverTakeDialog/` | The prompt: Recover, Discard, or Escape for "not now". |

## Why a worker, and why a sync access handle

`FileSystemSyncAccessHandle.flush()` is the only OPFS write that promises the bytes reached
the disk, and it exists only inside a dedicated worker. `createWritable()` on the page writes
to a swap file and commits nothing until `close()`, so a tab that dies mid-take would leave
nothing behind. The worker is a source string started from a `blob:` URL, like the AudioWorklet
processor (`audioWorkletCapture.ts`). That works in the single-file build, and the hosted CSP
already allows `blob:` in `worker-src`.

What survives what:

- **A tab that crashes or is closed** loses nothing that reached `write()`. Once written, the
  bytes belong to the operating system. A recorder hands over its bytes about once a second:
  Mediabunny writes a Cluster at each keyframe (one per second), and MediaRecorder delivers a
  chunk every 1000 ms. So what is lost is the last second or so the recorder was still holding.
- **A power cut or OS crash** can also lose what was written since the last flush: up to about
  2 s more.

## On disk

One directory per take, under `escapecraft-takes/<takeId>/`:

- **`take.json`** is the journal (`TakeJournal`). It records the take id, when the take started,
  which recorder made it, the `CapturedTake` the save path needs, and whether system audio was
  shared. It is written and flushed before any media byte.
- **`primary.webm`** holds the take itself.
- **`webcam.webm`, `mic.webm` and `system.webm`** are a separate-tracks take's companion files.

A Web Lock named `escapecraft-take:<takeId>` is held for as long as the take is live. That way
a second CRAFT tab never offers to recover a take another tab is still recording. The recovery
scan probes each lock with `ifAvailable`. Recover and Discard also run under the lock
(`withTakeClaimed`), so two tabs can never act on the same take.

## How each recorder writes

- **WebCodecs**: when the store is ready, every Mediabunny output, companions included, muxes
  into a `StreamTarget` over `takeStore.writable(part)` instead of a `BufferTarget`. Nothing of
  the take stays in the page's memory. At Stop the recorder calls `finish()`, reads each part's
  `File` back, and copies it off the disk with `detachFromDisk`. If the store failed, or has
  no files at Stop, the recorder raises a `TakeStorageError`. The take is then ended and left
  on disk for recovery.
- **MediaRecorder**: every chunk is appended to `primary.webm` as well as kept in memory. The
  in-memory copy is still what `onStop` delivers, so a store that is unavailable or fails
  costs this take only its crash protection.

A take whose store is not ready (`ready` resolves `false`) records exactly as before. That
covers no OPFS, no sync access handle, no Worker, no Web Locks, or a worker that did not
answer within 5 s. It also covers a lock request the browser rejects (an opaque `file://`
origin), and Safari before 17, whose draft sync access handle returns promises: the worker
refuses to open on it rather than appending at byte 0. And it covers a MediaRecorder take
where MediaRecorder records MP4 rather than WebM (see **Not covered** below).

## Who keeps or deletes the copy

The rule is: keep it unless the user said no. `useRecordingController` owns the store and
settles it once (`settleTake`):

| How the take ends | Copy |
|---|---|
| Cancelled (live or in its countdown) | deleted |
| Start failed / error before the take started | deleted (nothing recorded) |
| Error after it started (`TakeStorageError` included) | kept |
| The screen went away mid-take (unmount, `disposeLiveRecordingSession`) | kept |
| Stopped, saved | deleted once the library has it |
| Stopped, save failed | kept |

`release()` keeps the files, lets the lock go and fires `onTakeKept`. The recovery hook
listens for that, so a take that ended in an error is offered back straight away, not on the
next visit. `discard()` deletes the directory while still holding the lock, then lets the lock
go.

## Recovery

`findUnfinishedTakes()` lists every take directory that no tab holds a lock on. It deletes,
without asking, any directory whose journal is missing or invalid, or whose `primary.webm` is
missing or empty: those takes died before their first frame. A journal with another `version`
(written by a newer or older CRAFT) is left alone, neither offered nor deleted. It returns the
rest oldest first.

`repairUnfinishedTake()` runs every part through two steps:

1. **`trimToWholeBlocks`** cuts the torn tail and rewrites the Segment as unknown-size (8 bytes
   wide, the width `webm-duration-fix` expects). A cut known-size Cluster has its size rewritten
   to "unknown" at the same width. Anything after the Clusters, such as a finalized file's
   Cues, is dropped.
2. **`fixWebMMetadata`** is the same repair the save path runs on every MediaRecorder take: it
   writes Duration and a keyframe Cues index.

Mediabunny's pre-finalize file has a header-only Segment size, Duration 0, a placeholder
SeekHead and no Cues. After the trim it has exactly the shape MediaRecorder output has. That
is why one repair serves both recorders (`takeRepair.test.ts` checks this over real Mediabunny
output).

Each part's length is its last block's timestamp. An audio companion that ends at 0 s is given
the primary's length. If a part's repair throws, it is stored trimmed but unrepaired and the
prompt says `NOT_SEEKABLE`, as at save. A primary that is a WebM with no whole block is
`NothingToRecoverError`: the copy is deleted and `NOTHING_TO_RECOVER` is shown. A primary whose
first bytes are not a WebM's (`UnreadableTakeError`) is never deleted without asking: the
recovery fails with `RECOVERY_FAILED`, the copy stays, and only the user's Discard removes it.

The recovered take is stored through `saveRecording(..., recovered)`. Its date is the journal's
`startedAt`, its `systemAudioShared` comes from the journal, and its thumbnail is generated from
the file rather than taken from this tab's preview.

## The prompt

`App` shows `RecoverTakeDialog` only when all of these hold:

- the app is idle;
- the take has not been set aside this visit;
- neither the Help dialog nor the playback dialog is open.

It is part of `modalOpen`, so the keyboard shortcuts are off while it is up. **Recover** is
focused first. **Escape** or the backdrop sets the take aside until the next visit. A recovery
that fails raises `RECOVERY_FAILED`, keeps the copy and sets it aside, so trying again takes a
reload (the notice says so, and says to free storage space first if it is full).

## IndexedDB keeps OPFS files by reference

Chromium's IndexedDB stores a `File` read from OPFS, and any Blob sliced from one, as a
reference to that file. A recording saved from such a Blob read back `NotFoundError` as soon as
the take's directory was deleted (found while building ESCSUITE-466). So every Blob that leaves
the store for the library goes through `detachFromDisk`, which copies it in 8 MiB chunks, each
its own Blob. The page never holds more than one chunk.

## Costs and limits

- **Memory**: on the WebCodecs path, memory no longer grows with the take's length. The
  `craft-take-memory` benchmark measures it (see `docs/reference/performance-benchmarks.md`).
  Stop still makes one chunked copy of the file.
- **Storage**: a take briefly takes about twice its size at Stop, once in OPFS and once in
  IndexedDB, until the OPFS copy is deleted. A full disk mid-take ends a WebCodecs take with
  `TAKE_STORAGE_FAILED`, and what was written is kept for recovery. Recovering it needs about
  its size free again, so the notice says to free space first. A MediaRecorder take keeps
  recording and shows `TAKE_PROTECTION_LOST`.
- **Not covered**: browsers or profiles with no sync access handle (Safari Private Browsing,
  some `file://` pages), and browsers whose MediaRecorder writes MP4 rather than WebM (older Safari) for a take on the MediaRecorder path (PiP, audio only): recovery can only repair
  WebM, so `createTakeStore` keeps nothing for such a take. These get
  `TAKE_NOT_CRASH_PROTECTED`. A WebCodecs take muxes its own WebM and is kept wherever the
  storage allows. Also not covered: a take whose
  site data was cleared, and anything beyond the unfinished takes themselves (no cloud copy).

## Tests

- **Unit**:
  - `takeStoreWorker.test.ts`, `takeStore.test.ts` and `takeRecovery.test.ts` run against
    `src/test/doubles/opfs.ts`, an in-memory OPFS with sync access handles, Web Locks and a
    Worker double that runs the real worker source.
  - `webmTrim.test.ts` uses hand-built containers.
  - `takeRepair.test.ts` uses real Mediabunny.
  - `webcodecsRecorder.takeStore.test.ts` covers the durable path.
  - `useTakeRecovery.test.ts`, `RecoverTakeDialog.test.tsx` and `App.recoverTake.test.tsx`
    cover the prompt.
  - The controller suites mock `core/takeStore` with `src/test/doubles/takeStore.ts`.
- **E2E**: `apps/e2e/tests/escapecraft/crash-safe-take.spec.ts` covers both recorders in
  Chromium:
  - record, close the page without stopping, reopen, recover;
  - check media health (finite duration, a seek to the middle, decodable audio, keyframe Cues);
  - Discard brings storage use back down;
  - a normal Stop leaves nothing behind.

  It skips where workers get no sync access handle.
