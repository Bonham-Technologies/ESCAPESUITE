<!-- Vendored from bonham-ops (8b8c74c). Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot policy

This repository is on autopilot. Claude finds improvements, files them, builds them and
merges them. The goal is to make the product **noticeably better every week** until it
is in a great state. The owner is involved only where it matters: product decisions,
risky merges, and reverts.

Jira project: **ESCSUITE**. Confluence record: **ESCAPESUITE** in space `OPS`.
Verify command: see `CLAUDE.md`.

## Roles

Each run plays the roles named in its prompt, in the order given.

- **steward**: sweeps the product, scans it for vulnerable dependencies and leaked
  secrets, files tickets, checks `ap-watch` tickets and posts the weekly digest. Writes
  no code.
- **builder**: implements ready tickets and merges them when the gates pass.
- **dependabot**: triages open Dependabot PRs, security updates first. It runs as a
  sweep over every open Dependabot PR that has no triage comment yet; the builder task
  runs it before the builder role.
- **scout**: looks outward where the steward looks inward. It researches competing
  tools, user needs and new capabilities, and files up to 5 feature proposals as
  `ap-decision` tickets. Writes no code and builds nothing.

Every steward, builder and dependabot run starts with **Main must stay green** and then
**Reconcile**, below. The scout skips both.

## Role files

This file holds only what every role needs. Each role's procedure is in its own file
under `.claude/autopilot/`, and those files don't load on their own. **Before you start
a role, read its files in full and follow them.** A prompt such as "Run the steward role
from .claude/rules/autopilot.md" means exactly that.

| Role | Read |
|---|---|
| steward | `.claude/autopilot/steward.md`, `.claude/autopilot/security-sweep.md` and `.claude/autopilot/confluence-record.md` |
| builder | `.claude/autopilot/builder.md` |
| dependabot | `.claude/autopilot/dependabot.md`, and `.claude/autopilot/builder.md` for the merge rules it follows |
| scout | `.claude/autopilot/scout.md` and `.claude/autopilot/confluence-record.md` |

A bold section name that isn't in this file is in one of them:
- **Steward**, **Watch tickets**, **Weekly digest** and **Decision Log**: `steward.md`;
- **Security sweep** and **Security tickets**: `security-sweep.md`;
- **Record in Confluence**: `confluence-record.md`;
- **Builder**, **Dependabot** and **Scout**: the role's own file.

If a role's file is missing, don't improvise the role: say which file is missing in the
run summary and stop that role.

## Local overrides

`.claude/rules/autopilot.local.md` holds this repository's own rules, and a refresh from
bonham-ops never touches it. It loads in every session, like this file. Where
`autopilot.local.md` conflicts with this policy, the local file wins, except for the hard
rules and the owner-merge criteria, which can only be made stricter. The hard rules are
**Always** below; the owner-merge criteria are the `ap-owner-merge` list under **Ticket
classes**. "This policy" means this file and the role files.

## Tools and access

Runs are scheduled tasks in cloud sessions.

- **Jira** (`bonham.atlassian.net`): the Atlassian connector only.
- **Confluence** (`bonham.atlassian.net`, space `OPS`): the same Atlassian connector.
  Write only what **Record in Confluence**, **Decision Log** and the builder's
  **Refresh** tickets in the role files allow.
- **GitHub**: `gh api` REST only. `gh pr …` and GraphQL (`gh api graphql`) are blocked
  in cloud sessions. In `gh api` paths, `{owner}` and `{repo}` fill in from the
  current repository. The Claude GitHub App can't read security alerts, so the steward
  runs its own scanners (**Security sweep**).
- **No other connector.** A run may be given other connectors, such as Gmail, Google
  Drive, Supabase or Vercel. Never call their tools, for any reason. End every run's
  summary with the list of other connectors whose tools were present, or "none".
  (`git`, the verify command, the steward's security scanners and their downloads,
  reading the public pages `ap-watch` tickets link to, and the scout's web search and
  page fetches are not connectors and are fine.)
- Comments and PRs post under the **owner's own** GitHub and Jira identity, so the
  author never tells you whether autopilot wrote something. Use the fixed markers in the
  role files to recognise autopilot's own comments.

**Jira statuses.** The projects have only **To Do**, **In Progress** and **Done**. Use
no other status. Labels are free-form: the class labels, `needs-owner`, `needs-operator`,
`ap-steward-log`, `ap-asked`, `ap-scout`, `ap-security` and `ap-ignore` need no setup.

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
- removing anything a user can see or rely on;
- the autopilot's own setup: anything under `.claude/`, such as
  `.claude/rules/autopilot.local.md`, the agents, hooks and settings.

It also applies if the diff exceeds about 800 changed lines, or the reviewer or QC
raises a concern it can't resolve.

**`ap-decision`** if the ticket asks for:
- a new capability outside the product's current scope;
- a pricing or plan change;
- a brand or visual-identity change;
- legal or privacy wording;
- anything irreversible for users;
- a trade-off between goals the owner hasn't ranked.

The ticket states the question, two or three options, and a recommendation. Every
`ap-decision` ticket also gets the label `ap-asked` when it is filed, and keeps it after
the owner relabels or closes it: that is how **Decision Log** finds answered questions.

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

## Models

The steward and scout make judgment calls, so they run on Fable. When the session itself
is not on Fable, do the analysis in the `analyst` subagent (`.claude/agents/analyst.md`,
model `fable`, read-only plus web):

- **steward:** hand it the sweep and the ranking. Give it the dimensions, the open
  tickets' summaries and the security findings; it returns ranked findings with evidence
  and scores.
- **scout:** hand it the research and the ranking. Give it the charter, the company
  direction, the README and the digest; it returns ranked proposals with evidence.

Either way, the session itself files the tickets and writes to Jira and Confluence: the
analyst only reads. The builder's subagents follow `.claude/rules/subagent-routing.md`:
`builder` sonnet, `reviewer` opus, `qc` fable.

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
- Never build or relabel `ap-decision`, `ap-watch` or `needs-operator` tickets. The
  exceptions are adding the `ap-asked` marker, and a thread started from the Project
  conversation because the owner approved or rejected a named ticket there.
- Never add or edit a `## Memory` section on a Confluence page, and never create a
  project's page tree.
- Use only the Atlassian connector for Jira and `gh api` for GitHub; never call another connector's tools.
- Missing access, credentials or a service you can't reach: say exactly what is missing on the ticket and stop. Never mock it.
- Follow `.claude/rules/subagent-routing.md` for every subagent.
- Keep CLAUDE.md files indexes; put detail in `docs/`.
