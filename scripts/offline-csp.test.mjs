/**
 * The offline single-file builds' Content-Security-Policy (ESCSUITE-467).
 *
 * `scripts/offline-csp.mjs` builds the policy both standalone builds carry in
 * a `<meta>` tag. These tests pin its one promise, that no directive admits a
 * network scheme or host, for each app's real policy, and the rules that
 * keep it honest: script hashes match the browser's, the tag goes before every
 * script, and a second policy or an external script fails the build.
 *
 * `apps/e2e/tests/standalone/dist-single-file.spec.ts` runs the same checks on
 * the built files; `offline-csp.spec.ts` beside it proves the browser enforces
 * the policy.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  NETWORK_SCHEMES,
  OFFLINE_CSP_EXTRA,
  assertScriptBoundaries,
  findCspMetas,
  findScripts,
  injectOfflineCsp,
  networkSources,
  offlineCsp,
  parseCsp,
  scriptHash,
} from './offline-csp.mjs';

const HASH = scriptHash('console.log(1)');

/** The policy each app ships, with a stand-in for its script hashes. */
const APP_POLICIES = Object.entries(OFFLINE_CSP_EXTRA).map(([app, extra]) => [
  app,
  offlineCsp({ scriptHashes: [HASH], extra }),
]);

for (const [app, policy] of APP_POLICIES) {
  test(`${app}: no directive admits a network scheme or host`, () => {
    assert.deepEqual(networkSources(policy), [], policy);
    for (const { name, sources } of parseCsp(policy)) {
      for (const source of sources) {
        const lower = source.toLowerCase();
        assert.ok(!NETWORK_SCHEMES.some((scheme) => lower.startsWith(scheme)), `${name} admits ${source}`);
        assert.notEqual(lower, '*', `${name} admits every host`);
        assert.notEqual(lower, "'self'", `${name} admits 'self'`);
      }
    }
  });

  test(`${app}: everything defaults to 'none', and base-uri and form-action are 'none'`, () => {
    const directives = new Map(parseCsp(policy).map(({ name, sources }) => [name, sources]));
    assert.deepEqual(directives.get('default-src'), ["'none'"]);
    assert.deepEqual(directives.get('base-uri'), ["'none'"]);
    assert.deepEqual(directives.get('form-action'), ["'none'"]);
    assert.ok(!directives.get('script-src').includes("'unsafe-inline'"), 'inline scripts run by hash');
    // Not allowed in a <meta> policy, so a browser would ignore them anyway.
    for (const name of ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']) {
      assert.ok(!directives.has(name), `${name} has no effect in a <meta> policy`);
    }
  });
}

test('networkSources flags every network scheme, host, wildcard and self', () => {
  const leaky = [
    'connect-src https:',
    'connect-src http://example.com',
    'connect-src ws:',
    'connect-src wss://example.com',
    'img-src *',
    'img-src example.com',
    'img-src *.example.com',
    "script-src 'self'",
    "script-src 'strict-dynamic'",
    'report-uri /csp',
    'report-to csp-endpoint',
    'img-src HTTPS:',
  ];
  for (const policy of leaky) {
    assert.notDeepEqual(networkSources(`default-src 'none'; ${policy}`), [], `${policy} should be flagged`);
  }
});

test('networkSources passes local-only sources', () => {
  const local = `default-src 'none'; script-src ${HASH} 'nonce-abc123' blob: data: 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'`;
  assert.deepEqual(networkSources(local), []);
});

test('offlineCsp refuses an extra source that reaches the network', () => {
  assert.throws(() => offlineCsp({ scriptHashes: [HASH], extra: { 'connect-src': ['https:'] } }), /admit the network/);
  assert.throws(() => offlineCsp({ scriptHashes: [HASH], extra: { 'img-src': ["'self'"] } }), /admit the network/);
});

test("offlineCsp falls back to script-src 'none' when there is nothing to hash", () => {
  const directives = new Map(parseCsp(offlineCsp({ scriptHashes: [] })).map(({ name, sources }) => [name, sources]));
  assert.deepEqual(directives.get('script-src'), ["'none'"]);
});

