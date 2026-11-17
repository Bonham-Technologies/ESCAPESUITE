/**
 * Regression guard for ESCSUITE-477: no workflow may report a *skipped* check
 * run named `ci-status`.
 *
 * `ci-status` is the one check `main`'s ruleset requires, by name, and GitHub
 * counts a skipped check run as passing. ci.yml also runs on
 * `pull_request_target` (for the changesets release PR), and on that event
 * every job is skipped for any PR not opened by `github-actions[bot]`. When
 * the skipped `ci-status` job carried the name `ci-status`, the ruleset was
 * satisfied seconds after a push, while the real `pull_request` run was still
 * going, and auto-merge merged Dependabot #1102 and #1104 on it.
 *
 * The fix gives the job a `name:` expression that is `ci-status` exactly when
 * the job runs. GitHub does not evaluate a skipped job's name expression: the
 * check run carries the expression's raw text (probed on 2026-11-17: a skipped
 * job named `${{ a && 'x' || 'y' }}` reported the check run `a && 'x' || 'y'`).
 * And were that ever to change, the expression gives the skipped job a
 * different name anyway.
 *
 * Like the other workflow tests here, this reads the YAML text (no YAML
 * dependency) and evaluates the two expressions with a small translation to
 * JavaScript; GitHub's `==`, `!=`, `&&`, `||` and parentheses behave the same
 * for these string operands.
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(here, '..', '.github/workflows');
const REPO = 'Bonham-Technologies/ESCAPESUITE';
const REQUIRED = 'ci-status';

const workflows = readdirSync(workflowsDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((file) => ({ file, text: readFileSync(join(workflowsDir, file), 'utf8') }));

/** The value of a two-space-deeper key in a job block, folding a `|` block scalar. */
function jobKey(block, key) {
  const lines = block.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`    ${key}:`));
  if (at < 0) return undefined;
  const inline = lines[at].slice(`    ${key}:`.length).trim();
  if (inline !== '|' && inline !== '>') return inline;
  const body = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== '' && !line.startsWith('      ')) break;
    body.push(line.trim());
  }
  return body.join(' ').trim();
}

/** Every top-level job of a workflow: its key, `name:` and `if:`. */
function jobs(text) {
  const body = text.slice(text.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const starts = [...body.matchAll(/^ {2}([A-Za-z_][\w-]*):\s*$/gm)];
  return starts.map((m, i) => {
    const block = body.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined);
    return { key: m[1], name: jobKey(block, 'name'), if: jobKey(block, 'if') };
  });
}

function unquote(s) {
  return s.replace(/^(['"])(.*)\1$/, '$2');
}

/** `${{ expr }}` -> `expr`; undefined when the value is not one expression. */
function expressionOf(value) {
  const m = value?.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/);
  return m ? m[1] : undefined;
}

/**
 * The check run name a job reports when it is skipped: its key without a
 * `name:`, the literal name, or the raw text of a name expression (which
 * GitHub leaves unevaluated for a skipped job).
 */
function skippedCheckName(job) {
  if (job.name === undefined) return job.key;
  return expressionOf(job.name) ?? unquote(job.name);
}

/** Evaluate a GitHub expression over `github` (subset: ==, !=, &&, ||, (), always()). */
function evaluate(expr, github) {
  const js = expr.replace(/\$\{\{|\}\}/g, '').replace(/!=/g, '!==').replace(/([^!=])==/g, '$1===');
  return new Function('github', 'always', `return (${js});`)(github, () => true);
}

function context(event_name, actor, headRepo = REPO) {
  return {
    event_name,
    actor,
    repository: REPO,
    event: { pull_request: event_name.startsWith('pull_request') ? { head: { repo: { full_name: headRepo } } } : undefined },
  };
}

const RUNS_FOR_REAL = [
  ['push to main', context('push', 'mrbonha')],
  ['pull_request from the owner', context('pull_request', 'mrbonha')],
  ['pull_request from Dependabot', context('pull_request', 'dependabot[bot]')],
  ['pull_request_target for the changesets release PR', context('pull_request_target', 'github-actions[bot]')],
];
const SKIPPED = [
  ['pull_request_target from the owner', context('pull_request_target', 'mrbonha')],
  ['pull_request_target from Dependabot', context('pull_request_target', 'dependabot[bot]')],
  ['pull_request_target from a fork', context('pull_request_target', 'someone', 'someone/ESCAPESUITE')],
  [
    'pull_request_target as github-actions[bot] from a fork',
    context('pull_request_target', 'github-actions[bot]', 'someone/ESCAPESUITE'),
  ],
];

const ciStatus = jobs(workflows.find((w) => w.file === 'ci.yml').text).find((j) => j.key === REQUIRED);

test('no workflow job reports a skipped check run named ci-status', () => {
  for (const { file, text } of workflows) {
    for (const job of jobs(text)) {
      assert.notEqual(
        skippedCheckName(job),
        REQUIRED,
        `${file}: job \`${job.key}\` would report a skipped \`${REQUIRED}\` check run, which the ruleset counts as passing`
      );
    }
  }
});

test('ci.yml still has the ci-status job, gated on pull_request_target', () => {
  assert.ok(ciStatus, 'ci.yml has no ci-status job');
  assert.ok(ciStatus.if, 'ci-status has no if:');
  assert.ok(expressionOf(ciStatus.name), `ci-status's name is not an expression: ${ciStatus.name}`);
});

for (const [label, github] of RUNS_FOR_REAL) {
  test(`ci-status runs and reports \`ci-status\` on a ${label}`, () => {
    assert.equal(evaluate(ciStatus.if, github), true, 'the job would be skipped');
    assert.equal(evaluate(expressionOf(ciStatus.name), github), REQUIRED);
  });
}

for (const [label, github] of SKIPPED) {
  test(`ci-status is skipped, under another name, on a ${label}`, () => {
    assert.equal(evaluate(ciStatus.if, github), false, 'the job would run');
    assert.notEqual(evaluate(expressionOf(ciStatus.name), github), REQUIRED);
  });
}
