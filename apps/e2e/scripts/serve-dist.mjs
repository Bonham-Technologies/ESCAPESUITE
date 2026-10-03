#!/usr/bin/env node

/**
 * Static server for the combined production build (`pnpm build:deploy` → root
 * `dist/`), mirroring the rewrites in `vercel.json` so the e2e suite sees the
 * production origin model: ESCAPEPLAN at `/`, ESCAPECRAFT at `/craft/` and
 * ESCAPEARTIST at `/artist/`, all on ONE origin (so they share IndexedDB).
 *
 * `npx serve` can't reproduce this layout:
 *   - `serve -s` rewrites every unknown path to the ROOT index.html, so
 *     `/craft/` and `/artist/` serve the hub instead of their own apps.
 *   - `serve -c` with rewrites gets `/craft/` and `/artist/` right, but then
 *     `/` 404s, and a catch-all rewrite for `/` is re-applied recursively to
 *     the craft/artist destinations, which sends those back to the hub.
 *
 * Resolution order (first match wins), mirroring Vercel's own filesystem-
 * first semantics:
 *   1. an actual file on disk        → served as-is
 *   2. the first `vercel.json` `rewrites` entry whose `source` matches,
 *      PROVIDED its `destination` exists on disk → served as that file
 *   3. otherwise                     → `dist/404.html`, status 404 (plain
 *                                       text if even that is missing)
 *
 * `resolveFile` (and the pure `resolveRequestPath` it is built on) reads
 * `vercel.json`'s `rewrites` array directly through `matchesSource` rather
 * than hand-coding a copy of it (ESCSUITE-196) — exactly the way `headersFor`
 * already reads the `headers` block, and for the same reason: a hand-coded
 * copy can drift from the real config. Before ESCSUITE-196, this file's own
 * `startsWith('/craft/')`-style checks were SEGMENT tests while the old
 * `vercel.json` catch-all was a PREFIX test, so the two disagreed on paths
 * like `/craftsmanship` or `/artist-guide`, and a genuine miss was always
 * answered with plain text — `dist/404.html` was never exercised at all.
 *
 * It also sends `vercel.json`'s `headers` block (Content-Security-Policy,
 * X-Frame-Options, ...) on every response whose path matches a `source`
 * pattern, read straight out of `vercel.json` itself (see `headersFor` below)
 * so the policy this server enforces and the policy Vercel enforces cannot
 * drift apart — a CSP directive missing from `vercel.json` is missing here
 * too, the way ESCSUITE-121 was.
 *
 * Usage: node scripts/serve-dist.mjs [--dir <path>] [--port <port>]
 */

