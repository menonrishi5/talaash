-- Talaash HQ migration 16: only the owner (Rishi) can grant/revoke admin
-- (editor) access. Other editors can still link accounts to members etc.,
-- but role changes are locked to the owner — enforced in the DB, not just
-- the UI. Run after migration-2. Idempotent.

-- Owner = Rishi's account(s), identified by email.
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and lower(email) in ('menonrishi5@gmail.com', 'rishimenon@utexas.edu')
  )
$$;

-- Block role changes by anyone who isn't the owner.
create or replace function public.guard_role_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_owner() then
    raise exception 'Only the owner can change admin (editor) access.';
  end if;
  return new;
end
$$;
drop trigger if exists only_owner_role on public.profiles;
create trigger only_owner_role
  before update of role on public.profiles
  for each row execute function public.guard_role_change();
