/**
 * Crash-safe takes, the page's half (ESCSUITE-466).
 *
 * While a take records, every byte its recorder produces is also handed to a
 * worker (`takeStoreWorker.ts`) that writes it to a file in the origin private
 * file system (OPFS) and flushes it to disk every couple of seconds. A tab
 * that crashes, is closed or is killed mid-take therefore leaves the take
 * behind it, and the next CRAFT that opens offers it back
 * (`takeRecovery.ts`). A take that ends normally deletes its files once the
 * library has it.
 *
 * One directory per take, under `TAKES_DIRECTORY`:
 *
 * - `take.json` — the journal: which take, when it started, which recorder,
 *   and what the save path needs to describe it (`TakeJournal`). Written once,
 *   flushed, before any media byte.
 * - `primary.webm`, and for a separate-tracks take `webcam.webm`, `mic.webm`
 *   and `system.webm` — the muxed bytes as the recorder wrote them.
 *
 * A Web Lock named after the take is held for as long as the take is live, so
 * a second CRAFT tab never offers to recover a take another tab is still
 * recording.
 *
 * Everything here is optional by design. Where OPFS, sync access handles,
 * workers or Web Locks are missing (Safari Private Browsing, some `file://`
 * pages, jsdom), `ready` resolves `false` and the take is recorded exactly as
 * before, in memory; the controller says so in a notice.
 */
import type { StreamTargetChunk } from 'mediabunny'
import type { CompanionRole } from '../store/types'
import type { CapturedTake } from '../utils/recordingMetadata'
import { TAKE_STORE_WORKER_SOURCE } from './takeStoreWorker'

/** The OPFS directory every take's own directory lives in. */
export const TAKES_DIRECTORY = 'escapecraft-takes'
/** The journal's file name inside a take's directory. */
export const JOURNAL_FILE = 'take.json'
/** How long the worker may take to say whether it can write at all (ms). */
export const TAKE_STORE_OPEN_TIMEOUT_MS = 5000
/**
 * How long `finish()` waits for the worker to close the take's files (ms).
 * Closing flushes at most a couple of seconds of writes, so a worker that has
 * not answered by then has died, and its files are left as they are.
 */
export const TAKE_STORE_CLOSE_TIMEOUT_MS = 15000

/** Which file of a take a write belongs to. */
export type TakePart = 'primary' | CompanionRole

/** Every part a take can have, in the order the library lists them. */
export const TAKE_PARTS: readonly TakePart[] = ['primary', 'webcam', 'mic', 'system']

/** A part's file name inside its take's directory. */
export function partFileName(part: TakePart): string {
  return `${part}.webm`
}

/** The Web Lock a live take holds, so no other tab recovers it. */
export function takeLockName(takeId: string): string {
  return `escapecraft-take:${takeId}`
}

/** What `take.json` holds: everything the save path needs that is not bytes. */
export interface TakeJournal {
  version: 1
  takeId: string
  /** `Date.now()` when the take was set up. Becomes the recording's date. */
  startedAt: number
  /** Which recorder wrote the bytes. Both write WebM; only the shape differs. */
  recorder: 'webcodecs' | 'mediarecorder'
  /** The take as the controller resolved it (see `CapturedTake`). */
  captured: CapturedTake
  /** Whether the browser handed over a system-audio track (ESCSUITE-62). */
  systemAudioShared: boolean
}

/** A take's files, by part, as `File`s read back from OPFS. */
export type TakeFiles = Partial<Record<TakePart, File>>

/** A write to the take's files failed, so the take is no longer on disk. */
export class TakeStorageError extends Error {
  constructor(message: string) {
    super(`The recording could not be kept on this device: ${message}`)
    this.name = 'TakeStorageError'
  }
}

export interface TakeStore {
  readonly takeId: string
  /**
   * Whether the take is being kept on disk: `true` once the worker has
   * written the journal, `false` when anything on the way refused (or did not
   * answer within `TAKE_STORE_OPEN_TIMEOUT_MS`). Never rejects.
   */
  readonly ready: Promise<boolean>
  /**
   * Write bytes into one of the take's files: at `position`, or after the
   * furthest byte written so far. Fire-and-forget; a failure is reported once
   * through `onFailure`. A `Uint8Array` that owns its whole buffer is
   * transferred, so the caller must not touch it afterwards.
   */
  write(part: TakePart, data: Uint8Array | Blob, position?: number): void
  /** A sink for Mediabunny's `StreamTarget`, writing one part. */
  writable(part: TakePart): WritableStream<StreamTargetChunk>
  /** Called once if a write or flush fails (most likely the quota). */
  onFailure(listener: (error: TakeStorageError) => void): void
  /**
   * Flush and close every file and hand back what is on disk. `null` when the
   * take was never kept or a write failed: the files are then not the take.
   */
  finish(): Promise<TakeFiles | null>
  /**
   * Close everything and let the lock go, keeping the files for recovery.
   * Only the first of `release()` and `discard()` does anything.
   */
  release(): Promise<void>
  /** Close everything and delete the take's directory: nothing to recover. */
  discard(): Promise<void>
}

