# ESCAPESUITE Customer & Licensing System

## Implementation Status

### Track A: SaaS Teams & Enterprise (COMPLETE)

| Component | Status | Location |
|-----------|--------|----------|
| Database migrations | Done | `apps/plan/supabase/migrations/20260110_create_organizations.sql` |
| create-organization | Done | `apps/plan/supabase/functions/create-organization/` |
| get-organization | Done | `apps/plan/supabase/functions/get-organization/` |
| get-organization-members | Done | `apps/plan/supabase/functions/get-organization-members/` |
| invite-member | Done | `apps/plan/supabase/functions/invite-member/` |
| accept-invite | Done | `apps/plan/supabase/functions/accept-invite/` |
| update-member-role | Done | `apps/plan/supabase/functions/update-member-role/` |
| remove-member | Done | `apps/plan/supabase/functions/remove-member/` |
| update-organization | Done | `apps/plan/supabase/functions/update-organization/` |
| create-org-checkout | Done | `apps/plan/supabase/functions/create-org-checkout/` |
| Webhook org handling | Done | `apps/plan/supabase/functions/webhook/` |
| useOrganization hook | Done | `apps/plan/src/hooks/useOrganization.ts` |
| Organization lib | Done | `apps/plan/src/lib/organization.ts` |
| TeamDashboard page | Done | `apps/plan/src/pages/Team/TeamDashboard.tsx` |
| TeamMembers page | Done | `apps/plan/src/pages/Team/TeamMembers.tsx` |
| TeamSettings page | Done | `apps/plan/src/pages/Team/TeamSettings.tsx` |
| AcceptInvite page | Done | `apps/plan/src/pages/Team/AcceptInvite.tsx` |
| App.tsx routes | Done | `/team/:slug`, `/team/:slug/members`, `/team/:slug/settings`, `/invite/:token` |
| Unit tests | Done | `apps/plan/src/lib/organization.test.ts` (27 tests) |

### Track B: Standalone Licensing (COMPLETE)

| Component | Status | Location |
|-----------|--------|----------|
| generate-license | Done | `apps/plan/supabase/functions/generate-license/` |
| validate-license | Done | `apps/plan/supabase/functions/validate-license/` |
| get-license-key | Done | `apps/plan/supabase/functions/get-license-key/` |
| create-license-checkout | Done | `apps/plan/supabase/functions/create-license-checkout/` |
| License validation (client) | Done | `packages/shared/src/auth/license.ts` |
| Downloads portal page | Done | `apps/plan/src/pages/Portal/Downloads.tsx` |
| Unit tests | Done | `packages/shared/src/auth/license.test.ts` |

### Track C: Distribution & Updates (COMPLETE)

| Component | Status | Location |
|-----------|--------|----------|
| Release workflow | Done | `.github/workflows/release.yml` |
| get-version API | Done | `apps/plan/supabase/functions/get-version/` |
| Pricing page | Done | `apps/plan/src/pages/Pricing/Pricing.tsx` |

**Note:** Track C requires:
- `SUPABASE_SERVICE_ROLE_KEY` - For uploading builds to Supabase Storage
- Supabase Storage bucket named `downloads` (public access for downloads)

**Note:** Track B requires the following environment variables to be set:
- `LICENSE_PRIVATE_KEY` - Ed25519 private key (hex-encoded) for signing licenses
- `LICENSE_PUBLIC_KEY` - Ed25519 public key (hex-encoded) for verification
- `VITE_LICENSE_PUBLIC_KEY` - Same public key, for client-side verification

---

## Overview

