<!-- Vendored from bonham-ops, policy v3. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: fleet role

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

## Fleet

The fleet role runs as bonham-ops's steward, in place of the dimension sweep under
**Steward**. The run still starts with **Main must stay green** and **Reconcile**, and
everything else in `steward.md` still applies: **Security sweep** of this repo, **Watch
tickets**, **Decision Log** and **Record in Confluence**; the **Fleet digest** below
replaces the **Weekly digest**. bonham-ops is the only repo where the role runs. The
projects come from `autopilot/fleet.json` in this checkout; skip the entry with
`"fleet": true`, which is this repo.

### Inputs

For each project, read:
1. the two newest digest comments on its steward log
   (`project = <jiraKey> AND labels = ap-steward-log`), and the newest one's date;
2. the open tickets waiting on the owner, with the PR links in their comments:
   `project = <jiraKey> AND statusCategory != Done AND labels in (ap-decision, needs-operator, ap-scout, needs-owner)`;
3. its Session Log's entries, by role, since each role's last scheduled time in
   `fleet.json`: the steward's last scheduled day, the scout's last day of the month in
   its list, and the builder's two most recent scheduled nights
   (`space = OPS AND type = page AND title = "<record> — Session Log"`);
4. the week's counts, over the last 7 days:
   - tickets filed: `project = <jiraKey> AND created >= -7d AND (labels is EMPTY OR labels not in (ap-steward-log))`;
   - decisions answered: the `ap-asked` query under **Decision Log**, with `updated >= -7d`.

