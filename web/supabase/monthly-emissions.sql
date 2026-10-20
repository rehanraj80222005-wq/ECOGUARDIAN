begin;

create function public.get_monthly_emissions()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with owned as (
    select
      quantity,
      tonnes_co2e,
      billing_start_date,
      billing_end_date
    from public.emission_records
    where user_id = (select auth.uid())
      and activity = 'electricity'
      and unit = 'kWh'
      and is_demo = true
  ),

  dated as (
    select *
    from owned
    where billing_start_date is not null
      and billing_end_date is not null
  ),

  anchor as (
    select
      date_trunc(
        'month',
        max(billing_end_date)::timestamp
      )::date as latest_month
    from dated
  ),

  months as (
    select
      (
        a.latest_month - make_interval(months => n)
      )::date as month_start
    from anchor a
    cross join generate_series(0, 11) as offsets(n)
    where a.latest_month is not null
  ),

  boundaries as (
    select
      month_start,
      (
        month_start + interval '1 month' - interval '1 day'
      )::date as month_end
    from months
  ),

  totals as (
    select
      m.month_start,

      coalesce(
        sum(
          d.quantity
          * (
              least(d.billing_end_date, m.month_end)
              - greatest(d.billing_start_date, m.month_start)
              + 1
            )::numeric
          / (
              d.billing_end_date - d.billing_start_date + 1
            )::numeric
        ),
        0
      ) as total_kwh,

      coalesce(
        sum(
          d.tonnes_co2e
          * (
              least(d.billing_end_date, m.month_end)
              - greatest(d.billing_start_date, m.month_start)
              + 1
            )::numeric
          / (
              d.billing_end_date - d.billing_start_date + 1
            )::numeric
        ),
        0
      ) as total_tonnes,

      count(d.billing_start_date) as contributing_records

    from boundaries m
    left join dated d
      on d.billing_start_date <= m.month_end
      and d.billing_end_date >= m.month_start
    group by m.month_start
  )

  select jsonb_build_object(
    'allocationMethod', 'inclusive-days',
    'datedRecordCount', (select count(*) from dated),

    'undatedRecordCount', (
      select count(*)
      from owned
      where billing_start_date is null
         or billing_end_date is null
    ),

    'undatedTonnesCO2e', (
      select coalesce(sum(tonnes_co2e), 0)
      from owned
      where billing_start_date is null
         or billing_end_date is null
    ),

    'months', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(month_start, 'YYYY-MM'),
            'totalKwh', total_kwh,
            'totalTonnesCO2e', total_tonnes,
            'contributingRecordCount', contributing_records
          )
          order by month_start
        )
        from totals
      ),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function public.get_monthly_emissions()
  from public, anon;

grant execute on function public.get_monthly_emissions()
  to authenticated;

commit;