Two distinct product lines with unified customer management:
- **SaaS**: Subscription-based cloud access (individuals, teams, enterprise)
- **Standalone**: One-time purchase offline licenses (individuals, teams)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ESCAPESUITE Product Lines                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────┐   ┌─────────────────────────────────┐ │
│   │           SaaS                   │   │         Standalone              │ │
│   │   (Cloud, Subscription)          │   │    (Offline, One-time)          │ │
│   ├─────────────────────────────────┤   ├─────────────────────────────────┤ │
│   │                                  │   │                                  │ │
│   │  • Free (Individual)             │   │  • ESCAPECRAFT License          │ │
│   │  • Pro (Individual)              │   │  • ESCAPEARTIST License         │ │
│   │  • Team (2-N users)              │   │  • Suite Bundle License         │ │
│   │  • Enterprise (N+ users)         │   │  • Team/Volume Licenses         │ │
│   │                                  │   │                                  │ │
│   │  Clerk Auth + Stripe Sub         │   │  Signed License Keys            │ │
│   │  Always online                   │   │  Works offline forever          │ │
│   │  Auto-updates                    │   │  Manual update downloads        │ │
│   │                                  │   │                                  │ │
│   └─────────────────────────────────┘   └─────────────────────────────────┘ │
│                                                                              │
│                    ┌─────────────────────────────┐                          │
│                    │    Unified Customer Portal   │                          │
│                    │                              │                          │
│                    │  • View SaaS subscriptions   │                          │
│                    │  • View Standalone licenses  │                          │
│                    │  • Download standalone builds│                          │
│                    │  • Manage team members       │                          │
│                    │  • Billing & invoices        │                          │
│                    └─────────────────────────────┘                          │
│                                                                              │
│           (Customer can have both - purchased separately)                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## SaaS Tiers

| Tier | Users | Billing | Key Features |
|------|-------|---------|--------------|
| Free | 1 | $0 | Watermark, 720p limit |
| Pro | 1 | Subscription | Full features, 4K, no watermark |
| Team | 2-N | Per-seat subscription | Pro + shared projects, team admin |
| Enterprise | N+ | Per-seat subscription | Team + SSO, audit logs, SLA |

## Standalone Tiers

| Product | Users | Billing | Key Features |
|---------|-------|---------|--------------|
| ESCAPECRAFT | 1 | One-time | Screen recorder, lifetime updates |
| ESCAPEARTIST | 1 | One-time | Video editor, lifetime updates |
| Suite Bundle | 1 | One-time | Both apps, discounted |
| Team License | N | One-time | Volume pricing, multiple seats |

## Database Schema

### Core Tables

#### organizations
Team/Enterprise accounts for multi-user access.

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'team',
  seat_count INTEGER NOT NULL DEFAULT 5,
  settings JSONB DEFAULT '{
    "sso_enabled": false,
    "require_2fa": false,
    "audit_logging": false,
    "allowed_domains": []
  }',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### organization_members
User membership and roles within organizations.

```sql
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);
```

#### organization_invites
Pending invitations to join organizations.

```sql
CREATE TABLE organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### licenses
Standalone license records.

```sql
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  organization_id UUID REFERENCES organizations(id),
  product TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'standard',
  seat_count INTEGER DEFAULT 1,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  stripe_payment_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### license_activations
Device tracking for standalone licenses.

```sql
CREATE TABLE license_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id TEXT REFERENCES licenses(id),
  machine_hash TEXT,
  app_version TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(license_id, machine_hash)
);
```

#### audit_logs
Enterprise audit trail.

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Extended Tables

```sql
-- Extend subscriptions table
ALTER TABLE subscriptions ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE subscriptions ADD COLUMN seat_count INTEGER DEFAULT 1;
```

## Key Workflows

### SaaS Individual
1. User signs up (Clerk)
2. Selects plan → Stripe checkout
3. Webhook creates subscription record
4. Access granted via Clerk session

### SaaS Team/Enterprise
1. Admin signs up (Clerk)
2. Creates organization
3. Selects plan + seat count → Stripe checkout
4. Webhook creates org + subscription
5. Admin invites members
6. Members join via invite link

### Standalone Individual
1. Customer purchases (Stripe)
2. Webhook generates signed license
3. Email sent with license key + portal link
4. Customer downloads build from portal
5. Pastes license key in app
6. App validates offline, stores license

### Standalone Team
1. Admin purchases N licenses (Stripe)
2. Webhook generates org + N license seats
3. Admin accesses portal, invites team
4. Each member gets individual license key
5. Members download + activate independently

