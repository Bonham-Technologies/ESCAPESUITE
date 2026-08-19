# ESCAPESUITE Environment Setup Guide

ESCAPE Suite has no required environment variables and no external services to configure.
Everything runs client-side in the browser — there's no backend, no accounts, and no API keys
to obtain.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ LTS
- [pnpm](https://pnpm.io/) (see `packageManager` in the root `package.json` for the pinned version)

## Local Development

```bash
git clone https://github.com/Bonham-Technologies/ESCAPESUITE.git
cd ESCAPESUITE

pnpm install
pnpm dev            # all apps: plan :5173, craft :5174, artist :5175
```

No `.env.local` files are needed to run any app.

## Optional: `VITE_BUILD_MODE`

The only environment variable read anywhere in the repo is `VITE_BUILD_MODE`, which selects the
build target for ESCAPECRAFT and ESCAPEARTIST:

```bash
# Normal web build (default if unset)
pnpm build:craft
pnpm build:artist

# Offline single-file build (VITE_BUILD_MODE=standalone is set for you)
pnpm build:standalone
```

There is nothing else to configure.

## Deployment

`pnpm build:deploy` produces a static `dist/` directory that can be deployed to any static host
(Vercel, Netlify, GitHub Pages, S3, or a plain web server) — no environment variables required
there either. See the root [README](../README.md#self-hosting) for details.
