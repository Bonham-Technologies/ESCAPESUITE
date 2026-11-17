/**
 * Guards the open-source checklist items this public repository's workflows
 * and contributor files must keep passing (ESCSUITE-476):
 *
 * - GA-2: ci.yml and standalone-release.yml declare workflow-level
 *   permissions, read-only; a job that needs more widens its own block.
 * - GA-4: every action from outside this repository is pinned to a full
 *   commit SHA, with its version in a trailing comment, and each action is
 *   pinned to the same SHA in every workflow.
 * - GA-5: in ci.yml, a job that reads a secret on a pull request does so
 *   behind an Environment and never for a fork.
 * - GA-8: no run: script or github-script in ci.yml or standalone-release.yml
 *   expands event text or a step/job output inline; those reach the script
 *   through env instead, so their text is data, never code.
 * - CF-5: CODEOWNERS covers /.claude/.
 * - CF-6: the PR template asks for a plain `Ticket: ESCSUITE-N`.
 *
 * Run with: node --test scripts/oss-workflow-hardening.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

const WORKFLOW_DIR = '.github/workflows';
const workflows = readdirSync(join(repoRoot, WORKFLOW_DIR))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: read(`${WORKFLOW_DIR}/${name}`) }));
const ciYml = read(`${WORKFLOW_DIR}/ci.yml`);
const standaloneReleaseYml = read(`${WORKFLOW_DIR}/standalone-release.yml`);

/** The workflow-level `permissions:` block's lines, or null when there is none. */
function workflowPermissions(text) {
  const inline = text.match(/^permissions:[ \t]*(\{\}|read-all|write-all)[ \t]*$/m);
  if (inline) return [inline[1]];
  const block = text.match(/^permissions:[ \t]*\n((?:[ \t]+.*\n|[ \t]*\n)+)/m);
  if (!block) return null;
  return block[1]
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

/** Every top-level job of a workflow, as { name, text }. */
function jobs(text) {
  const body = text.slice(text.search(/^jobs:\s*$/m));
  const starts = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  return starts.map((match, i) => ({
    name: match[1],
    text: body.slice(match.index, i + 1 < starts.length ? starts[i + 1].index : undefined),
  }));
}

/**
 * The text of every `key:` block scalar (or one-line value) in `text`, such as
 * each `run:` script. A block runs until the first non-blank line indented no
 * deeper than the key itself.
 */
function blocks(text, key) {
  const lines = text.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(new RegExp(`^(\\s*(?:- )?)${key}:\\s*(.*)$`));
    if (!match) continue;
    const keyIndent = match[1].length;
    const value = match[2];
    if (!/^[|>][-+]?\s*$/.test(value)) {
      found.push(value);
      continue;
    }
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() !== '' && line.search(/\S/) <= keyIndent) break;
      body.push(line);
    }
    found.push(body.join('\n'));
  }
  return found;
}

test('ci.yml and standalone-release.yml declare read-only workflow-level permissions (GA-2)', () => {
  for (const [name, text] of [
    ['ci.yml', ciYml],
    ['standalone-release.yml', standaloneReleaseYml],
  ]) {
    const perms = workflowPermissions(text);
    assert.ok(perms, `${name} has no workflow-level permissions block`);
    assert.ok(
      perms.includes('contents: read') || perms.includes('{}'),
      `${name}: expected contents: read (or {}) at workflow level, got ${perms.join(', ')}`
    );
    for (const line of perms) {
      assert.doesNotMatch(line, /write/, `${name}: workflow-level permissions must not grant ${line}`);
    }
  }
});

