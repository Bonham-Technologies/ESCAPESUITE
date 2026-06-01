# ESCAPESUITE Environment Setup Guide

This guide covers complete setup for test and production environments across all supporting systems: Supabase (auth + backend), Stripe, Resend, and Vercel.

## Table of Contents
- [Overview](#overview)
- [1. Supabase Auth Setup](#1-supabase-auth-setup)
- [2. Stripe Setup](#2-stripe-setup)
- [3. Supabase Setup](#3-supabase-setup)
- [4. Vercel Setup](#4-vercel-setup)
- [5. Environment Variables Reference](#5-environment-variables-reference)
- [6. Testing Checklist](#6-testing-checklist)
- [7. Going Live Checklist](#7-going-live-checklist)

---

## Overview

ESCAPESUITE requires these external services:

| Service | Purpose | Environments Needed |
|---------|---------|---------------------|
| **Supabase** | Authentication (Supabase Auth) + backend (PostgreSQL database, Edge Functions) | Development/Staging, Production |
| **Stripe** | Payments (subscriptions, site-license purchases, customer portal) | Test mode, Live mode |
| **Resend** | Transactional email (license delivery) | Test/Dev API key, Live API key |
| **Vercel** | Hosting (static sites, preview deployments) + Vercel Analytics | Preview, Production |

### Recommended Environment Strategy

| Environment | Supabase (Auth + DB) | Stripe | Resend | Vercel |
|-------------|----------------------|--------|--------|--------|
| **Local Dev** | Dev project | Test mode | Dev API key | N/A (localhost) |
| **Preview/Staging** | Dev project | Test mode | Dev API key | Preview deployments |
| **Production** | Prod project | Live mode | Live API key | Production deployment |

---

## 1. Supabase Auth Setup

Authentication uses **Supabase Auth** (the project migrated off Clerk — there is no Clerk
anywhere). The same Supabase project provides both auth and the database/Edge Functions, so the
auth client uses the same `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as the rest of the app.

### 1.1 Enable Auth Providers

In the Supabase Dashboard → **Authentication** → **Providers** (for both Dev and Prod projects):

- **Required**: Email (password and/or magic link)
- **Recommended**: Google, GitHub (OAuth)

### 1.2 Configure URLs and Redirects

In **Authentication** → **URL Configuration**:

```
Site URL: https://www.escapesuite.io        # (http://localhost:5173 for local dev)
Redirect URLs:
  http://localhost:5173/dashboard
  http://localhost:5174
  http://localhost:5175
  https://escapesuite.io/dashboard
  https://www.escapesuite.io/dashboard
  https://*.vercel.app
```

After sign in/up, users land on `/dashboard`.

### 1.3 Auth Environment Variables

Supabase Auth reuses the project URL and anon key (no separate publishable key):

```env
# Development/Staging and Production both use the project's own URL + anon key
VITE_SUPABASE_URL=https://xxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxxxxxxxxxx
```

> There is **no** `VITE_CLERK_PUBLISHABLE_KEY` — that variable was removed with the migration
> to Supabase Auth.

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

> Price IDs are read **server-side** by Supabase Edge Functions (set as Edge Function secrets,
> e.g. `STRIPE_PRICE_PRO_MONTHLY`). The frontend uses only the publishable key for the embedded
> checkout UI — there are no `VITE_STRIPE_PRICE_*` variables.

#### Individual Pro Subscription Products (connected SaaS side door)

| Product | Edge Function Secret | Type | Amount |
|---------|----------------------|------|--------|
| Pro Monthly | `STRIPE_PRICE_PRO_MONTHLY` | Recurring/month | $9.00 |
| Pro Annual | `STRIPE_PRICE_PRO_ANNUAL` | Recurring/year | $89.00 |

Individual Pro includes a **7-day** free trial.

**Steps**:
1. Go to **Products** → **Add product**
2. Name: "ESCAPESUITE Pro Monthly"
3. Pricing: Recurring, $9.00 USD, Monthly
4. After creation, copy the Price ID (starts with `price_`)

#### Site License Products (air-gapped/offline, per-org annual — NOT per-seat)

| Band | Edge Function Secret | Type | Amount |
|------|----------------------|------|--------|
| Team (~up to 25) | `STRIPE_PRICE_SITE_TEAM` | Recurring/year | $2,400.00 |
| Organization (~up to 250) | `STRIPE_PRICE_SITE_ORG` | Recurring/year | $9,600.00 |
| Enterprise / Site | — (no Price ID) | "Contact us" → sales@escapesuite.io | Custom |

**Steps**:
1. **Products** → **Add product**
2. Name: "ESCAPESUITE Site License — Team"
3. Pricing: Recurring, $2,400.00 USD, Yearly
4. Copy the Price ID

> The per-seat Teams/Enterprise SaaS plans, the Founding Member ($149 lifetime) plan, and the
> multi-SKU consumer standalone grid were all removed. Do not recreate them in Stripe.

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

# Backend (Supabase Edge Functions - NEVER expose to frontend)
STRIPE_SECRET_KEY=sk_test_xxx  # or sk_live_xxx for production
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Price IDs live server-side in Edge Function secrets (not VITE_* vars):
STRIPE_PRICE_PRO_MONTHLY=price_xxx   # Individual Pro, $9/mo
STRIPE_PRICE_PRO_ANNUAL=price_xxx    # Individual Pro, $89/yr
STRIPE_PRICE_SITE_TEAM=price_xxx     # Site License — Team, $2,400/yr
STRIPE_PRICE_SITE_ORG=price_xxx      # Site License — Organization, $9,600/yr
# Enterprise / Site is a "Contact us" flow (sales@escapesuite.io) — no Price ID
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
1. `20250104_create_subscriptions.sql` - Subscriptions table (Individual Pro)
2. `20250109_create_enterprise_inquiries.sql` - Enterprise/Site "Contact us" inquiries
3. `20260111_create_licenses.sql` - Licenses table for Site License keys (see below)

> The old `20260110_create_organizations.sql` migration (organizations/members/invites/audit
> logs) belonged to the removed per-seat Teams/Enterprise SaaS model and is no longer applied.

### 3.3 Create Missing Licenses Table

**IMPORTANT**: The `licenses` table is referenced but not yet in migrations. Run this SQL:

```sql
-- Create licenses table for Site License keys (offline/air-gapped builds)
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY, -- lic_xxx format

  -- Customer info
  customer_id TEXT NOT NULL, -- Supabase user ID or Stripe customer ID
  customer_email TEXT NOT NULL,
  customer_name TEXT,

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

COMMENT ON TABLE licenses IS 'Site License keys for offline/air-gapped builds';
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
| `VITE_STRIPE_PUBLISHABLE_KEY` | Production | `pk_live_xxx` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Preview, Development | `pk_test_xxx` |
| `VITE_SUPABASE_URL` | Production | `https://prod-xxx.supabase.co` |
| `VITE_SUPABASE_URL` | Preview, Development | `https://dev-xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Production | `eyJ...` (prod anon key) |
| `VITE_SUPABASE_ANON_KEY` | Preview, Development | `eyJ...` (dev anon key) |

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
# SUPABASE - Auth + Backend (one project provides both)
# =============================================================================
VITE_SUPABASE_URL=https://xxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxxxxxxxxxx

# =============================================================================
# STRIPE - Payments (use test keys for development)
# =============================================================================
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Stripe Price IDs are NOT frontend env vars — they live in Supabase Edge Function
# secrets (STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_ANNUAL, STRIPE_PRICE_SITE_TEAM,
# STRIPE_PRICE_SITE_ORG). See "Supabase Edge Function Secrets" below.

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

# Stripe Price IDs (server-side)
STRIPE_PRICE_PRO_MONTHLY=price_xxx   # Individual Pro, $9/mo
STRIPE_PRICE_PRO_ANNUAL=price_xxx    # Individual Pro, $89/yr
STRIPE_PRICE_SITE_TEAM=price_xxx     # Site License — Team, $2,400/yr
STRIPE_PRICE_SITE_ORG=price_xxx      # Site License — Organization, $9,600/yr

# License signing (required for Site License keys)
LICENSE_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LICENSE_PUBLIC_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Transactional email (required for license delivery)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 6. Testing Checklist

### Supabase Auth Testing
- [ ] Sign up with email
- [ ] Sign in with email
- [ ] Sign in with Google OAuth
- [ ] Sign in with GitHub OAuth
- [ ] Sign out
- [ ] Protected routes redirect to sign-in

### Stripe Individual Pro Subscription Testing
- [ ] Pro Monthly ($9/mo) checkout → success
- [ ] Pro Annual ($89/yr) checkout → success
- [ ] 7-day free trial applies correctly
- [ ] Subscription shows as active in dashboard
- [ ] Customer portal opens
- [ ] Cancel subscription in portal
- [ ] Subscription shows as canceled

### Stripe Site License Testing
- [ ] Team band ($2,400/yr) checkout → success
- [ ] Organization band ($9,600/yr) checkout → success
- [ ] Enterprise / Site "Contact us" mailto → sales@escapesuite.io
- [ ] License key generated
- [ ] License key + download appear at `/dashboard?tab=downloads`
- [ ] License email delivered via Resend
- [ ] Validate license via API (offline/air-gapped build)

### Supabase Testing
- [ ] Subscriptions table populated after checkout
- [ ] Licenses table populated after Site License purchase
- [ ] Edge Functions responding

### Vercel Testing
- [ ] Preview deployment works
- [ ] Production deployment works
- [ ] SPA routing works (direct URL access)
- [ ] `/craft/` and `/artist/` routes work

---

## 7. Going Live Checklist

### Before Launch

**Supabase Auth**:
- [ ] Configure providers + redirect URLs on the production project
- [ ] Confirm `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` point at the prod project

**Stripe**:
- [ ] Complete business verification
- [ ] Create all products/prices in live mode (Individual Pro + Site License bands)
- [ ] Configure customer portal in live mode
- [ ] Add production webhook endpoint
- [ ] Update Vercel env vars with `pk_live_` key
- [ ] Update Supabase secrets with `sk_live_` key and live Price IDs

**Supabase**:
- [ ] Create production project
- [ ] Configure Supabase Auth providers + redirect URLs
- [ ] Run all migrations
- [ ] Deploy all Edge Functions
- [ ] Set production secrets (Stripe live keys + Price IDs, license keys, `RESEND_API_KEY`)
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
1. Check Supabase Auth URL configuration (Site URL + Redirect URLs)
2. Verify the session cookie/local storage is being set correctly
3. Check browser console for CORS errors

### License validation failing
1. Verify Ed25519 keys are correct
2. Check license hasn't expired
3. Verify license format in database
