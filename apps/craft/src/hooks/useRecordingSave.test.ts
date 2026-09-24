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
import { act, renderHook } from '@testing-library/react'
import { useRecordingSave, type RecordingSaveDeps } from './useRecordingSave'
import { getRecordingsMetadata, getThumbnail } from '../core/storage'
import { clearAllRecordings } from '../test/recordingsDb'
import { converterModule, thumbnailModule, resetAppDoubles } from '../test/appDoubles'
import { useRecorderStore } from '../store/recorderStore'
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
  // What `handleStartRecording` sets at the top of every take; a test that
  // cares sets it the way the just-finished take left it.
  useRecorderStore.setState({ systemAudioShared: true })
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

  // ESCSUITE-57. An unrepaired MediaRecorder WebM reports `Infinity` for its
  // duration, and `Infinity > 0` is true — so a `> 0` guard on its own accepts
  // it and stores a recording whose length is not a number anyone can use.
  // `core/thumbnailGenerator.extractVideoMetadata` already maps a non-finite
  // duration to the timed one, so the real save path never delivers this; the
  // guard is the hook's own contract, and it should not depend on a helper it
  // does not own staying that way.
  it('falls back to the timed duration when the file reports an infinite one', async () => {
    thumbnailModule.extractVideoMetadata.mockResolvedValue({
      duration: Infinity,
      width: 640,
      height: 480,
    })
    const { result } = mountSave()

    await result.current(RAW, 12)

    expect(added[0].duration).toBe(12)
    const [meta] = await getRecordingsMetadata()
    expect(meta).toMatchObject({ duration: 12, width: 640, height: 480 })
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

  // ESCSUITE-60. The list entry above lives in memory; the stored metadata is
  // what a reload reads back. They are built from the same config expression,
  // so the two records cannot disagree about whether the take had audio — and
  // the M4A button, which is gated on it, stays truthful after a reload.
  it('stores the same answer about audio in the metadata a reload reads back', async () => {
    const { result } = mountSave({ webcamEnabled: false, microphoneEnabled: true, systemAudioEnabled: false })

    await result.current(RAW, 4)

    const [meta] = await getRecordingsMetadata()
    expect(meta.hasAudio).toBe(true)
    expect(meta.hasAudio).toBe(added[0].hasAudio)
  })

  it('stores a silent take as having no audio', async () => {
    const { result } = mountSave({ webcamEnabled: true, microphoneEnabled: false, systemAudioEnabled: false })

    await result.current(RAW, 4)

    const [meta] = await getRecordingsMetadata()
    expect(meta.hasAudio).toBe(false)
    expect(meta.hasAudio).toBe(added[0].hasAudio)
  })

  // ESCSUITE-62. Ticking "System Audio" only *asks* for it — the browser's own
  // share dialog carries the tick box — so a take recorded with the box left
  // clear has no sound at all. The controller already knows (it reads the
  // display stream's tracks at take start and writes `systemAudioShared`), and
  // this is the take that flag describes: it is reset to `true` only when the
  // *next* take starts. Marking the take audible cost it nothing visible and
  // cost the M4A button its truth — it offered an audio download of silence.
  it('marks a take whose share picker cleared system audio as silent', async () => {
    useRecorderStore.setState({ systemAudioShared: false })
    const { result } = mountSave({ microphoneEnabled: false, systemAudioEnabled: true })

    await result.current(RAW, 4)

    expect(added[0].hasAudio).toBe(false)
    const [meta] = await getRecordingsMetadata()
    expect(meta.hasAudio).toBe(false)
  })

  it('marks it audible when the picker did share system audio', async () => {
    useRecorderStore.setState({ systemAudioShared: true })
    const { result } = mountSave({ microphoneEnabled: false, systemAudioEnabled: true })

    await result.current(RAW, 4)

    expect(added[0].hasAudio).toBe(true)
    const [meta] = await getRecordingsMetadata()
    expect(meta.hasAudio).toBe(true)
  })

  it('keeps a microphone take audible however the share picker answered', async () => {
    useRecorderStore.setState({ systemAudioShared: false })
    const { result } = mountSave({ microphoneEnabled: true, systemAudioEnabled: true })

    await result.current(RAW, 4)

    expect(added[0].hasAudio).toBe(true)
    const [meta] = await getRecordingsMetadata()
    expect(meta.hasAudio).toBe(true)
  })

  // The flag is read with `getState()` on the save path, not selected: this
  // hook renders inside `App`, and a subscription here would re-render the
  // whole screen every time a take started.
  it('reads the flag without subscribing to it', async () => {
    let renders = 0
    const deps: RecordingSaveDeps = {
      recorderTypeRef,
      capturedThumbnailRef,
      config: { ...defaultConfig, microphoneEnabled: false, systemAudioEnabled: true },
      setState: (state) => { states.push(state) },
      addRecording: (recording) => { added.push(recording) },
      setNotice: (notice) => { notices.push(notice) },
    }
    renderHook(() => { renders++; return useRecordingSave(deps) })
    const before = renders

    act(() => { useRecorderStore.setState({ systemAudioShared: false }) })

    expect(renders).toBe(before)
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
