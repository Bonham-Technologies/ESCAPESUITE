/**
 * Tests for scripts/verify-release-assets.sh (ESCSUITE-401): the check the
 * release workflows run against a release they have just published, and the
 * same steps docs/VERIFY.md gives users.
 *
 * The script talks to GitHub only through `gh`, so each test puts a fake
 * `gh` first on PATH. The fake serves a fixture directory as the release's
 * assets (`gh release download`) and fails `gh attestation verify` for the
 * file names listed in FAKE_UNATTESTED, or, for an SBOM check
 * (`--predicate-type`, ESCSUITE-430), in FAKE_NO_SBOM. Checksums run for real.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'verify-release-assets.sh');

const REPO = 'Bonham-Technologies/ESCAPESUITE';
const TAG = 'v9.9.9';

const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "release download")
    if [ -n "\${FAKE_DOWNLOAD_FAILURES:-}" ]; then
      count=$(cat "$FAKE_STATE/download-failures" 2>/dev/null || echo 0)
      if [ "$count" -lt "$FAKE_DOWNLOAD_FAILURES" ]; then
        echo $((count + 1)) > "$FAKE_STATE/download-failures"
        echo "HTTP 404: Not Found" >&2
        exit 1
      fi
    fi
    dir=""
    while [ $# -gt 0 ]; do
      if [ "$1" = "--dir" ]; then dir=$2; shift; fi
      shift
    done
    cp "$FAKE_RELEASE_DIR"/* "$dir"/
    ;;
  "attestation verify")
    name=$(basename "$3")
    bad_list="\${FAKE_UNATTESTED:-}"
    case " $* " in
      *" --predicate-type "*) bad_list="\${FAKE_NO_SBOM:-}" ;;
    esac
    for bad in $bad_list; do
      if [ "$bad" = "$name" ]; then
        echo "no matching attestations found for $name" >&2
        exit 1
      fi
    done
    echo "Verification succeeded for $name"
    ;;
  *)
    echo "fake gh: unexpected call: $*" >&2
    exit 64
    ;;
esac
`;

let work;
let releaseDir;

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Writes `files` as the release's assets, plus a SHA256SUMS.txt over them.
 * `sums: null` publishes no SHA256SUMS.txt at all.
 */
function publish(files, sums) {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(releaseDir, name), content);
  }
  const body =
    sums !== undefined
      ? sums
      : Object.entries(files)
          .map(([name, content]) => `${sha256(content)}  ${name}\n`)
          .join('');
  if (body !== null) writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), body);
}

