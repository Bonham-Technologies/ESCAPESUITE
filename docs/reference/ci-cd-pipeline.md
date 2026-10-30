<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

Eight jobs, with `ci-status` as the single required check. The benchmarks live in a separate workflow, `perf.yml`, which is informational and was never one of its dependencies:

| Job | Purpose | Runs On |
|-----|---------|---------|
| `lint-and-typecheck` | Security audit + ESLint + TypeScript (shared, plan, craft, artist, headless-artist, e2e) | PRs and pushes |
| `test` | Unit tests with coverage | PRs and pushes |
| `build` | Production builds, bundle size report, packs + uploads the headless-artist kit | PRs and pushes |
| `kit-docker` | Builds the reference headless-artist Docker image and smoke-tests it (a real `docker run` render + `--version`) | PRs and pushes |
| `standalone` | Offline single-file builds + standalone E2E, then the combined `dist/` build + production-layout (single-origin) E2E | PRs and pushes |
| `e2e` | Full Playwright suite (journey included) + headless-artist Chromium tests; lists pass-on-retry tests (see below) | PRs and pushes |
| `deploy` | Vercel deployment | After E2E passes (skipped for Dependabot: its PRs get no secrets) |
| `ci-status` | Summary/gate job | All PRs |

The `pnpm perf` benchmarks run from `.github/workflows/perf.yml` instead: pushes to `main`/`dev`, PRs labelled `perf`, and `workflow_dispatch`; informational only, never gates, skipped for Dependabot.

The nightly (`.github/workflows/nightly.yml`, ESCSUITE-353) is a third workflow, also outside `ci-status`:

| Workflow / job | Purpose | Runs On |
|-----|---------|---------|
| `nightly.yml` / `nightly` | Full e2e in Chromium, Firefox and WebKit + the soak at 200 cycles / 30 reloads + the timeline property tests at 5,000 runs | 11:00 UTC daily (`schedule`, on `main`) and `workflow_dispatch` |

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
  version (1.64.1) as `apps/e2e`, so its Chromium tests share that cache
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

**Dependabot** (`.github/dependabot.yml`):
- Dependabot PRs run every job except `deploy`, browser suites included: `e2e`, `kit-docker`
  and both E2E halves of `standalone` (ESCSUITE-337). Autopilot merges a patch/minor bump on a
  green `ci-status`, and #913 (`@axe-core/playwright`) once merged green without a browser run
  and turned main's e2e red. `deploy` alone stays skipped, because Dependabot PRs get no
  `VERCEL_TOKEN`.
- Weekly updates for all apps
- Grouped PRs: React, testing, linting
- GitHub Actions version updates
