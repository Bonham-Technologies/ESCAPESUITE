// Recording double for `core/takeStore`'s `createTakeStore` (ESCSUITE-466).
//
// The real store starts a worker and writes to the origin private file
// system, neither of which jsdom has — there it is simply unavailable, and the
// controller says so in a notice. This double stands in for a browser that
// *can* keep a take (or, with `available = false`, one that cannot), records
// every write and every settle, and lets a test fail the disk mid-take.
//
// Usage:
//   vi.mock('../core/takeStore', async (importOriginal) => ({
//     ...(await importOriginal<typeof import('../core/takeStore')>()),
//     createTakeStore: (await import('../test/appDoubles')).takeStoreFactory.createTakeStore,
//   }))
import { vi } from 'vitest'
// Types only: `core/takeStore` is the module this double is mocked into, so a
// runtime import from it here would be circular. A test that fails the disk
// builds its own `TakeStorageError` from the (partly mocked) module.
import type {
  TakeFiles,
  TakeJournal,
  TakePart,
  TakeStorageError,
  TakeStore,
} from '../../core/takeStore'

export interface TakeStoreDouble extends TakeStore {
  readonly journal: TakeJournal
  readonly writes: Array<{ part: TakePart; data: Uint8Array | Blob; position?: number }>
  readonly finish: ReturnType<typeof vi.fn<() => Promise<TakeFiles | null>>>
  readonly release: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly discard: ReturnType<typeof vi.fn<() => Promise<void>>>
  /** What `finish()` hands back. */
  files: TakeFiles | null
  /** Report a failed write, as the worker does when the disk is full. */
  failWith(error: TakeStorageError): void
}

function createTakeStoreDouble(journal: TakeJournal, available: boolean): TakeStoreDouble {
  const listeners: Array<(error: TakeStorageError) => void> = []
  const double: TakeStoreDouble = {
    journal,
    takeId: journal.takeId,
    ready: Promise.resolve(available),
    writes: [],
    files: {},
    write(part, data, position) {
      double.writes.push({ part, data, position })
    },
    writable(part) {
      return new WritableStream({
        write: (chunk) => double.write(part, chunk.data, chunk.position),
      })
    },
    onFailure(listener) {
      listeners.push(listener)
    },
    failWith(error) {
      for (const listener of listeners) listener(error)
    },
    finish: vi.fn(async () => (available ? double.files : null)),
    release: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
  }
  return double
}

export interface TakeStoreFactoryDouble {
  /** Whether the next store's `ready` resolves true. */
  available: boolean
  readonly stores: TakeStoreDouble[]
  readonly createTakeStore: ReturnType<typeof vi.fn<(journal: TakeJournal) => TakeStore>>
  last(): TakeStoreDouble
  reset(): void
}

export function createTakeStoreFactoryDouble(): TakeStoreFactoryDouble {
  const stores: TakeStoreDouble[] = []
  const factory: TakeStoreFactoryDouble = {
    available: true,
    stores,
    createTakeStore: vi.fn((journal: TakeJournal) => {
      const store = createTakeStoreDouble(journal, factory.available)
      stores.push(store)
      return store
    }),
    last() {
      const store = stores[stores.length - 1]
      if (!store) throw new Error('createTakeStore() has not been called yet')
      return store
    },
    reset() {
      stores.length = 0
      factory.available = true
      factory.createTakeStore.mockClear()
    },
  }
  return factory
}