type WorkerReply =
  | { op: 'opened' }
  | { op: 'error'; message: string }
  | { op: 'failed'; message: string }
  | { op: 'closed'; files: Record<string, File>; failed: boolean }

interface LockManagerLike {
  request(name: string, callback: () => Promise<void>): Promise<void>
}

/** The three browser features a kept take needs, or null where one is missing. */
function storageFeatures(): { locks: LockManagerLike; storage: StorageManager } | null {
  const nav = globalThis.navigator as (Navigator & { locks?: LockManagerLike }) | undefined
  if (typeof Worker !== 'function' || !nav?.storage?.getDirectory || !nav.locks?.request) {
    return null
  }
  return { locks: nav.locks, storage: nav.storage }
}

/** The OPFS directory that holds every take, or null when there is none yet. */
export async function takesDirectory(create = false): Promise<FileSystemDirectoryHandle | null> {
  const features = storageFeatures()
  if (!features) return null
  const root = await features.storage.getDirectory()
  try {
    return await root.getDirectoryHandle(TAKES_DIRECTORY, { create })
  } catch {
    return null
  }
}

/** How much of a kept file one step of `detachFromDisk` reads into memory. */
export const DETACH_CHUNK_BYTES = 8 << 20

/**
 * A copy of `blob` that no longer depends on the file it was read from.
 *
 * Needed because a `File` read back from OPFS — and any Blob sliced or built
 * from one — is a reference to that file, and so is what IndexedDB keeps when
 * it is stored: Chromium's stored record read back `NotFoundError` once the
 * take's directory was deleted after a successful save (measured while
 * building ESCSUITE-466). Every Blob that leaves the take store for the
 * library goes through here first.
 *
 * Copied a chunk at a time, each chunk becoming its own Blob, so the page
 * holds at most `DETACH_CHUNK_BYTES` of it at once: the browser keeps a
 * Blob's bytes in its own storage, paging large ones to disk, not in the
 * page's heap.
 */
export async function detachFromDisk(blob: Blob, type: string = blob.type): Promise<Blob> {
  const parts: Blob[] = []
  for (let at = 0; at < blob.size; at += DETACH_CHUNK_BYTES) {
    parts.push(new Blob([await blob.slice(at, at + DETACH_CHUNK_BYTES).arrayBuffer()]))
  }
  return new Blob(parts, { type })
}

const keptListeners = new Set<() => void>()

/**
 * Be told whenever a take is left on disk for recovery — the store was
 * released rather than discarded, after it had kept something. The recovery
 * prompt listens, so a take that ended in an error is offered back at once
 * instead of on the next visit. Returns the unsubscribe.
 */
export function onTakeKept(listener: () => void): () => void {
  keptListeners.add(listener)
  return () => {
    keptListeners.delete(listener)
  }
}

/** Delete one take's directory. Never rejects; a failure is only logged. */
export async function removeTakeDirectory(takeId: string): Promise<void> {
  try {
    const dir = await takesDirectory()
    await dir?.removeEntry(takeId, { recursive: true })
  } catch (error) {
    console.warn(`The kept recording ${takeId} could not be deleted:`, error)
  }
}

/**
 * Start keeping a take on disk. Returns at once; `ready` says whether it
 * worked. Never throws: a browser that cannot keep it gets a store whose
 * `ready` is `false` and whose every method is a no-op.
 */
