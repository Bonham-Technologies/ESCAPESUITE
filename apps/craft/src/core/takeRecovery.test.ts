// Finding and repairing takes that never finished (ESCSUITE-466), against the
// in-memory OPFS and Web Locks (`src/test/doubles/opfs.ts`). The metadata
// repair itself is the save path's (`fixWebMMetadata`, covered over real
// containers in `takeRepair.test.ts`), so here it is a boundary that can
// succeed or throw.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discardUnfinishedTake,
  findUnfinishedTakes,
  NothingToRecoverError,
  repairUnfinishedTake,
  UnreadableTakeError,
  withTakeClaimed,
  type UnfinishedTake,
} from './takeRecovery'
import { JOURNAL_FILE, takeLockName, TAKES_DIRECTORY, type TakeJournal } from './takeStore'
import { installBrowserStorageDouble, type BrowserStorageDouble } from '../test/doubles/opfs'
import { el } from '../test/webmFixture'

const fixWebMMetadata = vi.hoisted(() => vi.fn(async (blob: Blob) => new Blob([blob, new Uint8Array([0xec, 0x80])], { type: blob.type })))
vi.mock('./converter', () => ({ fixWebMMetadata }))

const journal = (takeId: string, startedAt = 1000, extra: Partial<TakeJournal> = {}): TakeJournal => ({
  version: 1,
  takeId,
  startedAt,
  recorder: 'mediarecorder',
  captured: {
    micAcquired: true,
    separateTracks: true,
    systemAudioEnabled: true,
    webcamEnabled: true,
    overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
    hasVideoSource: true,
  },
  systemAudioShared: true,
  ...extra,
})

/** A small WebM whose last block is at `seconds`. */
function webm(seconds: number): Uint8Array<ArrayBuffer> {
  const ms = Math.round(seconds * 1000)
  const block = (rel: number) => el([0xa3], [0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80, 0, 0, 0, 0])
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], [...el([0xe7], [0, 0]), ...block(0), ...(ms > 0 ? block(ms) : [])], true)
  return new Uint8Array([
    ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d])),
    0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ...cluster,
  ])
}

let env: BrowserStorageDouble

/** Lay a take directory out in OPFS, as a tab that died would leave it. */
async function leaveTake(takeId: string, files: Record<string, Uint8Array<ArrayBuffer> | string>): Promise<void> {
  const takes = await env.opfs.root.getDirectoryHandle(TAKES_DIRECTORY, { create: true })
  const dir = await takes.getDirectoryHandle(takeId, { create: true })
  for (const [name, content] of Object.entries(files)) {
    const handle = await dir.getFileHandle(name, { create: true })
    handle.bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  }
}

const journalText = (takeId: string, startedAt = 1000, extra: Partial<TakeJournal> = {}) =>
  JSON.stringify(journal(takeId, startedAt, extra))

beforeEach(() => {
  env = installBrowserStorageDouble()
  fixWebMMetadata.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  env.restore()
  vi.restoreAllMocks()
})

