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

// ESCSUITE-430: every build also ships an SPDX SBOM of its production
// dependency tree, attested against the build's own digest.
const ATTEST_SBOM_ACTION = /uses:\s*actions\/attest-sbom@[0-9a-f]{40}\b/g;
const PUSH_TO_MAIN_ONLY =
  /if:\s*steps\.check\.outputs\.is_pr == 'false' && github\.event\.workflow_run\.head_branch == 'main'/;

/** Every step in `jobText` that uses a SHA-pinned actions/attest-sbom, as text. */
function sbomAttestSteps(jobText) {
  return [...jobText.matchAll(ATTEST_SBOM_ACTION)].map((match) => {
    const before = jobText.slice(0, match.index);
    const start = before.lastIndexOf('- name:');
    const rest = jobText.slice(match.index);
    const end = rest.search(/^\s*- name:/m);
    return jobText.slice(start, match.index + (end === -1 ? rest.length : end));
  });
}

test('standalone-release.yml generates an SPDX SBOM per build, only for a push to main', () => {
  const prepare = job(standaloneReleaseYml, 'prepare');
  const install = step(prepare, /Install dependencies/);
  assert.match(install, PUSH_TO_MAIN_ONLY);
  // Nothing is built here: no dependency's install script needs to run.
  assert.match(install, /pnpm install --frozen-lockfile --ignore-scripts/);

  const generate = step(prepare, /SBOM/);
  assert.match(generate, PUSH_TO_MAIN_ONLY);
  for (const line of [
    'node scripts/generate-sbom.mjs --build "dist/craft/ESCAPECRAFT-${CRAFT_VERSION}.html" --package @escapesuite/craft --output "dist/craft/ESCAPECRAFT-${CRAFT_VERSION}.spdx.json"',
    'node scripts/generate-sbom.mjs --build "dist/artist/ESCAPEARTIST-${ARTIST_VERSION}.html" --package @escapesuite/artist --output "dist/artist/ESCAPEARTIST-${ARTIST_VERSION}.spdx.json"',
    // The kit's headless.html inlines ESCAPEARTIST's render bundle.
    'node scripts/generate-sbom.mjs --build "dist/kit/escapesuite-headless-artist-${VERSION}.tgz" --package @escapesuite/headless-artist --package @escapesuite/artist --output "dist/kit/escapesuite-headless-artist-${VERSION}.spdx.json"',
  ]) {
    assert.ok(generate.includes(line), `expected the SBOM step to run: ${line}`);
  }
  // Generated before the artifact the release job downloads is uploaded.
  assert.ok(
    prepare.indexOf('generate-sbom.mjs') < prepare.indexOf('- name: Upload release artifacts'),
    'the SBOMs must be in the uploaded standalone-release artifact'
  );
});

test('standalone-release.yml publishes and attests each SBOM next to its build', () => {
  const release = job(standaloneReleaseYml, 'release');

  // Staged with the builds, so SHA256SUMS.txt and the provenance attestation cover them.
  const stage = step(release, /SHA256SUMS/);
  for (const sbom of [
    'dist/craft/ESCAPECRAFT-${CRAFT_VERSION}.spdx.json',
    'dist/artist/ESCAPEARTIST-${ARTIST_VERSION}.spdx.json',
    'dist/kit/escapesuite-headless-artist-${VERSION}.spdx.json',
  ]) {
    assert.ok(stage.includes(sbom), `expected the staging step to stage ${sbom}`);
  }

  const attests = sbomAttestSteps(release);
  assert.equal(attests.length, 3, 'expected one SHA-pinned actions/attest-sbom step per build');
  for (const [build, sbom] of [
    [
      'release-assets/ESCAPECRAFT-${{ needs.prepare.outputs.craft_version }}.html',
      'release-assets/ESCAPECRAFT-${{ needs.prepare.outputs.craft_version }}.spdx.json',
    ],
    [
      'release-assets/ESCAPEARTIST-${{ needs.prepare.outputs.artist_version }}.html',
      'release-assets/ESCAPEARTIST-${{ needs.prepare.outputs.artist_version }}.spdx.json',
    ],
    [
      'release-assets/escapesuite-headless-artist-${{ needs.prepare.outputs.version }}.tgz',
      'release-assets/escapesuite-headless-artist-${{ needs.prepare.outputs.version }}.spdx.json',
    ],
  ]) {
    const attest = attests.find((text) => text.includes(`subject-path: ${build}`));
    assert.ok(attest, `expected an SBOM attestation with subject ${build}`);
    assert.ok(attest.includes(`sbom-path: ${sbom}`), `expected ${build} attested with ${sbom}`);
    assert.match(attest, /if:\s*steps\.decide\.outputs\.publish == 'true'/);
  }

  const createIndex = release.search(/gh release create "v\$\{VERSION\}"/);
  assert.ok(
    release.search(ATTEST_SBOM_ACTION) < createIndex,
    'SBOM attestations must exist before the release is published'
  );

  const create = step(release, /Create release/);
  for (const sbom of [
    'release-assets/ESCAPECRAFT-${CRAFT_VERSION}.spdx.json',
    'release-assets/ESCAPEARTIST-${ARTIST_VERSION}.spdx.json',
    'release-assets/escapesuite-headless-artist-${VERSION}.spdx.json',
  ]) {
    assert.ok(create.includes(sbom), `expected the release to carry ${sbom}`);
  }
  assert.match(create, /SBOM/, 'the "Verify your download" notes must mention the SBOM');
});

