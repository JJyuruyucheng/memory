-- A pg_net request may temporarily hold its headers in the request queue.
-- Each dispatch therefore uses a short-lived credential accepted only once.
alter table memory_private.recycle_settings
  add column cron_token_expires_at timestamptz;

create function memory_private.recycle_enqueue_callback()
returns bigint language plpgsql volatile set search_path = '' as $$
declare
  settings memory_private.recycle_settings%rowtype;
begin
  update memory_private.recycle_settings s
  set cron_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      cron_token_expires_at = clock_timestamp() + interval '90 seconds'
  where s.singleton and s.callback_url is not null
    and exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady")
  returning * into settings;
  if not found then
    raise exception using errcode = 'P0001', message = 'RECYCLE_UNAVAILABLE';
  end if;

  return net.http_post(
    url := settings.callback_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-memory-recycle-token', settings.cron_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function memory_private.recycle_enqueue_callback()
from public, anon, authenticated, service_role;

create or replace function memory_private.recycle_dispatch()
returns void language plpgsql volatile set search_path = '' as $$
declare
  settings memory_private.recycle_settings%rowtype;
  now_at timestamptz := clock_timestamp();
  due_before timestamptz := now_at - interval '168 hours';
begin
  select * into settings from memory_private.recycle_settings where singleton;
  if settings.callback_url is null or not exists (
    select 1 from memory_private.runtime_guard where id = 1 and "authReady"
  ) or not exists (
    select 1 from public.entries e left join memory_private.recycle_leases l on l.entry_id = e.id
    where e."deletedAt" is not null
      and (e."purgeRequestedAt" is not null or (settings.activated_at <= due_before and e."deletedAt" <= due_before))
      and (l.lease_until is null or l.lease_until <= now_at)
  ) then
    return;
  end if;
  perform memory_private.recycle_enqueue_callback();
end;
$$;

create or replace function memory_private.recycle_claim_expired(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  now_at timestamptz := clock_timestamp();
  due_before timestamptz := now_at - interval '168 hours';
  activated_at timestamptz;
  candidate record;
  claim jsonb;
  claims jsonb := '[]'::jsonb;
begin
  update memory_private.recycle_settings s
  set cron_token_expires_at = null
  where s.singleton and s.callback_url is not null
    and s.cron_token = p_token and s.cron_token_expires_at > clock_timestamp()
    and exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady")
  returning s.activated_at into activated_at;
  if not found then
    raise exception using errcode = '42501', message = 'RECYCLE_UNAUTHORIZED';
  end if;

  for candidate in
    select e.id, e."authorId"
    from public.entries e left join memory_private.recycle_leases l on l.entry_id = e.id
    where e."deletedAt" is not null
      and (e."purgeRequestedAt" is not null or (activated_at <= due_before and e."deletedAt" <= due_before))
      and (l.lease_until is null or l.lease_until <= now_at)
    order by coalesce(e."purgeRequestedAt", e."deletedAt"), e.id
    limit 10
    for update of e skip locked
  loop
    claim := memory_private.recycle_claim(candidate.id, candidate."authorId", clock_timestamp());
    if claim is not null then
      claims := claims || jsonb_build_array(claim);
    end if;
  end loop;
  return claims;
end;
$$;
