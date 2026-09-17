-- Talaash HQ migration 26: benching slots no longer require an explicit
-- "Accept" — a member is on duty by default the moment they're assigned, and
-- only needs to act if something changes. No schema change to
-- slot_responses; the frontend now treats "no row" (and any old literal
-- 'accepted' row) the same way: on duty. What's new is a third explicit
-- option alongside "pass to reserve" (still status='declined') and
-- "arrange a specific cover" (unchanged, request_cover()):
--
--   reject_slot_unclaimed(week, slot) — either the assigned member or their
--   reserve can declare a slot fully unclaimed in one step (no waiting on
--   the other side to also decline). Sets status='declined' AND
--   reserve_status='declined' together, which the app already renders as
--   "uncovered" everywhere (grid, weekly digest, notifications).
--
-- Run after migration-25. Idempotent.

create or replace function public.reject_slot_unclaimed(
  p_week text, p_slot text
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

  select elem into slot
    from app_state, jsonb_array_elements(data->'template') elem
    where key = 'benching' and elem->>'id' = p_slot;
  if slot is null then
    return jsonb_build_object('ok', false, 'error', 'That slot no longer exists.');
  end if;
  if slot->>'memberId' <> mid and coalesce(slot->>'reserveId', '') <> mid then
    return jsonb_build_object('ok', false, 'error', 'This isn''t your slot.');
  end if;

  insert into slot_responses (week_iso, slot_id, member_id, status, reserve_status, reserve_responded_at)
  values (p_week, p_slot, slot->>'memberId', 'declined', 'declined', now())
  on conflict (week_iso, slot_id) do update
    set status = 'declined', reserve_status = 'declined',
        reserve_responded_at = now(), responded_at = now();

  return jsonb_build_object('ok', true);
end;
$$;