test('scriptHash is the SHA-256 the browser computes, with line endings as parsed', () => {
  const expected = `'sha256-${createHash('sha256').update('a\nb', 'utf8').digest('base64')}'`;
  assert.equal(scriptHash('a\nb'), expected);
  assert.equal(scriptHash('a\r\nb'), expected);
  assert.equal(scriptHash('a\rb'), expected);
});

const PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>t</title>
    <script>window.a=1</script>
    <script type="application/ld+json">{"@type":"WebApplication"}</script>
    <script type="module" crossorigin>const s="<script><\\/script>";window.b=s</script>
  </head>
  <body><div id="root"></div></body>
</html>`;

test('injectOfflineCsp adds one policy after <meta charset>, before every script, hashing the executable ones', () => {
  const out = injectOfflineCsp(PAGE, { extra: OFFLINE_CSP_EXTRA.artist });
  const metas = findCspMetas(out);
  assert.equal(metas.length, 1);
  assert.ok(out.indexOf('<meta charset') < metas[0].index);
  assert.ok(metas[0].index < out.indexOf('<script'));

  const scripts = findScripts(out);
  assert.equal(scripts.length, 3);
  assert.deepEqual(scripts.map((s) => s.executable), [true, false, true]);
  const scriptSrc = parseCsp(metas[0].policy).find((d) => d.name === 'script-src').sources;
  assert.deepEqual(scriptSrc, [scriptHash('window.a=1'), scriptHash('const s="<script><\\/script>";window.b=s')]);
  assert.ok(parseCsp(metas[0].policy).some((d) => d.name === 'worker-src' && d.sources.join(' ') === 'blob:'));
  assert.deepEqual(networkSources(metas[0].policy), []);
});

test('injectOfflineCsp refuses a page that already has a policy', () => {
  const once = injectOfflineCsp(PAGE);
  assert.throws(() => injectOfflineCsp(once), /already has a Content-Security-Policy/);
});

test('injectOfflineCsp refuses a page that loads a script from a separate file', () => {
  const page = PAGE.replace('<script>window.a=1</script>', '<script src="./app.js"></script>');
  assert.throws(() => injectOfflineCsp(page), /separate file/);
});

test('injectOfflineCsp refuses a page with no <meta charset> to anchor on', () => {
  assert.throws(() => injectOfflineCsp(PAGE.replace('<meta charset="UTF-8" />', '')), /no <meta charset>/);
});

test('injectOfflineCsp refuses a page whose first script comes before <meta charset>', () => {
  const page = PAGE.replace('<head>', '<head>\n    <script>window.early=1</script>');
  assert.throws(() => injectOfflineCsp(page), /before the policy/);
});

test('findScripts reads a data-type attribute as no type: the script still runs and is hashed', () => {
  const page = PAGE.replace('<script>window.a=1</script>', '<script data-type="x">window.a=1</script>');
  assert.equal(findScripts(page)[0].executable, true);
  const scriptSrc = parseCsp(findCspMetas(injectOfflineCsp(page))[0].policy).find((d) => d.name === 'script-src').sources;
  assert.ok(scriptSrc.includes(scriptHash('window.a=1')));
});

test('injectOfflineCsp refuses a script whose end the browser would place elsewhere, rather than ship a wrong hash', () => {
  // "<!--" then "<script" inside the code puts the parser in its double-escaped
  // state, so the first </script> does not end the element.
  const doubleEscaped = PAGE.replace('<script>window.a=1</script>', '<script>var s="<!--<script>";</script>window.a=1</script>');
  assert.throws(() => assertScriptBoundaries(doubleEscaped), /would not match/);
  assert.throws(() => injectOfflineCsp(doubleEscaped), /would not match/);
  // A stray closing tag the scan could not pair with an opening one.
  assert.throws(() => injectOfflineCsp(PAGE.replace('<title>t</title>', '<title>t</title></script>')), /would not match/);
  // The real builds' shape passes: an escaped "<\/script" inside the code is fine.
  assert.doesNotThrow(() => assertScriptBoundaries(PAGE));
});
