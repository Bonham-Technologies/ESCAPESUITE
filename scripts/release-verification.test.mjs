/**
 * Weak regression guard for ESCSUITE-401: every release that carries an
 * offline build also carries a SHA256SUMS.txt over all its assets and a
 * build-provenance attestation for each, and the workflow that publishes it
 * then downloads the release and verifies both, failing on a mismatch.
 *
 * Like release-latest-guard.test.mjs, this greps the workflow YAML for the
 * tokens the feature depends on; it cannot run a release (that needs a real
 * GitHub Actions run). scripts/verify-release-assets.test.mjs tests the
 * verification itself.
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
const repoRoot = join(here, '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

const standaloneReleaseYml = read('.github/workflows/standalone-release.yml');
const releaseYml = read('.github/workflows/release.yml');

// The attestation action, pinned to a full commit SHA: it signs with the
// job's OIDC token, so a moved tag must never change what runs.
const ATTEST_ACTION = /uses:\s*actions\/attest-build-provenance@[0-9a-f]{40}\b/;
const VERIFY_DOC = 'https://github.com/${REPO}/blob/main/docs/VERIFY.md';

/** The text of one top-level job, from its key to the next job's key. */
function job(text, name) {
  const start = text.match(new RegExp(`^  ${name}:\\s*$`, 'm'));
  assert.ok(start, `expected a job named ${name}`);
  const rest = text.slice(start.index + start[0].length);
  const end = rest.match(/^ {2}\S.*:\s*$/m);
  return end ? rest.slice(0, end.index) : rest;
}

/** The text of one step in `jobText`, from its `- name:` line to the next step. */
function step(jobText, namePattern) {
  const start = jobText.match(new RegExp(`^\\s*- name:.*${namePattern.source}.*$`, 'm'));
  assert.ok(start, `expected a step matching ${namePattern}`);
  const rest = jobText.slice(start.index + start[0].length);
  const end = rest.match(/^\s*- name:/m);
  return end ? rest.slice(0, end.index) : rest;
}

function permissions(jobText) {
  const block = jobText.match(/^ {4}permissions:\s*\n((?: {6}.*\n)+)/m);
  assert.ok(block, 'expected a job-level permissions block');
  return block[1];
}

test('standalone-release.yml writes SHA256SUMS.txt over every staged asset, -latest aliases included', () => {
  const release = job(standaloneReleaseYml, 'release');
  const stage = step(release, /SHA256SUMS/);

  for (const asset of [
    'ESCAPECRAFT-${CRAFT_VERSION}.html',
    'ESCAPECRAFT-latest.html',
    'ESCAPEARTIST-${ARTIST_VERSION}.html',
    'ESCAPEARTIST-latest.html',
    'escapesuite-headless-artist-${VERSION}.tgz',
  ]) {
    assert.ok(stage.includes(asset), `expected the staging step to stage ${asset}`);
  }
  // The sums cover the whole staging directory, so nothing staged is missed.
  assert.match(stage, /sha256sum -- \*/);
  assert.match(stage, /SHA256SUMS\.txt/);
});

test('standalone-release.yml attests every staged asset before creating the release', () => {
  const release = job(standaloneReleaseYml, 'release');
  const perms = permissions(release);
  assert.match(perms, /contents:\s*write/);
  assert.match(perms, /id-token:\s*write/);
  assert.match(perms, /attestations:\s*write/);

  const attestIndex = release.search(ATTEST_ACTION);
  assert.notEqual(attestIndex, -1, 'expected a SHA-pinned actions/attest-build-provenance step');
  assert.match(release.slice(attestIndex), /subject-path:\s*release-assets\/\*/);

  const createIndex = release.search(/gh release create "v\$\{VERSION\}"/);
  assert.ok(attestIndex < createIndex, 'attestations must exist before the release is published');

  const create = step(release, /Create release/);
  assert.match(create, /release-assets\/SHA256SUMS\.txt/);
  assert.ok(create.includes(VERIFY_DOC), 'release notes must link to docs/VERIFY.md');
  assert.match(create, /created=true/);
});

