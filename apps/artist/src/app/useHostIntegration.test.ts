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
import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useHostIntegration, type HostIntegrationDeps } from './useHostIntegration'
import { initIntegration, loadVideoFromUrl, sendMessage } from '../utils/integration'
import { processMediaFile, resolveStoredDuration } from '../core/videoProcessor'
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage'
import { getTheme, setTheme } from '@escapesuite/shared/theme'
import { useEditorStore, DEFAULT_PROJECT_NAME } from '../store/projectStore'
import { addClip, resetStoreForTest, store } from '../test/fixtures/projectStore'
import { defaultUrlParams, sampleVideo } from '../test/appDoubles'
import { lastObjectUrl, OBJECT_URL_PATTERN } from '../test/objectUrls'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())
vi.mock('../utils/integration', async () => (await import('../test/appDoubles')).integrationDouble())
vi.mock('../core/videoProcessor', async () =>
  (await import('../test/appDoubles')).videoProcessorDouble()
)

/** The theme module's own default preference, and where each test leaves it. */
const THEME_MODULE_DEFAULT = 'dark' as const

let deps: HostIntegrationDeps

const mountIntegration = async (
  urlParams: Partial<ReturnType<typeof defaultUrlParams>> = {},
  overrides: Partial<HostIntegrationDeps> = {}
) => {
  deps = { ...deps, ...overrides, urlParams: { ...defaultUrlParams(), ...urlParams } }
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
  vi.mocked(processMediaFile).mockResolvedValue({ ...sampleVideo })
  vi.mocked(resolveStoredDuration).mockImplementation((_blob, metadata) =>
    Promise.resolve(metadata.duration)
  )
  vi.mocked(getVideo).mockResolvedValue(undefined)
  vi.mocked(getAllVideoMetadata).mockResolvedValue([])
  vi.mocked(getThumbnail).mockResolvedValue(undefined)
  deps = {
    urlParams: defaultUrlParams(),
    addSourceVideo: vi.fn(),
    setProject: vi.fn(),
    showNotification: vi.fn(),
    // The settled case: the question is answered, so the take is placed the
    // moment the import lands, exactly as it always was.
    sessionDecisionPending: false,
  }
})

