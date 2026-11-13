<!-- Vendored from bonham-ops, policy v19. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: dependabot role

Part of the autopilot policy. `.claude/rules/autopilot.md` and `.claude/rules/autopilot.local.md` load in every session and apply here too.

## Dependabot

Run it as a sweep, one PR at a time: first every open Dependabot PR that fixes an open
Dependabot alert, then the rest, oldest first within each group. A PR fixes an alert
when it bumps the alert's package to at least the alert's first patched version; read
the alerts with `gh api 'repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100'`.
If that answers 403 or 404, as it does in cloud runs today, use the steward's open scan
tickets instead: a PR that bumps a ticket's package to at least its fixed version
fixes it. Find them with
`project = ESCSUITE AND labels = ap-security AND statusCategory != Done`. The PRs
the latest digest's **Security scan** line lists as "fixed by PR #<n>" are security
updates too.

**Find them:**

```
gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' \
  --jq '.[] | select(.user.login == "dependabot[bot]" and .head.repo.full_name == .base.repo.full_name) | .number'
```

**Skip the triaged ones.** A PR is triaged when one of its comments starts with the
marker line `<!-- autopilot:dependabot-triage -->` and was posted by the owner (`mrbonha`),
as autopilot's comments are; no other author counts. The one exception: a triaged
PR whose verdict is `merge`, that is still open with no `needs-owner` label, and whose
head is still the comment's `Head:` sha was waiting on CI or on auto-merge. Bring it
up to date and, unless its auto-merge is on, merge it under the rules below once it has
a fresh green, without commenting again. If the head changed by
anything but an update-branch merge of `main`, triage it again with a new comment.
Check for the marker with:

```
gh api 'repos/{owner}/{repo}/issues/{n}/comments?per_page=100' \
  --jq '[.[] | select(.user.login == "mrbonha" and (.body | startswith("<!-- autopilot:dependabot-triage -->")))] | length'
```

For each untriaged PR:
1. Read the changelog or release notes for each bump and flag breaking changes.
2. **Drift scan.** Find every other place the bumped runtime or package is pinned:
   Dockerfile `FROM`, CI `setup-python`/`setup-node` versions and matrices,
   `requires-python` or `engines`, `.python-version`, `.nvmrc`, `.tool-versions`,
   ruff, mypy and tsconfig targets, Helm and compose image tags, and the docs. Also
   find companion packages that must move with it (vitest with `@vitest/coverage-v8`).
   An image moving to Python 3.13 while CI and `requires-python` stay on 3.12 is drift.
   Fold any other open Dependabot PR for the same package or runtime into this one,
   then close it with a comment linking this PR.
3. **Align on the PR.** Push the alignment, and any fix for a breakage (the smallest
   change that keeps the upgrade), as normal commits to Dependabot's branch. Never
   force-push it. When `main` moves, merge `main` into the branch; never rebase it.
4. **Regression checks.** Run verify, then wait for `ci-status` to be green on the new
   head. Anything the cloud can't check, such as a docker build or a deploy, is listed
   as "not checked", never as passing.
5. Comment the triage (`gh api repos/{owner}/{repo}/issues/{n}/comments -f body=…`). The
   **first line is exactly** `<!-- autopilot:dependabot-triage -->`, the second
   `Head: <sha>` (the PR's head commit you checked). Then give the verdict (`merge` or
   `needs-owner`), the packages bumped, the security alerts or tickets it fixes, the
   breaking changes, and a **What all changed** table (file, old → new, why) of every
   commit you pushed, or "nothing". End with the checks that ran and their results, and
   the ones not checked.
6. Merge it yourself, under the builder's merge rules (`.claude/autopilot/builder.md`,
   step 6, auto-merge included, except that you never rebase it: step 3), only if all
   of these hold:
   - it's a **patch or minor** bump;
   - the drift scan found nothing and you pushed no commits to it;
   - verify passes;
   - it has a fresh green, or auto-merge waits for one (policy, **Always**; an
     update-branch merge of `main` is not a pushed commit);
   - no breaking changes were found.

   Otherwise label it `needs-owner` with the reason. **Any PR autopilot pushed
   commits to, a breakage fix or an alignment, is `needs-owner`** and never
   auto-merged, even when every check passes. If the verdict is `merge` but
   `ci-status` is still pending and auto-merge is off, leave it open for a later sweep.