From this repo, read the previous fleet digest (the newest earlier comment on this
project's steward log), for the "two consecutive weeks" signals, the open
`propagation` issues: `gh api 'repos/{owner}/{repo}/issues?labels=propagation&state=open'`,
and two issues bonham-ops Actions write:
- **the propagation log:** its `number` and `comments` count from
  `gh api 'repos/{owner}/{repo}/issues?labels=propagation-log&state=open&per_page=5' --jq '.[0] | {number, comments}'`,
  then its newest comment:
  `gh api 'repos/{owner}/{repo}/issues/<number>/comments?per_page=1&page=<comments>' --jq '.[0].body'`.
  Its first line is `policy v<N>`; each other line is `<project>: <result>`, with the
  PR's URL after a `pr #n` or `updated #n`;
- **the scanner releases:** `gh api 'repos/{owner}/{repo}/issues?labels=scanner-releases&state=open&per_page=5' --jq '.[0].body'`,
  whose `osv-scanner:` and `gitleaks:` lines are the latest release tags.

A cloud run's `gh api` reaches only this repo; any other repo answers 403, so call
none. If a read fails, skip that input, say so in the digest and write "unknown" for a
count; never guess.

### Fleet digest

A comment on this project's steward log, found as **Weekly digest** says. In order:

- **Waiting on you**, grouped by project, every item linked: each project's waiting
  tickets and `needs-owner` PRs, and this project's own, with each refresh, paste and
  policy ticket under the project it concerns. This is the owner's inbox.
- **Missed runs.** A steward or scout always leaves a trace, a digest comment or a
  Session Log entry, so one whose scheduled time in `fleet.json` passed with no trace
  is missed. A builder with nothing to do leaves none, so flag a builder only when
  ready tickets (`labels in (ap-auto, ap-owner-merge)`, not Done) existed at the start
  of its window and none changed status or gained a PR-link comment across two
  consecutive scheduled runs. The cause is invisible from here: write only "no trace of the
  <role> run since <date>".
- **Setup:** a table of each project's reported policy and instructions versions
  against `fleet.json`, an agents column (`vendored` or `fallback`, from the same line),
  a Refresh PR column (the project's PR from the propagation log, linked), and the
  projects whose digest has no Setup line (they run a policy older than the fleet).
- **Scoreboard:** one line per project, linking its digest: the ten dimension scores,
  each with its trend (this digest's score minus the previous digest's); reverts this
  week; owner interventions this week, counted as decisions answered only (input 4;
  merges in another repo can't be read from here); the security counts; tickets filed
  (input 4) and shipped (the digest's shipped list).
- **Policy findings filed this run**, linked, or "none".
- The tail of **Weekly digest** for this repo itself: **Open security alerts**,
  **Security scan** and **Setup**. The **Security scan** line adds `pins vs latest:
  osv-scanner <pin>/<latest> · gitleaks <pin>/<latest> · checked <date>` from the
  `scanner-releases` issue, flagging a `checked:` date older than 14 days as stale, or
  `pins vs latest: not checked yet` if the issue is missing.

### Policy tickets

File a ticket in this project when a fleet signal is a rule problem, not a product
problem. The list is closed: a signal not in it files nothing.

| Signal | Ticket |
|---|---|
| A revert whose cause the digest attributes to a gate or rule, not the change | P1: fix the rule |
| Two or more projects report the same blocker, false-positive class or uncovered input in one week | P2: handle it in policy once |
| A run stopped on a missing tool, env var or service that the readiness check should have caught | P2: add the check |
| A digest field is missing or malformed in two or more projects | P3: the rule is unclear; rewrite it |
| The owner answered the same `ap-decision` question the same way in two or more projects | P3: propose promoting the answer to a rule |
| The `scanner-releases` issue's tag, minus its leading `v`, is newer than the pin (`OSV=` or `GL=` in `security-sweep.md`) | P3 `ap-owner-merge`: bump the pin |
| A missed run in two consecutive weeks | P2: the schedule, prompt or environment needs the owner; file `ap-decision` |

Cap 10 per run, highest priority first. Before filing, search this project's open
tickets for the same signal and project, and skip a duplicate. Each ticket cites the
digests, tickets or pages it came from, and is `ap-owner-merge`; the last row's is
`ap-decision` and `ap-asked`, as the class rules require.

Each open `propagation` issue names a project and a file it edited. File a P2
`needs-operator` ticket asking that the edit move to that repo's `autopilot.local.md`,
comment the ticket's link on the issue
(`gh api repos/{owner}/{repo}/issues/{n}/comments -f body=…`), then close it
(`gh api -X PATCH repos/{owner}/{repo}/issues/{n} -f state=closed`).

### Refresh and paste tickets

Any lag at all gets a ticket that week, in this project, labelled `needs-operator`:
only the owner can do the work. Search for an open one with the same title first.

- **`<project>: refresh autopilot setup to policy v<N>`**, when a project reports an
  older policy version or no Setup line. Read the propagation log's newest comment: if
  it is for `policy v<N>` and the project's line is `pr #n` or `updated #n`, its
  refresh PR is open: file nothing and link it under **Setup**; the project's builder
  merges it. If the line is `FAILED …`, `kept-edits issue #n` or anything else (such
  as `nothing to do`), the project has no line, or the comment is for another version,
  file the ticket and quote the line.
- **`<project>: paste Project instructions v<M>`**, when a project reports an older
  instructions version, or two that differ. The body is the text to paste, from
  `bin/fleet render-instructions <name>` in this checkout. When the "Scheduled tasks"
  section differs between the reported version and v<M> (this repo's history of
  `autopilot/project-instructions.md` has both), add the edits to make to each task in
  claude.ai: prompt, schedule or budget.

**Close them** when the work is done: once a project's Setup line reports the version
a refresh or paste ticket names, or a newer one, comment that on the ticket and move it
to Done. When you file a ticket for a newer version, close the open one for the older
version the same way.

### Never

The fleet role reads the product projects and never writes to a product's Jira
project, never opens a PR in a product repo, and never writes to a product's Session
Log. Its tickets live in this project, so no product builder can take them; its
owner-action tickets carry `needs-operator`, so no builder, this repo's included, takes
those. Its **Record in Confluence** entry goes to this repo's Session Log, with the
role name `autopilot fleet` in the heading and the once-per-day check; in place of
**Scores** it lists the tickets filed this run.
