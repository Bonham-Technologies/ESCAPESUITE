import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRecorderStore } from './recorderStore'
import { defaultConfig, type DetailedCapabilities } from './types'
import type { SourceVideo } from '@escapesuite/shared/types'

// loadRecordings talks to the storage layer — that's a collaborator, not the
// module under test, so it's mocked to control what recordings/thumbnails
// come back while exercising recorderStore's own sorting/mapping logic.
vi.mock('../core/storage', () => ({
  getRecordingsMetadata: vi.fn(),
  getThumbnail: vi.fn(),
  createBlobUrl: vi.fn(),
  hasSpaceForRecording: vi.fn(),
}))

import {
  getRecordingsMetadata,
  getThumbnail,
  createBlobUrl,
  hasSpaceForRecording,
} from '../core/storage'

describe('recorderStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useRecorderStore.setState({
      state: 'idle',
      config: { ...defaultConfig },
      capabilities: {
        screenCapture: false,
        webcam: false,
        microphone: false,
        systemAudio: false,
        mediaRecorder: false,
      },
      recordings: [],
      currentDuration: 0,
      countdownValue: 0,
      audioLevels: { microphone: 0, system: 0 },
      screenStream: null,
      webcamStream: null,
      hasStorageSpace: true,
      mp4Support: { state: 'checking', supported: false, audio: false },
    })
  })

  describe('initial state', () => {
    it('should have idle state initially', () => {
      const { state } = useRecorderStore.getState()
      expect(state).toBe('idle')
    })

    it('should have default config', () => {
      const { config } = useRecorderStore.getState()
      expect(config.screenEnabled).toBe(true)
      expect(config.webcamEnabled).toBe(false)
      expect(config.microphoneEnabled).toBe(true)
      expect(config.countdownSeconds).toBe(3)
    })

    it('should have no recordings initially', () => {
      const { recordings } = useRecorderStore.getState()
      expect(recordings).toHaveLength(0)
    })

    it('should not claim MP4 support before the codec probe has answered', () => {
      const { mp4Support } = useRecorderStore.getState()
      expect(mp4Support).toEqual({ state: 'checking', supported: false, audio: false })
    })
  })

  describe('setState', () => {
    it('should update recording state', () => {
      const { setState } = useRecorderStore.getState()

      setState('recording')
      expect(useRecorderStore.getState().state).toBe('recording')

      setState('paused')
      expect(useRecorderStore.getState().state).toBe('paused')

      setState('idle')
      expect(useRecorderStore.getState().state).toBe('idle')
    })
  })

  describe('setConfig', () => {
    it('should update config partially', () => {
      const { setConfig } = useRecorderStore.getState()

      setConfig({ screenEnabled: false })
      expect(useRecorderStore.getState().config.screenEnabled).toBe(false)
      expect(useRecorderStore.getState().config.webcamEnabled).toBe(false) // unchanged
    })

    it('should update webcam settings', () => {
      const { setConfig } = useRecorderStore.getState()

      setConfig({
        webcamEnabled: true,
        webcamPosition: 'top-left',
        webcamSize: 0.3,
        webcamShape: 'rectangle',
      })

      const { config } = useRecorderStore.getState()
      expect(config.webcamEnabled).toBe(true)
      expect(config.webcamPosition).toBe('top-left')
      expect(config.webcamSize).toBe(0.3)
      expect(config.webcamShape).toBe('rectangle')
    })
  })

  describe('setCapabilities', () => {
    it('should update capabilities', () => {
      const { setCapabilities } = useRecorderStore.getState()

      setCapabilities({
        screenCapture: true,
        webcam: true,
        microphone: true,
        systemAudio: false,
        mediaRecorder: true,
      })

      const { capabilities } = useRecorderStore.getState()
      expect(capabilities.screenCapture).toBe(true)
      expect(capabilities.webcam).toBe(true)
      expect(capabilities.microphone).toBe(true)
      expect(capabilities.systemAudio).toBe(false)
      expect(capabilities.mediaRecorder).toBe(true)
    })
  })

  describe('setCountdown', () => {
    it('should update countdown value', () => {
      const { setCountdown } = useRecorderStore.getState()

      setCountdown(3)
      expect(useRecorderStore.getState().countdownValue).toBe(3)

      setCountdown(2)
      expect(useRecorderStore.getState().countdownValue).toBe(2)
    })
  })

  describe('setCurrentDuration', () => {
    it('should update current duration', () => {
      const { setCurrentDuration } = useRecorderStore.getState()

      setCurrentDuration(10.5)
      expect(useRecorderStore.getState().currentDuration).toBe(10.5)
    })
  })

  describe('setAudioLevels', () => {
    it('should update audio levels', () => {
      const { setAudioLevels } = useRecorderStore.getState()

      setAudioLevels({ microphone: 0.5, system: 0.3 })

      const { audioLevels } = useRecorderStore.getState()
      expect(audioLevels.microphone).toBe(0.5)
      expect(audioLevels.system).toBe(0.3)
    })
  })

  describe('recordings management', () => {
    it('should add a recording', () => {
      const { addRecording } = useRecorderStore.getState()

      addRecording({
        id: 'test-1',
        name: 'Test Recording',
        duration: 60,
        createdAt: Date.now(),
        size: 1000000,
        hasWebcam: false,
        hasAudio: true,
      })

      const { recordings } = useRecorderStore.getState()
      expect(recordings).toHaveLength(1)
      expect(recordings[0].id).toBe('test-1')
      expect(recordings[0].name).toBe('Test Recording')
    })

    it('should remove a recording', () => {
      const { addRecording, removeRecording } = useRecorderStore.getState()

      addRecording({
        id: 'test-1',
        name: 'Test Recording 1',
        duration: 60,
        createdAt: Date.now(),
        size: 1000000,
        hasWebcam: false,
        hasAudio: true,
      })

      addRecording({
        id: 'test-2',
        name: 'Test Recording 2',
        duration: 120,
        createdAt: Date.now(),
        size: 2000000,
        hasWebcam: true,
        hasAudio: true,
      })

      expect(useRecorderStore.getState().recordings).toHaveLength(2)

      removeRecording('test-1')

      const { recordings } = useRecorderStore.getState()
      expect(recordings).toHaveLength(1)
      expect(recordings[0].id).toBe('test-2')
    })
  })

  describe('setStreams', () => {
    it('should update streams', () => {
      const { setStreams } = useRecorderStore.getState()
      const mockScreenStream = new MediaStream()
      const mockWebcamStream = new MediaStream()

      setStreams(mockScreenStream, mockWebcamStream)

      const { screenStream, webcamStream } = useRecorderStore.getState()
      expect(screenStream).toBe(mockScreenStream)
      expect(webcamStream).toBe(mockWebcamStream)
    })

    it('should allow null streams', () => {
      const { setStreams } = useRecorderStore.getState()

      setStreams(null, null)

      const { screenStream, webcamStream } = useRecorderStore.getState()
      expect(screenStream).toBeNull()
      expect(webcamStream).toBeNull()
    })
  })

  describe('setDetailedCapabilities', () => {
    it('should update detailed capabilities', () => {
      const { setDetailedCapabilities } = useRecorderStore.getState()
      const detailed: DetailedCapabilities = {
        screenCapture: { available: true },
        webcam: { available: false, reason: 'no_device', message: 'No camera found' },
        microphone: { available: true },
        systemAudio: { available: false, reason: 'browser_not_supported', message: 'Not supported' },
        mediaRecorder: { available: true },
      }

      setDetailedCapabilities(detailed)

      expect(useRecorderStore.getState().detailedCapabilities).toEqual(detailed)
    })
  })

  describe('setMp4Support', () => {
    it('should record the codec probe\'s answer, reason and all', () => {
      const { setMp4Support } = useRecorderStore.getState()

      // The silent-MP4 shape: offered, but without sound and saying so. The
      // sentence is `audioReason`, the answer about AAC alone (ESCSUITE-61).
      setMp4Support({
        state: 'ready',
        supported: true,
        audio: false,
        audioReason: 'MP4 will have no audio in this browser (no AAC encoder)',
      })

      expect(useRecorderStore.getState().mp4Support).toEqual({
        state: 'ready',
        supported: true,
        audio: false,
        audioReason: 'MP4 will have no audio in this browser (no AAC encoder)',
      })
    })
  })

  describe('loadRecordings', () => {
    beforeEach(() => {
      vi.mocked(getRecordingsMetadata).mockReset()
      vi.mocked(getThumbnail).mockReset()
      vi.mocked(createBlobUrl).mockReset()
    })

    it('sorts recordings newest-first and resolves thumbnail URLs where available', async () => {
      vi.mocked(getRecordingsMetadata).mockResolvedValue([
        { id: 'older', name: 'Older', duration: 10, size: 100, recordedAt: 1000 } as SourceVideo,
        { id: 'newer', name: 'Newer', duration: 20, size: 200, recordedAt: 3000 } as SourceVideo,
      ])
      const thumbBlob = new Blob(['thumb'])
      vi.mocked(getThumbnail).mockImplementation(async (id: string) =>
        id === 'older' ? thumbBlob : undefined
      )
      vi.mocked(createBlobUrl).mockReturnValue('blob:thumb-url')

      await useRecorderStore.getState().loadRecordings()

      const { recordings } = useRecorderStore.getState()
      expect(recordings.map((r) => r.id)).toEqual(['newer', 'older'])
      expect(recordings.find((r) => r.id === 'older')?.thumbnailUrl).toBe('blob:thumb-url')
      expect(recordings.find((r) => r.id === 'newer')?.thumbnailUrl).toBeUndefined()
      expect(createBlobUrl).toHaveBeenCalledWith(thumbBlob)
      expect(recordings[0].hasWebcam).toBe(false)
      expect(recordings[0].hasAudio).toBe(true)
    })

    // ESCSUITE-14. Two stored records, one take: the library has to rebuild the
    // grouping the save path wrote, and `hasWebcam` — a hard-coded `false` with
    // a TODO beside it until now — has to come back from the metadata.
    it('rebuilds a take from its parts and reads hasWebcam back', async () => {
      vi.mocked(getRecordingsMetadata).mockResolvedValue([
        {
          id: 'webcam-part',
          name: 'Recording — webcam',
          duration: 6,
          size: 200,
          recordedAt: 2001,
          takeId: 'screen-part',
          role: 'webcam',
          hasAudio: false,
          hasWebcam: true,
        } as SourceVideo,
        { id: 'plain', name: 'Plain', duration: 3, size: 50, recordedAt: 5000 } as SourceVideo,
        {
          id: 'screen-part',
          name: 'Recording',
          duration: 6,
          size: 900,
          recordedAt: 2000,
          takeId: 'screen-part',
          role: 'screen',
          hasAudio: true,
          hasWebcam: true,
          overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
        } as SourceVideo,
      ])
      vi.mocked(getThumbnail).mockResolvedValue(undefined)

      await useRecorderStore.getState().loadRecordings()

      const { recordings } = useRecorderStore.getState()
      expect(recordings.map(r => r.id)).toEqual(['plain', 'screen-part', 'webcam-part'])
      expect(recordings.map(r => r.role)).toEqual([undefined, 'screen', 'webcam'])
      expect(recordings[1].takeId).toBe('screen-part')
      // The `hasWebcam: false // TODO` this replaces: a PiP take came back
      // claiming no camera however it was recorded.
      expect(recordings[1].hasWebcam).toBe(true)
      expect(recordings[0].hasWebcam).toBe(false)
    })

    // ESCSUITE-60. `hasAudio` gates the M4A button. It is written into the
    // stored metadata at save time, so a reloaded screen-only take must come
    // back silent rather than as the hard-coded `true` this used to return —
    // which offered an M4A download that could only fail into the notice.
    it('carries a stored take back as silent when that is what was recorded', async () => {
      vi.mocked(getRecordingsMetadata).mockResolvedValue([
        { id: 'silent', name: 'Silent', duration: 5, size: 50, hasAudio: false } as SourceVideo,
      ])
      vi.mocked(getThumbnail).mockResolvedValue(undefined)

      await useRecorderStore.getState().loadRecordings()

      expect(useRecorderStore.getState().recordings[0].hasAudio).toBe(false)
    })

    // Recordings saved before ESCSUITE-60 have no `hasAudio` at all. They keep
    // the old answer rather than being demoted to silent, because a take that
    // did have audio would otherwise lose its M4A button for good.
    it('assumes audio for a recording saved before the field existed', async () => {
      vi.mocked(getRecordingsMetadata).mockResolvedValue([
        { id: 'legacy', name: 'Legacy', duration: 5, size: 50 } as SourceVideo,
      ])
      vi.mocked(getThumbnail).mockResolvedValue(undefined)

      await useRecorderStore.getState().loadRecordings()

      expect(useRecorderStore.getState().recordings[0].hasAudio).toBe(true)
    })

    it('defaults createdAt to 0 when recordedAt is missing', async () => {
      vi.mocked(getRecordingsMetadata).mockResolvedValue([
        { id: 'no-date', name: 'No Date', duration: 5, size: 50 } as SourceVideo,
      ])
      vi.mocked(getThumbnail).mockResolvedValue(undefined)

      await useRecorderStore.getState().loadRecordings()

      expect(useRecorderStore.getState().recordings[0].createdAt).toBe(0)
    })

    it('sets an empty recordings list when there is nothing stored', async () => {
      vi.mocked(getRecordingsMetadata).mockResolvedValue([])

      await useRecorderStore.getState().loadRecordings()

      expect(useRecorderStore.getState().recordings).toEqual([])
    })
  })

  describe('refreshStorageSpace', () => {
    it('records that there is no room, so the Record button can say so before the click', async () => {
      vi.mocked(hasSpaceForRecording).mockResolvedValue(false)

      await useRecorderStore.getState().refreshStorageSpace()

      expect(useRecorderStore.getState().hasStorageSpace).toBe(false)
    })

    it('records that there is room', async () => {
      useRecorderStore.setState({ hasStorageSpace: false })
      vi.mocked(hasSpaceForRecording).mockResolvedValue(true)

      await useRecorderStore.getState().refreshStorageSpace()

      expect(useRecorderStore.getState().hasStorageSpace).toBe(true)
    })

    it('treats an estimate that threw as unknown rather than full', async () => {
      useRecorderStore.setState({ hasStorageSpace: false })
      vi.mocked(hasSpaceForRecording).mockRejectedValue(new Error('quota manager unavailable'))

      await useRecorderStore.getState().refreshStorageSpace()

      expect(useRecorderStore.getState().hasStorageSpace).toBe(true)
    })

    // ESCSUITE-14. Two encoders write two files, so the separate-tracks toggle
    // needs its own headroom answer — measured here, off the click path, beside
    // the one the record button reads.
    it('measures the headroom for two tracks as well as for one', async () => {
      vi.mocked(hasSpaceForRecording).mockImplementation(async (size: number) => size < 80 * 1024 * 1024)

      await useRecorderStore.getState().refreshStorageSpace()

      const { hasStorageSpace, hasSeparateTracksSpace } = useRecorderStore.getState()
      expect(hasStorageSpace).toBe(true)
      expect(hasSeparateTracksSpace).toBe(false)
      expect(hasSpaceForRecording).toHaveBeenCalledWith(50 * 1024 * 1024)
      expect(hasSpaceForRecording).toHaveBeenCalledWith(100 * 1024 * 1024)
    })

    it('treats an estimate that threw as room for both', async () => {
      vi.mocked(hasSpaceForRecording).mockRejectedValue(new Error('no estimate'))

      await useRecorderStore.getState().refreshStorageSpace()

      // Unknown is not full — the same direction this check errs in everywhere.
      expect(useRecorderStore.getState().hasStorageSpace).toBe(true)
      expect(useRecorderStore.getState().hasSeparateTracksSpace).toBe(true)
    })
  })
})
