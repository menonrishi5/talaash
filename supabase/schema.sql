-- Talaash HQ — Supabase schema. Run once in the SQL Editor.
-- Trust model (v1, no logins): the anon key can read/write everything below.
-- Check-in timestamps and fines are computed server-side in check_in().

-- ---------- JSON document store for admin modules ----------
-- roster / segments / practiceBlocks / benching live here as one doc each.
create table if not exists public.app_state (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;
drop policy if exists "anon full access" on public.app_state;
create policy "anon full access" on public.app_state
  for all using (true) with check (true);

-- ---------- Attendance ----------
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null unique,
  cutoff_min int not null default 1140,      -- minutes since midnight; 1140 = 7:00 PM
  grace_min int not null default 5,          -- no fine until cutoff + grace
  tier1_until_min int not null default 30,   -- tier1 fine until cutoff + this
  tier1_amount numeric not null default 5,
  tier2_amount numeric not null default 10,
  fines_active boolean not null default true,
  password text not null,
  created_at timestamptz not null default now()
);
alter table public.attendance_sessions enable row level security;
drop policy if exists "anon full access" on public.attendance_sessions;
create policy "anon full access" on public.attendance_sessions
  for all using (true) with check (true);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  member_id text not null,
  member_name text not null,
  checked_at timestamptz not null default now(),
  mins_late int not null default 0,
  fine numeric not null default 0,
  unique (session_id, member_id)
);
alter table public.checkins enable row level security;
drop policy if exists "anon read" on public.checkins;
create policy "anon read" on public.checkins for select using (true);
drop policy if exists "anon delete" on public.checkins;
create policy "anon delete" on public.checkins for delete using (true);
-- No anon insert/update: rows are created only through check_in(), so the
-- server clock decides lateness.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id text,
  member_name text,
  amount numeric not null,
  source text not null default 'manual',     -- 'manual' | 'zeffy'
  external_id text,                          -- Zeffy payment id for dedupe
  note text,
  paid_at timestamptz not null default now()
);
alter table public.payments enable row level security;
drop policy if exists "anon full access" on public.payments;
create policy "anon full access" on public.payments
  for all using (true) with check (true);

-- ---------- Check-in RPC (server-authoritative time + fine) ----------
create or replace function public.check_in(
  p_session uuid,
  p_member_id text,
  p_member_name text,
  p_password text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  existing record;
  local_ts timestamp;
  mins numeric;
  v_mins_late int := 0;
  v_fine numeric := 0;
  row_out record;
begin
  select * into s from attendance_sessions where id = p_session;
  if not found then
    return json_build_object('ok', false, 'error', 'Session not found.');
  end if;

  if lower(trim(s.password)) <> lower(trim(coalesce(p_password, ''))) then
    return json_build_object('ok', false, 'error', 'Wrong password — check the code announced at practice.');
  end if;

  select * into existing from checkins
    where session_id = p_session and member_id = p_member_id;
  if found then
    return json_build_object(
      'ok', true, 'already', true,
      'checked_at', existing.checked_at,
      'mins_late', existing.mins_late,
      'fine', existing.fine
    );
  end if;

  -- Team practices in Texas.
  local_ts := now() at time zone 'America/Chicago';
  mins := extract(hour from local_ts) * 60
        + extract(minute from local_ts)
        + extract(second from local_ts) / 60.0;

  if mins > s.cutoff_min then
    v_mins_late := ceil(mins - s.cutoff_min);
  end if;
  if s.fines_active and mins > s.cutoff_min + s.grace_min then
    if mins <= s.cutoff_min + s.tier1_until_min then
      v_fine := s.tier1_amount;
    else
      v_fine := s.tier2_amount;
    end if;
  end if;

  insert into checkins (session_id, member_id, member_name, mins_late, fine)
  values (p_session, p_member_id, p_member_name, v_mins_late, v_fine)
  returning * into row_out;

  return json_build_object(
    'ok', true, 'already', false,
    'checked_at', row_out.checked_at,
    'mins_late', row_out.mins_late,
    'fine', row_out.fine
  );
end;
$$;

-- ---------- File storage (forms PDFs, audio mixes) ----------
insert into storage.buckets (id, name, public)
values ('files', 'files', true)
on conflict (id) do nothing;

drop policy if exists "anon read files" on storage.objects;
create policy "anon read files" on storage.objects
  for select using (bucket_id = 'files');
drop policy if exists "anon insert files" on storage.objects;
create policy "anon insert files" on storage.objects
  for insert with check (bucket_id = 'files');
drop policy if exists "anon update files" on storage.objects;
create policy "anon update files" on storage.objects
  for update using (bucket_id = 'files') with check (bucket_id = 'files');
drop policy if exists "anon delete files" on storage.objects;
create policy "anon delete files" on storage.objects
  for delete using (bucket_id = 'files');
