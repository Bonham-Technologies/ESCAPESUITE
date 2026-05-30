# ESCAPESUITE: Clerk → Supabase Auth Migration — Design & Plan

**Date:** 2026-05-30
**Status:** Approved (design), in implementation
**Branch:** `feat/supabase-auth-migration`
**Supabase project:** `owuiprfnanuyzyqfaxjl` (ESCAPESUITE, us-west-2)

## Context & premise

ESCAPESUITE authenticates via Clerk across all four packages (`plan`, `craft`, `artist`, `shared`)
sharing one Clerk instance. Crucially:

- **Clerk's org/team primitives are not used** — the entire team/role/invite model is hand-rolled in
  our own Postgres tables. There is no Clerk-org logic to port, only a re-key + RLS.
- **No JWT ever reaches the backend.** The browser sends `clerkUserId` as a plaintext
  query/body parameter; 18 of 23 edge functions then trust it while running as `service_role`.
  That is the P0 IDOR class.
- **The app is pre-revenue and the identity tables are effectively empty.** Verified live:
  `auth.users = 0`, `subscriptions = 2` (both founder test trials, one expired),
  `organizations = 1` (default-named test org), `organization_members = 1`,
  `licenses/activations/audit_logs/license_downloads = 0`, `enterprise_inquiries = 1` (a form row).
  Stripe is in test mode.

**Therefore: clean-slate hard cutover.** No Clerk export, no id-mapping table, no dual-read window,
no Stripe metadata backfill. Wipe the test rows, rebuild the schema natively on `auth.users` UUIDs
with real RLS, hard-cut the frontend, retire Clerk.

## Locked decisions

1. **Backend authorization:** RLS keyed on `auth.uid()` + thin functions. Delete the read-only
   functions; keep only privileged ones, each deriving identity from the verified JWT.
