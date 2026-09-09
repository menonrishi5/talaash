-- Talaash HQ migration 22: two check-in / roster fixes. Run after migration-21.
-- Idempotent.
--
-- 1. Lateness could come out WORSE for a member who filed a "running late"
--    excuse than for a teammate who filed nothing and walked in at the same
--    minute. `check_in()` used the excuse's stated arrival time as the
--    member's personal cutoff unconditionally -- so if the board set a later
--    session cutoff than the schedule's start time (a late practice), the
--    excuse's default arrival (schedule start + 30) landed BEFORE the real
--    cutoff and the member got charged minutes everyone else wasn't. An
--    excuse should only ever move your cutoff LATER (more lenient), never
--    earlier than the session's on-time cutoff.
--
-- 2. `merge_members(from, to)` collapses a duplicate roster member into the
--    real one across every table that stores a member id, so historical
--    check-ins / fines / benching responses follow the surviving member.
--    The roster JSON itself (app_state) is fixed client-side by the app.

-- ---------- 1. check_in(): excuse can only relax the cutoff ----------
drop function if exists public.check_in(uuid, text);

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

  -- A "coming late" excuse for today can push this member's personal cutoff
  -- LATER than the session's on-time cutoff (more lenient), but never earlier
  -- than it -- filing an excuse must not make you more late than a teammate
  -- who filed nothing and arrived at the same minute.
  select * into ex from excuses
    where member_id = mid and practice_date = s.session_date and coming = true and arrival_min is not null;
  excused := found;
  eff_cutoff := greatest(s.cutoff_min, coalesce(ex.arrival_min, s.cutoff_min));

  local_ts := now() at time zone 'America/Chicago';
  mins := extract(hour from local_ts) * 60 + extract(minute from local_ts) + extract(second from local_ts) / 60.0;
  if mins > eff_cutoff then v_mins_late := ceil(mins - eff_cutoff); end if;
  if s.fines_active and mins > eff_cutoff + s.grace_min then
    v_fine := case when mins <= eff_cutoff + s.tier1_until_min then s.tier1_amount else s.tier2_amount end;
  end if;

  insert into checkins (session_id, member_id, member_name, mins_late, fine, fine_pending)
  values (p_session, mid, coalesce(v_name, 'Unknown'), v_mins_late, v_fine,
          excused and eff_cutoff > s.cutoff_min and v_fine > 0)
  returning * into row_out;

  return json_build_object('ok', true, 'already', false,
    'checked_at', row_out.checked_at, 'mins_late', row_out.mins_late, 'fine', row_out.fine,
    'pending', row_out.fine_pending, 'excused', excused);
end;
$$;

-- ---------- 2. merge_members(): fold a duplicate roster member away ----------
create or replace function public.merge_members(p_from text, p_to text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  moved int := 0;
  c int;
begin
  if not is_editor() then
    return json_build_object('ok', false, 'error', 'Editors only.');
  end if;
  if p_from is null or p_to is null or trim(p_from) = '' or trim(p_to) = '' or p_from = p_to then
    return json_build_object('ok', false, 'error', 'Pick two different members to merge.');
  end if;

  update checkins set member_id = p_to where member_id = p_from;
  get diagnostics c = row_count; moved := moved + c;

  update payments set member_id = p_to where member_id = p_from;
  get diagnostics c = row_count; moved := moved + c;

  update reimbursements set member_id = p_to where member_id = p_from;
  get diagnostics c = row_count; moved := moved + c;

  update slot_responses set member_id = p_to where member_id = p_from;
  get diagnostics c = row_count; moved := moved + c;

  update cover_requests set from_member_id = p_to where from_member_id = p_from;
  update cover_requests set to_member_id   = p_to where to_member_id   = p_from;

  -- excuses: unique (practice_date, member_id) -- only move rows that won't collide
  update excuses set member_id = p_to
   where member_id = p_from
     and not exists (
       select 1 from excuses e2 where e2.member_id = p_to and e2.practice_date = excuses.practice_date
     );
  get diagnostics c = row_count; moved := moved + c;
  delete from excuses where member_id = p_from;

  -- member_availability: primary key (member_id, key)
  update member_availability set member_id = p_to
   where member_id = p_from
     and not exists (
       select 1 from member_availability a2 where a2.member_id = p_to and a2.key = member_availability.key
     );
  get diagnostics c = row_count; moved := moved + c;
  delete from member_availability where member_id = p_from;

  -- linked account(s): only if the survivor has none
  update profiles set member_id = p_to
   where member_id = p_from
     and not exists (select 1 from profiles p2 where p2.member_id = p_to);
  get diagnostics c = row_count; moved := moved + c;
  update profiles set member_id = null where member_id = p_from;

  return json_build_object('ok', true, 'rows', moved);
end;
$$;

revoke all on function public.merge_members(text, text) from public, anon;
grant execute on function public.merge_members(text, text) to authenticated;
