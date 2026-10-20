begin;

revoke insert on table public.emission_records
from public, anon, authenticated;

drop policy if exists "Users can insert their own emission records"
on public.emission_records;

commit;
