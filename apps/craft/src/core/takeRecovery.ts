/**
 * Finding a take that never finished, and turning it back into a recording
 * (ESCSUITE-466). `takeStore.ts` describes how a take is kept on disk while it
 * records; this is the other end, run when CRAFT next opens.
 *
 * A take directory is "unfinished" when nobody holds its Web Lock (no tab is
 * recording it) and its journal and primary file are both there. One with no
 * readable journal or no primary bytes never got as far as a frame — the tab
 * died while it was being set up — and is deleted on sight, without asking.
 *
 * Recovery repairs every part the same way a MediaRecorder take is repaired at
 * save: `trimToWholeBlocks()` cuts the torn tail and gives the file an
 * unknown-size Segment, then `fixWebMMetadata()` writes Duration, SeekHead and
 * a keyframe Cues index. The length of each part is its last block's
 * timestamp, which is as close to "what was recorded before the page died" as
 * the bytes can say.
 */
import type { CompanionPart } from '../store/types'
import { fixWebMMetadata } from './converter'
import {
  JOURNAL_FILE,
  TAKE_PARTS,
  detachFromDisk,
  partFileName,
  removeTakeDirectory,
  takeLockName,
  takesDirectory,
  type TakeFiles,
  type TakeJournal,
} from './takeStore'
import { trimToWholeBlocks } from './webmTrim'

export interface UnfinishedTake {
  journal: TakeJournal
  files: TakeFiles
  /** Bytes on disk across every part, for the prompt. */
  size: number
}

export interface RecoveredTake {
  journal: TakeJournal
  blob: Blob
  /** Seconds: the primary's last block. */
  duration: number
  companions: CompanionPart[]
  /**
   * False when a part's metadata repair threw and it is stored trimmed but
   * unrepaired: it plays, but may not seek — the save path's `NOT_SEEKABLE`
   * case, and stored for the same reason (a take beats no take).
   */
  seekable: boolean
}

/** Nothing whole was left in the take's main file. */
export class NothingToRecoverError extends Error {
  constructor() {
    super('The unfinished recording holds no complete frame or sound')
    this.name = 'NothingToRecoverError'
  }
}

interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => T | Promise<T>
  ): Promise<T>
}

interface DirectoryEntries {
  entries(): AsyncIterable<[string, FileSystemHandle]>
}

/** Whether no tab holds this take's lock — i.e. nobody is recording it now. */
async function isAbandoned(takeId: string): Promise<boolean> {
  const locks = (navigator as Navigator & { locks: LockManagerLike }).locks
  return locks.request(takeLockName(takeId), { ifAvailable: true }, (lock) => lock !== null)
}

function isJournal(value: unknown, takeId: string): value is TakeJournal {
  const journal = value as Partial<TakeJournal> | null
  return (
    !!journal &&
    journal.version === 1 &&
    journal.takeId === takeId &&
    typeof journal.startedAt === 'number' &&
    (journal.recorder === 'webcodecs' || journal.recorder === 'mediarecorder') &&
    typeof journal.captured === 'object' &&
    journal.captured !== null
  )
}

/**
 * A journal another version of CRAFT wrote: its own take, in a shape this
 * build cannot read. Not this build's to delete — a rollback would otherwise
 * erase a newer build's unfinished take without asking.
 */
function isOtherVersion(value: unknown, takeId: string): boolean {
  const journal = value as { version?: unknown; takeId?: unknown } | null
  return !!journal && typeof journal.version === 'number' && journal.version !== 1 && journal.takeId === takeId
}

/** Left alone: neither offered nor deleted. */
const OTHER_VERSION = 'other-version'

async function readTake(dir: FileSystemDirectoryHandle): Promise<UnfinishedTake | typeof OTHER_VERSION | null> {
  let journal: unknown
  try {
    const file = await (await dir.getFileHandle(JOURNAL_FILE)).getFile()
    journal = JSON.parse(await file.text())
  } catch {
    return null
  }
  if (isOtherVersion(journal, dir.name)) return OTHER_VERSION
  if (!isJournal(journal, dir.name)) return null
  const files: TakeFiles = {}
  let size = 0
  for (const part of TAKE_PARTS) {
    try {
      const file = await (await dir.getFileHandle(partFileName(part))).getFile()
      files[part] = file
      size += file.size
    } catch {
      // This take has no such part.
    }
  }
  if (!files.primary || files.primary.size === 0) return null
  return { journal, files, size }
}

/**
 * Every take left unfinished on this device, oldest first. Never rejects: a
 * browser without the storage this needs has none, and a directory that
 * cannot be read is skipped.
 */