function run(args = [TAG, REPO], env = {}) {
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(work, 'bin')}:${process.env.PATH}`,
      FAKE_GH_LOG: join(work, 'gh.log'),
      FAKE_STATE: work,
      FAKE_RELEASE_DIR: releaseDir,
      VERIFY_RETRY_SECONDS: '0',
      ...env,
    },
  });
  const log = existsSync(join(work, 'gh.log')) ? readFileSync(join(work, 'gh.log'), 'utf8') : '';
  return { ...result, output: result.stdout + result.stderr, log };
}

const ASSETS = {
  'ESCAPECRAFT-9.9.9.html': '<html>craft</html>',
  'ESCAPECRAFT-latest.html': '<html>craft</html>',
  'ESCAPEARTIST-9.9.9.html': '<html>artist</html>',
  'ESCAPEARTIST-latest.html': '<html>artist</html>',
  'escapesuite-headless-artist-9.9.9.tgz': 'kit bytes',
  'ESCAPECRAFT-9.9.9.spdx.json': '{"spdxVersion":"SPDX-2.3"}',
  'ESCAPEARTIST-9.9.9.spdx.json': '{"spdxVersion":"SPDX-2.3"}',
  'escapesuite-headless-artist-9.9.9.spdx.json': '{"spdxVersion":"SPDX-2.3"}',
};

// The builds among ASSETS: each needs an SBOM attestation (ESCSUITE-430).
const BUILDS = Object.keys(ASSETS).filter((name) => /\.(html|tgz)$/.test(name));
const SBOM_PREDICATE = 'https://spdx.dev/Document/v2.3';

/** Escape every RegExp metacharacter, so a name or URL matches literally. */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The provenance checks in a fake-gh log: attestation checks without --predicate-type. */
function provenanceChecks(log) {
  return log
    .split('\n')
    .filter((line) => line.startsWith('attestation verify') && !line.includes('--predicate-type'));
}

/** The SBOM attestation checks in a fake-gh log. */
function sbomChecks(log) {
  return log
    .split('\n')
    .filter((line) => line.startsWith('attestation verify') && line.includes('--predicate-type'));
}

/** ASSETS without the named files. */
function assetsWithout(...names) {
  return Object.fromEntries(Object.entries(ASSETS).filter(([name]) => !names.includes(name)));
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'verify-release-assets-'));
  releaseDir = join(work, 'release');
  mkdirSync(releaseDir);
  mkdirSync(join(work, 'bin'));
  writeFileSync(join(work, 'bin', 'gh'), FAKE_GH);
  chmodSync(join(work, 'bin', 'gh'), 0o755);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

test('passes when every asset matches SHA256SUMS.txt and has an attestation', () => {
  publish(ASSETS);
  const result = run();
  assert.equal(result.status, 0, result.output);

  // Every asset, SHA256SUMS.txt included, is checked against an attestation
  // from this repository.
  for (const name of [...Object.keys(ASSETS), 'SHA256SUMS.txt']) {
    assert.match(
      result.log,
      new RegExp(`^attestation verify \\S*/${escapeRegExp(name)} --repo ${REPO}$`, 'm'),
      `expected an attestation check for ${name}`
    );
  }
  assert.match(result.log, new RegExp(`^release download ${TAG} --repo ${REPO} --dir `, 'm'));
});

test('passes the signer workflow through to every attestation check when one is given', () => {
  publish(ASSETS);
  const signer = `${REPO}/.github/workflows/standalone-release.yml`;
  const result = run([TAG, REPO, signer]);
  assert.equal(result.status, 0, result.output);

  const checks = provenanceChecks(result.log);
  assert.equal(checks.length, Object.keys(ASSETS).length + 1);
  for (const line of [...checks, ...sbomChecks(result.log)]) {
    assert.ok(line.endsWith(`--signer-workflow ${signer}`), line);
  }
});

test('fails when an asset does not match its checksum', () => {
  publish(ASSETS);
  writeFileSync(join(releaseDir, 'ESCAPEARTIST-latest.html'), '<html>tampered</html>');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ESCAPEARTIST-latest\.html: FAILED/);
});

test('fails when the release has an asset SHA256SUMS.txt does not list', () => {
  publish(ASSETS);
  writeFileSync(join(releaseDir, 'extra.html'), 'not in the sums');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /extra\.html/);
});

test('fails when SHA256SUMS.txt lists an asset the release does not have', () => {
  publish(ASSETS);
  rmSync(join(releaseDir, 'ESCAPECRAFT-latest.html'));
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ESCAPECRAFT-latest\.html/);
});

test('fails when the release has no SHA256SUMS.txt', () => {
  publish(ASSETS, null);
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /no SHA256SUMS\.txt/);
});

test('fails on a malformed SHA256SUMS.txt line', () => {
  publish(ASSETS);
  writeFileSync(
    join(releaseDir, 'SHA256SUMS.txt'),
    readFileSync(join(releaseDir, 'SHA256SUMS.txt'), 'utf8') + 'garbage line\n'
  );
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /malformed/);
});

test('fails when any asset has no attestation, after checking all of them', () => {
  publish(ASSETS);
  const result = run([TAG, REPO], { FAKE_UNATTESTED: 'ESCAPECRAFT-9.9.9.html' });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ESCAPECRAFT-9\.9\.9\.html/);
  // One missing attestation does not stop the others from being checked.
  assert.equal(provenanceChecks(result.log).length, Object.keys(ASSETS).length + 1);
});

test('checks every build, -latest aliases included, for an SPDX SBOM attestation', () => {
  publish(ASSETS);
  const result = run();
  assert.equal(result.status, 0, result.output);

  const checks = sbomChecks(result.log);
  assert.equal(checks.length, BUILDS.length, checks.join('\n'));
  for (const name of BUILDS) {
    assert.match(
      result.log,
      new RegExp(
        `^attestation verify \\S*/${escapeRegExp(name)} --repo ${REPO} --predicate-type ${escapeRegExp(SBOM_PREDICATE)}$`,
        'm'
      ),
      `expected an SBOM attestation check for ${name}`
    );
  }
});

test('fails when a build has no SBOM attestation, after checking all of them', () => {
  publish(ASSETS);
  const result = run([TAG, REPO], { FAKE_NO_SBOM: 'ESCAPEARTIST-latest.html' });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /no valid SBOM attestation on v9\.9\.9 for: ESCAPEARTIST-latest\.html/);
  assert.equal(sbomChecks(result.log).length, BUILDS.length);
});

test('fails when a versioned build has no SBOM file on the release', () => {
  publish(assetsWithout('escapesuite-headless-artist-9.9.9.spdx.json'));
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /escapesuite-headless-artist-9\.9\.9\.tgz has no escapesuite-headless-artist-9\.9\.9\.spdx\.json/);
});

test('fails when an SBOM file names no build on the release', () => {
  publish({ ...ASSETS, 'ESCAPEOTHER-1.0.0.spdx.json': '{}' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ESCAPEOTHER-1\.0\.0\.spdx\.json describes no build/);
});

test('fails when the release carries no build at all', () => {
  publish({ 'notes.txt': 'nothing to run' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.output, /carries no build/);
});

test('retries the download while a just-created release is not yet visible', () => {
  publish(ASSETS);
  const result = run([TAG, REPO], { FAKE_DOWNLOAD_FAILURES: '2', VERIFY_DOWNLOAD_ATTEMPTS: '3' });
  assert.equal(result.status, 0, result.output);
  const downloads = result.log.split('\n').filter((line) => line.startsWith('release download'));
  assert.equal(downloads.length, 3);
});

test('fails when the release never becomes downloadable', () => {
  publish(ASSETS);
  const result = run([TAG, REPO], { FAKE_DOWNLOAD_FAILURES: '5', VERIFY_DOWNLOAD_ATTEMPTS: '2' });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /could not download/);
});

test('rejects a call without a tag and repository', () => {
  const result = run([TAG]);
  assert.equal(result.status, 2);
  assert.match(result.output, /usage/);
});
