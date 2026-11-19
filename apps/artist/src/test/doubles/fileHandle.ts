import { vi } from 'vitest'

/**
 * A `FileSystemFileHandle` that keeps its file in memory (ESCSUITE-470): the
 * shape the save picker hands back, with the same commit rule as Chromium's.
 * Writes land in a swap copy that `close()` makes the file's and `abort()`
 * throws away, and a write `{ type: 'write', position }` lands at its offset.
 */
export interface FakeFileHandle {
  handle: FileSystemFileHandle
  /** The committed bytes, or null once the file is removed. */
  bytes: () => number[] | null
  /** The open writables, in the order they were created. */
  streams: FakeWritable[]
  remove: ReturnType<typeof vi.fn>
  requestPermission: ReturnType<typeof vi.fn>
}

export interface FakeWritable {
  write: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

export function fakeFileHandle(name: string, initial: number[] = []): FakeFileHandle {
  let committed: number[] | null = [...initial]
  const streams: FakeWritable[] = []
  const remove = vi.fn(async () => {
    committed = null
  })
  const requestPermission = vi.fn(async (): Promise<PermissionState> => 'granted')

  const createWritable = vi.fn(async () => {
    const swap: number[] = []
    const stream: FakeWritable = {
      write: vi.fn(async (data: unknown) => {
        if (data instanceof Blob) {
          swap.push(...new Uint8Array(await data.arrayBuffer()))
          return
        }
        const { position, data: bytes } = data as { position: number; data: Uint8Array }
        bytes.forEach((b, i) => (swap[position + i] = b))
      }),
      close: vi.fn(async () => {
        committed = [...swap]
      }),
      abort: vi.fn(async () => {}),
    }
    streams.push(stream)
    return stream
  })

  const handle = {
    kind: 'file',
    name,
    getFile: vi.fn(async () => new File(committed ? [new Uint8Array(committed)] : [], name)),
    createWritable,
    remove,
    requestPermission,
  } as unknown as FileSystemFileHandle

  return { handle, bytes: () => committed, streams, remove, requestPermission }
}

/** Install a stand-in `window.showSaveFilePicker`; the returned function removes it. */
export function installSavePicker(pick: () => Promise<FileSystemFileHandle>): () => void {
  const w = window as unknown as { showSaveFilePicker?: unknown }
  w.showSaveFilePicker = vi.fn(pick)
  return () => {
    delete w.showSaveFilePicker
  }
}

/** A `DOMException` with the given name, as a browser throws one. */
export const domError = (name: string, message = name) => new DOMException(message, name)
