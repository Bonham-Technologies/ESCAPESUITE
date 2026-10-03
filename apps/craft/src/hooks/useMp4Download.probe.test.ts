// ESCSUITE-176 item 4 (probe m1). Converting a recording whose bytes are gone
// — deleted from ARTIST's media library in another tab, most commonly —
// raises nothing: the row flashes "Starting conversion… 0%" and returns to
// idle. Play and Download already say `RECORDING_UNAVAILABLE` for exactly
// this fact (ESCSUITE-146); the conversion should say the same thing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { act, renderHook } from '@testing-library/react'
import { useMp4Download } from './useMp4Download'
import { RECORDING_UNAVAILABLE } from '../utils/notices'
import { clearAllRecordings } from '../test/recordingsDb'
import { resetAppDoubles } from '../test/appDoubles'
import type { Mp4Support } from '../store/types'

vi.mock('../core/converter', async () => (await import('../test/appDoubles')).converterModule)
vi.mock('@vercel/analytics', async () => (await import('../test/appDoubles')).analyticsModule)

const MP4_SUPPORTED: Mp4Support = { state: 'ready', supported: true, audio: true }

let setNotice: ReturnType<typeof vi.fn<(notice: string | null) => void>>
let refreshStorageSpace: ReturnType<typeof vi.fn<() => Promise<void>>>

beforeEach(async () => {
  resetAppDoubles()
  setNotice = vi.fn<(notice: string | null) => void>()
  refreshStorageSpace = vi.fn<() => Promise<void>>(async () => {})
  await clearAllRecordings()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mount() {
  return renderHook(() => useMp4Download({ setNotice, mp4Support: MP4_SUPPORTED, refreshStorageSpace }))
}

describe('PROBE: conversion of a recording whose bytes are gone', () => {
  it('says the recording could not be read, the way Play and Download do (MP4)', async () => {
    const { result } = mount()

    await act(async () => {
      await result.current.startMp4Download('ghost', 'Ghost Take', 'mp4')
    })

    expect(setNotice).toHaveBeenCalledWith(RECORDING_UNAVAILABLE)
  })

  it('says the recording could not be read, the way Play and Download do (M4A)', async () => {
    const { result } = mount()

    await act(async () => {
      await result.current.startMp4Download('ghost', 'Ghost Take', 'm4a')
    })

    expect(setNotice).toHaveBeenCalledWith(RECORDING_UNAVAILABLE)
  })
})
