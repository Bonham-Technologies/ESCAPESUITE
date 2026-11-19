<!-- Vendored from bonham-ops, policy v36. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: builder role

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

## Builder

Take ready tickets: those labelled `ap-auto` or `ap-owner-merge`, with no open PR, and
never one labelled `ap-decision`, `ap-watch`, `needs-operator`, `needs-owner`,
`ap-triage` or `ap-merging`:

```
project = ESCSUITE AND statusCategory != Done AND labels in (ap-auto, ap-owner-merge)
  AND labels not in (ap-decision, ap-watch, needs-operator, needs-owner, ap-triage, ap-merging)
```

**Control panel.** First read this project's settings as **Control panel**
(`.claude/autopilot/control-panel.md`) says. While `Builder paused`, take no tickets and
say "paused by control panel"; on a day outside `Build days`, the same with "not a build
day". The Dependabot sweep and **Reconcile** run every day regardless. `Builder budget`
replaces the prompt's budget, and `Feature cap` caps feature tickets.

**Feature batches.** A feature is the open tickets sharing one Jira label
`ap-feature-<slug>`, ordered by their "Blocks" links; each ticket keeps its own class
label. Before regular tickets, take the oldest feature (by its oldest ticket) that has
a ready ticket, and work its ready tickets in dependency order, ties by priority and
then age: a ticket goes only once every ticket blocking it is Done or has an open PR
(it then stacks: **Stacking**). Feature tickets don't count against the ticket budget.
Stop the feature at the **feature cap** (the panel's `Feature cap`, default 8) or after
two failures in a row, then spend the regular budget as usual on tickets with no
`ap-feature-*` label; other features wait for a later run. A ticket blocked by an
`ap-decision`, `ap-watch`, `needs-operator` or `ap-triage` ticket waits; the feature's
independent tickets still go ahead.

**Stacking.** A ticket that depends on an unmerged PR gets its branch cut from that PR's
branch, its PR opened against that branch, and "Merge after #N" as the first line of its
body. A stacked PR is never merged, nor given auto-merge, while its base is open. If its
ticket is `ap-owner-merge`, label it `needs-owner`, and the owner merges it after its
base; otherwise give its ticket the Jira label `ap-merging` and a comment linking the PR
with its `Head:` sha, and **Auto-merge pending** takes it through step 6 once its base
has merged and records `Auto-merge on: <head sha>` on the ticket.

**Feature summary.** At the end of the run, comment once on the feature's first ticket
and on each ticket the run touched: the feature's PRs in merge order, what each
changed, what is blocked and on what, and what is left.

**Formerly owner-merge** (BORG-104). These `ap-auto` changes used to wait for the owner,
so each merges only once both the `reviewer` and the `qc` subagent pass with nothing
left open: auth, sessions, identity and permissions; security headers and CSP; CI/CD and
build config other than release publishing, production deployment, infrastructure
config, CI secrets and token permissions, and weakening the `ci-status` job; additive (non-breaking) API, export, format and contract changes;
migrations that only add (tables, columns, indexes) and that the merge doesn't apply to
production; dependency majors; `.claude/` setup outside `.claude/rules/`,
`.claude/autopilot/`, `.claude/agents/`, `.claude/hooks/` and `.claude/settings*.json`; diffs over about 800 lines; and stacked PRs. The PR body names
them on one line, `Formerly owner-merge: <categories>`, which the digest lists. Anything
in doubt, or with steps before or after the merge, stays `ap-owner-merge`.

Take the highest priority first, then the oldest first. Stop after the run's ticket
budget, or after two failures in a row. For each ticket:

1. Move the ticket to In Progress. Branch `claude/<issue-key>-<slug>` from the latest
   `main`, or from its base PR's branch when **Stacking** applies. One ticket per PR.
2. **Write a failing test first**, one that fails for the reason the ticket describes.
   Pure visual polish may assert on the DOM or styles instead. Then make the smallest
   change that meets every acceptance criterion.
3. Run the full verify command. Coverage floors never drop, and no test is skipped
   or deleted to get green.
4. **Independent review.** Hand the `reviewer` subagent (opus) the diff and the ticket.
   For `ap-owner-merge`, a **Formerly owner-merge** category, or a diff over 300 lines,
   then hand the `qc` subagent (fable) the same. Fix whatever they block on.
5. Open the PR (`gh api repos/{owner}/{repo}/pulls -f title=… -f head=… -f base=main
   -f body=…`; under **Stacking**, `base` is the base PR's branch). It references the
   ticket, lists each acceptance criterion with how it is verified, and states the
   class and any risk. Comment the PR link on the ticket. Then, unless `executeRead`
   `listJiraIssueRemoteIssueLinks` shows it already, add it as the ticket's web link with
   `executeWrite` `createJiraIssueRemoteIssueLink`; a missing, prompting or failing tool: skip it.
6. **Merging:**
   - **Public repo:** merge, or enable auto-merge, only when the PR's head is a branch
     of this repo and its author the owner or Dependabot (`public-repos.md`).
   - `ap-auto`: if `gh api repos/{owner}/{repo} --jq .allow_auto_merge` is true and
     `gh api repos/{owner}/{repo}/rules/branches/main` requires `ci-status` with
     `strict_required_status_checks_policy` true, bring the branch up to date (policy,
     **Always**) and enable auto-merge with the GitHub MCP `enable_pr_auto_merge`
     (`mergeMethod: SQUASH`). Otherwise, if those tools aren't present or fail without
     reaching GitHub, or if GitHub answers that it is already mergeable (clean status), merge it on a **fresh green** (**Always**):
     `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/merge -f merge_method=squash`.
     Merge one PR at a time. Move the ticket to Done once merged; while auto-merge is
     pending, give its ticket, if any, the Jira label `ap-merging` and a comment linking
     the PR with its `Head:` sha, and **Reconcile** finishes it.
   - **New commits.** Before you push to a PR with auto-merge on, turn it off with
     `disable_pr_auto_merge`; enable it again once steps 3 and 4 pass on the new head.
     An update-branch merge of `main` is not a new commit.
   - **Auto-merge pending.** After **Reconcile**, for each open PR of an `ap-merging`
     ticket: a stacked PR ("Merge after #N") whose ticket has no `Auto-merge on:`
     comment waits while #N is open. If #N closed without merging, it is stuck (below).
     Once #N has merged: if the PR still targets #N's branch, retarget it
     (`gh api -X PATCH repos/{owner}/{repo}/pulls/{n} -f base=main`). If update-branch
     conflicts because #N was squash-merged, first merge #N's final head into the branch
     (`git fetch origin pull/N/head && git merge FETCH_HEAD`), then merge `main`, taking
     this branch's side only where `main`'s side is #N's squash, and push; if either
     merge conflicts anywhere else, it is stuck. If its head moved off the comment's `Head:` sha by
     anything but an update-branch merge of `main`, rerun steps 3 and 4 on it. Then take
     it through step 6 as `ap-auto`; once `enable_pr_auto_merge` succeeds, comment
     `Auto-merge on: <head sha>` on the ticket (if step 6 merged it instead, Reconcile
     finishes it), and leave it for this run. From then on
     it is one of the others, checked against that sha. For the others: bring it up
     to date (**Always**). If its head moved off the comment's `Head:`
     sha by anything but an update-branch merge of `main`, turn auto-merge off
     (`disable_pr_auto_merge`). If its `auto_merge` is null, someone turned it off, and if
     `ci-status` failed or the update conflicts, it is stuck: either way label the PR
     `needs-owner`, swap the ticket's `ap-merging` for `needs-owner`, and say so on both.
   - `ap-owner-merge`: label the PR `needs-owner` on GitHub. The ticket **stays In
     Progress**: add the Jira label `needs-owner` and a comment linking the PR, and
     leave it. **Reconcile** moves it to Done once the owner merges.
   - **Merge refused.** If the session's permission check refuses the merge call or
     `enable_pr_auto_merge` (it never reached GitHub), don't retry it or try the other
     route: label the PR `needs-owner` and comment on the PR with the first line
     `<!-- autopilot:merge-refused -->` and the refusal; the comment names the call that
     was refused and whether the repo allows auto-merge. Its ticket, if any, goes as
     `ap-owner-merge` above, saying the merge was refused; Reconcile moves it to Done
     once the owner merges.
7. If a ticket turns out ambiguous, bigger than described, or of a stricter class,
   relabel it, comment on what you found, move it back to To Do, and move on.
8. If you stop on a ticket without a PR, move it back to To Do with a comment saying
   exactly what blocked it.

**A refresh PR** is one bonham-ops's propagation workflow opened on a branch
`autopilot/refresh-v<N>`. Before taking tickets, find them:
`gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | select(.head.repo.full_name == .base.repo.full_name and (.head.ref | startswith("autopilot/refresh-v"))) | .number'`.
Merge one under the `ap-auto` rules, with no ticket, when all of these hold: every file
in `gh api repos/{owner}/{repo}/pulls/{n}/files` is `.claude/.vendored-manifest` or is
listed in it; `.claude/rules/autopilot.local.md` is not among them; the head has a
fresh green, or auto-merge waits for one. Otherwise label it `needs-owner` and comment
which condition failed.
A refused merge goes as step 6's **Merge refused**.
Refresh PRs are the only `.claude/rules/` and `.claude/autopilot/` changes that aren't
owner-merged: the owner approved them when they merged in bonham-ops.

**Keep fresh** (BORG-98). Last in every run, after its final merge, unless `Builder
paused` or `main` is red: keep owner-merge PRs one click from mergeable. List the open
PRs labelled `needs-owner`, oldest first:
`gh api 'repos/{owner}/{repo}/issues?labels=needs-owner&state=open&sort=created&direction=asc&per_page=100' --jq '.[] | select(.pull_request) | .number'`.
Skip one from a fork, one not by the owner on a public repo (`public-repos.md`), one
with `auto_merge` set, one whose head sha a keep-fresh conflict comment names, and a
stacked one ("Merge after #N") until #N has merged; then, if it still targets #N's
branch, retarget it first (`gh api -X PATCH repos/{owner}/{repo}/pulls/{n} -f base=main`).
For each whose `compare/main...<head sha>` has `behind_by` above 0, call update-branch,
not waiting for its CI, until 10 have updated in the run. On a conflict, a
`CHANGELOG.md`-only one included, comment with first line
`<!-- autopilot:keep-fresh-conflict -->`, then `Head: <sha>` and the files if known, and
leave it. This step never merges, enables auto-merge or pushes commits.

**A "Refresh <page title> for <changes>" ticket** is a Confluence edit, not a PR. Change
only the statements the ticket names, keep the page's structure and voice, and never
touch a `## Memory` section. If a stale statement sits inside one, leave it and say on
the ticket that a local session should update it with `/ops-record`. Comment the new
page version on the ticket and move it to Done.
