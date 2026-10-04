// ESCSUITE-212: main.tsx wires the shared ErrorBoundary's onError to
// disposeLiveRecordingSession. App itself is mocked to a component that
// always throws — a real recorder's disposal is covered thoroughly in
// useRecordingController.test.ts; what belongs here is proof that a
// throwing child under bootstrapApp's real tree reaches that dispose through
// the real shared ErrorBoundary, not a mock of the boundary itself.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'

const disposeLiveRecordingSession = vi.fn()
vi.mock('./hooks/useRecordingController', () => ({ disposeLiveRecordingSession }))

function Boom(): never {
  throw new Error('kaboom')
}
vi.mock('./App.tsx', () => ({ default: Boom }))

beforeEach(() => {
  vi.resetModules()
  disposeLiveRecordingSession.mockClear()
  document.body.innerHTML = '<div id="root"></div>'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('main', () => {
  it('shows the shared error panel and disposes the live recording session when the app throws', async () => {
    await act(async () => {
      await import('./main')
    })

    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    expect(disposeLiveRecordingSession).toHaveBeenCalledTimes(1)
  })
})
