#!/usr/bin/env node

/**
 * Offline support for the hosted apps (ESCSUITE-469): after the first visit,
 * ESCAPEPLAN (`/`), ESCAPECRAFT (`/craft/`) and ESCAPEARTIST (`/artist/`)
 * each load with no connection.
 *
 * `scripts/build-all.mjs` calls `writeOfflineSupport()` on the combined
 * `dist/` it assembles, so this only ever touches the hosted deployment: the
 * dev servers, the standalone single-file builds and the headless kit never
 * see any of it. For each app scope it writes
 *
 *   - `sw.js`, a small hand-written service worker. It precaches that app's
 *     own build output (the file list and a build id hashed from those files'
 *     bytes are baked in), answers precached files cache-first, and answers
 *     a page load from the network, falling back to the cached page when the
 *     network is unreachable. It never touches another origin or
 *     `/_vercel/*` (analytics), and never caches anything it did not
 *     precache, so imported or recorded media never enters its cache.
 *   - `manifest.webmanifest` and `icon.svg` (the app's own favicon), so
 *     Chromium offers to install the app.
 *   - a `<link rel="manifest">` and a small inline registration script in
 *     each of that app's HTML files. The script registers the worker once the
 *     page has loaded, never inside a frame (the integration API's hosts),
 *     and shows a small "Updated" note when a new version's worker takes over
 *     a page an older one served.
 *
 * Each worker's cache is named after its build id, and a new worker deletes
 * every older cache of its own app when it activates, so a new deploy
 * replaces the old cache instead of adding to it.
 *
 * Kill switch: `ESCAPESUITE_SERVICE_WORKER=off pnpm build:deploy` writes, at
 * the same three addresses, a worker that deletes its app's caches and
 * unregisters itself, and leaves the registration script out of the pages.
 * See `docs/reference/vercel-deployment.md`, "Offline after the first visit".
 *
 * Usage (also what the production e2e suite runs on a copy of `dist/`):
 *   node scripts/offline.mjs <distDir> [--kill-switch]
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Prefix of every Cache Storage cache the workers own. Never used by app code. */
export const CACHE_PREFIX = 'escapesuite-offline-';

/** The worker's file name inside each app's directory. */
export const WORKER_FILE = 'sw.js';
export const MANIFEST_FILE = 'manifest.webmanifest';
export const ICON_FILE = 'icon.svg';

const BLOCK_START = '<!-- escapesuite-offline:start -->';
const BLOCK_END = '<!-- escapesuite-offline:end -->';
const BLOCK_PATTERN = new RegExp(`\\n?\\s*${BLOCK_START}[\\s\\S]*?${BLOCK_END}`);

/**
 * What a page posts to its controlling worker to learn that worker's build id,
 * so it shows the "Updated" note only when the worker now in charge is the
 * page's own build (`registerMain`).
 */
export const BUILD_ID_MESSAGE = 'escapesuite-offline:build-id';

/**
 * The three hosted apps. `dir` is the app's directory inside `dist/`, and
 * `scope` the URL path it is served under (the worker's scope). The hub's
 * scope `/` also covers `/craft/` and `/artist/`, so its worker passes every
 * request under those straight through: each of them has a worker of its own.
 */
export const OFFLINE_APPS = [
  {
    id: 'plan',
    dir: '',
    scope: '/',
    name: 'ESCAPE Suite',
    shortName: 'ESCAPE Suite',
    otherApps: ['/craft/', '/artist/'],
  },
  { id: 'craft', dir: 'craft', scope: '/craft/', name: 'ESCAPECRAFT', shortName: 'ESCAPECRAFT', otherApps: [] },
  { id: 'artist', dir: 'artist', scope: '/artist/', name: 'ESCAPEARTIST', shortName: 'ESCAPEARTIST', otherApps: [] },
];

/**
 * File names never precached: the worker itself, the not-found page, and the
 * hub's crawler and social-preview files, which no page loads. Source maps are
 * left out too (`precacheList`).
 */
