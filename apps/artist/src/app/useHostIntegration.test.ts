// The host surface: the inbound postMessage cases, the startup URL
// parameters, and the cleanup the effect hands back.
//
// The integration channel, the media probe and IndexedDB storage are the App
// suite's recording doubles; the store and the shared theme module are real,
// because three of the cases read the store at call time on purpose and the
// theme cases assert what the module actually resolved to.
//
// Messages are driven straight through the handler the hook gave
// `initIntegration`, which is exactly what the host's `postMessage` reaches.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHostIntegration, type HostIntegrationDeps } from './useHostIntegration'
import { initIntegration, loadVideoFromUrl, sendMessage } from '../utils/integration'
import { processVideoFile, resolveStoredDuration } from '../core/videoProcessor'
import { getThumbnail, getVideo } from '../core/storage'
import { getTheme, setTheme } from '@escapesuite/shared/theme'
import { useEditorStore, DEFAULT_PROJECT_NAME } from '../store/projectStore'
import { addClip, resetStoreForTest, store } from '../test/fixtures/projectStore'
import { defaultUrlParams, sampleVideo } from '../test/appDoubles'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())
vi.mock('../utils/integration', async () => (await import('../test/appDoubles')).integrationDouble())
vi.mock('../core/videoProcessor', async () =>
  (await import('../test/appDoubles')).videoProcessorDouble()
)

/** The theme module's own default preference, and where each test leaves it. */
const THEME_MODULE_DEFAULT = 'dark' as const

let deps: HostIntegrationDeps

const mountIntegration = async (urlParams: Partial<ReturnType<typeof defaultUrlParams>> = {}) => {
  deps = { ...deps, urlParams: { ...defaultUrlParams(), ...urlParams } }
  const view = renderHook(() => useHostIntegration(deps))
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return view
}

/** Drive the handler the hook handed to initIntegration, the way the host would. */
const dispatch = async (message: { type: string; payload?: unknown }) => {
  const handler = vi.mocked(initIntegration).mock.calls[0][0]
  await act(async () => {
    await handler(message as never)
    await Promise.resolve()
  })
}

beforeEach(() => {
  resetStoreForTest()
  store().clearHistory()
  // Put the doubles back to their quiet defaults: vi.clearAllMocks() forgets
  // the calls but keeps whatever implementation the last test installed.
  vi.mocked(initIntegration).mockReturnValue(() => {})
  vi.mocked(loadVideoFromUrl).mockResolvedValue({ blob: new Blob(), name: 'test.mp4' })
  vi.mocked(processVideoFile).mockResolvedValue({ ...sampleVideo })
  vi.mocked(resolveStoredDuration).mockImplementation((_blob, metadata) =>
    Promise.resolve(metadata.duration)
  )
  vi.mocked(getVideo).mockResolvedValue(undefined)
  vi.mocked(getThumbnail).mockResolvedValue(undefined)
  deps = {
    urlParams: defaultUrlParams(),
    addSourceVideo: vi.fn(),
    setProject: vi.fn(),
    showNotification: vi.fn(),
  }
})

afterEach(async () => {
  await setTheme(THEME_MODULE_DEFAULT)
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('inbound messages', () => {
  it('LOAD_VIDEO fetches the url, probes it and reports it back', async () => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/clip.mp4' } })

    expect(loadVideoFromUrl).toHaveBeenCalledWith('https://host.example/clip.mp4')
    expect(processVideoFile).toHaveBeenCalledWith(expect.any(File))
    expect(deps.addSourceVideo).toHaveBeenCalledWith(expect.objectContaining({ id: sampleVideo.id }))
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'VIDEO_LOADED',
      payload: { id: sampleVideo.id, name: sampleVideo.name },
    })
  })

  it('LOAD_VIDEO reports a fetch it could not complete', async () => {
    vi.mocked(loadVideoFromUrl).mockRejectedValue(new Error('404'))
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/gone.mp4' } })

    expect(deps.addSourceVideo).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ERROR',
      payload: { message: 'Failed to load video', code: 'LOAD_ERROR' },
    })
  })

  it.each([
    ['no payload at all', undefined],
    ['a payload with no url', { name: 'clip.mp4' }],
  ])('LOAD_VIDEO ignores %s', async (_label, payload) => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload })

    expect(loadVideoFromUrl).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('LOAD_PROJECT replaces the project with whatever it was handed', async () => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_PROJECT', payload: { name: 'From Host' } })

    expect(deps.setProject).toHaveBeenCalledWith({ name: 'From Host' })
  })

  it('LOAD_PROJECT ignores an empty payload', async () => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_PROJECT' })

    expect(deps.setProject).not.toHaveBeenCalled()
  })

  it('GET_STATE answers with the store as it is now, not as it was at mount', async () => {
    await mountIntegration()
    // An edit after the handler was installed — the closed-over copy would miss it.
    addClip('clip-1', 0)

    await dispatch({ type: 'GET_STATE' })

    const state = useEditorStore.getState()
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'STATE',
      payload: { project: state.project, videos: state.sourceVideos },
    })
    expect(state.project.timeline.clips).toHaveLength(1)
  })

  it.each(['light', 'dark', 'system'] as const)('SET_THEME applies %s and confirms it', async (theme) => {
    await mountIntegration()

    await dispatch({ type: 'SET_THEME', payload: { theme } })

    expect(getTheme()).toBe(theme)
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'THEME_CHANGED',
      payload: { preference: theme, resolved: expect.stringMatching(/^(light|dark)$/) },
    })
  })

  it.each([
    ['an unknown theme name', { theme: 'sepia' }],
    ['a payload with no theme', { preference: 'light' }],
  ])('SET_THEME ignores %s', async (_label, payload) => {
    await mountIntegration()

    await dispatch({ type: 'SET_THEME', payload })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(getTheme()).toBe(THEME_MODULE_DEFAULT)
  })

  it('GET_THEME reports the current preference and what it resolved to', async () => {
    await mountIntegration()

    await dispatch({ type: 'GET_THEME' })

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'THEME_STATE',
      payload: { preference: THEME_MODULE_DEFAULT, resolved: 'dark' },
    })
  })

  it('a message with no case falls through silently', async () => {
    await mountIntegration()

    await dispatch({ type: 'EXPORT', payload: { format: 'mp4' } })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(deps.setProject).not.toHaveBeenCalled()
  })
})

