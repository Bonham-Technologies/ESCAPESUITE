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
import { processVideoFile, resolveStoredDuration } from '../core/videoProcessor'
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage'
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

  it('adds to the library and places nothing', async () => {
    await mountIntegration({ videos: ['https://host.example/a.mp4'] })

    expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
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

    it('revokes every thumbnail it made when the editor goes away', async () => {
      seedTake()
      vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)

      const { unmount } = await mountIntegration({ loadVideoId: 'take-1' })
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()

      unmount()

      // One per part: the URLs live as long as the library entries, so the
      // cleanup is the only place they can be handed back.
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
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

    it('places nothing and revokes its thumbnails when the editor leaves mid-import', async () => {
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
      // Nor does it leak: the cleanup ran before the URLs existed, so the
      // import's own caller is the only thing that can hand them back.
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
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
        // The thumbnails the dropped take made are handed back at the drop, not
        // left for the unmount: the restore re-added its own library entries
        // over the import's, so nothing is pointing at these URLs any more.
        expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
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
