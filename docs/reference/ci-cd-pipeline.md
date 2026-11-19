<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

Nine jobs, with `ci-status` as the single required check. The benchmarks live in a separate workflow, `perf.yml`, which is informational and was never one of its dependencies:

| Job | Purpose | Runs On |
|-----|---------|---------|
| `lint-and-typecheck` | Security audit + ESLint (`--max-warnings 0`: a warning fails it, ESCSUITE-346) + TypeScript (shared, plan, craft, artist, headless-artist, e2e) | PRs and pushes |
| `test` | Unit tests with coverage | PRs and pushes |
| `build` | Production builds, bundle size report, packs + uploads the headless-artist kit | PRs and pushes |
| `kit-docker` | Builds the reference headless-artist Docker image and smoke-tests it (a real `docker run` render + `--version`) | PRs and pushes |
| `standalone` | Offline single-file builds + standalone E2E, then the combined `dist/` build + production-layout (single-origin) E2E | PRs and pushes |
| `e2e` | Full Playwright suite (journey included) + headless-artist Chromium tests; lists pass-on-retry tests (see below) | PRs and pushes |
| `e2e-cross-browser` | The e2e specs a PR adds or changes, in Firefox and WebKit (plus the accessibility suite on a Playwright bump); a no-op success when there are none (see below, ESCSUITE-478) | PRs (no-op on pushes) |
| `deploy` | Vercel deployment | After E2E passes (skipped for Dependabot: its PRs get no secrets) |
| `ci-status` | Summary/gate job | All PRs |

**A skipped `ci-status` would pass the ruleset** (ESCSUITE-477). `main`'s ruleset requires a check
run named `ci-status` (strict), and GitHub counts a skipped check run as passing. `ci.yml` also
triggers on `pull_request_target`, only so the changesets "Version Packages" PR (opened with
`GITHUB_TOKEN`, so `pull_request` never fires for it) gets CI. On that event every job, `ci-status`
included, is skipped unless the actor is `github-actions[bot]` and the head is in this repository
(ESCSUITE-122), and a skipped job still reports a check run. Until ESCSUITE-477 that check run was
named `ci-status`, so on every other PR the gate was met seconds after a push, before the real
`pull_request` run reached `ci-status`; auto-merge merged Dependabot #1102 and #1104 that way while
their CI was still running.

- **The fix.** The `ci-status` job has a `name:` expression that mirrors its `if:`: it is
  `ci-status` when the job runs (push, `pull_request`, and the bot's `pull_request_target`) and
  something else otherwise. GitHub does not evaluate a skipped job's name expression; the check
  run carries the expression's raw text (probed on 2026-11-17 with a throwaway workflow: a skipped
  job reported `github.event_name == 'pull_request_target' && 'probe-real' || 'probe-skipped-if'`,
  while a running one reported its evaluated name). Either way the skipped check run is not named
  `ci-status`, so while the real run is in progress the required check is missing ("Expected")
  and blocks the merge. The job's key, its `if:`, its `needs:` and every check in its script are
  unchanged. The other jobs still report skipped check runs on `pull_request_target`
  (`lint-and-typecheck`, `test`, …); none is required.
- **How to see it on a PR.** The head commit's checks list one `ci-status`, from the
  `pull_request` run (pending until the jobs it needs finish), plus a skipped check with the long
  expression as its name. `gh api repos/{owner}/{repo}/commits/<sha>/check-runs?check_name=ci-status
  --jq '.check_runs[].conclusion'` must never print `skipped`.
- **Rejected alternatives.** Moving the `pull_request_target` path into its own workflow does not
  help by itself: the workflow starts for every PR (the trigger cannot filter by actor or head
  branch), and its skipped jobs report check runs under the same names. A reusable workflow
  (`workflow_call`) called from two thin entry workflows renames every check to
  `<caller job> / ci-status`, so the ruleset would need changing in step. Both duplicate or move
  ~800 lines; the name expression is one line.
