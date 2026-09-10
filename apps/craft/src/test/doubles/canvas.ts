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

/** One recorded drawing call, in the order the code under test made it. */
export interface CanvasCall {
  method: string
  args: unknown[]
}

export interface RecordingCanvasRenderingContext2D {
  readonly canvas: HTMLCanvasElement
  readonly drawImage: ReturnType<typeof vi.fn>
  readonly putImageData: ReturnType<typeof vi.fn>
  readonly clearRect: ReturnType<typeof vi.fn>
  readonly fillRect: ReturnType<typeof vi.fn>
  readonly getImageData: ReturnType<typeof vi.fn>
  readonly save: ReturnType<typeof vi.fn>
  readonly restore: ReturnType<typeof vi.fn>
  readonly beginPath: ReturnType<typeof vi.fn>
  readonly closePath: ReturnType<typeof vi.fn>
  readonly arc: ReturnType<typeof vi.fn>
  readonly roundRect: ReturnType<typeof vi.fn>
  readonly clip: ReturnType<typeof vi.fn>
  readonly stroke: ReturnType<typeof vi.fn>
  readonly fillText: ReturnType<typeof vi.fn>
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textAlign: string
  /**
   * Every recorded drawing call in order, so tests can assert on sequencing
   * (e.g. that a clip path is established before the drawImage it clips).
   */
  readonly calls: CanvasCall[]
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
  const calls: CanvasCall[] = []
  const record = (method: string, impl?: (...args: never[]) => unknown) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return impl?.(...(args as never[]))
    })

  const ctx: RecordingCanvasRenderingContext2D = {
    canvas,
    drawImage: record('drawImage'),
    putImageData: record('putImageData'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    getImageData: record('getImageData', () => ctx.imageData),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    arc: record('arc'),
    roundRect: record('roundRect'),
    clip: record('clip'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'start',
    calls,
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

// --- canvas.captureStream() -------------------------------------------------
//
// jsdom has no captureStream() at all, so anything that composites to a canvas
// and hands the result to MediaRecorder cannot even be constructed without
// this. The double returns a MediaStream-like object per call and records the
// requested frame rate so tests can assert on it.

export interface CapturedCanvasStream {
  readonly canvas: HTMLCanvasElement
  readonly frameRate: number | undefined
  getTracks(): MediaStreamTrack[]
  getVideoTracks(): MediaStreamTrack[]
  getAudioTracks(): MediaStreamTrack[]
}

let capturedStreams: CapturedCanvasStream[] = []
let originalCaptureStream: unknown

function makeCanvasTrack(canvas: HTMLCanvasElement): MediaStreamTrack {
  return {
    id: 'canvas-video-track',
    kind: 'video',
    label: `canvas ${canvas.width}x${canvas.height}`,
    enabled: true,
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: vi.fn(() => ({ width: canvas.width, height: canvas.height })),
  } as unknown as MediaStreamTrack
}

/**
 * Patch HTMLCanvasElement.prototype.captureStream. Scope this to the tests
 * that need it (install in beforeEach, uninstall in afterEach).
 */
export function installCanvasCaptureStreamDouble(): void {
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  if (originalCaptureStream !== undefined) return
  originalCaptureStream = proto.captureStream ?? null
  proto.captureStream = function (this: HTMLCanvasElement, frameRate?: number) {
    const track = makeCanvasTrack(this)
    const stream: CapturedCanvasStream = {
      canvas: this,
      frameRate,
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
    }
    capturedStreams.push(stream)
    return stream
  }
}

export function uninstallCanvasCaptureStreamDouble(): void {
  if (originalCaptureStream === undefined) return
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  if (originalCaptureStream === null) {
    delete proto.captureStream
  } else {
    proto.captureStream = originalCaptureStream
  }
  originalCaptureStream = undefined
  capturedStreams = []
}

/** Every stream handed out by the captureStream double, oldest first. */
export function getCapturedCanvasStreams(): CapturedCanvasStream[] {
  return capturedStreams
}
