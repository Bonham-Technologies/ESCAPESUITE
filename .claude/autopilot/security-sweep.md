<!-- Vendored from bonham-ops, policy v1. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: steward's security sweep

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

### Security sweep

Every run, check the repository for vulnerable dependencies and leaked secrets. There are
two sources: GitHub's alerts when they answer, and a scan the steward runs itself.

**1. GitHub's alerts.** Read them first:

```
gh api 'repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100'
gh api 'repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=100'
gh api 'repos/{owner}/{repo}/secret-scanning/alerts?state=open&per_page=100'
```

- **200:** use that call's alerts as **Security tickets** describes.
- **403 or 404** means **not available**, not a failure. The message is "Resource not
  accessible by integration", or that the feature "must be enabled" or is "disabled".
  Note it once in the digest.
- **Any other answer:** say exactly what failed in the digest.

Today the Claude GitHub App has no permission to read any of the three, so cloud runs
get 403 on every one. That is expected.

**2. The self-run scan.** Run it for each source that isn't available:
- **osv-scanner** stands in for the Dependabot alerts;
- **gitleaks** stands in for secret scanning;
- code scanning has no stand-in. Leave it "not available".

**Install** both tools once per run, into `/tmp/autopilot-scan`, never into the repo. Use the pinned releases, and check each download twice: against the release's
checksums file, and against the digest pinned in the command. If the command exits
non-zero, run no scanner, and report the failure in the digest. Never run an
unverified binary.

```
OSV=2.6.0 GL=8.30.1 SCAN=/tmp/autopilot-scan
rm -rf "$SCAN" && mkdir -p "$SCAN"
case "$(uname -m)" in
  x86_64) A=amd64 G=x64
    OSV_SHA=ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108
    GL_SHA=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  aarch64|arm64) A=arm64 G=arm64
    OSV_SHA=2c71403eb443d05891c4f268c3ad771cf4f16e5443463fd7851ef8f454d3c7e4
    GL_SHA=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
esac
O="osv-scanner_linux_$A" T="gitleaks_${GL}_linux_$G.tar.gz"
( cd "$SCAN" &&
curl -fsSLO "https://github.com/google/osv-scanner/releases/download/v$OSV/$O" &&
curl -fsSLO "https://github.com/google/osv-scanner/releases/download/v$OSV/osv-scanner_SHA256SUMS" &&
curl -fsSLO "https://github.com/gitleaks/gitleaks/releases/download/v$GL/$T" &&
curl -fsSLO "https://github.com/gitleaks/gitleaks/releases/download/v$GL/gitleaks_${GL}_checksums.txt" &&
grep " $O\$" osv-scanner_SHA256SUMS | sha256sum -c - &&
grep " $T\$" "gitleaks_${GL}_checksums.txt" | sha256sum -c - &&
echo "$OSV_SHA  $O" | sha256sum -c - && echo "$GL_SHA  $T" | sha256sum -c - &&
tar -xzf "$T" gitleaks && mv "$O" osv-scanner && chmod +x osv-scanner gitleaks &&
./osv-scanner --version && ./gitleaks version )
```

Then compare each tool's latest release with the pin:
- `gh api repos/google/osv-scanner/releases/latest --jq .tag_name`;
- the same for `gitleaks/gitleaks`.

If either is newer, say so in the digest. Bumping a pin is a bonham-ops change, never
one a run makes. Run every scanner from the repo root. Each shell command starts a fresh
shell, so set `SCAN=/tmp/autopilot-scan` again in every later command that uses
`$SCAN`.

**Dependency vulnerabilities.**

```
"$SCAN/osv-scanner" scan source -r --no-resolve --format json --output-file "$SCAN/osv.json" .
```

- **Exit codes:** 0 means none found, 1 means vulnerabilities found, and 128 means no
  lockfile was found. Any other exit code is a failed scan.
- **Keep `--no-resolve`.** Without it, osv-scanner resolves a manifest's dependencies
  itself and can pick versions far older than the ones that get installed. In one test
  it chose aiohttp 3.9.5 where pip installs 3.14.5, and that produced dozens of false
  findings.
