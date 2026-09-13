// What the recorder screen does on the way in.
//
// Capability detection is a browser boundary and is doubled; the store is
// real, so the two capability slices are asserted as they land in it. The
// third call — loading what is already in storage — is counted rather than
// re-tested, because the store's own suite covers it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCapabilityBootstrap } from './useCapabilityBootstrap'
import { useRecorderStore } from '../store/recorderStore'
import { permissionsOverrides, detectionResult, resetAppDoubles } from '../test/appDoubles'

vi.mock('../core/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/permissions')>()
  const { permissionsOverrides: overrides } = await import('../test/appDoubles')
  return { ...actual, ...overrides }
})

let loadRecordings: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetAppDoubles()
  loadRecordings = vi.fn(async () => {})
})

function mountBootstrap() {
  const { setCapabilities, setDetailedCapabilities } = useRecorderStore.getState()
  return renderHook(() =>
    useCapabilityBootstrap({
      setCapabilities,
      setDetailedCapabilities,
      loadRecordings: loadRecordings as unknown as () => Promise<void>,
    })
  )
}

describe('useCapabilityBootstrap', () => {
  it('writes both capability slices from one detection', async () => {
    const detected = detectionResult(
      { webcam: false },
      { webcam: { available: false, reason: 'no_device', message: 'No camera found' } }
    )
    permissionsOverrides.detectCapabilities.mockResolvedValue(detected)

    mountBootstrap()

    await waitFor(() => {
      expect(useRecorderStore.getState().capabilities).toEqual(detected.capabilities)
    })
    expect(useRecorderStore.getState().detailedCapabilities).toEqual(detected.detailed)
    expect(permissionsOverrides.detectCapabilities).toHaveBeenCalledTimes(1)
  })

  it('loads the stored recordings exactly once, alongside the detection', async () => {
    mountBootstrap()

    expect(loadRecordings).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(permissionsOverrides.detectCapabilities).toHaveBeenCalledTimes(1)
    })
  })

  it('does not run again on a re-render: the store actions keep their identity', async () => {
    const { rerender } = mountBootstrap()

    rerender()
    rerender()

    await waitFor(() => {
      expect(permissionsOverrides.detectCapabilities).toHaveBeenCalledTimes(1)
    })
    expect(loadRecordings).toHaveBeenCalledTimes(1)
  })
})
