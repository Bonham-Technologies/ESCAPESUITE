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
    })
  })

  it('takes whatever duration the caller passes — no fallback of its own', () => {
    const sourceVideo = buildSourceVideo({
      id: 'rec-2',
      now: 0,
      blob: new Blob(),
      duration: 0,
      width: 1,
      height: 1,
    })

    expect(sourceVideo.duration).toBe(0)
  })
})

describe('buildRecordingEntry', () => {
  const sourceVideo = { id: 'rec-1', name: 'Recording 1/1/2026', duration: 42 }
  const baseConfig: Pick<RecordingConfig, 'webcamEnabled' | 'microphoneEnabled' | 'systemAudioEnabled'> = {
    webcamEnabled: true,
    microphoneEnabled: false,
    systemAudioEnabled: false,
  }

  it('carries the id/name/duration from sourceVideo and hasWebcam from config', () => {
    const entry = buildRecordingEntry({
      sourceVideo,
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      config: baseConfig,
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

  it('hasAudio is true when only the microphone is enabled', () => {
    const entry = buildRecordingEntry({
      sourceVideo,
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      config: { ...baseConfig, microphoneEnabled: true, systemAudioEnabled: false },
    })

    expect(entry.hasAudio).toBe(true)
  })

  it('hasAudio is true when only system audio is enabled', () => {
    const entry = buildRecordingEntry({
      sourceVideo,
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      config: { ...baseConfig, microphoneEnabled: false, systemAudioEnabled: true },
    })

    expect(entry.hasAudio).toBe(true)
  })

  it('hasAudio is false when neither microphone nor system audio is enabled', () => {
    const entry = buildRecordingEntry({
      sourceVideo,
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      config: baseConfig,
    })

    expect(entry.hasAudio).toBe(false)
  })
})
