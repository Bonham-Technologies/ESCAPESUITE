// The take store, the page's half of crash-safe takes (ESCSUITE-466), driven
// against the in-memory OPFS, Web Locks and a worker double that runs the
// real worker source (`src/test/doubles/opfs.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTakeStore,
  DETACH_CHUNK_BYTES,
  detachFromDisk,
  JOURNAL_FILE,
  onTakeKept,
  partFileName,
  removeTakeDirectory,
  TAKE_STORE_CLOSE_TIMEOUT_MS,
  TAKE_STORE_OPEN_TIMEOUT_MS,
  takeLockName,
  TakeStorageError,
  takesDirectory,
  TAKES_DIRECTORY,
  type TakeJournal,
} from './takeStore'
import {
  installBrowserStorageDouble,
  settleWorker,
  WorkerDouble,
  type BrowserStorageDouble,
} from '../test/doubles/opfs'

const journal = (takeId = 'take-1'): TakeJournal => ({
  version: 1,
  takeId,
  startedAt: 1_700_000_000_000,
  recorder: 'webcodecs',
  captured: {
    micAcquired: true,
    separateTracks: false,
    systemAudioEnabled: false,
    webcamEnabled: false,
    overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
    hasVideoSource: true,
  },
  systemAudioShared: false,
})

let env: BrowserStorageDouble

beforeEach(() => {
  env = installBrowserStorageDouble()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  env.restore()
  vi.restoreAllMocks()
})

const takeDir = (takeId = 'take-1') => env.opfs.root.dir(TAKES_DIRECTORY, takeId)
const bytesOf = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())]

describe('names', () => {
  it('names a part file and a take lock', () => {
    expect(partFileName('primary')).toBe('primary.webm')
    expect(partFileName('mic')).toBe('mic.webm')
    expect(takeLockName('abc')).toBe('escapecraft-take:abc')
  })
})

describe('createTakeStore where the browser cannot keep a take', () => {
  it('is unavailable without a Worker, and every method is a no-op', async () => {
    vi.stubGlobal('Worker', undefined)
    const store = createTakeStore(journal())
    expect(store.takeId).toBe('take-1')
    expect(await store.ready).toBe(false)
    store.write('primary', new Uint8Array([1]))
    const listener = vi.fn()
    store.onFailure(listener)
    expect(await store.finish()).toBeNull()
    await store.discard()
    await store.release()
    expect(listener).not.toHaveBeenCalled()
    expect(env.opfs.root.children.size).toBe(0)
  })

  it('is unavailable without Web Locks', async () => {
    delete (navigator as unknown as Record<string, unknown>).locks
    expect(await createTakeStore(journal()).ready).toBe(false)
  })

  it('is unavailable when the Worker cannot be constructed', async () => {
    WorkerDouble.options.constructorError = new Error('blocked by policy')
    const store = createTakeStore(journal())
    expect(await store.ready).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('blocked by policy'))
    // The lock it took is let go at once.
    await settleWorker()
    expect(env.locks.held.size).toBe(0)
  })

  it('is unavailable when the worker never answers', async () => {
    vi.useFakeTimers()
    WorkerDouble.options.silent = true
    const store = createTakeStore(journal())
    let ready: boolean | undefined
    void store.ready.then((value) => (ready = value))
    await vi.advanceTimersByTimeAsync(TAKE_STORE_OPEN_TIMEOUT_MS)
    expect(ready).toBe(false)
    expect(WorkerDouble.instances[0].terminated).toBe(true)
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('did not answer'))
  })

  it('is unavailable when the worker fails to start, with or without a message', async () => {
    WorkerDouble.options.startupError = 'SyntaxError'
    expect(await createTakeStore(journal('a')).ready).toBe(false)
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('SyntaxError'))
    WorkerDouble.options.startupError = ''
    WorkerDouble.options.silent = false
    // An empty message still reads as a start failure.
    const store = createTakeStore(journal('b'))
    WorkerDouble.instances.at(-1)!.crash('')
    expect(await store.ready).toBe(false)
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('would not start'))
  })

  it('is unavailable when the worker is refused a sync access handle', async () => {
    env.opfs.syncHandlesRefused = true
    const store = createTakeStore(journal())
    expect(await store.ready).toBe(false)
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('InvalidStateError'))
    // Writes after that go nowhere.
    store.write('primary', new Uint8Array([1]))
    expect(WorkerDouble.instances[0].sent).toHaveLength(1)
    expect(await store.finish()).toBeNull()
  })
})

