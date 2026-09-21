-- Talaash HQ migration 27: remember which Slack message an announcement became
-- so re-announcing / a room change EDITS that message (chat.update) instead of
-- posting a new one, and the editor can delete it. Pairs with an
-- `attendance-notify` redeploy. Run after migration-26. Idempotent.

alter table public.attendance_announcements
  add column if not exists slack_channel text,
  add column if not exists slack_ts text;
