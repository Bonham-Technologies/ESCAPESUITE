// Count `new Map()` and `new Set()` while code under test runs (ESCSUITE-313).
//
// The per-frame paths — the export composer, the preview's frame — are meant to
// allocate no more collections per frame than they did before a change, and
// "no allocation" is otherwise invisible to a test: a Map built and dropped
// every frame changes no call a recording context sees. This swaps the two
// global constructors for subclasses that count, for as long as the caller
// holds the install, and puts the real ones back on `uninstall()`.
//
// Install it only around the code being measured: an object built by the real
// `Map` is not `instanceof` the counting one, so anything that type-checks a
// collection made before the install would see a stranger while it is in.
export interface CollectionConstructions {
  readonly maps: number
  readonly sets: number
  uninstall(): void
}

export function countCollectionConstructions(): CollectionConstructions {
  const RealMap = globalThis.Map
  const RealSet = globalThis.Set
  let maps = 0
  let sets = 0
  globalThis.Map = class CountingMap<K, V> extends RealMap<K, V> {
    constructor(entries?: Iterable<readonly [K, V]> | null) {
      super(entries)
      maps++
    }
  } as MapConstructor
  globalThis.Set = class CountingSet<T> extends RealSet<T> {
    constructor(values?: Iterable<T> | null) {
      super(values)
      sets++
    }
  } as SetConstructor
  return {
    get maps() {
      return maps
    },
    get sets() {
      return sets
    },
    uninstall() {
      globalThis.Map = RealMap
      globalThis.Set = RealSet
    },
  }
}
