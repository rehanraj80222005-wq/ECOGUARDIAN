-- Fresh-database setup only.
-- Do not run against the existing production table.
-- Source links and billing dates are added by later migrations.

begin;

create table public.emission_records (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    default auth.uid()
    references auth.users(id) on delete cascade,

  created_at timestamptz not null default now(),

  supplier text,
  billing_period text,

  activity text not null default 'electricity'
    constraint emission_records_activity_check
    check (activity = 'electricity'),

  quantity numeric not null
    constraint emission_records_quantity_check
    check (quantity >= 0 and quantity <= 1000000000000),

  unit text not null default 'kWh'
    constraint emission_records_unit_check
    check (unit = 'kWh'),

  factor_id text not null default 'demo-electricity-v1'
    constraint emission_records_factor_id_check
    check (factor_id = 'demo-electricity-v1'),

  factor_kg_co2e numeric not null default 0.5
    constraint emission_records_factor_kg_co2e_check
    check (factor_kg_co2e = 0.5),

  tonnes_co2e numeric
    generated always as (
      quantity * factor_kg_co2e / 1000
    ) stored,

  is_demo boolean not null default true
    constraint emission_records_is_demo_check
    check (is_demo = true),

  evidence text,

  constraint supplier_length
    check (char_length(supplier) <= 300),

  constraint billing_period_length
    check (char_length(billing_period) <= 300),

  constraint evidence_length
    check (char_length(evidence) <= 1000)
);

create index emission_records_user_created_idx
  on public.emission_records (user_id, created_at desc);

alter table public.emission_records
  enable row level security;

revoke all on table public.emission_records
  from public, anon, authenticated;

grant select on table public.emission_records
  to authenticated;

create policy "Users can read their own emission records"
  on public.emission_records
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

commit;