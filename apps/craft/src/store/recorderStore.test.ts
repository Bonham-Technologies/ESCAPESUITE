import { describe, it, expect, beforeEach } from 'vitest'
import { useRecorderStore } from './recorderStore'
import { defaultConfig } from './types'

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
})