afterEach(async () => {
  await setTheme(THEME_MODULE_DEFAULT)
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const micOnlyWebm = {
  ...sampleVideo,
  id: 'mic-only',
  name: 'take.webm',
  width: 0,
  height: 0,
  mimeType: 'video/webm',
  mediaType: 'audio' as const,
}

describe('inbound messages', () => {
  it('LOAD_VIDEO fetches the url, probes it and reports it back', async () => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/clip.mp4' } })

    expect(loadVideoFromUrl).toHaveBeenCalledWith('https://host.example/clip.mp4')
    expect(processMediaFile).toHaveBeenCalledWith(expect.any(File))
    expect(deps.addSourceVideo).toHaveBeenCalledWith(expect.objectContaining({ id: sampleVideo.id }))
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'VIDEO_LOADED',
      payload: { id: sampleVideo.id, name: sampleVideo.name },
    })
  })

  it('LOAD_VIDEO lands a video/webm that decodes no picture as audio (ESCSUITE-255)', async () => {
    vi.mocked(loadVideoFromUrl).mockResolvedValue({
      blob: new Blob(['x'], { type: 'video/webm' }),
      name: 'take.webm',
    })
    vi.mocked(processMediaFile).mockResolvedValue(micOnlyWebm)
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/take.webm' } })

    expect(processMediaFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'video/webm' }))
    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mic-only', mediaType: 'audio', width: 0, height: 0 })
    )
  })

  it('LOAD_VIDEO reports a fetch it could not complete, in its own words (ESCSUITE-130)', async () => {
    const refusal =
      'Could not load the video from https://host.example: this deployment does not allow ' +
      'loading from other origins (Content-Security-Policy), or the server refused the request.'
    vi.mocked(loadVideoFromUrl).mockRejectedValue(new Error(refusal))
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/gone.mp4' } })

    expect(deps.addSourceVideo).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ERROR',
      payload: { message: refusal, code: 'LOAD_ERROR' },
    })
    expect(deps.showNotification).toHaveBeenCalledWith(refusal, 'error')
  })

  it('LOAD_VIDEO falls back to a generic message for a rejection with none (ESCSUITE-130)', async () => {
    vi.mocked(loadVideoFromUrl).mockRejectedValue('boom')
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/gone.mp4' } })

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ERROR',
      payload: { message: 'Failed to load video', code: 'LOAD_ERROR' },
    })
    expect(deps.showNotification).toHaveBeenCalledWith('Failed to load video', 'error')
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

  it('LOAD_PROJECT replaces the project with whatever well-formed project it was handed', async () => {
    await mountIntegration()
    const hostProject = { ...useEditorStore.getState().project, name: 'From Host' }

    await dispatch({ type: 'LOAD_PROJECT', payload: hostProject })

    expect(deps.setProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'From Host' }))
  })

  it('LOAD_PROJECT ignores an empty payload', async () => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_PROJECT' })

    expect(deps.setProject).not.toHaveBeenCalled()
  })

  it('LOAD_PROJECT answers a malformed payload with ERROR instead of applying it (ESCSUITE-102)', async () => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_PROJECT', payload: { timeline: {} } })

    expect(deps.setProject).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ERROR',
      payload: { message: expect.any(String), code: 'INVALID_PROJECT' },
    })
  })

  it('LOAD_PROJECT answers a payload whose clip has an invalid crop with ERROR instead of applying it (ESCSUITE-6)', async () => {
    await mountIntegration()
    addClip('clip-1', 0)
    const hostProject = useEditorStore.getState().project
    const badProject = {
      ...hostProject,
      timeline: {
        ...hostProject.timeline,
        clips: hostProject.timeline.clips.map((clip) => ({
          ...clip,
          crop: { left: 0.6, top: 0, right: 0.6, bottom: 0 },
        })),
      },
    }

    await dispatch({ type: 'LOAD_PROJECT', payload: badProject })

    expect(deps.setProject).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ERROR',
      payload: { message: expect.any(String), code: 'INVALID_PROJECT' },
    })
  })

  it('LOAD_PROJECT carries a clip crop into the store intact (ESCSUITE-6)', async () => {
    await mountIntegration()
    addClip('clip-1', 0)
    const hostProject = useEditorStore.getState().project
    const crop = { left: 0.25, top: 0.1, right: 0, bottom: 0 }
    const goodProject = {
      ...hostProject,
      timeline: {
        ...hostProject.timeline,
        clips: hostProject.timeline.clips.map((clip) => ({ ...clip, crop })),
      },
    }

    await dispatch({ type: 'LOAD_PROJECT', payload: goodProject })

    expect(deps.setProject).toHaveBeenCalledWith(
      expect.objectContaining({
        timeline: expect.objectContaining({
          clips: expect.arrayContaining([expect.objectContaining({ crop })]),
        }),
      })
    )
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

  it('LOAD_VIDEO adds to the library and places nothing', async () => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/clip.mp4' } })

    // A fetched URL is not a take handoff: it addresses no stored take, and a
    // host that loads one today must not find its timeline written to.
    expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
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

  it('lands a video/webm that decodes no picture as audio (ESCSUITE-255)', async () => {
    vi.mocked(loadVideoFromUrl).mockResolvedValue({
      blob: new Blob(['x'], { type: 'video/webm' }),
      name: 'take.webm',
    })
    vi.mocked(processMediaFile).mockResolvedValue(micOnlyWebm)

    await mountIntegration({ videos: ['https://host.example/take.webm'] })

    expect(processMediaFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'video/webm' }))
    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mic-only', mediaType: 'audio' })
    )
  })

  it('adds to the library and places nothing', async () => {
    await mountIntegration({ videos: ['https://host.example/a.mp4'] })

    expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
  })

  it('logs a url it could not load, and tells the user why (ESCSUITE-130)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const refusal =
      'Could not load the video from https://host.example: this deployment does not allow ' +
      'loading from other origins (Content-Security-Policy), or the server refused the request.'
    vi.mocked(loadVideoFromUrl).mockRejectedValue(new Error(refusal))

    await mountIntegration({ videos: ['https://host.example/gone.mp4'] })

    expect(consoleError).toHaveBeenCalledWith('Failed to load video from URL:', expect.any(Error))
    expect(deps.addSourceVideo).not.toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith(refusal, 'error')
  })

  it('falls back to a generic notification for a rejection with no message (ESCSUITE-130)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadVideoFromUrl).mockRejectedValue('boom')

    await mountIntegration({ videos: ['https://host.example/gone.mp4'] })

    expect(deps.showNotification).toHaveBeenCalledWith('Failed to load video', 'error')
  })
})

