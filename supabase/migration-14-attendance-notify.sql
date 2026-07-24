-- Talaash HQ migration 14: attendance Slack notifications. Run after
-- migration-13. Records which practices you've announced, so the automatic
-- window-close reminder and board summary only fire for those. Idempotent.

create table if not exists public.attendance_announcements (
  practice_date date primary key,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.attendance_announcements enable row level security;
drop policy if exists "auth read" on public.attendance_announcements;
create policy "auth read" on public.attendance_announcements
  for select to authenticated using (true);
drop policy if exists "editor write" on public.attendance_announcements;
create policy "editor write" on public.attendance_announcements
  for all to authenticated using (is_editor()) with check (is_editor());

-- Cron: drives the window-close reminder + board summary (the announce and
-- recap posts are triggered directly from the app). No-ops until the
-- attendance-notify function is deployed.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('attendance-notify'); exception when others then null; end $$;
select cron.schedule('attendance-notify', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://rsltynrrehmpaarzwpew.supabase.co/functions/v1/attendance-notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbHR5bnJyZWhtcGFhcnp3cGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDU0MDQsImV4cCI6MjA5OTQ4MTQwNH0.GOI71nqr9XR06ycHnFvYyLG-MHcRJ_Dmz4tEd02Orlg'),
    body := '{"kind":"cron"}'::jsonb);
$$);
