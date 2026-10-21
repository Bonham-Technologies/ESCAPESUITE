<!-- Vendored from bonham-ops (23d3028). Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot policy

This repository is on autopilot. Claude finds improvements, files them, builds them and
merges them. The goal is to make the product **noticeably better every week** until it
is in a great state. The owner is involved only where it matters: product decisions,
risky merges, and reverts.

Jira project: **ESCSUITE**. Verify command: see `CLAUDE.md`.

## Roles

Each run plays the roles named in its prompt, in the order given.

- **steward**: sweeps the product, files tickets, checks `ap-watch` tickets and posts
  the weekly digest. Writes no code.
- **builder**: implements ready tickets and merges them when the gates pass.
- **dependabot**: triages open Dependabot PRs. It runs as a sweep over every open
  Dependabot PR that has no triage comment yet; the builder task runs it before the
  builder role.

Every run starts with **Main must stay green** and then **Reconcile**, below.

## Tools and access

Runs are scheduled tasks in cloud sessions.

- **Jira** (`bonham.atlassian.net`): the Atlassian connector only.
- **GitHub**: `gh api` REST only. `gh pr …` and GraphQL (`gh api graphql`) are blocked
  in cloud sessions. In `gh api` paths, `{owner}` and `{repo}` fill in from the
  current repository.
- **No other connector.** A run may be given other connectors, such as Gmail, Google
  Drive, Supabase or Vercel. Never call their tools, for any reason. End every run's
  summary with the list of other connectors whose tools were present, or "none".
  (`git`, the verify command, and reading the public pages `ap-watch` tickets link to
  are not connectors and are fine.)
- Comments and PRs post under the **owner's own** GitHub and Jira identity, so the
  author never tells you whether autopilot wrote something. Use the fixed markers below
  to recognise autopilot's own comments.

**Jira statuses.** The projects have only **To Do**, **In Progress** and **Done**. Use
no other status. Labels are free-form: the class labels, `needs-owner`, `needs-operator`
and `ap-steward-log` need no setup.

**The GitHub label `needs-owner`** may not exist yet. Before you first apply it in a
run, create it; HTTP 422 means it already exists, so carry on:

```
gh api repos/{owner}/{repo}/labels -f name=needs-owner -f color=d93f0b -f description="Waiting on the owner"
```

Apply it with `gh api repos/{owner}/{repo}/issues/{n}/labels -f 'labels[]=needs-owner'`.
It is the only GitHub label this policy uses; every other label here is a Jira label.

## Ticket classes

Every ticket carries exactly one class label. The steward log ticket is the only
exception.

| Label | Meaning | Who acts |
|---|---|---|
| `ap-auto` | Claude implements it and merges it when every gate passes | Claude |
| `ap-owner-merge` | Claude implements it; the PR waits for the owner's merge | Claude, then the owner |
| `ap-decision` | Needs a product decision first; nothing is built until the owner relabels it | The owner |
| `ap-watch` | Tracks something outside the repo, such as an upstream bug or a vendor release; nothing is built | The steward checks it each run |

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

**`ap-watch`** if the work waits on something outside the repo: an upstream bug, a
vendor release, a third-party deprecation. The ticket links the page to watch (a public
Bugzilla bug, a GitHub issue or a release page) and states the **trigger**, for example
"a released version contains the fix", and what to do when it fires.

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

**Legacy `needs-operator`.** Tickets from before autopilot may carry `needs-operator`:
operator-only work. Treat them like `ap-decision`. Never build them, and never relabel
them, even if they also carry another class label. The steward lists them under
**Waiting on you**.

## Reconcile

At the start of every run, after **Main must stay green**:

- Find the tickets waiting on an owner merge:
  `project = ESCSUITE AND labels = needs-owner AND statusCategory != Done`.
- For each one, read the PR linked in its comments:
  `gh api repos/{owner}/{repo}/pulls/{n} --jq '{state, merged_at}'`.
  - **Merged:** remove the Jira label `needs-owner`, comment that the PR merged, and
    move the ticket to Done.
  - **Closed without merging:** comment that once on the ticket, and leave it for the
    owner. The steward lists it under **Waiting on you**.
  - **Still open:** leave it.

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

### Watch tickets

Check every open `ap-watch` ticket, every run:
`project = ESCSUITE AND labels = ap-watch AND statusCategory != Done`.

1. Fetch the page the ticket links. Public pages need no login: Bugzilla, GitHub issues
   (`gh api repos/<owner>/<repo>/issues/<n>`) and release pages
   (`gh api repos/<owner>/<repo>/releases/latest`) are all fine.
2. Compare the upstream status with the ticket's latest comment that starts with
   `[autopilot:watch]`.
3. **Comment only when the status changed**, or when there is no such comment yet.
   Start the comment with `[autopilot:watch]`, then the new status in one line and the
   evidence.
4. **When the trigger fires,** file the follow-up ticket the watch ticket describes,
   with its own class label, priority and acceptance criteria. Link it from the watch
   ticket in a comment, and move the watch ticket to Done.
5. If the page can't be reached, don't comment. Report it in the digest.

### Weekly digest

