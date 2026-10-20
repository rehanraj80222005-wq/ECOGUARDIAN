begin;

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    default auth.uid()
    references auth.users(id) on delete cascade,

  created_at timestamptz not null default now(),

  original_name text not null
    check (char_length(original_name) between 1 and 255),

  sha256 text not null
    check (sha256 ~ '^[a-f0-9]{64}$'),

  size_bytes bigint not null
    check (size_bytes > 0 and size_bytes <= 10485760),

  mime_type text not null
    check (
      mime_type in (
        'application/pdf',
        'image/jpeg',
        'image/png'
      )
    ),

  constraint source_documents_owner_hash_unique
    unique (user_id, sha256),

  constraint source_documents_id_owner_unique
    unique (id, user_id)
);

alter table public.source_documents enable row level security;

revoke all on table public.source_documents from anon, authenticated;

grant select, insert
  on table public.source_documents
  to authenticated;

create policy "Users can read their own source documents"
  on public.source_documents
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can register their own source documents"
  on public.source_documents
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

commit;