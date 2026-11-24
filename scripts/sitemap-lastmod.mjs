#!/usr/bin/env node
/**
 * Keeps the hub's sitemap dates current (ESCSUITE-490).
 *
 * Each hub page's `<lastmod>` in `sitemap.xml` comes from
 * `apps/plan/src/lib/sitemap-lastmod.json`: per page, the date it last
 * changed, the source files that make it up (relative to `apps/plan`), and a
 * SHA-256 of those files. The dates used to come from git history at build
 * time, but the hosting builds from a shallow clone, where that history is cut
 * off, so production listed every page with no date. A committed manifest gives
 * the same dates in any clone, at any depth, and without git.
 *
 * The hash is what keeps the dates honest: `scripts/sitemap-lastmod.test.mjs`
 * fails when a page's files no longer match it, so a page cannot change without
 * its date moving too. To move it, run
 *
 *   pnpm sitemap:stamp
 *
 * which gives every changed page today's date (UTC) and its new hash, and commit
 * the result. Without `--write` it only checks, and exits 1 when a page is out
 * of date.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The hub's package root, which each entry's `sources` are relative to. */
export const PLAN_ROOT = join(here, '..', 'apps', 'plan');

/** The committed manifest the hub's build reads. */
export const MANIFEST_PATH = join(PLAN_ROOT, 'src', 'lib', 'sitemap-lastmod.json');

/**
 * SHA-256 (hex) of a page's source files, in the order listed. Each file
 * contributes its path and its text with CRLF line endings read as LF, so a
 * Windows checkout hashes the same as any other.
 */
export function sourcesHash(root, sources) {
  const hash = createHash('sha256');
  for (const source of sources) {
    const text = readFileSync(join(root, source), 'utf8').replace(/\r\n/g, '\n');
    hash.update(`${source}\0${text}\0`);
  }
  return hash.digest('hex');
}

/** The pages whose files no longer match their recorded hash, with the new one. */
export function staleEntries(manifest, root) {
  return Object.entries(manifest).flatMap(([path, entry]) => {
    const sha256 = sourcesHash(root, entry.sources);
    return sha256 === entry.sha256 ? [] : [{ path, lastmod: entry.lastmod, sha256 }];
  });
}

/** `date` as `YYYY-MM-DD` in UTC, the form each `lastmod` takes. */
export function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * A copy of `manifest` in which every stale page has `today` as its date and
 * its files' current hash; pages that did not change keep theirs.
 */
export function stamp(manifest, root, today) {
  const next = structuredClone(manifest);
  for (const { path, sha256 } of staleEntries(manifest, root)) {
    next[path].lastmod = today;
    next[path].sha256 = sha256;
  }
  return next;
}

export function serialize(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function main(argv) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (argv.includes('--write')) {
    const today = utcDay(new Date());
    const stale = staleEntries(manifest, PLAN_ROOT);
    writeFileSync(MANIFEST_PATH, serialize(stamp(manifest, PLAN_ROOT, today)));
    for (const { path } of stale) console.log(`${path}: lastmod ${today}`);
    if (stale.length === 0) console.log('Every hub page is up to date.');
    return 0;
  }
  const stale = staleEntries(manifest, PLAN_ROOT);
  for (const { path, lastmod } of stale) {
    console.error(`${path}: its files changed since its lastmod (${lastmod}).`);
  }
  if (stale.length > 0) {
    console.error('Run `pnpm sitemap:stamp` and commit apps/plan/src/lib/sitemap-lastmod.json.');
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
