# ESCAPESUITE Environment Setup Guide

This guide covers complete setup for test and production environments across all supporting systems: Clerk, Stripe, Supabase, and Vercel.

## Table of Contents
- [Overview](#overview)
- [1. Clerk Setup](#1-clerk-setup)
- [2. Stripe Setup](#2-stripe-setup)
- [3. Supabase Setup](#3-supabase-setup)
- [4. Vercel Setup](#4-vercel-setup)
- [5. Environment Variables Reference](#5-environment-variables-reference)
- [6. Testing Checklist](#6-testing-checklist)
- [7. Going Live Checklist](#7-going-live-checklist)

---

## Overview

ESCAPESUITE requires four external services:

| Service | Purpose | Environments Needed |
|---------|---------|---------------------|
| **Clerk** | Authentication (sign in, sign up, user management) | Development, Production |
| **Stripe** | Payments (subscriptions, one-time purchases, customer portal) | Test mode, Live mode |
| **Supabase** | Backend (PostgreSQL database, Edge Functions) | Development/Staging, Production |
| **Vercel** | Hosting (static sites, preview deployments) | Preview, Production |

### Recommended Environment Strategy

| Environment | Clerk | Stripe | Supabase | Vercel |
|-------------|-------|--------|----------|--------|
| **Local Dev** | Development instance | Test mode | Dev project | N/A (localhost) |
| **Preview/Staging** | Development instance | Test mode | Dev project | Preview deployments |
| **Production** | Production instance | Live mode | Prod project | Production deployment |

---

## 1. Clerk Setup

### 1.1 Create Clerk Application

1. Go to [clerk.com](https://clerk.com) and sign in
2. Click "Add application"
3. Name: `ESCAPESUITE` (or `ESCAPESUITE-Dev` for development)
4. Select sign-in options:
   - **Required**: Email
   - **Recommended**: Google, GitHub (OAuth)

### 1.2 Development Instance (Test/Staging)

1. Your default instance is the development instance
2. Go to **API Keys** and copy:
   - `Publishable Key` (starts with `pk_test_`)
   - `Secret Key` (starts with `sk_test_`) - only needed for backend if you add Clerk webhooks

### 1.3 Production Instance

1. In Clerk Dashboard, go to **Settings** → **Instances**
2. Click "Create production instance"
3. Configure same sign-in options as development
4. Go to **API Keys** and copy:
   - `Publishable Key` (starts with `pk_live_`)

### 1.4 Configure Clerk Settings

For **both** instances:

**Paths (Settings → Paths)**:
```
Sign-in URL: /sign-in
Sign-up URL: /sign-up
After sign-in URL: /dashboard
After sign-up URL: /dashboard
```

**Allowed Origins (Settings → Domains)**:
- Development: `http://localhost:5173`, `http://localhost:5174`, `http://localhost:5175`
- Production: `https://escapesuite.io`, `https://*.vercel.app`

### 1.5 Clerk Environment Variables

```env
# Development/Staging
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Production
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 1.6 Optional: Clerk Webhooks (for user sync)

If you want to sync Clerk users to Supabase:

1. Go to **Webhooks** in Clerk Dashboard
2. Add endpoint: `https://your-supabase-url.supabase.co/functions/v1/clerk-webhook`
3. Select events: `user.created`, `user.updated`, `user.deleted`
4. Copy the signing secret for webhook verification

---

## 2. Stripe Setup

### 2.1 Create Stripe Account

1. Go to [stripe.com](https://stripe.com) and create an account
2. Complete business verification (required for live mode)

### 2.2 Test Mode Setup

Test mode is automatically available. All test API keys start with `pk_test_` and `sk_test_`.

**Test Card Numbers**:
- Success: `4242424242424242`
- Decline: `4000000000000002`
- Requires auth: `4000002500003155`

### 2.3 Create Products and Prices

You need to create products in **both** test and live modes.

#### Individual Subscription Products

| Product | Price ID Name | Type | Amount |
|---------|---------------|------|--------|
| Pro Monthly | `VITE_STRIPE_PRICE_PRO_MONTHLY` | Recurring/month | $9.00 |
| Pro Annual | `VITE_STRIPE_PRICE_PRO_ANNUAL` | Recurring/year | $79.00 |
| Founding Member | `VITE_STRIPE_PRICE_FOUNDING` | One-time | $149.00 |

**Steps**:
1. Go to **Products** → **Add product**
2. Name: "ESCAPESUITE Pro Monthly"
3. Pricing: Recurring, $9.00 USD, Monthly
4. After creation, copy the Price ID (starts with `price_`)

#### Team Subscription Products

| Product | Price ID Name | Type | Amount |
|---------|---------------|------|--------|
| Team Seat | `VITE_STRIPE_PRICE_TEAM_SEAT` | Recurring/month (per unit) | $7.00 |
| Enterprise Seat | `VITE_STRIPE_PRICE_ENTERPRISE_SEAT` | Recurring/month (per unit) | $12.00 |

**Steps**:
1. **Products** → **Add product**
2. Name: "ESCAPESUITE Team"
3. Pricing: Recurring, $7.00 USD, Monthly, **Per unit**
4. Copy the Price ID

#### Standalone License Products

Create products for each combination:

| Product | Tier | Price ID Suffix | Amount |
|---------|------|-----------------|--------|
| ESCAPECRAFT | Standard | `CRAFT_STANDARD` | $49 |
| ESCAPECRAFT | Pro | `CRAFT_PRO` | $99 |
| ESCAPECRAFT | Lifetime | `CRAFT_LIFETIME` | $199 |
| ESCAPEARTIST | Standard | `ARTIST_STANDARD` | $69 |
| ESCAPEARTIST | Pro | `ARTIST_PRO` | $149 |
| ESCAPEARTIST | Lifetime | `ARTIST_LIFETIME` | $299 |
| Suite Bundle | Standard | `SUITE_STANDARD` | $99 |
| Suite Bundle | Pro | `SUITE_PRO` | $199 |
| Suite Bundle | Lifetime | `SUITE_LIFETIME` | $399 |

All standalone licenses are **one-time payments**.

### 2.4 Configure Customer Portal

1. Go to **Settings** → **Billing** → **Customer portal**
2. Enable:
   - Update payment methods
   - View invoices
   - Cancel subscription
   - Switch plans (optional)
3. Set branding (logo, colors)

### 2.5 Configure Webhooks

**Development (using Stripe CLI)**:
```bash
# Install Stripe CLI
# Windows: scoop install stripe
# Mac: brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local Supabase
stripe listen --forward-to http://localhost:54321/functions/v1/webhook
```

**Production**:
1. Go to **Developers** → **Webhooks**
2. Add endpoint: `https://your-project.supabase.co/functions/v1/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (starts with `whsec_`)

### 2.6 Stripe Environment Variables

```env
# Frontend (publishable - safe to expose)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx  # or pk_live_xxx for production

# Individual subscriptions
VITE_STRIPE_PRICE_PRO_MONTHLY=price_xxx
VITE_STRIPE_PRICE_PRO_ANNUAL=price_xxx
VITE_STRIPE_PRICE_FOUNDING=price_xxx

# Team subscriptions
VITE_STRIPE_PRICE_TEAM_SEAT=price_xxx
VITE_STRIPE_PRICE_ENTERPRISE_SEAT=price_xxx

# Standalone licenses
VITE_STRIPE_PRICE_CRAFT_STANDARD=price_xxx
VITE_STRIPE_PRICE_CRAFT_PRO=price_xxx
VITE_STRIPE_PRICE_CRAFT_LIFETIME=price_xxx
VITE_STRIPE_PRICE_ARTIST_STANDARD=price_xxx
VITE_STRIPE_PRICE_ARTIST_PRO=price_xxx
VITE_STRIPE_PRICE_ARTIST_LIFETIME=price_xxx
VITE_STRIPE_PRICE_SUITE_STANDARD=price_xxx
VITE_STRIPE_PRICE_SUITE_PRO=price_xxx
VITE_STRIPE_PRICE_SUITE_LIFETIME=price_xxx

# Backend (Supabase Edge Functions - NEVER expose to frontend)
STRIPE_SECRET_KEY=sk_test_xxx  # or sk_live_xxx for production
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

---

## 3. Supabase Setup

### 3.1 Create Projects

Create **two** Supabase projects:

1. **Development/Staging**: `escapesuite-dev`
2. **Production**: `escapesuite-prod`

### 3.2 Run Database Migrations

Migrations are in `apps/plan/supabase/migrations/`. Run them in order:

```bash
# Option 1: Using Supabase CLI
cd apps/plan
supabase link --project-ref your-project-ref
supabase db push

# Option 2: Manual via SQL Editor
# Copy each migration file into Supabase SQL Editor and run
```

**Migration order**:
1. `20250104_create_subscriptions.sql` - Subscriptions table
2. `20250109_create_enterprise_inquiries.sql` - Enterprise inquiries
3. `20260110_create_organizations.sql` - Organizations, members, invites, audit logs
4. `20260111_create_licenses.sql` - Licenses table (see below)

### 3.3 Create Missing Licenses Table

**IMPORTANT**: The `licenses` table is referenced but not yet in migrations. Run this SQL:

```sql
-- Create licenses table for standalone license keys
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY, -- lic_xxx format

  -- Customer info
  customer_id TEXT NOT NULL, -- Clerk user ID or Stripe customer ID
  customer_email TEXT NOT NULL,
  customer_name TEXT,

  -- Organization (for team licenses)
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- License details
  product TEXT NOT NULL CHECK (product IN ('craft', 'artist', 'suite')),
  tier TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'pro', 'lifetime')),
  seat_count INTEGER NOT NULL DEFAULT 1 CHECK (seat_count >= 1),

  -- Validity
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- NULL for lifetime licenses
  revoked_at TIMESTAMPTZ,

  -- Payment tracking
  stripe_payment_id TEXT,

  -- Additional data
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_licenses_customer_id ON licenses(customer_id);
CREATE INDEX idx_licenses_customer_email ON licenses(customer_email);
CREATE INDEX idx_licenses_organization_id ON licenses(organization_id);
CREATE INDEX idx_licenses_product ON licenses(product);
CREATE INDEX idx_licenses_expires_at ON licenses(expires_at);

-- Enable RLS
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- Policy: service role only
CREATE POLICY "Service role access for licenses" ON licenses
  FOR ALL USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE TRIGGER update_licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE licenses IS 'Standalone license keys for desktop app purchases';
```

### 3.4 Deploy Edge Functions

```bash
cd apps/plan

# Link to your project
supabase link --project-ref your-project-ref

# Deploy all functions
supabase functions deploy

# Or deploy individually
supabase functions deploy create-checkout
supabase functions deploy webhook
# ... etc
```

### 3.5 Configure Edge Function Secrets

In Supabase Dashboard → **Edge Functions** → **Secrets**:

```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
LICENSE_PRIVATE_KEY=<64-char-hex-ed25519-private-key>
LICENSE_PUBLIC_KEY=<64-char-hex-ed25519-public-key>
```

**Generate Ed25519 key pair for license signing**:
```bash
# Using Node.js
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
console.log('Private:', privateKey.export({type: 'pkcs8', format: 'der'}).slice(-32).toString('hex'));
console.log('Public:', publicKey.export({type: 'spki', format: 'der'}).slice(-32).toString('hex'));
"
```

### 3.6 Supabase Environment Variables

```env
# Frontend (safe to expose)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx.xxx.xxx

# Backend (Edge Functions have these automatically)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx.xxx.xxx  # NEVER expose to frontend
```

---

## 4. Vercel Setup

### 4.1 Connect Repository

1. Go to [vercel.com](https://vercel.com) and sign in
2. Import your GitHub repository
3. Framework preset: **Vite**
4. Root directory: `.` (monorepo root)
5. Build command: `pnpm build:deploy`
6. Output directory: `dist`

### 4.2 Configure Domains

**Production**:
- Primary: `escapesuite.io`
- Configure DNS records as shown in Vercel

**Preview**:
- Automatic: `*.vercel.app` for each PR/branch

### 4.3 Environment Variables

In Vercel Dashboard → **Settings** → **Environment Variables**:

| Variable | Environment | Value |
|----------|-------------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Production | `pk_live_xxx` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Preview, Development | `pk_test_xxx` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Production | `pk_live_xxx` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Preview, Development | `pk_test_xxx` |
| `VITE_SUPABASE_URL` | Production | `https://prod-xxx.supabase.co` |
| `VITE_SUPABASE_URL` | Preview, Development | `https://dev-xxx.supabase.co` |
| ... | ... | ... |

**Important**: Set environment-specific values for Production vs Preview/Development.

### 4.4 Build Configuration

The `vercel.json` in the repo handles:
- SPA routing (rewrites to index.html)
- Subpath routing for `/craft/` and `/artist/`

---

## 5. Environment Variables Reference

### Complete `.env.local` for Development

Create `apps/plan/.env.local`:

```env
# =============================================================================
# CLERK - Authentication
# =============================================================================
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# =============================================================================
# STRIPE - Payments (use test keys for development)
# =============================================================================
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Individual Subscription Price IDs
VITE_STRIPE_PRICE_PRO_MONTHLY=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_PRO_ANNUAL=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_FOUNDING=price_xxxxxxxxxxxxxxxxxxxxxxxxxx

# Team Subscription Price IDs
VITE_STRIPE_PRICE_TEAM_SEAT=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_ENTERPRISE_SEAT=price_xxxxxxxxxxxxxxxxxxxxxxxxxx

# Standalone License Price IDs
VITE_STRIPE_PRICE_CRAFT_STANDARD=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_CRAFT_PRO=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_CRAFT_LIFETIME=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_ARTIST_STANDARD=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_ARTIST_PRO=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_ARTIST_LIFETIME=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_SUITE_STANDARD=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_SUITE_PRO=price_xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PRICE_SUITE_LIFETIME=price_xxxxxxxxxxxxxxxxxxxxxxxxxx

# =============================================================================
# SUPABASE - Backend
# =============================================================================
VITE_SUPABASE_URL=https://xxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxxxxxxxxxx

# =============================================================================
# OPTIONAL
# =============================================================================
# VITE_BUILD_MODE=saas
```

### Supabase Edge Function Secrets

Set these in Supabase Dashboard → Edge Functions → Secrets:

```env
# Stripe (required)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# License signing (required for standalone licenses)
LICENSE_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LICENSE_PUBLIC_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 6. Testing Checklist

### Clerk Testing
- [ ] Sign up with email
- [ ] Sign in with email
- [ ] Sign in with Google OAuth
- [ ] Sign in with GitHub OAuth
- [ ] Sign out
- [ ] Protected routes redirect to sign-in

### Stripe Individual Subscription Testing
- [ ] Pro Monthly checkout → success
- [ ] Pro Annual checkout → success
- [ ] Founding Member checkout → success
- [ ] Subscription shows as active in dashboard
- [ ] Customer portal opens
- [ ] Cancel subscription in portal
- [ ] Subscription shows as canceled

### Stripe Team Subscription Testing
- [ ] Create team checkout (5 seats) → success
- [ ] Redirect to team dashboard
- [ ] Team shows correct seat count
- [ ] Invite member → invitation created
- [ ] Accept invite → member joins
- [ ] Change member role
- [ ] Remove member

### Stripe Standalone License Testing
- [ ] Purchase ESCAPECRAFT license → success
- [ ] License key generated
- [ ] License key appears in downloads page
- [ ] Validate license via API

### Supabase Testing
- [ ] Subscriptions table populated after checkout
- [ ] Organizations table has correct data
- [ ] Audit logs recorded (Enterprise)
- [ ] Edge Functions responding

### Vercel Testing
- [ ] Preview deployment works
- [ ] Production deployment works
- [ ] SPA routing works (direct URL access)
- [ ] `/craft/` and `/artist/` routes work

---

## 7. Going Live Checklist

### Before Launch

**Clerk**:
- [ ] Create production instance
- [ ] Configure same settings as development
- [ ] Update Vercel env vars with `pk_live_` key

**Stripe**:
- [ ] Complete business verification
- [ ] Create all products/prices in live mode
- [ ] Configure customer portal in live mode
- [ ] Add production webhook endpoint
- [ ] Update Vercel env vars with `pk_live_` key
- [ ] Update Supabase secrets with `sk_live_` key

**Supabase**:
- [ ] Create production project
- [ ] Run all migrations
- [ ] Deploy all Edge Functions
- [ ] Set production secrets
- [ ] Update Vercel env vars with production URL/keys

**Vercel**:
- [ ] Configure production domain
- [ ] Verify all env vars for production environment
- [ ] Enable analytics

### After Launch

- [ ] Test one real purchase (can refund)
- [ ] Monitor Stripe webhook logs
- [ ] Monitor Supabase Edge Function logs
- [ ] Monitor Vercel deployment logs

---

## Troubleshooting

### Webhook not receiving events
1. Check Stripe webhook endpoint URL is correct
2. Verify signing secret matches
3. Check Supabase Edge Function logs
4. Use Stripe CLI for local testing

### Checkout redirects to wrong URL
1. Check `success_url` and `cancel_url` in checkout function
2. Verify domain is allowed in Stripe settings

### User not authenticated after redirect
1. Check Clerk domain configuration
2. Verify cookies are being set correctly
3. Check browser console for CORS errors

### License validation failing
1. Verify Ed25519 keys are correct
2. Check license hasn't expired
3. Verify license format in database
