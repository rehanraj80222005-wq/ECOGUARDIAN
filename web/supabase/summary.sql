begin;

create or replace function public.get_emission_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'recordCount', count(*),
    'totalKwh', coalesce(sum(quantity), 0),
    'totalTonnesCO2e', coalesce(sum(tonnes_co2e), 0)
  )
  from public.emission_records
  where user_id = (select auth.uid())
    and activity = 'electricity'
    and unit = 'kWh'
    and is_demo = true;
$$;

revoke execute on function public.get_emission_summary()
  from public, anon;

grant execute on function public.get_emission_summary()
  to authenticated;

commit;