/**
 * Unit tests for `serve-dist.mjs`'s pure header-selection helpers.
 *
 * ESCSUITE-121 part 1 fixed the hosted CSP (`media-src 'self' blob:`) after it
 * shipped broken to production with the whole e2e suite green — because the
 * production-layout suite's server sent none of `vercel.json`'s `headers`
 * block at all. Part 2 (this file plus `serve-dist.mjs` and
 * `tests/production/csp-media.spec.ts`) closes that gap: the server now reads
 * `vercel.json` and sends whatever it declares, and these tests pin the two
 * pieces that decide *what* gets sent — the `source` pattern matcher, and the
 * per-path header selection built on it.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertVercelSettingsSupported,
  createServer,
  headersFor,
  matchesSource,
  resolveFile,
  resolveRequestPath,
} from './serve-dist.mjs'
import realVercelConfig from '../../../vercel.json' with { type: 'json' }

test('matchesSource anchors the pattern at both ends', () => {
  assert.equal(matchesSource('/(.*)', '/anything/at/all'), true)
  assert.equal(matchesSource('/(.*)', '/'), true)
  assert.equal(matchesSource('/craft/(.*)', '/craft/index.html'), true)
  assert.equal(matchesSource('/craft/(.*)', '/artist/index.html'), false)
  // Anchored at the end too: a pattern that matches only a PREFIX of the path
  // must not match the whole thing, or every header would apply everywhere.
  assert.equal(matchesSource('/craft', '/craft/index.html'), false)
  // The real catch-all's negative lookahead, exercised the way it is used in
  // production: everything except the three named prefixes.
  assert.equal(
    matchesSource('/((?!craft|artist|assets|favicon).*)', '/legal/privacy'),
    true
  )
  assert.equal(matchesSource('/((?!craft|artist|assets|favicon).*)', '/craft/x'), false)
})

test('headersFor concatenates every matching entry, in declaration order', () => {
  const config = {
    headers: [
      { source: '/(.*)', headers: [{ key: 'X-One', value: 'a' }] },
      { source: '/craft/(.*)', headers: [{ key: 'X-Two', value: 'b' }] },
      { source: '/artist/(.*)', headers: [{ key: 'X-Three', value: 'c' }] },
    ],
  }
  assert.deepEqual(headersFor('/craft/index.html', config), [
    { key: 'X-One', value: 'a' },
    { key: 'X-Two', value: 'b' },
  ])
})

test('headersFor returns nothing when no entry matches the path', () => {
  const config = { headers: [{ source: '/craft/(.*)', headers: [{ key: 'X', value: 'y' }] }] }
  assert.deepEqual(headersFor('/artist/index.html', config), [])
})

test('headersFor tolerates a config with no headers array', () => {
  assert.deepEqual(headersFor('/anything', {}), [])
})

test('headersFor, called with no config, reads the real vercel.json — the server and this test cannot drift apart', () => {
  const headers = headersFor('/artist/')
  const csp = headers.find((header) => header.key === 'Content-Security-Policy')
  assert.ok(csp, 'vercel.json should declare a Content-Security-Policy header matching every path')
  // The ESCSUITE-121 hotfix this whole ticket exists to keep exercised — read
  // out of vercel.json itself rather than retyped here, so an edit to the
  // policy can never silently stop being covered by this assertion.
  assert.match(csp.value, /media-src 'self' blob:/)

  const frameOptions = headers.find((header) => header.key === 'X-Frame-Options')
  assert.ok(frameOptions, 'vercel.json should also declare X-Frame-Options')

  // And the whole thing is literally vercel.json's own array for a path every
  // pattern in it matches — proof this reads the file rather than a copy of it.
  assert.deepEqual(headers, realVercelConfig.headers[0].headers)
})

// ESCSUITE-140: `/_vercel/*` (the @vercel/analytics beacon endpoint,
// `/_vercel/insights/script.js` in practice) has no local build output. Before
// this fix it fell through vercel.json's SPA catch-all to dist/index.html,
// which the browser then failed to parse as JS on every ESCAPEARTIST page
// load under this local server ("Unexpected token '<'"). It must 404 instead,
// the same way an unmatched /assets or /favicon path already does.
test('resolveFile 404s a /_vercel path instead of falling through to the SPA', () => {
  assert.equal(resolveFile('/_vercel/insights/script.js'), null)
  assert.equal(resolveFile('/_vercel/speed-insights/script.js'), null)
  // The bare prefix with nothing after it, and no trailing slash either.
  assert.equal(resolveFile('/_vercel'), null)
})

/**
 * Builds a minimal real `dist/` layout: the hub's `index.html` and its
 * `404.html` (a byte-for-byte copy, exactly as `scripts/build-all.mjs`
 * produces it — the "SPA fallback body" a miss is supposed to come back
 * with), ESCAPECRAFT's and ESCAPEARTIST's own `index.html`, and two
 * ordinary root-level static files (one with an extension, one without —
 * `robots.txt` and a `CNAME`-shaped file) to stand in for ESCAPEPLAN's own
 * build output. Callers must remove the returned directory when done.
 */
