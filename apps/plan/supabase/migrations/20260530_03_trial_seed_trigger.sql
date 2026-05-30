-- Migration: Seed a 14-day trial on user signup
-- Date: 2026-05-30
-- Moves trial creation off its old home (a side effect of an *unauthenticated*
-- get-subscription fetch) into a trigger on auth.users INSERT, so every real
-- signup gets exactly one trialing subscription, atomically.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (auth_user_id, status, plan, trial_start, trial_end)
  values (new.id, 'trialing', 'trial', now(), now() + interval '14 days')
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
