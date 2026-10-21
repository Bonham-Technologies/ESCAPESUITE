<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Analytics
- Vercel Analytics via `@vercel/analytics`, **in the hosted build only**. The standalone
  build ships no analytics runtime at all: `BUILD_MODE === 'saas'` gates both `trackEvent()`
  and the `<Analytics />` mount in `packages/shared`, and since `BUILD_MODE` folds to a
  literal at build time the bundler drops `@vercel/analytics` from the offline bundle
  instead of shipping it inert. `apps/e2e/tests/standalone/craft.spec.ts` holds it: it
  records a real take — so `Recording Started` and `Recording Completed` genuinely reach
  `trackEvent()` — and then asserts no `window.va`, no queue and no injected script
- `<Analytics />` is mounted by `bootstrapApp()`, not by `src/main.tsx` directly
- Custom events in `src/utils/analytics.ts`:
  - `Recording Started`
  - `Recording Completed` (with duration)
  - `Recording Sent to Editor`
  - `Recording Downloaded`
  - `Recording Deleted` — `useRecordingLibrary`'s `handleDeleteRecording`, once per row the user
    deleted (the primary, or a companion deleted on its own), regardless of how many companions
    the cascade took with it; not reported when the deletion itself fails (ESCSUITE-31)
