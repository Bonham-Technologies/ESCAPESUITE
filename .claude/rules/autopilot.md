<!-- Vendored from bonham-ops (9d4b548). Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot policy

This repository is on autopilot. Claude finds improvements, files them, builds them and
merges them. The goal is to make the product **noticeably better every week** until it
is in a great state. The owner is involved only where it matters: product decisions,
risky merges, and reverts.

Jira project: **ESCSUITE**. Verify command: see `CLAUDE.md`.

## Roles

Each run plays one role, named in its prompt.

- **steward**: sweeps the product and files tickets. Writes no code.
- **builder**: implements ready tickets and merges them when the gates pass.
- **dependabot**: triages one Dependabot PR.

Every role starts with **Main must stay green**, below.

## Ticket classes

Every ticket carries exactly one class label.

| Label | Meaning | Who acts |
|---|---|---|
| `ap-auto` | Claude implements it and merges it when every gate passes | Claude |
| `ap-owner-merge` | Claude implements it; the PR waits for the owner's merge | Claude, then the owner |
| `ap-decision` | Needs a product decision first; nothing is built until the owner relabels it | The owner |

**`ap-owner-merge`** if the change touches any of these:
- authentication, sessions, identity or licence checks;
- payments, billing, plans or pricing logic;
- database migrations, schema, RLS, data deletion or backfills;
- security headers, CSP, secrets or permissions;
- CI/CD, release, deployment or infrastructure config;
- a public or integration API, an export or file format, or any contract other code
  depends on;
- a dependency's major version;
- removing anything a user can see or rely on.

It also applies if the diff exceeds about 800 changed lines, or the reviewer or QC
raises a concern it can't resolve.

**`ap-decision`** if the ticket asks for:
- a new capability outside the product's current scope;
- a pricing or plan change;
- a brand or visual-identity change;
- legal or privacy wording;
- anything irreversible for users;
- a trade-off between goals the owner hasn't ranked.

The ticket states the question, two or three options, and a recommendation.

**`ap-auto`** covers everything else:
- bugs and edge cases;
- missing tests;
- performance;
- accessibility;
- UI polish within the existing design language;
- UX and flow fixes;
- copy clarity;
- refactors that pay for themselves;
- docs and developer experience;
- patch and minor dependency bumps.

When unsure between two classes, pick the stricter one.

## Steward

Sweep these dimensions:
- correctness and bugs;
- tests on critical paths;
- performance;
- accessibility;
- UI;
- UX and flow;
- design consistency;
- security;
- reliability and error handling;
- developer experience and docs.

Read the code, the open issues, the last weeks of merged PRs, CI history, and any
coverage report. Where the environment allows, run the app and look at it.

- **File every worthwhile finding.** Don't hold back to keep the list short; a backlog
  is expected. Cap a run at 25 new tickets, highest value first, and search Jira first
  so you never duplicate an open ticket.
- Each ticket needs:
  - the problem with evidence (`file:line`, a screenshot, or a measurement);
  - why it matters;
  - numbered acceptance criteria;
  - the test that proves it;
  - a priority: P1 (broken or risky), P2 (clear user value), P3 (polish),
    P4 (nice to have);
  - one class label.
- Score each dimension 1–5 with one line of evidence.
- Post the **weekly digest** as a comment on the `ap-steward-log` issue (create it once).
  The digest covers:
  - what shipped;
  - what's in flight;
  - **waiting on the owner**: `ap-decision` tickets and `ap-owner-merge` PRs, with links;
  - reverts;
  - scores and their trend;
  - backlog size by priority.

**Done state:** when every dimension scores 4 or higher and two consecutive sweeps find
no P1 or P2, say so in the digest and recommend a lighter cadence (Dependabot plus a
monthly sweep). Don't change the schedule yourself.

## Builder

Take ready tickets (`ap-auto` or `ap-owner-merge`, not `ap-decision`, no open PR),
highest priority first, then oldest first. Stop after the run's ticket budget, or after
two failures in a row. For each ticket:

1. Branch `claude/<issue-key>-<slug>` from the latest `main`. One ticket per PR.
2. **Write a failing test first**, one that fails for the reason the ticket describes.
   Pure visual polish may assert on the DOM or styles instead. Then make the smallest
   change that meets every acceptance criterion.
3. Run the full verify command. Coverage floors never drop, and no test is skipped
   or deleted to get green.
4. **Independent review.** Hand the `reviewer` subagent (opus) the diff and the ticket.
   For `ap-owner-merge`, or a diff over 300 lines, then hand the `qc` subagent (fable)
   the same. Fix whatever they block on.
5. Open the PR. It references the ticket, lists each acceptance criterion with how it
   is verified, and states the class and any risk. Comment the PR link on the ticket.
6. **Merging:**
   - `ap-auto`: wait for `ci-status` to be green on the PR's head commit, rebase if
     `main` moved, then merge:
     `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/merge -f merge_method=squash`.
     (`gh pr` doesn't work in cloud sessions; use REST.) Merge one PR at a time.
     Transition the ticket to Done.
   - `ap-owner-merge`: label the PR `needs-owner`, move the ticket to In Review, and
     leave it.
7. If a ticket turns out ambiguous, bigger than described, or of a stricter class,
   relabel it, comment on what you found, and move on.

## Dependabot

For one Dependabot PR:
1. Read the changelog or release notes for each bump and flag breaking changes.
2. Run verify, and fix breakages with the smallest change that keeps the upgrade.
3. Comment the packages bumped, the breaking changes, your fixes, and the verify result.
4. Merge it yourself, under the builder's merge rules, only if all of these hold:
   - it's a **patch or minor** bump;
   - verify passes;
   - `ci-status` is green;
   - no breaking changes were found.

   Otherwise label it `needs-owner` with the reason.

## Main must stay green

At the start of every run:
1. Check `ci-status` on `main`'s head, and the production health check if `CLAUDE.md`
   names one.
2. If `main` is red and an autopilot merge caused it, **revert that PR**. A revert PR
   needs green CI but no review, and reverts are always allowed. Then reopen the ticket
   with the failure.
3. If it's red for any other reason, file a P1 `ap-auto` ticket and don't merge
   anything else this run.

## Always

- Never push to `main`; never force-push a branch you didn't create; never merge `ap-decision` work or anything labelled `needs-owner`.
- Missing access, credentials or a service you can't reach: say exactly what is missing on the ticket and stop. Never mock it.
- Follow `.claude/rules/subagent-routing.md` for every subagent.
- Keep CLAUDE.md files indexes; put detail in `docs/`.
