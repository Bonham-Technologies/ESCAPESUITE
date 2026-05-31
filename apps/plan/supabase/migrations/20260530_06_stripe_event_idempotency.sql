-- Migration: Stripe webhook idempotency (audit M2)
-- Date: 2026-05-30
--
-- The webhook had no event-level idempotency. Stripe delivers at-least-once and
-- retries on any non-2xx, so a retried checkout.session.completed minted a brand
-- new signed license for the same payment each time (generate-license inserts
-- unconditionally; licenses.stripe_payment_id is only a non-unique index). Each
-- minted key is independently valid offline and effectively un-revocable.
--
-- This table lets the webhook claim an event.id before processing and skip
-- already-claimed events. service_role (the webhook) bypasses RLS; no other role
-- needs access, so RLS is enabled with no policies (deny-all for anon/authenticated).

begin;

create table if not exists public.processed_stripe_events (
  event_id text primary key,
  event_type text,
  processed_at timestamptz not null default now()
);

alter table public.processed_stripe_events enable row level security;

commit;
