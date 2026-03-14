import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Provide a full localStorage mock (Node 22+ exposes a built-in localStorage
// that lacks clear/getItem/setItem when --localstorage-file is not set, which
// breaks tests that call localStorage.clear()).
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  const storage = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = String(value) }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
  return storage
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

// Cleanup after each test
afterEach(() => {
  cleanup()
  localStorageMock.clear()
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
