import '@escapesuite/shared/test/setup'
import { vi } from 'vitest'

// Mock localStorage (jsdom provides one but it can be overwritten by other mocks)
const localStorageStore: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key] }),
  clear: vi.fn(() => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]) }),
  get length() { return Object.keys(localStorageStore).length },
  key: vi.fn((index: number) => Object.keys(localStorageStore)[index] ?? null),
})

// Mock IndexedDB for storage tests
const indexedDB = {
  open: vi.fn(),
  deleteDatabase: vi.fn(),
}
vi.stubGlobal('indexedDB', indexedDB)

// Mock URL.createObjectURL and revokeObjectURL
// Keep URL constructor functional but mock the static methods
const OriginalURL = globalThis.URL
vi.stubGlobal('URL', class extends OriginalURL {
  static createObjectURL = vi.fn(() => 'blob:mock-url')
  static revokeObjectURL = vi.fn()
})

// Mock AudioContext for audio tests
vi.stubGlobal('AudioContext', class AudioContext {
  createBufferSource = vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }))
  createGain = vi.fn(() => ({
    connect: vi.fn(),
    gain: { value: 1 },
  }))
  decodeAudioData = vi.fn()
  close = vi.fn()
  destination = {}
})

// Mock OfflineAudioContext
vi.stubGlobal('OfflineAudioContext', class OfflineAudioContext {
  decodeAudioData = vi.fn()
  startRendering = vi.fn()
})