export async function findUnfinishedTakes(): Promise<UnfinishedTake[]> {
  const found: UnfinishedTake[] = []
  try {
    const takes = await takesDirectory()
    if (!takes) return found
    for await (const [name, handle] of (takes as unknown as DirectoryEntries).entries()) {
      if (handle.kind !== 'directory' || !(await isAbandoned(name))) continue
      const take = await readTake(handle as FileSystemDirectoryHandle)
      if (take === OTHER_VERSION) continue
      if (take) found.push(take)
      else await removeTakeDirectory(name)
    }
  } catch (error) {
    console.warn('Unfinished recordings could not be listed:', error)
  }
  return found.sort((a, b) => a.journal.startedAt - b.journal.startedAt)
}

/** Delete an unfinished take. Never rejects. */
export function discardUnfinishedTake(take: UnfinishedTake): Promise<void> {
  return removeTakeDirectory(take.journal.takeId)
}

interface RepairedPart {
  blob: Blob
  duration: number
  seekable: boolean
}

/**
 * The take's main file is not a WebM at all, so this build cannot tell what
 * is in it. Unlike `NothingToRecoverError` it is not a reason to delete the
 * copy: the prompt reports a failed recovery and keeps it, and only the
 * user's Discard removes it.
 */
export class UnreadableTakeError extends Error {
  constructor() {
    super('The unfinished recording is not a WebM file, so it cannot be repaired')
    this.name = 'UnreadableTakeError'
  }
}

/** The four bytes every WebM (every EBML file) starts with. */
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3]

/**
 * Whether the file could be a WebM: its first bytes agree with the magic as
 * far as they go. A file torn inside those four bytes is still a WebM that
 * holds nothing (`NothingToRecoverError`), not a file of another kind.
 */
async function couldBeWebM(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, EBML_MAGIC.length).arrayBuffer())
  return head.every((byte, i) => byte === EBML_MAGIC[i])
}

/** Trim and repair one part, or null when it holds nothing whole. */
async function repairPart(file: File, type: string): Promise<RepairedPart | null> {
  const trimmed = await trimToWholeBlocks(new Blob([file], { type }))
  if (!trimmed) return null
  try {
    return { blob: await fixWebMMetadata(trimmed.blob), duration: trimmed.lastBlockSeconds, seekable: true }
  } catch (error) {
    console.warn('WebM metadata repair failed:', error)
    return { blob: trimmed.blob, duration: trimmed.lastBlockSeconds, seekable: false }
  }
}

/**
 * Run `work` holding the take's lock, so two tabs can never recover (or
 * discard) the same take at once. Resolves `false` without running it when
 * another tab holds the lock.
 */
export async function withTakeClaimed(take: UnfinishedTake, work: () => Promise<void>): Promise<boolean> {
  const locks = (navigator as Navigator & { locks: LockManagerLike }).locks
  return locks.request(takeLockName(take.journal.takeId), { ifAvailable: true }, async (lock) => {
    if (lock === null) return false
    await work()
    return true
  })
}

/**
 * Turn an unfinished take back into a recording the save path can store.
 * Rejects with `NothingToRecoverError` when the main file is a WebM that
 * holds nothing whole, `UnreadableTakeError` when it is not a WebM at all,
 * and with whatever the repair threw when a file will not parse. A
 * companion part that holds nothing whole is left out, as a part the recorder
 * lost would be.
 */
export async function repairUnfinishedTake(take: UnfinishedTake): Promise<RecoveredTake> {
  const { journal, files } = take
  if (!(await couldBeWebM(files.primary!))) throw new UnreadableTakeError()
  const primary = await repairPart(files.primary!, 'video/webm')
  if (!primary) throw new NothingToRecoverError()
  let seekable = primary.seekable
  const companions: CompanionPart[] = []
  for (const role of ['webcam', 'mic', 'system'] as const) {
    const file = files[role]
    if (!file) continue
    const part = await repairPart(file, role === 'webcam' ? 'video/webm' : 'audio/webm')
    if (!part) continue
    seekable &&= part.seekable
    companions.push({
      role,
      blob: await detachFromDisk(part.blob, part.blob.type),
      startOffset: 0,
      // An audio part says how long it is (ESCSUITE-318); one block at 0 s
      // says nothing, so it is given the take's length instead.
      ...(role === 'webcam' ? {} : { duration: part.duration > 0 ? part.duration : primary.duration }),
    })
  }
  // Every part is copied off the disk (`detachFromDisk`): the take's files are
  // deleted once it is stored, and a Blob over them is what IndexedDB keeps.
  // Stored as `video/webm` whatever it holds, as every take always has been
  // (an audio-only MediaRecorder take included — see `recorder.ts`).
  return {
    journal,
    blob: await detachFromDisk(primary.blob, 'video/webm'),
    duration: primary.duration,
    companions,
    seekable,
  }
}
