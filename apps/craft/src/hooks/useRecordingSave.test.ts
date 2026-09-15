// Turning a finished take into a stored recording.
//
// Storage is real (fake-indexeddb), so what the hook writes can be read back.
// The two decoding boundaries are doubled the way the App tests double them:
// the WebM repair and the thumbnail generator both wrap browser codecs jsdom
// does not have. The recorder type and the pre-captured thumbnail arrive
// through the refs App hands to both this hook and the controller, so each
// test sets them the way a take would have.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { renderHook } from '@testing-library/react'
import { useRecordingSave, type RecordingSaveDeps } from './useRecordingSave'
import { clearAllRecordings, getRecordingsMetadata, getThumbnail } from '../core/storage'
import { converterModule, thumbnailModule, resetAppDoubles } from '../test/appDoubles'
import { getLastCanvasContext, resetCanvasContextDouble } from '../test/doubles/canvas'
import { defaultConfig, type Recording, type RecordingConfig, type RecordingState } from '../store/types'

vi.mock('../core/thumbnailGenerator', async () => (await import('../test/appDoubles')).thumbnailModule)
vi.mock('../core/converter', async () => (await import('../test/appDoubles')).converterModule)

const RAW = new Blob(['recorded-bytes'], { type: 'video/webm' })

let recorderTypeRef: { current: 'webcodecs' | 'mediarecorder' }
let capturedThumbnailRef: { current: Blob | null }
let states: RecordingState[]
let added: Recording[]
let notices: Array<string | null>

beforeEach(async () => {
  resetAppDoubles()
  resetCanvasContextDouble()
  recorderTypeRef = { current: 'mediarecorder' }
  capturedThumbnailRef = { current: null }
  states = []
  added = []
  notices = []
  await clearAllRecordings()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mountSave(config: Partial<RecordingConfig> = {}) {
  const deps: RecordingSaveDeps = {
    recorderTypeRef,
    capturedThumbnailRef,
    config: { ...defaultConfig, ...config },
    setState: (state) => { states.push(state) },
    addRecording: (recording) => { added.push(recording) },
    setNotice: (notice) => { notices.push(notice) },
  }
  return renderHook(() => useRecordingSave(deps))
}

describe('useRecordingSave containers', () => {
  it('repairs the metadata a MediaRecorder take is missing, then stores the repaired blob', async () => {
    const { result } = mountSave()

    await result.current(RAW, 8)

    expect(states[0]).toBe('saving')
    expect(converterModule.fixWebMMetadata).toHaveBeenCalledWith(RAW)
    expect(thumbnailModule.extractVideoMetadata).toHaveBeenCalledWith(expect.any(Blob), 8)
    expect(thumbnailModule.extractVideoMetadata.mock.calls[0][0]).not.toBe(RAW)

    const [meta] = await getRecordingsMetadata()
    expect(meta).toMatchObject({ duration: 8, width: 1920, height: 1080, frameRate: 30, source: 'recording' })
    await expect(getThumbnail(meta.id)).resolves.toBeDefined()
  })

  it('leaves a WebCodecs take alone — it is already seekable', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave()

    await result.current(RAW, 5)

    expect(converterModule.fixWebMMetadata).not.toHaveBeenCalled()
    expect(thumbnailModule.extractVideoMetadata).toHaveBeenCalledWith(RAW, 5)
  })

  it('keeps the raw take when the repair fails, and says the file may not seek', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    converterModule.fixWebMMetadata.mockRejectedValue(new Error('remux failed'))
    const { result } = mountSave()

    await result.current(RAW, 3)

    expect(thumbnailModule.extractVideoMetadata).toHaveBeenCalledWith(RAW, 3)
    expect(added).toHaveLength(1)
    expect(consoleWarn).toHaveBeenCalledWith('WebM metadata repair failed:', expect.any(Error))
    expect(notices).toEqual([
      'Saved, but the recording may not be seekable — the container repair failed.',
    ])
  })

  it('says nothing about seeking when the repair worked', async () => {
    const { result } = mountSave()

    await result.current(RAW, 3)

    expect(notices).toEqual([])
  })

  it('falls back to the timed duration when the file reports none', async () => {
    thumbnailModule.extractVideoMetadata.mockResolvedValue({ duration: 0, width: 640, height: 480 })
    const { result } = mountSave()

    await result.current(RAW, 95)

    expect(added[0].duration).toBe(95)
    const [meta] = await getRecordingsMetadata()
    expect(meta).toMatchObject({ duration: 95, width: 640, height: 480 })
  })
})

describe('useRecordingSave thumbnails', () => {
  it('uses the frame grabbed from the live preview, and clears it for the next take', async () => {
    capturedThumbnailRef.current = new Blob(['live-frame'], { type: 'image/jpeg' })
    const { result } = mountSave()

    await result.current(RAW, 4)

    expect(thumbnailModule.generateThumbnail).not.toHaveBeenCalled()
    expect(capturedThumbnailRef.current).toBeNull()
    expect(added[0].thumbnailUrl).toBe('blob:mock-url')
  })

  it('decodes one from the file when the preview never produced a frame', async () => {
    const { result } = mountSave()

    await result.current(RAW, 4)

    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledTimes(1)
    const [meta] = await getRecordingsMetadata()
    await expect(getThumbnail(meta.id)).resolves.toBeDefined()
  })

  it('draws a placeholder when the file cannot be decoded either', async () => {
    thumbnailModule.generateThumbnail.mockRejectedValue(new Error('no decoder'))
    const { result } = mountSave()

    await result.current(RAW, 4)

    expect(getLastCanvasContext()!.calls.map(call => call.method)).toEqual(['fillRect', 'fillText'])
    const [meta] = await getRecordingsMetadata()
    await expect(getThumbnail(meta.id)).resolves.toBeDefined()
  })
})

describe('useRecordingSave list entry', () => {
  it('marks a system-audio-only take as having audio and no webcam', async () => {
    const { result } = mountSave({ webcamEnabled: false, microphoneEnabled: false, systemAudioEnabled: true })

    await result.current(RAW, 4)

    expect(added[0]).toMatchObject({ hasAudio: true, hasWebcam: false })
  })

  it('marks a silent webcam take as having a webcam and no audio', async () => {
    const { result } = mountSave({ webcamEnabled: true, microphoneEnabled: false, systemAudioEnabled: false })

    await result.current(RAW, 4)

    expect(added[0]).toMatchObject({ hasAudio: false, hasWebcam: true })
  })

  // Changed assertion: the hook used to swallow the failure into a
  // console.error, which left its caller setting 'idle' as if the take had
  // been saved. It now rejects, and reporting the failure is the caller's job.
  it('rejects rather than swallowing a failure, and lists nothing', async () => {
    thumbnailModule.extractVideoMetadata.mockRejectedValue(new Error('cannot decode'))
    const { result } = mountSave()

    await expect(result.current(RAW, 4)).rejects.toThrow('cannot decode')

    expect(added).toEqual([])
    expect(await getRecordingsMetadata()).toEqual([])
  })
})
