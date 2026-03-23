import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initIntegration,
  sendMessage,
  parseUrlParams,
  loadVideoFromUrl,
  decodeProjectData,
  encodeProjectData,
  generateShareUrl,
} from './integration'
import type { Project, IntegrationMessage } from '../store/types'

describe('integration', () => {
  describe('initIntegration', () => {
    let originalParent: typeof window.parent

    beforeEach(() => {
      originalParent = window.parent
      // Mock window.parent to be different from window (simulating iframe)
      Object.defineProperty(window, 'parent', {
        value: {
          postMessage: vi.fn(),
        },
        writable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(window, 'parent', {
        value: originalParent,
        writable: true,
      })
    })

    it('sets up message listener and sends READY message', () => {
      const handler = vi.fn()

      initIntegration(handler)

      // Should have sent READY message
      expect(window.parent.postMessage).toHaveBeenCalledWith(
        { type: 'READY' },
        '*'
      )
    })

    it('returns cleanup function that removes listener', () => {
      const handler = vi.fn()
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      const cleanup = initIntegration(handler)
      cleanup()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function))
    })

    it('calls handler with valid messages', () => {
      const handler = vi.fn()
      initIntegration(handler)

      // Simulate receiving a message
      const event = new MessageEvent('message', {
        data: { type: 'LOAD_VIDEO', payload: { url: 'http://example.com/video.mp4' } },
      })
      window.dispatchEvent(event)

      expect(handler).toHaveBeenCalledWith({
        type: 'LOAD_VIDEO',
        payload: { url: 'http://example.com/video.mp4' },
      })
    })

    it('ignores invalid messages', () => {
      const handler = vi.fn()
      initIntegration(handler)

      // Invalid message - no type
      window.dispatchEvent(new MessageEvent('message', { data: { payload: 'test' } }))
      expect(handler).not.toHaveBeenCalled()

      // Invalid message - not an object
      window.dispatchEvent(new MessageEvent('message', { data: 'string' }))
      expect(handler).not.toHaveBeenCalled()

      // Invalid message - null
      window.dispatchEvent(new MessageEvent('message', { data: null }))
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('sendMessage', () => {
    let originalParent: typeof window.parent

    beforeEach(() => {
      originalParent = window.parent
    })

    afterEach(() => {
      Object.defineProperty(window, 'parent', {
        value: originalParent,
        writable: true,
      })
    })

    it('sends message to parent window when in iframe', () => {
      const mockPostMessage = vi.fn()
      Object.defineProperty(window, 'parent', {
        value: { postMessage: mockPostMessage },
        writable: true,
      })

      const message: IntegrationMessage = { type: 'READY' }
      sendMessage(message)

      expect(mockPostMessage).toHaveBeenCalledWith(message, '*')
    })

    it('dispatches custom event for same-window integration', () => {
      const mockParent = { postMessage: vi.fn() }
      Object.defineProperty(window, 'parent', {
        value: mockParent,
        writable: true,
      })

      const eventListener = vi.fn()
      window.addEventListener('videoeditor:message', eventListener)

      const message: IntegrationMessage = { type: 'READY' }
      sendMessage(message)

      expect(eventListener).toHaveBeenCalled()
      const event = eventListener.mock.calls[0][0] as CustomEvent
      expect(event.detail).toEqual(message)

      window.removeEventListener('videoeditor:message', eventListener)
    })
  })

  describe('parseUrlParams', () => {
    let originalLocation: Location

    beforeEach(() => {
      originalLocation = window.location
    })

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
      })
    })

    it('parses video URLs from query params', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?video=http://example.com/video1.mp4&video=http://example.com/video2.mp4' },
        writable: true,
      })

      const result = parseUrlParams()

      expect(result.videos).toEqual([
        'http://example.com/video1.mp4',
        'http://example.com/video2.mp4',
      ])
    })

    it('parses project data from query params', () => {
      const projectData = btoa(JSON.stringify({ id: 'test' }))
      Object.defineProperty(window, 'location', {
        value: { search: `?project=${projectData}` },
        writable: true,
      })

      const result = parseUrlParams()

      expect(result.projectData).toBe(projectData)
    })

    it('parses autoPlay flag', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?autoplay=true' },
        writable: true,
      })

      const result = parseUrlParams()

      expect(result.autoPlay).toBe(true)
    })

    it('returns defaults for empty params', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
      })

      const result = parseUrlParams()

      expect(result.videos).toEqual([])
      expect(result.projectData).toBeNull()
      expect(result.autoPlay).toBe(false)
    })
  })

  describe('loadVideoFromUrl', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('loads video from URL and returns blob with filename', async () => {
      const mockBlob = new Blob(['video data'], { type: 'video/mp4' })

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: new Headers({ 'content-type': 'video/mp4' }),
        body: null, // No streaming support in this test
      } as Response)

      const result = await loadVideoFromUrl('http://example.com/path/to/video.mp4')

      expect(result.blob).toBeInstanceOf(Blob)
      expect(result.name).toBe('video.mp4')
    })

    it('extracts filename from URL path', async () => {
      const mockBlob = new Blob(['video data'], { type: 'video/mp4' })

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: new Headers({ 'content-type': 'video/mp4' }),
        body: null,
      } as Response)

      const result = await loadVideoFromUrl('http://example.com/videos/my-video.mp4')

      expect(result.name).toBe('my-video.mp4')
    })

    it('throws error on failed fetch', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      } as Response)

      await expect(loadVideoFromUrl('http://example.com/video.mp4'))
        .rejects.toThrow('Failed to fetch video: Not Found')
    })

    it('tracks progress when streaming', async () => {
      const onProgress = vi.fn()
      const chunks = [
        new Uint8Array([1, 2, 3, 4, 5]),
        new Uint8Array([6, 7, 8, 9, 10]),
      ]

      let chunkIndex = 0
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const result = { done: false, value: chunks[chunkIndex] }
            chunkIndex++
            return Promise.resolve(result)
          }
          return Promise.resolve({ done: true })
        }),
      }

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '10', 'content-type': 'video/mp4' }),
        body: { getReader: () => mockReader },
      } as unknown as Response)

      await loadVideoFromUrl('http://example.com/video.mp4', onProgress)

      expect(onProgress).toHaveBeenCalled()
    })
  })

  describe('decodeProjectData', () => {
    it('decodes valid base64 project data', () => {
      const project = { id: 'test', name: 'Test Project' }
      const encoded = btoa(JSON.stringify(project))

      const result = decodeProjectData(encoded)

      expect(result).toEqual(project)
    })

    it('returns null for invalid base64', () => {
      const result = decodeProjectData('not-valid-base64!!!')

      expect(result).toBeNull()
    })

    it('returns null for invalid JSON', () => {
      const encoded = btoa('not valid json {{{')

      const result = decodeProjectData(encoded)

      expect(result).toBeNull()
    })
  })

  describe('encodeProjectData', () => {
    it('encodes project to base64 string', () => {
      const project: Project = {
        id: 'test',
        name: 'Test Project',
        created: 1234567890,
        modified: 1234567890,
        resolution: { width: 1280, height: 720 },
        timeline: {
          tracks: [],
          clips: [],
          textOverlays: [],
          shapeOverlays: [],
          duration: 0,
        },
      }

      const encoded = encodeProjectData(project)
      const decoded = JSON.parse(atob(encoded))

      expect(decoded.id).toBe('test')
      expect(decoded.name).toBe('Test Project')
    })

    it('produces reversible encoding', () => {
      const project: Project = {
        id: 'test',
        name: 'Test',
        created: Date.now(),
        modified: Date.now(),
        resolution: { width: 1280, height: 720 },
        timeline: {
          tracks: [],
          clips: [],
          textOverlays: [],
          shapeOverlays: [],
          duration: 0,
        },
      }

      const encoded = encodeProjectData(project)
      const decoded = decodeProjectData(encoded)

      expect(decoded).toEqual(project)
    })
  })

  describe('generateShareUrl', () => {
    it('generates URL with video parameters', () => {
      const project: Project = {
        id: 'test',
        name: 'Test',
        created: Date.now(),
        modified: Date.now(),
        resolution: { width: 1280, height: 720 },
        timeline: {
          tracks: [],
          clips: [],
          textOverlays: [],
          shapeOverlays: [],
          duration: 0,
        },
      }

      const url = generateShareUrl(
        'http://example.com/editor',
        project,
        ['http://example.com/video1.mp4', 'http://example.com/video2.mp4']
      )

      const parsed = new URL(url)

      expect(parsed.searchParams.getAll('video')).toEqual([
        'http://example.com/video1.mp4',
        'http://example.com/video2.mp4',
      ])
    })

    it('includes encoded project data', () => {
      const project: Project = {
        id: 'test',
        name: 'Test',
        created: Date.now(),
        modified: Date.now(),
        resolution: { width: 1280, height: 720 },
        timeline: {
          tracks: [],
          clips: [],
          textOverlays: [],
          shapeOverlays: [],
          duration: 0,
        },
      }

      const url = generateShareUrl('http://example.com/editor', project, [])

      const parsed = new URL(url)
      const projectParam = parsed.searchParams.get('project')

      expect(projectParam).toBeTruthy()
      expect(decodeProjectData(projectParam!)).toEqual(project)
    })
  })
})
