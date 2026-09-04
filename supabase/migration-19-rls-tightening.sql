-- Talaash HQ migration 19: RLS tightening found during a security pass over
-- every policy in schema.sql + migrations 2-18. Run after migration-18.
-- Idempotent. See the PR description for the full review notes — these are
-- the two real, fixable gaps found; everything else checked out.

-- ---------- 1. profiles: any signed-in account could read everyone's ----------
-- email, role, member_id, and slack_email via a direct REST call — the app
-- UI only shows this to editors (Roster -> App access), but the RLS policy
-- ("auth read profiles", using true) never actually restricted it. No
-- client code path needs a non-editor to read anyone's profile but their
-- own (checked: auth.jsx and CheckIn.jsx only ever self-lookup by id).
drop policy if exists "auth read profiles" on public.profiles;
create policy "auth read profiles" on public.profiles
  for select to authenticated using (is_editor() or id = auth.uid());

-- ---------- 2. slot_responses: direct insert/update let a member write ----------
-- an "accepted"/"declined" row for ANY slot under their own member_id,
-- without the validation respond_to_slot() does (that the caller actually
-- holds that slot as primary or reserve). No client code uses these direct
-- policies — every accept/decline goes through respond_to_slot(), which is
-- security definer and bypasses RLS entirely, so removing them doesn't
-- change any real UI flow.
drop policy if exists "own or editor insert" on public.slot_responses;
drop policy if exists "own or editor update" on public.slot_responses;
