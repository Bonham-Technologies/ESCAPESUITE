import { describe, it, expect } from 'vitest'
import { buildSourceVideo, buildRecordingEntry } from './recordingMetadata'
import type { RecordingConfig } from '../store/types'

describe('buildSourceVideo', () => {
  it('builds the SourceVideo literal from the blob and caller-supplied duration', () => {
    const blob = new Blob(['data'], { type: 'video/webm' })
    const now = 1_700_000_000_000

    const sourceVideo = buildSourceVideo({
      id: 'rec-1',
      now,
      blob,
      duration: 42,
      width: 1280,
      height: 720,
      hasAudio: true,
    })

    expect(sourceVideo).toEqual({
      id: 'rec-1',
      name: `Recording ${new Date(now).toLocaleString()}`,
      duration: 42,
      width: 1280,
      height: 720,
      frameRate: 30,
      mimeType: 'video/webm',
      size: blob.size,
      mediaType: 'video',
      source: 'recording',
      recordedAt: now,
      hasAudio: true,
    })
  })

  // ESCSUITE-60. The stored metadata is the only record of the take that
  // survives a reload, so whether it had audio has to be written here — the
  // list entry's `hasAudio` lives in memory and is rebuilt from this on load.
  it('records a silent take as having no audio', () => {
    const sourceVideo = buildSourceVideo({
      id: 'rec-3',
      now: 0,
      blob: new Blob(),
      duration: 1,
      width: 1,
      height: 1,
      hasAudio: false,
    })

    expect(sourceVideo.hasAudio).toBe(false)
  })

  it('takes whatever duration the caller passes — no fallback of its own', () => {
    const sourceVideo = buildSourceVideo({
      id: 'rec-2',
      now: 0,
      blob: new Blob(),
      duration: 0,
      width: 1,
      height: 1,
      hasAudio: true,
    })

    expect(sourceVideo.duration).toBe(0)
  })
})

describe('buildRecordingEntry', () => {
  const sourceVideo = { id: 'rec-1', name: 'Recording 1/1/2026', duration: 42 }
  const baseConfig: Pick<RecordingConfig, 'webcamEnabled'> = { webcamEnabled: true }

  it('carries the id/name/duration from sourceVideo and hasWebcam from config', () => {
    const entry = buildRecordingEntry({
      sourceVideo,
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      config: baseConfig,
      hasAudio: false,
    })

    expect(entry).toEqual({
      id: 'rec-1',
      name: 'Recording 1/1/2026',
      duration: 42,
      createdAt: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      hasWebcam: true,
      hasAudio: false,
    })
  })

  // ESCSUITE-62. `hasAudio` is no longer derived here: ticking "System Audio"
  // only *asks* for it, so the config alone cannot say whether the take got
  // any. The caller computes the one answer (see `useRecordingSave`) and hands
  // the same value to both builders.
  it('takes the hasAudio the caller computed rather than reading the config', () => {
    const entry = buildRecordingEntry({
      sourceVideo,
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      config: baseConfig,
      hasAudio: true,
    })

    expect(entry.hasAudio).toBe(true)
  })

  it('records a silent take as having no audio', () => {
    const entry = buildRecordingEntry({
      sourceVideo,
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      config: baseConfig,
      hasAudio: false,
    })

    expect(entry.hasAudio).toBe(false)
  })
})
