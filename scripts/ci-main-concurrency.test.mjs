/**
 * Weak regression guard for ESCSUITE-382: pushes to `main` must not cancel
 * each other's CI runs, or a merged commit never gets a `ci-status` verdict
 * and "main must stay green" can't pin a regression to the merge that caused
 * it.
 *
 * Like `release-latest-guard.test.mjs`, this greps the YAML text rather than
 * executing the workflow (that needs a real GitHub Actions run). It checks:
 *
 * - the workflow-level and `ci-status` concurrency groups are per commit on
 *   `main` (a shared group would cancel, or replace while pending, an earlier
 *   run);
 * - the `deploy` job serialises production deploys and skips a commit that
 *   `main` has already moved past, so an older commit never replaces a newer
 *   one in production now that main runs overlap.
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
const ciYml = readFileSync(join(here, '..', '.github/workflows/ci.yml'), 'utf8');

const PER_COMMIT_ON_MAIN = "(github.ref == 'refs/heads/main' && github.sha)";

/** The text of top-level job `name`, up to the next top-level job. */
function jobBlock(name) {
  const start = ciYml.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name} not found in ci.yml`);
  const next = ciYml.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? ciYml.slice(start) : ciYml.slice(start, start + 1 + next);
}

/** The `group:` value of the first `concurrency:` block in `text`. */
function concurrencyGroup(text) {
  const match = text.match(/concurrency:\n\s+group: (.+)\n\s+cancel-in-progress: (.+)\n/);
  assert.ok(match, 'no concurrency block found');
  return { group: match[1], cancel: match[2] };
}

test('the workflow-level concurrency group is per commit on main', () => {
  const header = ciYml.slice(0, ciYml.indexOf('\njobs:\n'));
  const { group } = concurrencyGroup(header);
  assert.ok(group.includes(PER_COMMIT_ON_MAIN), `group was: ${group}`);
});

test('ci-status concurrency group is per commit on main', () => {
  const { group, cancel } = concurrencyGroup(jobBlock('ci-status'));
  assert.ok(group.includes(PER_COMMIT_ON_MAIN), `group was: ${group}`);
  assert.equal(cancel, 'false');
});

test('production deploys are serialised and never cancelled', () => {
  const { group, cancel } = concurrencyGroup(jobBlock('deploy'));
  assert.match(group, /'production'/);
  assert.equal(cancel, 'false');
});

test('the deploy job skips a commit main has moved past', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /git ls-remote origin refs\/heads\/main/);
  const deployStep = deploy.slice(deploy.indexOf('- name: Deploy to Vercel'));
  assert.match(deployStep, /if: steps\.stale\.outputs\.skip != 'true'/);
});

test('standalone-release only lets main\'s head create or re-mark the latest release', () => {
  const standaloneYml = readFileSync(
    join(here, '..', '.github/workflows/standalone-release.yml'),
    'utf8'
  );
  const release = standaloneYml.slice(standaloneYml.indexOf('\n  release:\n'));
  const guard = release.indexOf('git/ref/heads/main');
  assert.ok(guard >= 0, 'release job has no main-head check');
  assert.ok(
    guard < release.indexOf('--latest'),
    'the main-head check must run before any --latest call'
  );
});
