#!/usr/bin/env node
/**
 * DCO check (ESCSUITE-419): every non-merge commit in a pull request must carry a
 * `Signed-off-by:` trailer whose email matches the commit's author email
 * (Developer Certificate of Origin 1.1, see CONTRIBUTING.md). Bot commits
 * (`<name>[bot]` authors, such as Dependabot and the changesets release bot) are
 * exempt.
 *
 *   node scripts/dco-check.mjs <base-sha> <head-sha>
 *
 * Exits 1 and lists each commit that is missing its sign-off. Runs in
 * `.github/workflows/dco.yml`; unit tests in `scripts/dco-check.test.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RECORD = '\x1e';
const FIELD = '\x1f';

/** True for GitHub App and bot accounts, which cannot certify the DCO. */
export function isBotAuthor(name, email) {
  return /\[bot\]$/i.test(name.trim()) || /\[bot\]@users\.noreply\.github\.com$/i.test(email.trim());
}

/** The emails of every `Signed-off-by:` trailer in a commit message, lower-cased. */
export function signOffEmails(message) {
  const emails = [];
  for (const line of message.split(/\r?\n/)) {
    const match = /^\s*signed-off-by:\s*.+?<([^<>\s]+)>\s*$/i.exec(line);
    if (match) emails.push(match[1].toLowerCase());
  }
  return emails;
}

/**
 * @param {{ sha: string, authorName: string, authorEmail: string, message: string }[]} commits
 * @returns {{ sha: string, subject: string, reason: string }[]} the commits that fail
 */
export function findUnsignedCommits(commits) {
  const failures = [];
  for (const commit of commits) {
    if (isBotAuthor(commit.authorName, commit.authorEmail)) continue;
    const subject = commit.message.split(/\r?\n/, 1)[0];
    const emails = signOffEmails(commit.message);
    if (emails.length === 0) {
      failures.push({ sha: commit.sha, subject, reason: 'no Signed-off-by trailer' });
    } else if (!emails.includes(commit.authorEmail.trim().toLowerCase())) {
      failures.push({
        sha: commit.sha,
        subject,
        reason: `Signed-off-by email (${emails.join(', ')}) does not match the author email (${commit.authorEmail})`,
      });
    }
  }
  return failures;
}

/** Parses `git log --format=%H%x1f%an%x1f%ae%x1f%B%x1e` output. */
export function parseGitLog(output) {
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha, authorName, authorEmail, ...rest] = record.split(FIELD);
      return { sha, authorName, authorEmail, message: rest.join(FIELD) };
    });
}

function main(argv) {
  const [base, head] = argv;
  if (!base || !head) {
    console.error('usage: node scripts/dco-check.mjs <base-sha> <head-sha>');
    return 2;
  }
  const output = execFileSync(
    'git',
    ['log', '--no-merges', `--format=%H${FIELD}%an${FIELD}%ae${FIELD}%B${RECORD}`, `${base}..${head}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const commits = parseGitLog(output);
  const failures = findUnsignedCommits(commits);
  if (failures.length === 0) {
    console.log(`DCO: all ${commits.length} commit(s) are signed off (or made by a bot).`);
    return 0;
  }
  console.error(`DCO: ${failures.length} of ${commits.length} commit(s) are missing a valid sign-off:\n`);
  for (const failure of failures) {
    console.error(`  ${failure.sha.slice(0, 12)} ${failure.subject}\n    ${failure.reason}`);
  }
  console.error(
    '\nSign off with `git commit -s`, or fix existing commits with `git rebase --signoff origin/main`' +
      ' and force-push your branch. See CONTRIBUTING.md, "Developer Certificate of Origin".',
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
