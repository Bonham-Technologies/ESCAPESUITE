# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPEPLAN is the hub/landing page for the ESCAPE Suite - a collection of client-side media creation tools. It handles authentication, billing, team management, and serves as the dashboard for launching ESCAPECRAFT and ESCAPEARTIST.

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
│   ├── useSubscription.ts   # Individual subscription state
│   └── useOrganization.ts   # Organization/team state management
├── lib/
│   ├── supabase.ts       # Supabase client
│   ├── subscription.ts   # Subscription API helpers
│   ├── organization.ts   # Organization/team API helpers
│   ├── analytics.ts      # Vercel Analytics tracking
│   └── sentry.ts         # Error monitoring integration
└── pages/
    ├── Home.tsx          # Landing page with pricing overview
    ├── Dashboard.tsx     # Protected dashboard with tool launchers & teams
    ├── SignIn.tsx        # Clerk SignIn component
    ├── SignUp.tsx        # Clerk SignUp component
    ├── Pricing/          # Full pricing page with all tiers
    │   ├── Pricing.tsx
    │   └── Pricing.module.css
    ├── Portal/           # User portal pages
    │   └── Downloads.tsx # Desktop app downloads
    └── Team/             # Team/organization management
        ├── index.ts           # Exports all team pages
        ├── TeamDashboard.tsx  # Team overview, stats, quick actions
        ├── TeamMembers.tsx    # Member list, invite, role management
        ├── TeamSettings.tsx   # Org settings, security, danger zone
        ├── AcceptInvite.tsx   # Invite acceptance flow
        └── AuditLogs.tsx      # Audit log viewing (Enterprise)

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

### SaaS Subscriptions (Teams)
For organizations with multiple users.

| Tier | Price | Minimum | Features |
|------|-------|---------|----------|
| Team | $7/seat/month | 5 seats | Centralized billing, member management |
| Enterprise | $12/seat/month | 25 seats | SSO*, audit logging, allowed domains |

*SSO requires Clerk Enterprise ($100+/mo) - currently disabled

### Standalone Licenses
For users who want offline-only desktop apps without subscriptions.

| Product | Standard | Pro | Lifetime |
|---------|----------|-----|----------|
| ESCAPECRAFT | $49 | $99 | $199 |
| ESCAPEARTIST | $69 | $149 | $299 |
| Suite Bundle | $99 | $199 | $399 |

License tiers differ by update duration:
- Standard: 1 year updates
- Pro: 2 years updates
- Lifetime: Perpetual updates

## Team/Organization System

### Data Model
```
organizations
├── id, name, slug (unique)
├── owner_id (Clerk user ID)
├── plan: 'team' | 'enterprise'
├── seat_count
├── stripe_customer_id, stripe_subscription_id
└── settings (JSONB)
    ├── sso_enabled (Enterprise only)
    ├── require_2fa
    ├── audit_logging (Enterprise only)
    └── allowed_domains[] (Enterprise only)

organization_members
├── organization_id, user_id (Clerk)
├── role: 'owner' | 'admin' | 'member'
├── status: 'active' | 'pending' | 'suspended'
├── email, invited_by, invited_at, joined_at

organization_invites
├── organization_id, email, role
├── token (unique), expires_at
├── invited_by, created_at

audit_logs (Enterprise)
├── organization_id
├── user_id, action, resource_type, resource_id
├── metadata (JSONB), ip_address, user_agent
└── created_at
```

### Role Permissions
```typescript
// From lib/organization.ts
canManageMembers(role)   // owner, admin
canManageSettings(role)  // owner, admin
canViewAuditLogs(role)   // owner, admin (+ audit_logging enabled)
canTransferOwnership(role) // owner only
canDeleteOrganization(role) // owner only
```

### Audit Logging
When `audit_logging` is enabled (Enterprise only), these actions are logged:
- `member.invited`, `member.joined`, `member.removed`, `member.role_changed`
- `settings.updated`, `organization.updated`
- `subscription.created`, `subscription.updated`, `subscription.cancelled`

## Authentication

