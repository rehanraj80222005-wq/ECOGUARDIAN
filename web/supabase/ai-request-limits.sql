begin;

create table public.ai_request_limits (
  user_id uuid primary key
    references auth.users(id) on delete cascade,

  minute_start timestamptz not null,
  minute_count integer not null default 0
    check (minute_count between 0 and 5),

  day_start timestamptz not null,
  day_count integer not null default 0
    check (day_count between 0 and 30)
);

alter table public.ai_request_limits
  enable row level security;

-- Clients cannot read or edit counters directly.
revoke all on table public.ai_request_limits
  from public, anon, authenticated;

create function public.consume_ai_request()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_minute timestamptz;
  v_day timestamptz;
  v_usage public.ai_request_limits%rowtype;
  v_retry integer;
begin
  if v_user_id is null then
    raise exception 'Sign-in required'
      using errcode = '42501';
  end if;

  v_now := clock_timestamp();

  insert into public.ai_request_limits (
    user_id,
    minute_start,
    day_start
  )
  values (
    v_user_id,
    date_trunc('minute', v_now),
    date_trunc('day', v_now at time zone 'UTC')
      at time zone 'UTC'
  )
  on conflict (user_id) do nothing;

  -- Serialize quota checks for this account.
  select *
  into v_usage
  from public.ai_request_limits
  where user_id = v_user_id
  for update;

  -- Read the clock again after acquiring the lock.
  v_now := clock_timestamp();
  v_minute := date_trunc('minute', v_now);
  v_day := date_trunc('day', v_now at time zone 'UTC')
    at time zone 'UTC';

  if v_usage.minute_start <> v_minute then
    v_usage.minute_start := v_minute;
    v_usage.minute_count := 0;
  end if;

  if v_usage.day_start <> v_day then
    v_usage.day_start := v_day;
    v_usage.day_count := 0;
  end if;

  if v_usage.day_count >= 30 then
    v_retry := greatest(
      1,
      ceil(
        extract(epoch from (
          (v_day + interval '24 hours') - v_now
        ))
      )::integer
    );

    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'retryAfterSeconds', v_retry
    );
  end if;

  if v_usage.minute_count >= 5 then
    v_retry := greatest(
      1,
      ceil(
        extract(epoch from (
          (v_minute + interval '1 minute') - v_now
        ))
      )::integer
    );

    return jsonb_build_object(
      'allowed', false,
      'reason', 'minute_limit',
      'retryAfterSeconds', v_retry
    );
  end if;

  update public.ai_request_limits
  set
    minute_start = v_minute,
    minute_count = v_usage.minute_count + 1,
    day_start = v_day,
    day_count = v_usage.day_count + 1
  where user_id = v_user_id;

  return jsonb_build_object(
    'allowed', true,
    'reason', null,
    'retryAfterSeconds', 0
  );
end;
$$;

revoke execute on function public.consume_ai_request()
  from public, anon;

grant execute on function public.consume_ai_request()
  to authenticated;

commit;