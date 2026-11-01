<!-- Vendored from bonham-ops, policy v3. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: steward role

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

## Steward

Sweep these dimensions:
- correctness and bugs;
- tests on critical paths;
- performance;
- accessibility;
- UI;
- UX and flow;
- design consistency;
- security, including the **Security sweep** (`.claude/autopilot/security-sweep.md`);
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

### Legacy tickets

Tickets from before autopilot may carry no class label. Find them every run:
`project = ESCSUITE AND statusCategory != Done AND (labels is EMPTY OR labels not in (ap-auto, ap-owner-merge, ap-decision, ap-watch, needs-operator, ap-steward-log, ap-triage))`.

- **If it returns tickets and no open ticket carries `ap-triage`,** file ONE ticket:
  summary `Classify <N> pre-autopilot tickets`, labels `ap-decision`, `ap-asked` and
  `ap-triage`. Its body has one line per ticket: the key, the title, a proposed class
  (`ap-auto`, `ap-owner-merge`, `ap-decision`, `ap-watch` or `needs-operator`) or
  "close as obsolete", and one line of evidence. Credential or security tickets are
  also listed under **Waiting on you** until classified.
- **While the triage ticket is open,** the digest links it instead of listing them,
  except credential or security tickets, which stay listed.
- **Once the owner has answered,** because the ticket no longer carries `ap-decision`
  (approved) or has a comment with per-line answers, apply each line, the owner's
  answer over the proposal: add the class label, or close the ticket as obsolete with
  a comment. Then move the triage ticket to Done.

### Security sweep

The **Security sweep** and **Security tickets** are in
`.claude/autopilot/security-sweep.md`.

### Watch tickets

Check every open `ap-watch` ticket, every run:
`project = ESCSUITE AND labels = ap-watch AND statusCategory != Done`.

1. Fetch the page the ticket links with WebFetch, or `curl -fsSL <url>`; a release
   page is `https://github.com/<o>/<r>/releases/latest`. Never `gh api` another repo
   for it: that answers 403 in cloud.
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
- **Security scan:** one line, for example "main@1a2b3c4 · osv-scanner 2.6.0: 4
  lockfiles (pnpm-lock.yaml, api/uv.lock, …), critical 0 · high 2 · medium 3 · low 1 ·
  gitleaks 8.30.1: history since 9f8e7d6 (14 commits) and tree, 0 new, 2 fakes ·
  uncovered: jsr: packages in deno.lock". It gives:
  - `main@<sha>`, the commit scanned, which the next run's history scan starts from;
  - the tool versions;
  - the lockfiles scanned, the fallbacks used, and anything uncovered;
  - the vulnerability counts by severity;
  - the secret findings: new, already ticketed, and fakes;
  - any failure, with the step that failed.

  If both alert APIs answered 200 and no scan ran, say "not needed: alerts available";
- **Setup:** one line, for example `policy v12 (bonham-ops@1a2b3c4) · instructions v4 ·
  model: Fable 5.1 · agents: vendored`. The policy version is in the first line of
  `.claude/rules/autopilot.md` and the commit on the `source-commit:` line of
  `.claude/.vendored-manifest`; the instructions version is the `Instructions v<M>.` at
  the end of this run's task prompt, or the Project instructions' first line when the
  two differ (then show both); the model is the one this run can tell it is on, or
  `unknown`; `agents: vendored` or `agents: fallback` says which path the run's
  subagents took (**Models**);
- scores and their trend;
- backlog size by priority.

**Done state:** when every dimension scores 4 or higher and two consecutive sweeps find
no P1 or P2, say so in the digest and recommend a lighter cadence (Dependabot plus a
monthly sweep). Don't change the schedule yourself.

### Record in Confluence

**Record in Confluence** is in `.claude/autopilot/confluence-record.md`. It has a step
before the digest and one after it.

### Decision Log

Record each `ap-decision` question the owner has answered since it was asked. Find them
with:

```
project = ESCSUITE AND labels = ap-asked AND updated >= -30d
  AND (labels not in (ap-decision) OR statusCategory = Done) AND labels not in (ap-triage)
```

A ticket that no longer carries `ap-decision` was approved, even if the builder has
since moved it to Done; one closed while it still carries `ap-decision` was rejected,
except a Done `ap-triage` ticket, which was answered (**Legacy tickets**).
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
