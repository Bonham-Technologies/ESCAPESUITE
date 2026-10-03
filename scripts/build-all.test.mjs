/**
 * Unit tests for the postcondition guard in `build-all.mjs` — the combined
 * build script that assembles each app's dist output into the single
 * `dist/` Vercel publishes.
 *
 * `turbo build --filter=<pkg>` exits 0 when a filtered package has no
 * `build` task at all ("0 successful, 0 total"), so a rename or a task moved
 * in `turbo.json` can leave `build-all.mjs` copying nothing for an app while
 * still reporting success. These tests pin the pure filesystem checks that
 * decide whether an app (or the assembled `dist/`) actually produced
 * something to publish, so that decision can be exercised without running a
 * real build.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import { checkAppDist, isNonEmptyFile, verifyDistLayout } from './build-all.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const tmpDirs = [];
function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'build-all-test-'));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isNonEmptyFile: false when the file does not exist', () => {
  const dir = makeTmpDir();
  assert.equal(isNonEmptyFile(join(dir, 'index.html')), false);
});

test('isNonEmptyFile: false when the file exists but is empty', () => {
  const dir = makeTmpDir();
  const file = join(dir, 'index.html');
  writeFileSync(file, '');
  assert.equal(isNonEmptyFile(file), false);
});

test('isNonEmptyFile: false when the path is a directory, not a file', () => {
  const dir = makeTmpDir();
  const sub = join(dir, 'index.html');
  mkdirSync(sub);
  assert.equal(isNonEmptyFile(sub), false);
});

test('isNonEmptyFile: true when the file exists and has content', () => {
  const dir = makeTmpDir();
  const file = join(dir, 'index.html');
  writeFileSync(file, '<html></html>');
  assert.equal(isNonEmptyFile(file), true);
});

test('checkAppDist: fails when the app dist directory is missing entirely', () => {
  const dir = makeTmpDir();
  const appDist = join(dir, 'apps', 'craft', 'dist');
  assert.equal(checkAppDist(appDist), false);
});

test('checkAppDist: fails when the dist directory exists but has no index.html', () => {
  const dir = makeTmpDir();
  const appDist = join(dir, 'apps', 'craft', 'dist');
  mkdirSync(appDist, { recursive: true });
  writeFileSync(join(appDist, 'other-file.txt'), 'not the entry point');
  assert.equal(checkAppDist(appDist), false);
});

test('checkAppDist: fails when index.html exists but is empty', () => {
  const dir = makeTmpDir();
  const appDist = join(dir, 'apps', 'craft', 'dist');
  mkdirSync(appDist, { recursive: true });
  writeFileSync(join(appDist, 'index.html'), '');
  assert.equal(checkAppDist(appDist), false);
});

test('checkAppDist: succeeds for a populated app dist', () => {
  const dir = makeTmpDir();
  const appDist = join(dir, 'apps', 'craft', 'dist');
  mkdirSync(appDist, { recursive: true });
  writeFileSync(join(appDist, 'index.html'), '<html>craft</html>');
  assert.equal(checkAppDist(appDist), true);
});

function makeCompleteDist(dir) {
  mkdirSync(join(dir, 'craft'), { recursive: true });
  mkdirSync(join(dir, 'artist'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<html>plan</html>');
  writeFileSync(join(dir, '404.html'), '<html>404</html>');
  writeFileSync(join(dir, 'craft', 'index.html'), '<html>craft</html>');
  writeFileSync(join(dir, 'artist', 'index.html'), '<html>artist</html>');
}

test('verifyDistLayout: empty list when every required output is present and non-empty', () => {
  const dir = makeTmpDir();
  makeCompleteDist(dir);
  assert.deepEqual(verifyDistLayout(dir), []);
});

test('verifyDistLayout: reports dist/craft/index.html missing when craft produced no dist', () => {
  const dir = makeTmpDir();
  makeCompleteDist(dir);
  rmSync(join(dir, 'craft'), { recursive: true, force: true });
  const missing = verifyDistLayout(dir);
  assert.equal(missing.length, 1);
  assert.equal(missing[0], join(dir, 'craft', 'index.html'));
});

test('verifyDistLayout: reports dist/artist/index.html when it exists but is empty', () => {
  const dir = makeTmpDir();
  makeCompleteDist(dir);
  writeFileSync(join(dir, 'artist', 'index.html'), '');
  const missing = verifyDistLayout(dir);
  assert.deepEqual(missing, [join(dir, 'artist', 'index.html')]);
});

test('verifyDistLayout: reports every missing output when the whole dist is empty', () => {
  const dir = makeTmpDir();
  const missing = verifyDistLayout(dir);
  assert.equal(missing.length, 4);
});

/**
 * `main()` is only meant to run when this file is executed directly, not when
 * its helpers are imported for testing. The guard used to compare
 * `import.meta.url` (which percent-encodes the path) against `process.argv[1]`
 * (which does not) — so a checkout under a path containing a space (or any
 * other character a URL encodes) made the guard false, and the script printed
 * nothing and exited 0 having built nothing. These two cases run the real
 * file as a subprocess, once from a plain directory and once from a directory
 * whose name contains a space, and assert both reach the first line `main()`
 * prints — `pnpm turbo build` has nothing to build here (no package.json), so
 * both runs fail loudly after that line, which is the point: they ran at all.
 */
function runEntryGuardFrom(dirName) {
  const base = mkdtempSync(join(tmpdir(), 'build-all-entry-'));
  const scripts = join(base, dirName, 'scripts');
  mkdirSync(scripts, { recursive: true });
  cpSync(join(here, 'build-all.mjs'), join(scripts, 'build-all.mjs'));
  try {
    return execFileSync(process.execPath, [join(scripts, 'build-all.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // A real run reaches `pnpm turbo build` and fails (no package.json here),
    // which is the point: it RAN.
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test('entry guard: build-all.mjs runs when invoked from a path with no space (control)', () => {
  assert.match(runEntryGuardFrom('plain'), /Building ESCAPE Suite for production/);
});

test('entry guard: build-all.mjs runs when invoked from a path containing a space', () => {
  assert.match(runEntryGuardFrom('with space'), /Building ESCAPE Suite for production/);
});
