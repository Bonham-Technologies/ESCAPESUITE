import type { BrowserContext, CDPSession, Page } from '@playwright/test'

/**
 * Resource-leak probe (ESCSUITE-350): how many of the browser's scarce media
 * resources does the page hold right now?
 *
 * A preview that freezes after a while, and comes back on a reload "five or
 * six times" before it stops coming back, is the shape of an exhausted
 * resource: live AudioContexts, media players, WebCodecs decoders, workers or
 * blob URLs that are made and never let go. This probe wraps every way the
 * page makes one and counts the ones still *live*, so a soak can assert the
 * counts stay flat.
 *
 * "Live", per kind:
 *
 * | Kind | Live while |
 * |---|---|
 * | `audioContext` | reachable and `state !== 'closed'` (`close()` ends it) |
 * | `offlineAudioContext` | reachable and `state !== 'closed'` (finishing a render closes it) |
 * | `videoDecoder`, `audioDecoder` | reachable and `state !== 'closed'` (`close()`, an error, or Chromium reclaiming it) |
 * | `worker` | reachable and not `terminate()`d |
 * | `objectUrl` | made by `URL.createObjectURL` and not yet revoked (a URL is never collected) |
 * | `mediaElement` | reachable and holding a source: a non-empty `src` attribute or a `srcObject`, and `networkState` is not `NETWORK_EMPTY` |
 *
 * "Reachable" is a `WeakRef` that still derefs. {@link readLiveCounts} forces
 * a full garbage collection first (Chromium's DevTools protocol), so an object
 * the page has dropped stops counting even though nothing closed it: a
 * detached `<video>` nobody references takes its media player with it when it
 * is collected, so that is not a leak. Chromium does not always collect a
 * dropped element that still has a source (it kept one in about half the
 * runs of `tests/media-health/resource-probe.spec.ts`'s experiment), and the
 * probe then counts it: an app that wants its players gone releases them.
 *
 * A media element is *released* the way `usePreviewMedia.ts` does it
 * (`src = ''`) or the way the spec says (`removeAttribute('src')` then
 * `load()`, which empties `networkState`). ARTIST's preview `<video>`s are
 * never attached to the document, so attachment is not part of the
 * definition: an element in the DOM with a source is a player too.
 *
 * Caveat: `installMediaHealthProbe` (`mediaHealth.ts`) keeps a strong
 * reference to every media element it sees, so with both probes installed a
 * dropped-but-unreleased element stays reachable and keeps counting. That
 * errs towards reporting a leak, never towards hiding one.
 *
 * Workers (ESCSUITE-366): the probe is also prepended to every dedicated
 * worker script the page loads (`probeWorkerScripts`), so the decode worker's
 * `VideoDecoder` (`workers/decodeWorker.ts`) and any blob URL a worker makes
 * are counted, and `readLiveCounts` adds them to the page's, sites prefixed
 * `worker:`.
 *
 * Blind spots:
 * - Workers started from a `blob:` or `data:` URL (the single-file builds
 *   inline theirs this way), shared and service workers are not probed.
 * - In a module worker, a decoder made while its static imports load is
 *   missed: imports evaluate before the prepended probe.
 * - Media elements made by `cloneNode`, `innerHTML` or parsed markup are not
 *   tracked; only `document.createElement` and `new Audio()` are.
 * - A worker that ends itself with `self.close()` is still counted live:
 *   only `terminate()` from the page is seen.
 *
 * It composes with `installMediaHealthProbe`: both wrap whatever
 * `Document.prototype.createElement` is when their init script runs, so
 * either order keeps both. Install it before the page loads: on the
 * `context`, or on the `page` before its `goto`.
 */

/** The resource kinds the probe counts. */
export const RESOURCE_KINDS = [
  'audioContext',
  'offlineAudioContext',
  'videoDecoder',
  'audioDecoder',
  'worker',
  'objectUrl',
  'mediaElement',
] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]
export type ResourceCounts = Record<ResourceKind, number>

/** One live resource, and the first app frame of the stack that made it. */
export interface LiveResource {
  kind: ResourceKind
  site: string
}

export interface ResourceSnapshot {
  /** Live now (see the table above). */
  live: ResourceCounts
  /** Made since the page loaded, live or not. */
  created: ResourceCounts
  /** Every live resource with its creation site, for a failure message. */
  liveSites: LiveResource[]
}

/**
 * The probe itself, run before any page script (an init script) and before
 * any dedicated worker's script (`probeWorkerScripts`). Self-contained: it is
 * serialised into each scope, so it may not reach anything outside itself.
 */
