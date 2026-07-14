-- Talaash HQ migration 2: accounts + viewer/editor roles.
-- Run AFTER schema.sql. Everything in the app now requires a login;
-- writes require the editor role. The public check-in page keeps working
-- without a login via security-definer RPCs.

-- ---------- profiles (one row per account) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Auto-create a profile on signup. Rishi's emails bootstrap as editor;
-- everyone else starts as viewer and gets promoted in-app.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    coalesce(new.email, ''),
    case when lower(coalesce(new.email, '')) in ('menonrishi5@gmail.com', 'rishimenon@utexas.edu')
      then 'editor' else 'viewer' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_editor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'editor')
$$;

drop policy if exists "auth read profiles" on public.profiles;
create policy "auth read profiles" on public.profiles
  for select to authenticated using (true);
drop policy if exists "editors manage roles" on public.profiles;
create policy "editors manage roles" on public.profiles
  for update to authenticated using (is_editor()) with check (is_editor());

-- ---------- lock down existing tables ----------
-- app_state
drop policy if exists "anon full access" on public.app_state;
drop policy if exists "auth read" on public.app_state;
create policy "auth read" on public.app_state
  for select to authenticated using (true);
drop policy if exists "editor insert" on public.app_state;
create policy "editor insert" on public.app_state
  for insert to authenticated with check (is_editor());
drop policy if exists "editor update" on public.app_state;
create policy "editor update" on public.app_state
  for update to authenticated using (is_editor()) with check (is_editor());
drop policy if exists "editor delete" on public.app_state;
create policy "editor delete" on public.app_state
  for delete to authenticated using (is_editor());

-- attendance_sessions
drop policy if exists "anon full access" on public.attendance_sessions;
drop policy if exists "auth read" on public.attendance_sessions;
create policy "auth read" on public.attendance_sessions
  for select to authenticated using (true);
drop policy if exists "editor insert" on public.attendance_sessions;
create policy "editor insert" on public.attendance_sessions
  for insert to authenticated with check (is_editor());
drop policy if exists "editor update" on public.attendance_sessions;
create policy "editor update" on public.attendance_sessions
  for update to authenticated using (is_editor()) with check (is_editor());
drop policy if exists "editor delete" on public.attendance_sessions;
create policy "editor delete" on public.attendance_sessions
  for delete to authenticated using (is_editor());

-- checkins (inserts still happen only through check_in())
drop policy if exists "anon read" on public.checkins;
drop policy if exists "anon delete" on public.checkins;
drop policy if exists "auth read" on public.checkins;
create policy "auth read" on public.checkins
  for select to authenticated using (true);
drop policy if exists "editor delete" on public.checkins;
create policy "editor delete" on public.checkins
  for delete to authenticated using (is_editor());

-- payments
drop policy if exists "anon full access" on public.payments;
drop policy if exists "auth read" on public.payments;
create policy "auth read" on public.payments
  for select to authenticated using (true);
drop policy if exists "editor insert" on public.payments;
create policy "editor insert" on public.payments
  for insert to authenticated with check (is_editor());
drop policy if exists "editor update" on public.payments;
create policy "editor update" on public.payments
  for update to authenticated using (is_editor()) with check (is_editor());
drop policy if exists "editor delete" on public.payments;
create policy "editor delete" on public.payments
  for delete to authenticated using (is_editor());

-- storage: public read stays (file URLs), writes become editor-only
drop policy if exists "anon insert files" on storage.objects;
drop policy if exists "anon update files" on storage.objects;
drop policy if exists "anon delete files" on storage.objects;
drop policy if exists "editor insert files" on storage.objects;
create policy "editor insert files" on storage.objects
  for insert to authenticated with check (bucket_id = 'files' and public.is_editor());
drop policy if exists "editor update files" on storage.objects;
create policy "editor update files" on storage.objects
  for update to authenticated
  using (bucket_id = 'files' and public.is_editor())
  with check (bucket_id = 'files' and public.is_editor());
drop policy if exists "editor delete files" on storage.objects;
create policy "editor delete files" on storage.objects
  for delete to authenticated using (bucket_id = 'files' and public.is_editor());

-- ---------- public check-in support (no login needed) ----------
-- The check-in page can no longer read tables directly; this hands it
-- exactly what it needs and nothing else (no password, no fine config).
create or replace function public.get_checkin_info()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s record;
  r jsonb;
begin
  select id, session_date into s
    from attendance_sessions
    where session_date = (now() at time zone 'America/Chicago')::date;
  select data into r from app_state where key = 'roster';
  return jsonb_build_object(
    'session',
    case when s.id is null then null
      else jsonb_build_object('id', s.id, 'session_date', s.session_date) end,
    'roster', coalesce(r, '[]'::jsonb)
  );
end;
$$;
