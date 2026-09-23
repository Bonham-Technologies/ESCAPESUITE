// The preview stage, driven by props only — the countdown number excepted:
// `CountdownOverlay` reads it from the store itself, so a tick cannot
// re-render this stage. What the overlay draws in each state is its own file's
// business (`CountdownOverlay.test.tsx`); what is asserted here is that it is
// laid *over* whatever the preview is showing.
//
// Three mutually exclusive contents and one overlay. The order they are
// checked in matters: during a picture-in-picture take both `isPiPActive` and
// `previewStream` are set, and PiP has to win — otherwise the preview would
// show a stream that has been round-tripped through the encoder instead of the
// compositor's own canvas. That precedence gets its own test, as does the fact
// that both DOM handles reach the caller's refs.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRef, type RefObject } from 'react'
import { render, screen } from '@testing-library/react'
import { RecordingPreview } from './RecordingPreview'
import { useRecorderStore } from '../../store/recorderStore'
import type { RecordingState } from '../../store/types'
import styles from '../../App.module.css'

// The store is a module singleton: reset the one field the overlay reads.
beforeEach(() => {
  useRecorderStore.setState({ countdownValue: 0 })
})

interface Options {
  isPiPActive?: boolean
  previewStream?: MediaStream | null
  state?: RecordingState
  previewRef?: RefObject<HTMLVideoElement | null>
  canvasPreviewRef?: RefObject<HTMLDivElement | null>
}

function renderPreview(options: Options = {}) {
  const previewRef = options.previewRef ?? createRef<HTMLVideoElement>()
  const canvasPreviewRef = options.canvasPreviewRef ?? createRef<HTMLDivElement>()
  const { container } = render(
    <RecordingPreview
      isPiPActive={options.isPiPActive ?? false}
      previewStream={options.previewStream ?? null}
      state={options.state ?? 'idle'}
      previewRef={previewRef}
      canvasPreviewRef={canvasPreviewRef}
    />
  )
  return { container, previewRef, canvasPreviewRef }
}

/** A stream object is only ever handed to a ref here, so a bare stand-in will do. */
function streamStub(): MediaStream {
  return new MediaStream()
}

describe('RecordingPreview contents', () => {
  it('invites the user to record when there is nothing to show', () => {
    const { container } = renderPreview()

    expect(screen.getByText('Click record to start capturing')).toBeInTheDocument()
    expect(container.querySelector(`.${styles.previewIcon}`)).toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
  })

  it('mirrors a single-source stream in a muted, inline video', () => {
    const { container, previewRef } = renderPreview({ previewStream: streamStub() })

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video).toBeInTheDocument()
    expect(video.autoplay).toBe(true)
    expect(video.muted).toBe(true)
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveStyle({ width: '100%', height: '100%', objectFit: 'contain' })
    expect(previewRef.current).toBe(video)
    expect(screen.queryByText('Click record to start capturing')).not.toBeInTheDocument()
  })

  it('hands the compositor a centred host element instead, during PiP', () => {
    const { container, canvasPreviewRef, previewRef } = renderPreview({ isPiPActive: true })

    expect(container.querySelector('video')).toBeNull()
    const host = canvasPreviewRef.current as HTMLDivElement
    expect(host).toBeInTheDocument()
    expect(host).toHaveStyle({
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    })
    expect(previewRef.current).toBeNull()
  })

  it('prefers the compositor canvas over the stream when both are present', () => {
    const { container, canvasPreviewRef } = renderPreview({
      isPiPActive: true,
      previewStream: streamStub(),
    })

    expect(container.querySelector('video')).toBeNull()
    expect(canvasPreviewRef.current).toBeInTheDocument()
  })
})

describe('RecordingPreview countdown', () => {
  it('counts down over whatever the preview is showing', () => {
    useRecorderStore.setState({ countdownValue: 3 })
    const { container } = renderPreview({
      state: 'countdown',
      previewStream: streamStub(),
    })

    const number = container.querySelector(`.${styles.countdownNumber}`) as HTMLElement
    expect(number).toHaveTextContent('3')
    expect(container.querySelector('video')).toBeInTheDocument()
  })

  // The state the overlay is handed is this component's own `state` prop, so
  // that it is threaded through at all is asserted here; which states draw and
  // which do not is `CountdownOverlay.test.tsx`'s.
  it('draws no countdown outside one', () => {
    useRecorderStore.setState({ countdownValue: 3 })
    const { container } = renderPreview({ state: 'recording', previewStream: streamStub() })

    expect(container.querySelector(`.${styles.countdownNumber}`)).toBeNull()
  })
})
