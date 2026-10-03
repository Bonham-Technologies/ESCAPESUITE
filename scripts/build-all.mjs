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
 * missing or empty app output into a fatal error instead.
 */

import { execSync } from 'child_process';
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync, statSync, realpathSync } from 'fs';
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
 * Verifies the combined `dist/` this script assembles has the fixed shape
 * `vercel.json`'s `outputDirectory` promises: a plan root page, its 404
 * fallback, and one `index.html` each for craft and artist. Returns the
 * list of required paths that are missing or empty — an empty array means
 * every postcondition holds.
 */
export function verifyDistLayout(distDir) {
  const required = [
    join(distDir, 'index.html'),
    join(distDir, '404.html'),
    join(distDir, 'craft', 'index.html'),
    join(distDir, 'artist', 'index.html'),
  ];
  return required.filter((path) => !isNonEmptyFile(path));
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
