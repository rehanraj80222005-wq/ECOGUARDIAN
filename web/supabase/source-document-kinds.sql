begin;

alter table public.source_documents
  add column document_kind text not null default 'unclassified';

alter table public.source_documents
  add constraint source_documents_kind_check
  check (
    document_kind in (
      'utility_bill',
      'ghg_report',
      'unclassified'
    )
  );

comment on column public.source_documents.document_kind is
  'User-selected workflow category, not verification of document contents.';

commit;