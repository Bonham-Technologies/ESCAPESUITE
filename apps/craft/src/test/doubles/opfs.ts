// Doubles for the browser half of crash-safe takes (ESCSUITE-466): an
// in-memory origin private file system (with sync access handles), Web Locks,
// and a dedicated Worker that runs a worker source string in-process.
//
// The worker double evaluates the real `TAKE_STORE_WORKER_SOURCE` (it reads
// the source back out of the Blob the page handed `URL.createObjectURL`), so a
// test drives the same code a browser would run, against this file system.
import { vi } from 'vitest'

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name)
}

export class SyncAccessHandleDouble {
  closed = false
  flushes = 0
  private readonly file: FileHandleDouble
  constructor(file: FileHandleDouble) {
    this.file = file
  }
  getSize(): number {
    return this.file.bytes.length
  }
  write(data: Uint8Array, options: { at: number }): number {
    if (this.file.fs.writeError) throw this.file.fs.writeError
    const at = options.at
    const end = at + data.byteLength
    if (end > this.file.bytes.length) {
      const grown = new Uint8Array(end)
      grown.set(this.file.bytes)
      this.file.bytes = grown
    }
    this.file.bytes.set(data, at)
    return this.file.fs.shortWrites ? data.byteLength - 1 : data.byteLength
  }
  truncate(size: number): void {
    this.file.bytes = this.file.bytes.slice(0, size)
  }
  flush(): void {
    if (this.file.fs.flushError) throw this.file.fs.flushError
    this.flushes++
    this.file.flushedBytes = this.file.bytes.slice()
  }
  close(): void {
    this.closed = true
    this.file.access = null
  }
}

export class FileHandleDouble {
  readonly kind = 'file'
  bytes = new Uint8Array(0)
  /** What the last flush made durable. */
  flushedBytes = new Uint8Array(0)
  access: SyncAccessHandleDouble | null = null
  readonly name: string
  readonly fs: OpfsDouble
  constructor(name: string, fs: OpfsDouble) {
    this.name = name
    this.fs = fs
  }
  async getFile(): Promise<File> {
    if (this.fs.getFileError) throw this.fs.getFileError
    return new File([this.bytes.slice()], this.name)
  }
  async createSyncAccessHandle(): Promise<SyncAccessHandleDouble> {
    if (this.fs.syncHandlesRefused) throw domError('InvalidStateError', 'Sync access handles are refused')
    if (this.access) throw domError('NoModificationAllowedError', 'The file is open elsewhere')
    this.access = new SyncAccessHandleDouble(this)
    return this.access
  }
}

export class DirectoryHandleDouble {
  readonly kind = 'directory'
  readonly children = new Map<string, DirectoryHandleDouble | FileHandleDouble>()
  readonly name: string
  readonly fs: OpfsDouble
  constructor(name: string, fs: OpfsDouble) {
    this.name = name
    this.fs = fs
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<DirectoryHandleDouble> {
    const child = this.children.get(name)
    if (child instanceof DirectoryHandleDouble) return child
    if (child) throw domError('TypeMismatchError', `${name} is a file`)
    if (!options.create) throw domError('NotFoundError', `${name} not found`)
    const dir = new DirectoryHandleDouble(name, this.fs)
    this.children.set(name, dir)
    return dir
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FileHandleDouble> {
    const child = this.children.get(name)
    if (child instanceof FileHandleDouble) return child
    if (child) throw domError('TypeMismatchError', `${name} is a directory`)
    if (!options.create) throw domError('NotFoundError', `${name} not found`)
    const file = new FileHandleDouble(name, this.fs)
    this.children.set(name, file)
    return file
  }
  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    if (this.fs.removeError) throw this.fs.removeError
    const child = this.children.get(name)
    if (!child) throw domError('NotFoundError', `${name} not found`)
    if (child instanceof DirectoryHandleDouble) {
      if (child.children.size > 0 && !options.recursive) {
        throw domError('InvalidModificationError', `${name} is not empty`)
      }
      for (const file of child.children.values()) {
        if (file instanceof FileHandleDouble && file.access) {
          throw domError('NoModificationAllowedError', `${file.name} is open`)
        }
      }
    } else if (child.access) {
      throw domError('NoModificationAllowedError', `${name} is open`)
    }
    this.children.delete(name)
  }
  async *entries(): AsyncIterableIterator<[string, DirectoryHandleDouble | FileHandleDouble]> {
    if (this.fs.listError) throw this.fs.listError
    for (const entry of [...this.children.entries()]) yield entry
  }
  /** The node at `path` below this directory (this one for an empty path), or undefined. */
  private walk(path: string[]): DirectoryHandleDouble | FileHandleDouble | undefined {
    if (path.length === 0) return this
    let node: DirectoryHandleDouble | FileHandleDouble | undefined = this.children.get(path[0])
    for (const name of path.slice(1)) {
      if (!(node instanceof DirectoryHandleDouble)) return undefined
      node = node.children.get(name)
    }
    return node
  }
  /** Test helper: a file by path, or undefined. */
  file(...path: string[]): FileHandleDouble | undefined {
    const node = this.walk(path)
    return node instanceof FileHandleDouble ? node : undefined
  }
  /** Test helper: a directory by path, or undefined. */
  dir(...path: string[]): DirectoryHandleDouble | undefined {
    const node = this.walk(path)
    return node instanceof DirectoryHandleDouble ? node : undefined
  }
}

export class OpfsDouble {
  readonly root: DirectoryHandleDouble
  syncHandlesRefused = false
  writeError: Error | null = null
  flushError: Error | null = null
  removeError: Error | null = null
  listError: Error | null = null
  getFileError: Error | null = null
  shortWrites = false
  constructor() {
    this.root = new DirectoryHandleDouble('', this)
  }
}

/** Web Locks: exclusive, by name, with `ifAvailable`. */
export class LocksDouble {
  readonly held = new Set<string>()
  private readonly waiting = new Map<string, Array<() => void>>()