- **Lockfiles covered:** stderr lists each one, as "Scanned <file> file and found <n>
  packages". Compare those with the repo's lockfiles from `git ls-files`.
  osv-scanner reads these, among others:
  - `package-lock.json`, `pnpm-lock.yaml` and `yarn.lock`;
  - `uv.lock` and `poetry.lock`;
  - `Cargo.lock` and `go.sum`.

  It doesn't fully cover the following, so cover them another way:
  - **`requirements.txt`** lists only the direct dependencies, often as ranges. With
    `--no-resolve`, osv-scanner checks just the lines pinned with `==`. Resolve each
    one first:
    `uv pip compile <file> -q --no-header -o "$SCAN/pinned/<n>/requirements.txt"`.
    Then scan the result with `-L <that path>`, and report what it finds against the
    original file. If `uv` is missing, run `uvx pip-audit -r <file> --format json`.
  - **`deno.lock`.** osv-scanner 2.6 can't parse it. In the lockfile's directory, run
    `NO_COLOR=1 deno audit --lock deno.lock` (Deno 2.6 or later). Exit code 1 means
    it found vulnerabilities. Each finding gives a GHSA id, a severity ("moderate" is
    medium), the package and the vulnerable range; the range's upper bound is the
    fixed version. It covers `npm:` packages only. `jsr:` and remote imports
    have no advisory database, so list them as uncovered.
  - **Any other lockfile:** use that ecosystem's own audit, such as `npm audit --json`.

  Anything still uncovered goes in the digest by name.
- **Reading the JSON:**
  - `results[].packages[]` lists each vulnerable package: `package.name`, `.version`
    and `.ecosystem`.
  - Each package has `groups[]`, one per advisory. A group has `ids` (the OSV id and its
    aliases) and `max_severity`, a CVSS score.
  - The package's `vulnerabilities[]` hold the full records.
- **Advisory id:** the group's GHSA id if it has one; otherwise its first id, such as
  `PYSEC-…` or `RUSTSEC-…`.
- **Severity:** from `max_severity`:

  | Score | Severity |
  |---|---|
  | 9.0 and above | critical |
  | 7.0 to 8.9 | high |
  | 4.0 to 6.9 | medium |
  | below 4.0 | low |

  If there's no score, use the GHSA record's `database_specific.severity` (`MODERATE` is
  medium), and failing that, low.
- **Fixed version:** the record's `affected[].ranges[].events[].fixed` for this package.
  Take the lowest fixed version above the installed one. Prefer one in the installed
  major version.

**Leaked secrets.** Run every gitleaks command with these flags:

```
--redact --no-banner --exit-code 0 --report-format json --report-path "$SCAN/<name>.json"
```

`--redact` keeps secret values out of the report. Gitleaks reads a repo
`.gitleaks.toml` and `.gitleaksignore` from the directory it runs in; both are respected.

- **History since the last run.** The last digest's **Security scan** line records the
  commit scanned up to, `main@<sha>`. Record this run's `HEAD` there only when the
  history scan succeeded and every real finding from it has a ticket. If the scan
  failed, or the ticket cap stopped filing, repeat the previous sha (or "none"), so the
  next run scans those commits again; deduplication keeps it from filing twice.
  1. If `git rev-parse --is-shallow-repository` prints `true`, run
     `git fetch --unshallow` first.
  2. If `git merge-base --is-ancestor <sha> HEAD` succeeds, scan the new commits:
     `"$SCAN/gitleaks" git . --log-opts="<sha>..HEAD" <flags>`.
  3. Otherwise, scan the full history once: `"$SCAN/gitleaks" git . <flags>`. This
     applies on the first run, when no digest has the line, and when the sha is
     missing. Say in the digest which scan ran.

  Check the ancestor first: gitleaks still exits 0, with an empty report, when given a
  range it can't read. Treat any `ERR` line on its stderr as a failed scan.
- **Working tree:** `"$SCAN/gitleaks" dir . <flags>`.
- **The fingerprint** identifies a finding.
  - A history finding's `Fingerprint` is `<commit>:<file>:<rule>:<line>`. It never
    changes.
  - A working-tree finding's fingerprint is `<file>:<rule>:<line>`, and it moves
    whenever lines above it shift. Convert it with
    `git blame -L <line>,<line> --porcelain -- <file> | grep -v $'^\t'`. The `grep`
    drops the line's content, which is the secret. The first output line starts
    with the commit and the original line number; the `filename` line gives the
    original path. Put those together as `<commit>:<file>:<rule>:<line>`, the same
    fingerprint a history scan reports.
  - Skip a working-tree finding in a file git doesn't track
    (`git ls-files --error-unmatch <file>` fails), such as installed dependencies.
  - Skip a finding whose fingerprint is listed in `.gitleaksignore`. Gitleaks does this
    itself for a history scan, but a working-tree scan doesn't recognise history
    fingerprints, so check the converted one yourself.
  - A history finding and a converted working-tree finding with the same fingerprint
    are one finding. Merge them before filing.
