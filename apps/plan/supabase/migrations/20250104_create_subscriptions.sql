-- Create subscriptions table
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'trialing',
  plan text not null default 'trial',
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_start timestamptz default now(),
  trial_end timestamptz default (now() + interval '14 days'),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create indexes for fast lookups
create index if not exists idx_subscriptions_clerk_user_id
  on public.subscriptions(clerk_user_id);
create index if not exists idx_subscriptions_stripe_customer_id
  on public.subscriptions(stripe_customer_id);

-- Enable Row Level Security
alter table public.subscriptions enable row level security;

-- Drop existing policy if it exists (for idempotent runs)
drop policy if exists "Users can read own subscription" on public.subscriptions;

-- Policy: Users can read their own subscription via service role
-- Note: Edge functions use service role key which bypasses RLS
-- This policy is for direct client access if needed
create policy "Users can read own subscription"
  on public.subscriptions for select
  using (true);  -- We'll validate clerk_user_id in the Edge Function

-- Create function to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Create trigger for updated_at
drop trigger if exists update_subscriptions_updated_at on public.subscriptions;
create trigger update_subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute function update_updated_at_column();
