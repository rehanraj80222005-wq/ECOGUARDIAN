begin;

-- Fictional users, created only in the isolated test database.
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Exercise application access as an authenticated user,
-- rather than testing everything with administrator privileges.
set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

insert into public.source_documents (
  id, original_name, sha256, size_bytes, mime_type
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'test-bill.pdf',
    repeat('a', 64),
    100,
    'application/pdf'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'test-report.pdf',
    repeat('b', 64),
    100,
    'application/pdf'
  );

do $$
declare
  v_bill uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_report uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_items jsonb := '[
    {
      "activity": "electricity",
      "quantity": 1800,
      "unit": "kWh",
      "evidence": "Fictional test bill"
    }
  ]'::jsonb;
  v_result jsonb;
begin
  -- A reviewed bill can be saved with its dates.
  v_result := public.save_dated_source_emissions(
    v_bill,
    'Test supplier',
    'September 2026',
    v_items,
    date '2026-09-01',
    date '2026-09-30'
  );

  if (v_result ->> 'savedCount')::integer is distinct from 1 then
    raise exception 'FAIL: expected one saved activity';
  end if;

  if not exists (
    select 1
    from public.emission_records
    where source_document_id = v_bill
      and user_id = auth.uid()
      and quantity = 1800
      and tonnes_co2e = 0.9
      and billing_start_date = date '2026-09-01'
      and billing_end_date = date '2026-09-30'
  ) then
    raise exception 'FAIL: saved quantity, emissions, ownership, or dates';
  end if;

  -- Saving the same source twice must fail.
  begin
    perform public.save_dated_source_emissions(
      v_bill,
      'Test supplier',
      'September 2026',
      v_items,
      date '2026-09-01',
      date '2026-09-30'
    );

    raise exception 'FAIL: duplicate save was accepted';
  exception
    when sqlstate '23505' then null;
  end;

  if (
    select count(*)
    from public.emission_records
    where source_document_id = v_bill
  ) <> 1 then
    raise exception 'FAIL: duplicate attempt changed the record count';
  end if;

  -- A source with activity cannot become a GHG report.
  begin
    perform public.classify_source_document(v_bill, 'ghg_report');

    raise exception 'FAIL: saved bill was classified as a GHG report';
  exception
    when sqlstate '22023' then null;
  end;

  if not exists (
    select 1
    from public.source_documents
    where id = v_bill
      and document_kind = 'unclassified'
  ) then
    raise exception 'FAIL: rejected classification changed the source';
  end if;

  -- An empty source can become a GHG report.
  perform public.classify_source_document(v_report, 'ghg_report');

  if not exists (
    select 1
    from public.source_documents
    where id = v_report
      and document_kind = 'ghg_report'
  ) then
    raise exception 'FAIL: report classification was not saved';
  end if;

  -- A GHG report cannot receive electricity activity.
  begin
    perform public.save_dated_source_emissions(
      v_report,
      'Test supplier',
      'September 2026',
      v_items,
      date '2026-09-01',
      date '2026-09-30'
    );

    raise exception 'FAIL: electricity was saved against a GHG report';
  exception
    when sqlstate '22023' then null;
  end;

  if exists (
    select 1
    from public.emission_records
    where source_document_id = v_report
  ) then
    raise exception 'FAIL: rejected report save left activity records';
  end if;

  -- Protected writes must remain restricted.
  if has_table_privilege(
    current_user, 'public.emission_records', 'INSERT'
  ) then
    raise exception 'FAIL: authenticated users have direct insert access';
  end if;

  if has_function_privilege(
    current_user,
    'public.save_source_emissions(uuid,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: legacy undated save is executable';
  end if;

  raise notice 'PASS: dated save, conversion, duplicates, and category guards';
end;
$$;

-- Switch to the second account while retaining the authenticated role.
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

do $$
declare
  v_bill uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
begin
  -- RLS must hide the first account's data.
  if exists (select 1 from public.source_documents) then
    raise exception 'FAIL: second account can read first-account sources';
  end if;

  if exists (select 1 from public.emission_records) then
    raise exception 'FAIL: second account can read first-account activity';
  end if;

  -- Security-definer functions must also enforce ownership.
  begin
    perform public.classify_source_document(v_bill, 'utility_bill');

    raise exception 'FAIL: second account classified another account source';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.save_dated_source_emissions(
      v_bill,
      'Other account',
      'September 2026',
      '[{
        "activity": "electricity",
        "quantity": 10,
        "unit": "kWh",
        "evidence": "Cross-account test"
      }]'::jsonb,
      date '2026-09-01',
      date '2026-09-30'
    );

    raise exception 'FAIL: second account saved against another account source';
  exception
    when sqlstate '42501' then null;
  end;

  raise notice 'PASS: cross-account reads and writes blocked';
end;
$$;

-- Leave no test users, sources, or records behind.
rollback;