2. **Auth UI:** hand-built `/sign-in` + `/sign-up` forms styled to the existing dark/Indigo `#6366f1`
   theme (Supabase's prebuilt Auth UI library is in maintenance mode).
3. **Login methods now:** email/password + **magic link**. GitHub is intentionally dropped (was the
   only OAuth provider). The auth layer is built **provider-agnostic** so GitHub/Google become a
   dashboard toggle + one button later.

## Target data model (forward, append-only migrations)

| Table | Change |
|---|---|
| `subscriptions` | `clerk_user_id TEXT` → `auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE` |
| `organization_members` | `user_id TEXT` → `UUID FK auth.users`; preserve `UNIQUE(org_id,user_id)` + `UNIQUE(org_id,email)` |
| `organization_invites` | `invited_by TEXT` → `UUID FK auth.users` (nullable) |
| `licenses` | split `customer_id` → `auth_user_id UUID FK` (identity) + `stripe_customer_id TEXT` (billing) |
| `audit_logs` | `user_id TEXT` → `UUID FK` (nullable) |
| `license_downloads` | `user_id TEXT` → `UUID FK` (nullable) |
| `license_activations` | add `auth_user_id UUID` (nullable) |
| `organizations`, `enterprise_inquiries` | no identity column — untouched |

Helper functions `is_org_member/admin/owner(org_id UUID, …)` rewritten to take **UUID** and read
`auth.uid()`, so they back both RLS and any remaining function logic.

## Authorization model (the real IDOR fix)

Replace service-role-only policies with row-level policies:

- **subscriptions / licenses / license_activations:** `SELECT` where `auth.uid() = auth_user_id`.
- **organizations:** members `SELECT` their org; owners `UPDATE` it.
- **organization_members / organization_invites:** members `SELECT` within their org;
  admins/owners mutate (via the UUID helpers).
- **audit_logs / license_downloads:** members read within their org; writes via service-role paths.

**Functions deleted** (→ direct `supabase.from(...)` reads, DB-guarded):
`get-subscription`, `get-organization`, `get-organization-members`, `get-user-licenses`,
`get-audit-logs`.

**Functions kept** (privileged; run as service_role but derive identity from a verified JWT via a new
`_shared/auth.ts → getUser(req)` helper, never from the body):
`create-checkout`, `create-org-checkout`, `create-license-checkout`, `create-portal`,
`create-organization`, `invite-member`, `accept-invite`, `remove-member`, `update-member-role`,
`update-organization`, `generate-license`, `send-license-email`, `webhook`. Plus the already-public
`enterprise-inquiry`, `get-version`, `validate-license`, `get-license-key`, `get-licensed-download`
(the last two switch to JWT-derived ownership checks). The `clerkUserId` param is removed everywhere.

## Frontend

- `packages/shared/src/auth/supabaseClient.ts`: single `createClient` with localStorage session
  persistence; `useSupabaseUser()` → `{ user, loading }`.
- `SaaSAuthGate` refactored provider-agnostic (already takes `userId`/`isLoaded`); fed by
  `useSupabaseUser`. Same trial-vs-paid logic, reading the RLS-guarded `subscriptions` row directly.
- Hand-built `/sign-in` + `/sign-up` (email/password + "email me a magic link"), themed.
  `ProtectedRoute` → `<Navigate to="/sign-in">` when `session === null`. `UserButton` → account
  dropdown calling `supabase.auth.signOut()`.
- **Session sharing:** production serves all three apps from one origin → session shared natively.
  Dev (ports 5173/5174/5175) signs in per-app (acceptable).
- **Standalone/air-gapped builds stay auth-free:** `isSaaSMode` keys off `BUILD_MODE === 'saas'` only.

## Org invite flow

`invite-member` uses Supabase's server-side `auth.admin.inviteUserByEmail` to pre-create the
`auth.users` row and email a one-click link (dovetails with magic link). The `organization_invites`
token row is kept for role/seat/expiry. `accept-invite` validates token+email then inserts the
membership keyed by the now-real `auth.uid()`. Replaces Clerk's `<SignInButton mode="modal">`.

## Stripe re-wiring (no backfill)

Checkout/customer metadata writes `supabase_user_id` (UUID) instead of `clerk_user_id`. Webhook
forward path reads it; reverse path (`subscription.updated` → lookup by `stripe_customer_id`)
unchanged; upsert `onConflict` → `auth_user_id`. `create-portal`/`create-checkout` resolve the Stripe
customer via `auth_user_id`. Price catalog + signature verification untouched.

## Trial lifecycle

Move the +14-day trial seed from a side effect of an unauthenticated `get-subscription` fetch to a
**trigger on `auth.users` INSERT** that creates the `trialing` subscriptions row.

## Config / env / CSP

Remove `VITE_CLERK_PUBLISHABLE_KEY` (env, `turbo.json`, `.env.example`); reuse existing
`VITE_SUPABASE_URL`/`ANON_KEY`. Swap Clerk domains → `*.supabase.co` in `vercel.json` CSP.
`CLERK_SECRET_KEY` was never used. Drop `@clerk/*` from all four `package.json`.

## Build sequence

1. Stand up Supabase Auth (email confirm + magic-link templates, redirect URLs).
2. Wipe test rows; apply re-key + RLS + helper + trial-trigger migrations.
3. Shared auth client + `useSupabaseUser` + refactored `SaaSAuthGate`.
4. Hand-built sign-in/up + magic link + guards + account menu.
5. Delete 6 read functions → direct RLS reads; JWT-scope + de-IDOR the kept functions.
6. Stripe re-wire.
7. Strip Clerk deps/env/CSP across 4 packages.
8. Tests (authorization matrix + journey re-point), typecheck/build, deploy, verify, cutover.

## Testing & verification

- **Authorization test matrix:** for each kept function and RLS table, assert user A cannot
  read/mutate user B's row (IDOR regression guard).
- Re-point the 69 journey tests at Supabase Auth.
- Manual smoke: sign-up → trial seeded → checkout (Stripe test) → portal → create org →
  invite (magic link) → accept → role change → sign-out/in.

## Out of scope (deferred)

- Mandatory audit logging for Team+ (currently Enterprise-only).
- Rate-limiting edge functions.
- Adding GitHub/Google providers (wired to be a later one-liner).

## Riskiest steps

- RLS over/under-tightening (lockout vs re-opening IDOR) → enforce the authorization test matrix.
- Hard-cutover window where old functions meet new schema → no users, so harmless; sequence anyway.
- `subscriptions.auth_user_id` UNIQUE during re-key → trivial here (rows wiped first).
