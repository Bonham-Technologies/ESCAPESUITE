import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  detectCapabilities,
  stopStream,
  hasSystemAudio,
  getSupportedMimeType,
} from './permissions'

describe('permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('detectCapabilities', () => {
    it('should detect MediaRecorder availability', async () => {
      const result = await detectCapabilities()
      expect(result.capabilities.mediaRecorder).toBe(true)
      expect(result.detailed.mediaRecorder.available).toBe(true)
    })

    it('should detect screen capture availability', async () => {
      const result = await detectCapabilities()
      expect(result.capabilities.screenCapture).toBe(true)
      expect(result.detailed.screenCapture.available).toBe(true)
    })

    it('should detect webcam from enumerated devices', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
        { kind: 'videoinput', deviceId: '1', groupId: '1', label: 'Webcam', toJSON: () => ({}) },
      ] as MediaDeviceInfo[])

      const result = await detectCapabilities()
      expect(result.capabilities.webcam).toBe(true)
      expect(result.detailed.webcam.available).toBe(true)
    })

    it('should detect microphone from enumerated devices', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
        { kind: 'audioinput', deviceId: '1', groupId: '1', label: 'Mic', toJSON: () => ({}) },
      ] as MediaDeviceInfo[])

      const result = await detectCapabilities()
      expect(result.capabilities.microphone).toBe(true)
      expect(result.detailed.microphone.available).toBe(true)
    })

    it('should handle enumerateDevices failure gracefully', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockRejectedValue(
        new Error('Permission denied')
      )

      const result = await detectCapabilities()
      // Should assume capabilities exist on failure
      expect(result.capabilities.webcam).toBe(true)
      expect(result.capabilities.microphone).toBe(true)
    })

    it('should return detailed info with unavailability reasons', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([])

      const result = await detectCapabilities()
      // No devices found
      expect(result.detailed.webcam.available).toBe(false)
      expect(result.detailed.webcam.reason).toBe('no_device')
      expect(result.detailed.webcam.message).toBeDefined()
      expect(result.detailed.microphone.available).toBe(false)
      expect(result.detailed.microphone.reason).toBe('no_device')
    })
  })

  describe('stopStream', () => {
    it('should stop all tracks in a stream', () => {
      const stopMock = vi.fn()
      const mockTrack = { stop: stopMock, kind: 'video' } as unknown as MediaStreamTrack
      const stream = new MediaStream([mockTrack])
      vi.mocked(stream.getTracks).mockReturnValue([mockTrack])

      stopStream(stream)

      expect(stopMock).toHaveBeenCalled()
    })

    it('should handle null stream gracefully', () => {
      expect(() => stopStream(null)).not.toThrow()
    })
  })

  describe('hasSystemAudio', () => {
    it('should return true when stream has audio tracks', () => {
      const stream = new MediaStream()
      vi.mocked(stream.getAudioTracks).mockReturnValue([
        { id: 'audio-track', kind: 'audio' } as MediaStreamTrack,
      ])

      expect(hasSystemAudio(stream)).toBe(true)
    })

    it('should return false when stream has no audio tracks', () => {
      const stream = new MediaStream()
      vi.mocked(stream.getAudioTracks).mockReturnValue([])

      expect(hasSystemAudio(stream)).toBe(false)
    })
  })

  describe('getSupportedMimeType', () => {
    it('should return a supported MIME type', () => {
      const mimeType = getSupportedMimeType()
      expect(mimeType).toBeDefined()
      expect(typeof mimeType).toBe('string')
    })

    it('should prefer VP9 codec when supported', () => {
      vi.mocked(MediaRecorder.isTypeSupported).mockImplementation(
        (type) => type === 'video/webm;codecs=vp9,opus'
      )

      const mimeType = getSupportedMimeType()
      expect(mimeType).toBe('video/webm;codecs=vp9,opus')
    })

    it('should fall back to webm when no codecs supported', () => {
      vi.mocked(MediaRecorder.isTypeSupported).mockReturnValue(false)

      const mimeType = getSupportedMimeType()
      expect(mimeType).toBe('video/webm')
    })
  })
})
