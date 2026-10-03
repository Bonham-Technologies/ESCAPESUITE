#!/usr/bin/env node

/**
 * Build script that combines all ESCAPE Suite apps into a single dist folder
 * for Vercel deployment.
 *
 * Output structure:
 * dist/
 * ├── index.html          (ESCAPEPLAN)
 * ├── 404.html            (SPA fallback)
 * ├── assets/             (ESCAPEPLAN assets)
 * ├── craft/
 * │   └── index.html      (ESCAPECRAFT - single file)
 * └── artist/
 *     └── index.html      (ESCAPEARTIST - single file)
 *
 * Every one of these outputs is mandatory. `turbo build --filter=<pkg>` exits
 * 0 even when the filtered package has no `build` task at all ("0 successful,
 * 0 total"), so a rename, a package split, or a task moved in `turbo.json`
 * would otherwise leave this script assembling (and reporting success for) a
 * `dist/` with an empty `craft/` or `artist/`. The checks below turn a
 * missing or empty app output into a fatal error instead — and, since
 * ESCSUITE-194's verification pass, also catch a `dist/` whose entry HTML
 * survived but whose referenced JS/CSS/worker chunks (`assets/*.js`,
 * `assets/*.css`, ARTIST's `decodeWorker-*.js`) did not: `verifyDistLayout`
 * scans each present entry HTML for its own same-origin references and
 * checks those exist too, rather than trusting four non-empty HTML files
 * alone.
 */

import { execSync } from 'child_process';
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
  statSync,
  realpathSync,
  readFileSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/**
 * True when `filePath` exists and is a regular file with at least one byte.
 * An empty file — a build that created the shell but wrote nothing to it —
 * counts the same as a missing one: both mean there is nothing to publish.
 */
export function isNonEmptyFile(filePath) {
  if (!existsSync(filePath)) return false;
  const stats = statSync(filePath);
  return stats.isFile() && stats.size > 0;
}

/**
 * Checks whether one app's own build output directory actually produced
 * something to publish. `requiredFile` is the file that output is judged
 * by — `index.html` for every app in this repo, single-file builds
 * included.
 */
export function checkAppDist(appDistDir, requiredFile = 'index.html') {
  return isNonEmptyFile(join(appDistDir, requiredFile));
}

/**
 * Local JS/CSS asset paths an entry HTML references by an absolute,
 * root-relative `src="/…"` or `href="/…"` — the shape Vite emits for a build
 * that is not single-filed (ESCAPEPLAN's hub, the only one of the three with
 * a separate `assets/` directory). Resolved against `distDir` itself, since
 * the path is already root-relative.
 */
function absoluteAssetRefs(html) {
  const refs = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/[^"]+?\.(?:js|css))"/g)) {
    refs.add(match[1]);
  }
  return [...refs];
}

/**
 * Bare `decodeWorker-<hash>.js` filenames embedded inside an entry HTML's
 * inlined JS as a `new URL('decodeWorker-<hash>.js', import.meta.url)`
 * string — the hosted ESCAPEARTIST build's background-tab MP4 export
 * worker, the one file `apps/artist/singleFileBuild.js` leaves as an
 * ordinary fetchable chunk beside `index.html` rather than inlining (see the
 * root CLAUDE.md's "Single-file Builds" note). Resolved against the HTML
 * file's own directory, since that is where Vite emits it.
 */
function workerChunkRefs(html) {
  const refs = new Set();
  for (const match of html.matchAll(/\bdecodeWorker-[A-Za-z0-9]+\.js\b/g)) {
    refs.add(match[0]);
  }
  return [...refs];
}

/**
 * Every local script/stylesheet/worker chunk `htmlPath` itself references,
 * that is missing or empty on disk. A `turbo build` cache hit restores
 * `outputs: ["dist/**"]` wholesale, so this is latent rather than observed —
 * but a narrowed output glob, a moved task, or a changed build target could
 * leave an entry HTML's hashed references pointing at nothing, and the
 * four-file check above would not notice: the HTML itself is present and
 * non-empty, the JS it needs is simply gone. Scanning the emitted HTML for
 * its own references, rather than hard-coding a filename pattern, is what
 * keeps this from going stale as the bundler's hashed output names change
 * between builds.
 */
function missingReferencedAssets(distDir, htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const missing = [];
  for (const ref of absoluteAssetRefs(html)) {
    const candidate = join(distDir, ref);
    if (!isNonEmptyFile(candidate)) missing.push(candidate);
  }
  for (const ref of workerChunkRefs(html)) {
    const candidate = join(dirname(htmlPath), ref);
    if (!isNonEmptyFile(candidate)) missing.push(candidate);
  }
  return missing;
}

/**
 * Verifies the combined `dist/` this script assembles has the fixed shape
 * `vercel.json`'s `outputDirectory` promises: a plan root page, its 404
 * fallback, and one `index.html` each for craft and artist — and that each
 * of those entry HTML files that IS present actually has the JS/CSS/worker
 * chunks it references. Returns the list of required or referenced paths
 * that are missing or empty — an empty array means every postcondition
 * holds.
 */
