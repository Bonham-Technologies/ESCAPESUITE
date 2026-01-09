# ESCAPEPLAN

Hub and authentication gateway for the ESCAPE Suite - a collection of client-side media creation tools.

**Part of the [ESCAPESUITE monorepo](../../README.md)**

## Overview

ESCAPEPLAN serves as the landing page and dashboard for:
- **ESCAPECRAFT** - Browser-based screen and webcam recorder
- **ESCAPEARTIST** - Client-side video editor with WebCodecs

## Features

- Clerk-based authentication
- Stripe subscription management
- Protected dashboard with tool launchers
- Dark/light theme with cross-app synchronization

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
- Clerk for authentication
- Stripe for payments
- Supabase Edge Functions
- Vercel Analytics

## Environment Variables

Create `.env.local`:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx
VITE_STRIPE_PRICE_PRO_MONTHLY=price_xxx
VITE_STRIPE_PRICE_PRO_ANNUAL=price_xxx
VITE_STRIPE_PRICE_FOUNDING=price_xxx
```

## ESCAPE Suite

| App | Port | Description |
|-----|------|-------------|
| ESCAPEPLAN | 5173 | This app - hub & auth |
| ESCAPECRAFT | 5174 | Video recorder |
| ESCAPEARTIST | 5175 | Video editor |
