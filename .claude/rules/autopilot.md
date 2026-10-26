<!-- Vendored from bonham-ops (d170167). Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot policy

This repository is on autopilot. Claude finds improvements, files them, builds them and
merges them. The goal is to make the product **noticeably better every week** until it
is in a great state. The owner is involved only where it matters: product decisions,
risky merges, and reverts.

Jira project: **ESCSUITE**. Confluence record: **ESCAPESUITE** in space `OPS`.
Verify command: see `CLAUDE.md`.

## Roles

Each run plays the roles named in its prompt, in the order given.

- **steward**: sweeps the product and its open security alerts, files tickets, checks
  `ap-watch` tickets and posts the weekly digest. Writes no code.
- **builder**: implements ready tickets and merges them when the gates pass.
- **dependabot**: triages open Dependabot PRs, security updates first. It runs as a
  sweep over every open Dependabot PR that has no triage comment yet; the builder task
  runs it before the builder role.
- **scout**: looks outward where the steward looks inward. It researches competing
  tools, user needs and new capabilities, and files up to 5 feature proposals as
  `ap-decision` tickets. Writes no code and builds nothing.

Every steward, builder and dependabot run starts with **Main must stay green** and then
**Reconcile**, below. The scout skips both.

## Tools and access

Runs are scheduled tasks in cloud sessions.

- **Jira** (`bonham.atlassian.net`): the Atlassian connector only.
- **Confluence** (`bonham.atlassian.net`, space `OPS`): the same Atlassian connector.
  Write only what **Record in Confluence**, **Decision Log** and the builder's
  **Refresh** tickets below allow.
- **GitHub**: `gh api` REST only. `gh pr …` and GraphQL (`gh api graphql`) are blocked
  in cloud sessions. In `gh api` paths, `{owner}` and `{repo}` fill in from the
  current repository.
