<!-- Vendored from bonham-ops, policy v3. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: dependabot role

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

## Dependabot

Run it as a sweep, one PR at a time: first every open Dependabot PR that fixes an open
Dependabot alert, then the rest, oldest first within each group. A PR fixes an alert
when it bumps the alert's package to at least the alert's first patched version; read
the alerts with
`gh api 'repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100'`.
If that answers 403 or 404, as it does in cloud runs today, use the steward's open scan
tickets instead: a PR that bumps a ticket's package to at least its fixed version
fixes it. Find them with
`project = ESCSUITE AND labels = ap-security AND statusCategory != Done`. The PRs
the latest digest's **Security scan** line lists as "fixed by PR #<n>" are security
updates too.

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
   verdict (`merge` or `needs-owner`), the packages bumped, the security alerts or
   tickets it fixes, the breaking changes, your fixes, and the verify result.
4. Merge it yourself, under the builder's merge rules (`.claude/autopilot/builder.md`,
   step 6), only if all of these hold:
   - it's a **patch or minor** bump;
   - verify passes;
   - `ci-status` is green;
   - no breaking changes were found.

   Otherwise label it `needs-owner` with the reason. If the verdict is `merge` but
   `ci-status` is still pending, leave it open for a later sweep.
