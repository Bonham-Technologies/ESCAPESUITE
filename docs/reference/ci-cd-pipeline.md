<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

Eight jobs, with `ci-status` as the single required check. The benchmarks live in a separate workflow, `perf.yml`, which is informational and was never one of its dependencies:

| Job | Purpose | Runs On |
|-----|---------|---------|
| `lint-and-typecheck` | Security audit + ESLint + TypeScript (shared, plan, craft, artist, headless-artist, e2e) | PRs and pushes |
| `test` | Unit tests with coverage | PRs and pushes |
| `build` | Production builds, bundle size report, packs + uploads the headless-artist kit | PRs and pushes |
| `kit-docker` | Builds the reference headless-artist Docker image and smoke-tests it (a real `docker run` render + `--version`) | PRs and pushes (skipped for Dependabot) |
| `standalone` | Offline single-file builds + standalone E2E, then the combined `dist/` build + production-layout (single-origin) E2E | PRs and pushes (E2E halves skipped for Dependabot) |
| `e2e` | Full Playwright suite (journey included) + headless-artist Chromium tests | PRs and pushes (skipped for Dependabot) |
| `deploy` | Vercel deployment | After E2E passes (skipped for Dependabot) |
| `ci-status` | Summary/gate job | All PRs |

The `pnpm perf` benchmarks run from `.github/workflows/perf.yml` instead: pushes to `main`/`dev`, PRs labelled `perf`, and `workflow_dispatch`; informational only, never gates, skipped for Dependabot.

**CI Optimizations:**
- Concurrency control cancels in-progress runs when new commits are pushed
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
- Weekly updates for all apps
- Grouped PRs: React, testing, linting
- GitHub Actions version updates
