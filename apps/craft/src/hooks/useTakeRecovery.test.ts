// The recovery prompt's sequencing (ESCSUITE-466). The bytes side —
// finding, repairing and deleting kept takes — is `core/takeRecovery`'s and
// has its own suite; here it is a boundary, so each test can say what is on
// the device and what the repair makes of it.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useTakeRecovery, type TakeRecoveryDeps } from './useTakeRecovery'
import type { RecoveredTake, UnfinishedTake } from '../core/takeRecovery'
import type { RecordingState } from '../store/types'
import { NOT_SEEKABLE, NOTHING_TO_RECOVER, RECOVERY_FAILED } from '../utils/notices'

const recovery = vi.hoisted(() => ({
  findUnfinishedTakes: vi.fn(),
  repairUnfinishedTake: vi.fn(),
  discardUnfinishedTake: vi.fn(async () => {}),
  withTakeClaimed: vi.fn(async (_take: unknown, work: () => Promise<void>) => {
    await work()
    return true
  }),
}))
const kept = vi.hoisted(() => ({ listeners: new Set<() => void>() }))

vi.mock('../core/takeRecovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/takeRecovery')>()),
  ...recovery,
}))
vi.mock('../core/takeStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/takeStore')>()),
  onTakeKept: (listener: () => void) => {
    kept.listeners.add(listener)
    return () => kept.listeners.delete(listener)
  },
}))

const { NothingToRecoverError } = await import('../core/takeRecovery')

function take(takeId: string, startedAt: number): UnfinishedTake {
  return {
    journal: {
      version: 1,
      takeId,
      startedAt,
      recorder: 'mediarecorder',
      captured: {
        micAcquired: true,
        separateTracks: false,
        systemAudioEnabled: false,
        webcamEnabled: false,
        overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
        hasVideoSource: true,
      },
      systemAudioShared: false,
    },
    files: { primary: new File([new Uint8Array(4)], 'primary.webm') },
    size: 4,
  }
}

function recovered(t: UnfinishedTake, extra: Partial<RecoveredTake> = {}): RecoveredTake {
  return { journal: t.journal, blob: new Blob(['take']), duration: 7, companions: [], seekable: true, ...extra }
}

const A = take('a', 1)
const B = take('b', 2)

let deps: {
  saveRecording: Mock<TakeRecoveryDeps['saveRecording']>
  setState: Mock<TakeRecoveryDeps['setState']>
  setNotice: Mock<TakeRecoveryDeps['setNotice']>
  refreshStorageSpace: Mock<TakeRecoveryDeps['refreshStorageSpace']>
}

function mount(state: RecordingState = 'idle') {
  deps = {
    saveRecording: vi.fn<TakeRecoveryDeps['saveRecording']>(async () => {}),
    setState: vi.fn<TakeRecoveryDeps['setState']>(),
    setNotice: vi.fn<TakeRecoveryDeps['setNotice']>(),
    refreshStorageSpace: vi.fn<TakeRecoveryDeps['refreshStorageSpace']>(async () => {}),
  }
  return renderHook((props: { state: RecordingState }) => useTakeRecovery({ ...deps, state: props.state }), {
    initialProps: { state },
  })
}

