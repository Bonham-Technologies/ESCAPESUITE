# ESCAPEPLAN

Landing page and hub for the ESCAPE Suite - a collection of client-side media creation tools.

**Part of the [ESCAPESUITE monorepo](../../README.md)**

## Overview

ESCAPEPLAN is the landing page for:
- **ESCAPECRAFT** - Browser-based screen and webcam recorder
- **ESCAPEARTIST** - Client-side video editor with WebCodecs

It's a static landing page and legal pages (`/`, `/privacy`, `/terms`) — no accounts, no
sign-in, no backend.

## Development

```bash
# From monorepo root (recommended)
pnpm dev:plan            # Start on localhost:5173

# Or from this directory
pnpm dev
```

## Build

```bash
# From monorepo root
pnpm build:plan

# Or from this directory
pnpm build
```

## Tech Stack

- React 19 + TypeScript + Vite
- React Router for routing
- Vercel Analytics

## Environment Variables

None required — this app has no backend or auth dependencies.

## ESCAPE Suite

| App | Port | Description |
|-----|------|-------------|
| ESCAPEPLAN | 5173 | This app - landing page & hub |
| ESCAPECRAFT | 5174 | Video recorder |
| ESCAPEARTIST | 5175 | Video editor |
