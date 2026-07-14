-- Talaash HQ migration 3: Zeffy payment mirror.
-- Run AFTER migration-2-roles.sql.

-- Read-only mirror of Zeffy payments, written only by the zeffy-sync edge
-- function (service role). The app matches these to roster members and fee
-- categories client-side.
create table if not exists public.zeffy_payments (
  id text primary key,                 -- Zeffy payment id
  created timestamptz not null,
  amount_cents integer not null,
  currency text,
  status text,
  type text,
  refund_status text,
  description text,                    -- campaign title
  campaign_id text,
  buyer_email text,
  buyer_first text,
  buyer_last text,
  items jsonb not null default '[]',   -- line items incl. rate_id + amount
  raw jsonb not null,
  synced_at timestamptz not null default now()
);
alter table public.zeffy_payments enable row level security;
drop policy if exists "auth read" on public.zeffy_payments;
create policy "auth read" on public.zeffy_payments
  for select to authenticated using (true);
-- no insert/update/delete policies: only the service role writes here

-- Dedupe guard: a Zeffy payment can be recorded as a fine payment only once.
create unique index if not exists payments_external_id_idx
  on public.payments (external_id) where external_id is not null;