function resourceProbeScript(): void {
  type Kind =
    | 'audioContext'
    | 'offlineAudioContext'
    | 'videoDecoder'
    | 'audioDecoder'
    | 'worker'
    | 'objectUrl'
    | 'mediaElement'
  interface Entry {
    kind: Kind
    ref: WeakRef<object>
    site: string
    released: boolean
  }
  interface Probe {
    entries: Entry[]
    urls: Map<string, string>
    created: Record<Kind, number>
    snapshot: () => {
      live: Record<Kind, number>
      created: Record<Kind, number>
      liveSites: Array<{ kind: Kind; site: string }>
    }
  }
  // `globalThis`, not `window`: the same script also runs in each dedicated
  // worker's scope (see `probeWorkerScripts`), where there is no window, no
  // document and no media element.
  const w = globalThis as unknown as { __resourceProbe?: Probe }
  if (w.__resourceProbe) return

  const kinds: Kind[] = [
    'audioContext',
    'offlineAudioContext',
    'videoDecoder',
    'audioDecoder',
    'worker',
    'objectUrl',
    'mediaElement',
  ]
  const zero = () => Object.fromEntries(kinds.map((k) => [k, 0])) as Record<Kind, number>
  const entries: Entry[] = []
  const urls = new Map<string, string>()
  const created = zero()
  const byObject = new WeakMap<object, Entry>()

  // Where the app made it: the first frame in its own source, else the
  // first in a dependency, else the top of the stack.
  const site = (): string => {
    const lines = (new Error().stack ?? '').split('\n').slice(1)
    const at =
      lines.find((l) => /\/src\//.test(l)) ?? lines.find((l) => /\/node_modules\//.test(l)) ?? lines[2]
    return (at ?? '(unknown)').trim().replace(/\?[^:)]*/, '')
  }
  // Every worker's creations are also reported to the page over a channel of
  // the probe's own, so `created` still counts what a worker made after the
  // worker is terminated (ESCSUITE-366): a decode worker can make its decoders
  // and be gone between two reads.
  const inWorker = typeof document === 'undefined'
  const workerCreated = zero()
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('__resourceProbe') : null
  if (channel && !inWorker) {
    channel.onmessage = (event: MessageEvent) => {
      const kind = event.data as Kind
      if (kinds.includes(kind)) workerCreated[kind]++
    }
  }
  const report = (kind: Kind) => {
    if (inWorker) channel?.postMessage(kind)
  }

  const track = (kind: Kind, obj: object) => {
    report(kind)
    const entry: Entry = { kind, ref: new WeakRef(obj), site: site(), released: false }
    entries.push(entry)
    byObject.set(obj, entry)
    created[kind]++
  }

  const isLive = (entry: Entry): boolean => {
    if (entry.released) return false
    const obj = entry.ref.deref()
    if (!obj) return false
    switch (entry.kind) {
      case 'audioContext':
      case 'offlineAudioContext':
        return (obj as BaseAudioContext).state !== 'closed'
      case 'videoDecoder':
      case 'audioDecoder':
        return (obj as VideoDecoder).state !== 'closed'
      case 'worker':
        return true
      case 'mediaElement': {
        const el = obj as HTMLMediaElement
        const hasSource = !!el.getAttribute('src') || !!el.srcObject || !!el.querySelector('source[src]')
        // 0 is NETWORK_EMPTY, spelled out: a worker scope has no HTMLMediaElement.
      return hasSource && el.networkState !== 0
      }
      default:
        return false
    }
  }

  // Constructors: subclass, so `instanceof` and statics keep working.
  // A worker's script URL gets a marker that `probeWorkerScripts` routes on,
  // strips, and answers with the probe prepended (ESCSUITE-366). Only an
  // http(s) URL without a fragment: a blob: or data: worker is no request.
  const WORKER_MARK = '__resourceProbe'
  const markWorkerUrl = (scriptUrl: unknown): unknown => {
    try {
      const url = new URL(String(scriptUrl), location.href)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hash) return scriptUrl
      return `${url.href}${url.search ? '&' : '?'}${WORKER_MARK}`
    } catch {
      return scriptUrl
    }
  }

  const wrapCtor = <T extends abstract new (...args: never[]) => object>(name: string, kind: Kind) => {
    const Original = (globalThis as unknown as Record<string, T | undefined>)[name]
    if (typeof Original !== 'function') return
    const Wrapped = class extends (Original as unknown as new (...args: unknown[]) => object) {
      constructor(...args: unknown[]) {
        if (kind === 'worker') args[0] = markWorkerUrl(args[0])
        super(...args)
        track(kind, this)
      }
    }
    Object.defineProperty(Wrapped, 'name', { value: name })
    ;(globalThis as unknown as Record<string, unknown>)[name] = Wrapped
  }
  wrapCtor('AudioContext', 'audioContext')
  wrapCtor('OfflineAudioContext', 'offlineAudioContext')
  wrapCtor('VideoDecoder', 'videoDecoder')
  wrapCtor('AudioDecoder', 'audioDecoder')
  wrapCtor('Worker', 'worker')
  // Some code still reaches for the prefixed name.
  const legacy = globalThis as unknown as { webkitAudioContext?: unknown; AudioContext: unknown }
  if (legacy.webkitAudioContext) legacy.webkitAudioContext = legacy.AudioContext

  if (typeof Worker === 'function') {
    const originalTerminate = Worker.prototype.terminate
    Worker.prototype.terminate = function (this: Worker) {
      const entry = byObject.get(this)
      if (entry) entry.released = true
      return originalTerminate.call(this)
    }
  }

  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = function (obj: Blob | MediaSource) {
    const url = originalCreate.call(URL, obj)
    urls.set(url, site())
    created.objectUrl++
    report('objectUrl')
    return url
  }
  URL.revokeObjectURL = function (url: string) {
    urls.delete(url)
    return originalRevoke.call(URL, url)
  }

  // Media elements: `createElement` (composed with any earlier wrapper,
  // such as mediaHealth's) and the `Audio` constructor. Window only.
  if (typeof Document === 'function') {
    const previousCreateElement = Document.prototype.createElement
    Document.prototype.createElement = function (
      this: Document,
      tagName: string,
      options?: ElementCreationOptions
    ) {
      const el = previousCreateElement.call(this, tagName, options)
      if (el instanceof HTMLMediaElement) track('mediaElement', el)
      return el
    } as typeof Document.prototype.createElement
    const OriginalAudio = window.Audio
    window.Audio = function (src?: string) {
      const el = new OriginalAudio(src)
      track('mediaElement', el)
      return el
    } as unknown as typeof Audio
    window.Audio.prototype = OriginalAudio.prototype
  }

  w.__resourceProbe = {
    entries,
    urls,
    created,
    snapshot: () => {
      const live = zero()
      const liveSites: Array<{ kind: Kind; site: string }> = []
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        if (isLive(entry)) {
          live[entry.kind]++
          liveSites.push({ kind: entry.kind, site: entry.site })
        } else if (!entry.ref.deref()) {
          // Collected: it can never be live again, so stop scanning it.
          entries.splice(i, 1)
        }
      }
      live.objectUrl = urls.size
      for (const s of urls.values()) liveSites.push({ kind: 'objectUrl', site: s })
      // In the page, `created` includes what every worker made (reported over
      // the channel); a worker's own snapshot reports only its own.
      const all = zero()
      for (const kind of kinds) all[kind] = created[kind] + workerCreated[kind]
      return { live, created: all, liveSites }
    },
  }
}

