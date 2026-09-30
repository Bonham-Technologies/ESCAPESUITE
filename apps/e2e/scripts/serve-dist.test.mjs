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
import { test } from 'node:test'
import { headersFor, matchesSource, resolveFile } from './serve-dist.mjs'
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