The digest is a comment on the **steward log**, a Jira ticket:

- **Find it** with `project = ESCSUITE AND labels = ap-steward-log`.
- **If it's missing, create it once:** a Task in ESCSUITE, summary
  "Autopilot steward log", label `ap-steward-log`.
- **Never close it.** It carries no class label, and the builder never takes it.

The digest covers:
- what shipped;
- what's in flight;
- **Waiting on you**, with links:
  - `ap-decision` tickets;
  - `needs-operator` tickets;
  - `ap-owner-merge` PRs labelled `needs-owner`, and any closed without merging;
  - watch triggers that fired, and watch pages that couldn't be reached;
- reverts;
- scores and their trend;
- backlog size by priority.

**Done state:** when every dimension scores 4 or higher and two consecutive sweeps find
no P1 or P2, say so in the digest and recommend a lighter cadence (Dependabot plus a
monthly sweep). Don't change the schedule yourself.

## Builder

Take ready tickets: those labelled `ap-auto` or `ap-owner-merge`, with no open PR, and
never one labelled `ap-decision`, `ap-watch`, `needs-operator` or `needs-owner`:

```
project = ESCSUITE AND statusCategory != Done AND labels in (ap-auto, ap-owner-merge)
  AND labels not in (ap-decision, ap-watch, needs-operator, needs-owner)
```

Take the highest priority first, then the oldest first. Stop after the run's ticket
budget, or after two failures in a row. For each ticket:

1. Move the ticket to In Progress. Branch `claude/<issue-key>-<slug>` from the latest
   `main`. One ticket per PR.
2. **Write a failing test first**, one that fails for the reason the ticket describes.
   Pure visual polish may assert on the DOM or styles instead. Then make the smallest
   change that meets every acceptance criterion.
3. Run the full verify command. Coverage floors never drop, and no test is skipped
   or deleted to get green.
4. **Independent review.** Hand the `reviewer` subagent (opus) the diff and the ticket.
   For `ap-owner-merge`, or a diff over 300 lines, then hand the `qc` subagent (fable)
   the same. Fix whatever they block on.
5. Open the PR (`gh api repos/{owner}/{repo}/pulls -f title=… -f head=… -f base=main
   -f body=…`). It references the ticket, lists each acceptance criterion with how it
   is verified, and states the class and any risk. Comment the PR link on the ticket.
6. **Merging:**
   - `ap-auto`: wait for `ci-status` to be green on the PR's head commit, rebase if
     `main` moved, then merge:
     `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/merge -f merge_method=squash`.
     Merge one PR at a time. Move the ticket to Done.
   - `ap-owner-merge`: label the PR `needs-owner` on GitHub. The ticket **stays In
     Progress**: add the Jira label `needs-owner` and a comment linking the PR, and
     leave it. **Reconcile** moves it to Done once the owner merges.
7. If a ticket turns out ambiguous, bigger than described, or of a stricter class,
   relabel it, comment on what you found, move it back to To Do, and move on.
8. If you stop on a ticket without a PR, move it back to To Do with a comment saying
   exactly what blocked it.

## Dependabot

Run it as a sweep: every open Dependabot PR, oldest first, one at a time.

**Find them:**

```
gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' \
  --jq '.[] | select(.user.login == "dependabot[bot]") | .number'
```

**Skip the triaged ones.** A PR is triaged when one of its comments starts with the
marker line `<!-- autopilot:dependabot-triage -->`. Comments post as the owner, so the
marker is the only reliable sign; never judge by author. The one exception: a triaged
PR whose verdict is `merge` and that is still open was waiting on CI. Merge it under
the rules below once `ci-status` is green on its head, without commenting again.
Check for the marker with:

```
gh api 'repos/{owner}/{repo}/issues/{n}/comments?per_page=100' \
  --jq '[.[] | select(.body | startswith("<!-- autopilot:dependabot-triage -->"))] | length'
```

For each untriaged PR:
1. Read the changelog or release notes for each bump and flag breaking changes.
2. Run verify, and fix breakages with the smallest change that keeps the upgrade.
3. Comment the triage (`gh api repos/{owner}/{repo}/issues/{n}/comments -f body=…`).
   The **first line is exactly** `<!-- autopilot:dependabot-triage -->`. Then give the
   verdict (`merge` or `needs-owner`), the packages bumped, the breaking changes, your
   fixes, and the verify result.
4. Merge it yourself, under the builder's merge rules, only if all of these hold:
   - it's a **patch or minor** bump;
   - verify passes;
   - `ci-status` is green;
   - no breaking changes were found.

   Otherwise label it `needs-owner` with the reason. If the verdict is `merge` but
   `ci-status` is still pending, leave it open for a later sweep.

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
- Never build or relabel `ap-decision`, `ap-watch` or `needs-operator` tickets.
- Use only the Atlassian connector for Jira and `gh api` for GitHub; never call another connector's tools.
- Missing access, credentials or a service you can't reach: say exactly what is missing on the ticket and stop. Never mock it.
- Follow `.claude/rules/subagent-routing.md` for every subagent.
- Keep CLAUDE.md files indexes; put detail in `docs/`.
