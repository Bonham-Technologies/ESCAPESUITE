<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Analytics
- Vercel Analytics via `@vercel/analytics`, **in the hosted build only**. The standalone
  build ships no analytics runtime at all: `BUILD_MODE === 'saas'` gates both `trackEvent()`
  and the `<Analytics />` mount in `packages/shared`, and because `BUILD_MODE` folds to a
  literal at build time the bundler drops `@vercel/analytics` from the offline bundle
  rather than shipping it inert. See the root `CLAUDE.md`'s "Vercel Analytics"
- `<Analytics />` is mounted by `bootstrapApp()`, not by `src/main.tsx` directly
- Custom events in `src/utils/analytics.ts`:
  - `Video Imported` (with type: video/image/audio) — `VideoUploader.tsx`'s `handleFiles`, after
    `addSourceVideo` succeeds for that file; not reported when processing throws (ESCSUITE-31).
    Counts a user-initiated import only — a file dropped or picked in the media library — so
    the CRAFT handoff, a project load and a session restore all stay silent: none of them is
    an import
  - `Project Created`
  - `Project Saved`
  - `Export Started` (with format)
  - `Export Completed` (with format and duration)

  `Overlay Added` was declared and unit-tested but never called from any overlay-adding action,
  so it was deleted along with its test rather than wired (ESCSUITE-31) — adding an overlay is
  not judged a critical-enough path to instrument, unlike an import or a delete.
