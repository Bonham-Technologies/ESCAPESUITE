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
 */

import { execSync } from 'child_process';
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const distDir = join(root, 'dist');
const appsDir = join(root, 'apps');

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
if (existsSync(planDist)) {
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
  console.warn('  ⚠️  ESCAPEPLAN dist not found');
}

// Copy ESCAPECRAFT to dist/craft
const craftDist = join(appsDir, 'craft', 'dist');
const craftOut = join(distDir, 'craft');
mkdirSync(craftOut, { recursive: true });
if (existsSync(craftDist)) {
  console.log('  → Copying ESCAPECRAFT to dist/craft/');
  cpSync(craftDist, craftOut, { recursive: true });
} else {
  console.warn('  ⚠️  ESCAPECRAFT dist not found');
}

// Copy ESCAPEARTIST to dist/artist
const artistDist = join(appsDir, 'artist', 'dist');
const artistOut = join(distDir, 'artist');
mkdirSync(artistOut, { recursive: true });
if (existsSync(artistDist)) {
  console.log('  → Copying ESCAPEARTIST to dist/artist/');
  cpSync(artistDist, artistOut, { recursive: true });
} else {
  console.warn('  ⚠️  ESCAPEARTIST dist not found');
}

console.log('\n✅ Build complete! Output in dist/\n');
