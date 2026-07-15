-- Talaash HQ migration 5: schedule the benching-notify edge function.
-- Run AFTER the "benching-notify" function is deployed and the
-- SLACK_BOT_TOKEN secret is set. Safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-create the job idempotently.
do $$
begin
  perform cron.unschedule('benching-notify');
exception when others then
  null; -- job didn't exist yet
end $$;

select cron.schedule(
  'benching-notify',
  '*/10 * * * *',  -- every 10 minutes
  $$
  select net.http_post(
    url := 'https://rsltynrrehmpaarzwpew.supabase.co/functions/v1/benching-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbHR5bnJyZWhtcGFhcnp3cGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDU0MDQsImV4cCI6MjA5OTQ4MTQwNH0.GOI71nqr9XR06ycHnFvYyLG-MHcRJ_Dmz4tEd02Orlg'
    ),
    body := '{}'::jsonb
  );
  $$
);
