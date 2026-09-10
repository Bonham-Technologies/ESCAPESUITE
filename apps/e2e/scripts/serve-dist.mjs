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
 * Rewrite order (first match wins), matching `vercel.json`:
 *   1. an actual file on disk           → served as-is
 *   2. `/craft`, `/craft/<anything>`    → dist/craft/index.html
 *   3. `/artist`, `/artist/<anything>`  → dist/artist/index.html
 *   4. everything else                  → dist/index.html (ESCAPEPLAN SPA)
 *
 * Usage: node scripts/serve-dist.mjs [--dir <path>] [--port <port>]
 */

import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** Resolve a request path to a file inside `root`, or null if it escapes//misses. */
function fileFor(requestPath) {
  const safe = normalize(requestPath).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(join(root, safe))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  try {
    return statSync(candidate).isFile() ? candidate : null
  } catch {
    return null
  }
}

/** The `vercel.json` rewrite table, in priority order. */
function resolveFile(requestPath) {
  const onDisk = fileFor(requestPath)
  if (onDisk) return onDisk

  if (requestPath === '/craft' || requestPath.startsWith('/craft/')) {
    return fileFor('/craft/index.html')
  }
  if (requestPath === '/artist' || requestPath.startsWith('/artist/')) {
    return fileFor('/artist/index.html')
  }
  // vercel.json's SPA catch-all is `/((?!craft|artist|assets|favicon).*)`: a
  // build artefact that isn't on disk must 404, not silently return the hub.
  if (/^\/(assets|favicon)/.test(requestPath)) {
    return null
  }
  return fileFor('/index.html')
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }

  let requestPath
  try {
    requestPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname)
  } catch {
    res.writeHead(400)
    res.end('Bad request')
    return
  }

  const file = resolveFile(requestPath)
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    // Tests rebuild dist between runs; never let the browser reuse stale bytes.
    'Cache-Control': 'no-store',
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(file).pipe(res)
})

// Loopback only — this serves a local build directory to a local browser.
server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root} at http://localhost:${port} (vercel.json rewrites)`)
})
