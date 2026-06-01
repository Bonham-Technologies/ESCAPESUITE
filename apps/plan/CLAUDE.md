# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPEPLAN is the hub/landing page for the ESCAPE Suite - a collection of client-side media creation tools. It handles authentication, billing, and serves as the dashboard for launching ESCAPECRAFT and ESCAPEARTIST.

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
- **Supabase Auth** for authentication (migrated off Clerk)
- **Stripe** for payments
- **Resend** for transactional email
- **Supabase** for backend (Edge Functions + PostgreSQL)
- **Vercel Analytics** for usage tracking

### Project Structure
```
src/
├── main.tsx              # Entry point with Supabase auth provider
├── App.tsx               # Routes and protected route wrapper
├── index.css             # Global styles and CSS variables
├── components/
│   ├── Layout/           # Header and Layout components
│   └── ThemeToggle.tsx   # Light/dark theme toggle
├── utils/
│   └── theme.ts          # Theme management utilities
├── hooks/
│   └── useSubscription.ts   # Individual subscription state
├── lib/
│   ├── supabase.ts       # Supabase client
│   ├── auth.tsx          # Supabase Auth helpers
│   ├── subscription.ts   # Subscription API helpers
│   └── analytics.ts      # Vercel Analytics tracking
└── pages/
    ├── Home.tsx          # Landing page with pricing overview
    ├── Dashboard.tsx     # Protected dashboard; ?tab=downloads shows downloads & licenses
    ├── SignIn.tsx        # Supabase Auth sign in
    ├── SignUp.tsx        # Supabase Auth sign up
    ├── Pricing/          # Full pricing page (Individual Pro + Site License bands)
    │   ├── Pricing.tsx
    │   └── Pricing.module.css
    └── Legal/            # Privacy and Terms pages

supabase/
├── functions/            # Edge Functions (Deno runtime)
│   │
│   │ # Individual Pro Subscription (connected SaaS side door)
│   ├── create-checkout/      # Stripe checkout for Individual Pro ($9/mo or $89/yr)
│   ├── create-portal/        # Stripe customer portal
│   ├── get-subscription/     # Get user's subscription status
│   ├── webhook/              # Stripe webhook handler
│   │
│   │ # Site License (air-gapped/offline org licensing)
│   ├── create-site-license-checkout/  # Stripe checkout for Site License bands
│   ├── generate-license/         # Generate license key post-purchase
│   ├── get-license-key/          # Retrieve user's license keys
│   ├── get-user-licenses/        # List all licenses for current user
│   ├── get-licensed-download/    # Server-side license injection for pre-licensed downloads
│   ├── send-license-email/       # Email license key after purchase (via Resend)
│   ├── validate-license/         # Validate license for offline apps
│   │
│   │ # Sales / Enterprise contact
│   ├── enterprise-inquiry/       # Enterprise/Site "Contact us" form (sales@escapesuite.io)
│   │
│   │ # Desktop App
│   └── get-version/              # Version check for offline apps
│
└── migrations/           # Database migrations
```

## Pricing & Licensing Model

ESCAPEPLAN sells two things: the **Site License** (the hero, air-gapped/offline) and
**Individual Pro** (a connected-SaaS side door).

### Site License (Organizations) — hero offering
One annual license covers a whole organization/network (per-org, NOT per-seat) and runs fully
offline / air-gapped. Bands on the Pricing page describe approximate org size; checkout is
handled by the `create-site-license-checkout` Edge Function. There is no seat-based member
management, invite flow, or audit-log UI in the product.

| Band | Price | Approx. size |
|------|-------|--------------|
| Team | $2,400/year | up to ~25 |
| Organization | $9,600/year | up to ~250 |
| Enterprise / Site | Contact us | larger / custom |

Enterprise / Site is a "Contact us" flow via sales@escapesuite.io (no self-serve checkout).

### Individual Pro (connected SaaS side door)
For individuals who want cloud-connected, web-based access.

| Tier | Price | Features |
|------|-------|----------|
| Free Trial | $0 (7 days) | Watermark on exports |
| Pro Monthly | $9/month | Full features, no watermark |
| Pro Annual | $89/year | Same as monthly, billed yearly |

> **Note:** The seat-based teams/enterprise SaaS model (per-seat billing, member management,
> invite flow, role management, audit logs, and the `/team/*` + `/invite/:token` pages, plus
> the `useOrganization` hook and `lib/organization`), the Founding Member ($149 lifetime) plan,
> and the standalone consumer multi-SKU product grid were all removed from the product. There
> are zero existing founding members. Do not reintroduce seat/member/invite UI, the Founding
> Member SKU, or the consumer standalone grid. The surviving org-level offering is the per-org
> **Site License** above.

## Authentication

- Supabase Auth handles all auth (sign in, sign up, session management) — migrated off Clerk
- Protected routes gate on the Supabase session (no `SignedIn`/`SignedOut` Clerk components)
- After sign in/up, users redirect to `/dashboard`