/**
 * Prepend the probe to every dedicated worker script the target's pages start
 * (ESCSUITE-366). An init script runs in page frames only, and a worker
 * started under the DevTools protocol is not reliably held for an injection
 * (Playwright's own session resumes it, so a probe evaluated over the
 * protocol raced the worker's first line and lost about one run in three).
 * Rewriting the script has no race.
 *
 * The probe's `Worker` wrapper marks the script URL (`?__resourceProbe`, or
 * `&` after an existing query); this route answers exactly those requests,
 * fetching the unmarked URL and prepending the probe, so the server never
 * sees the marker. In a module worker the script's static imports evaluate
 * before the probe (imports are hoisted), so a dependency that made a decoder
 * while it loaded would be missed; ARTIST's decode worker makes its decoders
 * on messages, after.
 */
async function probeWorkerScripts(target: Page | BrowserContext): Promise<void> {
  const probe = `;(${resourceProbeScript.toString()})();\n`
  await target.route(/[?&]__resourceProbe$/, async (route) => {
    const url = route.request().url().replace(/[?&]__resourceProbe$/, '')
    const response = await route.fetch({ url })
    await route.fulfill({ response, body: probe + (await response.text()) })
  })
}

/**
 * Install the probe in `target`'s pages and in every dedicated worker those
 * pages start from an http(s) URL (a `blob:` or `data:` worker is not a
 * request, so it is not probed). Call it before the page loads: on the `context`
 * (each new page gets it), or on the `page` before its `goto`.
 */
