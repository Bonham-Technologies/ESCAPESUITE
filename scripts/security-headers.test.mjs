/**
 * Pins the security headers `vercel.json` sends on every hosted page
 * (ESCSUITE-340). `docs/reference/vercel-deployment.md` explains each one;
 * this test only checks they are present with the values that doc describes.
 *
 * `apps/e2e/scripts/serve-dist.mjs` serves the same `headers` block to the
 * production-layout e2e suite, so these headers are also live under
 * `pnpm test:e2e:production`.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const vercelConfig = JSON.parse(readFileSync(join(here, '..', 'vercel.json'), 'utf8'));

/** The headers of the catch-all `/(.*)` entry, keyed by lower-cased name. */
function siteWideHeaders() {
  const entry = vercelConfig.headers.find((h) => h.source === '/(.*)');
  assert.ok(entry, 'vercel.json has no catch-all /(.*) headers entry');
  return new Map(entry.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

/** Parses a Permissions-Policy value into feature → allowlist string. */
function parsePermissionsPolicy(value) {
  return new Map(
    value.split(',').map((directive) => {
      const [feature, allowlist] = directive.trim().split('=');
      return [feature, allowlist];
    })
  );
}

test('every page keeps its Content-Security-Policy and X-Frame-Options', () => {
  const headers = siteWideHeaders();
  assert.match(headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);
  assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN');
});

/** Parses a Content-Security-Policy value into directive → source list. */
function parseCsp(value) {
  return new Map(
    value
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name.toLowerCase(), sources.join(' ')];
      })
  );
}

test("every CSP pins base-uri and form-action to 'self' (ESCSUITE-416)", () => {
  // Neither directive falls back to default-src, so without them an injected
  // <base href> could re-point relative loads and a form could post anywhere.
  const policies = vercelConfig.headers.flatMap(({ source, headers }) =>
    headers
      .filter(({ key }) => key.toLowerCase() === 'content-security-policy')
      .map(({ value }) => ({ source, csp: parseCsp(value) }))
  );
  assert.ok(policies.length > 0, 'vercel.json sets no Content-Security-Policy');
  for (const { source, csp } of policies) {
    assert.equal(csp.get('base-uri'), "'self'", `${source}: base-uri should be 'self'`);
    assert.equal(csp.get('form-action'), "'self'", `${source}: form-action should be 'self'`);
  }
});

test('every page sends X-Content-Type-Options: nosniff', () => {
  assert.equal(siteWideHeaders().get('x-content-type-options'), 'nosniff');
});

test('every page sends Referrer-Policy: same-origin', () => {
  assert.equal(siteWideHeaders().get('referrer-policy'), 'same-origin');
});

test('Permissions-Policy limits camera, microphone and display-capture to the suite itself', () => {
  const value = siteWideHeaders().get('permissions-policy');
  assert.ok(value, 'vercel.json sends no Permissions-Policy');
  const policy = parsePermissionsPolicy(value);
  for (const feature of ['camera', 'microphone', 'display-capture']) {
    assert.equal(policy.get(feature), '(self)', `${feature} should be allowed for self only`);
  }
});

test('Permissions-Policy turns off features the suite never uses', () => {
  const policy = parsePermissionsPolicy(siteWideHeaders().get('permissions-policy') ?? '');
  for (const feature of ['geolocation', 'payment', 'usb', 'browsing-topics']) {
    assert.equal(policy.get(feature), '()', `${feature} should be disabled`);
  }
});

test('the CSP allows no Vercel preview-toolbar host (ESCSUITE-459)', () => {
  // vercel.live and api.vercel.com serve only Vercel's preview toolbar; the
  // hosted site's analytics is same-origin (`/_vercel/insights/`).
  const csp = siteWideHeaders().get('content-security-policy') ?? '';
  assert.ok(csp, 'vercel.json sends no Content-Security-Policy');
  for (const host of ['vercel.live', 'api.vercel.com']) {
    assert.ok(!csp.includes(host), `the CSP should not allow ${host}`);
  }
  // Media, workers and scripts built from blob: URLs must keep working.
  const policy = parseCsp(csp);
  assert.equal(policy.get('worker-src'), "'self' blob:");
  assert.equal(policy.get('media-src'), "'self' blob:");
  assert.match(policy.get('script-src') ?? '', /(^| )blob:( |$)/);
});

test('every page sends Strict-Transport-Security with includeSubDomains, no preload (ESCSUITE-459)', () => {
  assert.equal(
    siteWideHeaders().get('strict-transport-security'),
    'max-age=63072000; includeSubDomains'
  );
});
