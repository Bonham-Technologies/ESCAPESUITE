import { BrowserContext, Page } from '@playwright/test'

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

export async function installResourceProbe(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
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
    const w = window as unknown as { __resourceProbe?: Probe }
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
    const track = (kind: Kind, obj: object) => {
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
          return hasSource && el.networkState !== HTMLMediaElement.NETWORK_EMPTY
        }
        default:
          return false
      }
    }

    // Constructors: subclass, so `instanceof` and statics keep working.
    const wrapCtor = <T extends abstract new (...args: never[]) => object>(name: string, kind: Kind) => {
      const Original = (window as unknown as Record<string, T | undefined>)[name]
      if (typeof Original !== 'function') return
      const Wrapped = class extends (Original as unknown as new (...args: unknown[]) => object) {
        constructor(...args: unknown[]) {
          super(...args)
          track(kind, this)
        }
      }
      Object.defineProperty(Wrapped, 'name', { value: name })
      ;(window as unknown as Record<string, unknown>)[name] = Wrapped
    }
    wrapCtor('AudioContext', 'audioContext')
    wrapCtor('OfflineAudioContext', 'offlineAudioContext')
    wrapCtor('VideoDecoder', 'videoDecoder')
    wrapCtor('AudioDecoder', 'audioDecoder')
    wrapCtor('Worker', 'worker')
    // Some code still reaches for the prefixed name.
    const legacy = window as unknown as { webkitAudioContext?: unknown; AudioContext: unknown }
    if (legacy.webkitAudioContext) legacy.webkitAudioContext = legacy.AudioContext

    const originalTerminate = Worker.prototype.terminate
    Worker.prototype.terminate = function (this: Worker) {
      const entry = byObject.get(this)
      if (entry) entry.released = true
      return originalTerminate.call(this)
    }

    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = function (obj: Blob | MediaSource) {
      const url = originalCreate.call(URL, obj)
      urls.set(url, site())
      created.objectUrl++
      return url
    }
    URL.revokeObjectURL = function (url: string) {
      urls.delete(url)
      return originalRevoke.call(URL, url)
    }

    // Media elements: `createElement` (composed with any earlier wrapper,
    // such as mediaHealth's) and the `Audio` constructor.
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
        return { live, created: { ...created }, liveSites }
      },
    }
  })
}

/**
 * Collect garbage, then read the page's live counts. Chromium only: the
 * collection goes through the DevTools protocol, so an object the page has
 * dropped is not counted as held.
 */
export async function readLiveCounts(page: Page): Promise<ResourceSnapshot> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('HeapProfiler.collectGarbage')
  } finally {
    await cdp.detach()
  }
  const snapshot = await page.evaluate(() => {
    const probe = (window as unknown as { __resourceProbe?: { snapshot: () => unknown } }).__resourceProbe
    return probe ? probe.snapshot() : null
  })
  if (!snapshot) throw new Error('installResourceProbe must run before the page loads')
  return snapshot as ResourceSnapshot
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