export async function installResourceProbe(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(resourceProbeScript)
  await probeWorkerScripts(target)
}

/**
 * A full collection in each of the page's dedicated workers: each has its own
 * heap, which the page's collection does not touch. Attaching without
 * `waitForDebuggerOnStart` reports the running workers at once and pauses
 * nothing. Non-flat sessions (`Target.sendMessageToTarget`), because
 * Playwright's `CDPSession` cannot address a child session directly.
 */
async function collectWorkerGarbage(cdp: CDPSession): Promise<void> {
  const workers: string[] = []
  const onAttached = ({ sessionId, targetInfo }: { sessionId: string; targetInfo: { type: string } }) => {
    if (targetInfo.type === 'worker') workers.push(sessionId)
  }
  cdp.on('Target.attachedToTarget', onAttached)
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false })
  cdp.off('Target.attachedToTarget', onAttached)
  const done = new Map<number, () => void>()
  const onMessage = ({ message }: { message: string }) => done.get((JSON.parse(message) as { id?: number }).id ?? -1)?.()
  cdp.on('Target.receivedMessageFromTarget', onMessage)
  try {
    await Promise.all(
      workers.map(
        (sessionId, i) =>
          new Promise<void>((resolve) => {
            done.set(i + 1, resolve)
            const message = JSON.stringify({ id: i + 1, method: 'HeapProfiler.collectGarbage' })
            // A worker that ended meanwhile has nothing left to collect.
            cdp.send('Target.sendMessageToTarget', { sessionId, message }).catch(() => resolve())
            setTimeout(resolve, 5_000)
          })
      )
    )
  } finally {
    cdp.off('Target.receivedMessageFromTarget', onMessage)
  }
}

/**
 * Collect garbage, then read the page's live counts, its dedicated workers'
 * included (ESCSUITE-366). Chromium only: the collection goes through the
 * DevTools protocol, so an object the page or a worker has dropped is not
 * counted as held.
 *
 * A worker's live resources are added to the page's, their sites prefixed
 * `worker:`. A terminated worker takes its resources with it, but not its
 * `created` counts: each worker reports what it makes to the page over a
 * `BroadcastChannel` as it makes it, so `created` covers every worker the
 * page started (counted a moment after the worker made it).
 */
export async function readLiveCounts(page: Page): Promise<ResourceSnapshot> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('HeapProfiler.collectGarbage')
    await collectWorkerGarbage(cdp)
  } finally {
    await cdp.detach()
  }
  const snapshot = (await page.evaluate(() => {
    const probe = (window as unknown as { __resourceProbe?: { snapshot: () => unknown } }).__resourceProbe
    return probe ? probe.snapshot() : null
  })) as ResourceSnapshot | null
  if (!snapshot) throw new Error('installResourceProbe must run before the page loads')
  for (const worker of page.workers()) {
    const inWorker = (await worker
      .evaluate(() => {
        const probe = (globalThis as unknown as { __resourceProbe?: { snapshot: () => unknown } }).__resourceProbe
        return probe ? probe.snapshot() : null
      })
      .catch(() => null)) as ResourceSnapshot | null
    if (!inWorker) continue
    for (const kind of RESOURCE_KINDS) {
      snapshot.live[kind] += inWorker.live[kind]
    }
    for (const r of inWorker.liveSites) snapshot.liveSites.push({ kind: r.kind, site: `worker: ${r.site}` })
  }
  return snapshot
}

/**
 * The live resources of each kind that grew past `allowed`, grouped by
 * creation site: what a soak's failure message names.
 */
export function describeGrowth(
  baseline: ResourceCounts,
  now: ResourceSnapshot,
  allowed: ResourceCounts
): string[] {
  const problems: string[] = []
  for (const kind of RESOURCE_KINDS) {
    const limit = baseline[kind] + allowed[kind]
    if (now.live[kind] <= limit) continue
    const sites = new Map<string, number>()
    for (const r of now.liveSites) if (r.kind === kind) sites.set(r.site, (sites.get(r.site) ?? 0) + 1)
    const where = [...sites].map(([s, n]) => `${n}× ${s}`).join('; ')
    problems.push(
      `${kind}: ${now.live[kind]} live (baseline ${baseline[kind]} + allowed ${allowed[kind]} = ${limit}; ` +
        `${now.created[kind]} made in all). Live ones were made at: ${where}`
    )
  }
  return problems
}