  request<T>(
    name: string,
    optionsOrCallback: { ifAvailable?: boolean } | ((lock: unknown) => T | Promise<T>),
    maybeCallback?: (lock: unknown) => T | Promise<T>
  ): Promise<T> {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback)!
    if (this.held.has(name)) {
      if (options.ifAvailable) return Promise.resolve(callback(null))
      return new Promise<void>((resolve) => {
        const queue = this.waiting.get(name) ?? []
        queue.push(resolve)
        this.waiting.set(name, queue)
      }).then(() => this.run(name, callback))
    }
    return this.run(name, callback)
  }

  private async run<T>(name: string, callback: (lock: unknown) => T | Promise<T>): Promise<T> {
    this.held.add(name)
    try {
      return await callback({ name, mode: 'exclusive' })
    } finally {
      this.held.delete(name)
      const next = this.waiting.get(name)?.shift()
      next?.()
    }
  }
}

type Listener = (event: { data: unknown }) => void

/** What the worker double's scope looks like to the source it runs. */
interface WorkerScope {
  onmessage: Listener | null
  postMessage(data: unknown): void
}

export interface WorkerDoubleOptions {
  /** `new Worker()` throws this. */
  constructorError: Error | null
  /** The worker never runs: no answer to anything. */
  silent: boolean
  /** Fire `error` at the page instead of running the source. */
  startupError: string | null
}

export class WorkerDouble {
  static readonly instances: WorkerDouble[] = []
  static options: WorkerDoubleOptions = { constructorError: null, silent: false, startupError: null }

  onmessage: Listener | null = null
  onerror: ((event: { message: string; preventDefault?: () => void }) => void) | null = null
  terminated = false
  readonly url: string
  readonly sent: unknown[] = []
  private scope: WorkerScope | null = null
  private readonly booted: Promise<void>

  constructor(url: string) {
    if (WorkerDouble.options.constructorError) throw WorkerDouble.options.constructorError
    this.url = url
    WorkerDouble.instances.push(this)
    this.booted = this.boot()
  }

  private async boot(): Promise<void> {
    if (WorkerDouble.options.silent) return
    if (WorkerDouble.options.startupError) {
      const message = WorkerDouble.options.startupError
      setTimeout(() => this.onerror?.({ message, preventDefault: () => {} }), 0)
      return
    }
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob
    const source = await blob.text()
    const scope: WorkerScope = {
      onmessage: null,
      postMessage: (data: unknown) => {
        setTimeout(() => {
          if (!this.terminated) this.onmessage?.({ data })
        }, 0)
      },
    }
    new Function('self', 'navigator', source)(scope, globalThis.navigator)
    this.scope = scope
  }

  postMessage(data: unknown): void {
    this.sent.push(data)
    void this.booted.then(() => {
      if (!this.terminated) this.scope?.onmessage?.({ data })
    })
  }

  /** Fire an `error` at the page, as a worker that died would. */
  crash(message: string): void {
    this.onerror?.({ message })
  }

  terminate(): void {
    this.terminated = true
  }
}

export interface BrowserStorageDouble {
  opfs: OpfsDouble
  locks: LocksDouble
  restore(): void
}

/**
 * Give jsdom what a browser that keeps takes has: `navigator.storage
 * .getDirectory()`, `navigator.locks` and `Worker`. `restore()` takes all
 * three away again.
 */
export function installBrowserStorageDouble(): BrowserStorageDouble {
  const opfs = new OpfsDouble()
  const locks = new LocksDouble()
  const nav = globalThis.navigator as unknown as Record<string, unknown>
  const hadStorage = Object.getOwnPropertyDescriptor(nav, 'storage')
  const hadLocks = Object.getOwnPropertyDescriptor(nav, 'locks')
  Object.defineProperty(nav, 'storage', {
    configurable: true,
    value: { getDirectory: vi.fn(async () => opfs.root), estimate: vi.fn(async () => ({ quota: 0, usage: 0 })) },
  })
  Object.defineProperty(nav, 'locks', { configurable: true, value: locks })
  WorkerDouble.instances.length = 0
  WorkerDouble.options = { constructorError: null, silent: false, startupError: null }
  vi.stubGlobal('Worker', WorkerDouble)
  return {
    opfs,
    locks,
    restore() {
      if (hadStorage) Object.defineProperty(nav, 'storage', hadStorage)
      else delete nav.storage
      if (hadLocks) Object.defineProperty(nav, 'locks', hadLocks)
      else delete nav.locks
      vi.stubGlobal('Worker', undefined)
    },
  }
}

/** Let the worker double's message hops (setTimeout 0) and the page's awaits run. */
export async function settleWorker(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
