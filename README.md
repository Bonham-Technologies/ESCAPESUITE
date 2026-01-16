# ESCAPE Suite

[![CI](https://github.com/mrbonha/ESCAPESUITE/actions/workflows/ci.yml/badge.svg)](https://github.com/mrbonha/ESCAPESUITE/actions/workflows/ci.yml)

Privacy-first, client-side media creation tools that run entirely in the browser. All video processing happens locally - no cloud uploads required.

**Copyright (c) 2025 Bonham Technologies, LLC. All Rights Reserved.**

## Apps

| App | Description | Production |
|-----|-------------|------------|
| **ESCAPEPLAN** | Hub, authentication & subscriptions | [escapesuite.io](https://escapesuite.io) |
| **ESCAPECRAFT** | Screen & webcam recorder | [escapesuite.io/craft](https://escapesuite.io/craft) |
| **ESCAPEARTIST** | Video editor with timeline & effects | [escapesuite.io/artist](https://escapesuite.io/artist) |

## Features

### ESCAPECRAFT - Recorder
- Screen, window, or tab capture
- Webcam recording with Picture-in-Picture overlay
- Microphone and system audio capture
- Adjustable PiP position, size, and shape (circle/square)
- Send recordings directly to ESCAPEARTIST

### ESCAPEARTIST - Editor
- Multi-track timeline with drag-and-drop
- Text and shape overlays with animations
- Keyframe animation system with 10 easing curves
- 11 transition types between clips
- Blur effect for privacy/focus
- Export to WebM (VP9) or MP4 (H.264)

### ESCAPEPLAN - Hub
- Clerk authentication
- Stripe subscription management
- Dashboard for launching tools

## Quick Start

```bash
# Clone the repository
git clone https://github.com/mrbonha/ESCAPESUITE.git
cd ESCAPESUITE

# Install dependencies
pnpm install

# Start all apps in development
pnpm dev

# Or start individual apps
pnpm dev:plan    # http://localhost:5173
pnpm dev:craft   # http://localhost:5174
pnpm dev:artist  # http://localhost:5175
```

## Monorepo Structure

```
escapesuite/
├── apps/
│   ├── plan/           # ESCAPEPLAN - hub & auth
│   ├── craft/          # ESCAPECRAFT - recorder
│   ├── artist/         # ESCAPEARTIST - video editor
│   └── e2e/            # End-to-end tests (Playwright)
├── packages/
│   └── shared/         # Shared types and utilities
├── scripts/
│   └── build-all.mjs   # Combined build for Vercel
├── turbo.json          # Turborepo configuration
├── pnpm-workspace.yaml # pnpm workspace definition
└── vercel.json         # Vercel deployment config
```

## Development Commands

All commands run from the monorepo root:

```bash
# Development
pnpm dev                 # All apps in parallel
pnpm dev:plan            # Just ESCAPEPLAN
pnpm dev:craft           # Just ESCAPECRAFT
pnpm dev:artist          # Just ESCAPEARTIST

# Building
pnpm build               # Build all apps (Turbo cached)
pnpm build:deploy        # Combined build for Vercel

# Testing
pnpm test                # Unit tests for all apps
pnpm test:coverage       # With coverage reports
pnpm test:e2e            # Playwright E2E tests

# Code Quality
pnpm lint                # ESLint for all apps

# Cleanup
pnpm clean               # Remove node_modules and dist
```

## Tech Stack

- **Framework**: React 19 + TypeScript
- **Build**: Vite + Turborepo
- **State**: Zustand
- **Auth**: Clerk
- **Payments**: Stripe
- **Backend**: Supabase Edge Functions
- **Storage**: IndexedDB (client-side)
- **Video**: WebCodecs API, MediaRecorder
- **Testing**: Vitest + Playwright
- **Deployment**: Vercel

## CI/CD Pipeline

The repository includes comprehensive CI/CD:

| Job | Description |
|-----|-------------|
| **validate** | Dependency install & security audit |
| **lint** | ESLint across all apps |
| **type-check** | TypeScript validation |
| **test** | Unit tests with coverage |
| **build** | Production builds with bundle size reporting |
| **e2e** | Playwright tests (main branch only) |

**Automated Updates**: Dependabot monitors dependencies weekly with grouped PRs.

## Deployment

| Branch | Domain | Purpose |
|--------|--------|---------|
| `main` | escapesuite.io | Production |
| `dev` | escapesuite.dev | Staging |
| PRs | `*.vercel.app` | Preview |

## Environment Variables

Create `.env.local` in each app or set in Vercel:

```env
# All apps
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx

# ESCAPEPLAN only
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
VITE_STRIPE_PRICE_PRO_MONTHLY=price_xxx
VITE_STRIPE_PRICE_PRO_ANNUAL=price_xxx
VITE_STRIPE_PRICE_FOUNDING=price_xxx

# Optional
VITE_BUILD_MODE=saas
```

## Browser Support

| Browser | Recording | Editing | WebM Export | MP4 Export |
|---------|-----------|---------|-------------|------------|
| Chrome 94+ | Full | Full | Full | Full |
| Edge 94+ | Full | Full | Full | Full |
| Firefox 100+ | Full | Full | Full | Not supported |
| Safari 16+ | Limited | Limited | Limited | Not supported |

## Releases

This monorepo uses [Changesets](https://github.com/changesets/changesets) for version management.

### Creating a Changeset

When making changes that should be released:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages changed
2. Choose the bump type (major/minor/patch)
3. Write a summary of changes

A changeset file is created in `.changeset/` - commit this with your PR.

### Release Process

1. Changesets accumulate on `main` as PRs are merged
2. The Release workflow automatically creates a "Version Packages" PR
3. Merging that PR bumps versions, updates CHANGELOGs, and creates git tags
4. GitHub Releases are automatically created for each package

### Versioning

- All main apps (`plan`, `craft`, `artist`) are **linked** - they version together
- E2E tests are excluded from versioning

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make changes and test (`pnpm test && pnpm lint`)
4. **Add a changeset** if your changes should be released (`pnpm changeset`)
5. Commit and push
6. Open a Pull Request

## License

This software is proprietary. See [LICENSE](LICENSE) for details.

- **SaaS**: Use via [escapesuite.io](https://escapesuite.io) with subscription
- **Standalone**: Purchase license from Bonham Technologies, LLC

---

**ESCAPE Suite** - Professional media creation in your browser.

Copyright (c) 2025 Bonham Technologies, LLC. All Rights Reserved.
