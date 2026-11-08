/**
 * Unit tests for the DCO check (ESCSUITE-419). Node's built-in runner:
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { findUnsignedCommits, isBotAuthor, parseGitLog, signOffEmails } from './dco-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const commit = (overrides) => ({
  sha: 'a'.repeat(40),
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  message: 'fix: a thing\n\nSigned-off-by: Ada Lovelace <ada@example.com>\n',
  ...overrides,
});

test('a commit signed off by its author passes', () => {
  assert.deepEqual(findUnsignedCommits([commit({})]), []);
});

test('the email match ignores case and surrounding space', () => {
  const c = commit({ authorEmail: ' Ada@Example.com ', message: 'x\n\nsigned-off-by: Ada <ADA@example.COM>' });
  assert.deepEqual(findUnsignedCommits([c]), []);
});

test('a commit with no Signed-off-by trailer fails', () => {
  const [failure] = findUnsignedCommits([commit({ message: 'fix: a thing\n' })]);
  assert.equal(failure.reason, 'no Signed-off-by trailer');
  assert.equal(failure.subject, 'fix: a thing');
});

test('a sign-off by someone other than the author fails', () => {
  const [failure] = findUnsignedCommits([
    commit({ message: 'fix\n\nSigned-off-by: Someone Else <else@example.com>' }),
  ]);
  assert.match(failure.reason, /does not match the author email/);
});

test('a co-author trailer is not a sign-off', () => {
  const failures = findUnsignedCommits([
    commit({ message: 'fix\n\nCo-Authored-By: Ada Lovelace <ada@example.com>' }),
  ]);
  assert.equal(failures.length, 1);
});

test('bot authors are exempt', () => {
  assert.equal(isBotAuthor('dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com'), true);
  assert.equal(isBotAuthor('github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com'), true);
  assert.equal(isBotAuthor('Ada Lovelace', 'ada@example.com'), false);
  assert.deepEqual(
    findUnsignedCommits([commit({ authorName: 'dependabot[bot]', message: 'chore(deps): bump x' })]),
    [],
  );
});

test('a human cannot claim the exemption with a bot-looking email alone', () => {
  assert.equal(isBotAuthor('Ada', 'ada[bot]@example.com'), false);
});

test('signOffEmails finds every trailer', () => {
  assert.deepEqual(
    signOffEmails('x\n\nSigned-off-by: A <a@x.io>\nSigned-off-by: B <b@x.io>\n'),
    ['a@x.io', 'b@x.io'],
  );
});

test('parseGitLog splits records and keeps multi-line bodies', () => {
  const out =
    `${'1'.repeat(40)}\x1fAda\x1fada@example.com\x1ffix: one\n\nbody\n\nSigned-off-by: Ada <ada@example.com>\n\x1e\n` +
    `${'2'.repeat(40)}\x1fBob\x1fbob@example.com\x1ffix: two\n\x1e\n`;
  const commits = parseGitLog(out);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].authorEmail, 'ada@example.com');
  assert.match(commits[0].message, /Signed-off-by: Ada/);
  assert.equal(commits[1].sha, '2'.repeat(40));
  assert.deepEqual(
    findUnsignedCommits(commits).map((f) => f.sha),
    ['2'.repeat(40)],
  );
});

test('the DCO workflow runs this script on pull requests with read-only permissions', () => {
  const yml = readFileSync(join(here, '..', '.github/workflows/dco.yml'), 'utf8');
  assert.match(yml, /^on:\n\s+pull_request:/m);
  assert.match(yml, /contents: read/);
  assert.doesNotMatch(yml, /pull_request_target/);
  assert.match(yml, /node scripts\/dco-check\.mjs "\$BASE_SHA" "\$HEAD_SHA"/);
});
