// The host integration surface: inbound postMessage cases and the URL
// parameters App acts on at startup.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { store, resetStoreForTest } from './test/fixtures/projectStore'
import { renderApp } from './test/renderApp'
import { installCanvasDouble, uninstallCanvasDouble } from './test/doubles/canvas'
import { installMediaPlaybackStubs } from './test/doubles/media'
import { defaultUrlParams, sampleVideo } from './test/appDoubles'
import { initIntegration, loadVideoFromUrl, parseUrlParams, sendMessage } from './utils/integration'
import { processVideoFile } from './core/videoProcessor'
import { getThumbnail, getVideo } from './core/storage'
import { getTheme, setTheme } from '@escapesuite/shared/theme'

vi.mock('./core/storage', async () => (await import('./test/appDoubles')).storageDouble())
vi.mock('./core/projectManager', async () =>
  (await import('./test/appDoubles')).projectManagerDouble()
)
vi.mock('./utils/integration', async () => (await import('./test/appDoubles')).integrationDouble())
vi.mock('./core/videoProcessor', async () =>
  (await import('./test/appDoubles')).videoProcessorDouble()
)

// jsdom's <video> pause()/play()/load() only report "Not implemented" to the
// virtual console, and the preview player pauses on every clip change. Patch
// them for the whole file — including the unmount that testing-library's
// cleanup triggers, which is outside any afterEach this file could own.
installMediaPlaybackStubs()

/** Drive the handler App handed to initIntegration, the way the host would. */
async function dispatchToApp(message: { type: string; payload?: unknown }) {
  const handler = vi.mocked(initIntegration).mock.calls[0][0]
  await act(async () => {
    await handler(message as never)
    await Promise.resolve()
  })
}

/** The theme module's own default preference, and where each test leaves it. */
const THEME_MODULE_DEFAULT = 'dark' as const

const urlParams = (overrides: Partial<ReturnType<typeof defaultUrlParams>> = {}) => {
  vi.mocked(parseUrlParams).mockReturnValue({ ...defaultUrlParams(), ...overrides })
}