beforeEach(() => {
  recovery.findUnfinishedTakes.mockReset().mockResolvedValue([A, B])
  recovery.repairUnfinishedTake.mockReset()
  recovery.discardUnfinishedTake.mockClear()
  recovery.withTakeClaimed.mockClear()
  kept.listeners.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTakeRecovery', () => {
  it('offers the oldest unfinished take once the device has been looked at, and only while idle', async () => {
    const { result, rerender } = mount()
    expect(result.current.pendingTake).toBeNull()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    rerender({ state: 'recording' })
    expect(result.current.pendingTake).toBeNull()
    rerender({ state: 'idle' })
    expect(result.current.pendingTake).toBe(A)
  })

  it('looks again whenever a take of this tab is left on the device, until it unmounts', async () => {
    recovery.findUnfinishedTakes.mockResolvedValueOnce([])
    const { result, unmount } = mount()
    await waitFor(() => expect(recovery.findUnfinishedTakes).toHaveBeenCalledTimes(1))
    expect(result.current.pendingTake).toBeNull()
    act(() => { for (const listener of kept.listeners) listener() })
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    unmount()
    expect(kept.listeners.size).toBe(0)
  })

  it('drops an answer that arrives after it unmounted', async () => {
    let answer!: (takes: UnfinishedTake[]) => void
    recovery.findUnfinishedTakes.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const consoleError = vi.spyOn(console, 'error')
    const { result, unmount } = mount()
    unmount()
    await act(async () => { answer([A]) })
    expect(result.current.pendingTake).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('recovers: repairs, saves as the take was, deletes the copy, and moves on to the next', async () => {
    const companions = [{ role: 'mic' as const, blob: new Blob(['m']), startOffset: 0, duration: 7 }]
    recovery.repairUnfinishedTake.mockResolvedValue(recovered(A, { companions }))
    const { result } = mount()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))

    await act(async () => { await result.current.recover() })

    expect(deps.setState.mock.calls).toEqual([['saving'], ['idle']])
    expect(deps.saveRecording).toHaveBeenCalledWith(
      expect.any(Blob), 7, companions, A.journal.captured,
      { createdAt: 1, systemAudioShared: false }
    )
    expect(recovery.discardUnfinishedTake).toHaveBeenCalledWith(A)
    expect(deps.setNotice).not.toHaveBeenCalled()
    expect(deps.refreshStorageSpace).toHaveBeenCalled()
    expect(result.current.pendingTake).toBe(B)
  })

  it('saves a take with no companions as one with none, and says when it may not seek', async () => {
    recovery.repairUnfinishedTake.mockResolvedValue(recovered(A, { seekable: false }))
    const { result } = mount()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    await act(async () => { await result.current.recover() })
    expect(deps.saveRecording.mock.calls[0][2]).toBeNull()
    expect(deps.setNotice).toHaveBeenCalledWith(NOT_SEEKABLE)
  })

  it('deletes a take that held nothing playable, and says so', async () => {
    recovery.repairUnfinishedTake.mockRejectedValue(new NothingToRecoverError())
    const { result } = mount()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    await act(async () => { await result.current.recover() })
    expect(deps.saveRecording).not.toHaveBeenCalled()
    expect(recovery.discardUnfinishedTake).toHaveBeenCalledWith(A)
    expect(deps.setNotice).toHaveBeenCalledWith(NOTHING_TO_RECOVER)
    expect(result.current.pendingTake).toBe(B)
  })

  it('keeps a take whose recovery failed, says so, and sets it aside for this visit', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    recovery.repairUnfinishedTake.mockResolvedValue(recovered(A))
    const { result } = mount()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    deps.saveRecording.mockRejectedValue(new Error('quota'))
    await act(async () => { await result.current.recover() })
    expect(consoleError).toHaveBeenCalledWith('The unfinished recording could not be recovered:', expect.any(Error))
    expect(deps.setNotice).toHaveBeenCalledWith(RECOVERY_FAILED)
    expect(recovery.discardUnfinishedTake).not.toHaveBeenCalled()
    expect(deps.setState).toHaveBeenLastCalledWith('idle')
    expect(result.current.pendingTake).toBe(B)
  })

  it('forgets a take another tab claimed first, without touching it', async () => {
    recovery.withTakeClaimed.mockResolvedValueOnce(false)
    const { result } = mount()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    await act(async () => { await result.current.recover() })
    expect(recovery.repairUnfinishedTake).not.toHaveBeenCalled()
    expect(result.current.pendingTake).toBe(B)
  })

  it('runs one recovery at a time, and nothing when there is nothing to offer', async () => {
    let finish!: (value: RecoveredTake) => void
    recovery.repairUnfinishedTake.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { result } = mount()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    let first!: Promise<void>
    act(() => { first = result.current.recover() })
    await act(async () => {
      await result.current.recover()
      await result.current.discard()
    })
    expect(recovery.withTakeClaimed).toHaveBeenCalledTimes(1)
    await act(async () => { finish(recovered(A)); await first })

    recovery.findUnfinishedTakes.mockResolvedValue([])
    const empty = mount()
    await waitFor(() => expect(recovery.findUnfinishedTakes).toHaveBeenCalledTimes(2))
    await act(async () => {
      await empty.result.current.recover()
      await empty.result.current.discard()
      empty.result.current.dismiss()
    })
    expect(recovery.withTakeClaimed).toHaveBeenCalledTimes(1)
  })

  it('discards: deletes the copy under the take lock, and moves on', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    await act(async () => { await result.current.discard() })
    expect(recovery.withTakeClaimed).toHaveBeenCalledWith(A, expect.any(Function))
    expect(recovery.discardUnfinishedTake).toHaveBeenCalledWith(A)
    expect(deps.refreshStorageSpace).toHaveBeenCalled()
    expect(deps.setState).not.toHaveBeenCalled()
    expect(result.current.pendingTake).toBe(B)
  })

  it('Not now sets the take aside for this visit only', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.pendingTake).toBe(A))
    act(() => result.current.dismiss())
    expect(result.current.pendingTake).toBe(B)
    act(() => result.current.dismiss())
    expect(result.current.pendingTake).toBeNull()
    expect(recovery.discardUnfinishedTake).not.toHaveBeenCalled()
    // The next visit asks again.
    const again = mount()
    await waitFor(() => expect(again.result.current.pendingTake).toBe(A))
  })
})
