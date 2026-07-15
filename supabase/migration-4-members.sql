-- Talaash HQ migration 4: member identities, own-only money, benching
-- responses, reimbursements. Run AFTER migration-3-zeffy.sql.

-- ---------- link accounts to roster members ----------
alter table public.profiles add column if not exists member_id text;

create or replace function public.my_member_id()
returns text language sql stable security definer set search_path = public
as $$ select member_id from profiles where id = auth.uid() $$;

-- ---------- zeffy payments: server-side member match ----------
-- Computed by the zeffy-sync edge function (same precedence as the app:
-- manual link > full name > unique last name > unique first name).
alter table public.zeffy_payments add column if not exists matched_member_id text;

drop policy if exists "auth read" on public.zeffy_payments;
drop policy if exists "editor or own read" on public.zeffy_payments;
create policy "editor or own read" on public.zeffy_payments
  for select to authenticated
  using (is_editor() or matched_member_id = my_member_id());

-- ---------- own-only money reads ----------
drop policy if exists "auth read" on public.payments;
drop policy if exists "editor or own read" on public.payments;
create policy "editor or own read" on public.payments
  for select to authenticated
  using (is_editor() or member_id = my_member_id());

drop policy if exists "auth read" on public.checkins;
drop policy if exists "editor or own read" on public.checkins;
create policy "editor or own read" on public.checkins
  for select to authenticated
  using (is_editor() or member_id = my_member_id());

-- The dues doc (overrides, credits, links) reveals everyone's balances —
-- editors only. Everything else in app_state stays team-readable.
drop policy if exists "auth read" on public.app_state;
drop policy if exists "read non-dues" on public.app_state;
create policy "read non-dues" on public.app_state
  for select to authenticated
  using (key <> 'dues' or is_editor());

-- Viewers get their own dues context through this instead.
create or replace function public.get_my_dues()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  d jsonb;
begin
  if mid is null then
    return jsonb_build_object('linked', false);
  end if;
  select data into d from app_state where key = 'dues';
  d := coalesce(d, '{}'::jsonb);
  return jsonb_build_object(
    'linked', true,
    'member_id', mid,
    'categories', coalesce(d->'categories', '[]'::jsonb),
    'overrides', coalesce(d->'overrides'->mid, '{}'::jsonb),
    'donation_credit_ids',
      coalesce((select jsonb_agg(k) from jsonb_object_keys(coalesce(d->'donationCredits', '{}'::jsonb)) as t(k)), '[]'::jsonb),
    'excluded_campaigns', coalesce(d->'excludedCampaigns', '{}'::jsonb)
  );
end $$;

-- ---------- benching slot responses (accept / decline) ----------
create table if not exists public.slot_responses (
  id uuid primary key default gen_random_uuid(),
  week_iso text not null,           -- Monday of the week, YYYY-MM-DD
  slot_id text not null,            -- template slot id
  member_id text not null,          -- the assigned member responding
  status text not null check (status in ('accepted', 'declined')),
  responded_at timestamptz not null default now(),
  unique (week_iso, slot_id)
);
alter table public.slot_responses enable row level security;
drop policy if exists "auth read" on public.slot_responses;
create policy "auth read" on public.slot_responses
  for select to authenticated using (true);
drop policy if exists "own or editor insert" on public.slot_responses;
create policy "own or editor insert" on public.slot_responses
  for insert to authenticated
  with check (member_id = my_member_id() or is_editor());
drop policy if exists "own or editor update" on public.slot_responses;
create policy "own or editor update" on public.slot_responses
  for update to authenticated
  using (member_id = my_member_id() or is_editor())
  with check (member_id = my_member_id() or is_editor());
drop policy if exists "editor delete" on public.slot_responses;
create policy "editor delete" on public.slot_responses
  for delete to authenticated using (is_editor());

-- ---------- reimbursements ----------
create table if not exists public.reimbursements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  member_id text,
  amount_cents integer not null,
  description text not null,
  purchase_date date,
  category text,
  receipt_file_id text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'paid')),
  approved_amount_cents integer,
  dues_credit_cents integer not null default 0,  -- offset against dues owed
  paid_amount_cents integer,                     -- actual cash paid back
  decision_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  paid_at timestamptz
);
alter table public.reimbursements enable row level security;
drop policy if exists "editor or own read" on public.reimbursements;
create policy "editor or own read" on public.reimbursements
  for select to authenticated
  using (is_editor() or profile_id = auth.uid() or member_id = my_member_id());
drop policy if exists "own insert" on public.reimbursements;
create policy "own insert" on public.reimbursements
  for insert to authenticated with check (profile_id = auth.uid());
drop policy if exists "editor update" on public.reimbursements;
create policy "editor update" on public.reimbursements
  for update to authenticated using (is_editor()) with check (is_editor());
drop policy if exists "own pending delete" on public.reimbursements;
create policy "own pending delete" on public.reimbursements
  for delete to authenticated
  using (is_editor() or (profile_id = auth.uid() and status = 'pending'));

-- Receipt uploads: any signed-in user, restricted to receipt-* file names.
drop policy if exists "receipt uploads" on storage.objects;
create policy "receipt uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'files' and name like 'receipt-%');

-- ---------- notification log (written by benching-notify, service role) ----------
create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  occ_key text not null,   -- weekISO:slotId
  kind text not null,      -- accept-request | day-before | reserve-called | day-of | hour-before
  member_id text,
  detail text,
  sent_at timestamptz not null default now(),
  unique (occ_key, kind)
);
alter table public.notification_log enable row level security;
drop policy if exists "editor read" on public.notification_log;
create policy "editor read" on public.notification_log
  for select to authenticated using (is_editor());
