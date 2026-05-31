-- Teardown of the retired seat-based teams/org backend.
--
-- ⚠️ STAGED FOR REVIEW — do NOT auto-apply. Apply via Supabase MCP
--    (apply_migration) or `supabase db push` after confirming.
--
-- Context: the seat-based teams/enterprise model was removed from the UI in #228
-- and its edge functions (create-org-checkout, create-organization, invite-member,
-- accept-invite, update-member-role, remove-member, update-organization) were
-- deleted. This removes the remaining DB surface.
--
-- Safe to apply:
--   * All four org tables are EMPTY (0 rows) — verified — so no data loss.
--   * No foreign keys reference them.
--   * The only remaining code references are DEAD `if (organization_id)` branches
--     in the KEPT functions generate-license / get-license-key /
--     get-licensed-download / webhook. Every kept license is user-scoped
--     (organization_id is always null), so those branches never execute and the
--     `OR (... is_org_*)` branches in the policies simplified below never match.
--
-- Companion cleanup (recommended alongside applying this): prune those dead org
-- branches from the four edge functions and redeploy, so source == deployed.

begin;

-- 1. Simplify policies on KEPT tables to drop their org branch.
--    ALTER POLICY changes only the USING expression (preserves cmd/roles).
alter policy "read own or org subscription" on public.subscriptions
  using (auth.uid() = auth_user_id);

alter policy "read own or org licenses" on public.licenses
  using (auth.uid() = auth_user_id);

alter policy "read own or org downloads" on public.license_downloads
  using (auth.uid() = user_id);

alter policy "read own license activations" on public.license_activations
  using (
    auth.uid() = auth_user_id
    or exists (
      select 1 from public.licenses l
      where l.id = license_activations.license_id
        and l.auth_user_id = auth.uid()
    )
  );

-- 2. Drop the seat/org tables (empty). CASCADE removes their own policies, the
--    organization_members_one_owner_per_org index, and the
--    trg_reject_org_billing_changes trigger on organizations.
drop table if exists public.audit_logs cascade;
drop table if exists public.organization_invites cascade;
drop table if exists public.organization_members cascade;
drop table if exists public.organizations cascade;

-- 3. Drop the now-unreferenced org helper/guard functions.
drop function if exists public.is_org_admin(uuid, uuid);
drop function if exists public.is_org_member(uuid, uuid);
drop function if exists public.is_org_owner(uuid, uuid);
drop function if exists public.get_available_seats(uuid);
drop function if exists public.reject_org_billing_column_changes();

-- 4. Drop the now-vestigial organization_id columns on kept tables.
alter table public.subscriptions     drop column if exists organization_id cascade;
alter table public.licenses          drop column if exists organization_id cascade;
alter table public.license_downloads drop column if exists organization_id cascade;

commit;
