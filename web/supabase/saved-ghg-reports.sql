begin;

create table public.saved_ghg_reports (
  -- The client will reuse this ID when retrying an uncertain save.
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    default auth.uid()
    references auth.users(id) on delete cascade,

  created_at timestamptz not null default now(),

  original_name text not null
    check (
      char_length(btrim(original_name)) between 1 and 255
    ),

  original_size_bytes bigint not null
    check (
      original_size_bytes between 1 and 20971520
    ),

  -- Computed in the browser from the original PDF.
  -- Identifies the selected file; does not verify authenticity.
  original_sha256 text not null
    check (
      original_sha256 ~ '^[a-f0-9]{64}$'
    ),

  original_pages integer[] not null,

  -- User confirmation, not independent verification.
  reviewed boolean not null
    check (reviewed is true),

  report jsonb not null,

  constraint saved_ghg_reports_pages_check
    check (
      coalesce(
        array_ndims(original_pages) = 1
        and array_lower(original_pages, 1) = 1
        and cardinality(original_pages) between 1 and 3
        and array_position(original_pages, null) is null
        and original_pages[1] >= 1
        and original_pages[cardinality(original_pages)] <= 500
        and (
          cardinality(original_pages) < 2
          or original_pages[2] = original_pages[1] + 1
        )
        and (
          cardinality(original_pages) < 3
          or original_pages[3] = original_pages[2] + 1
        ),
        false
      )
    ),

  constraint saved_ghg_reports_structure_check
    check (
      coalesce(
        jsonb_typeof(report) = 'object'
        and jsonb_typeof(report -> 'figures') = 'array'
        and jsonb_typeof(report -> 'warnings') = 'array',
        false
      )
    ),

  constraint saved_ghg_reports_figures_count_check
    check (
      case
        when jsonb_typeof(report -> 'figures') = 'array'
        then jsonb_array_length(report -> 'figures') between 1 and 20
        else false
      end
    ),

  constraint saved_ghg_reports_warnings_count_check
    check (
      case
        when jsonb_typeof(report -> 'warnings') = 'array'
        then jsonb_array_length(report -> 'warnings') <= 20
        else false
      end
    ),

  constraint saved_ghg_reports_payload_size_check
    check (
      octet_length(report::text) <= 262144
    )
);

create index saved_ghg_reports_owner_created_idx
  on public.saved_ghg_reports (user_id, created_at desc);

alter table public.saved_ghg_reports
  enable row level security;

revoke all on table public.saved_ghg_reports
  from public, anon, authenticated;

grant select on table public.saved_ghg_reports
  to authenticated;

-- Ownership and creation time use database defaults.
grant insert (
  id,
  original_name,
  original_size_bytes,
  original_sha256,
  original_pages,
  reviewed,
  report
) on public.saved_ghg_reports
  to authenticated;

create policy "Users can read their own saved GHG reports"
  on public.saved_ghg_reports
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
  );

create policy "Users can save their own reviewed GHG reports"
  on public.saved_ghg_reports
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and reviewed is true
  );

comment on table public.saved_ghg_reports is
  'User-reviewed reported emissions snapshots. Separate from calculated electricity activity. Original PDFs are not stored.';

comment on column public.saved_ghg_reports.report is
  'Figures and warnings. Detailed field validation is performed by the API; database constraints enforce the basic snapshot structure and size.';

commit;