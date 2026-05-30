-- Migration: Function hardening (clears Supabase security-advisor warnings)
-- Date: 2026-05-30
-- - Pin search_path on legacy functions (function_search_path_mutable).
-- - Revoke API EXECUTE on the trigger function and helpers from roles that
--   never legitimately call them. Note: is_org_* MUST keep EXECUTE for the
--   `authenticated` role because RLS policies (to authenticated) evaluate them
--   as the calling user; we only revoke `anon`, which never hits those policies.

begin;

-- Pin search_path on pre-existing functions.
alter function public.update_updated_at_column() set search_path = public;
alter function public.update_organizations_updated_at() set search_path = public;
alter function public.get_available_seats(uuid) set search_path = public;
alter function public.generate_invite_token() set search_path = public;

-- handle_new_user is a trigger function only; triggers don't need API EXECUTE.
revoke execute on function public.handle_new_user() from anon, authenticated;

-- RLS helpers: anon never evaluates the (to authenticated) policies, so it has
-- no reason to call these via RPC. Keep authenticated (RLS needs it).
revoke execute on function public.is_org_member(uuid, uuid) from anon;
revoke execute on function public.is_org_admin(uuid, uuid) from anon;
revoke execute on function public.is_org_owner(uuid, uuid) from anon;

-- Seat/token helpers are only used by service-role edge functions / SQL defaults.
revoke execute on function public.get_available_seats(uuid) from anon, authenticated;
revoke execute on function public.generate_invite_token() from anon, authenticated;

commit;
