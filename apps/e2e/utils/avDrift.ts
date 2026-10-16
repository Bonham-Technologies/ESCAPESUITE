import type { Page } from '@playwright/test'

/**
 * In-page instruments for the ESCAPECRAFT A/V drift rig (ESCSUITE-296/297,
 * `tests/perf/craft-av-drift.spec.ts`). Nothing under `apps/craft/src` exists
 * for them: every number comes from wrappers an init script installs before
 * the app's first line runs.
 *
 * - **Lost `onaudioprocess` callbacks (H1a).** `createScriptProcessor` is
 *   wrapped so every node's `onaudioprocess` *setter* wraps the handler the
 *   app assigns, logging `[event.playbackTime, performance.now(),
 *   context.currentTime, inputBuffer.length, inputBuffer.sampleRate]` per call
 *   into `window.__spLog[nodeIndex]`. A callback the browser never
 *   dispatched shows up as a `playbackTime` step of more than one buffer, so
 *   lost callbacks per node = Σ `(Δplayback / (bufferSize / sampleRate)) − 1`
 *   over consecutive callbacks, computed in its telescoped form
 *   `round(playback span / buffer) − (callbacks − 1)`. Measured 2026-10-15 on
 *   the bundled Chromium, headless: `playbackTime` is buffer-aligned at idle
 *   (100 % of steps) but, once the main thread is late, it is the context
 *   time *at dispatch* (15 % aligned under the `jank` load) — a late callback
 *   reads ~2 buffers on and the queued one behind it ~0 — so rounding each
 *   step on its own, or counting only the steps above one, reports losses
 *   that never happened (+87 and −25 on the same take, against 0 here).
 *   That measures H1a from the page, independent of the file.
 * - **Render clock vs `performance.now()` (H1b).** The `AudioContext`
 *   constructor is wrapped (a subclass, so `instanceof` still holds) and every
 *   context is sampled once a second: `[performance.now(), currentTime,
 *   getOutputTimestamp().contextTime, getOutputTimestamp().performanceTime]`
 *   into `window.__clockLog[contextIndex]`. ε = Δcontext / Δperformance − 1.
 * - **The context's real rate (H3).** Each context's `sampleRate`, and the
 *   rate it was asked for, are recorded.
 *
 * The synthetic capture devices' own contexts (`mockSyntheticMedia`) are
 * created through the same wrapped constructor; they are told apart from the
 * app's by the call stack at construction (`makeAudioTrack`), recorded as
 * `synthetic`.
 */

/**
 * One dispatched callback: `[event.playbackTime, performance.now() at
 * dispatch, context.currentTime at dispatch, inputBuffer.length,
 * inputBuffer.sampleRate]`.
 */
export type SpCall = [number, number, number, number, number]

export interface SpNodeLog {
  contextIndex: number
  bufferSize: number
  sampleRate: number
  calls: SpCall[]
}

/** What `window.__spStats()` reports per node — see `spStats` in the init script. */
export interface SpStats {
  callbacks: number
  naive: number
  robust: number
  alignedShare: number
  offsetMs: { min: number; p50: number; p95: number; max: number }
  dispatchIntervalMs: { min: number; p50: number; p95: number; max: number }
  latenessSwingMs: number
  offsetSpreadMs: number
  r: number
  slope: number
  /** Floor of the unfilled `playbackTime − expected` over the last window, ms: content lost, in any unit. */
  deficitAtEndMs: number
  /** `playbackTime − currentTime` at dispatch, ms — constant when `playbackTime` is read at dispatch. */
  playbackMinusCurrentTimeMs: { min: number; p50: number; p95: number; max: number } | null
  verdict: string
}

export interface ContextRecord {
  index: number
  synthetic: boolean
  sampleRate: number
  requestedSampleRate: number | null
  createdAt: number
  state: string
  baseLatency: number | null
  outputLatency: number | null
  /** `[performance.now(), currentTime, ots.contextTime, ots.performanceTime]` once a second. */
  clock: [number, number, number, number][]
}

export interface DriftSnapshot {
  nodes: SpNodeLog[]
  contexts: ContextRecord[]
  playbackTimeAvailable: boolean
}

interface AvDriftWindow {
  __spLog: SpCall[][]
  __spNodes: { contextIndex: number; bufferSize: number; sampleRate: number }[]
  __clockLog: [number, number, number, number][][]
  __avContexts: AudioContext[]
  __avContextMeta: { synthetic: boolean; requestedSampleRate: number | null; createdAt: number }[]
  __spLostCallbacks: (fromPerf?: number, toPerf?: number) => number
  __spStats: (fromPerf?: number, toPerf?: number) => (SpStats | null)[]
  __avEpsilon: () => { index: number; synthetic: boolean; ppmCurrentTime: number | null; ppmOutputTimestamp: number | null }[]
  __avDriftSnapshot: () => DriftSnapshot
}

