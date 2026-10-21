begin;

insert into auth.users (id) values
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  true
);

do $$
declare
  v_result jsonb;
begin
  v_result := public.get_monthly_emissions();

  if v_result -> 'months' is distinct from '[]'::jsonb
    or (v_result ->> 'datedRecordCount')::integer is distinct from 0
    or (v_result ->> 'undatedRecordCount')::integer is distinct from 0
  then
    raise exception 'FAIL: empty account should have no monthly data';
  end if;
end;
$$;

insert into public.source_documents (
  id, original_name, sha256, size_bytes, mime_type
)
values
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'cross-month-test.pdf',
    repeat('c', 64),
    100,
    'application/pdf'
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'leap-year-test.pdf',
    repeat('d', 64),
    100,
    'application/pdf'
  );

-- September 16–October 16 = 31 inclusive days.
-- 3100 kWh means 100 kWh per day:
-- September: 15 days = 1500 kWh.
-- October:   16 days = 1600 kWh.
select public.save_dated_source_emissions(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Monthly test supplier',
  'September–October 2024',
  '[{
    "activity": "electricity",
    "quantity": 3100,
    "unit": "kWh",
    "evidence": "Fictional cross-month test"
  }]'::jsonb,
  date '2024-09-16',
  date '2024-10-16'
);

-- February 28–March 1 in 2024 = 3 inclusive days.
-- February receives 200 kWh; March receives 100 kWh.
select public.save_dated_source_emissions(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'Monthly test supplier',
  'February–March 2024',
  '[{
    "activity": "electricity",
    "quantity": 300,
    "unit": "kWh",
    "evidence": "Fictional leap-year test"
  }]'::jsonb,
  date '2024-02-28',
  date '2024-03-01'
);

do $$
declare
  v_result jsonb;
  v_month jsonb;
  v_expected record;
  v_total_kwh numeric;
  v_total_tonnes numeric;
begin
  v_result := public.get_monthly_emissions();

  if v_result ->> 'allocationMethod' is distinct from 'inclusive-days'
    or (v_result ->> 'datedRecordCount')::integer is distinct from 2
    or (v_result ->> 'undatedRecordCount')::integer is distinct from 0
    or (v_result ->> 'undatedTonnesCO2e')::numeric is distinct from 0
  then
    raise exception 'FAIL: monthly response metadata';
  end if;

  if jsonb_array_length(v_result -> 'months') <> 12 then
    raise exception 'FAIL: expected exactly 12 months';
  end if;

  -- Anchor to the latest bill, not today's date.
  if v_result #>> '{months,0,month}' is distinct from '2023-11'
    or v_result #>> '{months,11,month}' is distinct from '2024-10'
  then
    raise exception 'FAIL: incorrect reporting window or month order';
  end if;

  for v_expected in
    select *
    from (
      values
        ('2024-02', 200::numeric, 0.1::numeric, 1),
        ('2024-03', 100::numeric, 0.05::numeric, 1),
        ('2024-09', 1500::numeric, 0.75::numeric, 1),
        ('2024-10', 1600::numeric, 0.8::numeric, 1),
        ('2024-08', 0::numeric, 0::numeric, 0)
    ) as expected(month_key, kwh, tonnes, record_count)
  loop
    select entry
    into v_month
    from jsonb_array_elements(v_result -> 'months') as entries(entry)
    where entry ->> 'month' = v_expected.month_key;

    if v_month is null then
      raise exception 'FAIL: missing month %', v_expected.month_key;
    end if;

    if (v_month ->> 'totalKwh')::numeric
         is distinct from v_expected.kwh
      or (v_month ->> 'totalTonnesCO2e')::numeric
         is distinct from v_expected.tonnes
      or (v_month ->> 'contributingRecordCount')::integer
         is distinct from v_expected.record_count
    then
      raise exception 'FAIL: incorrect allocation for %: %',
        v_expected.month_key, v_month;
    end if;
  end loop;

  select
    sum((entry ->> 'totalKwh')::numeric),
    sum((entry ->> 'totalTonnesCO2e')::numeric)
  into v_total_kwh, v_total_tonnes
  from jsonb_array_elements(v_result -> 'months') as entries(entry);

  if v_total_kwh is distinct from 3400
    or v_total_tonnes is distinct from 1.7
  then
    raise exception 'FAIL: allocation lost or duplicated consumption';
  end if;

  raise notice 'PASS: cross-month allocation, leap year, empty months, and totals';
end;
$$;

-- Another account must not inherit this account's reporting window.
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-8444-444444444444',
  true
);

do $$
declare
  v_result jsonb;
begin
  v_result := public.get_monthly_emissions();

  if v_result -> 'months' is distinct from '[]'::jsonb
    or (v_result ->> 'datedRecordCount')::integer is distinct from 0
  then
    raise exception 'FAIL: monthly data leaked between accounts';
  end if;

  raise notice 'PASS: monthly account isolation';
end;
$$;

rollback;