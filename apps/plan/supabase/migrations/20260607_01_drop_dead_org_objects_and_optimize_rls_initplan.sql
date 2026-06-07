-- Post-organizations-teardown DB housekeeping (health-audit P3).
--
-- Three independent, low-risk cleanups. No access-control semantics change:
--   1. Rename 3 RLS policies whose names still say "or org" — leftovers from the
--      removed organizations feature (#228/#230/#235). Their quals never had any
--      org logic (they already restrict to the owning auth user), so this is a
--      pure rename.
--   2. Optimize 6 RLS policies flagged by the auth_rls_initplan advisor: wrap
--      auth.uid()/auth.role() in a scalar subselect so Postgres evaluates them
--      ONCE per query (initplan) instead of once per row. Logic is identical.
--   3. Drop public.update_organizations_updated_at() — an orphaned trigger
--      function from the dropped organizations table (attached to zero triggers).
--
-- DDL is transactional, so the policy drop/recreate is atomic (no window where a
-- table is left without its read policy).

-- 1+2. contact_submissions: wrap auth.role() (auth_rls_initplan)
drop policy "Authenticated users can read" on public.contact_submissions;
create policy "Authenticated users can read"
  on public.contact_submissions
  for select
  using ((select auth.role()) = 'authenticated');

drop policy "Authenticated users can update" on public.contact_submissions;
create policy "Authenticated users can update"
  on public.contact_submissions
  for update
  using ((select auth.role()) = 'authenticated');

-- 2. license_activations: wrap both auth.uid() calls (auth_rls_initplan)
drop policy "read own license activations" on public.license_activations;
create policy "read own license activations"
  on public.license_activations
  for select
  to authenticated
  using (
    ((select auth.uid()) = auth_user_id)
    or (exists (
      select 1
      from public.licenses l
      where l.id = license_activations.license_id
        and l.auth_user_id = (select auth.uid())
    ))
  );

-- 1+2. license_downloads: drop dead "or org" name + wrap auth.uid()
drop policy "read own or org downloads" on public.license_downloads;
create policy "read own downloads"
  on public.license_downloads
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 1+2. licenses: drop dead "or org" name + wrap auth.uid()
drop policy "read own or org licenses" on public.licenses;
create policy "read own licenses"
  on public.licenses
  for select
  to authenticated
  using ((select auth.uid()) = auth_user_id);

-- 1+2. subscriptions: drop dead "or org" name + wrap auth.uid()
drop policy "read own or org subscription" on public.subscriptions;
create policy "read own subscription"
  on public.subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = auth_user_id);

-- 3. drop orphaned trigger function from the removed organizations feature
drop function if exists public.update_organizations_updated_at();