/** Install the instruments. Must be called BEFORE navigating. */
export async function installAvDriftInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as AvDriftWindow
    if (w.__spLog) return
    w.__spLog = []
    w.__spNodes = []
    w.__clockLog = []
    w.__avContexts = []
    w.__avContextMeta = []

    const NativeAudioContext = window.AudioContext
    const register = (ctx: AudioContext, options?: AudioContextOptions) => {
      const stack = new Error().stack ?? ''
      w.__avContexts.push(ctx)
      w.__avContextMeta.push({
        synthetic: /makeAudioTrack|makeMarkerAudioTrack/.test(stack),
        requestedSampleRate: options?.sampleRate ?? null,
        createdAt: performance.now(),
      })
      w.__clockLog.push([])
    }
    class InstrumentedAudioContext extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options)
        register(this, options)
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      value: InstrumentedAudioContext,
      writable: true,
      configurable: true,
    })

    // Sample every live context once a second. A stalled main thread only
    // delays the sample; the pair inside it is read at one instant.
    setInterval(() => {
      const now = performance.now()
      w.__avContexts.forEach((ctx, i) => {
        if (ctx.state === 'closed') return
        const ots = ctx.getOutputTimestamp()
        w.__clockLog[i].push([now, ctx.currentTime, ots.contextTime ?? 0, ots.performanceTime ?? 0])
      })
    }, 1000)

    const handlerDescriptor = Object.getOwnPropertyDescriptor(
      ScriptProcessorNode.prototype,
      'onaudioprocess'
    )!
    const base = BaseAudioContext.prototype as unknown as {
      createScriptProcessor: (...args: number[]) => ScriptProcessorNode
    }
    const nativeCreate = base.createScriptProcessor
    base.createScriptProcessor = function instrumentedCreate(
      this: BaseAudioContext,
      ...args: number[]
    ) {
      const node = nativeCreate.apply(this, args)
      const calls: SpCall[] = []
      w.__spLog.push(calls)
      w.__spNodes.push({
        contextIndex: w.__avContexts.indexOf(this as AudioContext),
        bufferSize: node.bufferSize,
        sampleRate: this.sampleRate,
      })
      let assigned: ((event: AudioProcessingEvent) => unknown) | null = null
      Object.defineProperty(node, 'onaudioprocess', {
        configurable: true,
        get: () => assigned,
        set(handler: ((event: AudioProcessingEvent) => unknown) | null) {
          assigned = handler
          const wrapped = handler
            ? function (this: ScriptProcessorNode, event: AudioProcessingEvent) {
                calls.push([
                  event.playbackTime,
                  performance.now(),
                  node.context.currentTime,
                  event.inputBuffer.length,
                  event.inputBuffer.sampleRate,
                ])
                return handler.call(this, event)
              }
            : null
          handlerDescriptor.set!.call(node, wrapped)
        },
      })
      return node
    }

    const lostInNode = (index: number, fromPerf: number, toPerf: number): number => {
      const { bufferSize, sampleRate } = w.__spNodes[index]
      const calls = w.__spLog[index].filter(([, at]) => at >= fromPerf && at <= toPerf)
      if (calls.length < 2) return 0
      // Σ (round(Δplayback / buffer) − 1) over consecutive callbacks, taken in
      // its telescoped form: rounding each term on its own is only exact while
      // every Δ is a whole number of buffers.
      const span = calls[calls.length - 1][0] - calls[0][0]
      return Math.round(span / (bufferSize / sampleRate)) - (calls.length - 1)
    }
    w.__spLostCallbacks = (fromPerf = -Infinity, toPerf = Infinity) =>
      w.__spLog.reduce((sum, _calls, i) => sum + lostInNode(i, fromPerf, toPerf), 0)

    /**
     * The fix's gap-fill rule (ESCSUITE-296, after the rig's 2026-10-15 jank
     * measurement): Chromium's `playbackTime` is read at *dispatch* — one buffer
     * ahead of `currentTime` at dispatch at p5–p95 under the `jank` load, its
     * offset tracking dispatch lateness with r = 1.00 — so a merely late callback
     * looks like a gap. That take showed lateness above half a buffer sustained
     * across 8 callbacks with nothing lost, so a loss is counted only when the
     * minimum offset over the last max(8 callbacks, ~2 s) reaches 0.95 of a
     * buffer, and then whole buffers are filled.
     */
    const FILL_THRESHOLD_BUFFERS = 0.95
    const FILL_WINDOW_MIN_CALLBACKS = 8
    const FILL_WINDOW_SECONDS = 2

    /**
     * `playbackTime` semantics and lost-callback counts for one ScriptProcessor
     * node (ESCSUITE-296 review). `calls` are `[playbackTime, perfNow, ctxNow,
     * bufferLength, sampleRate]`. Returns
     * - `naive`: Σ (round(Δplayback / buffer) − 1), every term rounded on its own;
     * - `robust`: the fix's rule — expected = anchor + samples delivered ÷ rate,
     *   offset = playbackTime − expected; a loss is counted only when the minimum
     *   offset over the last max(8 callbacks, ~2 s) reaches 0.95 of a buffer
     *   (`FILL_THRESHOLD_BUFFERS`), and then whole buffers are filled and the
     *   anchor advances by the buffers filled;
     * - the offset and dispatch-interval distributions (ms: min, p50, p95, max);
     * - `r` / `slope`: offset against dispatch lateness (how far each callback ran
     *   behind its steady schedule) — near 1 when `playbackTime` is read at
     *   dispatch, near 0 with a flat offset when it is the render position;
     * - `verdict`: one line.
     */
    const spStats = (calls: number[][], bufferSize: number, sampleRate: number): SpStats | null => {
      const n = calls.length
      if (n < 2) return null
      const period = bufferSize / sampleRate
      const windowSize = Math.max(FILL_WINDOW_MIN_CALLBACKS, Math.ceil(FILL_WINDOW_SECONDS / period))
      let naive = 0
      let aligned = 0
      for (let i = 1; i < n; i++) {
        const delta = calls[i][0] - calls[i - 1][0]
        const steps = Math.round(delta / period)
        naive += steps - 1
        if (Math.abs(delta - steps * period) < 0.001) aligned++
      }
      const anchor = calls[0][0]
      let delivered = 0
      let robust = 0
      const recent: number[] = []
      const offsets: number[] = []
      const lateness: number[] = []
      for (let i = 0; i < n; i++) {
        let expectedRel = delivered / sampleRate
        let offset = calls[i][0] - anchor - expectedRel
        recent.push(offset)
        if (recent.length > windowSize) recent.shift()
        if (recent.length === windowSize) {
          const least = Math.min(...recent)
          if (least >= FILL_THRESHOLD_BUFFERS * period) {
            const filled = Math.max(1, Math.round(least / period))
            robust += filled
            delivered += filled * bufferSize
            expectedRel = delivered / sampleRate
            offset -= filled * period
            for (let j = 0; j < recent.length; j++) recent[j] -= filled * period
          }
        }
        offsets.push(offset * 1000)
        lateness.push(calls[i][1] - calls[0][1] - expectedRel * 1000)
        delivered += calls[i][3] || bufferSize
      }
      const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)
      const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]
      const dist = (xs: number[]) => {
        const s = sorted(xs)
        return { min: s[0], p50: q(s, 0.5), p95: q(s, 0.95), max: s[s.length - 1] }
      }
      const dispatch = calls.slice(1).map((c, i) => c[1] - calls[i][1])
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
      const mo = mean(offsets)
      const ml = mean(lateness)
      let sxy = 0
      let sxx = 0
      let syy = 0
      for (let i = 0; i < n; i++) {
        sxy += (lateness[i] - ml) * (offsets[i] - mo)
        sxx += (lateness[i] - ml) ** 2
        syy += (offsets[i] - mo) ** 2
      }
      const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0
      const slope = sxx > 0 ? sxy / sxx : 0
      const so = sorted(offsets)
      const offsetSpread = q(so, 0.95) - q(so, 0.05)
      const sl = sorted(lateness.map((x) => x - q(sorted(lateness), 0.5)))
      const jitter = q(sl, 0.95) - q(sl, 0.05)
      const fmt = (x: number) => x.toFixed(1)
      let verdict: string
      if (offsetSpread < 1) {
        verdict =
          jitter > 5
            ? `render-position-based: offset flat (p5–p95 spread ${fmt(offsetSpread)} ms) while dispatch lateness swings ${fmt(jitter)} ms`
            : `render-position-based as far as this shows, but dispatch lateness only swings ${fmt(jitter)} ms — too little jitter to tell`
      } else if (r > 0.7) {
        verdict = `dispatch-time-based: offset follows dispatch lateness (r = ${r.toFixed(2)}, slope ${slope.toFixed(2)}; offset spread ${fmt(offsetSpread)} ms, lateness swing ${fmt(jitter)} ms)`
      } else {
        verdict = `unclear: offset spread ${fmt(offsetSpread)} ms, r = ${r.toFixed(2)} against a lateness swing of ${fmt(jitter)} ms`
      }
      // Direct check, where the page logged `currentTime` at dispatch: a
      // render-position playbackTime moves independently of it, a dispatch-time
      // one sits a constant buffer ahead of it.
      const ahead = calls.filter((c) => Number.isFinite(c[2]) && c[2] > 0).map((c) => (c[0] - c[2]) * 1000)
      const aheadDist = ahead.length > 1 ? dist(ahead) : null
      if (aheadDist) {
        const sa = sorted(ahead)
        verdict += `; playbackTime − currentTime at dispatch: p50 ${fmt(aheadDist.p50)} ms, p5–p95 spread ${fmt(q(sa, 0.95) - q(sa, 0.05))} ms`
      }
      // The content deficit, not rounded to buffers: the floor of the raw
      // (never-filled) offset over the last window. In the 60 s jank take it crept
      // up in render-quantum steps (128 samples, 2.67 ms) to ~43 ms with every
      // callback accounted for — loss smaller than a buffer, which a rule that
      // fills whole buffers cannot see.
      const rawTail = calls.slice(-windowSize).map((c, i, tail) => {
        const index = n - tail.length + i
        return (c[0] - anchor - (index * bufferSize) / sampleRate) * 1000
      })
      const deficitAtEndMs = Math.min(...rawTail)
      return {
        deficitAtEndMs,
        playbackMinusCurrentTimeMs: aheadDist,
        callbacks: n,
        naive,
        robust,
        alignedShare: aligned / (n - 1),
        offsetMs: dist(offsets),
        dispatchIntervalMs: dist(dispatch),
        latenessSwingMs: jitter,
        offsetSpreadMs: offsetSpread,
        r,
        slope,
        verdict,
      }
    }
    w.__spStats = (fromPerf = -Infinity, toPerf = Infinity) =>
      w.__spLog.map((calls, i) =>
        spStats(
          calls.filter(([, at]) => at >= fromPerf && at <= toPerf),
          w.__spNodes[i].bufferSize,
          w.__spNodes[i].sampleRate
        )
      )

    const ppm = (d1: number, d0: number) => (d0 > 0 ? (d1 / d0 - 1) * 1e6 : null)
    w.__avEpsilon = () =>
      w.__clockLog.map((samples, index) => {
        const live = samples.filter((s) => s[1] > 0)
        const first = live[0]
        const last = live[live.length - 1]
        const withOts = live.filter((s) => s[3] > 0)
        const o0 = withOts[0]
        const o1 = withOts[withOts.length - 1]
        return {
          index,
          synthetic: w.__avContextMeta[index].synthetic,
          ppmCurrentTime:
            first && last && last !== first ? ppm(last[1] - first[1], (last[0] - first[0]) / 1000) : null,
          ppmOutputTimestamp:
            o0 && o1 && o1 !== o0 ? ppm(o1[2] - o0[2], (o1[3] - o0[3]) / 1000) : null,
        }
      })

    w.__avDriftSnapshot = () => ({
      nodes: w.__spNodes.map((meta, i) => ({ ...meta, calls: w.__spLog[i] })),
      contexts: w.__avContexts.map((ctx, index) => ({
        index,
        synthetic: w.__avContextMeta[index].synthetic,
        sampleRate: ctx.sampleRate,
        requestedSampleRate: w.__avContextMeta[index].requestedSampleRate,
        createdAt: w.__avContextMeta[index].createdAt,
        state: ctx.state,
        baseLatency: ctx.baseLatency ?? null,
        outputLatency: (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null,
        clock: w.__clockLog[index],
      })),
      playbackTimeAvailable: w.__spLog.some((calls) => calls.some((c) => c[0] > 0)),
    })
  })
}

/** `__spStats` over a `performance.now()` window: per node, the naive and the fix-rule loss counts and the `playbackTime` semantics verdict. */
export async function readSpStats(page: Page, fromPerf: number, toPerf: number): Promise<(SpStats | null)[]> {
  return page.evaluate(
    ([from, to]) => (window as unknown as AvDriftWindow).__spStats(from, to),
    [fromPerf, toPerf] as const
  )
}

/** Read every instrument out of the page. */
export async function readAvDriftSnapshot(page: Page): Promise<DriftSnapshot> {
  return page.evaluate(() => (window as unknown as AvDriftWindow).__avDriftSnapshot())
}

/** `__spLostCallbacks` over a `performance.now()` window. */
export async function readLostCallbacks(page: Page, fromPerf: number, toPerf: number): Promise<number> {
  return page.evaluate(
    ([from, to]) => (window as unknown as AvDriftWindow).__spLostCallbacks(from, to),
    [fromPerf, toPerf] as const
  )
}

/** ε per context, first-to-last over the whole page life, in ppm. */
export async function readEpsilon(page: Page) {
  return page.evaluate(() => (window as unknown as AvDriftWindow).__avEpsilon())
}
