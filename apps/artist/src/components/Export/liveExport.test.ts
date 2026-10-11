// ESCSUITE-220: the module-level slot `main.tsx`'s ErrorBoundary.onError
// reaches through `disposeLiveExport()`. The dialog's side of the contract —
// that a run registers itself when it starts and clears itself when it
// settles or is cancelled — is pinned in ExportDialog.test.tsx; this file pins
// the slot alone.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerLiveExport, clearLiveExport, disposeLiveExport } from './liveExport'

describe('liveExport', () => {
  beforeEach(() => {
    // The slot is module state and outlives a test; empty it so each case
    // starts from "nothing registered".
    disposeLiveExport()
  })

  it('aborts the registered run', () => {
    const controller = new AbortController()
    registerLiveExport(controller)

    disposeLiveExport()

    expect(controller.signal.aborted).toBe(true)
  })

  it('aborts exactly once however many times it is called', () => {
    const controller = new AbortController()
    const abort = vi.spyOn(controller, 'abort')
    registerLiveExport(controller)

    disposeLiveExport()
    disposeLiveExport()

    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('is a no-op with nothing registered', () => {
    expect(() => disposeLiveExport()).not.toThrow()
  })

  it('is a no-op once the registered run has cleared itself', () => {
    const controller = new AbortController()
    const abort = vi.spyOn(controller, 'abort')
    registerLiveExport(controller)
    clearLiveExport(controller)

    disposeLiveExport()

    expect(abort).not.toHaveBeenCalled()
    expect(controller.signal.aborted).toBe(false)
  })

  it("does not let an older run's late clear drop a newer run's registration", () => {
    const older = new AbortController()
    const newer = new AbortController()
    registerLiveExport(older)
    registerLiveExport(newer)

    // The older run's `finally` lands after the newer one has registered.
    clearLiveExport(older)
    disposeLiveExport()

    expect(newer.signal.aborted).toBe(true)
    expect(older.signal.aborted).toBe(false)
  })

  it('holds only the most recently registered run', () => {
    const older = new AbortController()
    const newer = new AbortController()
    registerLiveExport(older)
    registerLiveExport(newer)

    disposeLiveExport()

    expect(newer.signal.aborted).toBe(true)
    expect(older.signal.aborted).toBe(false)
  })
})
