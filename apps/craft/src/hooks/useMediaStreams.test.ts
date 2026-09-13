// The capture side of the recorder: what it asks the browser for, what it
// shows in the preview, and what it releases.
//
// The permissions module's three request functions are doubled (they are the
// browser's own prompts); `stopStream` is the real one, so releasing a stream
// really does call stop() on each of its tracks. The compositor is stood in
// for by an object with the two members this hook uses — a canvas to show and
// a dispose() to call — because the compositor's own suite covers the rest.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMediaStreams, type MediaStreamsDeps } from './useMediaStreams'
import type { Compositor } from '../core/compositor'
import { useRecorderStore } from '../store/recorderStore'
import { defaultConfig, type RecordingConfig } from '../store/types'
import { allCapabilities, permissionsOverrides, resetAppDoubles } from '../test/appDoubles'
import { createStreamDouble, createTrackDouble, type TrackDouble } from '../test/doubles/mediastream'

vi.mock('../core/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/permissions')>()
  const { permissionsOverrides: overrides } = await import('../test/appDoubles')
  return { ...actual, ...overrides }
})

beforeEach(() => {
  resetAppDoubles()
  useRecorderStore.setState({ screenStream: null, webcamStream: null })
  document.body.innerHTML = ''
})

function streamWith(track: TrackDouble): MediaStream {
  return createStreamDouble([track])
}

function deps(config: Partial<RecordingConfig> = {}): MediaStreamsDeps {
  return {
    config: { ...defaultConfig, ...config },
    capabilities: allCapabilities(),
    setStreams: useRecorderStore.getState().setStreams,
  }
}

function mountStreams(initial: MediaStreamsDeps = deps()) {
  return renderHook((props: MediaStreamsDeps) => useMediaStreams(props), { initialProps: initial })
}

/** A stand-in compositor: the canvas the preview shows, and the dispose() call. */
function compositorStub(): { compositor: Compositor; canvas: HTMLCanvasElement; dispose: ReturnType<typeof vi.fn> } {
  const canvas = document.createElement('canvas')
  const dispose = vi.fn()
  return {
    compositor: { getCanvas: () => canvas, dispose } as unknown as Compositor,
    canvas,
    dispose,
  }
}

describe('useMediaStreams acquiring', () => {
  it('asks only for the sources that are enabled and available', async () => {
    const screen = streamWith(createTrackDouble('video', { id: 'screen' }))
    const mic = streamWith(createTrackDouble('audio', { id: 'mic' }))
    permissionsOverrides.requestScreenCapture.mockResolvedValue(screen)
    permissionsOverrides.requestMicrophone.mockResolvedValue(mic)

    const { result } = mountStreams(
      deps({ screenEnabled: true, webcamEnabled: false, microphoneEnabled: true, systemAudioEnabled: true })
    )
    const acquired = await result.current.acquireStreams()

    expect(permissionsOverrides.requestScreenCapture).toHaveBeenCalledWith(true)
    expect(permissionsOverrides.requestWebcam).not.toHaveBeenCalled()
    expect(acquired).toEqual({ screen, webcam: null, mic })
  })

  it('skips a source the environment cannot provide', async () => {
    const webcam = streamWith(createTrackDouble('video', { id: 'webcam' }))
    permissionsOverrides.requestWebcam.mockResolvedValue(webcam)

    const { result } = mountStreams({
      ...deps({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: true }),
      capabilities: { ...allCapabilities(), screenCapture: false, microphone: false },
    })
    const acquired = await result.current.acquireStreams()

    expect(permissionsOverrides.requestScreenCapture).not.toHaveBeenCalled()
    expect(permissionsOverrides.requestMicrophone).not.toHaveBeenCalled()
    expect(acquired).toEqual({ screen: null, webcam, mic: null })
  })

  it('releases what it already got when a later source fails, and rethrows', async () => {
    const screenTrack = createTrackDouble('video', { id: 'screen' })
    permissionsOverrides.requestScreenCapture.mockResolvedValue(streamWith(screenTrack))
    permissionsOverrides.requestWebcam.mockRejectedValue(new Error('Camera in use'))

    const { result } = mountStreams(deps({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: true }))

    await expect(result.current.acquireStreams()).rejects.toThrow('Camera in use')
    expect(screenTrack.stop).toHaveBeenCalledTimes(1)
    expect(permissionsOverrides.requestMicrophone).not.toHaveBeenCalled()
  })
})

