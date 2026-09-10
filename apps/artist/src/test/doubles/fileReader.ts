// Double for FileReader.readAsDataURL().
//
// src/test/setup.ts swaps the global Blob for Node's, because jsdom's Blob does
// not survive a structured-clone round trip through fake-indexeddb. jsdom's own
// FileReader then refuses those blobs ("parameter 1 is not of type 'Blob'"), so
// any production code that base64-encodes a stored blob is untestable against
// bare jsdom. This double reads the blob through the standard async
// arrayBuffer() API and produces the same `data:<type>;base64,<payload>` string
// a browser does, firing loadend (or error) asynchronously as the real API
// does.
const MISSING = Symbol('missing')

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export interface FileReaderDouble {
  /** Make the next readAsDataURL() report a read error instead of succeeding. */
  failNextRead(): void
  uninstall(): void
}

export function installFileReaderDouble(): FileReaderDouble {
  const g = globalThis as unknown as Record<string, unknown>
  const previous = 'FileReader' in g ? g.FileReader : MISSING
  let failNext = false

  class FileReaderImpl {
    result: string | null = null
    error: Error | null = null
    onloadend: ((this: FileReaderImpl, ev: Event) => unknown) | null = null
    onerror: ((this: FileReaderImpl, ev: Event) => unknown) | null = null
    onload: ((this: FileReaderImpl, ev: Event) => unknown) | null = null

    readAsDataURL(blob: Blob): void {
      const shouldFail = failNext
      failNext = false
      void blob
        .arrayBuffer()
        .then((buffer) => {
          if (shouldFail) throw new Error('Could not read file')
          this.result = `data:${blob.type};base64,${toBase64(new Uint8Array(buffer))}`
          this.onload?.call(this, new Event('load'))
          this.onloadend?.call(this, new Event('loadend'))
        })
        .catch((error: Error) => {
          this.error = error
          this.onerror?.call(this, new Event('error'))
        })
    }
  }

  g.FileReader = FileReaderImpl

  return {
    failNextRead() {
      failNext = true
    },
    uninstall() {
      if (previous === MISSING) delete g.FileReader
      else g.FileReader = previous
    },
  }
}