describe('findUnfinishedTakes', () => {
  it('finds nothing where there is no takes directory, or no storage at all', async () => {
    expect(await findUnfinishedTakes()).toEqual([])
    vi.stubGlobal('Worker', undefined)
    expect(await findUnfinishedTakes()).toEqual([])
  })

  it('lists abandoned takes oldest first, with their parts and size', async () => {
    await leaveTake('late', { [JOURNAL_FILE]: journalText('late', 2000), 'primary.webm': webm(1) })
    await leaveTake('early', {
      [JOURNAL_FILE]: journalText('early', 1000),
      'primary.webm': webm(1),
      'mic.webm': new Uint8Array([1, 2, 3]),
    })
    const found = await findUnfinishedTakes()
    expect(found.map((t) => t.journal.takeId)).toEqual(['early', 'late'])
    expect(Object.keys(found[0].files).sort()).toEqual(['mic', 'primary'])
    expect(found[0].size).toBe(webm(1).length + 3)
    expect(found[0].journal).toEqual(journal('early', 1000))
  })

  it('leaves a take alone while another tab holds its lock', async () => {
    await leaveTake('live', { [JOURNAL_FILE]: journalText('live'), 'primary.webm': webm(1) })
    let free!: () => void
    void env.locks.request(takeLockName('live'), () => new Promise<void>((resolve) => (free = resolve)))
    expect(await findUnfinishedTakes()).toEqual([])
    expect(env.opfs.root.dir(TAKES_DIRECTORY, 'live')).toBeDefined()
    free()
  })

  it('deletes a take that never got as far as a frame, or whose journal is not its own', async () => {
    await leaveTake('no-journal', { 'primary.webm': webm(1) })
    await leaveTake('bad-json', { [JOURNAL_FILE]: '{', 'primary.webm': webm(1) })
    await leaveTake('null-json', { [JOURNAL_FILE]: 'null', 'primary.webm': webm(1) })
    await leaveTake('wrong-id', { [JOURNAL_FILE]: journalText('someone-else'), 'primary.webm': webm(1) })
    await leaveTake('no-date', { [JOURNAL_FILE]: JSON.stringify({ ...journal('no-date'), startedAt: 'x' }), 'primary.webm': webm(1) })
    await leaveTake('bad-recorder', { [JOURNAL_FILE]: journalText('bad-recorder', 1, { recorder: 'x' as 'webcodecs' }), 'primary.webm': webm(1) })
    await leaveTake('no-captured', { [JOURNAL_FILE]: JSON.stringify({ ...journal('no-captured'), captured: null }), 'primary.webm': webm(1) })
    await leaveTake('no-primary', { [JOURNAL_FILE]: journalText('no-primary') })
    await leaveTake('empty-primary', { [JOURNAL_FILE]: journalText('empty-primary'), 'primary.webm': new Uint8Array(0) })
    await leaveTake('good', { [JOURNAL_FILE]: journalText('good', 5, { recorder: 'webcodecs' }), 'primary.webm': webm(1) })
    const found = await findUnfinishedTakes()
    expect(found.map((t) => t.journal.takeId)).toEqual(['good'])
    expect([...env.opfs.root.dir(TAKES_DIRECTORY)!.children.keys()]).toEqual(['good'])
  })

  it('leaves alone a take another version of CRAFT wrote: neither offered nor deleted', async () => {
    await leaveTake('other-version', { [JOURNAL_FILE]: JSON.stringify({ ...journal('other-version'), version: 2 }), 'primary.webm': webm(1) })
    // Another version number on someone else's id is not this take's journal.
    await leaveTake('other-id', { [JOURNAL_FILE]: JSON.stringify({ ...journal('x'), version: 2 }), 'primary.webm': webm(1) })
    expect(await findUnfinishedTakes()).toEqual([])
    expect([...env.opfs.root.dir(TAKES_DIRECTORY)!.children.keys()]).toEqual(['other-version'])
  })

  it('skips a stray file in the takes directory', async () => {
    const takes = await env.opfs.root.getDirectoryHandle(TAKES_DIRECTORY, { create: true })
    await takes.getFileHandle('stray', { create: true })
    expect(await findUnfinishedTakes()).toEqual([])
    expect(takes.children.has('stray')).toBe(true)
  })

  it('never rejects when the directory cannot be listed', async () => {
    await env.opfs.root.getDirectoryHandle(TAKES_DIRECTORY, { create: true })
    env.opfs.listError = new Error('denied')
    expect(await findUnfinishedTakes()).toEqual([])
    expect(console.warn).toHaveBeenCalledWith('Unfinished recordings could not be listed:', env.opfs.listError)
  })
})