## Technical Components

### Shared Package (@escapesuite/shared)
- `license/` - License validation, LicenseGate component
- `auth/` - Auth context, config helpers

### Edge Functions (Supabase)
- `generate-license` - Create signed license
- `validate-license` - Online validation + revocation check
- `create-org-checkout` - Team/Enterprise Stripe session
- `webhook` - Handle all Stripe events

### ESCAPEPLAN Pages
- `/pricing` - Calculator for all products
- `/checkout/*` - Purchase flows
- `/portal/*` - Unified customer portal
- `/team/*` - Organization management

### CI/CD
- Release workflow uploads builds to Supabase Storage
- Version.json for update checking
- GitHub Releases for public changelog

## Implementation Phases

### Phase 1: Database & Organizations (Track A)
- Schema migrations
- Organization CRUD
- Member management basics

### Phase 2: SaaS Teams (Track A)
- Team checkout flow
- Invitation system
- Role-based access
- Team dashboard

### Phase 3: Standalone Licensing (Track B)
- License generation
- Signature verification
- LicenseGate component
- Portal downloads

### Phase 4: Enterprise Features
- SSO integration
- Audit logging
- Usage analytics

### Phase 5: Polish
- Email templates
- Onboarding
- Documentation

## ESCAPEPLAN Page Structure

```
/                           # Landing/Marketing
├── /pricing                # Self-service pricing calculator
│   └── ?team=true          # Pre-select team/enterprise
├── /checkout               # Stripe checkout flow
│   ├── /checkout/pro
│   ├── /checkout/team
│   └── /checkout/enterprise
├── /signup                 # Clerk signup
├── /signin                 # Clerk signin
│
├── /dashboard              # Personal dashboard (existing)
│
├── /portal                 # Unified customer portal
│   ├── /subscription       # Manage subscription
│   ├── /downloads          # Standalone builds
│   ├── /licenses           # License keys
│   ├── /invoices           # Billing history
│   └── /settings           # Account settings
│
├── /team                   # Team/Org management
│   ├── /members            # Manage members
│   ├── /invites            # Pending invites
│   ├── /settings           # Org settings
│   ├── /billing            # Org billing
│   ├── /sso                # SSO configuration (Enterprise)
│   └── /audit              # Audit logs (Enterprise)
│
├── /admin                  # Internal admin (protected)
│   ├── /customers
│   ├── /subscriptions
│   └── /analytics
```

## License Format

```typescript
interface License {
  id: string              // "lic_abc123"
  version: 1              // Schema version
  customer: {
    id: string            // Stripe customer ID
    email: string
    name?: string
  }
  product: 'craft' | 'artist' | 'suite'
  tier: 'standard' | 'pro' | 'lifetime'
  issued: string          // ISO date
  expires?: string        // ISO date (null = lifetime)
  features?: string[]     // Feature flags
  signature: string       // Ed25519 signature
}

// Encoded format: ESCAPE-<base64 JSON>
```

## Ed25519 Key Generation

Generate a key pair for signing and verifying licenses:

```bash
# Using openssl (requires openssl 3.0+)
openssl genpkey -algorithm ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem

# Convert to hex format for environment variables
openssl pkey -in private.pem -outform DER | xxd -p -c 256
openssl pkey -in public.pem -pubin -outform DER | xxd -p -c 256

# Or using Node.js:
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
console.log('Private:', privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'));
console.log('Public:', publicKey.export({ type: 'spki', format: 'der' }).toString('hex').slice(-64));
"
```

Store the keys securely:
- `LICENSE_PRIVATE_KEY` - Only in Supabase Edge Function secrets
- `LICENSE_PUBLIC_KEY` - In Supabase secrets for server-side validation
- `VITE_LICENSE_PUBLIC_KEY` - In app `.env` files for client-side validation

**Security Notes:**
- Never expose the private key in client-side code
- The public key can be embedded in apps for offline verification
- Rotate keys periodically and re-issue affected licenses
