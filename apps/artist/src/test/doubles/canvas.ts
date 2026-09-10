// Recording double for CanvasRenderingContext2D + canvas.toBlob().
//
// jsdom does not implement 2D canvas rendering: getContext('2d') returns null
// and toBlob() logs "not implemented" and never calls back. This double
// replaces both with deterministic, inspectable stand-ins so code that draws to
// a canvas and reads the result back can be exercised for real rather than
// mocked out at the module level.
//
// Adapted from apps/craft/src/test/doubles/canvas.ts, extended with the
// path/text/transform surface ESCAPEARTIST's canvasUtils and thumbnail
// generators use.
import { vi } from 'vitest'

/**
 * The drawing state in effect when a call was made. Canvas state is set through
 * properties rather than calls, so this snapshot is the only way to assert
 * *what a particular drawImage/fillText was drawn with* — the alpha of each
 * side of a crossfade, say, or the blend mode a clip composited under.
 */
export interface CanvasState {
  globalAlpha: number
  globalCompositeOperation: GlobalCompositeOperation
  filter: string
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
}

/** One recorded drawing call, in the order the code under test made it. */
export interface CanvasCall {
  method: string
  args: unknown[]
  state: CanvasState
}

export interface ToBlobCall {
  type: string | undefined
  quality: number | undefined
}

export interface RecordingCanvasRenderingContext2D {
  readonly canvas: HTMLCanvasElement
  readonly save: ReturnType<typeof vi.fn>
  readonly restore: ReturnType<typeof vi.fn>
  readonly translate: ReturnType<typeof vi.fn>
  readonly rotate: ReturnType<typeof vi.fn>
  readonly scale: ReturnType<typeof vi.fn>
  readonly setTransform: ReturnType<typeof vi.fn>
  readonly clearRect: ReturnType<typeof vi.fn>
  readonly fillRect: ReturnType<typeof vi.fn>
  readonly strokeRect: ReturnType<typeof vi.fn>
  readonly beginPath: ReturnType<typeof vi.fn>
  readonly closePath: ReturnType<typeof vi.fn>
  readonly moveTo: ReturnType<typeof vi.fn>
  readonly lineTo: ReturnType<typeof vi.fn>
  readonly ellipse: ReturnType<typeof vi.fn>
  readonly arc: ReturnType<typeof vi.fn>
  readonly rect: ReturnType<typeof vi.fn>
  readonly fill: ReturnType<typeof vi.fn>
  readonly stroke: ReturnType<typeof vi.fn>
  readonly clip: ReturnType<typeof vi.fn>
  readonly fillText: ReturnType<typeof vi.fn>
  readonly strokeText: ReturnType<typeof vi.fn>
  readonly measureText: ReturnType<typeof vi.fn>
  readonly drawImage: ReturnType<typeof vi.fn>
  readonly getImageData: ReturnType<typeof vi.fn>
  readonly putImageData: ReturnType<typeof vi.fn>
  readonly setLineDash: ReturnType<typeof vi.fn>
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  globalAlpha: number
  globalCompositeOperation: GlobalCompositeOperation
  filter: string
  /**
   * Every recorded call in order, so tests can assert on sequencing (e.g. that
   * a background rect is filled before the text drawn on top of it).
   */
  readonly calls: CanvasCall[]
  /** The (type, quality) arguments of every canvas.toBlob() call for this canvas. */
  readonly toBlobCalls: ToBlobCall[]
  /** What canvas.toBlob() hands back for this canvas. Mutate per-test as needed. */
  toBlobResult: Blob | null
  /** Width reported by measureText(). Mutate per-test as needed. */
  measuredTextWidth: number
  /** Convenience: the args of the calls with the given method name, in order. */
  argsFor(method: string): unknown[][]
  /** The drawing state in effect at each call with the given method name. */
  stateFor(method: string): CanvasState[]
}

const contextsByCanvas = new WeakMap<HTMLCanvasElement, RecordingCanvasRenderingContext2D>()
let lastContext: RecordingCanvasRenderingContext2D | null = null
let defaultToBlobResult: Blob | null = new Blob(['double-canvas-image'], { type: 'image/jpeg' })

