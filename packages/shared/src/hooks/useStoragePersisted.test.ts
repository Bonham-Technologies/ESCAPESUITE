// ESCSUITE-468: the hook both apps draw their persistence line from.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

let hook: typeof import('./useStoragePersisted')
let persistence: typeof import('../storage/persistence')

beforeEach(async () => {
  vi.resetModules()
  hook = await import('./useStoragePersisted')
  persistence = await import('../storage/persistence')
})

afterEach(() => {
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
})

describe('useStoragePersisted', () => {
  it('reads the state on mount without asking, then follows a save', async () => {
    let persisted = false
    const storage = {
      persist: vi.fn(async () => (persisted = true)),
      persisted: vi.fn(async () => persisted),
    }
    Object.defineProperty(navigator, 'storage', { value: storage, configurable: true })

    const { result } = renderHook(() => hook.useStoragePersisted())

    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe(false))
    expect(storage.persist).not.toHaveBeenCalled()

    await act(() => persistence.requestStoragePersistence())
    expect(result.current).toBe(true)
  })

  it('reads false with no Storage API', async () => {
    const { result } = renderHook(() => hook.useStoragePersisted())

    await waitFor(() => expect(result.current).toBe(false))
  })
})
