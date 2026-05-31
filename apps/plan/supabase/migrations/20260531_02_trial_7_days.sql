-- Reduce the free trial from 14 days to 7 days (FORWARD-ONLY).
-- ⚠️ STAGED — apply via Supabase MCP (apply_migration) / `supabase db push` after review.
-- Existing trialing rows are intentionally left untouched; only new signups get 7 days.

begin;

-- Trial is seeded by the on_auth_user_created trigger -> handle_new_user().
-- Re-create it identically except for the trial length.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (auth_user_id, status, plan, trial_start, trial_end)
  values (new.id, 'trialing', 'trial', now(), now() + interval '7 days')
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

-- Preserve the earlier lockdown (advisor cleanup revoked PUBLIC execute on this fn).
revoke execute on function public.handle_new_user() from public;

-- Backstop: the column default (the trigger sets trial_end explicitly anyway).
alter table public.subscriptions alter column trial_end set default (now() + interval '7 days');

commit;
