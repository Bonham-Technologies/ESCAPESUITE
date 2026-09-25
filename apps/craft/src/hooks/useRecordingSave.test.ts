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
import { SEPARATE_TRACK_NOT_SAVED } from '../utils/notices'

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

describe('useRecordingSave for a separate-tracks take', () => {
  const COMPANION = new Blob(['webcam-bytes'], { type: 'video/webm' })

  /** What the WebCodecs recorder hands over as the take's second half. */
  const companionPart = { role: 'webcam' as const, blob: COMPANION, startOffset: 0 }

  const MIC = new Blob(['mic-bytes'], { type: 'audio/webm' })
  const SYSTEM = new Blob(['system-bytes'], { type: 'audio/webm' })
  const micPart = { role: 'mic' as const, blob: MIC, startOffset: 0 }
  const systemPart = { role: 'system' as const, blob: SYSTEM, startOffset: 0 }

  it('stores both parts under one takeId, the placement on the primary only', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({
      webcamEnabled: true,
      separateTracks: true,
      webcamPosition: 'top-left',
      webcamSize: 0.3,
      webcamShape: 'rectangle',
    })

    await result.current(RAW, 6, [companionPart])

    const stored = await getRecordingsMetadata()
    expect(stored).toHaveLength(2)
    const primary = stored.find(m => m.role === 'screen')!
    const webcam = stored.find(m => m.role === 'webcam')!
    // One take: the primary names it, the companion points at the primary.
    expect(primary.takeId).toBe(primary.id)
    expect(webcam.takeId).toBe(primary.id)
    expect(webcam.id).not.toBe(primary.id)
    expect(primary.startOffset).toBe(0)
    expect(webcam.startOffset).toBe(0)
    // The overlay geometry is the primary's, copied from the config at save
    // time: it is what ARTIST seeds the webcam clip's transform from (slice 2)
    // and what the composite MP4 draws through (slice 4).
    expect(primary.overlayPlacement).toEqual({
      position: 'top-left',
      size: 0.3,
      shape: 'rectangle',
    })
    expect('overlayPlacement' in webcam).toBe(false)
    // Slice 1 leaves the mixed audio on the primary, so only it claims sound.
    expect(primary.hasAudio).toBe(true)
    expect(webcam.hasAudio).toBe(false)
  })

  it('stores a thumbnail for each part, the companion decoded from its own blob', async () => {
    recorderTypeRef.current = 'webcodecs'
    capturedThumbnailRef.current = new Blob(['preview-frame'], { type: 'image/jpeg' })
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart])

    const stored = await getRecordingsMetadata()
    for (const part of stored) {
      await expect(getThumbnail(part.id)).resolves.toBeDefined()
    }
    // The pre-captured frame is the *composited* preview, which is not the
    // webcam alone — so the companion's thumbnail comes out of its own file.
    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledTimes(1)
    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledWith(COMPANION)
  })

  // The pre-captured frame belongs to the primary, so the companion always
  // decodes its own — and when that decode fails it falls back to the same
  // placeholder the primary's own fallback chain draws, rather than leaving
  // the companion with no thumbnail at all.
  it('draws a placeholder for the companion thumbnail when its own decode fails', async () => {
    recorderTypeRef.current = 'webcodecs'
    thumbnailModule.generateThumbnail.mockRejectedValue(new Error('no decoder'))
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart])

    const stored = await getRecordingsMetadata()
    expect(stored).toHaveLength(2)
    for (const part of stored) {
      await expect(getThumbnail(part.id)).resolves.toBeDefined()
    }
  })

  it('falls back to the timed duration for the companion when its file reports none', async () => {
    recorderTypeRef.current = 'webcodecs'
    thumbnailModule.extractVideoMetadata.mockResolvedValue({ duration: 0, width: 640, height: 480 })
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart])

    const stored = await getRecordingsMetadata()
    const webcam = stored.find(m => m.role === 'webcam')!
    expect(webcam.duration).toBe(6)
  })

  it('puts the companion under its primary in the list, not above it', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart])

    // addRecording prepends, so the companion is added first: the list ends up
    // [primary, companion, ...older] and the webcam row is never above the
    // screen row it belongs to.
    expect(added.map(entry => entry.role)).toEqual(['webcam', 'screen'])
  })

  it('never repairs the companion — a WebCodecs take needs none', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart])

    expect(converterModule.fixWebMMetadata).not.toHaveBeenCalled()
  })

  it('saves one part when there is no companion, exactly as before', async () => {
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6)

    const stored = await getRecordingsMetadata()
    expect(stored).toHaveLength(1)
    expect('takeId' in stored[0]).toBe(false)
    expect('role' in stored[0]).toBe(false)
    expect(added).toHaveLength(1)
  })

  // A companion may never cost the take its primary. Here the companion's
  // own metadata extraction throws (standing in for any failure in its
  // metadata/thumbnail/storeVideo/storeThumbnail chain) — the primary must
  // still be saved and listed, and the failure reported once, not lost.
  it('keeps the primary when the companion cannot be saved, and says so', async () => {
    recorderTypeRef.current = 'webcodecs'
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    thumbnailModule.extractVideoMetadata.mockImplementation(async (blob: Blob, knownDuration?: number) => {
      if (blob === COMPANION) throw new Error('decode failed')
      return { duration: knownDuration ?? 0, width: 1920, height: 1080 }
    })
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart])

    expect(added).toHaveLength(1)
    expect(added[0].role).toBe('screen')
    const stored = await getRecordingsMetadata()
    expect(stored).toHaveLength(1)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledWith('Webcam track could not be saved:', expect.any(Error))
    expect(notices).toEqual([SEPARATE_TRACK_NOT_SAVED])
  })

  it('stores four parts under one takeId, the audio parts as audio', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({
      webcamEnabled: true,
      separateTracks: true,
      microphoneEnabled: true,
      systemAudioEnabled: true,
    })

    await result.current(RAW, 6, [companionPart, micPart, systemPart])

    const stored = await getRecordingsMetadata()
    expect(stored).toHaveLength(4)
    const primary = stored.find(m => m.role === 'screen')!
    const mic = stored.find(m => m.role === 'mic')!
    const system = stored.find(m => m.role === 'system')!

    for (const part of [mic, system]) {
      expect(part.takeId).toBe(primary.id)
      expect(part.startOffset).toBe(0)
      // The shape ESCAPEARTIST's own audio importer produces: a part that
      // arrived from a recording should be indistinguishable from one that
      // arrived from a file.
      expect(part.mediaType).toBe('audio')
      expect(part.frameRate).toBe(0)
      expect(part.width).toBe(0)
      expect(part.height).toBe(0)
      expect(part.mimeType).toBe('audio/webm')
      // hasAudio is per part now: the audio parts are the audio.
      expect(part.hasAudio).toBe(true)
      expect(part.hasWebcam).toBe(false)
      expect('overlayPlacement' in part).toBe(false)
      // Every part of a take is the same length by construction: one
      // recorder, one clock, one start, one stop.
      expect(part.duration).toBe(6)
    }
    expect(mic.name).toMatch(/ — microphone$/)
    expect(system.name).toMatch(/ — system audio$/)
  })

  it('decodes nothing for an audio part — no metadata probe, no thumbnail', async () => {
    recorderTypeRef.current = 'webcodecs'
    capturedThumbnailRef.current = new Blob(['preview-frame'], { type: 'image/jpeg' })
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart, micPart, systemPart])

    // extractVideoMetadata reports `width: videoWidth || 1920`, so probing an
    // audio file would store it as 1920x1080; generateThumbnail would decode a
    // file with no picture and land on the placeholder. Neither is asked.
    const probed = thumbnailModule.extractVideoMetadata.mock.calls.map(call => call[0])
    expect(probed).not.toContain(MIC)
    expect(probed).not.toContain(SYSTEM)
    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledTimes(1)
    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledWith(COMPANION)

    const stored = await getRecordingsMetadata()
    const mic = stored.find(m => m.role === 'mic')!
    // No thumbnail stored, so the library draws its own empty placeholder and
    // ARTIST treats the missing picture as cosmetic, which it already does.
    await expect(getThumbnail(mic.id)).resolves.toBeUndefined()
  })

  it('lists the parts under the primary in role order', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart, micPart, systemPart])

    // addRecording prepends, so the companions are added in reverse: the list
    // ends up [primary, webcam, mic, system], which is the order
    // `orderTakes` rebuilds after a reload.
    expect(added.map(entry => entry.role)).toEqual(['system', 'mic', 'webcam', 'screen'])
    expect(added.find(entry => entry.role === 'mic')!.hasWebcam).toBe(false)
    expect(added.find(entry => entry.role === 'mic')!.hasAudio).toBe(true)
  })

  it('loses one part without losing the others, and says so once', async () => {
    recorderTypeRef.current = 'webcodecs'
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    thumbnailModule.generateThumbnail.mockRejectedValue(new Error('no decoder'))
    // The webcam part's own thumbnail fallback would rescue it, so break the
    // part that has no fallback: its metadata probe.
    thumbnailModule.extractVideoMetadata.mockImplementation(async (blob: Blob, known?: number) => {
      if (blob === COMPANION) throw new Error('decode failed')
      return { duration: known ?? 0, width: 1920, height: 1080 }
    })
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart, micPart, systemPart])

    const stored = await getRecordingsMetadata()
    // The camera is gone; the screen, the microphone and the system audio are
    // not. A companion may never cost the take another part.
    expect(stored.map(m => m.role).sort()).toEqual(['mic', 'screen', 'system'])
    expect(consoleWarn).toHaveBeenCalledWith(
      'Webcam track could not be saved:',
      expect.any(Error)
    )
    // One sentence however many parts were lost: there is one notice channel,
    // and "which one" is what the log is for.
    expect(notices).toEqual([SEPARATE_TRACK_NOT_SAVED])
  })
})
