<!-- Vendored from bonham-ops, policy v1. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: builder role

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

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

**A refresh PR** is one bonham-ops's propagation workflow opened on a branch
`autopilot/refresh-v<N>`. Before taking tickets, find them:
`gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | select(.head.ref | startswith("autopilot/refresh-v")) | .number'`.
Merge one under the `ap-auto` rules, with no ticket, when all of these hold: every file
in `gh api repos/{owner}/{repo}/pulls/{n}/files` is `.claude/.vendored-manifest` or is
listed in it; `.claude/rules/autopilot.local.md` is not among them; `ci-status` is
green on the head. Otherwise label it `needs-owner` and comment which condition failed.
This is the one `.claude/` change that isn't owner-merged: the owner approved it when
it merged in bonham-ops.

**A "Refresh <page title> for <changes>" ticket** is a Confluence edit, not a PR. Change
only the statements the ticket names, keep the page's structure and voice, and never
touch a `## Memory` section. If a stale statement sits inside one, leave it and say on
the ticket that a local session should update it with `/ops-record`. Comment the new
page version on the ticket and move it to Done.
