begin;

create function public.check_activity_source_kind()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
begin
  -- Preserve support for legacy records without source links.
  if new.source_document_id is null then
    return new;
  end if;

  -- Use the same source lock as saving and classification.
  select document_kind
  into v_kind
  from public.source_documents
  where id = new.source_document_id
    and user_id = new.user_id
  for update;

  if not found then
    raise exception 'Source unavailable for this record'
      using errcode = '42501';
  end if;

  if v_kind = 'ghg_report' then
    raise exception
      'A GHG report cannot receive saved electricity activity'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function public.check_activity_source_kind()
  from public, anon, authenticated;

create trigger emission_records_source_kind_guard
before insert or update of source_document_id, user_id
on public.emission_records
for each row
execute function public.check_activity_source_kind();

commit;