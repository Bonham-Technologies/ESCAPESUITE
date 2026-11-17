/**
 * The Content-Security-Policy the offline single-file builds carry inside
 * themselves (ESCSUITE-467).
 *
 * The standalone ESCAPECRAFT and ESCAPEARTIST builds are one HTML file each,
 * downloaded from a GitHub Release and opened from disk. Their claim is that
 * they never touch the network. `apps/e2e/tests/standalone/` proves it in CI;
 * this policy makes the browser enforce it: a
 * `<meta http-equiv="Content-Security-Policy">` that admits no network scheme
 * or host in any directive, injected into the built HTML after every other
 * build step has finished changing it.
 *
 * - Scripts: the file's own inline scripts by SHA-256 hash, computed from the
 *   built bytes, never `'unsafe-inline'`. Anything else a page needs at run
 *   time (a blob: decode worker, a data: AudioWorklet module) is a
 *   per-app extra, named in that app's `vite.config.ts`.
 * - Styles: `'unsafe-inline'`. The built CSS is an inline `<style>`, CRAFT's
 *   floating-controls window clones those elements into a second document,
 *   and React and its libraries set inline `style` attributes. No other style
 *   source is allowed, and with `img-src`/`font-src` closed to the network a
 *   stylesheet cannot fetch anything either.
 * - No `'self'`: a file opened from disk has an opaque origin, so `'self'`
 *   means nothing useful there, and served over http it would admit that
 *   server. Nothing in the app needs it.
 * - `frame-ancestors`, `report-uri`, `report-to` and `sandbox` are not allowed
 *   in a `<meta>` policy, so they are not here.
 *
 * What a page CSP does not cover (top-level navigation by a clicked link, the
 * browser's own downloads such as an on-device speech language pack,
 * extensions) is written up in `docs/VERIFY.md` and on the Limitations page.
 *
 * Plain ESM with no dependencies, so both apps' `vite.config.ts` can import it
 * and `node --test scripts/offline-csp.test.mjs` can test it.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** The URL schemes that reach the network. No directive may admit one. */
export const NETWORK_SCHEMES = Object.freeze(['http:', 'https:', 'ws:', 'wss:'])

/**
 * Sources that never reach the network: keywords, hashes and nonces, and the
 * two local schemes. Anything else in a source list (a host, a wildcard,
 * `'self'`, a network scheme, `'strict-dynamic'`, which hands trust to
 * whatever an allowed script loads) is treated as admitting the network.
 */
const LOCAL_KEYWORDS = new Set(["'none'", "'unsafe-inline'", "'wasm-unsafe-eval'"])
const LOCAL_SCHEMES = new Set(['data:', 'blob:'])
const HASH_OR_NONCE = /^'(?:sha(?:256|384|512)|nonce)-[A-Za-z0-9+/_-]+={0,2}'$/

/** Directives that send reports over the network rather than list sources. */
const REPORTING_DIRECTIVES = new Set(['report-uri', 'report-to'])

/**
 * The directives both offline builds share. Each source is here because the
 * standalone suite fails without it (ESCSUITE-467, measured in Chromium):
 * `img-src data:` for the favicon and the CSS's inline SVG icons, `img-src
 * blob:` for thumbnails, `media-src blob:` for playing a take or a clip. Every
 * directive not listed (connect-src, font-src, frame-src, object-src,
 * manifest-src…) falls back to `default-src 'none'`.
 */
const BASE_DIRECTIVES = Object.freeze({
  'default-src': ["'none'"],
  'script-src': [],
  'style-src': ["'unsafe-inline'"],
  'img-src': ['data:', 'blob:'],
  'media-src': ['blob:'],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
})

/**
 * What each app adds to the shared directives, beyond its own script hashes.
 *
 * - ESCAPECRAFT records audio through an AudioWorklet whose module is a
 *   blob: URL, retried as a data: URL where the browser refuses `blob:null`
 *   from a file:// page (ESCSUITE-317). Worklet modules are governed by
 *   `script-src`.
 * - ESCAPEARTIST's decode worker is inlined into the file and started from a
 *   blob: URL (ESCSUITE-153), governed by `worker-src`. Its `?video=` URL
 *   parameter and inbound `LOAD_VIDEO` message fetch the address they are
 *   given (docs/reference/integration-api.md); `connect-src data: blob:` keeps
 *   that working for media carried in the address itself, and refuses every
 *   network address, which the editor then reports by origin.
 */
