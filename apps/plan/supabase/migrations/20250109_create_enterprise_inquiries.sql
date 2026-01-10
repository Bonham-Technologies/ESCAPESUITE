-- Create enterprise_inquiries table
create table if not exists public.enterprise_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text not null,
  message text,
  status text not null default 'new',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create indexes for fast lookups
create index if not exists idx_enterprise_inquiries_email
  on public.enterprise_inquiries(email);
create index if not exists idx_enterprise_inquiries_company
  on public.enterprise_inquiries(company);
create index if not exists idx_enterprise_inquiries_status
  on public.enterprise_inquiries(status);
create index if not exists idx_enterprise_inquiries_created_at
  on public.enterprise_inquiries(created_at desc);

-- Enable Row Level Security
alter table public.enterprise_inquiries enable row level security;

-- Policy: Only service role can access (Edge Functions)
-- No public access needed since this is admin-only data
drop policy if exists "Service role access" on public.enterprise_inquiries;
create policy "Service role access"
  on public.enterprise_inquiries for all
  using (false)  -- No direct client access
  with check (false);

-- Create trigger for updated_at (reuses existing function from subscriptions migration)
drop trigger if exists update_enterprise_inquiries_updated_at on public.enterprise_inquiries;
create trigger update_enterprise_inquiries_updated_at
  before update on public.enterprise_inquiries
  for each row
  execute function update_updated_at_column();
