-- Talaash HQ migration 25: attendance_sessions.session_date should be unique
-- (one practice check-in per calendar date), but repeated "kept getting fined
-- repeatedly" reports match exactly what happens if that guarantee is missing
-- or was never actually enforced live: two sessions get created for the same
-- date (a race between "Start session" clicks, or a stale page not yet
-- showing the day's session), and every no-show gets auto-fined once per
-- duplicate session (PR #18) instead of once for the day.
--
-- Self-healing: first consolidates any duplicate-date sessions that already
-- exist -- merging their check-ins the same way merge_members() merges a
-- duplicate roster member (a real check-in beats a no-show; a fined row beats
-- a $0 row) -- then (re)adds the uniqueness guarantee so it can't happen
-- again. A no-op if there are no duplicates today. Run after migration-24.

do $$
declare
  d record;
  keep_id uuid;
  dup_id uuid;
begin
  for d in
    select session_date, array_agg(id order by created_at) as ids
    from attendance_sessions
    group by session_date
    having count(*) > 1
  loop
    keep_id := d.ids[1]; -- earliest-created session for that date survives
    for i in 2 .. array_length(d.ids, 1) loop
      dup_id := d.ids[i];

      -- checkins: unique (session_id, member_id).
      -- 1. Members only the duplicate has a row for -- hand them over.
      update checkins ck set session_id = keep_id
       where ck.session_id = dup_id
         and not exists (
           select 1 from checkins k2 where k2.session_id = keep_id and k2.member_id = ck.member_id
         );
      -- 2. Members both sessions have a row for -- keep the stronger one
      --    (a real check-in beats a no-show; a fined row beats a $0 row).
      update checkins keep
         set mins_late = dup.mins_late,
             fine = dup.fine,
             fine_pending = dup.fine_pending,
             checked_at = dup.checked_at,
             no_show = dup.no_show,
             member_name = dup.member_name
        from checkins dup
       where keep.session_id = keep_id and dup.session_id = dup_id
         and keep.member_id = dup.member_id
         and ((keep.no_show and not dup.no_show) or (keep.fine = 0 and dup.fine > 0));

      -- session_secrets: one row per session; the survivor already has its own.
      delete from session_secrets where session_id = dup_id;

      -- drop the duplicate session (cascades whatever check-ins are left on it)
      delete from attendance_sessions where id = dup_id;
    end loop;
  end loop;
end $$;

-- Guarantee it can't happen again.
alter table attendance_sessions
  drop constraint if exists attendance_sessions_session_date_key;
alter table attendance_sessions
  add constraint attendance_sessions_session_date_key unique (session_date);
