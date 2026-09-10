// A File built on Node's Blob, for tests that store a file and read it back.
//
// src/test/setup.ts replaces the global Blob with Node's because jsdom's does
// not survive the structured clone fake-indexeddb performs. jsdom's File has
// the same problem — a stored jsdom File comes back out of IndexedDB as a bare
// object with no size, type or text() — so any test that round-trips a File
// through storage has to build it on Node's implementation instead.
import { File as NodeFile } from 'node:buffer'

export function mediaFile(parts: BlobPart[], name: string, type: string): File {
  return new NodeFile(parts as ConstructorParameters<typeof NodeFile>[0], name, {
    type,
  }) as unknown as File
}
