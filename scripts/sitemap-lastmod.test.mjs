/**
 * Unit tests for `sitemap-lastmod.mjs` (ESCSUITE-490), and the check that the
 * committed `apps/plan/src/lib/sitemap-lastmod.json` matches the hub's pages:
 * a page whose files changed without its date moving fails here. It needs no
 * git history, so it holds in CI's shallow checkout too. The production side is
 * `apps/e2e/tests/production/sitemap-lastmod.spec.ts`.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import {
  MANIFEST_PATH,
  PLAN_ROOT,
  serialize,
  sourcesHash,
  staleEntries,
  stamp,
  utcDay,
} from './sitemap-lastmod.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'sitemap-lastmod-'));
  tmpDirs.push(root);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

test('the committed manifest matches every hub page it lists', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const stale = staleEntries(manifest, PLAN_ROOT);
  assert.deepEqual(
    stale.map(({ path, lastmod }) => `${path} (lastmod ${lastmod})`),
    [],
    'These pages changed without their sitemap date moving. Run `pnpm sitemap:stamp` and commit ' +
      'apps/plan/src/lib/sitemap-lastmod.json.'
  );
});

test('the committed manifest is written the way the stamp writes it', () => {
  const text = readFileSync(MANIFEST_PATH, 'utf8');
  assert.equal(text, serialize(JSON.parse(text)));
});

test('the hash follows each file, its path and the order of the list', () => {
  const root = fixture({ 'a.ts': 'one\n', 'b.ts': 'two\n' });
  const ab = sourcesHash(root, ['a.ts', 'b.ts']);
  assert.match(ab, /^[0-9a-f]{64}$/);
  assert.equal(sourcesHash(root, ['a.ts', 'b.ts']), ab);
  assert.notEqual(sourcesHash(root, ['b.ts', 'a.ts']), ab);
  assert.notEqual(sourcesHash(root, ['a.ts']), ab);

  writeFileSync(join(root, 'b.ts'), 'two!\n');
  assert.notEqual(sourcesHash(root, ['a.ts', 'b.ts']), ab);
});

test('the hash reads CRLF line endings as LF, so a Windows checkout agrees', () => {
  const lf = fixture({ 'a.ts': 'one\ntwo\n' });
  const crlf = fixture({ 'a.ts': 'one\r\ntwo\r\n' });
  assert.equal(sourcesHash(crlf, ['a.ts']), sourcesHash(lf, ['a.ts']));
});

test('a missing source file is an error, not a silent match', () => {
  const root = fixture({});
  assert.throws(() => sourcesHash(root, ['gone.ts']), /ENOENT/);
});

test('stamp dates only the pages whose files changed, and leaves its input alone', () => {
  const root = fixture({ 'home.tsx': 'home\n', 'terms.tsx': 'terms\n' });
  const manifest = {
    '/': { lastmod: '2026-01-01', sources: ['home.tsx'], sha256: sourcesHash(root, ['home.tsx']) },
    '/terms': { lastmod: '2026-01-02', sources: ['terms.tsx'], sha256: sourcesHash(root, ['terms.tsx']) },
  };
  assert.deepEqual(staleEntries(manifest, root), []);
  assert.deepEqual(stamp(manifest, root, '2026-11-21'), manifest);

  writeFileSync(join(root, 'terms.tsx'), 'new terms\n');
  const before = structuredClone(manifest);
  assert.deepEqual(staleEntries(manifest, root), [
    { path: '/terms', lastmod: '2026-01-02', sha256: sourcesHash(root, ['terms.tsx']) },
  ]);

  const next = stamp(manifest, root, '2026-11-21');
  assert.deepEqual(next['/'], manifest['/']);
  assert.deepEqual(next['/terms'], {
    lastmod: '2026-11-21',
    sources: ['terms.tsx'],
    sha256: sourcesHash(root, ['terms.tsx']),
  });
  assert.deepEqual(manifest, before);
  assert.deepEqual(staleEntries(next, root), []);
});

test('a page given another source file counts as changed', () => {
  const root = fixture({ 'a.ts': 'a\n', 'b.ts': 'b\n' });
  const manifest = { '/': { lastmod: '2026-01-01', sources: ['a.ts', 'b.ts'], sha256: sourcesHash(root, ['a.ts']) } };
  assert.equal(staleEntries(manifest, root).length, 1);
});

test('utcDay is the UTC calendar day', () => {
  assert.equal(utcDay(new Date('2026-11-21T23:59:59-05:00')), '2026-11-22');
  assert.equal(utcDay(new Date('2026-11-21T00:00:00Z')), '2026-11-21');
});