const NEVER_PRECACHED = new Set([WORKER_FILE, '404.html', 'robots.txt', 'sitemap.xml', 'og.png']);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** `dist`-relative file path → the URL path it is served at. */
function urlPathOf(distDir, file) {
  return '/' + relative(distDir, file).split(sep).join(posix.sep);
}

/**
 * The URL paths a worker for `app` precaches: every file of that app's own
 * build output in `distDir`, minus {@link NEVER_PRECACHED}, `*.map`, dotfile
 * directories (`.well-known/`) and, for the hub, the other apps' directories.
 * Sorted, so the list (and the build id hashed from it) is deterministic.
 */
export function precacheList(distDir, app) {
  const appDir = join(distDir, app.dir);
  const result = [];
  for (const file of walk(appDir)) {
    const path = urlPathOf(distDir, file);
    const name = posix.basename(path);
    if (NEVER_PRECACHED.has(name) || path.endsWith('.map')) continue;
    if (path.split('/').some((segment) => segment.startsWith('.'))) continue;
    if (path.startsWith('/_vercel/')) continue;
    if (app.otherApps.some((prefix) => path.startsWith(prefix))) continue;
    result.push(path);
  }
  return result.sort();
}

/**
 * A short id for one build of one app: a hash of `salt`, every precached path
 * and its bytes. Two builds with identical output get the same id (so a
 * redeploy of the same code does not make every visitor download it again);
 * any change to any precached file changes it.
 *
 * An HTML file is hashed without this script's own block
 * ({@link stripOfflineBlock}), so the id can be computed before the block (which
 * carries the id itself) is written into the pages, and a second run over the
 * same `dist/` gives the same id. `writeOfflineSupport` passes the generator's
 * own source as `salt`, so a change to the block or the worker still changes it.
 */
export function buildIdFor(distDir, paths, salt = '') {
  const hash = createHash('sha256');
  hash.update(salt);
  hash.update('\0');
  for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    const bytes = readFileSync(join(distDir, path));
    hash.update(path.endsWith('.html') ? stripOfflineBlock(bytes.toString('utf8')) : bytes);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * The hub's own page for each of its routes, from `vercel.json`'s rewrites
 * (`/privacy` → `/privacy/index.html`): what its worker serves for a page
 * load with no connection. Only literal paths inside `app.scope` count; a
 * pattern such as `/craft/(.*)` belongs to another app.
 */
export function navigationRoutesFor(app, rewrites, precache) {
  const routes = {};
  const cached = new Set(precache);
  for (const { source, destination } of rewrites) {
    if (!/^\/[A-Za-z0-9/_-]*$/.test(source)) continue;
    if (!source.startsWith(app.scope) && source !== app.scope.replace(/\/$/, '')) continue;
    if (app.otherApps.some((prefix) => source.startsWith(prefix))) continue;
    if (cached.has(destination)) routes[source] = destination;
  }
  return routes;
}

/**
 * The service worker itself. It is serialised with `Function.prototype.toString`
 * into each `sw.js`, called with that app's config, so it must not refer to
 * anything outside its own body. `self`, `caches`, `fetch` and `Request` are
 * the worker's globals.
 */
/* global self, caches */
export function serviceWorkerMain(config) {
  const cachePrefix = config.cachePrefix;
  const cacheName = cachePrefix + config.buildId;
  const precached = new Set(config.precache);

  function passesThrough(pathname) {
    return config.otherApps.some(
      (prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)
    );
  }

  self.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(cacheName);
        // `cache: 'reload'` skips the HTTP cache, so the cache holds exactly
        // this deploy's bytes.
        await cache.addAll(config.precache.map((path) => new Request(path, { cache: 'reload' })));
        // A new version takes over as soon as it is cached: the page that
        // fetched it was itself loaded from the network (see `navigate`), so it
        // already is that version.
        await self.skipWaiting();
      })()
    );
  });

  // A page asks which build this worker is (see `registerMain`).
  self.addEventListener('message', (event) => {
    const port = event.ports && event.ports[0];
    if (port && event.data && event.data.type === config.buildIdMessage) port.postMessage(config.buildId);
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
            .map((name) => caches.delete(name))
        );
      })()
    );
  });

  async function navigate(request, url) {
    try {
      return await fetch(request);
    } catch (error) {
      const cache = await caches.open(cacheName);
      const page = config.navigationRoutes[url.pathname] ?? config.navigationFallback;
      const cachedPage = await cache.match(page);
      if (cachedPage) return cachedPage;
      throw error;
    }
  }

  async function fromCache(request, pathname) {
    const cache = await caches.open(cacheName);
    return (await cache.match(pathname)) ?? fetch(request);
  }

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    // Another origin, and the analytics paths, always go straight to the
    // network: never cached, never answered from a cache, never replayed.
    if (url.origin !== self.location.origin) return;
    if (url.pathname === '/_vercel' || url.pathname.startsWith('/_vercel/')) return;
    if (!url.pathname.startsWith(config.scope) || passesThrough(url.pathname)) return;

    if (request.mode === 'navigate') {
      event.respondWith(navigate(request, url));
      return;
    }
    if (url.search === '' && precached.has(url.pathname)) {
      event.respondWith(fromCache(request, url.pathname));
    }
    // Anything else (media, a `blob:` URL's fetch, a range request) is not
    // answered here, so the browser fetches it as if there were no worker.
  });
}

