-- Talaash HQ migration 8: security hardening + calendar feed groundwork.
-- Run AFTER migration-7. Idempotent.

-- ============================================================
-- 1. Hide the check-in password from non-editors
-- ============================================================
-- RLS is row-level, not column-level, and editors/viewers are the same
-- Postgres role — so the password moves to its own editor-only table.
-- check_in() (security definer) still reads it; the public page never sees it.

create table if not exists public.session_secrets (
  session_id uuid primary key references public.attendance_sessions(id) on delete cascade,
  password text not null
);
alter table public.session_secrets enable row level security;
drop policy if exists "editor all secrets" on public.session_secrets;
create policy "editor all secrets" on public.session_secrets
  for all to authenticated using (is_editor()) with check (is_editor());

-- Migrate any existing passwords, then drop the exposed column.
insert into public.session_secrets (session_id, password)
  select id, password from public.attendance_sessions
  where password is not null
  on conflict (session_id) do nothing;

alter table public.attendance_sessions drop column if exists password;

-- check_in(): read the password from session_secrets.
create or replace function public.check_in(
  p_session uuid,
  p_member_id text,
  p_member_name text,
  p_password text
) returns json
language plpgsql security definer set search_path = public
as $$
declare
  s record;
  secret text;
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
  if s.ended_at is not null then
    return json_build_object('ok', false, 'error', 'Check-in is closed for today.');
  end if;

  select password into secret from session_secrets where session_id = p_session;
  if lower(trim(coalesce(secret, ''))) <> lower(trim(coalesce(p_password, ''))) then
    return json_build_object('ok', false, 'error', 'Wrong password — check the code announced at practice.');
  end if;

  select * into existing from checkins
    where session_id = p_session and member_id = p_member_id;
  if found then
    return json_build_object('ok', true, 'already', true,
      'checked_at', existing.checked_at, 'mins_late', existing.mins_late, 'fine', existing.fine);
  end if;

  local_ts := now() at time zone 'America/Chicago';
  mins := extract(hour from local_ts) * 60 + extract(minute from local_ts) + extract(second from local_ts) / 60.0;
  if mins > s.cutoff_min then v_mins_late := ceil(mins - s.cutoff_min); end if;
  if s.fines_active and mins > s.cutoff_min + s.grace_min then
    v_fine := case when mins <= s.cutoff_min + s.tier1_until_min then s.tier1_amount else s.tier2_amount end;
  end if;

  insert into checkins (session_id, member_id, member_name, mins_late, fine)
  values (p_session, p_member_id, p_member_name, v_mins_late, v_fine)
  returning * into row_out;

  return json_build_object('ok', true, 'already', false,
    'checked_at', row_out.checked_at, 'mins_late', row_out.mins_late, 'fine', row_out.fine);
end;
$$;

-- ============================================================
-- 2. Per-member calendar token (unguessable .ics feed URL)
-- ============================================================
alter table public.profiles add column if not exists calendar_token text;
update public.profiles set calendar_token = gen_random_uuid()::text where calendar_token is null;
alter table public.profiles alter column calendar_token set default gen_random_uuid()::text;

-- New signups get a token too.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, calendar_token)
  values (
    new.id, coalesce(new.email, ''),
    case when lower(coalesce(new.email, '')) in ('menonrishi5@gmail.com', 'rishimenon@utexas.edu')
      then 'editor' else 'viewer' end,
    gen_random_uuid()::text
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Lets a logged-in member read their own calendar token (for the subscribe URL).
create or replace function public.my_calendar_token()
returns text language sql stable security definer set search_path = public
as $$ select calendar_token from profiles where id = auth.uid() $$;

-- ============================================================
-- 3. Private buckets: receipts (was public) + backups
-- ============================================================
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
  on conflict (id) do nothing;

-- Receipts: uploader or an editor may read; any signed-in user may upload
-- their own. Signed URLs (generated client-side) respect these policies.
drop policy if exists "receipts read" on storage.objects;
create policy "receipts read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (owner = auth.uid() or public.is_editor()));
drop policy if exists "receipts insert" on storage.objects;
create policy "receipts insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'receipts');
drop policy if exists "receipts delete" on storage.objects;
create policy "receipts delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (owner = auth.uid() or public.is_editor()));

-- Backups: editors read (download), only the service role writes.
drop policy if exists "backups read" on storage.objects;
create policy "backups read" on storage.objects
  for select to authenticated using (bucket_id = 'backups' and public.is_editor());
