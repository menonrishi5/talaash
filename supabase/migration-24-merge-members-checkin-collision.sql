-- Talaash HQ migration 24: merge_members() failed with
--   duplicate key value violates unique constraint "checkins_session_id_member_id_key"
-- whenever BOTH the duplicate and the surviving member already had a check-in
-- row for the same session — common once auto no-show fines (PR #18) started
-- landing on every roster entry, phantoms included.
--
-- Fix: move only the check-in rows that won't collide. For a session both
-- members have a row for, keep the more meaningful one on the survivor (a real
-- check-in beats a no-show; a row with a fine beats a $0 row) and drop the
-- duplicate's leftover. Run after migration-23. Idempotent.

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

  -- checkins: unique (session_id, member_id).
  -- 1. Sessions only the duplicate has a row for — hand them over.
  update checkins ck set member_id = p_to
   where ck.member_id = p_from
     and not exists (
       select 1 from checkins k2 where k2.member_id = p_to and k2.session_id = ck.session_id
     );
  get diagnostics c = row_count; moved := moved + c;
  -- 2. Sessions both have a row for — if the survivor's is the weaker row
  --    (a no-show, or fine-free) and the duplicate's is stronger, copy the
  --    duplicate's values onto the survivor's row.
  update checkins keep
     set mins_late  = dup.mins_late,
         fine       = dup.fine,
         fine_pending = dup.fine_pending,
         checked_at = dup.checked_at,
         no_show    = dup.no_show,
         member_name = dup.member_name
    from checkins dup
   where keep.member_id = p_to
     and dup.member_id = p_from
     and keep.session_id = dup.session_id
     and ((keep.no_show and not dup.no_show) or (keep.fine = 0 and dup.fine > 0));
  -- 3. Drop whatever of the duplicate's check-ins are left.
  delete from checkins where member_id = p_from;

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
