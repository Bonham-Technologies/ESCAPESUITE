/**
 * Weak regression guard for ESCSUITE-195: GitHub's `/releases/latest` must
 * always resolve to the umbrella `vX.Y.Z` release — the only one carrying
 * the offline single-file builds ESCAPEPLAN links to — never to a
 * per-package release (`@escapesuite/shared@1.4.1`, `@escapesuite/plan@…`,
 * the headless-artist kit, …) that a changesets publish also creates.
 *
 * This does not execute either workflow (that needs a real GitHub Actions
 * run); it greps the YAML text for the handful of tokens the fix depends on.
 * That makes it a weak guard — it cannot catch a change that keeps every
 * token present but rearranges the logic around them — but it does turn red
 * on the obvious regression: someone deleting the `make_latest: false` step,
 * dropping `--latest` from the umbrella release, or routing around the
 * `*-latest.html` uploads.
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

const releaseYml = readFileSync(
  join(repoRoot, '.github/workflows/release.yml'),
  'utf8'
);
const standaloneReleaseYml = readFileSync(
  join(repoRoot, '.github/workflows/standalone-release.yml'),
  'utf8'
);

/**
 * Slices `text` between the start of a line matching `startPattern` and the
 * start of the next top-level (two-space-indented) `- name:` step, or the
 * next line matching `endPattern` when given. Lets each assertion check a
 * specific step's own text instead of the whole file, so a token that
 * happens to appear in some other step cannot make a check pass by accident.
 */
function sliceFrom(text, startPattern, endPattern) {
  const startMatch = text.match(startPattern);
  assert.ok(startMatch, `expected to find ${startPattern} in the workflow`);
  const rest = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = endPattern ? rest.match(endPattern) : null;
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

test('release.yml marks every per-package release make_latest: false', () => {
  const job = sliceFrom(
    releaseYml,
    /mark-per-package-releases-not-latest:/,
    /^\s{2}\S.*:\s*$/m // next top-level job key
  );

  // Gated on the same "did changesets publish anything" output the attach
  // job uses, so it never runs — and never fails — on a push with no
  // changesets.
  assert.match(job, /needs:\s*release/);
  assert.match(job, /needs\.release\.outputs\.published\s*==\s*'true'/);

  // The actual REST call: changesets/action's create-github-releases has no
  // input for this, so it has to be a follow-up `updateRelease` rather than
  // an option passed to the release-creation step itself.
  assert.match(job, /updateRelease/);
  assert.match(job, /make_latest:\s*['"]false['"]/);
});

test('release.yml re-marks the current umbrella release latest right after the per-package marking (ESCSUITE-218)', () => {
  // GitHub's make_latest:'false' above only takes effect on a release that
  // is becoming not-latest; it leaves the pointer alone when the release
  // being updated is ALREADY "latest" (observed 2026-10-04: a shared-only
  // release stayed /releases/latest for ~25 minutes, until
  // standalone-release.yml's own --latest ran afterwards and moved it).
  // This job must re-point /releases/latest at the umbrella `vX.Y.Z`
  // release itself, rather than relying solely on standalone-release.yml
  // running later.
  const job = sliceFrom(
    releaseYml,
    /mark-per-package-releases-not-latest:/,
    /^\s{2}\S.*:\s*$/m // next top-level job key
  );

  const makeLatestFalseIndex = job.search(/make_latest:\s*['"]false['"]/);
  assert.notStrictEqual(
    makeLatestFalseIndex,
    -1,
    'expected the make_latest: false marking in this job'
  );

  const ghReleaseEditIndex = job.search(/gh release edit\b[^\n]*--latest\b/);
  assert.notStrictEqual(
    ghReleaseEditIndex,
    -1,
    'expected a `gh release edit ... --latest` step marking the umbrella release latest'
  );

  assert.ok(
    makeLatestFalseIndex < ghReleaseEditIndex,
    'the per-package make_latest:false marking must run before the umbrella release is marked latest'
  );

  // Tag discovery must target a `v`-prefixed umbrella tag, never a
  // per-package `@scope/name@version` tag.
  assert.match(job, /\^v\[0-9\]/);

  // A fresh repo with no umbrella release yet must not fail the job.
  assert.match(job, /exit 0/);
});

test('standalone-release.yml creates the umbrella release as latest', () => {
  const createStep = sliceFrom(
    standaloneReleaseYml,
    /gh release create "v\$\{VERSION\}"/,
    /\n\s*- name:/
  );
  assert.match(createStep, /--latest\b/);
});

test('standalone-release.yml re-marks the umbrella release latest on the skip path', () => {
  // The skip path fires when the umbrella tag already exists (neither
  // craft nor artist bumped) — e.g. a kit-, shared- or plan-only release,
  // whose own per-package release is make_latest:false by the other test
  // above. Without this, such a release would leave /releases/latest
  // pointing at nothing newer, but also not pointing at THIS umbrella
  // release if some other non-latest release sorted after it.
  const skipBlock = sliceFrom(
    standaloneReleaseYml,
    /gh release view "v\$\{VERSION\}"/,
    /\n\s*gh release create/
  );
  assert.match(skipBlock, /gh release edit "v\$\{VERSION\}"/);
  assert.match(skipBlock, /--latest\b/);
});

test('standalone-release.yml uploads both stable *-latest.html assets to the umbrella release', () => {
  const createStep = sliceFrom(
    standaloneReleaseYml,
    /gh release create "v\$\{VERSION\}"/,
    /\n\s*- name:/
  );
  assert.match(createStep, /ESCAPECRAFT-latest\.html/);
  assert.match(createStep, /ESCAPEARTIST-latest\.html/);
});
