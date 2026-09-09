-- Talaash HQ migration 23: remember which room a practice was announced with,
-- so the room can be changed afterwards and re-posted to Slack. Run after
-- migration-22. Idempotent.

alter table public.attendance_announcements
  add column if not exists location text;

-- Backfill nothing — existing announcements just have a null room, which the
-- notifier already treats as "no room line".
