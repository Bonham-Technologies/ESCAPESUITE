// Keeping a stored Blob readable in a unit test.
//
// fake-indexeddb clones every inserted value with the platform's
// `structuredClone` (its `cloneValueForInsertion`), and Node's cannot serialise
// a jsdom Blob: it flattens it to `{}`, so a blob read back out of storage has
// no bytes, no size and no `text()`. A browser hands back a Blob you can read,
// which is the whole point of a test that stores several parts of a take and
// then asks which of them came back.
//
// `preserveBlobsInStorage()` puts that behaviour back for one suite — a clone
// that copies plain data and passes Blobs through by reference — and takes it
// away again afterwards, so no other suite's idea of `structuredClone` changes.
// It lives under `src/test/` because it is a fixture: neither shipped nor
// counted as app code.
import { beforeEach, afterEach } from 'vitest'

function cloneKeepingBlobs(value: unknown): unknown {
  // The one case this exists for: handed on by reference, which is closer to
  // what a browser does (a readable Blob) than dropping it on the floor.
  if (value instanceof Blob) return value
  if (Array.isArray(value)) return value.map(cloneKeepingBlobs)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneKeepingBlobs(entry)])
    )
  }
  return value
}

/** Make stored Blobs readable again for the suite that calls this. */
export function preserveBlobsInStorage(): void {
  const native = globalThis.structuredClone
  beforeEach(() => {
    globalThis.structuredClone = cloneKeepingBlobs as typeof structuredClone
  })
  afterEach(() => {
    globalThis.structuredClone = native
  })
}
