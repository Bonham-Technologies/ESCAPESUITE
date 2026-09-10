import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  detectCapabilities,
  detectCapabilitiesSimple,
  requestScreenCapture,
  requestWebcam,
  requestMicrophone,
  stopStream,
  hasSystemAudio,
  getSupportedMimeType,
} from './permissions'

function withUserAgent(ua: string): () => void {
  const original = navigator.userAgent
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  return () => Object.defineProperty(navigator, 'userAgent', { value: original, configurable: true })
}

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

    it('locks down every capability outside a secure context', async () => {
      const originalIsSecureContext = window.isSecureContext
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
      try {
        const result = await detectCapabilities()

        expect(result.capabilities).toEqual({
          screenCapture: false,
          webcam: false,
          microphone: false,
          systemAudio: false,
          mediaRecorder: false,
        })
        expect(result.detailed.screenCapture.reason).toBe('not_secure_context')
        expect(result.detailed.webcam.reason).toBe('not_secure_context')
        expect(result.detailed.microphone.reason).toBe('not_secure_context')
        expect(result.detailed.systemAudio.reason).toBe('not_secure_context')
        expect(result.detailed.mediaRecorder.reason).toBe('not_secure_context')
      } finally {
        Object.defineProperty(window, 'isSecureContext', { value: originalIsSecureContext, configurable: true })
      }
    })

    it('marks mediaRecorder unavailable when the API does not exist', async () => {
      const OriginalMediaRecorder = globalThis.MediaRecorder
      vi.stubGlobal('MediaRecorder', undefined)
      try {
        const result = await detectCapabilities()
        expect(result.capabilities.mediaRecorder).toBe(false)
        expect(result.detailed.mediaRecorder.reason).toBe('api_not_supported')
      } finally {
        vi.stubGlobal('MediaRecorder', OriginalMediaRecorder)
      }
    })

    it('marks every capability unavailable when mediaDevices does not exist', async () => {
      const original = navigator.mediaDevices
      // @ts-expect-error - simulating a browser without the mediaDevices API
      navigator.mediaDevices = undefined
      try {
        const result = await detectCapabilities()
        expect(result.detailed.screenCapture.reason).toBe('api_not_supported')
        expect(result.detailed.webcam.reason).toBe('api_not_supported')
        expect(result.detailed.microphone.reason).toBe('api_not_supported')
      } finally {
        navigator.mediaDevices = original
      }
    })

    it('marks webcam/microphone unavailable when getUserMedia is missing', async () => {
      const original = navigator.mediaDevices
      navigator.mediaDevices = {
        getDisplayMedia: original.getDisplayMedia,
        enumerateDevices: original.enumerateDevices,
      } as unknown as MediaDevices
      try {
        const result = await detectCapabilities()
        expect(result.detailed.screenCapture.available).toBe(true)
        expect(result.detailed.webcam.reason).toBe('api_not_supported')
        expect(result.detailed.microphone.reason).toBe('api_not_supported')
      } finally {
        navigator.mediaDevices = original
      }
    })

    it('marks screen capture unavailable when getDisplayMedia is missing', async () => {
      const original = navigator.mediaDevices
      navigator.mediaDevices = {
        getUserMedia: original.getUserMedia,
        enumerateDevices: original.enumerateDevices,
      } as unknown as MediaDevices
      vi.mocked(original.enumerateDevices).mockResolvedValue([])
      try {
        const result = await detectCapabilities()
        expect(result.detailed.screenCapture.reason).toBe('api_not_supported')
      } finally {
        navigator.mediaDevices = original
      }
    })

    it('enables system audio in Chrome and Edge, but not Firefox/Safari/other browsers', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([])

      const restoreChrome = withUserAgent('mozilla/5.0 chrome/120.0 safari/537.36')
      const chromeResult = await detectCapabilities()
      restoreChrome()
      expect(chromeResult.capabilities.systemAudio).toBe(true)
      expect(chromeResult.detailed.systemAudio.available).toBe(true)

      const restoreEdge = withUserAgent('mozilla/5.0 chrome/120.0 edg/120.0')
      const edgeResult = await detectCapabilities()
      restoreEdge()
      expect(edgeResult.capabilities.systemAudio).toBe(true)

      const restoreFirefox = withUserAgent('mozilla/5.0 firefox/120.0')
      const firefoxResult = await detectCapabilities()
      restoreFirefox()
      expect(firefoxResult.capabilities.systemAudio).toBe(false)
      expect(firefoxResult.detailed.systemAudio.reason).toBe('browser_not_supported')
      expect(firefoxResult.detailed.systemAudio.message).toContain('Firefox')

      const restoreSafari = withUserAgent('mozilla/5.0 safari/537.36')
      const safariResult = await detectCapabilities()
      restoreSafari()
      expect(safariResult.capabilities.systemAudio).toBe(false)
      expect(safariResult.detailed.systemAudio.message).toContain('Safari')

      const restoreOther = withUserAgent('some-other-browser/1.0')
      const otherResult = await detectCapabilities()
      restoreOther()
      expect(otherResult.capabilities.systemAudio).toBe(false)
      expect(otherResult.detailed.systemAudio.reason).toBe('browser_not_supported')
    })

    it('marks camera/microphone denied when the Permissions API reports denied', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
        { kind: 'videoinput', deviceId: '1', groupId: '1', label: 'Cam', toJSON: () => ({}) },
        { kind: 'audioinput', deviceId: '2', groupId: '2', label: 'Mic', toJSON: () => ({}) },
      ] as MediaDeviceInfo[])
      const originalPermissions = navigator.permissions
      const query = vi.fn().mockResolvedValue({ state: 'denied' })
      Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true })

      try {
        const result = await detectCapabilities()
        expect(result.detailed.webcam.reason).toBe('permission_denied')
        expect(result.detailed.microphone.reason).toBe('permission_denied')
        expect(result.capabilities.webcam).toBe(false)
        expect(result.capabilities.microphone).toBe(false)
      } finally {
        Object.defineProperty(navigator, 'permissions', { value: originalPermissions, configurable: true })
      }
    })

    it('treats a granted permission with a present device as available', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
        { kind: 'videoinput', deviceId: '1', groupId: '1', label: 'Cam', toJSON: () => ({}) },
        { kind: 'audioinput', deviceId: '2', groupId: '2', label: 'Mic', toJSON: () => ({}) },
      ] as MediaDeviceInfo[])
      const originalPermissions = navigator.permissions
      const query = vi.fn().mockResolvedValue({ state: 'granted' })
      Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true })

      try {
        const result = await detectCapabilities()
        expect(result.detailed.webcam.available).toBe(true)
        expect(result.detailed.microphone.available).toBe(true)
        expect(query).toHaveBeenCalledWith({ name: 'camera' })
        expect(query).toHaveBeenCalledWith({ name: 'microphone' })
      } finally {
        Object.defineProperty(navigator, 'permissions', { value: originalPermissions, configurable: true })
      }
    })

    it('treats query() throwing as an unknown permission state (still checks devices)', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([])
      const originalPermissions = navigator.permissions
      const query = vi.fn().mockRejectedValue(new Error('not supported for this name'))
      Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true })

      try {
        const result = await detectCapabilities()
        // No devices found, so 'unknown' permission still falls through to no_device
        expect(result.detailed.webcam.reason).toBe('no_device')
        expect(result.detailed.microphone.reason).toBe('no_device')
      } finally {
        Object.defineProperty(navigator, 'permissions', { value: originalPermissions, configurable: true })
      }
    })

    it('treats a missing permissions.query as an unknown state', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
        { kind: 'videoinput', deviceId: '1', groupId: '1', label: 'Cam', toJSON: () => ({}) },
      ] as MediaDeviceInfo[])
      const originalPermissions = navigator.permissions
      Object.defineProperty(navigator, 'permissions', { value: {}, configurable: true })

      try {
        const result = await detectCapabilities()
        expect(result.detailed.webcam.available).toBe(true)
      } finally {
        Object.defineProperty(navigator, 'permissions', { value: originalPermissions, configurable: true })
      }
    })

    it('marks webcam/microphone policy_blocked when enumerateDevices throws NotAllowedError', async () => {
      const notAllowed = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockRejectedValue(notAllowed)

      const result = await detectCapabilities()
      expect(result.detailed.webcam.reason).toBe('policy_blocked')
      expect(result.detailed.microphone.reason).toBe('policy_blocked')
      expect(result.capabilities.webcam).toBe(false)
      expect(result.capabilities.microphone).toBe(false)
    })
  })

  describe('detectCapabilitiesSimple', () => {
    it('returns just the boolean capabilities', async () => {
      vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
        { kind: 'videoinput', deviceId: '1', groupId: '1', label: 'Cam', toJSON: () => ({}) },
        { kind: 'audioinput', deviceId: '2', groupId: '2', label: 'Mic', toJSON: () => ({}) },
      ] as MediaDeviceInfo[])

      const result = await detectCapabilitiesSimple()

      // Default test-environment userAgent doesn't match any known browser,
      // so systemAudio is deterministically false (see the browser-sniffing
      // test above for the chrome/edge/firefox/safari/other matrix).
      expect(result).toEqual({
        screenCapture: true,
        webcam: true,
        microphone: true,
        systemAudio: false,
        mediaRecorder: true,
      })
    })
  })

  describe('requestScreenCapture', () => {
    it('resolves with the captured stream and passes capture-friendly constraints', async () => {
      const stream = new MediaStream()
      vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(stream)

      const result = await requestScreenCapture(true)

      expect(result).toBe(stream)
      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: true,
          selfBrowserSurface: 'exclude',
          preferCurrentTab: false,
          monitorTypeSurfaces: 'include',
        })
      )
    })

    it('maps NotAllowedError to a permission-denied message', async () => {
      vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValue(
        Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      )

      await expect(requestScreenCapture(false)).rejects.toThrow('Screen capture permission denied')
    })

    it('maps NotFoundError to a no-screen-available message', async () => {
      vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValue(
        Object.assign(new Error('none'), { name: 'NotFoundError' })
      )

      await expect(requestScreenCapture(false)).rejects.toThrow('No screen available for capture')
    })

    it('rethrows other Error instances unchanged', async () => {
      const original = new Error('boom')
      vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValue(original)

      await expect(requestScreenCapture(false)).rejects.toBe(original)
    })

    it('rethrows non-Error rejections unchanged', async () => {
      vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValue('not-an-error')

      await expect(requestScreenCapture(false)).rejects.toBe('not-an-error')
    })
  })

  describe('requestWebcam', () => {
    it('resolves with the webcam stream', async () => {
      const stream = new MediaStream()
      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream)

      const result = await requestWebcam()

      expect(result).toBe(stream)
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({ audio: false })
      )
    })

    it('maps NotAllowedError to a permission-denied message', async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
        Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      )

      await expect(requestWebcam()).rejects.toThrow('Webcam permission denied')
    })

    it('maps NotFoundError to a no-webcam message', async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
        Object.assign(new Error('none'), { name: 'NotFoundError' })
      )

      await expect(requestWebcam()).rejects.toThrow('No webcam found')
    })

    it('rethrows other errors unchanged', async () => {
      const original = new Error('boom')
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(original)

      await expect(requestWebcam()).rejects.toBe(original)
    })

    it('rethrows non-Error rejections unchanged', async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue('not-an-error')

      await expect(requestWebcam()).rejects.toBe('not-an-error')
    })
  })

  describe('requestMicrophone', () => {
    it('resolves with the microphone stream', async () => {
      const stream = new MediaStream()
      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream)

      const result = await requestMicrophone()

      expect(result).toBe(stream)
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({ video: false })
      )
    })

    it('maps NotAllowedError to a permission-denied message', async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
        Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      )

      await expect(requestMicrophone()).rejects.toThrow('Microphone permission denied')
    })

    it('maps NotFoundError to a no-microphone message', async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
        Object.assign(new Error('none'), { name: 'NotFoundError' })
      )

      await expect(requestMicrophone()).rejects.toThrow('No microphone found')
    })

    it('rethrows other errors unchanged', async () => {
      const original = new Error('boom')
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(original)

      await expect(requestMicrophone()).rejects.toBe(original)
    })

    it('rethrows non-Error rejections unchanged', async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue('not-an-error')

      await expect(requestMicrophone()).rejects.toBe('not-an-error')
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
