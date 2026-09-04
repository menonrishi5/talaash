# Migration checklist

There's no automated migration runner here — each file in `supabase/` is run
by hand, once, in the Supabase SQL editor, **in order**. There's no DB-side
record of what's been run, which has already caused a real problem once
(`migration-11` exists specifically to repair the DB after `migration-8` was
run before `migration-7`). This file is the record that table doesn't
otherwise exist.

**When you add a new migration**, add a row here in the same PR. **When you
run one against the live database**, check it off here too — that's what
lets a future session (yours or Claude's) trust this file instead of
guessing from what the app seems to do.

| # | File | What it does | Applied to prod? |
|---|------|---------------|:---:|
| 1 | `schema.sql` | Base schema: `app_state`, `attendance_sessions`, `checkins`, `payments`, `check_in()`, file storage bucket. | ✅ |
| 2 | `migration-2-roles.sql` | Accounts + viewer/editor roles; writes now require editor. | ✅ |
| 3 | `migration-3-zeffy.sql` | Zeffy payment mirror. | ✅ |
| 4 | `migration-4-members.sql` | Member identities, own-only money visibility, benching responses, reimbursements. | ✅ |
| 5 | `migration-5-notify-cron.sql` | Schedules `benching-notify` (every 10 min). Needs the function deployed + `SLACK_BOT_TOKEN` first. | ✅ |
| 6 | `migration-6-venmo.sql` | Venmo transaction ledger (manual CSV import), editor-only. | ✅ |
| 7 | `migration-7-session-end.sql` | End/close an attendance session without deleting it. | ✅ (repaired by #11 after being run out of order) |
| 8 | `migration-8-security-calendar.sql` | Moves the check-in password off the readable table into `session_secrets`; calendar feed groundwork. | ✅ |
| 9 | `migration-9-more-crons.sql` | Schedules `weekly-backup` and `weekly-digest`. Needs both functions deployed first. | ✅ |
| 10 | `migration-10-slack-email.sql` | Optional per-account Slack email override for `benching-notify`. | ✅ |
| 11 | `migration-11-repair-session-end.sql` | Repairs the DB after #8 ran before #7 landed correctly. | ✅ |
| 12 | `migration-12-logic-fixes.sql` | Logic-audit batch (RSVP integrity, fine controls, `respond_to_slot()`). | ✅ |
| 13 | `migration-13-excuses.sql` | Pre-practice excuse form; `check_in()` honors an approved late-arrival time. | ✅ |
| 14 | `migration-14-attendance-notify.sql` | `attendance_announcements` table backing the Announce button + cron reminders. | ✅ |
| 15 | `migration-15-mydues-latefines.sql` | Exposes late-fine waivers in `get_my_dues()`. | ✅ |
| 16 | `migration-16-owner.sql` | Only the owner can grant/revoke editor access (DB-enforced). | ✅ |
| 17 | `migration-17-availability.sql` | After-7 practice availability (weekly default + per-date override). | ✅ |
| 18 | `migration-18-checkin-token.sql` | Drops the spoken check-in password for a per-session QR token. | ✅ *(confirmed run 2026-09)* |
| 19 | `migration-19-rls-tightening.sql` | Locks `profiles` reads to editor-or-self; drops unused direct-write policies on `slot_responses`. | ✅ *(confirmed run 2026-09)* |
| 20 | `migration-20-cover-requests.sql` | `cover_requests` table + `request_cover()` / `respond_to_cover()` / `cancel_cover_request()` for self-serve benching cover swaps. | ✅ *(confirmed run 2026-09)* |

Everything through #18 is assumed applied because the app is live and
working end to end on it — **but this file is the first time that's been
written down, so give the list one real pass** (open each file, confirm
against the actual DB — e.g. does `session_secrets` exist, does `check_in`
take `p_token` not `p_password`) rather than trusting the checkmarks blindly
this one time. From here on, keep it current as you go.
