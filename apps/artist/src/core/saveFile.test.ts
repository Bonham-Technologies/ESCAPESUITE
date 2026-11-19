import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FileWriteError,
  canPickSaveFile,
  chooseSaveDestination,
  fileHandleOf,
  fileWriteError,
  mayWrite,
  openFileSink,
  rememberFileHandle,
  writeBlobToFile,
} from './saveFile'
import { domError, fakeFileHandle, installSavePicker } from '../test/doubles/fileHandle'

const WEBM = { description: 'WebM video', accept: { 'video/webm': ['.webm'] } }
const chunk = (data: number[], position: number) => ({ type: 'write' as const, data: new Uint8Array(data), position })

let uninstall: (() => void) | undefined
afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

describe('canPickSaveFile', () => {
  it('is false without the save picker, true with it', () => {
    expect(canPickSaveFile()).toBe(false)
    uninstall = installSavePicker(async () => fakeFileHandle('a.webm').handle)
    expect(canPickSaveFile()).toBe(true)
  })
})

describe('chooseSaveDestination', () => {
  it('downloads where there is no picker', async () => {
    await expect(chooseSaveDestination('a.webm', WEBM)).resolves.toEqual({ kind: 'download' })
  })

  it('answers the picked file, asking with the suggested name and type', async () => {
    const { handle } = fakeFileHandle('mine.webm')
    uninstall = installSavePicker(async () => handle)
    await expect(chooseSaveDestination('a.webm', WEBM)).resolves.toEqual({ kind: 'file', handle })
    const picker = (window as unknown as { showSaveFilePicker: ReturnType<typeof vi.fn> }).showSaveFilePicker
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'a.webm', types: [WEBM] })
  })

  it('answers cancelled when the user dismisses the picker', async () => {
    uninstall = installSavePicker(async () => Promise.reject(domError('AbortError')))
    await expect(chooseSaveDestination('a.webm', WEBM)).resolves.toEqual({ kind: 'cancelled' })
  })

  it('downloads when the page may not open the picker', async () => {
    uninstall = installSavePicker(async () => Promise.reject(domError('SecurityError')))
    await expect(chooseSaveDestination('a.webm', WEBM)).resolves.toEqual({ kind: 'download' })
  })

  it('throws any other failure', async () => {
    uninstall = installSavePicker(async () => Promise.reject(domError('NotAllowedError', 'File picker already active.')))
    await expect(chooseSaveDestination('a.webm', WEBM)).rejects.toThrow('File picker already active.')
  })
})