- **Guarded by** `scripts/ci-status-required-check.test.mjs` (`pnpm test:scripts`): no job in any
  workflow may report a skipped check run named `ci-status`, and evaluating `ci-status`'s `if:` and
  name for push, `pull_request` and `pull_request_target` (owner, Dependabot, fork, the bot) must
  give `ci-status` exactly when the job runs. If you change the `if:`, change the name to match.

The `pnpm perf` benchmarks run from `.github/workflows/perf.yml` instead: pushes to `main`/`dev`, PRs labelled `perf`, and `workflow_dispatch`; informational only, never gates, skipped for Dependabot.

The nightly (`.github/workflows/nightly.yml`, ESCSUITE-353) is a third workflow, also outside `ci-status`:

| Workflow / job | Purpose | Runs On |
|-----|---------|---------|
| `nightly.yml` / `nightly` | Full e2e in Chromium, Firefox and WebKit + the soak at 200 cycles / 30 reloads + the timeline property tests at 5,000 runs | 11:00 UTC daily (`schedule`, on `main`) and `workflow_dispatch` |

The DCO check (`.github/workflows/dco.yml`, ESCSUITE-419) is a fourth workflow, also outside `ci-status`. Its job `DCO / sign-off` runs `node scripts/dco-check.mjs <base> <head>` on every PR from a fork and fails if a non-merge commit lacks a `Signed-off-by:` trailer matching its author email; commits by `[bot]` authors (Dependabot, the changesets bot) are exempt. PRs from branches in this repository skip the job (it shows as skipped): only people with write access can push here, so this matches the fleet's `members: false` DCO rule (ESCSUITE-424). It is informational until the owner adds it to `main`'s ruleset. Contributors' rules are in `CONTRIBUTING.md`.

**Nightly** (ESCSUITE-353):
- **What it runs**, one job, in order:
  1. The ESCSUITE-349 timeline property tests
     (`apps/artist/src/store/__tests__/timelineInvariants.property.test.ts`) with
     `ARTIST_FUZZ_RUNS=5000` and `ARTIST_FUZZ_SEED` = the run id mod 2³¹−1 (or the dispatch's
     `seed` input). The seed is printed by the "Pick property-test seed" step and by the test itself.
  2. Even if those fail: `pnpm test:e2e:browsers` (projects `chromium`, `chromium-strict`, `firefox`,
     `webkit`) with `CI=true`, `E2E_CROSS_BROWSER=1` (otherwise `playwright.config.ts` drops the
     Firefox/WebKit projects under `CI`), `E2E_NIGHTLY=1` (includes specs tagged `@nightly`, which
     every other run skips through `grepInvert`), and `SOAK_CYCLES=200` / `SOAK_RELOADS=30` for
     `tests/escapeartist/soak.spec.ts` (PR defaults 25 / 10). Per-browser gaps stay each spec's own
     `test.skip(browserName …, reason)`; the soaks are Chromium-only that way.
- **Audio sink** (ESCSUITE-389): before the e2e step, "Start a PulseAudio sink" installs
  PulseAudio and starts it with a silent sink. The runner has no sound device, and without one
  Firefox's AudioContext never leaves `suspended`, so CRAFT's recorder waits on `resume()` forever
  and every Firefox recording test times out at Start. The sink is `module-pipe-sink` with
  `use_system_clock_for_timing=yes` (ESCSUITE-396), not `module-null-sink`: on the null sink an
  unmuted `<video>` in Firefox stalls at `currentTime` 0 or crawls, so ARTIST's preview never
  plays. Headless Chromium falls back to a fake audio output when it finds no audio server,
  and stays off PulseAudio (ESCSUITE-389 found its `<video>` clock stalled on the null sink; the
  A/V fixture and soak specs failed). The e2e step sets
  `E2E_PULSE_NULL_SINK=1`, and `playwright.config.ts` then gives the Chromium projects an
  unreachable `PULSE_SERVER`. Locally, in a cloud container: `apt-get install -y pulseaudio &&
  pulseaudio --start && pactl load-module module-pipe-sink sink_name=pipe file=/tmp/pulse.fifo
  use_system_clock_for_timing=yes && pactl set-default-sink pipe` before running the `firefox`
  project; while PulseAudio is running, set
  `E2E_PULSE_NULL_SINK=1` for any Chromium run of this config (the other configs, such as
  av-drift, have no such switch, so stop PulseAudio with `pulseaudio --kill` before them).
