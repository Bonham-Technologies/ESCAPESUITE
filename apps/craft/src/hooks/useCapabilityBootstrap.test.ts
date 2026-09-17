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
import {
  permissionsOverrides,
  detectionResult,
  converterModule,
  resetAppDoubles,
} from '../test/appDoubles'

vi.mock('../core/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/permissions')>()
  const { permissionsOverrides: overrides } = await import('../test/appDoubles')
  return { ...actual, ...overrides }
})
// The MP4 codec probe is the other browser boundary the bootstrap crosses: it
// asks WebCodecs whether it can encode H.264 and AAC, which jsdom cannot
// answer.
vi.mock('../core/converter', async () => (await import('../test/appDoubles')).converterModule)

let loadRecordings: ReturnType<typeof vi.fn>
let refreshStorageSpace: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetAppDoubles()
  loadRecordings = vi.fn(async () => {})
  refreshStorageSpace = vi.fn(async () => {})
  useRecorderStore.setState({
    capabilitiesReady: false,
    notice: null,
    mp4Support: { state: 'checking', supported: false },
  })
})

function mountBootstrap() {
  const {
    setCapabilities,
    setDetailedCapabilities,
    setCapabilitiesReady,
    setMp4Support,
    setNotice,
  } = useRecorderStore.getState()
  return renderHook(() =>
    useCapabilityBootstrap({
      setCapabilities,
      setDetailedCapabilities,
      setCapabilitiesReady,
      setMp4Support,
      setNotice,
      loadRecordings: loadRecordings as unknown as () => Promise<void>,
      refreshStorageSpace: refreshStorageSpace as unknown as () => Promise<void>,
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

  it('asks the MP4 codec probe once, and writes its answer into the store', async () => {
    mountBootstrap()

    await waitFor(() => {
      expect(useRecorderStore.getState().mp4Support).toEqual({
        state: 'ready',
        supported: true,
      })
    })
    expect(converterModule.probeMP4Support).toHaveBeenCalledTimes(1)
  })

  it('holds the MP4 answer at "checking" until the probe answers', async () => {
    // The button is disabled while this holds, so it never flashes from
    // enabled to disabled when the answer turns out to be no.
    let answer: (support: { supported: boolean; reason?: string }) => void = () => {}
    converterModule.probeMP4Support.mockReturnValue(
      new Promise<{ supported: boolean; reason?: string }>(resolve => {
        answer = resolve
      })
    )

    mountBootstrap()

    await waitFor(() => {
      expect(useRecorderStore.getState().capabilitiesReady).toBe(true)
    })
    expect(useRecorderStore.getState().mp4Support).toEqual({
      state: 'checking',
      supported: false,
    })

    await act(async () => {
      answer({ supported: false, reason: 'This browser cannot encode H.264 video.' })
    })

    expect(useRecorderStore.getState().mp4Support).toEqual({
      state: 'ready',
      supported: false,
      reason: 'This browser cannot encode H.264 video.',
    })
  })

  it('loads the stored recordings exactly once, alongside the detection', async () => {
    mountBootstrap()

    expect(loadRecordings).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(permissionsOverrides.detectCapabilities).toHaveBeenCalledTimes(1)
    })
  })

  it('measures the storage headroom on the way in, so the button knows before the click', async () => {
    mountBootstrap()

    expect(refreshStorageSpace).toHaveBeenCalledTimes(1)
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
    expect(useRecorderStore.getState().notice).toBe(
      'This browser would not say what it can capture — some sources may be unavailable.'
    )
    consoleError.mockRestore()
  })

  it('surfaces a library that could not be read, rather than showing an empty one', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Typed by hand rather than through @types/node, which craft does not pull in.
    const { process: proc } = globalThis as unknown as {
      process: {
        on: (event: string, handler: () => void) => void
        off: (event: string, handler: () => void) => void
      }
    }
    const rejection = vi.fn()
    proc.on('unhandledRejection', rejection)
    loadRecordings.mockRejectedValue(new Error('storage blocked'))

    mountBootstrap()

    await waitFor(() => {
      expect(useRecorderStore.getState().notice).toBe(
        'Your saved recordings could not be loaded — storage may be blocked in this browser.'
      )
    })
    expect(consoleError).toHaveBeenCalledWith('Failed to load recordings:', expect.any(Error))
    expect(rejection).not.toHaveBeenCalled()
    proc.off('unhandledRejection', rejection)
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
