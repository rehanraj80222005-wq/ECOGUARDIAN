begin;

create function public.get_review_summary()
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