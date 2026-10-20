<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Vercel Deployment

The monorepo deploys to Vercel with automatic preview deployments:

| Branch | Domain | Purpose |
|--------|--------|---------|
| `main` | escapesuite.io | Production |
| `dev` | escapesuite.dev | Development/staging |
| PRs | `*.vercel.app` | Preview deployments |

**Output Structure:**
```
dist/
├── index.html        # ESCAPEPLAN
├── 404.html          # SPA fallback
├── craft/index.html  # ESCAPECRAFT (single file)
└── artist/index.html # ESCAPEARTIST (single file)
```

`scripts/build-all.mjs` (`pnpm build:deploy`) refuses to publish: if `turbo build` left any of
ESCAPEPLAN, ESCAPECRAFT or ESCAPEARTIST with an empty or missing `dist`, it exits non-zero
naming the app instead of assembling and reporting success on a half-shaped `dist/`.
