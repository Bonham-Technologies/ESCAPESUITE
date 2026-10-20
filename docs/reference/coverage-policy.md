<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Coverage policy

Each package (`apps/plan`, `apps/craft`, `apps/artist`, `packages/shared`,
`services/headless-artist`) enforces its own v8 coverage thresholds via
`test.coverage.thresholds` in its vitest/vite config (lines, statements, branches,
functions). `pnpm test:coverage` (`turbo test:coverage`) runs `vitest run --coverage`
in every package and fails the whole run if any package drops below its floor.

Every re-measurement since 2026-09-10 is logged in [`coverage-history.md`](coverage-history.md); append new ones there.

Each package's floors are these numbers rounded down to a whole percent, so the floor is
never above what the suite actually achieves:

| Package | Lines | Statements | Branches | Functions |
|---------|-------|------------|----------|-----------|
| `@escapesuite/plan` | 100.00 | 100.00 | 100.00 | 100.00 |
| `@escapesuite/craft` | 100.00 | 99.59 | 98.02 | 100.00 |
| `@escapesuite/artist` | 99.85 | 99.47 | 96.91 | 99.78 |
| `@escapesuite/shared` | 100.00 | 98.68 | 92.20 | 100.00 |
| `@escapesuite/headless-artist` | 99.60 | 99.53 | 98.66 | 98.87 |

- **Thresholds only go up.** A package's floors are its achieved coverage, rounded down
  to a whole percent — so any real regression turns the build red rather than being
  absorbed by slack. Raise them when coverage improves (update the `thresholds` block in
  that package's config, and the matching entry in `scripts/coverage-report.mjs`); never
  lower one to make a red build pass — fix the coverage gap, or, if a threshold is
  measurably wrong (e.g. it was set from a bad measurement), say so explicitly in the PR
  description instead of quietly loosening it. On the small denominators — shared,
  headless-artist and plan each measure a few hundred branches, not thousands — a
  whole-percent floor leaves essentially no headroom, so a single new untested branch
  turns CI red there. That is by design: the fix is to test the branch, not to lower the
  floor.
- **Every `src` file counts.** Each config sets `coverage.include: ['src/**/*.{ts,tsx}']`
  so a file the test suite never imports still appears in the report at 0%, instead of
  being silently omitted from the denominator. Beyond `src/test/**`, `.d.ts` and config
  files, craft and artist also exclude `**/types.ts` — those files are interfaces (erased
  at compile time) plus a handful of default data literals such as
  `DEFAULT_KEYFRAME_PANEL_STATE`, which have no branches of their own and are executed by
  every importer. Six files beyond that are excluded, each with a comment in its
  package's `coverage.exclude` naming the suite that does cover it: the bootstrap entry points
  `src/main.tsx` (plan/craft/artist) and artist's `src/headless/main.ts`, artist's
  `src/workers/decodeWorker.ts` (runs only inside a Web Worker; covered by
  `apps/e2e/tests/export/decode-worker.spec.ts` — its demux, decoder-configuration and
  frame-feeding logic live in `mp4Demux.ts`, `decoderConfig.ts` and `frameDecoder.ts`, which are
  measured), and `services/headless-artist`'s `src/renderDriver.ts` (needs real
  Chromium; covered by `src/renderDriver.chromium.test.ts`, which `test:coverage` does not
  run).
- **Reading the report**: after `pnpm test:coverage`, run `pnpm coverage:report`
  (`node scripts/coverage-report.mjs`) for a table of every package's actual coverage
  next to its configured floor (`actual% / threshold%`, with `!` marking a value
  below its floor). It reads each package's `coverage/coverage-summary.json` (the
  `json-summary` reporter) and never throws — vitest itself is what enforces
  thresholds and fails the build; the report is a human-readable summary, printed in
  CI as the "Coverage summary" step (`if: always()`) right after the coverage run so
  it still prints when a threshold fails.
- **Adding test doubles**: prefer `vi.fn()`/`vi.mock()` over hand-rolled fakes;
  fake-indexeddb is already wired up for storage tests (see `src/test/setup.ts` in
  each app). A file whose only realistic coverage comes from a Playwright/Chromium
  suite that isn't part of `test:coverage` (e.g. `services/headless-artist`'s
  `*.chromium.test.ts` files) can be excluded from a package's `coverage.exclude`
  list — comment the exclusion with which suite actually covers it, the way
  `services/headless-artist/vitest.config.ts` documents `src/renderDriver.ts`.
