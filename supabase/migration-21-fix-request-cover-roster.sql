-- Talaash HQ migration 21: fix request_cover() reading the roster doc wrong.
-- Run after migration-20. Idempotent.
--
-- app_state.data for key='roster' IS the array of members directly (see
-- check_in()/respond_to_slot(), which both do jsonb_array_elements(data)) —
-- there's no nested 'roster' property to reach into. request_cover() wrote
-- jsonb_array_elements(data->'roster'), which is always empty on an
-- array-typed data column, so the "is this an active roster member?" check
-- always failed with "That person isn't an active roster member."

create or replace function public.request_cover(
  p_week text, p_slot text, p_to_member text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  slot jsonb;
  found_active boolean;
begin
  if mid is null then
    return jsonb_build_object('ok', false, 'error', 'Your account isn''t linked to a roster member yet.');
  end if;
  if p_to_member is null or p_to_member = mid then
    return jsonb_build_object('ok', false, 'error', 'Pick someone else to cover.');
  end if;

  select elem into slot
    from app_state, jsonb_array_elements(data->'template') elem
    where key = 'benching' and elem->>'id' = p_slot;
  if slot is null then
    return jsonb_build_object('ok', false, 'error', 'That slot no longer exists.');
  end if;
  if slot->>'memberId' <> mid and coalesce(slot->>'reserveId', '') <> mid then
    return jsonb_build_object('ok', false, 'error', 'This isn''t your slot to hand off.');
  end if;

  select exists (
    select 1 from app_state, jsonb_array_elements(data) r
    where key = 'roster' and r->>'id' = p_to_member and coalesce((r->>'active')::boolean, true)
  ) into found_active;
  if not found_active then
    return jsonb_build_object('ok', false, 'error', 'That person isn''t an active roster member.');
  end if;

  if exists (
    select 1 from cover_requests
    where week_iso = p_week and slot_id = p_slot and status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'error', 'There''s already a pending cover request for this slot.');
  end if;

  insert into cover_requests (week_iso, slot_id, from_member_id, to_member_id)
  values (p_week, p_slot, mid, p_to_member);

  return jsonb_build_object('ok', true);
end;
$$;
