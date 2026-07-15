-- Talaash HQ migration 6: Venmo transaction ledger (manual CSV import —
-- Venmo has no API). Treasury data: editors only. Run after migration-4.

create table if not exists public.venmo_transactions (
  id text primary key,               -- Venmo transaction ID from the statement
  datetime timestamptz,
  type text,                         -- Payment / Charge / Transfer / ...
  status text,
  note text,
  from_name text,
  to_name text,
  amount_cents integer not null,     -- negative = money out of the account
  category text,                     -- classified in-app
  member_id text,                    -- optional roster member association
  created_at timestamptz not null default now()
);
alter table public.venmo_transactions enable row level security;
drop policy if exists "editor all" on public.venmo_transactions;
create policy "editor all" on public.venmo_transactions
  for all to authenticated
  using (is_editor()) with check (is_editor());
