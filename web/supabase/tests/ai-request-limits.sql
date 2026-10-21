begin;

insert into auth.users (id) values
  ('55555555-5555-4555-8555-555555555555'),
  ('66666666-6666-4666-8666-666666666666');

-- Administrator access prepares and inspects test counters.
-- Quota requests run with the authenticated role.
do $$
declare
  v_user uuid := '55555555-5555-4555-8555-555555555555';
  v_other uuid := '66666666-6666-4666-8666-666666666666';
  v_case record;
  v_now timestamptz;
  v_minute timestamptz;
  v_day timestamptz;
  v_result jsonb;
  v_usage public.ai_request_limits%rowtype;
  v_attempt integer;
  v_stable boolean;
  v_retry integer;
  v_max_retry integer;
begin
  if has_table_privilege(
    'authenticated', 'public.ai_request_limits', 'SELECT'
  ) or has_table_privilege(
    'authenticated', 'public.ai_request_limits', 'UPDATE'
  ) or has_table_privilege(
    'authenticated', 'public.ai_request_limits', 'INSERT'
  ) or has_table_privilege(
    'authenticated', 'public.ai_request_limits', 'DELETE'
  ) then
    raise exception 'FAIL: clients can directly access quota counters';
  end if;

  if has_function_privilege(
    'anon', 'public.consume_ai_request()', 'EXECUTE'
  ) then
    raise exception 'FAIL: anonymous users can execute the quota function';
  end if;

  for v_case in
    select *
    from (
      values
        ('first request',        0,  0, false, false, true,  null::text,     1,  1),
        ('fifth request',        4,  4, false, false, true,  null::text,     5,  5),
        ('minute limit',         5,  5, false, false, false, 'minute_limit', 5,  5),
        ('thirtieth request',    0, 29, false, false, true,  null::text,     1, 30),
        ('daily limit',          0, 30, false, false, false, 'daily_limit',  0, 30),
        ('daily takes priority', 5, 30, false, false, false, 'daily_limit',  5, 30),
        ('new minute',           5, 10, true,  false, true,  null::text,     1, 11),
        ('new UTC day',          5, 30, true,  true,  true,  null::text,     1,  1)
    ) as cases(
      name,
      minute_count,
      day_count,
      old_minute,
      old_day,
      allowed,
      reason,
      expected_minute,
      expected_day
    )
  loop
    v_stable := false;

    -- Retry if the real clock crosses a minute boundary.
    for v_attempt in 1..3 loop
      v_now := clock_timestamp();
      v_minute := date_trunc('minute', v_now);
      v_day := date_trunc('day', v_now at time zone 'UTC')
        at time zone 'UTC';

      delete from public.ai_request_limits
      where user_id = v_user;

      -- No existing row for the initialization test.
      if v_case.name <> 'first request' then
        insert into public.ai_request_limits (
          user_id,
          minute_start,
          minute_count,
          day_start,
          day_count
        )
        values (
          v_user,
          case
            when v_case.old_minute
              then v_minute - interval '1 minute'
            else v_minute
          end,
          v_case.minute_count,
          case
            when v_case.old_day
              then v_day - interval '24 hours'
            else v_day
          end,
          v_case.day_count
        );
      end if;

      perform set_config(
        'request.jwt.claim.sub',
        v_user::text,
        true
      );

      execute 'set local role authenticated';
      v_result := public.consume_ai_request();
      execute 'reset role';

      if date_trunc('minute', clock_timestamp()) = v_minute then
        v_stable := true;
        exit;
      end if;
    end loop;

    if not v_stable then
      raise exception 'FAIL: could not test within a stable clock window';
    end if;

    if (v_result ->> 'allowed')::boolean
         is distinct from v_case.allowed
      or (v_result ->> 'reason')
         is distinct from v_case.reason
    then
      raise exception 'FAIL: % returned %', v_case.name, v_result;
    end if;

    v_retry := (v_result ->> 'retryAfterSeconds')::integer;

    if v_case.allowed then
      if v_retry is distinct from 0 then
        raise exception 'FAIL: allowed request has a retry delay';
      end if;
    else
      if v_case.reason = 'minute_limit' then
        v_max_retry := 60;
      else
        v_max_retry := 86400;
      end if;

      if v_retry is null
        or v_retry < 1
        or v_retry > v_max_retry
      then
        raise exception 'FAIL: invalid retry delay for %', v_case.name;
      end if;
    end if;

    select *
    into strict v_usage
    from public.ai_request_limits
    where user_id = v_user;

    if v_usage.minute_count <> v_case.expected_minute
      or v_usage.day_count <> v_case.expected_day
    then
      raise exception 'FAIL: incorrect counters after %', v_case.name;
    end if;

    if v_case.allowed and (
      v_usage.minute_start <> v_minute
      or v_usage.day_start <> v_day
    ) then
      raise exception 'FAIL: window timestamps were not updated';
    end if;

    raise notice 'PASS: %', v_case.name;
  end loop;

  -- Another account receives independent counters.
  perform set_config(
    'request.jwt.claim.sub',
    v_other::text,
    true
  );

  execute 'set local role authenticated';
  v_result := public.consume_ai_request();
  execute 'reset role';

  if (v_result ->> 'allowed')::boolean is distinct from true then
    raise exception 'FAIL: second account request rejected';
  end if;

  if (
    select count(*)
    from public.ai_request_limits
    where user_id in (v_user, v_other)
      and minute_count = 1
      and day_count = 1
  ) <> 2 then
    raise exception 'FAIL: account counters are not independent';
  end if;

  -- An authenticated-role invocation still needs a user identity.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);

  execute 'set local role authenticated';

  begin
    perform public.consume_ai_request();

    raise exception 'FAIL: quota request without a user was accepted';
  exception
    when sqlstate '42501' then
      null;
  end;

  execute 'reset role';

  raise notice 'PASS: account isolation and missing-user rejection';
  raise notice 'PASS: AI quota behavior and access permissions';
end;
$$;

rollback;