/**
 * What toBlob() hands back for canvases created from now on. Set to null to
 * model a browser that fails to encode — the code under test creates its own
 * canvas, so this has to be armed before the call rather than after.
 */
export function setDefaultToBlobResult(result: Blob | null): void {
  defaultToBlobResult = result
}

function createContext(
  canvas: HTMLCanvasElement,
  { track = true }: { track?: boolean } = {}
): RecordingCanvasRenderingContext2D {
  const calls: CanvasCall[] = []
  // save()/restore() keep a real state stack, so the state recorded against a
  // call made after a restore() is the state a browser would actually apply.
  const stack: CanvasState[] = []
  const snapshot = (): CanvasState => ({
    globalAlpha: ctx.globalAlpha,
    globalCompositeOperation: ctx.globalCompositeOperation,
    filter: ctx.filter,
    fillStyle: ctx.fillStyle,
    strokeStyle: ctx.strokeStyle,
    lineWidth: ctx.lineWidth,
    font: ctx.font,
    textAlign: ctx.textAlign,
    textBaseline: ctx.textBaseline,
  })
  const record = (method: string, impl?: (...args: never[]) => unknown) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args, state: snapshot() })
      return impl?.(...(args as never[]))
    })

  const ctx: RecordingCanvasRenderingContext2D = {
    canvas,
    save: record('save', () => {
      stack.push(snapshot())
    }),
    restore: record('restore', () => {
      const previous = stack.pop()
      // An unbalanced restore() is a no-op on a real context too.
      if (previous) Object.assign(ctx, previous)
    }),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    ellipse: record('ellipse'),
    arc: record('arc'),
    rect: record('rect'),
    fill: record('fill'),
    stroke: record('stroke'),
    clip: record('clip'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    measureText: record('measureText', () => ({ width: ctx.measuredTextWidth }) as TextMetrics),
    drawImage: record('drawImage'),
    getImageData: record('getImageData', () => ({
      data: new Uint8ClampedArray([0, 0, 0, 255]),
      width: 1,
      height: 1,
      colorSpace: 'srgb',
    }) as ImageData),
    putImageData: record('putImageData'),
    setLineDash: record('setLineDash'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    calls,
    toBlobCalls: [],
    toBlobResult: defaultToBlobResult,
    measuredTextWidth: 100,
    argsFor: (method: string) => calls.filter((c) => c.method === method).map((c) => c.args),
    stateFor: (method: string) => calls.filter((c) => c.method === method).map((c) => c.state),
  }
  contextsByCanvas.set(canvas, ctx)
  if (track) lastContext = ctx
  return ctx
}

/**
 * A standalone recording context, for functions that take a context rather
 * than creating their own canvas.
 */
export function createRecordingContext(): RecordingCanvasRenderingContext2D {
  return createContext(document.createElement('canvas'))
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext | null = null
let originalToBlob: typeof HTMLCanvasElement.prototype.toBlob | null = null

/**
 * Patch HTMLCanvasElement.prototype.getContext('2d') and .toBlob() with the
 * recording double. Scope it to the tests that need it: install in beforeEach,
 * uninstall in afterEach.
 */
export function installCanvasDouble(): void {
  if (originalGetContext) return
  originalGetContext = HTMLCanvasElement.prototype.getContext
  originalToBlob = HTMLCanvasElement.prototype.toBlob

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown
  ) {
    if (contextId === '2d') {
      return (contextsByCanvas.get(this) ?? createContext(this)) as unknown as RenderingContext
    }
    return originalGetContext!.call(
      this,
      contextId as '2d',
      options as CanvasRenderingContext2DSettings
    )
  } as typeof HTMLCanvasElement.prototype.getContext

  HTMLCanvasElement.prototype.toBlob = function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number
  ) {
    const ctx = contextsByCanvas.get(this) ?? createContext(this)
    ctx.toBlobCalls.push({ type, quality })
    const result = ctx.toBlobResult
    // Real canvases call back asynchronously — preserve that, so callers that
    // wrap toBlob() in a Promise behave the way they do in a browser.
    queueMicrotask(() => callback(result))
  } as typeof HTMLCanvasElement.prototype.toBlob
}

