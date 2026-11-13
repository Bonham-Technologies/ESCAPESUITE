// A paused `<video>` that presents a sought frame some time after 'seeked'
// (ESCSUITE-454).
//
// Chromium can fire 'seeked' with `seeking` false and `readyState` 4 while the
// frame `drawImage` paints is still the one from before the seek; the sought
// frame is presented a little later, and `requestVideoFrameCallback` fires
// when it is. This double models exactly that order: an assignment to
// `currentTime` dispatches 'seeked' a microtask later, and only `presentAfterMs`
// later (a `setTimeout`, so fake timers drive it) does `shownTime` — what a
// draw of the element would paint — move to the sought time and the pending
// frame callbacks fire. A seek issued before the last one was presented
// replaces it, as a browser presents only the frame it ended up on. A seek
// that leaves the element where it is (past the end, at the end) presents
// nothing at all.
//
// `frameCallbacks: 'never'` keeps `requestVideoFrameCallback` but never answers
// it after a paused seek (what WebKit might do: unmeasured), and `'absent'`
// leaves the element without one, as an engine without the API.

export interface PresentingVideoOptions {
  /** How long after the seek the sought frame is presented. */
  presentAfterMs: number
  /** Whether the element answers frame callbacks: 'yes' (default), 'never', or 'absent' (no API). */
  frameCallbacks?: 'yes' | 'never' | 'absent'
}

export class PresentingVideo extends EventTarget {
  readyState = 4
  seeking = false
  videoWidth = 640
  videoHeight = 360
  duration = 20
  src = 'blob:presenting-video'
  /** The time of the frame a draw of this element would paint now. */
  shownTime = 0
  /** Every seek and frame-callback call, in order: `seek`, `rvfc`, `cancel`. */
  readonly calls: string[] = []
  readonly seeks: number[] = []
  /** Frame callbacks registered and neither answered nor cancelled. */
  readonly pending = new Map<number, VideoFrameRequestCallback>()
  declare requestVideoFrameCallback: ((callback: VideoFrameRequestCallback) => number) | undefined
  declare cancelVideoFrameCallback: ((handle: number) => void) | undefined
  private time = 0
  private nextHandle = 1
  private presenting: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: PresentingVideoOptions) {
    super()
    const mode = options.frameCallbacks ?? 'yes'
    if (mode === 'absent') {
      this.requestVideoFrameCallback = undefined
      this.cancelVideoFrameCallback = undefined
      return
    }
    this.requestVideoFrameCallback = (callback) => {
      this.calls.push('rvfc')
      const handle = this.nextHandle++
      this.pending.set(handle, callback)
      return handle
    }
    this.cancelVideoFrameCallback = (handle) => {
      this.calls.push('cancel')
      this.pending.delete(handle)
    }
  }

  get currentTime(): number {
    return this.time
  }

  set currentTime(seconds: number) {
    this.calls.push('seek')
    this.seeks.push(seconds)
    // A seek past the end lands on the end. One that leaves the element where
    // it already is fires 'seeked' and presents nothing, so no frame callback
    // fires: what Chromium 1243 does (measured).
    const landing = Math.min(Math.max(seconds, 0), this.duration)
    const moved = landing !== this.time
    this.time = landing
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')))
    if (!moved) return
    clearTimeout(this.presenting)
    this.presenting = setTimeout(() => this.present(landing), this.options.presentAfterMs)
  }

  pause(): void {}

  play(): Promise<void> {
    return Promise.resolve()
  }

  load(): void {}

  private present(seconds: number): void {
    this.presenting = undefined
    this.shownTime = seconds
    if ((this.options.frameCallbacks ?? 'yes') !== 'yes') return
    const callbacks = [...this.pending.values()]
    this.pending.clear()
    for (const callback of callbacks) {
      callback(performance.now(), { mediaTime: seconds } as VideoFrameCallbackMetadata)
    }
  }
}