describe('createTakeStore where the browser keeps a take', () => {
  it('writes the journal before it says ready, and holds the take lock', async () => {
    const store = createTakeStore(journal())
    expect(await store.ready).toBe(true)
    const kept = takeDir()!.file(JOURNAL_FILE)!
    expect(JSON.parse(new TextDecoder().decode(kept.flushedBytes))).toEqual(journal())
    expect(env.locks.held.has(takeLockName('take-1'))).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    await store.discard()
  })

  it('transfers a whole buffer, copies a view, passes a Blob, and finishes with every part', async () => {
    const store = createTakeStore(journal())
    await store.ready
    const whole = new Uint8Array([1, 2])
    store.write('primary', whole)
    const backing = new Uint8Array([0, 3, 4, 0])
    store.write('primary', backing.subarray(1, 3))
    store.write('mic', new Blob([new Uint8Array([5])]))
    store.write('primary', new Uint8Array([9]), 0)
    const worker = WorkerDouble.instances[0]
    // The view's buffer was not handed over: a copy was.
    expect((worker.sent[2] as { data: ArrayBuffer }).data).not.toBe(backing.buffer)
    expect((worker.sent[1] as { data: ArrayBuffer }).data).toBe(whole.buffer)

    const files = await store.finish()
    expect(Object.keys(files!).sort()).toEqual(['mic', 'primary'])
    expect(await bytesOf(files!.primary!)).toEqual([9, 2, 3, 4])
    expect(await bytesOf(files!.mic!)).toEqual([5])
    // Memoized.
    expect(await store.finish()).toBe(files)
    await store.discard()
  })

  it('takes writes from a StreamTarget sink', async () => {
    const store = createTakeStore(journal())
    await store.ready
    const writer = store.writable('webcam').getWriter()
    await writer.write({ type: 'write', data: new Uint8Array([1, 2, 3]), position: 0 })
    await writer.write({ type: 'write', data: new Uint8Array([7]), position: 1 })
    await writer.close()
    const files = await store.finish()
    expect(await bytesOf(files!.webcam!)).toEqual([1, 7, 3])
    await store.release()
  })

  it('release keeps the files, lets the lock go and tells whoever listens', async () => {
    const kept = vi.fn()
    const unsubscribe = onTakeKept(kept)
    const store = createTakeStore(journal())
    await store.ready
    store.write('primary', new Uint8Array([1]))
    await store.release()
    expect(kept).toHaveBeenCalledTimes(1)
    expect(takeDir()!.file('primary.webm')!.flushedBytes.length).toBe(1)
    await settleWorker()
    expect(env.locks.held.size).toBe(0)
    expect(WorkerDouble.instances[0].terminated).toBe(true)
    // Only the first settle does anything.
    await store.discard()
    expect(takeDir()).toBeDefined()
    unsubscribe()
    const other = createTakeStore(journal('take-2'))
    await other.release()
    expect(kept).toHaveBeenCalledTimes(1)
  })

  it('release of a store that kept nothing tells nobody', async () => {
    env.opfs.syncHandlesRefused = true
    const kept = vi.fn()
    const unsubscribe = onTakeKept(kept)
    await createTakeStore(journal()).release()
    expect(kept).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('discard deletes the take directory while it still holds the lock', async () => {
    const store = createTakeStore(journal())
    await store.ready
    store.write('primary', new Uint8Array([1]))
    let heldWhileRemoving = false
    const dir = env.opfs.root.dir(TAKES_DIRECTORY)!
    const remove = dir.removeEntry.bind(dir)
    vi.spyOn(dir, 'removeEntry').mockImplementation(async (name, options) => {
      heldWhileRemoving = env.locks.held.has(takeLockName('take-1'))
      return remove(name, options)
    })
    await store.discard()
    expect(heldWhileRemoving).toBe(true)
    expect(takeDir()).toBeUndefined()
    await settleWorker()
    expect(env.locks.held.size).toBe(0)
  })

  it('lets a lock go that is granted only after the store was settled', async () => {
    let freeOther!: () => void
    void env.locks.request(takeLockName('take-1'), () => new Promise<void>((resolve) => (freeOther = resolve)))
    const store = createTakeStore(journal())
    await store.ready
    await store.discard()
    freeOther()
    await settleWorker()
    expect(env.locks.held.size).toBe(0)
  })

  it('reports a failed write once, to every listener, including one that comes late', async () => {
    const store = createTakeStore(journal())
    await store.ready
    const first = vi.fn()
    store.onFailure(first)
    env.opfs.writeError = new DOMException('Quota exceeded', 'QuotaExceededError')
    store.write('primary', new Uint8Array([1]))
    await settleWorker()
    expect(first).toHaveBeenCalledTimes(1)
    const error = first.mock.calls[0][0]
    expect(error).toBeInstanceOf(TakeStorageError)
    expect(error.message).toBe(
      'The recording could not be kept on this device: QuotaExceededError: Quota exceeded'
    )
    const late = vi.fn()
    store.onFailure(late)
    expect(late).toHaveBeenCalledWith(error)
    // A crash on top of it is not a second failure.
    WorkerDouble.instances[0].crash('gone')
    expect(first).toHaveBeenCalledTimes(1)
    // The files are not the take any more.
    expect(await store.finish()).toBeNull()
    await store.release()
  })

  it('treats a worker that dies mid-take as a failure, and finishes without waiting for it', async () => {
    const store = createTakeStore(journal())
    await store.ready
    const listener = vi.fn()
    store.onFailure(listener)
    const worker = WorkerDouble.instances[0]
    worker.crash('')
    expect(listener.mock.calls[0][0].message).toContain('the storage worker stopped')
    // Its close goes nowhere; the failure already answers for it.
    worker.terminate()
    expect(await store.finish()).toBeNull()
  })

  it('answers a close the worker is still working on when the worker dies', async () => {
    const store = createTakeStore(journal())
    await store.ready
    const worker = WorkerDouble.instances[0]
    worker.terminate()
    const finished = store.finish()
    await settleWorker()
    worker.crash('out of memory')
    expect(await finished).toBeNull()
  })

  it('gives up on a close the worker never answers', async () => {
    const store = createTakeStore(journal())
    await store.ready
    vi.useFakeTimers()
    const listener = vi.fn()
    store.onFailure(listener)
    WorkerDouble.instances[0].terminate()
    let files: unknown = 'pending'
    void store.finish().then((value) => (files = value))
    await vi.advanceTimersByTimeAsync(TAKE_STORE_CLOSE_TIMEOUT_MS)
    expect(files).toBeNull()
    expect(listener.mock.calls[0][0].message).toContain('did not close the files')
  })

  it('ignores an error event from a worker it already closed', async () => {
    const store = createTakeStore(journal())
    await store.ready
    const listener = vi.fn()
    store.onFailure(listener)
    await store.finish()
    WorkerDouble.instances[0].crash('late')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('takesDirectory and removeTakeDirectory', () => {
  it('finds the takes directory only once it exists, unless asked to create it', async () => {
    expect(await takesDirectory()).toBeNull()
    const made = await takesDirectory(true)
    expect(made?.name).toBe(TAKES_DIRECTORY)
    expect(await takesDirectory()).toBe(made)
  })

  it('has no takes directory where the browser cannot keep a take', async () => {
    vi.stubGlobal('Worker', undefined)
    expect(await takesDirectory(true)).toBeNull()
  })

  it('removes one take, and only logs a removal that fails', async () => {
    const store = createTakeStore(journal())
    await store.ready
    await store.release()
    await removeTakeDirectory('take-1')
    expect(takeDir()).toBeUndefined()
    await removeTakeDirectory('never-was')
    expect(console.warn).toHaveBeenCalledWith(
      'The kept recording never-was could not be deleted:',
      expect.any(DOMException)
    )
  })

  it('removes nothing where there is no takes directory', async () => {
    await removeTakeDirectory('take-1')
    expect(console.warn).not.toHaveBeenCalled()
  })
})

describe('detachFromDisk', () => {
  it('copies a blob in chunks, keeping or replacing its type', async () => {
    const big = new Uint8Array(DETACH_CHUNK_BYTES + 3)
    big[0] = 1
    big[big.length - 1] = 2
    const source = new Blob([big], { type: 'video/webm' })
    const copy = await detachFromDisk(source)
    expect(copy).not.toBe(source)
    expect(copy.type).toBe('video/webm')
    expect(copy.size).toBe(big.length)
    const back = new Uint8Array(await copy.arrayBuffer())
    expect(back[0]).toBe(1)
    expect(back[back.length - 1]).toBe(2)
    expect((await detachFromDisk(new Blob([new Uint8Array([1])]), 'audio/webm')).type).toBe('audio/webm')
    expect((await detachFromDisk(new Blob([]))).size).toBe(0)
  })
})
