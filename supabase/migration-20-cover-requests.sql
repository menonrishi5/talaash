-- Talaash HQ migration 20: self-serve benching cover requests. Run after
-- migration-19. Idempotent.
--
-- Today, if you've accepted a benching shift and can't make it anymore, your
-- only option is to decline — which hands it to whoever the *fixed* reserve
-- is (or leaves it uncovered if there isn't one). This adds a way to ask a
-- specific teammate to take it instead, with them accepting/declining the
-- same way a reserve call-up works.
--
-- Deliberately doesn't touch the app_state 'benching' JSON blob (that's a
-- single shared document — writing into it from here risks clobbering a
-- concurrent editor's unrelated change, since there's no per-key locking).
-- Instead this follows the same pattern slot_responses already uses: a plain
-- relational table the client layers on top of the template + weeks
-- overrides when it builds the grid, same as it already does for accept/
-- decline responses.

create table if not exists public.cover_requests (
  id uuid primary key default gen_random_uuid(),
  week_iso text not null,
  slot_id text not null,
  from_member_id text not null,
  to_member_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
-- Only one open request per slot occurrence at a time.
create unique index if not exists cover_requests_one_pending
  on public.cover_requests (week_iso, slot_id) where status = 'pending';

alter table public.cover_requests enable row level security;

drop policy if exists "read own or editor" on public.cover_requests;
create policy "read own or editor" on public.cover_requests
  for select to authenticated
  using (is_editor() or from_member_id = my_member_id() or to_member_id = my_member_id());

-- No insert/update policy: request_cover() / respond_to_cover() /
-- cancel_cover_request() do all the writing (security definer), with
-- validation a direct-table policy can't express (do you actually hold this
-- slot, is the target an active roster member, is there already a pending
-- request for it).
drop policy if exists "editor delete" on public.cover_requests;
create policy "editor delete" on public.cover_requests
  for delete to authenticated using (is_editor());

-- ---------- request_cover: ask a specific teammate to take your slot ----------
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
    select 1 from app_state, jsonb_array_elements(data->'roster') r
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

-- ---------- respond_to_cover: the asked teammate accepts/declines ----------
create or replace function public.respond_to_cover(
  p_request_id uuid, p_status text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  req record;
begin
  if mid is null then
    return jsonb_build_object('ok', false, 'error', 'Your account isn''t linked to a roster member yet.');
  end if;
  if p_status not in ('accepted', 'declined') then
    return jsonb_build_object('ok', false, 'error', 'Bad request.');
  end if;

  select * into req from cover_requests where id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That request no longer exists.');
  end if;
  if req.to_member_id <> mid then
    return jsonb_build_object('ok', false, 'error', 'This request isn''t addressed to you.');
  end if;
  if req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'That request was already answered.');
  end if;

  update cover_requests set status = p_status, decided_at = now() where id = p_request_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- cancel_cover_request: the asker takes back an unanswered one ----------
create or replace function public.cancel_cover_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  req record;
begin
  if mid is null then
    return jsonb_build_object('ok', false, 'error', 'Your account isn''t linked to a roster member yet.');
  end if;
  select * into req from cover_requests where id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That request no longer exists.');
  end if;
  if req.from_member_id <> mid and not is_editor() then
    return jsonb_build_object('ok', false, 'error', 'Not your request to cancel.');
  end if;
  if req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'That request was already answered.');
  end if;
  update cover_requests set status = 'cancelled', decided_at = now() where id = p_request_id;
  return jsonb_build_object('ok', true);
end;
$$;