export function verifyDistLayout(distDir) {
  const entryHtmlPaths = [
    join(distDir, 'index.html'),
    join(distDir, '404.html'),
    join(distDir, 'craft', 'index.html'),
    join(distDir, 'artist', 'index.html'),
  ];
  const missing = entryHtmlPaths.filter((path) => !isNonEmptyFile(path));

  for (const htmlPath of entryHtmlPaths) {
    if (isNonEmptyFile(htmlPath)) {
      missing.push(...missingReferencedAssets(distDir, htmlPath));
    }
  }

  return missing;
}

/**
 * True when this file was executed, false when a test imported it.
 *
 * `import.meta.url` is already realpath'd, so argv[1] has to be too — otherwise
 * a checkout under a path containing a space (or any other character a URL
 * encodes) would compare unequal (the old guard's bug: `import.meta.url`
 * percent-encodes the path while `process.argv[1]` does not) and the script
 * would exit 0 having built nothing. When realpath itself fails (an unreadable
 * parent directory, a container mount that refuses it) the lexical comparison
 * is still right for the unsymlinked case, and a wrong `false` here is the
 * worst outcome available: a build that silently publishes nothing.
 */
export function isDirectRun(entry = process.argv[1]) {
  if (entry === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  const resolved = resolve(entry);
  try {
    return realpathSync(resolved) === modulePath;
  } catch {
    return resolved === modulePath;
  }
}

// Only run the build when this file is executed directly (not when its
// helpers are imported for testing).
if (isDirectRun()) {
  main();
}

function main() {
  const distDir = join(root, 'dist');
  const appsDir = join(root, 'apps');
  const failures = [];

  console.log('🏗️  Building ESCAPE Suite for production...\n');

  // Clean dist directory
  if (existsSync(distDir)) {
    console.log('🧹 Cleaning dist directory...');
    rmSync(distDir, { recursive: true });
  }
  mkdirSync(distDir, { recursive: true });

  // Build all apps using Turbo
  console.log('📦 Building all apps with Turbo...\n');
  try {
    execSync('pnpm turbo build --filter=@escapesuite/plan --filter=@escapesuite/craft --filter=@escapesuite/artist', {
      cwd: root,
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('❌ Build failed');
    process.exit(1);
  }

  console.log('\n📁 Assembling dist folder...\n');

  // Copy ESCAPEPLAN (main site) to dist root
  const planDist = join(appsDir, 'plan', 'dist');
  if (checkAppDist(planDist)) {
    console.log('  → Copying ESCAPEPLAN to dist/');
    cpSync(planDist, distDir, { recursive: true });

    // Create 404.html for SPA routing
    const indexHtml = join(distDir, 'index.html');
    const notFoundHtml = join(distDir, '404.html');
    if (existsSync(indexHtml)) {
      copyFileSync(indexHtml, notFoundHtml);
      console.log('  → Created 404.html for SPA routing');
    }
  } else {
    console.error('  ❌ ESCAPEPLAN dist not found or empty — nothing to publish');
    failures.push('ESCAPEPLAN');
  }

  // Copy ESCAPECRAFT to dist/craft
  const craftDist = join(appsDir, 'craft', 'dist');
  const craftOut = join(distDir, 'craft');
  if (checkAppDist(craftDist)) {
    console.log('  → Copying ESCAPECRAFT to dist/craft/');
    mkdirSync(craftOut, { recursive: true });
    cpSync(craftDist, craftOut, { recursive: true });
  } else {
    console.error('  ❌ ESCAPECRAFT dist not found or empty — nothing to publish');
    failures.push('ESCAPECRAFT');
  }

  // Copy ESCAPEARTIST to dist/artist
  const artistDist = join(appsDir, 'artist', 'dist');
  const artistOut = join(distDir, 'artist');
  if (checkAppDist(artistDist)) {
    console.log('  → Copying ESCAPEARTIST to dist/artist/');
    mkdirSync(artistOut, { recursive: true });
    cpSync(artistDist, artistOut, { recursive: true });
  } else {
    console.error('  ❌ ESCAPEARTIST dist not found or empty — nothing to publish');
    failures.push('ESCAPEARTIST');
  }

  const missingOutputs = verifyDistLayout(distDir);
  if (missingOutputs.length > 0) {
    console.error('\n❌ dist/ is missing required output:');
    for (const path of missingOutputs) {
      console.error(`   - ${path}`);
    }
  }

  if (failures.length > 0 || missingOutputs.length > 0) {
    console.error(
      `\n❌ Build failed: ${failures.length > 0 ? failures.join(', ') + ' produced no dist.' : 'dist/ layout is incomplete.'}`
    );
    process.exit(1);
  }

  console.log('\n✅ Build complete! Output in dist/\n');
}