/**
 * The kill switch: a worker with no fetch handler that deletes its app's
 * caches and unregisters itself. Pages already open keep running as they are;
 * the next load goes straight to the network.
 */
export function killSwitchMain(config) {
  self.addEventListener('install', () => {
    self.skipWaiting();
  });
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names.filter((name) => name.startsWith(config.cachePrefix)).map((name) => caches.delete(name))
        );
        await self.registration.unregister();
      })()
    );
  });
}

/**
 * The inline registration script, serialised like {@link serviceWorkerMain}.
 * Registers the app's worker after the page has loaded, and shows an
 * "Updated" note when a new version of this app's worker takes over a page
 * that an older one controlled, and only if that new worker is this page's
 * own build: a tab left open from an older build that a newer worker takes
 * over (another tab loaded the new version) is still the old version, so it
 * gets no note. Does nothing inside a frame: a host page that embeds an app
 * (the integration API) keeps exactly the behaviour it had.
 */
/* global window, document, navigator */
export function registerMain(config) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    if (window.self !== window.top) return;
  } catch {
    return;
  }

  const container = navigator.serviceWorker;
  let controlled = Boolean(container.controller);

  function showUpdatedNote() {
    if (document.getElementById('escapesuite-updated-note')) return;
    const note = document.createElement('div');
    note.id = 'escapesuite-updated-note';
    note.setAttribute('role', 'status');
    note.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:16px',
      'transform:translateX(-50%)',
      'z-index:2147483000',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'max-width:calc(100vw - 32px)',
      'padding:8px 8px 8px 16px',
      'background:var(--bg-secondary, #16213e)',
      'color:var(--text-primary, #e8e8e8)',
      'border:1px solid var(--border, #2a2a4a)',
      'border-radius:8px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
      'font:14px/1.4 system-ui, -apple-system, sans-serif',
    ].join(';');
    const text = document.createElement('span');
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.style.cssText = [
      'background:transparent',
      'color:inherit',
      'border:1px solid var(--border, #2a2a4a)',
      'border-radius:4px',
      'padding:4px 8px',
      'font:inherit',
      'cursor:pointer',
    ].join(';');
    const remove = () => note.remove();
    dismiss.addEventListener('click', remove);
    note.append(text, dismiss);
    document.body.append(note);
    // Filled after the live region is in the page, so screen readers announce it.
    setTimeout(() => {
      text.textContent = config.updatedMessage;
    }, 50);
    setTimeout(remove, 15000);
  }

  container.addEventListener('controllerchange', () => {
    const controller = container.controller;
    const wasControlled = controlled;
    controlled = Boolean(controller);
    if (!wasControlled || !controller) return;
    if (new URL(controller.scriptURL).pathname !== config.workerUrl) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      channel.port1.close();
      if (event.data === config.buildId) showUpdatedNote();
    };
    controller.postMessage({ type: config.buildIdMessage }, [channel.port2]);
  });

  const register = () => {
    navigator.serviceWorker.register(config.workerUrl, { scope: config.scope }).catch(() => {});
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

function serialise(main, config) {
  return `(${main.toString()})(${JSON.stringify(config)});\n`;
}

/** The `sw.js` source for one app. */
export function serviceWorkerSource(config) {
  return (
    `/* ESCAPE Suite offline worker for ${config.scope}, build ${config.buildId}. ` +
    'Generated by scripts/offline.mjs (ESCSUITE-469). */\n' +
    serialise(serviceWorkerMain, config)
  );
}

/** The kill-switch `sw.js` source for one app. */
export function killSwitchSource(config) {
  return (
    `/* ESCAPE Suite offline worker for ${config.scope}: kill switch. ` +
    'Deletes its caches and unregisters. Generated by scripts/offline.mjs (ESCSUITE-469). */\n' +
    serialise(killSwitchMain, config)
  );
}

/** The inline `<script>` body that registers one app's worker. */
export function registrationSource(config) {
  return serialise(registerMain, config);
}

function attributeOf(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : undefined;
}

/** The app's SVG favicon, decoded from the `data:` URL in its page's `<link rel="icon">`. */
export function faviconSvgOf(html) {
  const href = attributeOf(html, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)"/);
  return href === undefined ? undefined : decodeURIComponent(href);
}

/** The web app manifest for one app, from its config and its own page's head. */
export function manifestFor(app, html) {
  const description = attributeOf(html, /<meta name="description" content="([^"]*)"/);
  const themeColor = attributeOf(html, /<meta name="theme-color" content="([^"]*)"/);
  return {
    id: app.scope,
    name: app.name,
    short_name: app.shortName,
    ...(description === undefined ? {} : { description: description.replace(/&amp;/g, '&') }),
    start_url: app.scope,
    scope: app.scope,
    display: 'standalone',
    background_color: '#1a1a2e',
    ...(themeColor === undefined ? {} : { theme_color: themeColor }),
    icons: [{ src: app.scope + ICON_FILE, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}

/**
 * `html` with this ticket's block (a manifest link and, unless `script` is
 * empty, the registration script) placed right after its `<title>`, replacing
 * any block an earlier run left there, so running it twice changes nothing.
 * After `</title>` rather than before `</head>`: the single-file apps inline
 * their whole bundle in the head, and only the title is sure to precede it.
 */
export function injectOfflineBlock(html, { manifestHref, script }) {
  const withoutBlock = stripOfflineBlock(html);
  const titleEnd = withoutBlock.indexOf('</title>');
  if (titleEnd === -1) throw new Error('page has no <title> to place the offline block after');
  const at = titleEnd + '</title>'.length;
  const block =
    `\n    ${BLOCK_START}\n    <link rel="manifest" href="${manifestHref}" />\n` +
    (script ? `    <script>${script}</script>\n` : '') +
    `    ${BLOCK_END}`;
  return withoutBlock.slice(0, at) + block + withoutBlock.slice(at);
}

/** `html` without the block {@link injectOfflineBlock} adds, if it has one. */
export function stripOfflineBlock(html) {
  return html.replace(BLOCK_PATTERN, '');
}

/**
 * The generator's own source: hashed into every build id, so a change to the
 * worker, the registration script or the block makes a new cache even when
 * the apps' own files did not change.
 */
function generatorSource() {
  return [serviceWorkerMain, registerMain, injectOfflineBlock, serialise].map(String).join('\n');
}

/** The HTML files of one app inside `distDir` (the hub's route copies and 404 page included). */
function htmlFilesOf(distDir, app) {
  return walk(join(distDir, app.dir))
    .filter((file) => file.endsWith('.html'))
    .filter((file) => !app.otherApps.some((prefix) => urlPathOf(distDir, file).startsWith(prefix)));
}

/**
 * Writes every app's worker, manifest and icon into the assembled `distDir`
 * and adds the block to every HTML file. Idempotent. Returns, per app, the
 * build id and the precached paths (empty under the kill switch).
 */
export function writeOfflineSupport(distDir, rewrites = [], { killSwitch = false } = {}) {
  const summary = [];
  for (const app of OFFLINE_APPS) {
    const appDir = join(distDir, app.dir);
    const entryHtml = join(appDir, 'index.html');
    if (!existsSync(entryHtml)) throw new Error(`${entryHtml} is missing: nothing to make offline`);
    const workerUrl = app.scope + WORKER_FILE;
    const cachePrefix = `${CACHE_PREFIX}${app.id}-`;

    const html = readFileSync(entryHtml, 'utf8');
    const icon = faviconSvgOf(html);
    if (icon === undefined) throw new Error(`${entryHtml} has no SVG favicon for the manifest icon`);
    writeFileSync(join(appDir, ICON_FILE), icon);
    writeFileSync(join(appDir, MANIFEST_FILE), JSON.stringify(manifestFor(app, html), null, 2) + '\n');

    const injectAll = (script) => {
      for (const file of htmlFilesOf(distDir, app)) {
        const page = readFileSync(file, 'utf8');
        writeFileSync(file, injectOfflineBlock(page, { manifestHref: app.scope + MANIFEST_FILE, script }));
      }
    };

    if (killSwitch) {
      injectAll('');
      writeFileSync(join(appDir, WORKER_FILE), killSwitchSource({ scope: app.scope, cachePrefix }));
      summary.push({ app: app.id, buildId: null, precache: [] });
      continue;
    }

    // The build id first (it ignores the block, see buildIdFor), then the
    // block, which carries it, into the pages.
    const precache = precacheList(distDir, app);
    const buildId = buildIdFor(distDir, precache, `${generatorSource()}\n${JSON.stringify(app)}`);
    injectAll(
      registrationSource({
        workerUrl,
        scope: app.scope,
        buildId,
        buildIdMessage: BUILD_ID_MESSAGE,
        updatedMessage: `Updated to the latest version of ${app.name}.`,
      })
    );
    const navigationFallback = app.scope + 'index.html';
    const config = {
      scope: app.scope,
      buildId,
      buildIdMessage: BUILD_ID_MESSAGE,
      cachePrefix,
      precache,
      navigationRoutes: navigationRoutesFor(app, rewrites, precache),
      navigationFallback,
      otherApps: app.otherApps,
    };
    if (!precache.includes(navigationFallback)) {
      throw new Error(`${navigationFallback} is not in the ${app.id} precache list`);
    }
    writeFileSync(join(appDir, WORKER_FILE), serviceWorkerSource(config));
    summary.push({ app: app.id, buildId, precache });
  }
  return summary;
}

function isDirectRun() {
  if (process.argv[1] === undefined) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const distDir = process.argv[2];
  if (!distDir || !statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error('Usage: node scripts/offline.mjs <distDir> [--kill-switch]');
    process.exit(2);
  }
  const vercelConfig = JSON.parse(
    readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'vercel.json'), 'utf8')
  );
  const summary = writeOfflineSupport(resolve(distDir), vercelConfig.rewrites ?? [], {
    killSwitch: process.argv.includes('--kill-switch'),
  });
  for (const { app, buildId, precache } of summary) {
    console.log(`  → ${app}: ${buildId ? `build ${buildId}, ${precache.length} files precached` : 'kill switch'}`);
  }
}