describe('the ?video= parameter', () => {
  it('loads every url it was given', async () => {
    await mountIntegration({ videos: ['https://host.example/a.mp4'] })

    expect(loadVideoFromUrl).toHaveBeenCalledWith('https://host.example/a.mp4')
    expect(deps.addSourceVideo).toHaveBeenCalledWith(expect.objectContaining({ id: sampleVideo.id }))
  })

  it('logs a url it could not load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadVideoFromUrl).mockRejectedValue(new Error('404'))

    await mountIntegration({ videos: ['https://host.example/gone.mp4'] })

    expect(consoleError).toHaveBeenCalledWith('Failed to load video from URL:', expect.any(Error))
    expect(deps.addSourceVideo).not.toHaveBeenCalled()
  })
})

describe('the ?loadVideo= handoff from ESCAPECRAFT', () => {
  const recording = { metadata: { ...sampleVideo, id: 'rec-1', name: 'Recording.webm' } }

  it('adds the recording, with its thumbnail', async () => {
    vi.mocked(getVideo).mockResolvedValue(recording as never)
    vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)

    await mountIntegration({ loadVideoId: 'rec-1' })

    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rec-1', thumbnailUrl: 'blob:mock-url' })
    )
    expect(deps.showNotification).toHaveBeenCalledWith('Loaded recording: Recording.webm', 'success')
  })

  it('adds a recording that has no thumbnail', async () => {
    vi.mocked(getVideo).mockResolvedValue(recording as never)

    await mountIntegration({ loadVideoId: 'rec-1' })

    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rec-1', thumbnailUrl: undefined })
    )
  })

  // A CRAFT take whose WebM lost its Duration element is stored as Infinity —
  // CRAFT's own guard is `duration > 0`, which Infinity passes — so the handoff
  // has to recover the length rather than trust what it was handed.
  it('recovers the length of a recording stored with no usable duration', async () => {
    vi.mocked(getVideo).mockResolvedValue({
      blob: new Blob(['webm'], { type: 'video/webm' }),
      metadata: { ...recording.metadata, duration: Infinity },
    } as never)
    vi.mocked(resolveStoredDuration).mockResolvedValue(7)

    await mountIntegration({ loadVideoId: 'rec-1' })

    expect(resolveStoredDuration).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ id: 'rec-1', duration: Infinity })
    )
    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rec-1', duration: 7 })
    )
  })

  it('does not add a recording the library already holds', async () => {
    // resetStoreForTest leaves 'video1' in the library.
    vi.mocked(getVideo).mockResolvedValue({ metadata: { ...sampleVideo } } as never)

    await mountIntegration({ loadVideoId: sampleVideo.id })

    expect(deps.addSourceVideo).not.toHaveBeenCalled()
    expect(deps.showNotification).not.toHaveBeenCalled()
  })

  it('says so when the recording is not in storage', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await mountIntegration({ loadVideoId: 'missing' })

    expect(consoleError).toHaveBeenCalledWith('Video not found in IndexedDB:', 'missing')
    expect(deps.showNotification).toHaveBeenCalledWith('Recording not found', 'error')
  })

  it('says so when storage itself fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getVideo).mockRejectedValue(new Error('no database'))

    await mountIntegration({ loadVideoId: 'rec-1' })

    expect(consoleError).toHaveBeenCalledWith('Failed to load video from IndexedDB:', expect.any(Error))
    expect(deps.showNotification).toHaveBeenCalledWith('Failed to load recording', 'error')
  })
})

describe('the ?title= parameter', () => {
  it('names a project that has never been named, and leaves nothing to undo', async () => {
    // Something in the history, so an intact history is not the trivial case.
    addClip('clip-1', 0)
    expect(useEditorStore.getState().history.past.length).toBeGreaterThan(0)

    await mountIntegration({ title: 'Host Project' })

    expect(deps.setProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Host Project', modified: expect.any(Number) })
    )
    expect(useEditorStore.getState().history.past).toHaveLength(0)
  })

  it('leaves a project that already has a name alone', async () => {
    store().setProject({ ...useEditorStore.getState().project, name: 'Already Named' })
    addClip('clip-1', 0)

    await mountIntegration({ title: 'Host Project' })

    expect(deps.setProject).not.toHaveBeenCalled()
    expect(useEditorStore.getState().history.past.length).toBeGreaterThan(0)
  })

  it('the default name is the one it fills in over', async () => {
    expect(useEditorStore.getState().project.name).toBe(DEFAULT_PROJECT_NAME)

    await mountIntegration({ title: 'Host Project' })

    expect(deps.setProject).toHaveBeenCalled()
  })
})

describe('the effect\'s cleanup', () => {
  it('is the one initIntegration handed back', async () => {
    const cleanup = vi.fn()
    vi.mocked(initIntegration).mockReturnValue(cleanup)
    const { unmount } = await mountIntegration()

    expect(cleanup).not.toHaveBeenCalled()
    unmount()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('installs the handler exactly once, however often the caller re-renders', async () => {
    const { rerender } = await mountIntegration()

    rerender()
    rerender()

    expect(initIntegration).toHaveBeenCalledTimes(1)
  })
})
