import '@escapesuite/shared/test/setup'
import { vi } from 'vitest'

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