import { createServer as createHttpServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import vercelConfig from '../../../vercel.json' with { type: 'json' }

const scriptDir = fileURLToPath(new URL('.', import.meta.url))

const args = process.argv.slice(2)
const readArg = (name, fallback) => {
  const index = args.indexOf(name)
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback
}

const root = resolve(readArg('--dir', join(scriptDir, '..', '..', '..', 'dist')))
const port = Number(readArg('--port', '5190'))

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

/** Resolve a request path to a file inside `base`, or null if it escapes//misses. */
function fileFor(requestPath, base) {
  const safe = normalize(requestPath).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(join(base, safe))
  if (candidate !== base && !candidate.startsWith(base + sep)) return null
  try {
    return statSync(candidate).isFile() ? candidate : null
  } catch {
    return null
  }
}

/**
 * Does a `vercel.json` `headers` (or `rewrites`) entry's `source` pattern match
 * this request path?
 *
 * Vercel's `source` is path-to-regexp-flavoured, but every pattern actually in
 * this repo's `vercel.json` (`/(.*)`, `/craft/(.*)`, `/artist/(.*)`,
 * `/((?!(?:craft|artist|assets|favicon)(?:/|$)).*)`) is already a plain regex
 * fragment, so anchoring it at both ends and handing it to `RegExp` matches
 * Vercel's own behaviour exactly, with no new dependency.
 */
export function matchesSource(source, requestPath) {
  return new RegExp(`^${source}$`).test(requestPath)
}

/**
 * Every `{ key, value }` header `vercel.json`'s `headers` array declares for
 * this request path, in declaration order (later matching entries appended
 * after earlier ones — this repo's `vercel.json` only ever has one entry, but
 * nothing here assumes that).
 *
 * `config` defaults to the real `vercel.json`; a test passes its own small
 * fixture instead so it can exercise the matching/merging logic without
 * depending on the file's current contents.
 */
export function headersFor(requestPath, config = vercelConfig) {
  const result = []
  for (const entry of config.headers ?? []) {
    if (matchesSource(entry.source, requestPath)) {
      result.push(...entry.headers)
    }
  }
  return result
}

/**
 * Vercel's `cleanUrls` and `trailingSlash` project settings change how a
 * request is matched to a file BEFORE `rewrites` is even consulted (serving
 * `/about.html` for a request to `/about`, or redirecting to add/drop a
 * trailing slash). Neither is set in this repo's `vercel.json` today, and
 * `resolveRequestPath` below implements neither. Rather than silently
 * assuming they stay unset, this reads the real values and refuses to run —
 * loudly, here — if either is ever turned on without this server learning
 * how to honour it, instead of quietly serving the plain (wrong) layout.
 */
export function assertVercelSettingsSupported(config) {
  if (config.cleanUrls) {
    throw new Error(
      "vercel.json sets cleanUrls, which serve-dist.mjs's rewrite resolver does not implement"
    )
  }
  if (config.trailingSlash !== undefined) {
    throw new Error(
      "vercel.json sets trailingSlash, which serve-dist.mjs's rewrite resolver does not implement"
    )
  }
}

assertVercelSettingsSupported(vercelConfig)

/**
 * Pure file-or-rewrite decision for one request path, given `vercel.json`'s
 * `rewrites` array (in priority order, first match wins — Vercel's own
 * semantics) and a `fileExists` predicate. No filesystem access of its own,
 * so it is unit-testable without a server or a real `dist/` directory:
 *
 *   1. the request path itself, if `fileExists` says it is a real file
 *      (Vercel's filesystem-first rule — a rewrite never shadows a file
 *      that is actually there);
 *   2. otherwise, the first rewrite whose `source` matches, PROVIDED its
 *      `destination` also exists — a rewrite to a file this build didn't
 *      produce is not a match Vercel could actually serve either;
 *   3. otherwise `null` — a miss, exactly the state in which Vercel falls
 *      back to a custom `404.html`.
 */
export function resolveRequestPath(requestPath, rewrites, fileExists) {
  if (fileExists(requestPath)) return requestPath
  for (const { source, destination } of rewrites) {
    if (matchesSource(source, requestPath)) {
      return fileExists(destination) ? destination : null
    }
  }
  return null
}

/**
 * The fs-backed wrapper around `resolveRequestPath`: resolves a request path
 * to an actual file under `base` (defaulting to this process's `--dir`), or
 * null on a miss.
 */
export function resolveFile(requestPath, base = root) {
  // `/_vercel/*` (e.g. `/_vercel/insights/script.js`, injected by
  // @vercel/analytics) is a Vercel PLATFORM endpoint intercepted before any
  // user rewrite ever runs — it has no entry in `vercel.json`'s `rewrites`
  // at all, and no local build output either. Falling through to the SPA
  // catch-all served index.html for it, which the browser then failed to
  // parse as JS ("Unexpected token '<'") on every ESCAPEARTIST page load
  // under this local server (ESCSUITE-140). This is the one case handled
  // outside vercel.json's own rewrite table, because vercel.json has no way
  // to express it: 404 it explicitly instead.
  if (/^\/_vercel(\/|$)/.test(requestPath)) {
    return null
  }

  const resolvedPath = resolveRequestPath(
    requestPath,
    vercelConfig.rewrites ?? [],
    (candidate) => fileFor(candidate, base) !== null
  )
  return resolvedPath ? fileFor(resolvedPath, base) : null
}

function createRequestHandler(base) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }

    let requestPath
    try {
      requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400)
      res.end('Bad request')
      return
    }

    // Applied to every response (200, 404, ...) via setHeader rather than only
    // the success path below, so a request that 404s under the real layout still
    // 404s under the real CSP.
    for (const { key, value } of headersFor(requestPath)) {
      res.setHeader(key, value)
    }

    const file = resolveFile(requestPath, base)
    if (!file) {
      // Vercel serves a custom `404.html` (status 404) for a path no file
      // and no rewrite claims, rather than a bare platform error page —
      // `scripts/build-all.mjs` always produces one (a copy of the hub's
      // `index.html`, so the SPA shell can still render its own not-found
      // UI client-side). Fall back to plain text only if even that is gone.
      const notFoundFile = fileFor('/404.html', base)
      if (notFoundFile) {
        res.writeHead(404, {
          'Content-Type': CONTENT_TYPES['.html'],
          'Content-Length': statSync(notFoundFile).size,
          'Cache-Control': 'no-store',
        })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(notFoundFile).pipe(res)
        return
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': statSync(file).size,
      // Tests rebuild dist between runs; never let the browser reuse stale bytes.
      // This is a `writeHead` header, not a `setHeader` one, so it overrides any
      // Cache-Control vercel.json's `headers` block might set (it doesn't today)
      // rather than being merged alongside it — see the Node docs for
      // `response.writeHead()` on how the two are combined.
      'Cache-Control': 'no-store',
    })

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(file).pipe(res)
  }
}

/**
 * Builds a fresh server bound to `base` (defaulting to this process's
 * `--dir`). Exported so `serve-dist.test.mjs` can stand one up against a
 * temporary `dist/` for a real HTTP-level assertion, without binding the
 * default port or touching the real build output.
 */
export function createServer(base = root) {
  return createHttpServer(createRequestHandler(base))
}

// Loopback only — this serves a local build directory to a local browser.
// Guarded so `apps/e2e/scripts/serve-dist.test.mjs` can import this module's
// pure helpers (and build its own server via `createServer`) without binding
// the default port — the same entry-point pattern `profile-top.mjs` uses.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(root)
  server.listen(port, '127.0.0.1', () => {
    console.log(`Serving ${root} at http://localhost:${port} (vercel.json rewrites)`)
  })
}
