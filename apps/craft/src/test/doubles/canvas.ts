// Recording double for CanvasRenderingContext2D + canvas.toBlob().
//
// jsdom does not implement 2D canvas rendering (getContext('2d') returns null,
// and toBlob() logs a "not implemented" warning and never calls back). This
// double replaces both with deterministic, inspectable stand-ins so code that
// draws to a canvas and reads back an image/blob can be exercised for real
// instead of being mocked out at the module level.
//
// Install once (see src/test/setup.ts). Tests that need to inspect what was
// drawn, or control what toBlob()/getImageData() hand back, use
// getCanvasContext(canvas) or getLastCanvasContext() to reach the double for
// a given canvas element.
import { vi } from 'vitest'

export interface ToBlobCall {
  type: string | undefined
  quality: number | undefined
}

export interface RecordingCanvasRenderingContext2D {
  readonly canvas: HTMLCanvasElement
  readonly drawImage: ReturnType<typeof vi.fn>
  readonly putImageData: ReturnType<typeof vi.fn>
  readonly clearRect: ReturnType<typeof vi.fn>
  readonly fillRect: ReturnType<typeof vi.fn>
  readonly getImageData: ReturnType<typeof vi.fn>
  /** The (type, quality) arguments of every canvas.toBlob() call for this canvas. */
  readonly toBlobCalls: ToBlobCall[]
  /** What canvas.toBlob() hands back for this canvas. Mutate per-test as needed. */
  toBlobResult: Blob | null
  /** What ctx.getImageData() returns. Mutate per-test as needed. */
  imageData: ImageData
}

function defaultImageData(): ImageData {
  return {
    data: new Uint8ClampedArray([10, 20, 30, 255]),
    width: 1,
    height: 1,
    colorSpace: 'srgb',
  } as ImageData
}

const contextsByCanvas = new WeakMap<HTMLCanvasElement, RecordingCanvasRenderingContext2D>()
let lastContext: RecordingCanvasRenderingContext2D | null = null

function createContext(canvas: HTMLCanvasElement): RecordingCanvasRenderingContext2D {
  const ctx: RecordingCanvasRenderingContext2D = {
    canvas,
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(() => ctx.imageData),
    toBlobCalls: [],
    toBlobResult: new Blob(['mock-canvas-image'], { type: 'image/jpeg' }),
    imageData: defaultImageData(),
  }
  contextsByCanvas.set(canvas, ctx)
  lastContext = ctx
  return ctx
}

let installed = false

/**
 * Patch HTMLCanvasElement.prototype.getContext('2d') and .toBlob() with the
 * recording double. Idempotent — safe to call from setup.ts once per run.
 */
export function installCanvasContextDouble(): void {
  if (installed) return
  installed = true

  const originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown
  ) {
    if (contextId === '2d') {
      return (contextsByCanvas.get(this) ?? createContext(this)) as unknown as RenderingContext
    }
    return originalGetContext.call(
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
    const result = ctx.toBlobResult !== undefined ? ctx.toBlobResult : new Blob([], { type: type || 'image/png' })
    // Real canvases call back asynchronously — preserve that so callers that
    // rely on it (e.g. awaiting a Promise wrapping toBlob) behave correctly.
    queueMicrotask(() => callback(result))
  } as typeof HTMLCanvasElement.prototype.toBlob
}

/** The double attached to a specific canvas element, if any. */
export function getCanvasContext(canvas: HTMLCanvasElement): RecordingCanvasRenderingContext2D | undefined {
  return contextsByCanvas.get(canvas)
}

/** The most recently created (or looked up) canvas double, for convenience. */
export function getLastCanvasContext(): RecordingCanvasRenderingContext2D | null {
  return lastContext
}

/** Clear the "last context" pointer between tests. Does not un-patch the prototype. */
export function resetCanvasContextDouble(): void {
  lastContext = null
}
