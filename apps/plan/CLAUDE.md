# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPEPLAN is the parent shell site for the ESCAPE Suite - a collection of client-side media creation tools. It handles authentication, billing, and serves as the dashboard for launching individual tools (ESCAPECRAFT and ESCAPEARTIST).

## Build Commands

```bash
npm run dev      # Start development server
npm run build    # TypeScript check + Vite production build
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

## Architecture

### Tech Stack
- **React 19** with TypeScript
- **Vite** for bundling
- **React Router** for client-side routing
- **Clerk** for authentication
- **Stripe** for payments
- **Supabase** for backend (Edge Functions + PostgreSQL)
- **CSS Modules** for component styling

### Project Structure
```
src/
├── main.tsx              # Entry point with Clerk provider
├── App.tsx               # Routes and protected route wrapper
├── index.css             # Global styles and CSS variables
├── components/
│   ├── Layout/           # Header and Layout components
│   └── ThemeToggle.tsx   # Light/dark theme toggle component
├── utils/
│   └── theme.ts          # Theme management utilities
├── hooks/
│   └── useSubscription.ts # Subscription state management
├── lib/
│   ├── supabase.ts       # Supabase client
│   ├── subscription.ts   # Subscription API helpers
│   ├── analytics.ts      # Usage analytics tracking
│   └── sentry.ts         # Error monitoring integration
└── pages/
    ├── Home.tsx          # Landing page with pricing
    ├── Dashboard.tsx     # Protected dashboard with tool launchers
    ├── SignIn.tsx        # Clerk SignIn component
    └── SignUp.tsx        # Clerk SignUp component

supabase/
├── functions/            # Edge Functions (Deno)
│   ├── create-checkout/  # Stripe checkout session
│   ├── webhook/          # Stripe webhook handler
│   ├── create-portal/    # Customer portal session
│   └── get-subscription/ # Get subscription status
└── migrations/           # Database migrations
```

### Authentication
- Clerk handles all auth (sign in, sign up, session management)
- Protected routes use `SignedIn`/`SignedOut` components
- After sign in/up, users redirect to `/dashboard`

### Tool Integration
In development, tools run on separate ports:
- ESCAPEPLAN: localhost:5173
- ESCAPECRAFT: localhost:5174
- ESCAPEARTIST: localhost:5175

In production, all tools are on the same domain under different paths:
- `/craft/` → ESCAPECRAFT
- `/artist/` → ESCAPEARTIST

### Environment Variables
- `VITE_CLERK_PUBLISHABLE_KEY`: Clerk publishable key
- `VITE_STRIPE_PUBLISHABLE_KEY`: Stripe publishable key
- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anon/public key
- `VITE_STRIPE_PRICE_PRO_MONTHLY`: Stripe price ID for monthly plan
- `VITE_STRIPE_PRICE_PRO_ANNUAL`: Stripe price ID for annual plan
- `VITE_STRIPE_PRICE_FOUNDING`: Stripe price ID for founding member

### Subscription Tiers
- **Free Trial**: 14 days, watermark on exports
- **Pro Monthly**: $9/month
- **Pro Annual**: $79/year
- **Founding Member**: $149 one-time (lifetime)

### Deployment
- Frontend: GitHub Pages (static)
- Backend: Supabase Edge Functions
- Deploy workflow: `.github/workflows/deploy.yml`
- Secrets must be configured in GitHub repository settings

## Key Constraints

- All tools share authentication via Clerk on the same domain
- Light/dark theme support with external theme API (`window.ESCAPE_THEME`) for consistency across apps
- Edge Functions use Deno runtime (not Node.js) - excluded from ESLint
