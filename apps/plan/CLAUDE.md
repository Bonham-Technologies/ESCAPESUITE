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
- **Clerk** for authentication
- **Stripe** for payments
- **Supabase** for backend (Edge Functions + PostgreSQL)
- **Vercel Analytics** for usage tracking

### Project Structure
```
src/
├── main.tsx              # Entry point with Clerk provider
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
│   ├── auth.tsx          # Auth helpers
│   ├── subscription.ts   # Subscription API helpers
│   └── analytics.ts      # Vercel Analytics tracking
└── pages/
    ├── Home.tsx          # Landing page with pricing overview
    ├── Dashboard.tsx     # Protected dashboard; ?tab=downloads shows downloads & licenses
    ├── SignIn.tsx        # Clerk SignIn component
    ├── SignUp.tsx        # Clerk SignUp component
    ├── Pricing/          # Full pricing page (individual, site-license, standalone)
    │   ├── Pricing.tsx
    │   └── Pricing.module.css
    └── Legal/            # Privacy and Terms pages

supabase/
├── functions/            # Edge Functions (Deno runtime)
│   │
│   │ # Individual Subscriptions
│   ├── create-checkout/      # Stripe checkout for individual plans
│   ├── create-portal/        # Stripe customer portal
│   ├── get-subscription/     # Get user's subscription status
│   ├── webhook/              # Stripe webhook handler
│   │
│   │ # Team/Organization Management
│   ├── create-organization/      # Create new organization
│   ├── create-org-checkout/      # Stripe checkout for team plans
│   ├── get-organization/         # Get org details for current user
│   ├── get-organization-members/ # List org members
│   ├── update-organization/      # Update org name/settings
│   ├── invite-member/            # Send member invitation
│   ├── accept-invite/            # Accept invitation
│   ├── remove-member/            # Remove member from org
│   ├── update-member-role/       # Change member role
│   ├── get-audit-logs/           # Retrieve audit logs (Enterprise)
│   │
│   │ # Standalone Licensing
│   ├── create-license-checkout/  # Stripe checkout for licenses
│   ├── generate-license/         # Generate license key post-purchase
│   ├── get-license-key/          # Retrieve user's license keys
│   ├── get-user-licenses/        # List all licenses for current user
│   ├── get-licensed-download/    # Server-side license injection for pre-licensed downloads
│   ├── send-license-email/       # Email license key after purchase
│   ├── validate-license/         # Validate license for desktop apps
│   │
│   │ # Enterprise
│   ├── enterprise-inquiry/       # Enterprise contact form
│   │
│   │ # Desktop App
│   └── get-version/              # Version check for desktop apps
│
└── migrations/           # Database migrations
```

## Pricing & Licensing Model

ESCAPEPLAN supports two parallel pricing models:

### SaaS Subscriptions (Individual)
For users who want cloud features, sync, and web-based access.

| Tier | Price | Features |
|------|-------|----------|
| Free Trial | $0 (14 days) | Watermark on exports |
| Pro Monthly | $9/month | Full features, no watermark |
| Pro Annual | $79/year | Same as monthly, 2 months free |
| Founding Member | $149 once | Lifetime access |

### Site License (Organizations)
One annual license covers a whole organization/network (per-org, NOT per-seat). An annual
subscription that grants the downloadable Suite bundle for the whole org. Bands on the Pricing
page (`team` / `org` / `enterprise`) just describe approximate org size; checkout is handled by
the `create-site-license-checkout` Edge Function. There is no seat-based member management,
invite flow, or audit-log UI in the product.

### Standalone Licenses
For users who want offline-only desktop apps without subscriptions. Requires sign-in to purchase.

| Product | Standard | Pro | Lifetime |
|---------|----------|-----|----------|
| ESCAPECRAFT | $49 | $99 | $199 |
| ESCAPEARTIST | $69 | $129 | $249 |
| Suite Bundle | $99 | $199 | $349 |

License tiers differ by update duration:
- Standard: 1 year updates
- Pro: 2 years updates
- Lifetime: Perpetual updates

> **Note:** The seat-based teams/enterprise model (per-seat billing, member management,
> invite flow, role management, audit logs, and the `/team/*` + `/invite/:token` pages, plus
> the `useOrganization` hook and `lib/organization`) was removed from the product. The
> surviving org-level offering is the per-org **Site License** above. Do not reintroduce
> seat/member/invite UI.

## Authentication

- Clerk handles all auth (sign in, sign up, session management)
- Protected routes use `SignedIn`/`SignedOut` components
- After sign in/up, users redirect to `/dashboard`

