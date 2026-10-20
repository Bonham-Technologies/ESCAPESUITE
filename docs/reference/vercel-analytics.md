<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Vercel Analytics

**Hosted (`saas`) builds only.** All three apps use `@vercel/analytics` for pageview and
custom event tracking:
- `<Analytics />` is mounted by `bootstrapApp()` (`packages/shared/src/bootstrap`) for
  ESCAPECRAFT and ESCAPEARTIST; ESCAPEPLAN still mounts it directly in its own `main.tsx`
- Custom events via `trackEvent()` in `*/analytics.ts` files, which re-export the shared
  `packages/shared/src/analytics` wrapper
- **A standalone build ships no analytics runtime at all.** `BUILD_MODE === 'saas'` gates
  both `trackEvent()` and the `<Analytics />` mount, and because `BUILD_MODE` folds to a
  literal at build time the bundler drops `@vercel/analytics` from the offline bundle
  rather than shipping it inert — `va.vercel-scripts.com` appears 0 times in the
  ESCAPECRAFT and ESCAPEARTIST standalone builds and once in the hosted one. Held at
  runtime by `apps/e2e/tests/standalone/craft.spec.ts` ("makes no requests off the local
  origin"), which records a real take and then asserts there is no `window.va`, no queue
  and no injected script
