begin;

-- Existing records remain unlinked.
alter table public.emission_records
  add column source_document_id uuid,
  add column source_line_index integer;

-- A record and its source must belong to the same user.
alter table public.emission_records
  add constraint emission_records_source_owner_fk
  foreign key (source_document_id, user_id)
  references public.source_documents (id, user_id);

alter table public.emission_records
  add constraint emission_records_source_line_check
  check (
    (
      source_document_id is null
      and source_line_index is null
    )
    or
    (
      source_document_id is not null
      and source_line_index is not null
      and source_line_index >= 1
    )
  );

create unique index emission_records_source_line_unique
  on public.emission_records (
    source_document_id,
    source_line_index
  )
  where source_document_id is not null;

-- Saves all activity rows for a source in one transaction.
create function public.save_source_emissions(
  p_source_id uuid,
  p_supplier text,
  p_billing_period text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_quantity numeric;
  v_line integer := 0;
begin
  if v_user_id is null then
    raise exception 'Sign-in required'
      using errcode = '42501';
  end if;

  -- Lock this user's source so simultaneous saves cannot race.
  perform id
  from public.source_documents
  where id = p_source_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Source document not found in your account'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.emission_records
    where source_document_id = p_source_id
      and user_id = v_user_id
  ) then
    raise exception 'SOURCE_ALREADY_RECORDED'
      using errcode = '23505';
  end if;

  if p_items is null
    or jsonb_typeof(p_items) is distinct from 'array'
  then
    raise exception 'Activities must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Provide between 1 and 30 activities'
      using errcode = '22023';
  end if;

  if char_length(p_supplier) > 300
    or char_length(p_billing_period) > 300
  then
    raise exception 'Supplier or billing period is too long'
      using errcode = '22023';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or (v_item ->> 'activity') is distinct from 'electricity'
      or lower(btrim(v_item ->> 'unit')) is distinct from 'kwh'
      or jsonb_typeof(v_item -> 'quantity') is distinct from 'number'
      or jsonb_typeof(v_item -> 'evidence') is distinct from 'string'
    then
      raise exception 'Each activity requires electricity, kWh, a quantity, and evidence'
        using errcode = '22023';
    end if;

    v_quantity := (v_item ->> 'quantity')::numeric;

    if v_quantity < 0 or v_quantity > 1000000000000 then
      raise exception 'Quantity is outside the supported range'
        using errcode = '22023';
    end if;

    if char_length(v_item ->> 'evidence') > 1000 then
      raise exception 'Evidence is too long'
        using errcode = '22023';
    end if;

    v_line := v_line + 1;

    insert into public.emission_records (
      user_id,
      source_document_id,
      source_line_index,
      supplier,
      billing_period,
      activity,
      quantity,
      unit,
      factor_id,
      factor_kg_co2e,
      is_demo,
      evidence
    )
    values (
      v_user_id,
      p_source_id,
      v_line,
      p_supplier,
      p_billing_period,
      'electricity',
      v_quantity,
      'kWh',
      'demo-electricity-v1',
      0.5,
      true,
      v_item ->> 'evidence'
    );
  end loop;

  return jsonb_build_object(
    'savedCount', v_line,
    'sourceDocumentId', p_source_id
  );
end;
$$;

revoke execute on function public.save_source_emissions(
  uuid, text, text, jsonb
) from public, anon;

grant execute on function public.save_source_emissions(
  uuid, text, text, jsonb
) to authenticated;

commit;