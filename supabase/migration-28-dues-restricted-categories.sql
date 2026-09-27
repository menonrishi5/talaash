-- Talaash HQ migration 28: dues fee categories can now be restricted to a
-- subset of the roster (e.g. an OU Airbnb fee that only the members going on
-- that trip owe). No schema change to the `dues` doc itself — a category
-- just gets an optional `restrictedTo: [memberId, ...]` array, which the
-- frontend (DuesAdmin) already understands and renders as "n/a" for members
-- not on the list instead of "unpaid".
--
-- The only server-side change needed: get_my_dues() must not hand a member
-- fee categories that don't apply to them, so "My Dues" doesn't show a fee
-- for a trip they're not on. Run after migration-15. Idempotent.

create or replace function public.get_my_dues()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  d jsonb;
  cats jsonb;
begin
  if mid is null then
    return jsonb_build_object('linked', false);
  end if;
  select data into d from app_state where key = 'dues';
  d := coalesce(d, '{}'::jsonb);

  select coalesce(jsonb_agg(c order by coalesce((c->>'order')::int, 0)), '[]'::jsonb)
    into cats
    from jsonb_array_elements(coalesce(d->'categories', '[]'::jsonb)) c
    where jsonb_typeof(c->'restrictedTo') is distinct from 'array'
       or (c->'restrictedTo') ? mid;

  return jsonb_build_object(
    'linked', true,
    'member_id', mid,
    'categories', cats,
    'overrides', coalesce(d->'overrides'->mid, '{}'::jsonb),
    'late_fine_waivers', coalesce(d->'lateFineWaivers'->mid, '{}'::jsonb),
    'donation_credit_ids',
      coalesce((select jsonb_agg(k) from jsonb_object_keys(coalesce(d->'donationCredits', '{}'::jsonb)) as t(k)), '[]'::jsonb),
    'excluded_campaigns', coalesce(d->'excludedCampaigns', '{}'::jsonb)
  );
end $$;