- **Not in the nightly:** the responsive projects (`mobile-*`, `tablet-*`; the Chromium ones still
  run in every PR's `e2e` job) and the headless-artist Chromium tests (also in `ci.yml`'s `e2e`).
- **Setup** mirrors `ci.yml`'s `e2e` job (pnpm action pin, Node 24, pnpm cache, the capped and retried
  browser and apt installs), but installs Chromium, Firefox and WebKit under its own browser cache key
  (`playwright-all-…`), so it never fills `ci.yml`'s Chromium-only cache.
- **Output.** The job summary always gets the property-test seed with its replay command, and every
  e2e test that failed on all attempts (`apps/e2e/scripts/report-nightly.mjs`; tests:
  `report-nightly.test.mjs`, which also guards the workflow's key tokens), plus the usual flaky list
  (`report-flaky.mjs`). Artifacts: `nightly-playwright-report` (HTML report, 30 days),
  `nightly-e2e-flaky` (30 days), `nightly-test-results` (on failure, 7 days).
- **Gating.** Not part of `ci-status`; it never blocks a PR. Autopilot treats a red nightly on `main`
  as a red `main` (`.claude/rules/autopilot.local.md`, "Main must stay green, step 1").
- **Actions minutes.** About one 40–60 min job a day (PR e2e takes ~15 min for Chromium alone;
  Firefox and WebKit roughly add one suite each, and the longer soak ~15 min), so ~1,200–1,800
  Linux minutes a month. `timeout-minutes` is 120. This is an estimate: check it against the first
  `workflow_dispatch` run and update this line with the measured time.
- **Re-running with a given seed.** Actions → Nightly → "Run workflow" → `seed` = the seed from the
  failing run's summary, or `gh api -X POST repos/{owner}/{repo}/actions/workflows/nightly.yml/dispatches
  -f ref=main -f 'inputs[seed]=<seed>'`. "Re-run jobs" on the failing run reuses its run id and so
  its seed. Locally:
  `ARTIST_FUZZ_SEED=<seed> ARTIST_FUZZ_RUNS=5000 pnpm --filter=@escapesuite/artist exec vitest run src/store/__tests__/timelineInvariants.property.test.ts`.
  The soak at nightly size:
  `SOAK_CYCLES=200 SOAK_RELOADS=30 pnpm --filter=@escapesuite/e2e exec playwright test tests/escapeartist/soak.spec.ts --project=chromium-strict`.

**Changed specs in Firefox and WebKit** (`e2e-cross-browser`, ESCSUITE-478):
- **Why.** `e2e` runs Chromium only and the full Firefox/WebKit suite runs only in the Nightly,
  so a PR that added a regression spec passed `ci-status`, merged, and turned the next Nightly
  red in another browser (reverts #1078 and #1119, both WebKit; #1061, a Playwright bump whose
  Firefox crashed under axe, ESCSUITE-453).
- **What it runs.** On a pull request, "Pick changed specs" runs
  `node apps/e2e/scripts/changed-specs.mjs --base <PR base sha>` on the runner's own Node, before
  any install. It reads `git diff --name-status <base>...HEAD -- apps/e2e/tests/` and keeps every
  added, modified or renamed `*.spec.ts` under `apps/e2e/tests/`, except the folders
  `playwright.config.ts` ignores (`standalone/`, `production/`, `perf/`); deleted files and
  non-spec files are dropped. When the PR changes the `@playwright/test` or `playwright` line of
  any `package.json` (a Dependabot bump brings new Firefox and WebKit builds), it adds the
  accessibility suite: every spec in `tests/accessibility/` and every spec that runs axe
  (imports `utils/accessibility` or `@axe-core/playwright`), about 260 tests over both browsers.
  The job then runs `playwright test <specs> --project=firefox --project=webkit
  --pass-with-no-tests` from `apps/e2e` with `CI=true`, `E2E_CROSS_BROWSER=1` and
  `E2E_PULSE_NULL_SINK=1`: the Nightly's projects and retries (2), each spec's own
  `test.skip(browserName …)` honoured. `@nightly` tests stay out, as in every non-nightly run.
  The step summary lists each spec and why it runs.
- **No-op path.** With no spec to run (most PRs), or on a push (the Nightly covers `main`; the
  step skips the script there), "Pick changed specs" outputs `count=0` and every later step is
  skipped by its own `if:`, so the job succeeds in well under a minute and adds no browser
  time. It has no job-level `if:` on purpose: `ci-status` fails any need whose result is not `success`, so a skipped job would block every PR.
  Like every job, it hangs off `lint-and-typecheck` and `test` (not `build`; it starts its own dev
  servers), so it runs beside `e2e`.
- **Safety.** The spec list reaches the run step through `env` and is word-split there, so the
  script refuses (exits 1, failing the job) any spec path with characters other than
  `A-Z a-z 0-9 . _ - /`; it reads git's `-z` output so an odd name is checked as itself. The job
  runs the PR's code with a read-only token (`permissions: contents: read`), no secrets, and
  checks out with `persist-credentials: false`.
- **Setup** mirrors the Nightly: the capped and retried `playwright install firefox webkit` and
  `install-deps firefox webkit`, and the same PulseAudio pipe sink (see **Audio sink** above),
  without which Firefox recording tests time out at Start. Browser cache key
  `playwright-firefox-webkit-…`, restoring from the Nightly's `playwright-all-…` cache on a miss.
- **Output.** `e2e-cross-browser-flaky` (the `report-flaky.mjs` list; the steward's recipe reads
  `e2e-flaky` and is unaffected), `playwright-report-cross-browser` (30 days) and
  `test-results-cross-browser` (on failure, 7 days).
- **Cost.** One regression spec (16 tests over both browsers) took 81 s locally, dev-server start
  included; add about 2–3 min of setup on a runner. A Playwright bump's accessibility suite is
  an estimated 15–20 min. Replace these with measured CI times once runs exist.
- **Locally:** `node apps/e2e/scripts/changed-specs.mjs --base origin/main` prints the list;
  `CI=true E2E_CROSS_BROWSER=1 pnpm --filter=@escapesuite/e2e exec playwright test <specs>
  --project=firefox --project=webkit` runs it (start the PulseAudio sink first for Firefox).
  Tests: `apps/e2e/scripts/changed-specs.test.mjs` (`pnpm test:scripts`), which also checks the
  job's wiring in `ci.yml`.
- **Not covered:** a PR that changes only a helper in `apps/e2e/utils/`, `playwright.config.ts`
  or app code runs nothing here; the Nightly still catches those.

**CI Optimizations:**
- Concurrency control cancels in-progress runs when new commits are pushed to a PR or to
  `dev`. Pushes to `main` are grouped by commit SHA, so every merged commit runs to the end
  and gets its own `ci-status` verdict (ESCSUITE-382; before, a burst of merges cancelled
  all but the last run). Because main runs can now overlap, the `deploy` job runs
  production deploys one at a time (`deploy-production` group) and skips a commit that
  `main` has already moved past, so an older commit never replaces a newer one in
  production. `standalone-release.yml`'s `release` job applies the same check, so only
  main's head creates or re-marks the `latest` release. With three or more merges inside
  one run's length, GitHub keeps one running and one pending deploy, so a middle commit's
  deploy is cancelled: its `ci-status` is still a real verdict, but the run concludes
  `cancelled` and it gets no standalone release (the newer commit does). `Perf` still
  cancels superseded main runs; it is informational.
- Combined lint + type-check + audit saves ~30s of runner setup overhead
- `standalone` builds the offline bundles once, uploads the `standalone-builds`
  artifact (consumed cross-run by `standalone-release.yml`), then tests that
  same build. It then runs `pnpm build:deploy` and the production-layout suite —
  last, because that build overwrites `apps/*/dist` with the hosted bundles
- `build` also runs `pnpm --filter=@escapesuite/headless-artist run pack:kit` and
  uploads the tarball as the `headless-artist-kit` artifact (consumed cross-run
  by `standalone-release.yml`, same pattern as `standalone-builds`)
- Playwright browsers are cached across runs (~1min savings); `e2e` also runs on
  pushes to `main`, so the cache is written from the base branch and fresh PR
  branches can restore it. `services/headless-artist` pins the same Playwright
  version (1.65.0) as `apps/e2e`, so its Chromium tests share that cache
- Playwright browser download and apt system-deps are separate steps, each with
  `timeout-minutes: 8` and a plain-bash retry, so an apt stall fails fast
  instead of hanging the job

**E2E retries and flaky tests** (ESCSUITE-352):
- In CI, `apps/e2e/playwright.config.ts` retries a failing test twice. A test that fails and then
  passes counts as passed and `ci-status` stays green, so an intermittent regression could pass
  silently. Two things now stop that:
  - **Zero retries where flakiness is the bug.** The `chromium-strict` project runs
    `tests/journeys/**/*.spec.ts`, the ARTIST soaks (`tests/escapeartist/*soak.spec.ts`) and
    `tests/regressions/**/*.spec.ts` with `retries: 0` (and `trace`/`video: 'retain-on-failure'`,
    since `on-first-retry` never fires without a retry); the `chromium` project ignores those
    paths, so every spec still runs exactly once.
    These specs exist to catch intermittent breakage (a pass-on-retry in a regression spec *is* the
    regression), so a first-attempt failure there fails the job. Everything else keeps `retries: 2`.
    The step runs `playwright test` with no `--project`, so both projects (and the responsive ones)
    run; there is no sharding.
  - **Every pass-on-retry is reported.** In CI the config adds the JSON reporter
    (`apps/e2e/playwright-results.json`, beside the html and list reporters). The `Report flaky
    tests` step (`if: always()`) runs `apps/e2e/scripts/report-flaky.mjs`, which writes every test
    Playwright marked `flaky` to the job summary and to a `::warning` annotation titled
    "Flaky e2e test" (spec file, line and test title), and saves the list to `flaky.json`, uploaded
    as the **`e2e-flaky`** artifact (30 days). A clean run uploads an empty list, so a missing
    artifact means the step did not run. Tests: `apps/e2e/scripts/report-flaky.test.mjs`
    (`pnpm test:scripts`).
- **Reading the flaky list from the last 7 days of `main`** (the steward does this every sweep).
  Run it from inside the repo checkout: `gh api` fills `{owner}/{repo}` from the current
  repository. `--paginate` matters: `main` can have well over 100 CI push runs in a week.

  ```bash
  since=$(date -u -d '7 days ago' +%Y-%m-%d)
  for run in $(gh api --paginate "repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&created=>=$since&per_page=100" \
                 --jq '.workflow_runs[].id'); do
    url=$(gh api "repos/{owner}/{repo}/actions/runs/$run/artifacts?name=e2e-flaky" --jq '.artifacts[0].archive_download_url // empty')
    [ -n "$url" ] && gh api "$url" > "flaky-$run.zip" &&
      unzip -p "flaky-$run.zip" flaky.json | jq -c --arg run "$run" '.flaky[] + {run: $run}'
  done | jq -s 'group_by(.file + " › " + .title)
    | map({test: (.[0].file + " › " + .[0].title), runs: (map(.run) | unique | length)})
    | sort_by(-.runs)'
  ```

  `runs` counts distinct CI runs, not entries (one run can list a test once per project). Any
  test with `runs` above 1 is "flaky more than once" and gets a ticket. Without downloading, one run's annotations show the
  same thing: `gh api repos/{owner}/{repo}/check-runs/<e2e job id>/annotations --jq '.[] |
  select(.title == "Flaky e2e test") | .message'` (GitHub caps annotations per step, so the
  artifact is the complete list).
