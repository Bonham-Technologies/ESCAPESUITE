/**
 * Unit tests for `offline.mjs` (ESCSUITE-469): what each hosted app's service
 * worker precaches, how its build id and cache names are made, what it answers
 * and what it leaves alone, the kill switch, and the block it adds to each page.
 * The browser side (offline reloads, the update path) is
 * `apps/e2e/tests/production/offline.spec.ts`.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import {
  BUILD_ID_MESSAGE,
  OFFLINE_APPS,
  buildIdFor,
  injectOfflineBlock,
  killSwitchMain,
  manifestFor,
  navigationRoutesFor,
  precacheList,
  serviceWorkerMain,
  writeOfflineSupport,
} from './offline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const vercelConfig = JSON.parse(readFileSync(join(here, '..', 'vercel.json'), 'utf8'));
const [HUB, CRAFT, ARTIST] = OFFLINE_APPS;

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23ef4444'/%3E%3C/svg%3E";

function page(title) {
  return (
    `<!doctype html><html><head><link rel="icon" type="image/svg+xml" href="${FAVICON}" />` +
    `<title>${title}</title><meta name="description" content="Records &amp; edits." />` +
    `<meta name="theme-color" content="#ef4444" /><script type="module">/* app */</script></head><body></body></html>`
  );
}

/** A small dist/ shaped like the one build-all.mjs assembles. */
function makeDist() {
  const dist = mkdtempSync(join(tmpdir(), 'offline-test-'));
  tmpDirs.push(dist);
  const files = {
    'index.html': page('Hub'),
    '404.html': page('Hub'),
    'privacy/index.html': page('Privacy'),
    'terms/index.html': page('Terms'),
    'limitations/index.html': page('Limitations'),
    'assets/index-abc.js': 'console.log(1)',
    'assets/index-abc.js.map': '{}',
    'assets/index-def.css': 'body{}',
    'og.png': 'png',
    'robots.txt': 'User-agent: *',
    'sitemap.xml': '<urlset/>',
    '.well-known/security.txt': 'Contact: x',
    'craft/index.html': page('Craft'),
    'artist/index.html': page('Artist'),
    'artist/decodeWorker-XYZ.js': 'self.onmessage=()=>{}',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  }
  return dist;
}

test('precacheList: the hub precaches its own pages and assets, nothing of the other apps', () => {
  const dist = makeDist();
  assert.deepEqual(precacheList(dist, HUB), [
    '/assets/index-abc.js',
    '/assets/index-def.css',
    '/index.html',
    '/limitations/index.html',
    '/privacy/index.html',
    '/terms/index.html',
  ]);
});

test('precacheList: CRAFT and ARTIST precache their own directory only', () => {
  const dist = makeDist();
  assert.deepEqual(precacheList(dist, CRAFT), ['/craft/index.html']);
  assert.deepEqual(precacheList(dist, ARTIST), ['/artist/decodeWorker-XYZ.js', '/artist/index.html']);
});

test('buildIdFor: stable for the same bytes, different when any precached file changes', () => {
  const dist = makeDist();
  const paths = precacheList(dist, HUB);
  const first = buildIdFor(dist, paths);
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.equal(buildIdFor(dist, paths), first);
  writeFileSync(join(dist, 'assets', 'index-abc.js'), 'console.log(2)');
  assert.notEqual(buildIdFor(dist, paths), first);
  assert.notEqual(buildIdFor(dist, paths, 'another generator'), buildIdFor(dist, paths));
});

test("buildIdFor: a page's offline block (which carries the id) does not change the id", () => {
  const dist = makeDist();
  const paths = precacheList(dist, HUB);
  const before = buildIdFor(dist, paths);
  const file = join(dist, 'index.html');
  writeFileSync(file, injectOfflineBlock(readFileSync(file, 'utf8'), { manifestHref: '/m', script: 'run()' }));
  assert.equal(buildIdFor(dist, paths), before);
});

test("navigationRoutesFor: the hub's routes come from vercel.json's rewrites; the apps have none", () => {
  const dist = makeDist();
  assert.deepEqual(navigationRoutesFor(HUB, vercelConfig.rewrites, precacheList(dist, HUB)), {
    '/': '/index.html',
    '/privacy': '/privacy/index.html',
    '/terms': '/terms/index.html',
    '/limitations': '/limitations/index.html',
  });
  assert.deepEqual(navigationRoutesFor(CRAFT, vercelConfig.rewrites, precacheList(dist, CRAFT)), {});
});

test('injectOfflineBlock: goes right after the title, and a second run replaces the first', () => {
  const html = page('Craft');
  const once = injectOfflineBlock(html, { manifestHref: '/craft/manifest.webmanifest', script: 'run()' });
  assert.ok(once.indexOf('rel="manifest"') > once.indexOf('</title>'));
  assert.ok(once.indexOf('rel="manifest"') < once.indexOf('<script type="module">'));
  assert.ok(once.includes('<script>run()</script>'));
  const twice = injectOfflineBlock(once, { manifestHref: '/craft/manifest.webmanifest', script: 'run()' });
  assert.equal(twice, once);
  const killed = injectOfflineBlock(once, { manifestHref: '/craft/manifest.webmanifest', script: '' });
  assert.ok(!killed.includes('run()'));
  assert.ok(killed.includes('rel="manifest"'));
  assert.throws(() => injectOfflineBlock('<html></html>', { manifestHref: '/m', script: '' }), /<title>/);
});

test('manifestFor: installable shape, scoped to the app, with its own icon and colour', () => {
  const manifest = manifestFor(CRAFT, page('Craft'));
  assert.equal(manifest.name, 'ESCAPECRAFT');
  assert.equal(manifest.start_url, '/craft/');
  assert.equal(manifest.scope, '/craft/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#ef4444');
  assert.equal(manifest.description, 'Records & edits.');
  assert.deepEqual(manifest.icons, [
    { src: '/craft/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ]);
});

test('writeOfflineSupport: a worker, manifest and icon per app, and every page registers its own', () => {
  const dist = makeDist();
  const summary = writeOfflineSupport(dist, vercelConfig.rewrites);
  assert.deepEqual(
    summary.map(({ app }) => app),
    ['plan', 'craft', 'artist']
  );
  for (const { app, buildId, precache } of summary) {
    const dir = app === 'plan' ? '' : app;
    const scope = app === 'plan' ? '/' : `/${app}/`;
    const worker = readFileSync(join(dist, dir, 'sw.js'), 'utf8');
    assert.ok(worker.includes(`"buildId":"${buildId}"`), `${app}: build id baked in`);
    assert.ok(worker.includes(`"cachePrefix":"escapesuite-offline-${app}-"`));
    assert.ok(precache.includes(`${scope}manifest.webmanifest`));
    assert.ok(precache.every((path) => path.startsWith(scope) && !path.startsWith('/_vercel')));
    assert.match(readFileSync(join(dist, dir, 'icon.svg'), 'utf8'), /^<svg /);
    JSON.parse(readFileSync(join(dist, dir, 'manifest.webmanifest'), 'utf8'));
    const html = readFileSync(join(dist, dir, 'index.html'), 'utf8');
    assert.ok(html.includes(`<link rel="manifest" href="${scope}manifest.webmanifest" />`));
    assert.ok(html.includes('navigator.serviceWorker.register('));
    assert.ok(html.includes(`"workerUrl":"${scope}sw.js"`));
    // The page knows its own build, so its "Updated" note can tell whether
    // the worker that took it over is that build (registerMain).
    assert.ok(html.includes(`"buildId":"${buildId}"`), `${app}: the page carries its build id`);
  }
  // The hub's other pages register too; the not-found page as well.
  for (const file of ['404.html', 'privacy/index.html']) {
    assert.ok(readFileSync(join(dist, file), 'utf8').includes('"workerUrl":"/sw.js"'), file);
  }
  // Running it again (the e2e suite does, on a copy) changes nothing.
  assert.deepEqual(writeOfflineSupport(dist, vercelConfig.rewrites), summary);
});

test('writeOfflineSupport: a changed file means a new build id, so a new cache', () => {
  const dist = makeDist();
  const [first] = writeOfflineSupport(dist, vercelConfig.rewrites);
  writeFileSync(join(dist, 'assets', 'index-abc.js'), 'console.log("new")');
  const [second] = writeOfflineSupport(dist, vercelConfig.rewrites);
  assert.notEqual(second.buildId, first.buildId);
});

test('writeOfflineSupport kill switch: workers that unregister, and no page registers one', () => {
  const dist = makeDist();
  writeOfflineSupport(dist, vercelConfig.rewrites);
  writeOfflineSupport(dist, vercelConfig.rewrites, { killSwitch: true });
  for (const dir of ['', 'craft', 'artist']) {
    const worker = readFileSync(join(dist, dir, 'sw.js'), 'utf8');
    assert.ok(worker.includes('unregister()'), `${dir || 'hub'}: unregisters`);
    assert.ok(!worker.includes("'fetch'"), `${dir || 'hub'}: answers no request`);
    const html = readFileSync(join(dist, dir, 'index.html'), 'utf8');
    assert.ok(!html.includes('serviceWorker'), `${dir || 'hub'}: registers nothing`);
    assert.ok(html.includes('rel="manifest"'));
  }
});

test('writeOfflineSupport: refuses a dist/ with an app missing', () => {
  const dist = makeDist();
  rmSync(join(dist, 'craft'), { recursive: true });
  assert.throws(() => writeOfflineSupport(dist, vercelConfig.rewrites), /craft/);
});

// ---- The worker itself, run against a stand-in for the worker's globals ----

class FakeCache {
  constructor() {
    this.entries = new Map();
  }
  async addAll(requests) {
    for (const request of requests) {
      const url = new URL(request.url, 'https://suite.test');
      this.entries.set(url.pathname, new Response(`cached ${url.pathname}`));
    }
  }
  async match(path) {
    return this.entries.get(path)?.clone();
  }
}

class FakeCaches {
  constructor(names = []) {
    this.store = new Map(names.map((name) => [name, new FakeCache()]));
  }
  async open(name) {
    if (!this.store.has(name)) this.store.set(name, new FakeCache());
    return this.store.get(name);
  }
  async keys() {
    return [...this.store.keys()];
  }
  async delete(name) {
    return this.store.delete(name);
  }
}

/** Runs `main(config)` with fake `self`, `caches` and `fetch`; returns a way to fire events. */
function runWorker(main, config, { cacheNames = [], online = true } = {}) {
  const listeners = {};
  const saved = {
    self: globalThis.self,
    caches: globalThis.caches,
    fetch: globalThis.fetch,
    Request: globalThis.Request,
  };
  // The worker builds same-origin requests from paths, which Node's Request
  // refuses without a base URL.
  globalThis.Request = class {
    constructor(url) {
      this.url = url;
    }
  };
  const fetched = [];
  const state = { skipped: false, unregistered: false };
  globalThis.self = {
    location: new URL('https://suite.test/'),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: async () => {
      state.skipped = true;
    },
    registration: {
      unregister: async () => {
        state.unregistered = true;
        return true;
      },
    },
  };
  globalThis.caches = new FakeCaches(cacheNames);
  globalThis.fetch = async (request) => {
    fetched.push(request.url ?? String(request));
    if (!online) throw new TypeError('Failed to fetch');
    return new Response('network');
  };
  main(config);
  const fakeCaches = globalThis.caches;

  async function fire(type, init = {}) {
    const pending = [];
    let response;
    const event = {
      ...init,
      waitUntil: (promise) => pending.push(promise),
      respondWith: (promise) => {
        response = promise;
      },
    };
    listeners[type](event);
    await Promise.all(pending);
    return response === undefined ? undefined : await response;
  }

  function restore() {
    Object.assign(globalThis, saved);
  }
  return { fire, fetched, state, caches: fakeCaches, listeners, restore };
}

const WORKER_CONFIG = {
  scope: '/',
  buildId: 'b2',
  cachePrefix: 'escapesuite-offline-plan-',
  precache: ['/index.html', '/privacy/index.html', '/assets/index-abc.js'],
  navigationRoutes: { '/': '/index.html', '/privacy': '/privacy/index.html' },
  navigationFallback: '/index.html',
  otherApps: ['/craft/', '/artist/'],
};

function get(url, mode = 'no-cors') {
  return { request: { url, method: 'GET', mode } };
}

test('worker: installs its precache, takes over at once, and deletes only older caches of its own app', async () => {
  const worker = runWorker(serviceWorkerMain, WORKER_CONFIG, {
    cacheNames: ['escapesuite-offline-plan-b1', 'escapesuite-offline-craft-c1', 'app-data'],
  });
  try {
    await worker.fire('install');
    assert.equal(worker.state.skipped, true);
    await worker.fire('activate');
    assert.deepEqual((await worker.caches.keys()).sort(), [
      'app-data',
      'escapesuite-offline-craft-c1',
      'escapesuite-offline-plan-b2',
    ]);
    const cache = await worker.caches.open('escapesuite-offline-plan-b2');
    assert.deepEqual([...cache.entries.keys()].sort(), [...WORKER_CONFIG.precache].sort());
  } finally {
    worker.restore();
  }
});

test('worker: answers precached files from the cache, and leaves everything else to the browser', async () => {
  const worker = runWorker(serviceWorkerMain, WORKER_CONFIG);
  try {
    await worker.fire('install');
    const asset = await worker.fire('fetch', get('https://suite.test/assets/index-abc.js'));
    assert.equal(await asset.text(), 'cached /assets/index-abc.js');
    // Not answered at all, so never cached and never replayed:
    for (const url of [
      'https://suite.test/_vercel/insights/script.js',
      'https://suite.test/_vercel/insights/view',
      'https://va.vercel-scripts.com/v1/script.debug.js',
      'https://example.com/assets/index-abc.js',
      'https://suite.test/assets/index-abc.js?v=2',
      'https://suite.test/assets/not-precached.js',
      'https://suite.test/craft/index.html',
    ]) {
      assert.equal(await worker.fire('fetch', get(url)), undefined, url);
    }
    // A POST (an analytics event, say) is never answered either.
    assert.equal(
      await worker.fire('fetch', { request: { url: 'https://suite.test/assets/index-abc.js', method: 'POST' } }),
      undefined
    );
    // The analytics navigation-shaped request too.
    assert.equal(await worker.fire('fetch', get('https://suite.test/_vercel/insights/x', 'navigate')), undefined);
    // Nothing above made the worker fetch anything itself.
    assert.deepEqual(worker.fetched, []);
  } finally {
    worker.restore();
  }
});

test('worker: a page load uses the network while there is one, and the cached page without', async () => {
  const online = runWorker(serviceWorkerMain, WORKER_CONFIG);
  try {
    await online.fire('install');
    const page = await online.fire('fetch', get('https://suite.test/privacy', 'navigate'));
    assert.equal(await page.text(), 'network');
  } finally {
    online.restore();
  }

  const offline = runWorker(serviceWorkerMain, WORKER_CONFIG);
  try {
    await offline.fire('install');
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const privacy = await offline.fire('fetch', get('https://suite.test/privacy', 'navigate'));
    assert.equal(await privacy.text(), 'cached /privacy/index.html');
    const unknown = await offline.fire('fetch', get('https://suite.test/somewhere?x=1', 'navigate'));
    assert.equal(await unknown.text(), 'cached /index.html');
    // The hub's worker leaves CRAFT's and ARTIST's pages to their own workers.
    assert.equal(await offline.fire('fetch', get('https://suite.test/craft/', 'navigate')), undefined);
    assert.equal(await offline.fire('fetch', get('https://suite.test/artist', 'navigate')), undefined);
  } finally {
    offline.restore();
  }
});

test('worker: tells a page which build it is, and answers no other message', async () => {
  const worker = runWorker(serviceWorkerMain, { ...WORKER_CONFIG, buildIdMessage: BUILD_ID_MESSAGE });
  try {
    const replies = [];
    const port = { postMessage: (value) => replies.push(value) };
    await worker.fire('message', { data: { type: BUILD_ID_MESSAGE }, ports: [port] });
    assert.deepEqual(replies, ['b2']);
    await worker.fire('message', { data: { type: 'something-else' }, ports: [port] });
    await worker.fire('message', { data: null, ports: [port] });
    await worker.fire('message', { data: { type: BUILD_ID_MESSAGE }, ports: [] });
    assert.deepEqual(replies, ['b2']);
  } finally {
    worker.restore();
  }
});

test('kill switch: deletes its own app caches, unregisters, and answers nothing', async () => {
  const worker = runWorker(
    killSwitchMain,
    { scope: '/craft/', cachePrefix: 'escapesuite-offline-craft-' },
    { cacheNames: ['escapesuite-offline-craft-c1', 'escapesuite-offline-plan-b1'] }
  );
  try {
    await worker.fire('install');
    await worker.fire('activate');
    assert.equal(worker.state.skipped, true);
    assert.equal(worker.state.unregistered, true);
    assert.deepEqual(await worker.caches.keys(), ['escapesuite-offline-plan-b1']);
    assert.equal(worker.listeners.fetch, undefined);
  } finally {
    worker.restore();
  }
});