describe('mayWrite', () => {
  it('asks for read-write access and answers whether it was granted', async () => {
    const fake = fakeFileHandle('p.veditor')
    await expect(mayWrite(fake.handle)).resolves.toBe(true)
    expect(fake.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    fake.requestPermission.mockResolvedValueOnce('denied')
    await expect(mayWrite(fake.handle)).resolves.toBe(false)
  })

  it('treats a handle with no permission calls as writable', async () => {
    const { handle } = fakeFileHandle('p.veditor')
    delete (handle as unknown as { requestPermission?: unknown }).requestPermission
    await expect(mayWrite(handle)).resolves.toBe(true)
  })
})

describe('fileWriteError', () => {
  it.each([
    ['QuotaExceededError', 'the disk is full'],
    ['NotAllowedError', 'permission to write to it was taken away'],
    ['SecurityError', 'permission to write to it was taken away'],
    ['NotFoundError', 'it was moved or deleted'],
    ['NoModificationAllowedError', 'another program is using it'],
    ['InvalidStateError', 'another program is using it'],
  ])('words a %s for the user', (name, words) => {
    const error = fileWriteError(domError(name), 'out.webm')
    expect(error).toBeInstanceOf(FileWriteError)
    expect(error.message).toContain(`Could not write "out.webm": ${words}`)
  })

  it("passes anything else on in the browser's words", () => {
    expect(fileWriteError(new Error('Odd.'), 'x').message).toBe('Could not write "x": Odd.')
    expect(fileWriteError('odd', 'x').message).toBe('Could not write "x": odd')
    expect(fileWriteError(null, 'x').message).toBe('Could not write "x": null')
  })

  it('leaves an error already worded alone', () => {
    const worded = new FileWriteError('Already said.')
    expect(fileWriteError(worded, 'x')).toBe(worded)
  })
})

describe('writeBlobToFile', () => {
  it('writes the blob over the file and commits it', async () => {
    const fake = fakeFileHandle('p.veditor', [9, 9, 9, 9])
    await writeBlobToFile(fake.handle, new Blob([new Uint8Array([1, 2])]))
    expect(fake.bytes()).toEqual([1, 2])
  })

  it('leaves the file as it was when a write fails', async () => {
    const fake = fakeFileHandle('p.veditor', [9])
    const handle = fake.handle as unknown as { createWritable: () => Promise<unknown> }
    const createWritable = handle.createWritable
    handle.createWritable = async () => {
      const stream = (await createWritable()) as { write: ReturnType<typeof vi.fn> }
      stream.write.mockRejectedValueOnce(domError('QuotaExceededError'))
      return stream
    }
    await expect(writeBlobToFile(fake.handle, new Blob([new Uint8Array([1])]))).rejects.toThrow('the disk is full')
    expect(fake.streams[0].abort).toHaveBeenCalled()
    expect(fake.bytes()).toEqual([9])
  })

  it('names a file it cannot open for writing', async () => {
    const { handle } = fakeFileHandle('p.veditor')
    ;(handle as unknown as { createWritable: () => Promise<never> }).createWritable = () =>
      Promise.reject(domError('NotAllowedError'))
    await expect(writeBlobToFile(handle, new Blob([]))).rejects.toThrow(FileWriteError)
  })
})

describe('openFileSink', () => {
  it("lands the muxer's positioned writes in the file, write-backs included", async () => {
    const fake = fakeFileHandle('out.webm')
    const sink = await openFileSink(fake.handle, vi.fn())
    const writer = sink.writable.getWriter()
    await writer.write(chunk([1, 2, 3, 4], 0))
    await writer.write(chunk([5, 6], 4))
    await writer.write(chunk([9, 9], 1))
    await writer.close()
    const file = await sink.finish('video/webm')
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 9, 9, 4, 5, 6])
    expect(fake.bytes()).toEqual([1, 9, 9, 4, 5, 6])
    expect(sink.name).toBe('out.webm')
  })

  it('never builds the output as a Blob (the file is read back from disk)', async () => {
    const fake = fakeFileHandle('out.webm')
    const sink = await openFileSink(fake.handle, vi.fn())
    const NativeBlob = globalThis.Blob
    let built = 0
    globalThis.Blob = class extends NativeBlob {
      constructor(...args: ConstructorParameters<typeof Blob>) {
        super(...args)
        built += 1
      }
    }
    try {
      const writer = sink.writable.getWriter()
      for (let i = 0; i < 64; i++) await writer.write(chunk(new Array(1024).fill(i), i * 1024))
      await writer.close()
      await sink.finish('video/webm')
    } finally {
      globalThis.Blob = NativeBlob
    }
    expect(built).toBe(0)
    expect(fake.bytes()).toHaveLength(64 * 1024)
  })

  it('stops at the first failed write: reports it once, drops the rest, and finish throws it', async () => {
    const fake = fakeFileHandle('out.webm')
    const onFailure = vi.fn()
    const sink = await openFileSink(fake.handle, onFailure)
    fake.streams[0].write.mockRejectedValueOnce(domError('QuotaExceededError'))
    const writer = sink.writable.getWriter()
    await writer.write(chunk([1], 0))
    await writer.write(chunk([2], 1))
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(sink.failure?.message).toContain('the disk is full')
    expect(fake.streams[0].write).toHaveBeenCalledTimes(1)
    await expect(sink.finish('video/webm')).rejects.toBe(sink.failure)
  })

  it('fails when the commit itself is refused', async () => {
    const fake = fakeFileHandle('out.webm')
    const onFailure = vi.fn()
    const sink = await openFileSink(fake.handle, onFailure)
    fake.streams[0].close.mockRejectedValueOnce(domError('QuotaExceededError'))
    await expect(sink.finish('video/webm')).rejects.toThrow('the disk is full')
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('writes a finished file in one go', async () => {
    const fake = fakeFileHandle('out.gif')
    const sink = await openFileSink(fake.handle, vi.fn())
    const file = await sink.writeAll(new Blob([new Uint8Array([7, 8])]))
    expect(file.size).toBe(2)
    expect(fake.bytes()).toEqual([7, 8])
  })

  it('reports a one-go write the disk refuses', async () => {
    const fake = fakeFileHandle('out.gif')
    const sink = await openFileSink(fake.handle, vi.fn())
    fake.streams[0].write.mockRejectedValueOnce(domError('NotAllowedError'))
    await expect(sink.writeAll(new Blob([]))).rejects.toThrow('permission to write to it was taken away')
  })

  it('discards into nothing: the file the picker made for this export is removed', async () => {
    const fake = fakeFileHandle('out.webm')
    const sink = await openFileSink(fake.handle, vi.fn())
    await sink.writable.getWriter().write(chunk([1, 2], 0))
    await sink.discard()
    await sink.discard()
    expect(fake.streams[0].abort).toHaveBeenCalledTimes(1)
    expect(fake.remove).toHaveBeenCalledTimes(1)
    expect(fake.bytes()).toBeNull()
  })

  it('discards into what the file held before, when it held something', async () => {
    const fake = fakeFileHandle('out.webm', [4, 4])
    const sink = await openFileSink(fake.handle, vi.fn())
    await sink.writable.getWriter().write(chunk([1, 2, 3], 0))
    await sink.discard()
    expect(fake.remove).not.toHaveBeenCalled()
    expect(fake.bytes()).toEqual([4, 4])
  })

  it('leaves a file it could not read in place, and a committed file alone', async () => {
    const fake = fakeFileHandle('out.webm')
    ;(fake.handle as unknown as { getFile: ReturnType<typeof vi.fn> }).getFile.mockRejectedValueOnce(
      domError('NotReadableError')
    )
    const unread = await openFileSink(fake.handle, vi.fn())
    await unread.discard()
    expect(fake.remove).not.toHaveBeenCalled()

    const done = fakeFileHandle('b.webm')
    const committed = await openFileSink(done.handle, vi.fn())
    await committed.finish('video/webm')
    await committed.discard()
    expect(done.streams[0].abort).not.toHaveBeenCalled()
    expect(done.remove).not.toHaveBeenCalled()
  })

  it('discards where the browser has no remove()', async () => {
    const fake = fakeFileHandle('out.webm')
    delete (fake.handle as unknown as { remove?: unknown }).remove
    const sink = await openFileSink(fake.handle, vi.fn())
    await expect(sink.discard()).resolves.toBeUndefined()
    expect(fake.streams[0].abort).toHaveBeenCalled()
  })

  it('names a file it cannot open for writing', async () => {
    const { handle } = fakeFileHandle('out.webm')
    ;(handle as unknown as { createWritable: () => Promise<never> }).createWritable = () =>
      Promise.reject(domError('NotAllowedError'))
    await expect(openFileSink(handle, vi.fn())).rejects.toThrow(
      'Could not write "out.webm": permission to write to it was taken away'
    )
  })
})

describe('fileHandleOf', () => {
  it('answers the handle a file was opened through, and nothing for any other file', () => {
    const { handle } = fakeFileHandle('p.veditor')
    const opened = new File([], 'p.veditor')
    rememberFileHandle(opened, handle)
    expect(fileHandleOf(opened)).toBe(handle)
    expect(fileHandleOf(new File([], 'p.veditor'))).toBeUndefined()
  })
})
