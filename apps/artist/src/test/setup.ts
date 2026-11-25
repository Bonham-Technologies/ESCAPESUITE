// Setup for the suites that run in jsdom (every suite not listed in
// nodeTestSuites.ts). The `node` project loads only ./setupGlobals.
//
// Install real fake-indexeddb BEFORE any other setup, so storage modules that
// open IndexedDB on import resolve against the working in-memory implementation
// rather than a non-functional stub. Must be a static import so it is hoisted
// before any vi.stubGlobal calls below.
import 'fake-indexeddb/auto'
// The DOM setup every app shares (jest-dom matchers, Testing Library cleanup,
// matchMedia, ResizeObserver). It needs `window`, so the node project skips it.
import '@escapesuite/shared/test/setup'
// ARTIST's own globals, installed after the shared setup so its localStorage
// stub replaces the shared one, as it always has. The Blob, URL, localStorage
// and AudioContext stubs that test comments credit to "setup.ts" live there.
import './setupGlobals'