- **Reported annotations** (ESCSUITE-450). Some behaviour should be counted, not failed on: a
  spec records it with `watchConsoleForAnnotation(page, testInfo, { contains, type })`
  (`apps/e2e/utils/consoleAnnotation.ts`), which turns each matching console line into a test
  annotation. `report-flaky.mjs` lists every test, passed or not, carrying an annotation whose type
  is in its `REPORTED_ANNOTATION_TYPES`: one `::notice` titled `e2e annotation: <type>` each, an
  "E2E reported annotations" table in the job summary (only when there are any), and an `annotated`
  array (`file`, `line`, `title`, `project`, `status`, `retry`, `type`, `description`) in the same
  `flaky.json`, so the `e2e-flaky` and `nightly-e2e-flaky` artifacts carry it with no workflow
  change. Today the one reported type is `reload-fired`: journey `01-record-edit-export` records
  ARTIST's `… stopped completing seeks; reloaded it from …` warning (ESCSUITE-412's fallback), which
  ESCSUITE-417 counts. To read it from the last 10 nightlies (scheduled runs, so not the CI
  recipe above, which filters on `event=push`), one line per run:

  ```bash
  for run in $(gh api "repos/{owner}/{repo}/actions/workflows/nightly.yml/runs?branch=main&event=schedule&per_page=10" \
                 --jq '.workflow_runs[].id'); do
    url=$(gh api "repos/{owner}/{repo}/actions/runs/$run/artifacts?name=nightly-e2e-flaky" --jq '.artifacts[0].archive_download_url // empty')
    if [ -z "$url" ]; then echo "{\"run\":\"$run\",\"artifact\":false}"; continue; fi
    gh api "$url" > "nightly-flaky-$run.zip" &&
      unzip -p "nightly-flaky-$run.zip" flaky.json | jq -c --arg run "$run" \
        '{run: $run, reportMissing: (.reportMissing // false), reloads: [(.annotated // [])[] | select(.type == "reload-fired") | .description]}'
  done
  ```

  `reloads: []` on a run means the reload did not fire in it. A run with no artifact, or whose
  `flaky.json` says `reportMissing: true`, proves nothing either way, so count those separately.
  For `main`'s CI runs, use the recipe above with this `jq` after `unzip`:
  `'(.annotated // [])[] | select(.type == "reload-fired") + {run: $run}'`.

