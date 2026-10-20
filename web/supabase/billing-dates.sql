begin;

-- Existing records retain NULL dates.
alter table public.emission_records
  add column billing_start_date date,
  add column billing_end_date date;

-- Dates must either both be absent or form a valid supported range.
alter table public.emission_records
  add constraint emission_records_billing_dates_check
  check (
    (
      billing_start_date is null
      and billing_end_date is null
    )
    or
    (
      billing_start_date is not null
      and billing_end_date is not null
      and billing_start_date >= date '0001-01-01'
      and billing_end_date <= date '9999-12-31'
      and billing_end_date >= billing_start_date
    )
  );

-- Reuse the existing protected save function, then attach reviewed dates.
-- If either operation fails, the entire call rolls back.
create function public.save_dated_source_emissions(
  p_source_id uuid,
  p_supplier text,
  p_billing_period text,
  p_items jsonb,
  p_billing_start_date date,
  p_billing_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Sign-in required'
      using errcode = '42501';
  end if;

  if p_billing_start_date is null
    or p_billing_end_date is null
  then
    raise exception 'Provide both billing dates'
      using errcode = '22023';
  end if;

  if p_billing_start_date < date '0001-01-01'
    or p_billing_end_date > date '9999-12-31'
    or p_billing_end_date < p_billing_start_date
  then
    raise exception 'Invalid billing date range'
      using errcode = '22023';
  end if;

  -- This existing function checks ownership, locks the source,
  -- validates activities, and rejects previously saved sources.
  v_result := public.save_source_emissions(
    p_source_id,
    p_supplier,
    p_billing_period,
    p_items
  );

  update public.emission_records
  set
    billing_start_date = p_billing_start_date,
    billing_end_date = p_billing_end_date
  where source_document_id = p_source_id
    and user_id = v_user_id;

  get diagnostics v_updated = row_count;

  if v_updated <> (v_result ->> 'savedCount')::integer then
    raise exception 'Could not attach dates to every saved activity';
  end if;

  return v_result || jsonb_build_object(
    'billingStartDate', p_billing_start_date,
    'billingEndDate', p_billing_end_date
  );
end;
$$;

revoke execute on function public.save_dated_source_emissions(
  uuid, text, text, jsonb, date, date
) from public, anon;

grant execute on function public.save_dated_source_emissions(
  uuid, text, text, jsonb, date, date
) to authenticated;

commit;