describe('App inbound messages', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
    urlParams()
  })

  afterEach(async () => {
    uninstallCanvasDouble()
    // The theme module is a singleton with state that outlives a render; put it
    // back to its own default so no test depends on the order it ran in.
    await setTheme(THEME_MODULE_DEFAULT)
    vi.clearAllMocks()
  })

  describe('LOAD_VIDEO', () => {
    it('fetches the video, adds it and tells the host', async () => {
      await renderApp()

      await dispatchToApp({ type: 'LOAD_VIDEO', payload: { url: 'https://host/clip.mp4' } })

      expect(loadVideoFromUrl).toHaveBeenCalledWith('https://host/clip.mp4')
      expect(processVideoFile).toHaveBeenCalledWith(expect.any(File))
      expect(store().sourceVideos.map((v) => v.id)).toContain(sampleVideo.id)
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'VIDEO_LOADED',
        payload: { id: sampleVideo.id, name: sampleVideo.name },
      })
    })

    it('reports a fetch that fails', async () => {
      vi.mocked(loadVideoFromUrl).mockRejectedValueOnce(new Error('404'))
      await renderApp()

      await dispatchToApp({ type: 'LOAD_VIDEO', payload: { url: 'https://host/gone.mp4' } })

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'ERROR',
        payload: { message: 'Failed to load video', code: 'LOAD_ERROR' },
      })
    })

    it('ignores a payload with no url in it', async () => {
      await renderApp()

      await dispatchToApp({ type: 'LOAD_VIDEO', payload: { name: 'clip.mp4' } })
      await dispatchToApp({ type: 'LOAD_VIDEO' })

      expect(loadVideoFromUrl).not.toHaveBeenCalled()
      expect(sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('LOAD_PROJECT', () => {
    it('replaces the project with the one the host sent', async () => {
      await renderApp()
      const hostProject = { ...store().project, name: 'From Host' }

      await dispatchToApp({ type: 'LOAD_PROJECT', payload: hostProject })

      expect(store().project.name).toBe('From Host')
    })

    it('ignores an empty payload', async () => {
      await renderApp()
      const before = store().project.name

      await dispatchToApp({ type: 'LOAD_PROJECT' })

      expect(store().project.name).toBe(before)
    })
  })

  describe('GET_STATE', () => {
    it('replies with the project and the videos', async () => {
      await renderApp()

      await dispatchToApp({ type: 'GET_STATE' })

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'STATE',
        payload: { project: store().project, videos: store().sourceVideos },
      })
    })
  })

  describe('themes', () => {
    /**
     * Render, and wait for the initTheme() App kicks off on mount to land.
     *
     * Nothing is asserted until it has: start from a preference initTheme is
     * bound to replace, so "the theme is the module default again" is proof the
     * mount-time load finished rather than something that was already true.
     */
    const renderWithSettledTheme = async () => {
      await setTheme('light')
      await renderApp()
      await waitFor(() => expect(getTheme()).toBe(THEME_MODULE_DEFAULT))
    }

    // 'system' resolves through matchMedia, which the shared test setup answers
    // with matches: false — i.e. a light system.
    it.each([
      ['light', 'light'],
      ['dark', 'dark'],
      ['system', 'light'],
    ] as const)('applies the %s theme and reports back', async (theme, resolved) => {
      await renderWithSettledTheme()

      await dispatchToApp({ type: 'SET_THEME', payload: { theme } })

      await waitFor(() => {
        expect(sendMessage).toHaveBeenCalledWith({
          type: 'THEME_CHANGED',
          payload: { preference: theme, resolved },
        })
      })
      expect(getTheme()).toBe(theme)
    })

    it('ignores a theme it does not know', async () => {
      await renderApp()

      await dispatchToApp({ type: 'SET_THEME', payload: { theme: 'neon' } })

      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('ignores a SET_THEME with no theme in it', async () => {
      await renderApp()

      await dispatchToApp({ type: 'SET_THEME', payload: {} })

      expect(sendMessage).not.toHaveBeenCalled()
    })

    it.each([
      ['dark', 'dark'],
      ['light', 'light'],
      ['system', 'light'],
    ] as const)('reports a %s preference on request', async (theme, resolved) => {
      await renderWithSettledTheme()
      await act(async () => {
        await setTheme(theme)
      })

      await dispatchToApp({ type: 'GET_THEME' })

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'THEME_STATE',
        payload: { preference: theme, resolved },
      })
    })
  })

  it('ignores a message type it has no case for', async () => {
    await renderApp()

    await dispatchToApp({ type: 'EXPORT', payload: { format: 'mp4' } })

    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('App URL parameters', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
    urlParams()
  })

  afterEach(() => {
    uninstallCanvasDouble()
    vi.clearAllMocks()
    urlParams()
  })

  it('loads every video the host listed', async () => {
    urlParams({ videos: ['https://host/a.mp4'] })

    await renderApp()

    await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toContain(sampleVideo.id))
    expect(loadVideoFromUrl).toHaveBeenCalledWith('https://host/a.mp4')
  })

  it('logs a listed video it cannot fetch', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadVideoFromUrl).mockRejectedValueOnce(new Error('offline'))
    urlParams({ videos: ['https://host/a.mp4'] })

    await renderApp()

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('Failed to load video from URL:', expect.any(Error))
    )
    consoleError.mockRestore()
  })

  describe('the ESCAPECRAFT handoff', () => {
    it('adds the recording named by loadVideo, thumbnail and all', async () => {
      vi.mocked(getVideo).mockResolvedValueOnce({
        blob: new Blob(),
        metadata: { ...sampleVideo, id: 'recording1', name: 'Screen recording' },
      })
      vi.mocked(getThumbnail).mockResolvedValueOnce(new Blob(['thumb'], { type: 'image/jpeg' }))
      urlParams({ loadVideoId: 'recording1' })

      await renderApp()

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Loaded recording: Screen recording')
      )
      expect(store().sourceVideos.find((v) => v.id === 'recording1')).toMatchObject({
        id: 'recording1',
        thumbnailUrl: 'blob:mock-url',
      })
    })

    it('adds a recording that has no thumbnail', async () => {
      vi.mocked(getVideo).mockResolvedValueOnce({
        blob: new Blob(),
        metadata: { ...sampleVideo, id: 'recording1' },
      })
      urlParams({ loadVideoId: 'recording1' })

      await renderApp()

      await waitFor(() =>
        expect(store().sourceVideos.some((v) => v.id === 'recording1')).toBe(true)
      )
      expect(store().sourceVideos.find((v) => v.id === 'recording1')!.thumbnailUrl).toBeUndefined()
    })

    it('says so when the recording is not in storage', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      urlParams({ loadVideoId: 'missing' })

      await renderApp()

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Recording not found')
      )
      expect(consoleError).toHaveBeenCalledWith('Video not found in IndexedDB:', 'missing')
      expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1'])
      consoleError.mockRestore()
    })

    it('says so when storage itself fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(getVideo).mockRejectedValueOnce(new Error('db closed'))
      urlParams({ loadVideoId: 'recording1' })

      await renderApp()

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Failed to load recording')
      )
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to load video from IndexedDB:',
        expect.any(Error)
      )
      consoleError.mockRestore()
    })

    it('does not add a recording that is already in the library', async () => {
      store().addSourceVideo({ ...sampleVideo, id: 'recording1' })
      vi.mocked(getVideo).mockResolvedValueOnce({
        blob: new Blob(),
        metadata: { ...sampleVideo, id: 'recording1' },
      })
      urlParams({ loadVideoId: 'recording1' })

      await renderApp()

      await act(async () => {
        await Promise.resolve()
      })
      expect(store().sourceVideos.filter((v) => v.id === 'recording1')).toHaveLength(1)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })
})