- **No other connector.** A run may be given other connectors, such as Gmail, Google
  Drive, Supabase or Vercel. Never call their tools, for any reason. End every run's
  summary with the list of other connectors whose tools were present, or "none".
  (`git`, the verify command, reading the public pages `ap-watch` tickets link to, and
  the scout's web search and page fetches are not connectors and are fine.)
- Comments and PRs post under the **owner's own** GitHub and Jira identity, so the
  author never tells you whether autopilot wrote something. Use the fixed markers below
  to recognise autopilot's own comments.

**Jira statuses.** The projects have only **To Do**, **In Progress** and **Done**. Use
no other status. Labels are free-form: the class labels, `needs-owner`, `needs-operator`,
`ap-steward-log`, `ap-asked` and `ap-scout` need no setup.

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

**Protected editor paths (temporary).** Until ESCSUITE-348, -349, -350 and -351 are all
Done and green on `main`, a diff touching any of these in `apps/artist/src/` is also
`ap-owner-merge`: `components/Preview/**`, `components/Timeline/**`,
`store/clipSlice.ts`, `store/historySlice.ts`, `store/projectMigration.ts`,
`core/projectFileFormat.ts`, `core/projectManager.ts`, `utils/waveform.ts` and
`core/audioMixer.ts`. Once all four tickets are Done, the rule lapses: the steward says
so in the next digest and files an `ap-owner-merge` ticket to delete this paragraph.

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

## Steward

Sweep these dimensions:
- correctness and bugs;
- tests on critical paths;
- performance;
- accessibility;
- UI;
- UX and flow;
- design consistency;
- security, including the **Security alerts** sweep below;
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
- **Regression specs.** List bug tickets closed since the last sweep whose symptom is
  visible in the UI but which landed no `apps/e2e/tests/regressions/<KEY>.spec.ts`, and
  file a P2 `ap-auto` ticket for each one to add it.
- **Flaky e2e tests.** Read the `e2e-flaky` lists from the last 7 days of `main` runs (recipe in
  `docs/reference/ci-cd-pipeline.md`) and file a ticket for any test flaky more than once.
- Score each dimension 1–5 with one line of evidence.

### Security alerts

Every run, read the repository's open security alerts:

```
gh api 'repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100'
gh api 'repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=100'
gh api 'repos/{owner}/{repo}/secret-scanning/alerts?state=open&per_page=100'
```

A private repo without GitHub Code Security or Secret Protection answers the last two
with 403 or 404 and a message that the feature "must be enabled" or is "disabled".
That means **not available**, not a failure: note it once in the digest and carry on.
If the Dependabot alerts call fails, say exactly what is missing in the digest.

For each open alert:

1. **An open Dependabot PR already fixes it**, meaning the PR bumps the alert's package
   to at least its first patched version: file nothing. The **Dependabot** sweep
   handles it.
2. **Otherwise file one ticket per alert.** Dependabot and code-scanning alerts are
   numbered separately, so the summary carries both the source and the number:
   `[security] dependabot #<n>: <GHSA id> in <package>`, or
   `[security] code-scanning #<n>: <rule> in <file>`. Search Jira for it first, Done
   tickets included: `project = ESCSUITE AND summary ~ "\"dependabot #<n>\""`.
   If an open ticket exists, leave it. If a Done ticket
   exists but the alert is still open, move it back to To Do with a comment saying so.
   - **Priority:** critical and high are P1, medium P2, low P3. The severity is
     `security_advisory.severity` on a Dependabot alert and
     `rule.security_severity_level` on a code-scanning alert.
   - **Class:** `ap-auto` if the fix is a patch or minor bump or a code change;
     `ap-owner-merge` if it needs a major bump or removing the package. The class rules
     above still apply, so a code change to authentication, say, is `ap-owner-merge`.
   - **No patched version exists:** file it `ap-watch` instead. Link
     `https://github.com/advisories/<GHSA id>`; the trigger is "a patched version is
     released" (`gh api advisories/<GHSA id>` shows it), and the follow-up is the bump.
3. **Secret-scanning alerts** are P1 `ap-owner-merge`, summary
   `[security] secret-scanning #<n>: <secret type>`. The owner must rotate the secret,
   so the ticket says that first. Never copy the secret's value into Jira, a PR or a
   comment.

Security tickets are filed before any other finding and count toward the 25-ticket cap.

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
- **Open security alerts:** one line with the counts, for example
  "Dependabot 3 (high 1, medium 2) · code scanning not available · secret scanning 0";
- scores and their trend;
- backlog size by priority.

**Done state:** when every dimension scores 4 or higher and two consecutive sweeps find
no P1 or P2, say so in the digest and recommend a lighter cadence (Dependabot plus a
monthly sweep). Don't change the schedule yourself.

### Record in Confluence

The OPS space is the durable record; Jira carries the work. Local sessions write it
through hooks, and scheduled runs have no hooks, so the steward writes its own entry.

**Before posting the digest,** find the project's Session Log page:
`searchConfluenceUsingCql` with
`space = OPS AND type = page AND title = "ESCAPESUITE — Session Log"`, and the
Decision Log page the same way (**Decision Log**, step 1). If the Session Log is
missing, say so in the digest, write nothing to Confluence this run, and
never create a page tree: `/ops-init` owns that. If only the Decision Log is missing, say so in the
digest and skip **Decision Log**.

**After the digest** and the **Decision Log** pages below, so the entry can link them,
add this run's entry to that page, in the record's convention:

- The page is one running log. Its intro paragraph reads "Appended by Claude Code
  sessions. Newest entries at the top.", and some pages add a paragraph linking archive
  pages. Insert the entry **directly below those paragraphs and above the first
  existing entry**. Keep every existing entry as it is: don't reorder, reformat or
  trim them.
- If the intro says instead that each session gets its own child page, create a child
  of the Session Log titled `ESCAPESUITE — <YYYY-MM-DD> · autopilot steward`.
- The heading is `### <YYYY-MM-DD> · branch main · autopilot steward`, the same shape
  the session hooks write. Below it:
  - **Shipped:** each merged PR and its ticket, both linked;
  - **Waiting on the owner:** the digest's **Waiting on you** items, linked;
  - **Security alerts:** the digest's count line;
  - **Scores:** each dimension's score, with the trend;
  - **Decisions:** the Decision Log pages added this run, linked, or "none";
  - **Digest:** a link to this run's comment on the steward log ticket.
- Use `getConfluencePage` for the current body and version, then
  `updateConfluencePage`. Read the title back from the response; if it differs, stop
  writing to Confluence and report it in the run summary. On a version conflict, fetch
  again and retry once.
- **Once per day and role:** if the body already has a heading for today ending in
  this role (`· autopilot steward` or `· autopilot scout`), this run's entry is
  there: an earlier run, or a retry whose response was lost. Don't add another. Check
  again before the retry.

**Never** add or edit a `## Memory` section on any page: those sync into local memory and
belong to local sessions. Never rewrite the human-written pages, such as Architecture,
Charter & Scope and their children. If one looks stale against what merged, file a P3
`ap-auto` ticket "Refresh <page title> for <changes>" that names each stale statement
and what replaced it, after searching Jira for an open one.

### Decision Log

Record each `ap-decision` question the owner has answered since it was asked. Find them
with:

```
project = ESCSUITE AND labels = ap-asked AND updated >= -30d
  AND (labels not in (ap-decision) OR statusCategory = Done)
```

A ticket that no longer carries `ap-decision` was approved, even if the builder has
since moved it to Done; one closed while it still carries `ap-decision` was rejected.
Before the first search, add `ap-asked` to each open `ap-decision` ticket that lacks
it: that is the only change a scheduled run may make to an `ap-decision` ticket's
labels.

For each one:

1. The Decision Log page, found before the digest:
   `space = OPS AND type = page AND title = "ESCAPESUITE — Decision Log"`.
2. **Skip it if it's already recorded:** the ticket has a comment starting
   `[autopilot:decision-log]`, or
   `ancestor = <Decision Log id> AND type = page AND text ~ "<ticket key>"` finds a
   page.
3. The record's convention is one child page per decision. Create a child of the
   Decision Log, titled `ESCAPESUITE — <the decision, in a few words>`. The body says:
   - what was decided, in a sentence, and the options if the ticket listed any;
   - **when**: the date the owner relabelled or closed the ticket, from its change
     history; if the connector doesn't show history, the date of the owner's answering
     comment or the ticket's last update, marked "about";
   - **why**: the owner's reason from the ticket's comments, or "no reason given";
   - the ticket, linked.

   No `## Memory` section. Read the title back from the response; if it differs
   (Confluence renames a duplicate title silently), report it in the run summary.
4. Comment on the ticket: `[autopilot:decision-log]` and the page link.

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
   **A bug whose symptom shows in the UI** (playback, preview, waveform, timeline
   editing, save/load, export) also needs a Playwright test at
   `apps/e2e/tests/regressions/<KEY>.spec.ts` that fails before the fix. A unit test
   alone doesn't meet this step. Use the media-health helpers in `apps/e2e/utils/` where
   they exist. Where the container can't run it (e.g. H.264/AAC media), let CI prove it
   and say so in the PR.
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

**A "Refresh <page title> for <changes>" ticket** is a Confluence edit, not a PR. Change
only the statements the ticket names, keep the page's structure and voice, and never
touch a `## Memory` section. If a stale statement sits inside one, leave it and say on
the ticket that a local session should update it with `/ops-record`. Comment the new
page version on the ticket and move it to Done.

## Dependabot

Run it as a sweep, one PR at a time: first every open Dependabot PR that fixes an open
Dependabot alert, then the rest, oldest first within each group. A PR fixes an alert
when it bumps the alert's package to at least the alert's first patched version; read
the alerts with
`gh api 'repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100'`.

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
   verdict (`merge` or `needs-owner`), the packages bumped, the security alerts it
   fixes, the breaking changes, your fixes, and the verify result.
4. Merge it yourself, under the builder's merge rules, only if all of these hold:
   - it's a **patch or minor** bump;
   - verify passes;
   - `ci-status` is green;
   - no breaking changes were found.

   Otherwise label it `needs-owner` with the reason. If the verdict is `merge` but
   `ci-status` is still pending, leave it open for a later sweep.

## Scout

The scout finds what the product should do next. It builds nothing and changes no code.

**Read first:**
- the project's **Charter & Scope** page and its child pages:
  `space = OPS AND type = page AND title = "ESCAPESUITE — Charter & Scope"`, then
  `ancestor = <its id> AND type = page`;
- the company direction:
  `space = OPS AND type = page AND title = "Bonham.Tech — Brand realignment: agent-built software (2026-10)"`;
- the repo's `README.md`;
- the latest digest: the newest comment on the steward log ticket.

**Then research on the web:**
- competing and adjacent tools: what they do that this product doesn't, and what they
  do badly;
- user needs and complaints in the space: forums, issue trackers, reviews;
- new platform, model or library capabilities the product could use.

**File up to 5 proposals,** best first. Each is a Jira ticket labelled `ap-decision`,
`ap-asked` and `ap-scout`, with:
- the problem, and who it's for;
- evidence: links to what you found;
- the proposed scope, and numbered acceptance criteria;
- a rough size: S, M or L;
- why now;
- a priority, as a suggestion for the owner.

Stay inside the charter and the company direction. A proposal that would change either
says so in its first line.

**Deduplicate** before filing. Search open tickets and those closed in the last 90 days,
by keywords from the summary:
`project = ESCSUITE AND (statusCategory != Done OR updated >= -90d) AND text ~ "<keywords>"`.
(`updated`, not `resolved`: moving a ticket to Done may leave its resolution empty.)
Skip a proposal the owner already rejected unless something material changed, and then
link the old ticket and say what changed.

**Record:** add an entry to the Session Log as **Record in Confluence** describes, with
the heading `### <YYYY-MM-DD> · branch main · autopilot scout`. It holds one section,
**Scout proposals**: each ticket, linked, with its one-line pitch and size. If the page is
missing, put the same list in the run summary instead.

## Models

The steward and scout make judgment calls, so they run on Fable. When the session itself
is not on Fable, do the analysis in the `analyst` subagent (`.claude/agents/analyst.md`,
model `fable`, read-only plus web):

- **steward:** hand it the sweep and the ranking. Give it the dimensions, the open
  tickets' summaries and the security alerts; it returns ranked findings with evidence
  and scores.
- **scout:** hand it the research and the ranking. Give it the charter, the company
  direction, the README and the digest; it returns ranked proposals with evidence.

Either way, the session itself files the tickets and writes to Jira and Confluence: the
analyst only reads. The builder's subagents follow `.claude/rules/subagent-routing.md`:
`builder` sonnet, `reviewer` opus, `qc` fable.

## Main must stay green

At the start of every run:
1. Check `ci-status` on `main`'s head, and the production health check if `CLAUDE.md`
   names one. Once a nightly workflow exists (ESCSUITE-353), also check its latest run
   on `main`: a red nightly counts as a red `main` for the steps below.
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
