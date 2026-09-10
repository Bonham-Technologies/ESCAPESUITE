import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initIntegration,
  sendMessage,
  parseUrlParams,
  __setHostOriginForTests,
  loadVideoFromUrl,
  decodeProjectData,
  encodeProjectData,
  generateShareUrl,
} from './integration'
import type { Project, IntegrationMessage } from '../store/types'

/**
 * Dispatch a `message` event as the browser would for a real cross-document
 * post: `source` names the window that sent it. jsdom leaves `source` null on a
 * hand-built MessageEvent, and the listener rejects those, so every inbound
 * message a test wants accepted has to be stamped like this.
 */
function dispatchMessage(
  data: unknown,
  { source, origin = '' }: { source?: unknown; origin?: string } = {}
): void {
  const event = new MessageEvent('message', { data, origin })
  Object.defineProperty(event, 'source', {
    value: source === undefined ? window.parent : source,
  })
  window.dispatchEvent(event)
}

describe('integration', () => {
  afterEach(() => {
    __setHostOriginForTests(null)
  })

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
      dispatchMessage({ type: 'LOAD_VIDEO', payload: { url: 'http://example.com/video.mp4' } })

      expect(handler).toHaveBeenCalledWith({
        type: 'LOAD_VIDEO',
        payload: { url: 'http://example.com/video.mp4' },
      })
    })

    it('ignores invalid messages', () => {
      const handler = vi.fn()
      initIntegration(handler)

      // Invalid message - no type
      dispatchMessage({ payload: 'test' })
      expect(handler).not.toHaveBeenCalled()

      // Invalid message - not an object
      dispatchMessage('string')
      expect(handler).not.toHaveBeenCalled()

      // Invalid message - null
      dispatchMessage(null)
      expect(handler).not.toHaveBeenCalled()
    })

    it('ignores messages from a window that is not the parent', () => {
      const handler = vi.fn()
      initIntegration(handler)

      dispatchMessage({ type: 'GET_STATE' }, { source: { postMessage: vi.fn() } })

      expect(handler).not.toHaveBeenCalled()
    })

    it('ignores messages from the parent at the wrong origin when hostOrigin is set', () => {
      __setHostOriginForTests('https://host.example')
      const handler = vi.fn()
      initIntegration(handler)

      dispatchMessage({ type: 'GET_STATE' }, { origin: 'https://evil.example' })

      expect(handler).not.toHaveBeenCalled()
    })

    it('accepts messages from the parent at the configured hostOrigin', () => {
      __setHostOriginForTests('https://host.example')
      const handler = vi.fn()
      initIntegration(handler)

      dispatchMessage({ type: 'GET_STATE' }, { origin: 'https://host.example' })

      expect(handler).toHaveBeenCalledWith({ type: 'GET_STATE', payload: undefined })
    })

    it('accepts messages from the parent at any origin when hostOrigin is unset', () => {
      const handler = vi.fn()
      initIntegration(handler)

      dispatchMessage({ type: 'GET_STATE' }, { origin: 'https://anywhere.example' })

      expect(handler).toHaveBeenCalledWith({ type: 'GET_STATE', payload: undefined })
    })
  })

  describe('sendMessage', () => {
    let originalParent: typeof window.parent
    let originalPostMessage: typeof window.postMessage

    beforeEach(() => {
      originalParent = window.parent
      originalPostMessage = window.postMessage
    })

    afterEach(() => {
      Object.defineProperty(window, 'parent', {
        value: originalParent,
        writable: true,
      })
      window.postMessage = originalPostMessage
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

    it('does not post to the parent when not embedded', () => {
      const postMessage = vi.fn()
      Object.defineProperty(window, 'parent', {
        value: window,
        writable: true,
      })
      window.postMessage = postMessage

      sendMessage({ type: 'READY' })

      expect(postMessage).not.toHaveBeenCalled()
    })

    it('posts to the configured hostOrigin instead of the wildcard', () => {
      const mockPostMessage = vi.fn()
      Object.defineProperty(window, 'parent', {
        value: { postMessage: mockPostMessage },
        writable: true,
      })
      __setHostOriginForTests('https://host.example')

      const message: IntegrationMessage = { type: 'READY' }
      sendMessage(message)

      expect(mockPostMessage).toHaveBeenCalledWith(message, 'https://host.example')
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
      expect(result.suppressRestore).toBe(false)
      expect(result.title).toBeNull()
      expect(result.hostOrigin).toBeNull()
    })

    it('parses a valid hostOrigin', () => {
      Object.defineProperty(window, 'location', {
        value: { search: `?hostOrigin=${encodeURIComponent('https://host.example')}` },
        writable: true,
      })

      expect(parseUrlParams().hostOrigin).toBe('https://host.example')
    })

    it('returns null for an invalid hostOrigin', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      Object.defineProperty(window, 'location', {
        value: { search: `?hostOrigin=${encodeURIComponent('https://host.example/app')}` },
        writable: true,
      })

      expect(parseUrlParams().hostOrigin).toBeNull()
      warn.mockRestore()
    })

    it('parses suppressRestore from 1 or true', () => {
      for (const value of ['1', 'true']) {
        Object.defineProperty(window, 'location', {
          value: { search: `?suppressRestore=${value}` },
          writable: true,
        })

        expect(parseUrlParams().suppressRestore).toBe(true)
      }
    })

    it('treats any other suppressRestore value as false', () => {
      for (const value of ['0', 'false', 'yes', '']) {
        Object.defineProperty(window, 'location', {
          value: { search: `?suppressRestore=${value}` },
          writable: true,
        })

        expect(parseUrlParams().suppressRestore).toBe(false)
      }
    })

    it('parses and trims the title param', () => {
      Object.defineProperty(window, 'location', {
        value: { search: `?title=${encodeURIComponent('  Client Demo  ')}` },
        writable: true,
      })

      expect(parseUrlParams().title).toBe('Client Demo')
    })

    it('caps the title at 120 characters', () => {
      const longTitle = 'a'.repeat(200)
      Object.defineProperty(window, 'location', {
        value: { search: `?title=${longTitle}` },
        writable: true,
      })

      const result = parseUrlParams()

      expect(result.title).toHaveLength(120)
      expect(result.title).toBe('a'.repeat(120))
    })

    it('does not leave the title ending in a space when the cut lands mid-word', () => {
      // 121 chars with a space at index 119, so the 120-char slice ends on it.
      const longTitle = `${'a'.repeat(119)} b`
      Object.defineProperty(window, 'location', {
        value: { search: `?title=${encodeURIComponent(longTitle)}` },
        writable: true,
      })

      expect(parseUrlParams().title).toBe('a'.repeat(119))
    })

    it('returns null for a blank title', () => {
      Object.defineProperty(window, 'location', {
        value: { search: `?title=${encodeURIComponent('   ')}` },
        writable: true,
      })

      expect(parseUrlParams().title).toBeNull()
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

    it('falls back to video.mp4 when the URL path has no filename', async () => {
      const mockBlob = new Blob(['video data'], { type: 'video/mp4' })

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: new Headers({ 'content-type': 'video/mp4' }),
        body: null,
      } as Response)

      const result = await loadVideoFromUrl('http://example.com/videos/')

      expect(result.name).toBe('video.mp4')
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