export const OFFLINE_CSP_EXTRA = Object.freeze({
  craft: Object.freeze({ 'script-src': ['blob:', 'data:'] }),
  artist: Object.freeze({ 'worker-src': ['blob:'], 'connect-src': ['data:', 'blob:'] }),
})

/** The `'sha256-…'` source for one inline script's text, as a browser computes it. */
export function scriptHash(text) {
  // The HTML parser turns CRLF and lone CR into LF before a script runs, and the
  // browser hashes what it parsed.
  const normalized = text.replace(/\r\n?/g, '\n')
  return `'sha256-${createHash('sha256').update(normalized, 'utf8').digest('base64')}'`
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
// `(?:^|\s)` rather than `\b`, so a `data-type=` attribute is not read as the type.
const NON_JS_TYPE = /(?:^|\s)type\s*=\s*["']?(?!module\b|text\/javascript\b|application\/javascript\b)[^"'\s>]+/i

/**
 * Every `<script>` element in `html`, in document order.
 *
 * The single-file build escapes `</script` inside its code as `<\/script`, so
 * a plain scan from each opening tag to the next closing one finds the real
 * element boundaries.
 */
export function findScripts(html) {
  const scripts = []
  for (const match of html.matchAll(SCRIPT_RE)) {
    const attrs = match[1]
    scripts.push({
      index: match.index,
      attrs,
      text: match[2],
      hasSrc: /\bsrc\s*=/i.test(attrs),
      // A data block such as `type="application/ld+json"` never runs, and CSP
      // does not apply to it.
      executable: !NON_JS_TYPE.test(attrs),
    })
  }
  return scripts
}

/**
 * Throw unless `findScripts` found the same `<script>` elements the browser's
 * HTML parser will. Removing every element it found must leave no `<script`
 * or `</script` behind: a leftover means a script's text did not end where
 * this scan thought (for example a `<!--` … `<script` pair inside the code,
 * which makes the parser skip the next `</script>`), so its hash would not be
 * the one the browser computes and the offline file would open blank.
 */
export function assertScriptBoundaries(html) {
  const rest = html.replace(SCRIPT_RE, '')
  const stray = /<\/?script\b/i.exec(rest)
  if (stray) {
    throw new Error(
      `[offline-csp] found a ${stray[0]} outside every <script> element this build could delimit ` +
        `(near "${rest.slice(Math.max(0, stray.index - 40), stray.index + 40)}"); ` +
        'its script hashes would not match what the browser runs.'
    )
  }
  for (const { text } of findScripts(html)) {
    if (/<!--/.test(text) && /<script[\s/>]/i.test(text)) {
      throw new Error(
        '[offline-csp] a <script> contains both "<!--" and "<script", which changes where the browser ends it; ' +
          'its hash would not match what the browser runs.'
      )
    }
  }
}

/** Parse a policy string into `{ name, sources }` directives, in order. */
export function parseCsp(policy) {
  return policy
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...sources] = part.split(/\s+/)
      return { name: name.toLowerCase(), sources }
    })
}

/**
 * Every place `policy` lets the page reach the network, as
 * `{ directive, source }` pairs. An empty array means no directive admits a
 * network scheme or host.
 */
export function networkSources(policy) {
  const found = []
  for (const { name, sources } of parseCsp(policy)) {
    if (REPORTING_DIRECTIVES.has(name)) {
      found.push({ directive: name, source: sources.join(' ') })
      continue
    }
    for (const source of sources) {
      const lower = source.toLowerCase()
      if (LOCAL_KEYWORDS.has(lower) || LOCAL_SCHEMES.has(lower) || HASH_OR_NONCE.test(source)) continue
      found.push({ directive: name, source })
    }
  }
  return found
}