describe('useMediaStreams releasing', () => {
  it('stops every capture, the microphone included, and empties the store', () => {
    const screenTrack = createTrackDouble('video', { id: 'screen' })
    const webcamTrack = createTrackDouble('video', { id: 'webcam' })
    const micTrack = createTrackDouble('audio', { id: 'mic' })
    const screen = streamWith(screenTrack)
    useRecorderStore.setState({ screenStream: screen, webcamStream: streamWith(webcamTrack) })

    const { result } = mountStreams()
    act(() => {
      result.current.micStreamRef.current = streamWith(micTrack)
      result.current.setPreviewStream(screen)
    })

    act(() => {
      result.current.stopAllStreams()
    })

    expect(screenTrack.stop).toHaveBeenCalledTimes(1)
    expect(webcamTrack.stop).toHaveBeenCalledTimes(1)
    expect(micTrack.stop).toHaveBeenCalledTimes(1)
    expect(result.current.micStreamRef.current).toBeNull()
    expect(useRecorderStore.getState().screenStream).toBeNull()
    expect(useRecorderStore.getState().webcamStream).toBeNull()
    expect(result.current.previewStream).toBeNull()
  })

  it('disposes the compositor and clears the stale frame out of the preview', () => {
    const { compositor, canvas, dispose } = compositorStub()
    const host = document.createElement('div')
    document.body.appendChild(host)

    const { result } = mountStreams()
    act(() => {
      result.current.compositorRef.current = compositor
      result.current.canvasPreviewRef.current = host
      result.current.setIsPiPActive(true)
    })
    host.appendChild(canvas)

    act(() => {
      result.current.stopAllStreams()
    })

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(result.current.compositorRef.current).toBeNull()
    expect(result.current.isPiPActive).toBe(false)
    expect(host.innerHTML).toBe('')
  })

  it('has nothing to dispose when no take ever composited', () => {
    const { result } = mountStreams()

    act(() => {
      result.current.stopAllStreams()
    })

    expect(result.current.isPiPActive).toBe(false)
    expect(result.current.compositorRef.current).toBeNull()
  })
})

describe('useMediaStreams preview attach', () => {
  it('moves the compositor canvas into the preview host, sized to fill it', () => {
    const { compositor, canvas } = compositorStub()
    const host = document.createElement('div')
    host.innerHTML = '<span>stale frame</span>'
    document.body.appendChild(host)

    const { result } = mountStreams()
    act(() => {
      result.current.compositorRef.current = compositor
      result.current.canvasPreviewRef.current = host
      result.current.setPreviewStream(streamWith(createTrackDouble('video')))
    })

    expect(host.firstElementChild).toBe(canvas)
    expect(host.querySelector('span')).toBeNull()
    expect(canvas.style.width).toBe('100%')
    expect(canvas.style.height).toBe('100%')
    expect(canvas.style.objectFit).toBe('contain')
  })

  it('mirrors a single-source stream through the video element instead', () => {
    const video = document.createElement('video')
    const play = vi.fn().mockResolvedValue(undefined)
    video.play = play as unknown as typeof video.play
    const stream = streamWith(createTrackDouble('video'))

    const { result } = mountStreams()
    act(() => {
      result.current.previewRef.current = video
      result.current.setPreviewStream(stream)
    })

    expect((video as HTMLVideoElement & { srcObject?: MediaStream }).srcObject).toBe(stream)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('swallows a refused autoplay rather than surfacing an unhandled rejection', async () => {
    const video = document.createElement('video')
    video.play = vi.fn().mockRejectedValue(new Error('NotAllowedError')) as unknown as typeof video.play

    const { result } = mountStreams()
    act(() => {
      result.current.previewRef.current = video
      result.current.setPreviewStream(streamWith(createTrackDouble('video')))
    })

    await expect(Promise.resolve()).resolves.toBeUndefined()
    expect(video.play).toHaveBeenCalledTimes(1)
  })

  it('attaches nothing while there is no stream to show', () => {
    const video = document.createElement('video')
    const play = vi.fn().mockResolvedValue(undefined)
    video.play = play as unknown as typeof video.play

    const { result } = mountStreams()
    act(() => {
      result.current.previewRef.current = video
      result.current.setPreviewStream(null)
    })

    expect(play).not.toHaveBeenCalled()
  })
})

describe('useMediaStreams teardown mirror', () => {
  it('keeps stopAllStreamsRef pointing at the current release function', () => {
    const { result, rerender } = mountStreams()
    const first = result.current.stopAllStreams
    expect(result.current.stopAllStreamsRef.current).toBe(first)

    // A new setStreams identity is what rebuilds stopAllStreams — the mirror
    // has to follow it, because the unmount teardown reads only the mirror.
    rerender({ ...deps(), setStreams: vi.fn() })

    expect(result.current.stopAllStreams).not.toBe(first)
    expect(result.current.stopAllStreamsRef.current).toBe(result.current.stopAllStreams)
  })
})
