-- Talaash HQ migration 30: guardrails after app_state was wiped twice
-- (2026-09-28 and 2026-11-11) by a client writing blank defaults over the
-- real data. Run after migration-29. Idempotent.
--
-- 1. REFUSE TO EMPTY THE ROSTER. Every wipe so far was one batch upsert of
--    all six app_state rows, one of which was roster -> []. A real team never
--    has an empty roster, and an error on that row rolls back the whole
--    batch, so the other five rows survive too.
-- 2. KEEP HISTORY. Every change to an app_state row saves the previous
--    version to app_state_history (30 days), so a bad write costs one
--    "undo" instead of everything since the last backup.
-- 3. DAILY BACKUPS instead of weekly (pair with a `backup` function
--    redeploy — it now keeps 30 files instead of 12).
--
-- To undo a bad change to a row (as the SQL editor / postgres role):
--   select id, key, changed_at, jsonb_typeof(data) from app_state_history
--     where key = 'segments' order by changed_at desc limit 10;
--   update app_state set data = (select data from app_state_history where id = <ID>),
--     updated_at = now() where key = 'segments';
-- If you ever genuinely need an empty roster: 
--   alter table app_state disable trigger app_state_guard;  ...  enable trigger.

-- ---------- history table ----------
create table if not exists public.app_state_history (
  id bigint generated always as identity primary key,
  key text not null,
  data jsonb not null,            -- the value BEFORE the change
  row_updated_at timestamptz,     -- that value's own updated_at
  changed_at timestamptz not null default now(),
  changed_by uuid,                -- auth user, null for SQL editor / service role
  op text not null                -- 'update' | 'delete'
);
create index if not exists app_state_history_key_changed
  on public.app_state_history (key, changed_at desc);
alter table public.app_state_history enable row level security;
drop policy if exists "editor read history" on public.app_state_history;
create policy "editor read history" on public.app_state_history
  for select to authenticated using (is_editor());
-- No insert/update/delete policies: only the trigger below writes here.

-- ---------- guard + history trigger ----------
create or replace function public.app_state_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  was_filled boolean;
  now_empty boolean;
begin
  if tg_op = 'DELETE' then
    insert into app_state_history (key, data, row_updated_at, changed_by, op)
    values (old.key, old.data, old.updated_at, auth.uid(), 'delete');
    return old;
  end if;

  -- Compute in variables: a CASE's THEN inside an IF condition would end
  -- the condition early in plpgsql.
  was_filled := case when jsonb_typeof(old.data) = 'array' then jsonb_array_length(old.data) > 0 else false end;
  now_empty  := case when jsonb_typeof(new.data) = 'array' then jsonb_array_length(new.data) = 0 else false end;
  if old.key = 'roster' and was_filled and now_empty then
    raise exception 'Refusing to empty the roster (a blank-data overwrite is blocked). Nothing was changed.'
      using errcode = 'check_violation';
  end if;

  if new.data is distinct from old.data then
    insert into app_state_history (key, data, row_updated_at, changed_by, op)
    values (old.key, old.data, old.updated_at, auth.uid(), 'update');
  end if;
  return new;
end;
$$;

drop trigger if exists app_state_guard on public.app_state;
create trigger app_state_guard
  before update or delete on public.app_state
  for each row execute function public.app_state_guard();

-- ---------- retention + daily backup ----------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin perform cron.unschedule('app-state-history-purge'); exception when others then null; end $$;
select cron.schedule('app-state-history-purge', '30 8 * * *', $$
  delete from public.app_state_history where changed_at < now() - interval '30 days';
$$);

do $$ begin perform cron.unschedule('weekly-backup'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('daily-backup'); exception when others then null; end $$;
select cron.schedule('daily-backup', '0 8 * * *', $$
  select net.http_post(
    url := 'https://rsltynrrehmpaarzwpew.supabase.co/functions/v1/backup',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbHR5bnJyZWhtcGFhcnp3cGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDU0MDQsImV4cCI6MjA5OTQ4MTQwNH0.GOI71nqr9XR06ycHnFvYyLG-MHcRJ_Dmz4tEd02Orlg'),
    body := '{}'::jsonb);
$$);
