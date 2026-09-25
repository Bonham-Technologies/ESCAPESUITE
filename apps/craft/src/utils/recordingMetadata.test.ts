import { describe, it, expect } from 'vitest'
import { buildSourceVideo, buildRecordingEntry } from './recordingMetadata'

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
      hasWebcam: false,
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
      hasWebcam: false,
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
      hasWebcam: false,
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
      hasWebcam: false,
    })

    expect(sourceVideo.duration).toBe(0)
  })
})

describe('buildRecordingEntry', () => {
  const sourceVideo = { id: 'rec-1', name: 'Recording 1/1/2026', duration: 42 }

  it('carries the id/name/duration from sourceVideo and the hasWebcam it is given', () => {
    const entry = buildRecordingEntry({
      sourceVideo,
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      hasWebcam: true,
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
      hasWebcam: true,
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
      hasWebcam: true,
      hasAudio: false,
    })

    expect(entry.hasAudio).toBe(false)
  })
})

describe('buildSourceVideo for a separate-tracks take', () => {
  const placement = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

  it('writes takeId, role, startOffset and the overlay placement on the primary', () => {
    const sourceVideo = buildSourceVideo({
      id: 'take-1',
      now: 0,
      blob: new Blob(['screen'], { type: 'video/webm' }),
      duration: 6,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasWebcam: true,
      takeId: 'take-1',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: placement,
    })

    // The take is named by its primary, so the primary's takeId is its own id.
    expect(sourceVideo).toMatchObject({
      takeId: 'take-1',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: placement,
      hasWebcam: true,
    })
  })

  it('names the webcam half after its take and carries no overlay placement', () => {
    const now = 1_700_000_000_000
    const sourceVideo = buildSourceVideo({
      id: 'part-2',
      now,
      blob: new Blob(['webcam'], { type: 'video/webm' }),
      duration: 6,
      width: 640,
      height: 480,
      // Slice 1: the mixed audio stays on the primary, so the webcam half is
      // silent and must be stored as such — its M4A button is never offered,
      // and ARTIST will read this back in slice 2.
      hasAudio: false,
      hasWebcam: true,
      takeId: 'take-1',
      role: 'webcam',
      startOffset: 0,
    })

    expect(sourceVideo.name).toBe(`Recording ${new Date(now).toLocaleString()} — webcam`)
    expect(sourceVideo.hasAudio).toBe(false)
    expect('overlayPlacement' in sourceVideo).toBe(false)
  })

  it('leaves a plain take with no companion fields at all', () => {
    const sourceVideo = buildSourceVideo({
      id: 'r',
      now: 0,
      blob: new Blob(),
      duration: 1,
      width: 1,
      height: 1,
      hasAudio: true,
      hasWebcam: false,
    })

    // Absent keys rather than `undefined` ones: a reader (ARTIST, slice 2) must
    // not have to tell a real absence from a written undefined, and this is
    // what keeps a composited take's stored record what it has always been.
    expect('takeId' in sourceVideo).toBe(false)
    expect('role' in sourceVideo).toBe(false)
    expect('startOffset' in sourceVideo).toBe(false)
    expect('overlayPlacement' in sourceVideo).toBe(false)
    expect(sourceVideo.hasWebcam).toBe(false)
  })
})

describe('buildRecordingEntry for a separate-tracks take', () => {
  it('carries takeId and role from the stored record onto the list entry', () => {
    const entry = buildRecordingEntry({
      sourceVideo: {
        id: 'part-2',
        name: 'Recording 1/1/2026 — webcam',
        duration: 42,
        takeId: 'take-1',
        role: 'webcam',
      },
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      hasWebcam: true,
      hasAudio: false,
    })

    // The library groups and labels from the list entry, so both facts have to
    // survive the trip out of storage and into memory.
    expect(entry).toMatchObject({ takeId: 'take-1', role: 'webcam' })
  })
})

describe('buildSourceVideo for an audio companion', () => {
  const base = {
    now: 1_700_000_000_000,
    duration: 6,
    // An audio file has no picture, and saying 1920x1080 would be a lie the
    // editor reads. This is the exact shape ESCAPEARTIST's own audio importer
    // produces (core/videoProcessor.ts extractAudioMetadata).
    width: 0,
    height: 0,
    hasAudio: true,
    hasWebcam: false,
    takeId: 'take-1',
    startOffset: 0,
  }

  it('stores the microphone part as audio, named after its take', () => {
    const sourceVideo = buildSourceVideo({
      ...base,
      id: 'part-mic',
      blob: new Blob(['mic'], { type: 'audio/webm' }),
      role: 'mic',
    })

    expect(sourceVideo.name).toBe(
      `Recording ${new Date(base.now).toLocaleString()} — microphone`
    )
    expect(sourceVideo).toMatchObject({
      mediaType: 'audio',
      frameRate: 0,
      width: 0,
      height: 0,
      mimeType: 'audio/webm',
      hasAudio: true,
      hasWebcam: false,
      role: 'mic',
      takeId: 'take-1',
    })
  })

  it('stores the system-audio part as audio, named after its take', () => {
    const sourceVideo = buildSourceVideo({
      ...base,
      id: 'part-system',
      blob: new Blob(['system'], { type: 'audio/webm' }),
      role: 'system',
    })

    expect(sourceVideo.name).toBe(
      `Recording ${new Date(base.now).toLocaleString()} — system audio`
    )
    expect(sourceVideo.mediaType).toBe('audio')
    expect(sourceVideo.frameRate).toBe(0)
  })

  it('leaves the webcam part and the primary as video', () => {
    const webcam = buildSourceVideo({
      ...base,
      id: 'part-webcam',
      blob: new Blob(['webcam'], { type: 'video/webm' }),
      width: 640,
      height: 480,
      hasAudio: false,
      hasWebcam: true,
      role: 'webcam',
    })
    const primary = buildSourceVideo({
      ...base,
      id: 'take-1',
      blob: new Blob(['screen'], { type: 'video/webm' }),
      width: 1280,
      height: 720,
      hasWebcam: true,
      role: 'screen',
    })

    expect(webcam.mediaType).toBe('video')
    expect(webcam.frameRate).toBe(30)
    expect(primary.mediaType).toBe('video')
    expect(primary.frameRate).toBe(30)
  })
})

describe('buildRecordingEntry carries hasWebcam rather than the config', () => {
  it('takes the answer it is given, so a part can differ from the take', () => {
    // The audio halves of a webcam take have no camera in them, and the list
    // entry has to say the same thing the stored record does — the same rule
    // `hasAudio` has followed since ESCSUITE-60.
    const entry = buildRecordingEntry({
      sourceVideo: {
        id: 'part-mic',
        name: 'Recording — microphone',
        duration: 6,
        takeId: 'take-1',
        role: 'mic',
      },
      now: 1_700_000_000_000,
      size: 2048,
      hasWebcam: false,
      hasAudio: true,
    })

    expect(entry).toMatchObject({
      id: 'part-mic',
      takeId: 'take-1',
      role: 'mic',
      hasWebcam: false,
      hasAudio: true,
    })
    // No thumbnail is stored for an audio part, so the row has none — and the
    // list draws its empty placeholder rather than a broken <img>.
    expect(entry.thumbnailUrl).toBeUndefined()
  })
})
