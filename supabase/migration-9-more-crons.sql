-- Talaash HQ migration 9: schedule the backup and weekly-digest functions.
-- Run AFTER both functions are deployed. Idempotent.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin perform cron.unschedule('weekly-backup'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('weekly-digest'); exception when others then null; end $$;

-- Weekly backup — Sundays 08:00 UTC.
select cron.schedule('weekly-backup', '0 8 * * 0', $$
  select net.http_post(
    url := 'https://rsltynrrehmpaarzwpew.supabase.co/functions/v1/backup',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbHR5bnJyZWhtcGFhcnp3cGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDU0MDQsImV4cCI6MjA5OTQ4MTQwNH0.GOI71nqr9XR06ycHnFvYyLG-MHcRJ_Dmz4tEd02Orlg'),
    body := '{}'::jsonb);
$$);

-- Weekly benching digest — Mondays 15:00 UTC (~9-10am Central).
select cron.schedule('weekly-digest', '0 15 * * 1', $$
  select net.http_post(
    url := 'https://rsltynrrehmpaarzwpew.supabase.co/functions/v1/weekly-digest',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbHR5bnJyZWhtcGFhcnp3cGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDU0MDQsImV4cCI6MjA5OTQ4MTQwNH0.GOI71nqr9XR06ycHnFvYyLG-MHcRJ_Dmz4tEd02Orlg'),
    body := '{}'::jsonb);
$$);
