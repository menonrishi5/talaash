-- Talaash HQ migration 15: expose the caller's late-fine waivers in get_my_dues
-- so a member's own "owed" reflects waived late fines. Run after migration-4.
-- Idempotent.

create or replace function public.get_my_dues()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  mid text := (select member_id from profiles where id = auth.uid());
  d jsonb;
begin
  if mid is null then
    return jsonb_build_object('linked', false);
  end if;
  select data into d from app_state where key = 'dues';
  d := coalesce(d, '{}'::jsonb);
  return jsonb_build_object(
    'linked', true,
    'member_id', mid,
    'categories', coalesce(d->'categories', '[]'::jsonb),
    'overrides', coalesce(d->'overrides'->mid, '{}'::jsonb),
    'late_fine_waivers', coalesce(d->'lateFineWaivers'->mid, '{}'::jsonb),
    'donation_credit_ids',
      coalesce((select jsonb_agg(k) from jsonb_object_keys(coalesce(d->'donationCredits', '{}'::jsonb)) as t(k)), '[]'::jsonb),
    'excluded_campaigns', coalesce(d->'excludedCampaigns', '{}'::jsonb)
  );
end $$;
