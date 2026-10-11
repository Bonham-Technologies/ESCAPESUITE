// ESCSUITE-212 R9: this file used to render through the real bootstrapApp
// and assert the shared ErrorBoundary's fallback panel appears — which is
// exactly packages/shared/src/bootstrap/index.test.tsx and
// ErrorBoundary.test.tsx already prove, and passed identically whether or
// not main.tsx wired onError at all. What is specific to ARTIST is the
// wiring itself: that bootstrapApp is called with the real App and an
// onError that, since ESCSUITE-220, stops whatever export is in flight
// through disposeLiveExport. The slot itself, and the dialog registering
// its runs in it, are pinned in components/Export/liveExport.test.ts and
// ExportDialog.test.tsx (including the ordering pin under the real
// ErrorBoundary).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ErrorInfo } from 'react'

const bootstrapApp = vi.fn()
vi.mock('@escapesuite/shared/bootstrap', () => ({ bootstrapApp }))

const disposeLiveExport = vi.fn()
vi.mock('./components/Export/liveExport', () => ({ disposeLiveExport }))

function Stub() {
  return null
}
vi.mock('./App', () => ({ default: Stub }))

beforeEach(() => {
  vi.resetModules()
  bootstrapApp.mockClear()
  disposeLiveExport.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('main', () => {
  it('calls bootstrapApp once with App and a function onError', async () => {
    await import('./main')

    expect(bootstrapApp).toHaveBeenCalledTimes(1)
    const config = bootstrapApp.mock.calls[0][0] as { App: unknown; onError: unknown }
    expect(config.App).toBe(Stub)
    expect(typeof config.onError).toBe('function')
  })

  it('does not stop an export just by booting', async () => {
    await import('./main')

    expect(disposeLiveExport).not.toHaveBeenCalled()
  })

  it('onError stops the export in flight, once, without throwing or logging', async () => {
    await import('./main')

    const config = bootstrapApp.mock.calls[0][0] as {
      onError: (error: Error, info: ErrorInfo) => void
    }

    expect(() => config.onError(new Error('boom'), { componentStack: '' })).not.toThrow()
    expect(disposeLiveExport).toHaveBeenCalledTimes(1)
    expect(console.error).not.toHaveBeenCalled()
  })
})
