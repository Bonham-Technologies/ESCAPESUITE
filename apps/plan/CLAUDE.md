# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPEPLAN is the landing page and hub for the ESCAPE Suite - a collection of client-side media
creation tools. It's a static site: a landing page plus legal pages. It has no accounts, no
authentication, and no backend — it just links out to ESCAPECRAFT and ESCAPEARTIST.

**Monorepo Location**: `apps/plan` in the ESCAPESUITE monorepo.

## Build Commands

Run from monorepo root using pnpm:

```bash
pnpm dev:plan            # Start development server (localhost:5173)
pnpm build:plan          # Production build
pnpm test --filter=@escapesuite/plan    # Run tests
pnpm lint                # Lint all apps including plan
```

Or from this directory:

```bash
pnpm dev                 # Start development server
pnpm build               # TypeScript check + Vite build
pnpm test:run            # Run tests
pnpm lint                # Run ESLint
```

## Architecture

### Tech Stack
- **React 19** with TypeScript
- **Vite** for bundling
- **React Router** for client-side routing
- **Vercel Analytics** for usage tracking

### Project Structure
```
src/
├── main.tsx              # Entry point
├── App.tsx                # Routes (/, /privacy, /terms)
├── index.css              # Global styles and CSS variables
├── components/
│   └── Layout/            # Header and Layout components
├── utils/
│   └── themeStorage.ts    # Theme persistence utilities
├── lib/
│   ├── launch.ts          # Tool URLs + "launch tool" analytics event
│   └── analytics.ts       # Vercel Analytics tracking
└── pages/
    ├── Home.tsx            # Landing page — links to ESCAPECRAFT and ESCAPEARTIST
    └── Legal/              # Privacy and Terms pages
```

## Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | Home | Landing page linking to ESCAPECRAFT and ESCAPEARTIST |
| `/privacy` | Privacy | Privacy policy |
| `/terms` | Terms | Terms of use |

Any unmatched path redirects to `/`.

## Tool Integration
In development, tools run on separate ports:
- ESCAPEPLAN: localhost:5173
- ESCAPECRAFT: localhost:5174
- ESCAPEARTIST: localhost:5175

In production (Vercel), all tools are on the same domain:
- `/` → ESCAPEPLAN
- `/craft/` → ESCAPECRAFT
- `/artist/` → ESCAPEARTIST

`src/lib/launch.ts` resolves the right URL per environment and fires a "tool launched" analytics
event before navigating.

## Theme Support

Light/dark theme with CSS variables in `index.css`:
```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f9fafb;
  --bg-tertiary: #f3f4f6;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --border-color: #e5e7eb;
}

[data-theme="dark"] {
  --bg-primary: #111827;
  --bg-secondary: #1f2937;
  --bg-tertiary: #374151;
  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --border-color: #374151;
}
```

All components should use these variables instead of hardcoded colors.

## Key Constraints

- Light/dark theme support with external theme API (`window.ESCAPE_THEME`)
- No environment variables are required — this app has no backend or auth dependencies