describe('the ?loadVideo= handoff from ESCAPECRAFT', () => {
  const recording = { metadata: { ...sampleVideo, id: 'rec-1', name: 'Recording.webm' } }

  it('adds the recording, with its thumbnail', async () => {
    vi.mocked(getVideo).mockResolvedValue(recording as never)
    vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)

    await mountIntegration({ loadVideoId: 'rec-1' })

    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rec-1', thumbnailUrl: lastObjectUrl() })
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

  // The sibling above pins that the library is left alone; this pins the half
  // that matters more since ESCSUITE-14 — the early return also stops a second
  // copy of the take appearing on the timeline.
  it('places nothing for a recording the library already holds', async () => {
    vi.mocked(getVideo).mockResolvedValue({ metadata: { ...sampleVideo } } as never)

    await mountIntegration({ loadVideoId: sampleVideo.id })

    expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
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

  it('puts a single-file take on the timeline as well as in the library', async () => {
    vi.mocked(getVideo).mockResolvedValue(recording as never)

    await mountIntegration({ loadVideoId: 'rec-1' })

    // ESCSUITE-14 decision 7: the handoff places clips for *every* take, not
    // only one recorded as separate tracks. This is the behaviour change.
    const clips = useEditorStore.getState().project.timeline.clips
    expect(clips).toHaveLength(1)
    expect(clips[0].sourceVideoId).toBe('rec-1')
    expect(clips[0].timelinePosition).toBe(0)
    expect(deps.showNotification).toHaveBeenCalledWith('Loaded recording: Recording.webm', 'success')
  })

  describe('a take recorded as separate tracks', () => {
    const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

    const primary = {
      ...sampleVideo,
      id: 'take-1',
      name: 'Screen recording',
      duration: 6,
      width: 1920,
      height: 1080,
      takeId: 'take-1',
      role: 'screen' as const,
      startOffset: 0,
      overlayPlacement: PLACEMENT,
    }
    const webcam = {
      ...sampleVideo,
      id: 'take-1-webcam',
      name: 'Screen recording — webcam',
      duration: 6,
      width: 1280,
      height: 720,
      takeId: 'take-1',
      role: 'webcam' as const,
      startOffset: 0.5,
    }

    /** Both parts in storage, the way a separate-tracks take is stored. */
    const seedTake = (parts = [primary, webcam]) => {
      vi.mocked(getAllVideoMetadata).mockResolvedValue(parts)
      vi.mocked(getVideo).mockImplementation((id) =>
        Promise.resolve(
          parts.some((part) => part.id === id)
            ? { blob: new Blob(['bytes'], { type: 'video/webm' }), metadata: parts.find((p) => p.id === id)! }
            : undefined
        ) as never
      )
    }

    it('adds both parts and places them on two tracks, one above the other', async () => {
      seedTake()

      await mountIntegration({ loadVideoId: 'take-1' })

      expect(deps.addSourceVideo).toHaveBeenCalledTimes(2)
      const { clips, tracks } = useEditorStore.getState().project.timeline
      expect(clips.map((c) => c.sourceVideoId)).toEqual(['take-1', 'take-1-webcam'])
      expect(clips[1].timelinePosition).toBe(0.5)
      const trackIndex = (id: string) => tracks.find((t) => t.id === id)!.index
      expect(trackIndex(clips[1].trackId)).toBeGreaterThan(trackIndex(clips[0].trackId))
      expect(deps.showNotification).toHaveBeenCalledWith(
        'Loaded recording: Screen recording (2 tracks)',
        'success'
      )
    })

    it('seeds the webcam clip transform from the placement the take was recorded at', async () => {
      seedTake()

      await mountIntegration({ loadVideoId: 'take-1' })

      const webcamClip = useEditorStore.getState().project.timeline.clips[1]
      // 1920 x 0.2 = 384 wide at a 30px inset, centred at 1698/1920 across and
      // (1080 - 30 - 108)/1080 down — the corner the compositor drew in.
      expect(webcamClip.transform.x).toBeCloseTo(1698 / 1920, 10)
      expect(webcamClip.transform.y).toBeCloseTo(942 / 1080, 10)
      expect(webcamClip.transform.scaleX).toBeCloseTo(0.3, 10)
    })

    it('is one undo step, and undo leaves both parts in the library', async () => {
      seedTake()

      await mountIntegration({ loadVideoId: 'take-1' })
      const pastBefore = useEditorStore.getState().history.past.length

      act(() => useEditorStore.getState().undo())

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
      expect(useEditorStore.getState().history.past).toHaveLength(pastBefore - 1)
    })

    // The take is skipped whole when ANY of its parts is already held, not only
    // when the primary is: the user can delete the primary from the library and
    // then re-send the take from ESCAPECRAFT, which leaves the companion behind
    // to be found. Adding it again would be idempotent by id, but *placing* it
    // again is not — a second webcam clip would arrive on a second new track.
    it('skips the whole take when only its companion is already in the library', async () => {
      seedTake()
      act(() => useEditorStore.getState().addSourceVideo(webcam))

      await mountIntegration({ loadVideoId: 'take-1' })

      expect(deps.addSourceVideo).not.toHaveBeenCalled()
      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
      expect(deps.showNotification).not.toHaveBeenCalled()
    })

    it('says a part was skipped when its blob is gone, and still places the rest', async () => {
      vi.mocked(getAllVideoMetadata).mockResolvedValue([primary, webcam])
      vi.mocked(getVideo).mockImplementation((id) =>
        Promise.resolve(
          id === 'take-1'
            ? { blob: new Blob(['bytes'], { type: 'video/webm' }), metadata: primary }
            : undefined
        ) as never
      )

      await mountIntegration({ loadVideoId: 'take-1' })

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(1)
      expect(deps.showNotification).toHaveBeenCalledWith(
        'Loaded recording: Screen recording — 1 missing part skipped',
        'info'
      )
    })

    // ESCSUITE-117: the handoff used to keep its own list of the thumbnails it
    // made and revoke them in the effect's cleanup. Every one of them had
    // already been handed to `addSourceVideo`, so the cleanup was freeing
    // handles the media library was showing. Since ESCSUITE-113 the store owns
    // every `SourceVideo.thumbnailUrl` — `removeSourceVideosPermanently`,
    // `resetProject` and `addSourceVideo`'s replace-in-place branch free them —
    // so the handoff keeps no owner of its own.
    it('leaves the thumbnails it made to the library when the editor goes away', async () => {
      seedTake()
      vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)

      const { unmount } = await mountIntegration({ loadVideoId: 'take-1' })
      const handed = vi.mocked(deps.addSourceVideo).mock.calls.map(([v]) => v.thumbnailUrl)
      expect(handed).toEqual([
        expect.stringMatching(OBJECT_URL_PATTERN),
        expect.stringMatching(OBJECT_URL_PATTERN),
      ])

      unmount()

      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    // StrictMode mounts the effect, tears it down and mounts it again, so two
    // imports are in flight at once. The library guard cannot separate them —
    // the first run is still awaiting storage when the second one checks — so
    // the run whose effect was cleaned up has to bail on its own.
    it('places the take once under StrictMode, which runs the effect twice', async () => {
      seedTake()
      deps = { ...deps, urlParams: { ...defaultUrlParams(), loadVideoId: 'take-1' } }

      renderHook(() => useHostIntegration(deps), { wrapper: StrictMode })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      const clips = useEditorStore.getState().project.timeline.clips
      expect(clips.map((c) => c.sourceVideoId)).toEqual(['take-1', 'take-1-webcam'])
      expect(deps.showNotification).toHaveBeenCalledTimes(1)
    })

    it('places nothing, and leaves its thumbnails to the library, when the editor leaves mid-import', async () => {
      vi.mocked(getAllVideoMetadata).mockResolvedValue([primary, webcam])
      vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)
      let releaseCompanion: () => void = () => {}
      const companionArrives = new Promise<void>((resolve) => {
        releaseCompanion = resolve
      })
      vi.mocked(getVideo).mockImplementation((id) =>
        (id === 'take-1'
          ? Promise.resolve({ blob: new Blob(['bytes'], { type: 'video/webm' }), metadata: primary })
          : // The companion's read is still in flight when the editor goes away.
            companionArrives.then(() => ({
              blob: new Blob(['bytes'], { type: 'video/webm' }),
              metadata: webcam,
            }))) as never
      )

      const { unmount } = await mountIntegration({ loadVideoId: 'take-1' })
      unmount()
      await act(async () => {
        releaseCompanion()
        await Promise.resolve()
      })

      // A take that finished arriving after the editor left is not placed into
      // a project the user has moved on from, and says nothing about it either.
      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
      expect(deps.showNotification).not.toHaveBeenCalled()
      // The parts ARE in the library by then — `importTake` added them before
      // this run learned it had been replaced — so their thumbnails are the
      // library's to free, not this run's (ESCSUITE-117). Revoking them here is
      // what left the tiles dead under StrictMode's double mount.
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
      const handed = vi.mocked(deps.addSourceVideo).mock.calls.map(([v]) => v.thumbnailUrl)
      expect(handed).toHaveLength(2)
      for (const url of handed) expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url)
    })

    // The development case the revoke actually broke: StrictMode mounts the
    // effect, cleans it up and mounts it again. The first run fills the library,
    // the second finds the take already there and mints nothing — so once the
    // first run's cleanup had revoked its URLs, nothing was left pointing at a
    // live handle and every tile of the take went blank.
    it('leaves the library\'s thumbnails live across a remount that imports nothing', async () => {
      seedTake()
      vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)
      // The REAL store's addSourceVideo, not the vi.fn() the cases above use:
      // the second run's "already in the library?" answer is what this is about.
      const intoStore = (video: Parameters<typeof deps.addSourceVideo>[0]) =>
        store().addSourceVideo(video)

      const first = await mountIntegration({ loadVideoId: 'take-1' }, { addSourceVideo: intoStore })
      const live = store().sourceVideos.filter((v) => v.id.startsWith('take-1')).map((v) => v.thumbnailUrl)
      expect(live).toEqual([
        expect.stringMatching(OBJECT_URL_PATTERN),
        expect.stringMatching(OBJECT_URL_PATTERN),
      ])

      first.unmount()
      await mountIntegration({ loadVideoId: 'take-1' }, { addSourceVideo: intoStore })

      // The second run imported nothing, so these are still the only handles
      // the library has — and they still work.
      expect(store().sourceVideos.filter((v) => v.id.startsWith('take-1')).map((v) => v.thumbnailUrl))
        .toEqual(live)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    // The case above unmounts only once the first import has landed, so the two
    // runs never overlap. This is the overlapping one — the shape StrictMode
    // actually produces: the first run is still awaiting storage when the second
    // starts, so the library guard cannot separate them and BOTH imports write.
    // The invariant is not "nothing is revoked" (the loser's handles are freed,
    // correctly, by `addSourceVideo`'s replace-in-place) but that every handle
    // the library is left holding still works — and the take is placed once.
    it('leaves the library\'s thumbnails live when two imports are in flight at once', async () => {
      vi.mocked(getAllVideoMetadata).mockResolvedValue([primary, webcam])
      vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)
      let releaseCompanion: () => void = () => {}
      const companionArrives = new Promise<void>((resolve) => { releaseCompanion = resolve })
      vi.mocked(getVideo).mockImplementation((id) =>
        (id === 'take-1'
          ? Promise.resolve({ blob: new Blob(['bytes'], { type: 'video/webm' }), metadata: primary })
          : // Both runs park here, so neither has written when the other starts.
            companionArrives.then(() => ({
              blob: new Blob(['bytes'], { type: 'video/webm' }),
              metadata: webcam,
            }))) as never
      )
      const intoStore = (video: Parameters<typeof deps.addSourceVideo>[0]) =>
        store().addSourceVideo(video)

      const first = await mountIntegration({ loadVideoId: 'take-1' }, { addSourceVideo: intoStore })
      expect(store().sourceVideos.filter((v) => v.id.startsWith('take-1'))).toHaveLength(0)
      first.unmount()
      await mountIntegration({ loadVideoId: 'take-1' }, { addSourceVideo: intoStore })
      await act(async () => {
        releaseCompanion()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      const live = store().sourceVideos
        .filter((v) => v.id.startsWith('take-1'))
        .map((v) => v.thumbnailUrl)
      expect(live).toEqual([
        expect.stringMatching(OBJECT_URL_PATTERN),
        expect.stringMatching(OBJECT_URL_PATTERN),
      ])
      // Both runs really did import: four handles minted, not two. (A run that
      // stood down early, or a library guard that separated them, would mint 2.)
      const handles = vi.mocked(URL.createObjectURL).mock.results.map((r) => r.value as string)
      expect(handles).toHaveLength(4)
      const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)
      // Every handle minted is exactly one of the two: kept by the library and
      // live, or replaced and freed. No leak, and nothing on screen pointing at
      // a dead handle. (Counted per URL rather than as a total, because the
      // beforeEach's own resetStoreForTest revokes the previous test's library.)
      for (const url of handles) {
        expect(live.includes(url)).toBe(!revoked.includes(url))
      }
      // Placed by whoever is still mounted, and only once.
      expect(useEditorStore.getState().project.timeline.clips.map((c) => c.sourceVideoId))
        .toEqual(['take-1', 'take-1-webcam'])
      expect(deps.showNotification).toHaveBeenCalledTimes(1)
    })

    // "Resume Previous Session?" replaces the project and then clears the
    // history (`app/useSessionRestore.ts`), and ESCAPECRAFT's standalone
    // "Send to Editor" opens /artist/?loadVideo=<id> with no ?suppressRestore=1
    // — so a take placed before the prompt is answered is discarded by
    // "Restore" with no undo step back to it. The take therefore waits: it
    // joins the library straight away (nothing about the library is at risk)
    // and goes on the timeline once the prompt is gone, whichever way it was
    // answered.
    describe('and a "Resume Previous Session?" prompt in front of it', () => {
      /** Mount with the prompt already up, the way a saved session leaves it. */
      const mountBehindPrompt = async () => {
        deps = { ...deps, urlParams: { ...defaultUrlParams(), loadVideoId: 'take-1' } }
        const view = renderHook(
          ({ sessionDecisionPending }: { sessionDecisionPending: boolean }) =>
            useHostIntegration({ ...deps, sessionDecisionPending }),
          { initialProps: { sessionDecisionPending: true } }
        )
        await act(async () => {
          await Promise.resolve()
          await Promise.resolve()
        })
        return view
      }

      /** Answer the prompt — the only thing the hook sees either way. */
      const closePrompt = async (view: { rerender: (p: { sessionDecisionPending: boolean }) => void }) => {
        await act(async () => {
          view.rerender({ sessionDecisionPending: false })
          await Promise.resolve()
        })
      }

      it('holds the take back while the prompt is up, and places it once it closes', async () => {
        seedTake()

        const view = await mountBehindPrompt()

        // The library is safe either way — restoring re-adds its own source
        // videos and addSourceVideo is idempotent by id — so the parts go in
        // now. The timeline is what "Restore" would overwrite.
        expect(deps.addSourceVideo).toHaveBeenCalledTimes(2)
        expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
        // And the toast waits with it: telling the user "Loaded recording"
        // before anything is on the timeline is the same lie the placement
        // would have been.
        expect(deps.showNotification).not.toHaveBeenCalled()

        await closePrompt(view)

        const clips = useEditorStore.getState().project.timeline.clips
        expect(clips.map((c) => c.sourceVideoId)).toEqual(['take-1', 'take-1-webcam'])
        expect(deps.showNotification).toHaveBeenCalledTimes(1)
        expect(deps.showNotification).toHaveBeenCalledWith(
          'Loaded recording: Screen recording (2 tracks)',
          'success'
        )
      })

      it('appends the take after a restored session instead of losing it', async () => {
        seedTake()

        const view = await mountBehindPrompt()

        // What "Restore" does: replace the project, then clear the history so
        // there is nothing to undo back past. Placing before this ran is what
        // silently discarded the take.
        act(() => {
          addClip('restored', 0, 4)
          useEditorStore.getState().clearHistory()
        })

        await closePrompt(view)

        const clips = useEditorStore.getState().project.timeline.clips
        expect(clips.map((c) => c.name)).toEqual([
          'restored',
          'Screen recording',
          'Screen recording — webcam',
        ])
        // The append-at-end rule puts it after the restored work rather than on
        // top of it, and the restore's clearHistory ran first, so the one undo
        // step the take records still undoes it.
        expect(clips[1].timelinePosition).toBe(4)
        expect(useEditorStore.getState().history.past).toHaveLength(1)
      })

      // The library check runs when the import lands, which on this path is
      // *before* "Restore" fills the library — so a session that already holds
      // the take gets past it, and only a second check, at placement time and
      // against the restored *timeline*, can stop the take arriving twice. The
      // library cannot answer by then: the restore has re-added every part it
      // holds, so an id lookup can no longer separate "the session had this
      // take" from "the import just added it". Its clips can.
      it('drops the take when the session restored already has it on the timeline', async () => {
        seedTake()
        vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)

        const view = await mountBehindPrompt()
        // Got past the early guard, as it must: the library was empty when the
        // import read it.
        expect(deps.addSourceVideo).toHaveBeenCalledTimes(2)

        // What "Restore" does, for a session whose timeline already holds this
        // take: the project comes back with the take's own clips on it.
        act(() => {
          store().addClipToTimeline(
            {
              id: 'restored-screen',
              sourceVideoId: 'take-1',
              name: 'Screen recording',
              startTime: 0,
              endTime: 6,
              duration: 6,
            },
            undefined,
            0
          )
          useEditorStore.getState().clearHistory()
        })

        await closePrompt(view)

        // Silently: the same nothing the early guard answers a take already in
        // the library with. One clip, the restored one, and no second copy.
        const clips = useEditorStore.getState().project.timeline.clips
        expect(clips.map((c) => c.id)).toEqual(['restored-screen'])
        expect(deps.showNotification).not.toHaveBeenCalled()
        expect(useEditorStore.getState().history.past).toHaveLength(0)
        // The dropped take's thumbnails are NOT revoked here (ESCSUITE-117):
        // they were handed to `addSourceVideo` and are the library's. What frees
        // them is the restore re-adding its own entries under the same ids —
        // `addSourceVideo`'s replace-in-place branch, pinned against the real
        // store by `useSessionRestore.test.ts`'s "revokes only the id it
        // actually replaces".
        expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      })

      // The one firing of the old drop-time revoke that did real damage
      // (ESCSUITE-117 review round 1): a restore that brings back the screen
      // part but NOT the webcam. The take is dropped whole, and the webcam is
      // still in the library carrying the handle the import gave it — so
      // revoking "the dropped take's URLs" blanked a tile nothing had replaced.
      it('leaves a companion the restore did not re-add with its thumbnail intact', async () => {
        seedTake()
        vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)
        deps = {
          ...deps,
          // The real library, so it actually holds the import's handles.
          addSourceVideo: (video) => store().addSourceVideo(video),
        }

        const view = await mountBehindPrompt()
        const webcamUrl = store().sourceVideos.find((v) => v.id === 'take-1-webcam')!.thumbnailUrl
        expect(webcamUrl).toEqual(expect.stringMatching(OBJECT_URL_PATTERN))

        // What "Restore" does here: the screen part comes back (with a handle of
        // its own, resolved from storage) and its clip with it. The webcam part
        // is not in this session at all.
        act(() => {
          store().addSourceVideo({ ...primary, thumbnailUrl: 'blob:from-the-session' })
          store().addClipToTimeline(
            {
              id: 'restored-screen',
              sourceVideoId: 'take-1',
              name: 'Screen recording',
              startTime: 0,
              endTime: 6,
              duration: 6,
            },
            undefined,
            0
          )
          useEditorStore.getState().clearHistory()
        })

        await closePrompt(view)

        // Dropped whole, as it must be — a clip already plays the screen part.
        expect(useEditorStore.getState().project.timeline.clips.map((c) => c.id))
          .toEqual(['restored-screen'])
        // And the companion nothing replaced still has a handle that opens.
        expect(store().sourceVideos.find((v) => v.id === 'take-1-webcam')!.thumbnailUrl)
          .toBe(webcamUrl)
        expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(webcamUrl)
      })

      // The mirror, so the check above is about the take being there and not
      // about a restore having happened at all.
      it('places the take when the session restored does not have it', async () => {
        seedTake()

        const view = await mountBehindPrompt()
        act(() => {
          addClip('restored', 0, 4)
          useEditorStore.getState().clearHistory()
        })

        await closePrompt(view)

        const clips = useEditorStore.getState().project.timeline.clips
        expect(clips.map((c) => c.sourceVideoId)).toEqual([
          'video1',
          'take-1',
          'take-1-webcam',
        ])
        expect(deps.showNotification).toHaveBeenCalledTimes(1)
      })

      it('places the take once, however often the question is re-opened', async () => {
        seedTake()

        const view = await mountBehindPrompt()
        await closePrompt(view)

        // A full second settle cycle, not a re-render with the same value: the
        // flag goes back to pending and settles again, so the drain really does
        // run a second time. It must find nothing — the take was taken out of
        // the ref, not merely read out of it — or the take is placed twice and
        // the user is told about it twice.
        await act(async () => {
          view.rerender({ sessionDecisionPending: true })
          await Promise.resolve()
        })
        await closePrompt(view)

        expect(useEditorStore.getState().project.timeline.clips).toHaveLength(2)
        expect(deps.showNotification).toHaveBeenCalledTimes(1)
      })
    })
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
