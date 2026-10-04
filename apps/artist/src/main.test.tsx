// ESCSUITE-212: ARTIST wires bootstrapApp's onError to a documented no-op —
// unlike ESCAPECRAFT there is no live recorder or open stream to release
// here. What this proves is that a throwing child under bootstrapApp's real
// tree still reaches the shared ErrorBoundary's fallback panel, and that the
// no-op onError does not itself throw or otherwise break the catch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'

function Boom(): never {
  throw new Error('kaboom')
}
vi.mock('./App', () => ({ default: Boom }))

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = '<div id="root"></div>'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('main', () => {
  it('shows the shared error panel when the app throws', async () => {
    await act(async () => {
      await import('./main')
    })

    const panel = document.querySelector('[role="alert"]')
    expect(panel).not.toBeNull()
    expect(document.querySelector('button')?.textContent).toBe('Reload')
  })
})