export function createTakeStore(journal: TakeJournal): TakeStore {
  const features = storageFeatures()
  let worker: Worker | null = null
  let state: 'opening' | 'open' | 'unavailable' | 'failed' | 'closed' = 'opening'
  const failureListeners: Array<(error: TakeStorageError) => void> = []
  let failure: TakeStorageError | null = null
  // Set once the lock is granted; `lockReleased` covers a release that lands
  // before the grant, which would otherwise hold the lock for the tab's life.
  let lockReleased = false
  let freeLock: (() => void) | null = null
  const releaseLock = () => {
    lockReleased = true
    freeLock?.()
  }
  let finishing: Promise<TakeFiles | null> | null = null
  let closing: Promise<boolean> | null = null
  let settling: Promise<void> | null = null
  let resolveReady!: (ok: boolean) => void
  let resolveClosed: ((reply: { files: Record<string, File>; failed: boolean }) => void) | null =
    null
  const ready = new Promise<boolean>((resolve) => (resolveReady = resolve))

  const unavailable = (why: string) => {
    if (state !== 'opening') return
    state = 'unavailable'
    console.info(`This recording is not being kept on the device as it records: ${why}`)
    worker?.terminate()
    worker = null
    releaseLock()
    resolveReady(false)
  }

  const fail = (message: string) => {
    if (state === 'failed') return
    state = 'failed'
    failure = new TakeStorageError(message)
    console.error(failure)
    for (const listener of failureListeners) listener(failure)
  }

  if (!features) {
    state = 'unavailable'
    resolveReady(false)
  } else {
    // A browser can offer the API and still refuse the lock (an opaque
    // `file://` origin rejects with a SecurityError). A take with no lock could
    // be recovered by another tab while this one is still recording it, so a
    // refusal makes the store unavailable, like any other missing piece — and
    // is caught, rather than surfacing as an unhandled rejection.
    features.locks
      .request(
        takeLockName(journal.takeId),
        () =>
          new Promise<void>((resolve) => {
            freeLock = resolve
            if (lockReleased) resolve()
          })
      )
      .catch((error: unknown) => unavailable(`the take lock was refused: ${String(error)}`))
    const url = URL.createObjectURL(
      new Blob([TAKE_STORE_WORKER_SOURCE], { type: 'text/javascript' })
    )
    try {
      worker = new Worker(url)
    } catch (error) {
      URL.revokeObjectURL(url)
      unavailable(String(error))
    }
    if (worker) {
      const timeout = setTimeout(
        () => unavailable('the storage worker did not answer'),
        TAKE_STORE_OPEN_TIMEOUT_MS
      )
      worker.onerror = (event) => {
        event.preventDefault?.()
        clearTimeout(timeout)
        URL.revokeObjectURL(url)
        if (state === 'opening') {
          unavailable(event.message || 'the storage worker would not start')
        } else if (state === 'open' || state === 'failed') {
          fail(event.message || 'the storage worker stopped')
          // A worker that died answers no close: what it flushed is all there is.
          resolveClosed?.({ files: {}, failed: true })
        }
      }
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data
        if (reply.op === 'opened') {
          clearTimeout(timeout)
          URL.revokeObjectURL(url)
          if (state === 'opening') {
            state = 'open'
            resolveReady(true)
          }
        } else if (reply.op === 'error') {
          clearTimeout(timeout)
          URL.revokeObjectURL(url)
          unavailable(reply.message)
        } else if (reply.op === 'failed') {
          fail(reply.message)
        } else {
          resolveClosed?.(reply)
        }
      }
      worker.postMessage({
        op: 'open',
        root: TAKES_DIRECTORY,
        takeId: journal.takeId,
        journalName: JOURNAL_FILE,
        journal: JSON.stringify(journal),
      })
    }
  }

  const accepting = () => worker !== null && (state === 'opening' || state === 'open')

  /** Close every file and stop the worker. Whether anything was kept on disk. */
  const closeFiles = () => {
    closing ??= (async () => {
      const opened = await ready
      await store.finish()
      worker?.terminate()
      worker = null
      return opened
    })()
    return closing
  }

  const store: TakeStore = {
    takeId: journal.takeId,
    ready,

    write(part, data, position) {
      if (!accepting()) return
      let payload: ArrayBuffer | Blob
      const transfer: Transferable[] = []
      if (data instanceof Blob) {
        payload = data
      } else if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        payload = data.buffer as ArrayBuffer
        transfer.push(payload)
      } else {
        payload = data.slice().buffer
        transfer.push(payload)
      }
      worker!.postMessage({ op: 'write', name: partFileName(part), data: payload, at: position }, transfer)
    },

    writable(part) {
      return new WritableStream<StreamTargetChunk>({
        write: (chunk) => store.write(part, chunk.data, chunk.position),
      })
    },

    onFailure(listener) {
      failureListeners.push(listener)
      if (failure) listener(failure)
    },

    finish() {
      finishing ??= (async () => {
        // A store that already failed has nothing to hand back, and its
        // worker may be gone: terminating it (in `closeFiles`) lets the
        // handles go without waiting on an answer.
        if (!(await ready) || !worker || state === 'failed') return null
        let timer: ReturnType<typeof setTimeout> | undefined
        const closed = new Promise<{ files: Record<string, File>; failed: boolean }>((resolve) => {
          resolveClosed = resolve
          timer = setTimeout(() => {
            fail('the storage worker did not close the files')
            resolve({ files: {}, failed: true })
          }, TAKE_STORE_CLOSE_TIMEOUT_MS)
        })
        worker.postMessage({ op: 'close' })
        const reply = await closed
        clearTimeout(timer)
        const wasOpen = state === 'open'
        if (wasOpen) state = 'closed'
        if (reply.failed || !wasOpen) return null
        const files: TakeFiles = {}
        for (const part of TAKE_PARTS) {
          const file = reply.files[partFileName(part)]
          if (file) files[part] = file
        }
        return files
      })()
      return finishing
    },

    release() {
      settling ??= (async () => {
        const kept = await closeFiles()
        releaseLock()
        if (kept) for (const listener of keptListeners) listener()
      })()
      return settling
    },

    discard() {
      settling ??= (async () => {
        await closeFiles()
        // Deleted while the lock is still held, so no other tab — and no
        // recovery scan in this one — can find the files in between.
        if (features) await removeTakeDirectory(journal.takeId)
        releaseLock()
      })()
      return settling
    },
  }
  return store
}
