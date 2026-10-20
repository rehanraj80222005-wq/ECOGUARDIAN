begin;

revoke execute on function public.save_source_emissions(
  uuid, text, text, jsonb
) from public, anon, authenticated;

commit;