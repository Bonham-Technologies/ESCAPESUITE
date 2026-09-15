// What the recorder screen does on the way in.
//
// Capability detection is a browser boundary and is doubled; the store is
// real, so the two capability slices are asserted as they land in it. The
// third call — loading what is already in storage — is counted rather than
// re-tested, because the store's own suite covers it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
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
  useRecorderStore.setState({ capabilitiesReady: false })
})

function mountBootstrap() {
  const { setCapabilities, setDetailedCapabilities, setCapabilitiesReady } = useRecorderStore.getState()
  return renderHook(() =>
    useCapabilityBootstrap({
      setCapabilities,
      setDetailedCapabilities,
      setCapabilitiesReady,
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

  it('holds the capabilities "not ready" until the detection answers', async () => {
    let answer: (result: ReturnType<typeof detectionResult>) => void = () => {}
    permissionsOverrides.detectCapabilities.mockImplementation(
      () => new Promise((resolve) => { answer = resolve })
    )

    mountBootstrap()

    expect(useRecorderStore.getState().capabilitiesReady).toBe(false)

    await act(async () => { answer(detectionResult()) })

    expect(useRecorderStore.getState().capabilitiesReady).toBe(true)
  })

  it('marks them ready even when detection fails, so the app is never stuck', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    permissionsOverrides.detectCapabilities.mockRejectedValue(new Error('policy blocked'))

    mountBootstrap()

    await waitFor(() => {
      expect(useRecorderStore.getState().capabilitiesReady).toBe(true)
    })
    expect(consoleError).toHaveBeenCalledWith('Capability detection failed:', expect.any(Error))
    consoleError.mockRestore()
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