- **Fakes:** judge each finding from its path, its rule, the redacted `Match` and the
  lines around it (`sed -n '<l-3>,<l-1>p;<l+1>,<l+3>p' <file>`). Never print the
  finding's own line: it holds the value. These are false positives, not leaks:
  - a test fixture for a scanner;
  - a documented dummy key or a placeholder;
  - a match that is plainly not a credential, such as an identifier.

  Put them all in one P3 `ap-owner-merge` ticket, "Allowlist gitleaks false
  positives". It lists each fingerprint and why it's fake, never a value, so the owner
  can confirm before the builder adds them to `.gitleaksignore`. Search Jira for an
  open one first, and add only the fingerprints it doesn't already list. A fingerprint
  that a Done allowlist ticket lists but `.gitleaksignore` lacks was rejected by the
  owner: treat it as real. When unsure, treat the finding as real.

### Security tickets

Security tickets are filed before any other finding and count toward the 25-ticket cap.
Every security ticket also gets the Jira label `ap-security`, next to its class label.

**The owner can ignore one:** a ticket closed with the Jira label `ap-ignore` is never
reopened and never filed again. The digest counts those advisories as "ignored".

1. **An open Dependabot PR already fixes it:** file nothing. A PR fixes an alert or an
   advisory when it bumps the package to at least the first patched (fixed) version.
   The **Dependabot** sweep handles it. List each one in the digest's **Security scan**
   line as "fixed by PR #<n>: <advisory id>".
2. **Alerts from the API.** File one ticket per alert. Dependabot and code-scanning
   alerts are numbered separately, so the summary carries both the source and the
   number:
   - `[security] dependabot #<n>: <GHSA id> in <package>`;
   - `[security] code-scanning #<n>: <rule> in <file>`.

   Search Jira first, Done tickets included:
   `project = ESCSUITE AND summary ~ "\"dependabot #<n>\""`.
   - If an open ticket exists, leave it.
   - If a Done ticket exists but the alert is still open, move it back to To Do with a
     comment saying so.

   **Priority:** critical and high are P1, medium P2, low P3. The severity is
   `security_advisory.severity` on a Dependabot alert and
   `rule.security_severity_level` on a code-scanning alert.

   **Class:** `ap-auto` if the fix is a patch or minor bump or a code change;
   `ap-owner-merge` if it needs a major bump or removing the package. The class rules
   in `.claude/rules/autopilot.md` still apply, so a code change to authentication,
   say, is `ap-owner-merge`.

   **No patched version exists:** file it `ap-watch` instead. Link
   `https://github.com/advisories/<GHSA id>`. The trigger is "a patched version is
   released" (`gh api advisories/<GHSA id>` shows it), and the follow-up is the bump.
3. **Vulnerabilities from the scan.** File one ticket per advisory per package, summary
   `[security] <advisory id> in <package>`. Merge every lockfile it appears in into
   that one ticket.
   - **Search first,** Done tickets included, for each of the group's ids in turn,
     since an advisory can gain a GHSA alias later:
     `project = ESCSUITE AND summary ~ "\"<advisory id>\""`. A match on the same
     package is that ticket, even one filed from a Dependabot alert.
     - Leave an open one.
     - Reopen a Done one as in step 2, except one labelled `ap-ignore`, or an
       `ap-watch` ticket. A Done `ap-watch` ticket has fired: its linked follow-up is
       the ticket for this advisory, so reopen that one instead if it is Done.
   - **The ticket names:**
     - each lockfile and the installed version;
     - the fixed version;
     - the severity and its source;
     - `https://osv.dev/vulnerability/<advisory id>`.
   - **Priority** follows the severity, as in step 2.
   - **Class:** `ap-auto` when the fixed version is a patch or minor bump;
     `ap-owner-merge` when it is a major bump, or the fix is removing the package.
   - **No fixed version exists:** file it `ap-watch` instead. Link the osv.dev page.
     The trigger is "a fixed version is released", and the follow-up is the bump.
   - **No longer reported:** if a successful scan of a lockfile no longer reports an
     advisory that an open scan ticket names for it, or the lockfile no longer exists,
     comment that on the ticket and move it to Done once no lockfile it names still
     reports it. A merged Dependabot PR usually does this. Never apply this to secret
     tickets.
4. **Secrets, from the API or the scan,** are P1 `ap-owner-merge`.
   - **Summary:** `[security] secret-scanning #<n>: <secret type>` for an alert, or
     `[security] gitleaks <fingerprint>` for a scan finding.
   - **Search first:** for a scan finding, search the summary for its commit sha. A
     ticket with the same fingerprint is the same finding, so handle it as in step 2.
   - **The ticket** starts with "Rotate this secret". The owner must rotate it, so that
     comes first. It names:
     - the file and line;
     - the commit;
     - the gitleaks rule or the alert's secret type.

     Removing the value from the tree isn't enough: the commit keeps it. The
     acceptance criteria are:
     1. the owner has rotated the secret;
     2. the value is gone from the tree;
     3. the fingerprint is in `.gitleaksignore`.
   - **Never copy the secret's value** into Jira, a PR or a comment.
