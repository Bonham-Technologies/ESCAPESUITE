# Contributing to ESCAPE Suite

Thanks for helping! ESCAPE Suite is an MIT-licensed Turborepo monorepo (pnpm).

## Setup

```bash
pnpm install
pnpm dev        # all apps: plan :5173, craft :5174, artist :5175
```

## Before you open a PR

```bash
pnpm lint && pnpm test && pnpm build
pnpm test:e2e   # Playwright (Chromium); needs `pnpm build` first
```

- Keep PRs focused; follow the existing code style (ESLint enforces most of it).
- Add or update tests for behavior changes.
- Conventional-commit style titles (`feat:`, `fix:`, `chore:`…) are appreciated.

## Notes

- Everything runs client-side — no backend, no accounts, no uploads.
- Video export uses WebCodecs (Chrome/Edge only); recording works in all
  modern browsers.