export function uninstallCanvasDouble(): void {
  if (!originalGetContext) return
  HTMLCanvasElement.prototype.getContext = originalGetContext
  HTMLCanvasElement.prototype.toBlob = originalToBlob!
  originalGetContext = null
  originalToBlob = null
  lastContext = null
  defaultToBlobResult = new Blob(['double-canvas-image'], { type: 'image/jpeg' })
}

/** The double attached to a specific canvas element, if any. */
export function getCanvasContext(
  canvas: HTMLCanvasElement
): RecordingCanvasRenderingContext2D | undefined {
  return contextsByCanvas.get(canvas)
}

/** The most recently created canvas double — the one the code under test just made. */
export function getLastCanvasContext(): RecordingCanvasRenderingContext2D | null {
  return lastContext
}

/**
 * Make the next getContext('2d') return null, the way a browser does when a
 * context cannot be created. Applies to canvases that have no double yet.
 */
export function failNextGetContext(): void {
  const patched = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown
  ) {
    HTMLCanvasElement.prototype.getContext = patched
    if (contextId === '2d') return null
    return patched.call(this, contextId as '2d', options as CanvasRenderingContext2DSettings)
  } as typeof HTMLCanvasElement.prototype.getContext
}

/**
 * An OffscreenCanvas double. jsdom has no OffscreenCanvas at all, so the blur
 * shape overlay — which captures the frame so far into one and draws it back
 * through a clip path — cannot run without this. Each instance carries a
 * recording 2D context of its own, so the capture drawn *into* the offscreen
 * canvas can be asserted separately from the compositing drawn back out.
 */
export interface OffscreenCanvasRecord {
  readonly width: number
  readonly height: number
  readonly context: RecordingCanvasRenderingContext2D
}

export interface OffscreenCanvasDouble {
  /** Every OffscreenCanvas the code under test constructed, in order. */
  readonly instances: OffscreenCanvasRecord[]
  /** The context of the most recently constructed OffscreenCanvas, if any. */
  readonly lastContext: RecordingCanvasRenderingContext2D | null
  /** Make getContext('2d') return null, the way an out-of-memory browser does. */
  failGetContext: boolean
  uninstall(): void
}

const OFFSCREEN_MISSING = Symbol('missing')

let lastOffscreenContext: RecordingCanvasRenderingContext2D | null = null

/** The context of the most recent OffscreenCanvas the code under test made. */
export function getLastOffscreenContext(): RecordingCanvasRenderingContext2D | null {
  return lastOffscreenContext
}

export function installOffscreenCanvasDouble(): OffscreenCanvasDouble {
  const g = globalThis as unknown as Record<string, unknown>
  const previous = 'OffscreenCanvas' in g ? g.OffscreenCanvas : OFFSCREEN_MISSING

  const instances: OffscreenCanvasRecord[] = []
  const state = { failGetContext: false }
  lastOffscreenContext = null

  class OffscreenCanvasImpl {
    readonly width: number
    readonly height: number
    readonly context: RecordingCanvasRenderingContext2D

    constructor(width: number, height: number) {
      this.width = width
      this.height = height
      const backing = document.createElement('canvas')
      backing.width = width
      backing.height = height
      // Not tracked as the "last canvas context": an offscreen canvas is
      // scratch space, and getLastCanvasContext() must keep pointing at the
      // canvas the code under test is really drawing to.
      this.context = createContext(backing, { track: false })
      lastOffscreenContext = this.context
      instances.push(this)
    }

    getContext(contextId: string): RecordingCanvasRenderingContext2D | null {
      if (contextId !== '2d' || state.failGetContext) return null
      return this.context
    }
  }

  g.OffscreenCanvas = OffscreenCanvasImpl

  return {
    instances,
    get lastContext() {
      return lastOffscreenContext
    },
    get failGetContext() {
      return state.failGetContext
    },
    set failGetContext(next: boolean) {
      state.failGetContext = next
    },
    uninstall() {
      lastOffscreenContext = null
      if (previous === OFFSCREEN_MISSING) delete g.OffscreenCanvas
      else g.OffscreenCanvas = previous
    },
  }
}
