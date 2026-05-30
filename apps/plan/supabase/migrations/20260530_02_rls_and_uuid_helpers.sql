-- Migration: UUID org helpers + real row-level security
-- Date: 2026-05-30
-- Replaces the service-role-only policies with row-level policies keyed on
-- auth.uid(). This is the structural fix for the IDOR class: identity is now
-- derived from the verified JWT in the database, not asserted by the caller.
-- (service_role still bypasses RLS, so privileged edge functions are unaffected.)

begin;

-- ----------------------------------------------------------------------------
-- Helper functions: re-typed to UUID, default the user to auth.uid() so they
-- can power RLS policies directly. SECURITY DEFINER so they bypass RLS on
-- organization_members (prevents recursive policy evaluation).
-- ----------------------------------------------------------------------------
drop function if exists public.is_org_member(uuid, text);
drop function if exists public.is_org_admin(uuid, text);
drop function if exists public.is_org_owner(uuid, text);

create or replace function public.is_org_member(org_id uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and user_id = uid
      and joined_at is not null
  );
$$;

create or replace function public.is_org_admin(org_id uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and user_id = uid
      and role in ('owner', 'admin')
      and joined_at is not null
  );
$$;

create or replace function public.is_org_owner(org_id uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and user_id = uid
      and role = 'owner'
      and joined_at is not null
  );
$$;

-- ----------------------------------------------------------------------------
-- Drop the old service-role-only / using(true) policies.
-- ----------------------------------------------------------------------------
drop policy if exists "Users can read own subscription" on public.subscriptions;
drop policy if exists "Service role access for licenses" on public.licenses;
drop policy if exists "Service role access for activations" on public.license_activations;
drop policy if exists "Service role access for organizations" on public.organizations;
drop policy if exists "Service role access for organization_members" on public.organization_members;
drop policy if exists "Service role access for organization_invites" on public.organization_invites;
drop policy if exists "Service role access for audit_logs" on public.audit_logs;
drop policy if exists "Service role access for license_downloads" on public.license_downloads;

-- ----------------------------------------------------------------------------
-- New row-level policies (SELECT for users; writes flow through service_role
-- edge functions, which bypass RLS). Multiple permissive policies are OR'd.
-- ----------------------------------------------------------------------------

-- subscriptions: your own individual sub, or your org's team sub.
create policy "read own or org subscription" on public.subscriptions
  for select to authenticated
  using (
    auth.uid() = auth_user_id
    or (organization_id is not null and public.is_org_member(organization_id))
  );

-- licenses: your own, or your org's.
create policy "read own or org licenses" on public.licenses
  for select to authenticated
  using (
    auth.uid() = auth_user_id
    or (organization_id is not null and public.is_org_member(organization_id))
  );

-- license_activations: tied to a license you own.
create policy "read own license activations" on public.license_activations
  for select to authenticated
  using (
    auth.uid() = auth_user_id
    or exists (
      select 1 from public.licenses l
      where l.id = license_activations.license_id
        and (
          l.auth_user_id = auth.uid()
          or (l.organization_id is not null and public.is_org_member(l.organization_id))
        )
    )
  );

-- organizations: members read; owners update.
create policy "members read org" on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy "owners update org" on public.organizations
  for update to authenticated
  using (public.is_org_owner(id))
  with check (public.is_org_owner(id));

-- organization_members: members see co-members; admins manage.
create policy "members read members" on public.organization_members
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy "admins manage members" on public.organization_members
  for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- organization_invites: admins only.
create policy "admins manage invites" on public.organization_invites
  for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- audit_logs: admins/owners read (matches canViewAuditLogs).
create policy "admins read audit logs" on public.audit_logs
  for select to authenticated
  using (public.is_org_admin(organization_id));

-- license_downloads: your own, or org admins.
create policy "read own or org downloads" on public.license_downloads
  for select to authenticated
  using (
    auth.uid() = user_id
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

commit;