**Release** (`.github/workflows/release.yml`):
- A release is cut by adding a changeset and merging it to `main`. `changesets/action` (v2) then pushes a `changeset-release/main` branch with the version bump and opens the "Version Packages" PR itself (the org setting "Allow GitHub Actions to create and approve pull requests" is enabled for this repo). CI on that bot-authored PR is held as "action required" until someone approves it. Relaxing the repository's fork-PR approval policy (now `first_time_contributors_new_to_github`) did not change this, so the hold is enforced at the organisation level (Organization → Settings → Actions → General → "Fork pull request workflows from outside collaborators"; org admin only). Approve the run under Actions ("Approve and run") or with `gh api -X POST repos/Bonham-Technologies/ESCAPESUITE/actions/runs/<run-id>/approve`. Merging the PR tags each changed package and creates a per-package GitHub Release, with the craft/artist standalone HTML and the headless-artist kit tarball attached to their respective releases.
- Releases are named after the tag (`<pkg>@<version>`) and their body is that version's entry from the package's `CHANGELOG.md`, written by the action itself. The two failure modes differ: if a versioned package has a `CHANGELOG.md` but no entry for the new version, the action throws (`Could not find changelog entry for …`) and fails the job loudly; if the `CHANGELOG.md` is missing entirely, the action silently skips that package's release — a tag and nothing else — and it is the **attach job** that turns the run red: since ESCSUITE-83 it looks each released package's GitHub Release up by tag (`getReleaseByTag`, six attempts ten seconds apart, because the list endpoint did not always show a release published half a minute earlier and six per-package releases shipped with no asset on 2026-09-26) and calls `core.setFailed` naming every tag it could not find, rather than skipping the upload behind an `if (release)` and staying green.
- `changeset:publish` must stay `changeset git-tag`: the action discovers what to release solely from the `CHANGESETS_OUTPUT` NDJSON events that command writes, so swapping in a different publish script would leave the job green while creating no tags and no releases.
- `standalone-release.yml` additionally creates an umbrella `v<highest app version>` release — the
  higher of the `apps/craft` and `apps/artist` package versions — carrying the same standalone HTML
  and kit tarball assets. It is the higher of the two rather than ESCAPECRAFT's because an
  artist-only bump would otherwise reuse the existing tag, cut no release, and leave `latest`
  pointing at the previous ESCAPEARTIST build. The HTML assets are named for their own app
  (`ESCAPECRAFT-<craft version>.html`, `ESCAPEARTIST-<artist version>.html`, matching the names
  `release.yml` attaches to the per-package releases); the kit tarball carries the umbrella version.
