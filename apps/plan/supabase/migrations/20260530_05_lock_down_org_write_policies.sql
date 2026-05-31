-- Migration: lock down client-side write access to org tables
-- Date: 2026-05-30
--
-- Security fix (audit C1/H1/H2/L2). Migration 20260530_02 added
-- `FOR ALL TO authenticated` / `FOR UPDATE TO authenticated` policies on
-- organizations, organization_members and organization_invites. Because the
-- browser talks to PostgREST directly with the anon key + the user's JWT, those
-- policies let a logged-in user bypass every authorization rule that lives in
-- the edge functions by writing to the tables directly. Concretely:
--   * an admin could `update organization_members set role='owner'` on their own
--     row (self-promote), demote the real owner, add seats past the limit, or
--     delete co-members  (C1 / H1)
--   * an owner could `update organizations set plan='enterprise', seat_count=9999`
--     -> free enterprise + unlimited seats, bypassing Stripe   (H2)
--   * an admin could insert admin-role invites the owner-only path forbids  (L2)
--
-- All member/org/invite MUTATIONS already flow through service-role edge
-- functions (update-organization, invite-member, accept-invite,
-- update-member-role, remove-member, create-org-checkout) which authorize
-- correctly and bypass RLS. The browser only ever READS these tables directly
-- (apps/plan/src/lib/organization.ts uses .select() only). So we drop the
-- client write policies and keep SELECT.

begin;

-- ----------------------------------------------------------------------------
-- 1. Drop the over-broad client write policies.
-- ----------------------------------------------------------------------------
drop policy if exists "owners update org" on public.organizations;
drop policy if exists "admins manage members" on public.organization_members;
drop policy if exists "admins manage invites" on public.organization_invites;

-- The SELECT policies "members read org" and "members read members" from
-- 20260530_02 remain in place. organization_invites only had the FOR ALL
-- policy, which also served the admin read used by getOrganizationMembers()
-- (organization.ts:261). Re-add that read capability as SELECT-only.
drop policy if exists "admins read invites" on public.organization_invites;
create policy "admins read invites" on public.organization_invites
  for select to authenticated
  using (public.is_org_admin(organization_id));

-- ----------------------------------------------------------------------------
-- 2. Defense-in-depth: exactly one owner per organization.
--    (Note: fails if any org currently has >1 owner row — dedupe first if so.)
-- ----------------------------------------------------------------------------
create unique index if not exists organization_members_one_owner_per_org
  on public.organization_members (organization_id)
  where role = 'owner';

-- ----------------------------------------------------------------------------
-- 3. Defense-in-depth: never let a client role mutate billing/plan-controlled
--    columns on organizations, even if an UPDATE policy is re-added later.
--    Only enforced for the client-reachable roles (authenticated/anon);
--    service_role (edge functions / Stripe webhook) and DB/admin roles
--    (migrations, dashboard) are unaffected.
-- ----------------------------------------------------------------------------
create or replace function public.reject_org_billing_column_changes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.plan is distinct from old.plan
       or new.seat_count is distinct from old.seat_count
       or new.stripe_customer_id is distinct from old.stripe_customer_id then
      raise exception
        'plan, seat_count and stripe_customer_id may only be changed by service_role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_org_billing_changes on public.organizations;
create trigger trg_reject_org_billing_changes
  before update on public.organizations
  for each row execute function public.reject_org_billing_column_changes();

commit;
