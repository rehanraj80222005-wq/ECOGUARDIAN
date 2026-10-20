begin;

create function public.classify_source_document(
  p_source_id uuid,
  p_document_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sign-in required'
      using errcode = '42501';
  end if;

  if p_document_kind is null
    or p_document_kind not in (
      'utility_bill',
      'ghg_report',
      'unclassified'
    )
  then
    raise exception 'Invalid source category'
      using errcode = '22023';
  end if;

  perform id
  from public.source_documents
  where id = p_source_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Source unavailable in your account'
      using errcode = '42501';
  end if;

  if p_document_kind = 'ghg_report'
    and exists (
      select 1
      from public.emission_records
      where source_document_id = p_source_id
        and user_id = v_user_id
    )
  then
    raise exception 'Source already has saved activity records'
      using errcode = '22023';
  end if;

  update public.source_documents
  set document_kind = p_document_kind
  where id = p_source_id
    and user_id = v_user_id;

  return jsonb_build_object(
    'documentKind', p_document_kind
  );
end;
$$;

revoke execute on function public.classify_source_document(uuid, text)
  from public, anon;

grant execute on function public.classify_source_document(uuid, text)
  to authenticated;

create or replace function public.get_review_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'undatedRecordCount', (
      select count(*)
      from public.emission_records
      where user_id = (select auth.uid())
        and (
          billing_start_date is null
          or billing_end_date is null
        )
    ),
    'unlinkedRecordCount', (
      select count(*)
      from public.emission_records
      where user_id = (select auth.uid())
        and source_document_id is null
    ),
    'sourcesWithoutRecordsCount', (
      select count(*)
      from public.source_documents s
      where s.user_id = (select auth.uid())
        and s.document_kind in ('utility_bill', 'unclassified')
        and not exists (
          select 1
          from public.emission_records r
          where r.source_document_id = s.id
            and r.user_id = s.user_id
        )
    )
  );
$$;

revoke execute on function public.get_review_summary()
  from public, anon;

grant execute on function public.get_review_summary()
  to authenticated;

commit;