describe('withTakeClaimed and discardUnfinishedTake', () => {
  async function oneTake(): Promise<UnfinishedTake> {
    await leaveTake('t', { [JOURNAL_FILE]: journalText('t'), 'primary.webm': webm(1) })
    return (await findUnfinishedTakes())[0]
  }

  it('runs the work holding the take lock', async () => {
    const take = await oneTake()
    let held = false
    expect(await withTakeClaimed(take, async () => {
      held = env.locks.held.has(takeLockName('t'))
    })).toBe(true)
    expect(held).toBe(true)
    expect(env.locks.held.size).toBe(0)
  })

  it('runs nothing while another tab holds the lock', async () => {
    const take = await oneTake()
    let free!: () => void
    void env.locks.request(takeLockName('t'), () => new Promise<void>((resolve) => (free = resolve)))
    const work = vi.fn(async () => {})
    expect(await withTakeClaimed(take, work)).toBe(false)
    expect(work).not.toHaveBeenCalled()
    free()
  })

  it('deletes the take directory', async () => {
    const take = await oneTake()
    await discardUnfinishedTake(take)
    expect(env.opfs.root.dir(TAKES_DIRECTORY, 't')).toBeUndefined()
  })
})

describe('repairUnfinishedTake', () => {
  async function takeWith(files: Record<string, Uint8Array<ArrayBuffer>>): Promise<UnfinishedTake> {
    await leaveTake('r', { [JOURNAL_FILE]: journalText('r'), ...files })
    return (await findUnfinishedTakes())[0]
  }

  it('repairs every part, measures each from its last block, and copies them off the disk', async () => {
    const take = await takeWith({
      'primary.webm': webm(2.5),
      'webcam.webm': webm(2.4),
      'mic.webm': webm(2),
      // An audio part with one block at 0 s takes the take's length.
      'system.webm': webm(0),
    })
    const recovered = await repairUnfinishedTake(take)
    expect(recovered.journal).toEqual(journal('r'))
    expect(recovered.duration).toBe(2.5)
    expect(recovered.seekable).toBe(true)
    expect(recovered.blob.type).toBe('video/webm')
    expect(recovered.blob).not.toBeInstanceOf(File)
    expect(fixWebMMetadata).toHaveBeenCalledTimes(4)
    expect(recovered.companions.map((c) => [c.role, c.blob.type, c.startOffset, c.duration])).toEqual([
      ['webcam', 'video/webm', 0, undefined],
      ['mic', 'audio/webm', 0, 2],
      ['system', 'audio/webm', 0, 2.5],
    ])
    expect('duration' in recovered.companions[0]).toBe(false)
    // The repair's output, not the file as it was.
    const bytes = new Uint8Array(await recovered.blob.arrayBuffer())
    expect([...bytes.slice(-2)]).toEqual([0xec, 0x80])
  })

  it('leaves out a companion that holds nothing whole', async () => {
    const take = await takeWith({ 'primary.webm': webm(1), 'webcam.webm': new Uint8Array([1, 2, 3]) })
    expect((await repairUnfinishedTake(take)).companions).toEqual([])
  })

  it('stores a part whose repair threw trimmed but unrepaired, and says it may not seek', async () => {
    const take = await takeWith({ 'primary.webm': webm(1), 'mic.webm': webm(1) })
    fixWebMMetadata.mockResolvedValueOnce(new Blob([webm(1)])).mockRejectedValueOnce(new Error('bad EBML'))
    const recovered = await repairUnfinishedTake(take)
    expect(recovered.seekable).toBe(false)
    expect(recovered.companions).toHaveLength(1)
    expect(console.warn).toHaveBeenCalledWith('WebM metadata repair failed:', expect.any(Error))
  })

  it('rejects when the main file holds nothing whole', async () => {
    const take = await takeWith({ 'primary.webm': new Uint8Array([0x1a, 0x45]) })
    await expect(repairUnfinishedTake(take)).rejects.toBeInstanceOf(NothingToRecoverError)
    await expect(repairUnfinishedTake(take)).rejects.toThrow('holds no complete frame or sound')
  })

  it('rejects a main file that is not a WebM at all, and leaves the copy where it is', async () => {
    // What Safari's MediaRecorder writes: an MP4, starting with its ftyp box.
    const mp4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])
    const take = await takeWith({ 'primary.webm': mp4 })
    await expect(repairUnfinishedTake(take)).rejects.toBeInstanceOf(UnreadableTakeError)
    await expect(repairUnfinishedTake(take)).rejects.toThrow('not a WebM file')
    expect(env.opfs.root.dir(TAKES_DIRECTORY, take.journal.takeId)).toBeDefined()
  })
})