## Routes

| Path | Component | Auth Required | Description |
|------|-----------|---------------|-------------|
| `/` | Home | No | Landing page with pricing overview |
| `/pricing` | Pricing | No | Full pricing page |
| `/privacy` | Privacy | No | Privacy policy |
| `/terms` | Terms | No | Terms / Site License Agreement |
| `/sign-in/*` | SignInPage | No | Clerk sign in |
| `/sign-up/*` | SignUpPage | No | Clerk sign up |
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
VITE_CLERK_PUBLISHABLE_KEY    # Clerk publishable key (pk_test_* or pk_live_*)
VITE_STRIPE_PUBLISHABLE_KEY   # Stripe publishable key for embedded checkout (pk_test_* or pk_live_*)
VITE_SUPABASE_URL             # Supabase project URL (https://xxx.supabase.co)
VITE_SUPABASE_ANON_KEY        # Supabase anon/public key (JWT)
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

# Individual Subscription Prices (for individual checkout)
STRIPE_PRICE_PRO_MONTHLY      # Pro monthly subscription (price_xxx)
STRIPE_PRICE_PRO_ANNUAL       # Pro annual subscription (price_xxx)
STRIPE_PRICE_FOUNDING         # Founding member one-time (price_xxx)

# Team/Organization Prices (for team checkout)
STRIPE_PRICE_TEAM_MONTHLY     # Team monthly per-seat (price_xxx)
STRIPE_PRICE_TEAM_ANNUAL      # Team annual per-seat (price_xxx)
STRIPE_PRICE_ENTERPRISE_MONTHLY  # Enterprise monthly per-seat (price_xxx)
STRIPE_PRICE_ENTERPRISE_ANNUAL   # Enterprise annual per-seat (price_xxx)

# Standalone License Prices (for license checkout)
STRIPE_PRICE_CRAFT_STANDARD   # ESCAPECRAFT Standard (price_xxx)
STRIPE_PRICE_CRAFT_PRO        # ESCAPECRAFT Pro (price_xxx)
STRIPE_PRICE_CRAFT_LIFETIME   # ESCAPECRAFT Lifetime (price_xxx)
STRIPE_PRICE_ARTIST_STANDARD  # ESCAPEARTIST Standard (price_xxx)
STRIPE_PRICE_ARTIST_PRO       # ESCAPEARTIST Pro (price_xxx)
STRIPE_PRICE_ARTIST_LIFETIME  # ESCAPEARTIST Lifetime (price_xxx)
STRIPE_PRICE_SUITE_STANDARD   # Suite Bundle Standard (price_xxx)
STRIPE_PRICE_SUITE_PRO        # Suite Bundle Pro (price_xxx)
STRIPE_PRICE_SUITE_LIFETIME   # Suite Bundle Lifetime (price_xxx)

# Optional Services
RESEND_API_KEY                # Email service for license delivery (re_xxx)
APP_URL                       # Base URL for invite links (default: https://escapesuite.io)
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

- All tools share authentication via Clerk on the same domain
- Light/dark theme support with external theme API (`window.ESCAPE_THEME`)
- Edge Functions use Deno runtime (not Node.js) - excluded from ESLint
- Standalone licenses are validated offline via signed JWT

## Testing Flows

### Individual Subscription Flow
1. Sign up → Dashboard (free trial)
2. Click upgrade → Pricing page
3. Select Pro Monthly/Annual/Founding → Stripe checkout
4. Complete payment → Redirect to dashboard with active subscription
5. Click "Manage Subscription" → Stripe portal (cancel, upgrade, update payment)

### Site License Flow
1. From Pricing page, choose a Site License band (Team / Organization)
2. Click the band's "Get ... License" → `create-site-license-checkout` → Stripe checkout
3. Complete payment → annual subscription that grants the downloadable Suite bundle
4. For Enterprise / Site, contact sales via the mailto link on the Pricing page

### Standalone License Flow
1. From Pricing page, scroll to "Standalone Licenses"
2. Select product and tier → Stripe checkout
3. Complete payment → License key generated and emailed via `send-license-email`
4. Download desktop app from `/dashboard?tab=downloads`:
   - **Pre-Licensed Download** (recommended): Click "Download (Pre-Licensed)" → `get-licensed-download` injects license into HTML → App works immediately
   - **Generic Download**: Click "Generic" → Download unlicensed HTML → Enter license key on first launch
5. License validated offline via signed Ed25519 JWT (no internet required after activation)
