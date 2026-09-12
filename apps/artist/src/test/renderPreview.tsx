// Mount PreviewPlayer against the browser doubles it needs, and give tests the
// canvas geometry to aim at.
//
// PreviewPlayer is the one component that needs every double at once: it draws
// to a 2D context (jsdom has none), creates <video>/<img>/<audio> elements and
// waits for their events (jsdom never fires any), measures text, converts mouse
// coordinates through the canvas' layout box (jsdom performs no layout), and
// drives a requestAnimationFrame loop off performance.now(). Vitest's fake
// timers fake rAF and performance.now together, so `settle(ms)` advances the
// clock, runs the frames that fell due, and flushes the promises in between —
// no real waiting anywhere.
//
// Lives under src/test/ so neither the vitest `include` glob (which would treat
// it as a suite containing no tests) nor the coverage `include` glob (which
// would score test scaffolding as production code) picks it up.
import { act, render, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import { PreviewPlayer } from '../components/Preview/PreviewPlayer'
import {
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type CanvasCall,
  type RecordingCanvasRenderingContext2D,
} from './doubles/canvas'
import {
  installMediaElementDoubles,
  installMediaPlaybackStubs,
  type MediaDoubleScript,
  type MediaDoubles,
} from './doubles/media'
import { setRect, type Box } from './doubles/layout'
import { installResizeObserverDouble, type ResizeObserverDouble } from './doubles/resizeObserver'
import { useEditorStore } from '../store/projectStore'
import type { SourceVideo } from '../store/types'

// The preview pauses every media element it owns on unmount, which happens
// outside any afterEach a test file controls. Silence jsdom's "not implemented"
// for the whole file.
installMediaPlaybackStubs()

/** An image source video, for the image branch of drawing and hit-testing. */
export const imageSource: SourceVideo = {
  id: 'image1',
  name: 'photo.png',
  duration: 5,
  width: 800,
  height: 600,
  frameRate: 0,
  mimeType: 'image/png',
  size: 2000,
  mediaType: 'image',
}

/** An audio-only source video: drawn never, played always. */
export const audioSource: SourceVideo = {
  id: 'audio1',
  name: 'score.mp3',
  duration: 60,
  width: 0,
  height: 0,
  frameRate: 0,
  mimeType: 'audio/mp3',
  size: 3000,
  mediaType: 'audio',
}

export interface PreviewDoubles {
  media: MediaDoubles
  /**
   * The preview's own ResizeObserver, so a test can tell it how big the canvas
   * element is (see `Preview.resize`). The shared setup's global stub records
   * nothing and never fires, which is exactly the state the preview reads as
   * "no box yet" — so a file that never resizes rasterises at the project size,
   * as the preview does before its first observation in a browser.
   */
  resizeObserver: ResizeObserverDouble
  uninstall(): void
}

/**
 * Install the canvas and media-element doubles. Call in beforeEach and
 * uninstall in afterEach — both patch prototypes/globals shared by the file.
 */
let activeResizeObserver: ResizeObserverDouble | null = null

export function installPreviewDoubles(script: Partial<MediaDoubleScript> = {}): PreviewDoubles {
  installCanvasDouble()
  const media = installMediaElementDoubles(script)
  const resizeObserver = installResizeObserverDouble()
  activeResizeObserver = resizeObserver
  return {
    media,
    resizeObserver,
    uninstall() {
      activeResizeObserver = null
      resizeObserver.uninstall()
      media.uninstall()
      uninstallCanvasDouble()
    },
  }
}

/**
 * Advance the fake clock inside act(): runs the timers *and* the animation
 * frames that fall due, and flushes the promises they resolve.
 */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** The last item of an array — `Array.prototype.at` is outside this tsconfig's lib. */
export function last<T>(items: readonly T[]): T {
  return items[items.length - 1]
}

/** One animation frame at the browser's nominal 60Hz. */
export const FRAME_MS = 16

/**
 * The canvas' layout box. 960x540 matches the default 1920x1080 project
 * resolution exactly, so canvas pixels are client pixels doubled and nothing
 * is letterboxed.
 */
export const DEFAULT_RECT: Box = { left: 0, top: 0, width: 960, height: 540 }

/** The project the store currently holds — the space the preview draws in. */
function projectSize(): { width: number; height: number } {
  const { width, height } = useEditorStore.getState().project.resolution
  return { width, height }
}

/**
 * Split a recording into composited frames.
 *
 * Every composite starts the same way: the transform matrix is set to the
 * raster scale and the whole project area is filled black. Nothing else in the
 * component makes that pair of calls back to back — the blur overlay resets the
 * transform too, but follows it with a blurred drawImage, not a full fill.
 *
 * The scale is whatever the preview is rasterising at (1 until a test gives the
 * canvas a box), so the transform is matched on its *shape* — a pure scale,
 * no skew, no translation — rather than on a number.
 */
function splitFrames(calls: CanvasCall[]): CanvasCall[][] {
  const size = projectSize()
  const isFrameTransform = (args: unknown[]) =>
    args.length === 6 && args[1] === 0 && args[2] === 0 && args[4] === 0 && args[5] === 0
  const isFullClear = (call: CanvasCall | undefined) =>
    call?.method === 'fillRect' && String(call.args) === String([0, 0, size.width, size.height])

  const frames: CanvasCall[][] = []
  for (const [index, call] of calls.entries()) {
    if (call.method === 'setTransform' && isFrameTransform(call.args) && isFullClear(calls[index + 1])) {
      frames.push([])
    }
    frames[frames.length - 1]?.push(call)
  }
  return frames
}

/** The calls of one composited frame, sliced out of the recording. */
export interface FrameView {
  calls: CanvasCall[]
  /** The ordered method names of this frame. */
  methods: string[]
  /** The calls this frame made to one method, in order. */
  of(method: string): CanvasCall[]
  /** The args of each call this frame made to one method, in order. */
  argsFor(method: string): unknown[][]
}

function frameView(calls: CanvasCall[]): FrameView {
  return {
    calls,
    methods: calls.map((c) => c.method),
    of: (method) => calls.filter((c) => c.method === method),
    argsFor: (method) => calls.filter((c) => c.method === method).map((c) => c.args),
  }
}

export interface Preview {
  view: RenderResult
  canvas: HTMLCanvasElement
  ctx: RecordingCanvasRenderingContext2D
  /** Forget every call recorded so far, so the next assertion sees one frame. */
  clearCalls(): void
  /** Recorded calls since the last clearCalls(), optionally one method only. */
  calls(method?: string): CanvasCall[]
  /** The args of each recorded call to `method`, since the last clearCalls(). */
  argsFor(method: string): unknown[][]
  /** The ordered method names recorded since the last clearCalls(). */
  methods(): string[]
  /**
   * The composited frames recorded since the last clearCalls(). One playhead
   * move can settle into more than one composite — a provisional draw with
   * whatever frame the videos are showing, then the accurate one once the
   * seeks report back — and both are recorded.
   */
  frames(): FrameView[]
  /** One composited frame; negative indices count back from the newest. */
  frame(index?: number): FrameView
  /**
   * Client coordinates for a point given in project pixels — the inverse of the
   * object-fit: contain mapping the component itself does.
   */
  at(canvasX: number, canvasY: number): { clientX: number; clientY: number }
  /** Client coordinates for a point given in the canvas' own CSS pixels. */
  atCss(cssX: number, cssY: number): { clientX: number; clientY: number }
  /**
   * Tell the preview how big its canvas element is, as a browser's
   * ResizeObserver would. This is what makes it rasterise at display size:
   * until it is called the preview has no box and draws at the project size.
   */
  resize(box: { width: number; height: number }): void
}

/**
 * Render PreviewPlayer with the store already holding whatever the test needs,
 * give its canvas a layout box, and let the mount-time media load and the
 * post-load redraw complete.
 */
export async function renderPreview({
  rect = DEFAULT_RECT,
  dpr,
}: { rect?: Box; dpr?: number } = {}): Promise<Preview> {
  // Set every time, so a file whose earlier test asked for a retina ratio does
  // not leave one behind for the next.
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr ?? 1, configurable: true })

  const view = render(<PreviewPlayer />)

  // The media load is async: until it resolves the component shows its
  // spinner and there is no canvas to measure.
  await settle()

  const canvas = view.container.querySelector('canvas')
  if (!canvas) {
    throw new Error(
      'PreviewPlayer rendered no canvas — put the clips in the store before rendering.'
    )
  }
  setRect(canvas, rect)

  // The redraw that follows a media-URL change is debounced by 50ms.
  await settle(60)

  const ctx = getCanvasContext(canvas)
  if (!ctx) throw new Error('The canvas double was not installed before rendering.')

  const start = { index: 0 }
  const since = () => ctx.calls.slice(start.index)

  const contentBox = () => {
    const box = canvas.getBoundingClientRect()
    const size = projectSize()
    const canvasAspect = size.width / size.height
    const elementAspect = box.width / box.height
    if (canvasAspect > elementAspect) {
      const renderedHeight = box.width / canvasAspect
      return {
        box,
        width: box.width,
        height: renderedHeight,
        offsetX: 0,
        offsetY: (box.height - renderedHeight) / 2,
      }
    }
    const renderedWidth = box.height * canvasAspect
    return {
      box,
      width: renderedWidth,
      height: box.height,
      offsetX: (box.width - renderedWidth) / 2,
      offsetY: 0,
    }
  }

  return {
    view,
    canvas,
    ctx,
    clearCalls: () => {
      start.index = ctx.calls.length
    },
    calls: (method?: string) => (method ? since().filter((c) => c.method === method) : since()),
    argsFor: (method: string) => since().filter((c) => c.method === method).map((c) => c.args),
    methods: () => since().map((c) => c.method),
    frames: () => splitFrames(since()).map(frameView),
    frame: (index = -1) => {
      const all = splitFrames(since())
      const frame = index < 0 ? all[all.length + index] : all[index]
      if (!frame) throw new Error(`No composited frame at index ${index} (${all.length} recorded).`)
      return frameView(frame)
    },
    at: (canvasX: number, canvasY: number) => {
      const { box, width, height, offsetX, offsetY } = contentBox()
      const size = projectSize()
      return {
        clientX: box.left + offsetX + (canvasX / size.width) * width,
        clientY: box.top + offsetY + (canvasY / size.height) * height,
      }
    },
    atCss: (cssX: number, cssY: number) => {
      const box = canvas.getBoundingClientRect()
      return { clientX: box.left + cssX, clientY: box.top + cssY }
    },
    resize: (box: { width: number; height: number }) => {
      if (!activeResizeObserver) {
        throw new Error('resize() needs installPreviewDoubles() — no ResizeObserver double is installed.')
      }
      setRect(canvas, { left: rect.left, top: rect.top, ...box })
      const observer = activeResizeObserver
      act(() => {
        observer.emit(canvas, box)
      })
    },
  }
}