- **GitHub's `/releases/latest` is reserved for the umbrella release** (ESCSUITE-195). Before this
  ticket, both this workflow's `gh release create` and `changesets/action`'s per-package ones let
  GitHub pick "latest" by creation time, so a kit-, shared- or plan-only publish (which cuts no
  umbrella release — see below) could leave `/releases/latest` pointing at a release with no
  offline build attached at all, for as long as it took the next craft/artist bump to land. Fixed
  two ways: a `mark-per-package-releases-not-latest` job in `release.yml` runs right after
  `changesets/action` and sets `make_latest: false` on every release that publish just created
  (craft, artist, shared, plan, headless-artist — whichever changesets bumped), via
  `updateRelease` rather than an option on the action itself, since `create-github-releases` has
  none; and this workflow's `gh release create` always passes `--latest`, with the skip path (the
  umbrella tag already exists because neither app bumped) now running
  `gh release edit "v${VERSION}" --latest` before exiting, so a kit-only release re-asserts the
  umbrella as latest rather than leaving it be. `make_latest: false` only moves the pointer off a
  release that is *becoming* not-latest, so it does nothing when the release it is marking is
  already GitHub's "latest" (observed 2026-10-04: `/releases/latest` named a shared-only release
  for ~25 minutes after the not-latest job succeeded) — `mark-per-package-releases-not-latest`
  therefore marks the current umbrella `vX.Y.Z` release latest itself, right after the
  per-package marking, so the pointer is never on a per-package release for longer than that job
  takes (ESCSUITE-218); `standalone-release.yml`'s own `--latest` above repeats it as the second
  line of defence.