function buildTempDist() {
  const dir = mkdtempSync(join(tmpdir(), 'serve-dist-test-'))
  const hubHtml = '<html><body>HUB SPA SHELL</body></html>'
  writeFileSync(join(dir, 'index.html'), hubHtml)
  writeFileSync(join(dir, '404.html'), hubHtml)
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\n')
  writeFileSync(join(dir, 'CNAME'), 'escapesuite.io\n')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
  mkdirSync(join(dir, 'craft'))
  writeFileSync(join(dir, 'craft', 'index.html'), '<html><body>CRAFT</body></html>')
  mkdirSync(join(dir, 'artist'))
  writeFileSync(join(dir, 'artist', 'index.html'), '<html><body>ARTIST</body></html>')
  return { dir, hubHtml }
}

// ESCSUITE-196: before this fix, `resolveFile`'s craft/artist checks were
// SEGMENT tests (`startsWith('/craft/')`) while `vercel.json`'s catch-all
// was a PREFIX test (`/((?!craft|artist|assets|favicon).*)`, no segment
// boundary) — so the two disagreed on any path that merely *starts with*
// one of those words without actually being under that directory. This is
// the drift guard: for every path below, the answer `resolveFile` gives
// (reading the real `vercel.json`) must equal the answer computed
// independently, straight from `realVercelConfig.rewrites`, through the
// same `matchesSource` the production matcher uses. Edit either side —
// `vercel.json`'s rewrites, or `resolveFile`'s own logic — without updating
// the other, and this goes red.
test('resolveFile agrees with vercel.json\'s own rewrite table for every path (drift guard)', () => {
  const { dir } = buildTempDist()
  try {
    const fileExists = (requestPath) => {
      try {
        return statSync(join(dir, requestPath)).isFile()
      } catch {
        return false
      }
    }

    // Computed directly from vercel.json's real `rewrites`, independently of
    // resolveFile's own implementation.
    const expectedPath = (requestPath) => {
      if (fileExists(requestPath)) return requestPath
      for (const { source, destination } of realVercelConfig.rewrites ?? []) {
        if (matchesSource(source, requestPath)) {
          return fileExists(destination) ? destination : null
        }
      }
      return null
    }

    const paths = [
      '/',
      '/privacy',
      '/about',
      '/craft',
      '/craft/',
      '/craft/x',
      '/artist/',
      '/craftsmanship',
      '/artistry',
      '/artist-guide',
      '/assets-x',
      '/assets/app.js', // exists
      '/robots.txt', // exists
      '/CNAME', // exists, no extension
      '/no-such',
      '/assets/does-not-exist.js', // a genuine miss: segment-excluded AND absent
    ]

    const mismatches = []
    for (const requestPath of paths) {
      const want = expectedPath(requestPath)
      const wantFile = want ? join(dir, want) : null
      const got = resolveFile(requestPath, dir)
      if (got !== wantFile) {
        mismatches.push(`${requestPath}: resolveFile=${got} vercel.json=${wantFile}`)
      }
    }
    assert.deepEqual(mismatches, [])

    // And the one path in that table that is a genuine miss really is one —
    // excluded from the catch-all by its `assets/` segment, and not actually
    // on disk — so the drift guard above isn't vacuously true for it.
    assert.equal(resolveFile('/assets/does-not-exist.js', dir), null)
    assert.equal(expectedPath('/assets/does-not-exist.js'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveRequestPath: a path excluded from the catch-all and absent from disk is a miss', () => {
  const rewrites = realVercelConfig.rewrites ?? []
  const fileExists = (path) => new Set(['/index.html', '/craft/index.html', '/artist/index.html']).has(path)
  assert.equal(resolveRequestPath('/assets/does-not-exist.js', rewrites, fileExists), null)
  assert.equal(resolveRequestPath('/favicon/does-not-exist.ico', rewrites, fileExists), null)
  // But an ordinary hub-shaped path still resolves to the hub SPA.
  assert.equal(resolveRequestPath('/about', rewrites, fileExists), '/index.html')
})

test('assertVercelSettingsSupported throws if cleanUrls or trailingSlash is ever set, and passes today\'s config through', () => {
  assert.throws(() => assertVercelSettingsSupported({ cleanUrls: true }), /cleanUrls/)
  assert.throws(() => assertVercelSettingsSupported({ trailingSlash: false }), /trailingSlash/)
  assert.throws(() => assertVercelSettingsSupported({ trailingSlash: true }), /trailingSlash/)
  assert.doesNotThrow(() => assertVercelSettingsSupported({}))
  // The real file, today: neither setting is present.
  assert.doesNotThrow(() => assertVercelSettingsSupported(realVercelConfig))
})

// HTTP-level: proves the behaviour through a real server and real response,
// not just the pure resolver — a genuine miss comes back 404 with the SPA
// fallback body (dist/404.html, a byte-for-byte copy of the hub's own
// index.html per scripts/build-all.mjs), and an ordinary hub route comes
// back 200 with that same body.
test('HTTP: a genuine miss serves 404.html with status 404; a hub route serves index.html with 200', async () => {
  const { dir, hubHtml } = buildTempDist()
  const server = createServer(dir)
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const { port } = server.address()

    const missResponse = await fetch(`http://127.0.0.1:${port}/assets/does-not-exist.js`)
    assert.equal(missResponse.status, 404)
    assert.equal(await missResponse.text(), hubHtml)

    const hitResponse = await fetch(`http://127.0.0.1:${port}/about`)
    assert.equal(hitResponse.status, 200)
    assert.equal(await hitResponse.text(), hubHtml)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