/**
 * The offline policy for a page whose inline scripts hash to `scriptHashes`,
 * plus `extra` sources per directive (for example `{ 'worker-src': ['blob:'] }`).
 * Throws if the result would admit the network.
 */
export function offlineCsp({ scriptHashes, extra = {} }) {
  const directives = new Map(Object.entries(BASE_DIRECTIVES).map(([name, sources]) => [name, [...sources]]))
  directives.set('script-src', [...scriptHashes])
  for (const [name, sources] of Object.entries(extra)) {
    const list = directives.get(name) ?? []
    for (const source of sources) if (!list.includes(source)) list.push(source)
    directives.set(name, list)
  }
  if (directives.get('script-src').length === 0) directives.set('script-src', ["'none'"])

  const policy = [...directives].map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ')
  const leaks = networkSources(policy)
  if (leaks.length > 0) {
    throw new Error(
      `[offline-csp] the offline policy would admit the network: ` +
        leaks.map(({ directive, source }) => `${directive} ${source}`).join(', ')
    )
  }
  return policy
}

const CSP_META_RE = /\bhttp-equiv\s*=\s*["']?content-security-policy\b/i
const CHARSET_META_RE = /<meta\b[^>]*\bcharset\s*=[^>]*>/i

/** Every CSP `<meta>` tag in `html`, with its offset and policy. */
export function findCspMetas(html) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)]
    .filter((match) => CSP_META_RE.test(match[0]))
    .map((match) => {
      const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(match[0])
      return { index: match.index, tag: match[0], policy: content ? decodeAttribute(content[1]) : '' }
    })
}

function decodeAttribute(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

function encodeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * `html` with the offline policy injected as the first element after its
 * `<meta charset>`, ahead of every script. Throws if the page already has a
 * CSP `<meta>`, loads any script from a separate file, or has a `<script>`
 * whose end this scan cannot place exactly (`assertScriptBoundaries`).
 */
export function injectOfflineCsp(html, { extra = {} } = {}) {
  if (findCspMetas(html).length > 0) {
    throw new Error('[offline-csp] the page already has a Content-Security-Policy <meta>; refusing to add a second.')
  }
  assertScriptBoundaries(html)
  const scripts = findScripts(html).filter((script) => script.executable)
  const external = scripts.filter((script) => script.hasSrc)
  if (external.length > 0) {
    throw new Error(
      `[offline-csp] the single-file page loads ${external.length} script(s) from a separate file ` +
        `(${external.map((s) => s.attrs.trim()).join('; ')}); the offline policy admits none.`
    )
  }
  const policy = offlineCsp({ scriptHashes: scripts.map((script) => scriptHash(script.text)), extra })
  const tag = `<meta http-equiv="Content-Security-Policy" content="${encodeAttribute(policy)}" />`

  const charset = CHARSET_META_RE.exec(html)
  if (!charset) throw new Error('[offline-csp] the page has no <meta charset>; cannot place the policy after it.')
  const at = charset.index + charset[0].length
  const out = `${html.slice(0, at)}\n    ${tag}${html.slice(at)}`

  const firstScript = out.search(/<script\b/i)
  if (firstScript !== -1 && firstScript < out.indexOf(tag)) {
    throw new Error('[offline-csp] a <script> comes before the policy <meta>; it would run unrestricted.')
  }
  return out
}

/**
 * A Vite plugin that injects the offline policy into `htmlPath` once the
 * build has written it. `order: 'post'` and `sequential` make it run after
 * every other plugin's `closeBundle`, ARTIST's worker inlining included, so
 * the hashes cover the bytes that ship.
 */
export function offlineCspPlugin({ htmlPath, extra = {} }) {
  return {
    name: 'offline-csp',
    apply: 'build',
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        if (!existsSync(htmlPath)) {
          throw new Error(`[offline-csp] ${htmlPath} does not exist; nothing to protect.`)
        }
        writeFileSync(htmlPath, injectOfflineCsp(readFileSync(htmlPath, 'utf8'), { extra }), 'utf8')
        console.log(`[offline-csp] Added the offline Content-Security-Policy to ${htmlPath}.`)
      },
    },
  }
}
