-- Talaash HQ migration 29: per-segment check-in cutoffs. A practice can run
-- multiple segments back to back (e.g. Bhangra 7-8, Kuthu 8-10) where only
-- the members cast in the later segment need to arrive at its start time —
-- everyone else is still held to the base cutoff. Run after migration-22.
-- Idempotent.
--
-- `attendance_sessions.segment_cutoffs` is an optional jsonb map
-- { segmentId: cutoffMinutesSinceMidnight, ... }, set when the editor starts
-- the session (the app pre-fills it from that day's Practice Calendar
-- blocks). A member cast in one of the listed segments is held to the
-- EARLIEST cutoff among their segments; everyone else (not cast in any
-- listed segment, or no segment_cutoffs set at all) keeps using the
-- session's base `cutoff_min`, exactly like before this migration.

alter table public.attendance_sessions
  add column if not exists segment_cutoffs jsonb not null default '{}'::jsonb;

-- Shared by check_in() and get_checkin_info() so the fine math and the
-- check-in page's "on time until" both agree on the same member's cutoff.
create or replace function public.member_cutoff_min(p_session uuid, p_member_id text)
returns int
language plpgsql stable security definer set search_path = public
as $$
declare
  s record;
  my_segment_ids text[];
  my_cutoff int;
begin
  select cutoff_min, segment_cutoffs into s
    from attendance_sessions where id = p_session;
  if not found then return null; end if;

  select array_agg(seg->>'id')
    into my_segment_ids
    from app_state, jsonb_array_elements(data) seg
    where app_state.key = 'segments'
      and exists (
        select 1 from jsonb_array_elements(coalesce(seg->'members', '[]'::jsonb)) mm
        where mm->>'memberId' = p_member_id
      );

  if my_segment_ids is not null then
    select min((s.segment_cutoffs->>x)::int)
      into my_cutoff
      from unnest(my_segment_ids) as x
      where s.segment_cutoffs ? x;
  end if;

  return coalesce(my_cutoff, s.cutoff_min);
end;
$$;

-- ---------- check_in(): use the caller's segment-aware cutoff ----------
create or replace function public.check_in(
  p_session uuid,
  p_token text
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
  base_cutoff int;
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
  if secret is null or trim(coalesce(p_token, '')) = '' or secret <> p_token then
    return json_build_object('ok', false, 'error', 'That link isn''t valid for today''s check-in — scan the QR (or open the link) the board posted at practice.');
  end if;

  select * into existing from checkins where session_id = p_session and member_id = mid;
  if found then
    return json_build_object('ok', true, 'already', true,
      'checked_at', existing.checked_at, 'mins_late', existing.mins_late, 'fine', existing.fine);
  end if;

  -- Segment-aware base: members only cast in a later segment (e.g. Kuthu)
  -- are held to that segment's start, not the whole practice's.
  base_cutoff := public.member_cutoff_min(p_session, mid);

  -- A "coming late" excuse for today can push this member's personal cutoff
  -- LATER than their base cutoff (more lenient), but never earlier than it --
  -- filing an excuse must not make you more late than a teammate who filed
  -- nothing and arrived at the same minute.
  select * into ex from excuses
    where member_id = mid and practice_date = s.session_date and coming = true and arrival_min is not null;
  excused := found;
  eff_cutoff := greatest(base_cutoff, coalesce(ex.arrival_min, base_cutoff));

  local_ts := now() at time zone 'America/Chicago';
  mins := extract(hour from local_ts) * 60 + extract(minute from local_ts) + extract(second from local_ts) / 60.0;
  if mins > eff_cutoff then v_mins_late := ceil(mins - eff_cutoff); end if;
  if s.fines_active and mins > eff_cutoff + s.grace_min then
    v_fine := case when mins <= eff_cutoff + s.tier1_until_min then s.tier1_amount else s.tier2_amount end;
  end if;

  insert into checkins (session_id, member_id, member_name, mins_late, fine, fine_pending)
  values (p_session, mid, coalesce(v_name, 'Unknown'), v_mins_late, v_fine,
          excused and eff_cutoff > base_cutoff and v_fine > 0)
  returning * into row_out;

  return json_build_object('ok', true, 'already', false,
    'checked_at', row_out.checked_at, 'mins_late', row_out.mins_late, 'fine', row_out.fine,
    'pending', row_out.fine_pending, 'excused', excused);
end;
$$;

-- ---------- get_checkin_info(): tell the check-in page the caller's own cutoff ----------
create or replace function public.get_checkin_info()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  s record;
  r jsonb;
begin
  select * into s
    from attendance_sessions
    where session_date = (now() at time zone 'America/Chicago')::date;
  select data into r from app_state where key = 'roster';
  return jsonb_build_object(
    'session',
    case when s.id is null then null
      else jsonb_build_object(
        'id', s.id,
        'session_date', s.session_date,
        'ended', s.ended_at is not null,
        'cutoff_min', case when mid is null then s.cutoff_min else public.member_cutoff_min(s.id, mid) end,
        'grace_min', s.grace_min,
        'tier1_until_min', s.tier1_until_min,
        'tier1_amount', s.tier1_amount,
        'tier2_amount', s.tier2_amount,
        'fines_active', s.fines_active
      ) end,
    'roster', coalesce(r, '[]'::jsonb)
  );
end;
$$;
