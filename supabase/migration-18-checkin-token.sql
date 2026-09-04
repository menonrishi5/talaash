-- Talaash HQ migration 18: drop the spoken check-in password for a per-session
-- token embedded in the QR/link. Run AFTER migration-13. Idempotent.
--
-- Nothing changes in session_secrets (still one random string per session,
-- still editor-only via RLS) — only what that string means and how it's
-- checked. The app now generates a long random token (never displayed as
-- text to read aloud) and puts it in the check-in URL as `?t=`. The public
-- check-in page reads it from the URL instead of asking someone to type it.

-- Postgres won't rename a parameter via create-or-replace on the same
-- signature (uuid, text) — drop first.
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
