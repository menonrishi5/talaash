-- Talaash HQ migration 12: logic-audit fixes. Run AFTER migration-11.
-- Idempotent.

-- ============================================================
-- 1. Benching RSVP: reserve responses + safe reassignment
-- ============================================================
alter table public.slot_responses
  add column if not exists reserve_status text
    check (reserve_status in ('accepted', 'declined')),
  add column if not exists reserve_responded_at timestamptz;

-- Allow 'pending' as a primary status: a reserve can respond before the
-- primary ever did, and the row needs a placeholder primary state.
alter table public.slot_responses drop constraint if exists slot_responses_status_check;
alter table public.slot_responses
  add constraint slot_responses_status_check
  check (status in ('accepted', 'declined', 'pending'));

-- Responding goes through this RPC so the reserve can answer too; it
-- validates the caller actually holds that role on the slot.
create or replace function public.respond_to_slot(
  p_week text, p_slot text, p_role text, p_status text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  slot jsonb;
begin
  if mid is null then
    return jsonb_build_object('ok', false, 'error', 'Your account isn''t linked to a roster member yet.');
  end if;
  if p_status not in ('accepted', 'declined') or p_role not in ('primary', 'reserve') then
    return jsonb_build_object('ok', false, 'error', 'Bad request.');
  end if;

  select elem into slot
    from app_state, jsonb_array_elements(data->'template') elem
    where key = 'benching' and elem->>'id' = p_slot;
  if slot is null then
    return jsonb_build_object('ok', false, 'error', 'That slot no longer exists.');
  end if;
  if p_role = 'primary' and slot->>'memberId' <> mid then
    return jsonb_build_object('ok', false, 'error', 'This isn''t your slot.');
  end if;
  if p_role = 'reserve' and coalesce(slot->>'reserveId', '') <> mid then
    return jsonb_build_object('ok', false, 'error', 'You aren''t the reserve for this slot.');
  end if;

  if p_role = 'primary' then
    insert into slot_responses (week_iso, slot_id, member_id, status)
    values (p_week, p_slot, mid, p_status)
    on conflict (week_iso, slot_id)
      do update set status = excluded.status, member_id = excluded.member_id, responded_at = now();
  else
    insert into slot_responses (week_iso, slot_id, member_id, status, reserve_status, reserve_responded_at)
    values (p_week, p_slot, slot->>'memberId', 'pending', p_status, now())
    on conflict (week_iso, slot_id)
      do update set reserve_status = excluded.reserve_status, reserve_responded_at = now();
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Reassigning a slot must clear stale responses + reminder history so the
-- new person gets asked. Editors do that cleanup from the app:
drop policy if exists "editor delete log" on public.notification_log;
create policy "editor delete log" on public.notification_log
  for delete to authenticated using (is_editor());

-- ============================================================
-- 2. Attendance: no-shows, manual check-in, fine edits
-- ============================================================
alter table public.checkins add column if not exists no_show boolean not null default false;

-- Editors may record manual check-ins / no-shows and adjust fines.
drop policy if exists "editor insert" on public.checkins;
create policy "editor insert" on public.checkins
  for insert to authenticated with check (is_editor());
drop policy if exists "editor update" on public.checkins;
create policy "editor update" on public.checkins
  for update to authenticated using (is_editor()) with check (is_editor());

-- ============================================================
-- 3. Check-in is tied to the signed-in account (no more checking in
--    as someone else). New signature; the old anonymous one is removed.
-- ============================================================
drop function if exists public.check_in(uuid, text, text, text);

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
    where session_id = p_session and member_id = mid;
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
  values (p_session, mid, coalesce(v_name, 'Unknown'), v_mins_late, v_fine)
  returning * into row_out;

  return json_build_object('ok', true, 'already', false,
    'checked_at', row_out.checked_at, 'mins_late', row_out.mins_late, 'fine', row_out.fine);
end;
$$;

-- ============================================================
-- 4. Never allow demoting the last editor (lockout guard)
-- ============================================================
create or replace function public.protect_last_editor()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'editor' and new.role <> 'editor' then
    if (select count(*) from profiles where role = 'editor') <= 1 then
      raise exception 'Cannot demote the last editor — promote someone else first.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists keep_one_editor on public.profiles;
create trigger keep_one_editor
  before update of role on public.profiles
  for each row execute function public.protect_last_editor();

-- ============================================================
-- 5. Venmo <-> reimbursement reconciliation link
-- ============================================================
alter table public.venmo_transactions add column if not exists reimbursement_id uuid;