**Standalone Release** (`.github/workflows/standalone-release.yml`):
- Runs after CI succeeds on `main` (and attaches preview builds as workflow artifacts for PRs)
- Builds ESCAPECRAFT and ESCAPEARTIST in standalone mode (`VITE_BUILD_MODE=standalone`)
- Also downloads the `headless-artist-kit` artifact from the same CI run and renames the
  tarball to `escapesuite-headless-artist-<VERSION>.tgz` (VERSION here is the umbrella release's
  own version — the higher of the craft and artist versions — not the kit package's own
  independent version)
- On `main`, creates a GitHub Release and attaches the single-file HTML builds — each named
  for its own app's version — and the headless-artist kit tarball directly to it
- No cloud storage step and no license injection — the downloads are plain HTML files (and one
  npm tarball), ready to run
- Alongside each versioned HTML build, also attaches `ESCAPECRAFT-latest.html` /
  `ESCAPEARTIST-latest.html` — the same build, under a name that never changes — so
  `.../releases/latest/download/ESCAPECRAFT-latest.html` is a stable URL across every release.
  ESCAPEPLAN's `apps/plan/src/lib/launch.ts` (`CRAFT_OFFLINE_BUILD_URL` /
  `ARTIST_OFFLINE_BUILD_URL`) points its per-app "Download ESCAPECRAFT" / "Download ESCAPEARTIST"
  CTAs at exactly those two URLs — which the `--latest` / `make_latest: false` split above keeps
  pinned to this release's own build — rather than GitHub's bare `/releases/latest` listing page,
  which is kept as the hero's secondary "All downloads" link instead (ESCSUITE-195).
