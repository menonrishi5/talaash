-- Talaash HQ migration 10: optional Slack email per account.
-- Members often log in with one email (Gmail) but their Slack account uses
-- another (school email). This lets benching-notify find them on Slack.
-- Run after migration-8. Idempotent.

alter table public.profiles add column if not exists slack_email text;

-- Editors already have update rights on profiles (the "editors manage roles"
-- policy), so no new policy is needed to set this.