## Routes

There is no `/team/*` or `/portal/*` app surface beyond the single download redirect below.

| Path | Component | Auth Required | Description |
|------|-----------|---------------|-------------|
| `/` | Home | No | Landing page with pricing overview |
| `/pricing` | Pricing | No | Full pricing page (Site License + Individual Pro) |
| `/privacy` | Privacy | No | Privacy policy |
| `/terms` | Terms | No | Terms (Site License terms folded in — no separate EULA route) |
| `/sign-in/*` | SignInPage | No | Supabase Auth sign in |
| `/sign-up/*` | SignUpPage | No | Supabase Auth sign up |
| `/dashboard` | Dashboard | Yes | User dashboard, quick links; `?tab=downloads` shows downloads & licenses |
| `/portal/downloads` | — (redirect) | — | Redirects to `/dashboard?tab=downloads` |

## Tool Integration
In development, tools run on separate ports:
- ESCAPEPLAN: localhost:5173
- ESCAPECRAFT: localhost:5174
- ESCAPEARTIST: localhost:5175

In production (Vercel), all tools are on the same domain:
- `/` → ESCAPEPLAN
- `/craft/` → ESCAPECRAFT
- `/artist/` → ESCAPEARTIST

## Environment Variables

### Vercel (Frontend) - Required
```env
VITE_SUPABASE_URL             # Supabase project URL (https://xxx.supabase.co) — also used for Supabase Auth
VITE_SUPABASE_ANON_KEY        # Supabase anon/public key (JWT) — also used for Supabase Auth
VITE_STRIPE_PUBLISHABLE_KEY   # Stripe publishable key for embedded checkout (pk_test_* or pk_live_*)
```

> **Note:** Stripe Price IDs are configured server-side via Supabase Edge Functions.
> The frontend uses the publishable key only for the embedded checkout UI.

### Supabase Edge Function Secrets - Required
Set in: Supabase Dashboard → Settings → Edge Functions → Secrets
```env
# Core Infrastructure
STRIPE_SECRET_KEY             # Stripe secret API key (sk_test_* or sk_live_*)
STRIPE_WEBHOOK_SECRET         # Stripe webhook signing secret (whsec_*)

# License Management
LICENSE_PRIVATE_KEY           # Ed25519 private key for signing (64-char hex)
LICENSE_PUBLIC_KEY            # Ed25519 public key for validation (64-char hex)

# Individual Pro Subscription Prices (for Individual Pro checkout)
STRIPE_PRICE_PRO_MONTHLY      # Pro monthly subscription, $9/mo (price_xxx)
STRIPE_PRICE_PRO_ANNUAL       # Pro annual subscription, $89/yr (price_xxx)

# Site License Prices (for site-license checkout)
STRIPE_PRICE_SITE_TEAM        # Site License — Team band, $2,400/yr (price_xxx)
STRIPE_PRICE_SITE_ORG         # Site License — Organization band, $9,600/yr (price_xxx)
# Enterprise / Site is a "Contact us" flow (sales@escapesuite.io) — no price ID

# Email (transactional delivery via Resend)
RESEND_API_KEY                # Email service for license delivery (re_xxx)
APP_URL                       # Base URL (default: https://www.escapesuite.io)
```

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

- All tools share authentication via Supabase Auth on the same domain
- Light/dark theme support with external theme API (`window.ESCAPE_THEME`)
- Edge Functions use Deno runtime (not Node.js) - excluded from ESLint
- Site License builds are validated offline via signed Ed25519 JWT (air-gapped, no internet)

## Testing Flows

### Individual Pro Subscription Flow
1. Sign up → Dashboard (7-day free trial)
2. Click upgrade → Pricing page
3. Select Pro Monthly ($9/mo) or Pro Annual ($89/yr) → Stripe checkout
4. Complete payment → Redirect to dashboard with active subscription
5. Click "Manage Subscription" → Stripe portal (cancel, upgrade, update payment)

### Site License Flow
1. From Pricing page, choose a Site License band (Team $2,400/yr or Organization $9,600/yr)
2. Click the band's "Get ... License" → `create-site-license-checkout` → Stripe checkout
3. Complete payment → annual license that grants the downloadable Suite bundle for the org
4. For Enterprise / Site, contact sales via the mailto link (sales@escapesuite.io) on the Pricing page
5. License key generated and emailed via `send-license-email` (Resend)
6. Download the air-gapped build from `/dashboard?tab=downloads`:
   - **Pre-Licensed Download** (recommended): Click "Download (Pre-Licensed)" → `get-licensed-download` injects license into HTML → App works immediately
   - **Generic Download**: Click "Generic" → Download unlicensed HTML → Enter license key on first launch
7. License validated offline via signed Ed25519 JWT (no internet required, fully air-gapped)