- Clerk handles all auth (sign in, sign up, session management)
- Protected routes use `SignedIn`/`SignedOut` components
- After sign in/up, users redirect to `/dashboard`
- Team pages require membership check via `useOrganization` hook

## Routes

| Path | Component | Auth Required | Description |
|------|-----------|---------------|-------------|
| `/` | Home | No | Landing page with pricing overview |
| `/pricing` | Pricing | No | Full pricing page |
| `/sign-in/*` | SignInPage | No | Clerk sign in |
| `/sign-up/*` | SignUpPage | No | Clerk sign up |
| `/dashboard` | Dashboard | Yes | User dashboard, teams, quick links |
| `/team/:slug` | TeamDashboard | Yes | Team overview |
| `/team/:slug/members` | TeamMembers | Yes | Member management |
| `/team/:slug/settings` | TeamSettings | Yes | Org settings |
| `/team/:slug/audit-logs` | AuditLogs | Yes | Audit log viewer (Enterprise) |
| `/invite/:token` | AcceptInvite | No | Invitation acceptance |
| `/portal/downloads` | Downloads | Yes | Desktop app downloads |

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
```env
# Required for all functionality
VITE_CLERK_PUBLISHABLE_KEY    # Clerk publishable key
VITE_STRIPE_PUBLISHABLE_KEY   # Stripe publishable key
VITE_SUPABASE_URL             # Supabase project URL
VITE_SUPABASE_ANON_KEY        # Supabase anon/public key

# Individual subscription prices
VITE_STRIPE_PRICE_PRO_MONTHLY # Stripe price ID for monthly
VITE_STRIPE_PRICE_PRO_ANNUAL  # Stripe price ID for annual
VITE_STRIPE_PRICE_FOUNDING    # Stripe price ID for founding member

# Team/Organization prices
VITE_STRIPE_PRICE_TEAM_SEAT   # Stripe price ID for team seat
VITE_STRIPE_PRICE_ENTERPRISE_SEAT # Stripe price ID for enterprise seat

# Standalone license prices (per product/tier)
VITE_STRIPE_PRICE_CRAFT_STANDARD
VITE_STRIPE_PRICE_CRAFT_PRO
VITE_STRIPE_PRICE_CRAFT_LIFETIME
VITE_STRIPE_PRICE_ARTIST_STANDARD
VITE_STRIPE_PRICE_ARTIST_PRO
VITE_STRIPE_PRICE_ARTIST_LIFETIME
VITE_STRIPE_PRICE_SUITE_STANDARD
VITE_STRIPE_PRICE_SUITE_PRO
VITE_STRIPE_PRICE_SUITE_LIFETIME
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
- SSO requires Clerk Enterprise tier (~$100+/mo) - currently disabled
- Audit logging only available on Enterprise plan
- Standalone licenses are validated offline via signed JWT

## Testing Flows

### Individual Subscription Flow
1. Sign up → Dashboard (free trial)
2. Click upgrade → Pricing page
3. Select Pro Monthly/Annual/Founding → Stripe checkout
4. Complete payment → Redirect to dashboard with active subscription
5. Click "Manage Subscription" → Stripe portal (cancel, upgrade, update payment)

### Team Flow
1. From Pricing page, click "Get Started" under Teams
2. Enter org name, select seat count → Stripe checkout
3. Complete payment → Redirect to `/team/:slug?success=true`
4. From team dashboard:
   - View members, stats
   - Settings → Update org name, security settings
   - Members → Invite new members via email
   - Accept invite flow: Email link → `/invite/:token` → Join team

### Enterprise Flow
1. From Pricing page, click "Contact Sales" under Enterprise
2. Fill out inquiry form → Submitted to enterprise-inquiry function
3. Manual setup by admin (Stripe subscription, org creation)
4. Enterprise features: audit logging toggle, allowed domains, SSO toggle (disabled)
5. View audit logs: Team Dashboard → Audit Logs quick action

### Standalone License Flow
1. From Pricing page, scroll to "Standalone Licenses"
2. Select product and tier → Stripe checkout
3. Complete payment → License key generated and emailed
4. Download desktop app from `/portal/downloads`
5. Enter license key in desktop app → Validated via validate-license function
