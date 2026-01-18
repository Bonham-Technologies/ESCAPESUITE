import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock IndexedDB for storage tests
const indexedDB = {
  open: vi.fn(),
  deleteDatabase: vi.fn(),
}
vi.stubGlobal('indexedDB', indexedDB)

// Mock URL.createObjectURL and revokeObjectURL
const OriginalURL = globalThis.URL
vi.stubGlobal('URL', class extends OriginalURL {
  static createObjectURL = vi.fn(() => 'blob:mock-url')
  static revokeObjectURL = vi.fn()
})

// Mock matchMedia for component tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock ResizeObserver
vi.stubGlobal('ResizeObserver', class ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
})

// Helper to create a mock MediaStreamTrack with all required methods
function createMockAudioTrack() {
  return {
    id: 'mock-destination-audio-track',
    kind: 'audio' as const,
    label: 'Mock destination audio track',
    enabled: true,
    muted: false,
    readyState: 'live' as const,
    stop: vi.fn(),
    clone: vi.fn(),
    getCapabilities: vi.fn(() => ({})),
    getConstraints: vi.fn(() => ({})),
    getSettings: vi.fn(() => ({})),
    applyConstraints: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onended: null,
    onmute: null,
    onunmute: null,
  }
}

// Mock AudioContext for audio tests
vi.stubGlobal('AudioContext', class AudioContext {
  state = 'running'
  resume = vi.fn().mockResolvedValue(undefined)
  createBufferSource = vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }))
  createGain = vi.fn(() => ({
    connect: vi.fn(),
    gain: { value: 1 },
  }))
  createAnalyser = vi.fn(() => ({
    connect: vi.fn(),
    fftSize: 256,
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn(),
  }))
  createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
  }))
  createMediaStreamDestination = vi.fn(() => ({
    stream: {
      getAudioTracks: vi.fn(() => [createMockAudioTrack()]),
    },
  }))
  decodeAudioData = vi.fn()
  close = vi.fn()
  destination = {}
})

// Mock MediaRecorder
vi.stubGlobal('MediaRecorder', class MediaRecorder {
  state = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(public stream: MediaStream, public options?: MediaRecorderOptions) {}

  start = vi.fn(() => { this.state = 'recording' })
  stop = vi.fn(() => {
    this.state = 'inactive'
    this.onstop?.()
  })
  pause = vi.fn(() => { this.state = 'paused' })
  resume = vi.fn(() => { this.state = 'recording' })

  static isTypeSupported = vi.fn(() => true)
})

// Mock MediaStream
vi.stubGlobal('MediaStream', class MediaStream {
  id = 'mock-stream-id'
  active = true

  constructor(public tracks: MediaStreamTrack[] = []) {}

  getVideoTracks = vi.fn(() => this.tracks.filter(t => t.kind === 'video'))
  getAudioTracks = vi.fn(() => this.tracks.filter(t => t.kind === 'audio'))
  getTracks = vi.fn(() => this.tracks)
  addTrack = vi.fn((track: MediaStreamTrack) => this.tracks.push(track))
  removeTrack = vi.fn()
})

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue(new MediaStream()),
    getDisplayMedia: vi.fn().mockResolvedValue(new MediaStream()),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  },
})