- **Checksums and build provenance** (ESCSUITE-401). The `release` job's "Decide" step runs the
  stale-commit and already-exists guards and outputs `publish`; only when it is `true` does the
  job stage every asset in `release-assets/`, write `SHA256SUMS.txt` over all of them (the
  `-latest.html` aliases included), attest them all with
  `actions/attest-build-provenance` (pinned by commit SHA; `subject-path: release-assets/*`, so
  `SHA256SUMS.txt` is attested too), then `gh release create` with those files and a notes line
  pointing at `docs/VERIFY.md`. Only that job has `id-token: write` and `attestations: write`,
  and it never runs for a pull request. The `verify-release` job (needs `release`, runs only when
  it output `created=true`) checks out the commit and runs `scripts/verify-release-assets.sh`,
  which downloads the published release (retrying while GitHub catches up), fails unless
  `SHA256SUMS.txt` lists exactly the other assets, runs `sha256sum -c`, and runs
  `gh attestation verify --signer-workflow .../standalone-release.yml` on every asset.
  `release.yml`'s `upload-standalone` job does the same for the per-package releases: one
  `SHA256SUMS.txt` per release, an attestation over every build and sums file, the notes line
  appended to the changelog body, and a final step that runs the same script for each release it
  attached to (`--signer-workflow .../release.yml`). Tests: `scripts/verify-release-assets.test.mjs`
  (the script, against a fake `gh`) and `scripts/release-verification.test.mjs` (the workflow
  wiring), both in `pnpm test:scripts`. Releases up to v2.18.27 predate this and carry neither.
- **SBOMs** (ESCSUITE-430). Every build ships with an SPDX 2.3 SBOM, `<build name>.spdx.json`,
  written by `scripts/generate-sbom.mjs` from `pnpm --filter <pkg> list --prod --depth Infinity`:
  the production dependency tree only, workspace packages included, no dev dependencies.
  Optional dependencies, which pnpm lists under a separate `optionalDependencies` key at every
  level, are walked too and recorded as `OPTIONAL_DEPENDENCY_OF`. The kit's SBOM covers
  `@escapesuite/headless-artist` (Playwright, plus the optional `@aws-sdk/client-s3` tree a plain
  `npm install` of the kit pulls in) and `@escapesuite/artist`, because its `headless.html`
  inlines the ARTIST render bundle. In `standalone-release.yml` the `prepare` job
  generates them (pnpm setup and `pnpm install --frozen-lockfile --ignore-scripts`, only for a
  push to `main`, so no pull request's code runs there) into the `standalone-release` artifact;
  the `release` job stages them in `release-assets/` (so `SHA256SUMS.txt` and the provenance
  attestation cover them), attests each with `actions/attest-sbom` (pinned by commit SHA;
  `subject-path` the versioned build, `sbom-path` its SBOM) and attaches them. `release.yml`'s
  `upload-standalone` job writes them to `sboms/` after each build, lists build and SBOM in that
  release's `SHA256SUMS.txt`, attests the same way and uploads the SBOM with the build. Both
  release notes mention the SBOM. `scripts/verify-release-assets.sh` then requires every build
  but a `-latest.html` alias to have its `.spdx.json`, every `.spdx.json` to name a build, and
  `gh attestation verify --predicate-type https://spdx.dev/Document/v2.3` to pass for every
  build. Tests: `scripts/generate-sbom.test.mjs` (the document, and the real workspace's craft
  and kit trees) plus the two test files above. `docs/VERIFY.md` step 4 is the user's side.

**Dependabot** (`.github/dependabot.yml`):
- Dependabot PRs run every job except `deploy`, browser suites included: `e2e`, `kit-docker`
  and both E2E halves of `standalone` (ESCSUITE-337). Autopilot merges a patch/minor bump on a
  green `ci-status`, and #913 (`@axe-core/playwright`) once merged green without a browser run
  and turned main's e2e red. `deploy` alone stays skipped, because Dependabot PRs get no
  `VERCEL_TOKEN`.
- A bump of `@playwright/test` or `playwright` also runs the accessibility suite in Firefox and
  WebKit in `e2e-cross-browser` (ESCSUITE-478), since a new Playwright brings new builds of both.
- Weekly updates for all apps
- Grouped PRs: React, testing, linting
- GitHub Actions version updates