test('every external action is pinned to a full commit SHA with its version in a comment (GA-4)', () => {
  const shaByAction = new Map();
  for (const { name, text } of workflows) {
    for (const match of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)(.*)$/gm)) {
      const [, ref, rest] = match;
      if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
      const [action, version] = ref.split('@');
      assert.match(version ?? '', /^[0-9a-f]{40}$/, `${name}: ${ref} is not pinned to a commit SHA`);
      assert.match(rest, /^\s+#\s*v\d+\.\d+\.\d+\s*$/, `${name}: ${ref} needs a "# vX.Y.Z" comment`);
      const pin = `${version}${rest.trim()}`;
      const seen = shaByAction.get(action);
      assert.ok(
        !seen || seen.pin === pin,
        `${action} is pinned as ${pin} in ${name} but as ${seen?.pin} in ${seen?.file}`
      );
      shaByAction.set(action, { pin, file: name });
    }
  }
  // The six actions the checklist names are all in use, so all are covered above.
  for (const action of [
    'actions/cache',
    'actions/checkout',
    'actions/download-artifact',
    'actions/github-script',
    'actions/setup-node',
    'actions/upload-artifact',
  ]) {
    assert.ok(shaByAction.has(action), `${action} is no longer used; update this list`);
  }
});

test('a ci.yml job that reads a secret on a pull request is behind an Environment and skips forks (GA-5)', () => {
  // ci.yml runs on pull_request and pull_request_target, so every job is reachable from a PR
  // unless its own `if:` limits it to pushes.
  const withSecrets = jobs(ciYml).filter(({ text }) => /secrets\.(?!GITHUB_TOKEN\b)/.test(text));
  assert.ok(withSecrets.length > 0, 'expected the deploy job to read VERCEL_TOKEN');
  for (const { name, text } of withSecrets) {
    assert.match(text, /^ {4}environment:/m, `${name} reads a secret but has no environment`);
    // The job's own `if:` (indented four spaces), with its continuation lines.
    const condition = text.match(/^ {4}if:.*\n(?:(?: {6,}.*)?\n)*/m)?.[0] ?? '';
    assert.match(
      condition,
      /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
      `${name} reads a secret but does not skip pull requests from forks`
    );
  }
});

test('no run: script or github-script expands event text or an output inline (GA-3, GA-8)', () => {
  // Event payload text (titles, branch names, package versions read from a PR's
  // checkout) and outputs derived from it reach scripts through env, never `${{ }}`.
  const UNSAFE = /\$\{\{[^}]*(github\.event\.|github\.head_ref|\.outputs\.|inputs\.)[^}]*\}\}/;
  for (const [name, text] of [
    ['ci.yml', ciYml],
    ['standalone-release.yml', standaloneReleaseYml],
  ]) {
    for (const key of ['run', 'script']) {
      for (const body of blocks(text, key)) {
        const hit = body.match(UNSAFE);
        assert.ok(!hit, `${name}: ${key}: expands ${hit?.[0]} inline; pass it through env`);
      }
    }
  }
});

test('standalone-release.yml rejects app versions that are not plain semver before using them', () => {
  // The versions come from the triggering run's package.json files, which a
  // pull request controls; they name files and are written to GITHUB_OUTPUT.
  const prepare = jobs(standaloneReleaseYml).find((job) => job.name === 'prepare');
  assert.ok(prepare, 'expected a prepare job');
  const versionStep = prepare.text.slice(prepare.text.indexOf('- name: Determine version'));
  const check = versionStep.indexOf('is not a plain version');
  assert.ok(check >= 0, 'expected the version step to validate each version');
  assert.ok(
    check < versionStep.indexOf('>> "$GITHUB_OUTPUT"'),
    'the versions must be validated before they are written to GITHUB_OUTPUT'
  );
});

test('CODEOWNERS covers /.claude/ (CF-5)', () => {
  const owners = read('.github/CODEOWNERS');
  assert.match(owners, /^\/\.claude\/\s+@\S+/m);
});

test('the PR template asks for a plain Ticket: ESCSUITE-N line, not a Jira link (CF-6)', () => {
  const template = read('.github/PULL_REQUEST_TEMPLATE.md');
  assert.match(template, /^Ticket: ESCSUITE-/m);
  assert.doesNotMatch(template, /atlassian\.net/);
  assert.doesNotMatch(template, /\]\(https?:\/\/[^)]*ESCSUITE-/);
});