test('release.yml generates, attests and attaches an SBOM for every per-package build', () => {
  const upload = job(releaseYml, 'upload-standalone');
  const prepare = step(upload, /Prepare versioned builds/);
  for (const line of [
    'node scripts/generate-sbom.mjs --build "uploads/ESCAPECRAFT-${VERSION}.html" --package @escapesuite/craft --output "sboms/ESCAPECRAFT-${VERSION}.spdx.json"',
    'node scripts/generate-sbom.mjs --build "uploads/ESCAPEARTIST-${VERSION}.html" --package @escapesuite/artist --output "sboms/ESCAPEARTIST-${VERSION}.spdx.json"',
    'node scripts/generate-sbom.mjs --build "uploads/escapesuite-headless-artist-${VERSION}.tgz" --package @escapesuite/headless-artist --package @escapesuite/artist --output "sboms/escapesuite-headless-artist-${VERSION}.spdx.json"',
  ]) {
    assert.ok(prepare.includes(line), `expected the prepare step to run: ${line}`);
  }
  // Each release's SHA256SUMS.txt lists its build and that build's SBOM.
  assert.match(prepare, /cd sboms && sha256sum -- "\$sbom"/);

  // The provenance attestation covers the SBOM files too.
  const provenance = step(upload, /Attest build provenance/);
  assert.match(provenance, /sboms\/\*/);

  const attests = sbomAttestSteps(upload);
  assert.equal(attests.length, 3, 'expected one SHA-pinned actions/attest-sbom step per build');
  for (const [flag, build, sbom] of [
    [
      'craft_released',
      'uploads/ESCAPECRAFT-${{ steps.check-apps.outputs.craft_version }}.html',
      'sboms/ESCAPECRAFT-${{ steps.check-apps.outputs.craft_version }}.spdx.json',
    ],
    [
      'artist_released',
      'uploads/ESCAPEARTIST-${{ steps.check-apps.outputs.artist_version }}.html',
      'sboms/ESCAPEARTIST-${{ steps.check-apps.outputs.artist_version }}.spdx.json',
    ],
    [
      'headless_released',
      'uploads/escapesuite-headless-artist-${{ steps.check-apps.outputs.headless_version }}.tgz',
      'sboms/escapesuite-headless-artist-${{ steps.check-apps.outputs.headless_version }}.spdx.json',
    ],
  ]) {
    const attest = attests.find((text) => text.includes(`subject-path: ${build}`));
    assert.ok(attest, `expected an SBOM attestation with subject ${build}`);
    assert.ok(attest.includes(`sbom-path: ${sbom}`), `expected ${build} attested with ${sbom}`);
    assert.ok(attest.includes(`steps.check-apps.outputs.${flag} == 'true'`), `expected ${build} gated on ${flag}`);
  }
  assert.ok(
    upload.search(ATTEST_SBOM_ACTION) < upload.search(/- name: Attach builds to GitHub Release/),
    'SBOM attestations must exist before the builds are attached'
  );

  const attach = step(upload, /Attach builds to GitHub Release/);
  assert.match(attach, /\.spdx\.json/);
  assert.match(attach, /sboms\/\$\{sbomName\}/);
  assert.match(attach, /'application\/json'/);
  assert.match(attach, /SBOM/, 'the "Verify your download" notes must mention the SBOM');
});

test('the shared verify script checks every build for an SBOM attestation', () => {
  const script = read('scripts/verify-release-assets.sh');
  assert.match(script, /--predicate-type "\$SBOM_PREDICATE"/);
  assert.match(script, /SBOM_PREDICATE=https:\/\/spdx\.dev\/Document\/v2\.3/);
});

test('docs/VERIFY.md explains the SBOM and how to verify its attestation', () => {
  const doc = read('docs/VERIFY.md');
  assert.match(doc, /\.spdx\.json/);
  assert.match(
    doc,
    /gh attestation verify ESCAPEARTIST-[^\s]*\.html -R Bonham-Technologies\/ESCAPESUITE[^\n]*\n?[^\n]*--predicate-type https:\/\/spdx\.dev\/Document\/v2\.3/
  );
});