test('only the release job of standalone-release.yml can mint attestations', () => {
  for (const name of ['prepare', 'comment-pr', 'verify-release']) {
    assert.doesNotMatch(job(standaloneReleaseYml, name), /id-token:\s*write|attestations:\s*write/);
  }
  assert.doesNotMatch(standaloneReleaseYml, /^permissions:/m, 'no workflow-level permissions');
});

test('standalone-release.yml verifies the published release and fails on a mismatch', () => {
  const verify = job(standaloneReleaseYml, 'verify-release');
  assert.match(verify, /needs:\s*\[?[^\n]*\brelease\b/);
  // Only a release this run created has sums and attestations to check; an
  // older release reached through the skip path predates them.
  assert.match(verify, /needs\.release\.outputs\.created\s*==\s*'true'/);
  assert.match(
    verify,
    /bash scripts\/verify-release-assets\.sh "v\$\{VERSION\}" "\$REPO" "\$\{REPO\}\/\.github\/workflows\/standalone-release\.yml"/
  );
  assert.doesNotMatch(verify, /continue-on-error:\s*true/);
});

test('release.yml writes SHA256SUMS.txt and attests every per-package build it attaches', () => {
  const upload = job(releaseYml, 'upload-standalone');
  const perms = permissions(upload);
  assert.match(perms, /contents:\s*write/);
  assert.match(perms, /id-token:\s*write/);
  assert.match(perms, /attestations:\s*write/);

  const prepare = step(upload, /Prepare versioned builds/);
  assert.match(prepare, /sha256sum/);
  assert.match(prepare, /SHA256SUMS\.txt/);

  const attestIndex = upload.search(ATTEST_ACTION);
  const attachIndex = upload.search(/- name: Attach builds to GitHub Release/);
  assert.notEqual(attestIndex, -1, 'expected a SHA-pinned actions/attest-build-provenance step');
  assert.ok(attestIndex < attachIndex, 'attestations must exist before the builds are attached');

  const attach = step(upload, /Attach builds to GitHub Release/);
  assert.match(attach, /name:\s*'SHA256SUMS\.txt'/);
  assert.match(attach, /docs\/VERIFY\.md/);
  // The notes edit must not hand a per-package release GitHub's "latest".
  const update = attach.slice(attach.indexOf('updateRelease'));
  assert.match(update.slice(0, update.indexOf('});')), /make_latest:\s*'false'/);
});

test('release.yml verifies every per-package release it attached to', () => {
  const upload = job(releaseYml, 'upload-standalone');
  const verify = step(upload, /Verify/);
  assert.match(verify, /steps\.attach\.outputs\.tags/);
  assert.match(
    verify,
    /bash scripts\/verify-release-assets\.sh "\$tag" "\$REPO" "\$\{REPO\}\/\.github\/workflows\/release\.yml"/
  );
  assert.match(verify, /exit "?\$status"?/);
});

test('docs/VERIFY.md gives both checks for the release assets', () => {
  const doc = read('docs/VERIFY.md');
  assert.match(doc, /sha256sum -c/);
  assert.match(doc, /shasum -a 256/);
  assert.match(doc, /Get-FileHash/);
  assert.match(doc, /gh attestation verify ESCAPEARTIST-[^\s]*\.html -R Bonham-Technologies\/ESCAPESUITE/);
  assert.match(doc, /-latest\.html/);
});

test('the README "Use it now" section links to the verification steps', () => {
  const readme = read('README.md');
  const useItNow = readme.slice(readme.indexOf('## Use it now'), readme.indexOf('## Features'));
  assert.match(useItNow, /\]\(docs\/VERIFY\.md\)/);
  assert.match(useItNow, /-latest\.html/);
});
