-- Talaash HQ migration 11: repair. migration-7 was skipped (ran 8 before 7),
-- so the ended_at column is missing AND check_in() references it — which
-- currently breaks check-ins. This establishes the correct final state
-- regardless of what ran before. Safe to run anytime; idempotent.

-- 1. The column End-session writes and check_in() reads.
alter table public.attendance_sessions add column if not exists ended_at timestamptz;

-- 2. check_in(): reads the password from session_secrets (post-migration-8)
--    and honors ended_at. This is the definitive version.
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

-- 3. get_checkin_info(): the public page needs the 'ended' flag so it can
--    show "closed" instead of the form.
create or replace function public.get_checkin_info()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s record;
  r jsonb;
begin
  select id, session_date, ended_at into s
    from attendance_sessions
    where session_date = (now() at time zone 'America/Chicago')::date;
  select data into r from app_state where key = 'roster';
  return jsonb_build_object(
    'session',
    case when s.id is null then null
      else jsonb_build_object(
        'id', s.id,
        'session_date', s.session_date,
        'ended', s.ended_at is not null
      ) end,
    'roster', coalesce(r, '[]'::jsonb)
  );
end;
$$;
