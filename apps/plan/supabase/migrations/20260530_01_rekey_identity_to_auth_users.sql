-- Migration: Re-key identity columns from Clerk TEXT ids to auth.users UUID
-- Date: 2026-05-30
-- Part of the Clerk -> Supabase Auth migration (clean-slate hard cutover).
--
-- The app is pre-revenue; the only identity rows are founder test data, so we
-- wipe them and rebuild the columns natively on auth.users(id) UUID. There is
-- no data to preserve, hence no backfill / id-mapping.

begin;

-- ----------------------------------------------------------------------------
-- 0. Wipe disposable test data (founder trials + a default test org).
--    enterprise_inquiries holds a contact-form row with no identity -> kept.
-- ----------------------------------------------------------------------------
truncate table
  public.license_activations,
  public.licenses,
  public.audit_logs,
  public.license_downloads,
  public.organization_invites,
  public.organization_members,
  public.organizations,
  public.subscriptions
restart identity cascade;

-- ----------------------------------------------------------------------------
-- 1. subscriptions.clerk_user_id (TEXT UNIQUE NOT NULL) -> auth_user_id (UUID)
--    Nullable: individual subs key on auth_user_id; team subs key on
--    organization_id. UNIQUE permits many NULLs in Postgres.
-- ----------------------------------------------------------------------------
drop index if exists public.idx_subscriptions_clerk_user_id;
alter table public.subscriptions drop column clerk_user_id;        -- drops its UNIQUE too
alter table public.subscriptions
  add column auth_user_id uuid unique references auth.users(id) on delete cascade;
create index idx_subscriptions_auth_user_id on public.subscriptions(auth_user_id);

-- ----------------------------------------------------------------------------
-- 2. organization_members.user_id (TEXT) -> UUID, preserve composite uniques
-- ----------------------------------------------------------------------------
drop index if exists public.idx_organization_members_user_id;
alter table public.organization_members drop column user_id;        -- drops UNIQUE(org,user)
alter table public.organization_members
  add column user_id uuid not null references auth.users(id) on delete cascade;
alter table public.organization_members
  add constraint organization_members_organization_id_user_id_key unique (organization_id, user_id);
create index idx_organization_members_user_id on public.organization_members(user_id);

-- ----------------------------------------------------------------------------
-- 3. organization_invites.invited_by (TEXT) -> UUID (nullable, audit only)
-- ----------------------------------------------------------------------------
alter table public.organization_invites drop column invited_by;
alter table public.organization_invites
  add column invited_by uuid references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 4. audit_logs.user_id (TEXT) -> UUID (nullable for system actions)
-- ----------------------------------------------------------------------------
drop index if exists public.idx_audit_logs_user_id;
alter table public.audit_logs drop column user_id;
alter table public.audit_logs
  add column user_id uuid references auth.users(id) on delete set null;
create index idx_audit_logs_user_id on public.audit_logs(user_id);

-- ----------------------------------------------------------------------------
-- 5. license_downloads.user_id (TEXT) -> UUID (nullable analytics)
-- ----------------------------------------------------------------------------
drop index if exists public.idx_license_downloads_user_id;
alter table public.license_downloads drop column user_id;
alter table public.license_downloads
  add column user_id uuid references auth.users(id) on delete set null;
create index idx_license_downloads_user_id on public.license_downloads(user_id);

-- ----------------------------------------------------------------------------
-- 6. licenses.customer_id (dual-use TEXT) -> split:
--    auth_user_id (UUID identity, nullable for guest purchases) +
--    stripe_customer_id (TEXT billing). customer_email is retained.
-- ----------------------------------------------------------------------------
drop index if exists public.idx_licenses_customer_id;
alter table public.licenses drop column customer_id;
alter table public.licenses
  add column auth_user_id uuid references auth.users(id) on delete set null;
alter table public.licenses
  add column stripe_customer_id text;
create index idx_licenses_auth_user_id on public.licenses(auth_user_id);
create index idx_licenses_stripe_customer_id on public.licenses(stripe_customer_id);

-- ----------------------------------------------------------------------------
-- 7. license_activations: add auth_user_id so "my devices" views are possible
-- ----------------------------------------------------------------------------
alter table public.license_activations
  add column auth_user_id uuid references auth.users(id) on delete set null;
create index idx_license_activations_auth_user_id on public.license_activations(auth_user_id);

commit;
