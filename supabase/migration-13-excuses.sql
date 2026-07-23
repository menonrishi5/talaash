-- Talaash HQ migration 13: pre-practice excuse form. Run after migration-12.
-- Idempotent.

-- Fines that come from an excuse-adjusted cutoff must be approved before they
-- count, so checkins get a pending flag.
alter table public.checkins add column if not exists fine_pending boolean not null default false;

-- ---------- excuses ----------
-- One per member per practice date. 'late' = coming but arriving at
-- arrival_min (their new personal cutoff); 'absent' = not coming.
create table if not exists public.excuses (
  id uuid primary key default gen_random_uuid(),
  practice_date date not null,
  member_id text not null,
  profile_id uuid not null references auth.users(id) on delete cascade,
  coming boolean not null,
  arrival_min int,                       -- minutes since midnight; null if absent
  reason text not null,
  status text not null default 'auto'    -- late excuses: 'auto'; absent: pending|approved|denied
    check (status in ('auto', 'pending', 'approved', 'denied')),
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (practice_date, member_id)
);
alter table public.excuses enable row level security;
drop policy if exists "editor or own read" on public.excuses;
create policy "editor or own read" on public.excuses
  for select to authenticated using (is_editor() or member_id = my_member_id());
drop policy if exists "editor update" on public.excuses;
create policy "editor update" on public.excuses
  for update to authenticated using (is_editor()) with check (is_editor());
drop policy if exists "editor delete" on public.excuses;
create policy "editor delete" on public.excuses
  for delete to authenticated using (is_editor() or member_id = my_member_id());
-- inserts go only through submit_excuse()

-- ---------- submit_excuse: validates the window against the schedule ----------
create or replace function public.submit_excuse(
  p_date date, p_coming boolean, p_arrival_min int, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  cfg jsonb;
  sched jsonb;
  window_h numeric;
  wanted_day int;
  start_min int := null;
  entry jsonb;
  deadline timestamptz;
begin
  if mid is null then
    return jsonb_build_object('ok', false, 'error', 'Your account isn''t linked to a roster member yet.');
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'Please write a short explanation.');
  end if;
  if p_coming and p_arrival_min is null then
    return jsonb_build_object('ok', false, 'error', 'Tell us what time you''ll arrive.');
  end if;

  select data into cfg from app_state where key = 'settings';
  sched := coalesce(cfg->'practiceSchedule', '[]'::jsonb);
  window_h := coalesce((cfg->>'excuseWindowHours')::numeric, 5);

  -- Schedule day is 0=Mon..6=Sun; isodow is 1=Mon..7=Sun.
  wanted_day := extract(isodow from p_date)::int - 1;
  for entry in select * from jsonb_array_elements(sched) loop
    if (entry->>'day')::int = wanted_day then
      start_min := (entry->>'startMin')::int;
    end if;
  end loop;
  if start_min is null then
    return jsonb_build_object('ok', false, 'error', 'That day isn''t a scheduled practice.');
  end if;

  deadline := ((p_date::timestamp + (start_min || ' minutes')::interval)
                at time zone 'America/Chicago') - (window_h || ' hours')::interval;
  if now() > deadline then
    return jsonb_build_object('ok', false, 'error',
      'The excuse window for this practice has closed (' || window_h || 'h before start).');
  end if;

  insert into excuses (practice_date, member_id, profile_id, coming, arrival_min, reason, status)
  values (p_date, mid, auth.uid(), p_coming,
          case when p_coming then p_arrival_min else null end,
          trim(p_reason),
          case when p_coming then 'auto' else 'pending' end)
  on conflict (practice_date, member_id) do update
    set coming = excluded.coming, arrival_min = excluded.arrival_min,
        reason = excluded.reason, status = excluded.status,
        profile_id = excluded.profile_id, updated_at = now(),
        decided_at = null, decision_note = null;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- check_in: honor an approved late excuse's arrival time ----------
create or replace function public.check_in(
  p_session uuid,
  p_password text
) returns json
language plpgsql security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  v_name text;
  s record;
  secret text;
  existing record;
  ex record;
  eff_cutoff int;
  excused boolean := false;
  local_ts timestamp;
  mins numeric;
  v_mins_late int := 0;
  v_fine numeric := 0;
  row_out record;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Sign in with your Talaash HQ account to check in.');
  end if;
  if mid is null then
    return json_build_object('ok', false, 'error', 'Your account isn''t linked to a roster member — ask a board member to link it.');
  end if;

  select elem->>'name' into v_name
    from app_state, jsonb_array_elements(data) elem
    where key = 'roster' and elem->>'id' = mid;

  select * into s from attendance_sessions where id = p_session;
  if not found then return json_build_object('ok', false, 'error', 'Session not found.'); end if;
  if s.ended_at is not null then return json_build_object('ok', false, 'error', 'Check-in is closed for today.'); end if;

  select password into secret from session_secrets where session_id = p_session;
  if lower(trim(coalesce(secret, ''))) <> lower(trim(coalesce(p_password, ''))) then
    return json_build_object('ok', false, 'error', 'Wrong password — check the code announced at practice.');
  end if;

  select * into existing from checkins where session_id = p_session and member_id = mid;
  if found then
    return json_build_object('ok', true, 'already', true,
      'checked_at', existing.checked_at, 'mins_late', existing.mins_late, 'fine', existing.fine);
  end if;

  -- A "coming late" excuse for today shifts this member's personal cutoff.
  select * into ex from excuses
    where member_id = mid and practice_date = s.session_date and coming = true and arrival_min is not null;
  eff_cutoff := coalesce(ex.arrival_min, s.cutoff_min);
  excused := found;

  local_ts := now() at time zone 'America/Chicago';
  mins := extract(hour from local_ts) * 60 + extract(minute from local_ts) + extract(second from local_ts) / 60.0;
  if mins > eff_cutoff then v_mins_late := ceil(mins - eff_cutoff); end if;
  if s.fines_active and mins > eff_cutoff + s.grace_min then
    v_fine := case when mins <= eff_cutoff + s.tier1_until_min then s.tier1_amount else s.tier2_amount end;
  end if;

  insert into checkins (session_id, member_id, member_name, mins_late, fine, fine_pending)
  values (p_session, mid, coalesce(v_name, 'Unknown'), v_mins_late, v_fine, excused and v_fine > 0)
  returning * into row_out;

  return json_build_object('ok', true, 'already', false,
    'checked_at', row_out.checked_at, 'mins_late', row_out.mins_late, 'fine', row_out.fine,
    'pending', row_out.fine_pending, 'excused', excused);
end;
$$;
