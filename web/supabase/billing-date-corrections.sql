begin;

create table public.billing_date_changes (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null
    references public.emission_records(id),
  user_id uuid not null
    references auth.users(id),
  changed_at timestamptz not null default now(),

  old_start_date date,
  old_end_date date,
  new_start_date date not null,
  new_end_date date not null,

  reason text not null
    check (char_length(btrim(reason)) between 10 and 1000),

  constraint billing_date_changes_new_dates_check
    check (
      new_start_date >= date '0001-01-01'
      and new_end_date <= date '9999-12-31'
      and new_end_date >= new_start_date
    )
);

create index billing_date_changes_record_time_idx
  on public.billing_date_changes (
    record_id,
    changed_at desc
  );

alter table public.billing_date_changes
  enable row level security;

revoke all on table public.billing_date_changes
  from anon, authenticated;

grant select on table public.billing_date_changes
  to authenticated;

create policy "Users can read their own billing date history"
  on public.billing_date_changes
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create function public.correct_billing_dates(
  p_record_id uuid,
  p_expected_start_date date,
  p_expected_end_date date,
  p_new_start_date date,
  p_new_end_date date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_old_start date;
  v_old_end date;
  v_change_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign-in required'
      using errcode = '42501';
  end if;

  if p_new_start_date is null
    or p_new_end_date is null
  then
    raise exception 'Provide both billing dates'
      using errcode = '22023';
  end if;

  if p_new_start_date < date '0001-01-01'
    or p_new_end_date > date '9999-12-31'
    or p_new_end_date < p_new_start_date
  then
    raise exception 'Invalid billing date range'
      using errcode = '22023';
  end if;

  if p_reason is null
    or char_length(btrim(p_reason)) not between 10 and 1000
  then
    raise exception 'Provide a correction reason between 10 and 1000 characters'
      using errcode = '22023';
  end if;

  select
    billing_start_date,
    billing_end_date
  into
    v_old_start,
    v_old_end
  from public.emission_records
  where id = p_record_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Record unavailable in your account'
      using errcode = '42501';
  end if;

  if v_old_start is distinct from p_expected_start_date
    or v_old_end is distinct from p_expected_end_date
  then
    raise exception 'DATES_CHANGED_REFRESH_REQUIRED'
      using errcode = '40001';
  end if;

  if v_old_start is not distinct from p_new_start_date
    and v_old_end is not distinct from p_new_end_date
  then
    raise exception 'The dates are unchanged'
      using errcode = '22023';
  end if;

  insert into public.billing_date_changes (
    record_id,
    user_id,
    old_start_date,
    old_end_date,
    new_start_date,
    new_end_date,
    reason
  )
  values (
    p_record_id,
    v_user_id,
    v_old_start,
    v_old_end,
    p_new_start_date,
    p_new_end_date,
    btrim(p_reason)
  )
  returning id into v_change_id;

  update public.emission_records
  set
    billing_start_date = p_new_start_date,
    billing_end_date = p_new_end_date
  where id = p_record_id
    and user_id = v_user_id;

  return jsonb_build_object(
    'recordId', p_record_id,
    'changeId', v_change_id,
    'billingStartDate', p_new_start_date,
    'billingEndDate', p_new_end_date
  );
end;
$$;

revoke execute on function public.correct_billing_dates(
  uuid, date, date, date, date, text
) from public, anon;

grant execute on function public.correct_billing_dates(
  uuid, date, date, date, date, text
) to authenticated;

-- Date changes must go through a controlled function.
revoke update on table public.emission_records
  from authenticated;

commit;