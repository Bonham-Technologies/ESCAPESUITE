// The take store's worker (ESCSUITE-466), run as the string it ships as,
// against the in-memory OPFS in `src/test/doubles/opfs.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAKE_FLUSH_INTERVAL_MS, TAKE_STORE_WORKER_SOURCE } from './takeStoreWorker'
import {
  installBrowserStorageDouble,
  settleWorker,
  WorkerDouble,
  type BrowserStorageDouble,
} from '../test/doubles/opfs'

let env: BrowserStorageDouble
let replies: Array<Record<string, unknown>>

function startWorker(): WorkerDouble {
  URL.createObjectURL(new Blob([TAKE_STORE_WORKER_SOURCE], { type: 'text/javascript' }))
  const worker = new WorkerDouble('blob:take-store')
  worker.onmessage = (event) => replies.push(event.data as Record<string, unknown>)
  return worker
}

const OPEN = {
  op: 'open',
  root: 'takes',
  takeId: 'take-1',
  journalName: 'take.json',
  journal: '{"takeId":"take-1"}',
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

beforeEach(() => {
  env = installBrowserStorageDouble()
  replies = []
})

afterEach(() => {
  vi.useRealTimers()
  env.restore()
})

describe('take store worker', () => {
  it('writes and flushes the journal on open, then answers opened', async () => {
    const worker = startWorker()
    worker.postMessage(OPEN)
    await settleWorker()
    expect(replies).toEqual([{ op: 'opened' }])
    const journal = env.opfs.root.file('takes', 'take-1', 'take.json')!
    expect(text(journal.flushedBytes)).toBe(OPEN.journal)
    expect(journal.access).toBeNull()
  })

  it('appends writes without a position and writes positioned ones in place', async () => {
    const worker = startWorker()
    worker.postMessage(OPEN)
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([1, 2, 3]).buffer })
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Blob([new Uint8Array([4, 5])]) })
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([9]).buffer, at: 0 })
    worker.postMessage({ op: 'close' })
    await settleWorker()
    const closed = replies.at(-1) as { op: string; files: Record<string, File>; failed: boolean }
    expect(closed.op).toBe('closed')
    expect(closed.failed).toBe(false)
    expect(Object.keys(closed.files)).toEqual(['primary.webm'])
    expect([...new Uint8Array(await closed.files['primary.webm'].arrayBuffer())]).toEqual([9, 2, 3, 4, 5])
    const file = env.opfs.root.file('takes', 'take-1', 'primary.webm')!
    expect([...file.flushedBytes]).toEqual([9, 2, 3, 4, 5])
    expect(file.access).toBeNull()
  })

  it('appends after what an earlier session left in the file', async () => {
    const dir = await (await env.opfs.root.getDirectoryHandle('takes', { create: true }))
      .getDirectoryHandle('take-1', { create: true })
    ;(await dir.getFileHandle('primary.webm', { create: true })).bytes = new Uint8Array([7, 7])
    const worker = startWorker()
    worker.postMessage(OPEN)
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([1]).buffer })
    worker.postMessage({ op: 'close' })
    await settleWorker()
    expect([...env.opfs.root.file('takes', 'take-1', 'primary.webm')!.bytes]).toEqual([7, 7, 1])
  })

  it('flushes only the files written since the last flush, on its interval', async () => {
    vi.useFakeTimers()
    const worker = startWorker()
    worker.postMessage(OPEN)
    await vi.advanceTimersByTimeAsync(0)
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([1]).buffer })
    await vi.advanceTimersByTimeAsync(0)
    const file = env.opfs.root.file('takes', 'take-1', 'primary.webm')!
    expect(file.flushedBytes.length).toBe(0)
    await vi.advanceTimersByTimeAsync(TAKE_FLUSH_INTERVAL_MS)
    expect([...file.flushedBytes]).toEqual([1])
    expect(file.access!.flushes).toBe(1)
    // Nothing new: no second flush.
    await vi.advanceTimersByTimeAsync(TAKE_FLUSH_INTERVAL_MS)
    expect(file.access!.flushes).toBe(1)
  })

  it('answers error when open is refused, and stops its timer', async () => {
    env.opfs.syncHandlesRefused = true
    const worker = startWorker()
    worker.postMessage(OPEN)
    await settleWorker()
    expect(replies).toEqual([{ op: 'error', message: 'InvalidStateError: Sync access handles are refused' }])
  })

  it('describes a thrown value that is not an Error', async () => {
    const getDirectory = vi.mocked(navigator.storage.getDirectory)
    getDirectory.mockRejectedValueOnce('no storage')
    const worker = startWorker()
    worker.postMessage(OPEN)
    await settleWorker()
    expect(replies).toEqual([{ op: 'error', message: 'no storage' }])
  })

  it('reports a failed write once and drops every write after it', async () => {
    const worker = startWorker()
    worker.postMessage(OPEN)
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([1]).buffer })
    await settleWorker()
    env.opfs.writeError = new DOMException('Quota exceeded', 'QuotaExceededError')
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([2]).buffer })
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([3]).buffer })
    await settleWorker()
    env.opfs.writeError = null
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([4]).buffer })
    worker.postMessage({ op: 'close' })
    await settleWorker()
    expect(replies.map((r) => r.op)).toEqual(['opened', 'failed', 'closed'])
    expect(replies[1].message).toBe('QuotaExceededError: Quota exceeded')
    expect(replies[2].failed).toBe(true)
    expect([...env.opfs.root.file('takes', 'take-1', 'primary.webm')!.bytes]).toEqual([1])
  })

  it('treats a short write as a failure', async () => {
    env.opfs.shortWrites = true
    const worker = startWorker()
    worker.postMessage(OPEN)
    await settleWorker()
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([1, 2]).buffer })
    await settleWorker()
    expect(replies.at(-1)).toEqual({ op: 'failed', message: 'Error: Wrote 1 of 2 bytes' })
  })

  it('reports a flush that fails on the interval', async () => {
    vi.useFakeTimers()
    const worker = startWorker()
    worker.postMessage(OPEN)
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([1]).buffer })
    await vi.advanceTimersByTimeAsync(0)
    env.opfs.flushError = new Error('disk gone')
    await vi.advanceTimersByTimeAsync(TAKE_FLUSH_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(10)
    expect(replies.at(-1)).toEqual({ op: 'failed', message: 'Error: disk gone' })
    // A failed worker flushes nothing more, on the timer or at close.
    await vi.advanceTimersByTimeAsync(TAKE_FLUSH_INTERVAL_MS)
    worker.postMessage({ op: 'close' })
    await vi.advanceTimersByTimeAsync(10)
    expect(replies.map((r) => r.op)).toEqual(['opened', 'failed', 'closed'])
  })

  it('reports a flush that fails at close, and still closes and returns every file', async () => {
    const worker = startWorker()
    worker.postMessage(OPEN)
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([1]).buffer })
    worker.postMessage({ op: 'write', name: 'mic.webm', data: new Uint8Array([2]).buffer })
    await settleWorker()
    env.opfs.flushError = new Error('disk gone')
    worker.postMessage({ op: 'close' })
    await settleWorker()
    const closed = replies.at(-1) as { files: Record<string, File>; failed: boolean }
    expect(replies.map((r) => r.op)).toEqual(['opened', 'failed', 'closed'])
    expect(closed.failed).toBe(true)
    expect(Object.keys(closed.files).sort()).toEqual(['mic.webm', 'primary.webm'])
    expect(env.opfs.root.file('takes', 'take-1', 'mic.webm')!.access).toBeNull()
  })

  it('answers a close that throws with no files', async () => {
    const worker = startWorker()
    worker.postMessage(OPEN)
    worker.postMessage({ op: 'write', name: 'primary.webm', data: new Uint8Array([1]).buffer })
    await settleWorker()
    env.opfs.getFileError = new Error('unreadable')
    worker.postMessage({ op: 'close' })
    await settleWorker()
    expect(replies.at(-1)).toEqual({ op: 'closed', files: {}, failed: true, message: 'Error: unreadable' })
  })
})
