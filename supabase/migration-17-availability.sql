-- Talaash HQ migration 17: after-7 practice availability. Members mark the
-- 30-min blocks they CAN'T make (7:00–11:00 PM). Weekly default + per-date
-- override. Powers the editor conflict-checker on the Practice Calendar.
-- Run after migration-2. Idempotent.

-- key: 'w:0'..'w:6' (weekday, Mon=0) for the weekly default, or 'd:YYYY-MM-DD'
-- for a specific practice. busy: 30-min block indices busy (0 = 7:00–7:30 …
-- 7 = 10:30–11:00).
create table if not exists public.member_availability (
  member_id text not null,
  key text not null,
  busy int[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (member_id, key)
);
alter table public.member_availability enable row level security;

drop policy if exists "read own or editor" on public.member_availability;
create policy "read own or editor" on public.member_availability
  for select to authenticated using (is_editor() or member_id = my_member_id());

drop policy if exists "write own or editor" on public.member_availability;
create policy "write own or editor" on public.member_availability
  for all to authenticated
  using (is_editor() or member_id = my_member_id())
  with check (is_editor() or member_id = my_member_id());
