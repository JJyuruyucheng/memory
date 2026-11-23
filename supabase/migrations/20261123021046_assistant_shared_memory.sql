-- Guazi's derived shared-post memory. No historical backfill or model calls in a
-- publication transaction. The owner enables dispatch only after worker QA:
--   update assistant_private.settings set enabled = true where singleton;
--   select assistant_private.dispatch();
-- Pause (also hides cached memories from JWT reads):
--   update assistant_private.settings set enabled = false where singleton;
-- Required hosted extensions: pg_net and pg_cron. The scheduling block below
-- fails closed on isolated PostgreSQL without them; enable them before enabling
-- dispatch and schedule: select cron.schedule('assistant-shared-memory',
--   '* * * * *', 'select assistant_private.dispatch()');

create schema assistant_private;
revoke all on schema assistant_private from public, anon, authenticated, service_role;
-- Separate from memory_private: anonymous callbacks cannot look up that schema.
grant usage on schema assistant_private to anon, authenticated;

create table assistant_private.settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  callback_url text not null default 'https://memory-awv.pages.dev/api/assistant-memory'
    check (callback_url = 'https://memory-awv.pages.dev/api/assistant-memory')
);
insert into assistant_private.settings default values;

create table assistant_private.jobs (
  entry_id uuid primary key references public.entries(id) on delete cascade,
  source_updated_at timestamptz not null,
  state text not null default 'queued'
    check (state in ('queued','dispatched','working','ready','inactive','failed')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  retry_at timestamptz not null default clock_timestamp(),
  token uuid unique,
  claim_until timestamptz,
  complete_until timestamptz,
  request_id bigint,
  last_error text check (last_error in ('DISPATCH_UNAVAILABLE','ATTEMPTS_EXHAUSTED','INVALID_MEMORY')),
  check ((state in ('dispatched','working')) = (token is not null)),
  check (state <> 'dispatched' or claim_until is not null),
  check (state <> 'working' or complete_until is not null)
);
create index assistant_memory_due_idx on assistant_private.jobs (retry_at, entry_id)
  where state in ('queued','dispatched','working');

create table assistant_private.memories (
  entry_id uuid primary key references public.entries(id) on delete cascade,
  source_updated_at timestamptz not null,
  memory jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table assistant_private.settings enable row level security;
alter table assistant_private.jobs enable row level security;
alter table assistant_private.memories enable row level security;
revoke all on table assistant_private.settings, assistant_private.jobs, assistant_private.memories
  from public, anon, authenticated, service_role;

create function assistant_private.valid_memory(p_memory jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare field text; item jsonb;
begin
  -- Type gates are separate statements: never depend on optimizer evaluation
  -- order before calling object/array set-returning functions on untrusted JSON.
  if p_memory is null or jsonb_typeof(p_memory) <> 'object' then return false; end if;
  if octet_length(p_memory::text) > 8192
    or (select count(*) from jsonb_object_keys(p_memory)) <> 3
    or not (p_memory ?& array['summary','themes','statedFeelings'])
    or jsonb_typeof(p_memory -> 'summary') is distinct from 'string'
    or char_length(p_memory ->> 'summary') not between 1 and 420
    or (p_memory ->> 'summary') ~ '^[[:space:]]*$' then return false; end if;
  foreach field in array array['themes','statedFeelings'] loop
    if jsonb_typeof(p_memory -> field) is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_memory -> field) > 6 then return false; end if;
    for item in select jsonb_array_elements(p_memory -> field) loop
      if jsonb_typeof(item) is distinct from 'string'
        or char_length(item #>> '{}') not between 1 and 80
        or (item #>> '{}') ~ '^[[:space:]]*$' then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;
alter table assistant_private.memories add constraint assistant_memory_shape
  check (assistant_private.valid_memory(memory));

create function assistant_private.read_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and memory_private.is_member()
    and exists (select 1 from assistant_private.settings s where s.singleton and s.enabled);
$$;

create policy assistant_memory_read on assistant_private.memories for select to authenticated
using (
  (select assistant_private.read_enabled())
  and exists (
    select 1 from public.entries e
    where e.id = assistant_private.memories.entry_id
      and e."updatedAt" = assistant_private.memories.source_updated_at
      and e.status = 'published' and e.type in ('note','event') and e."deletedAt" is null
  )
);
grant select on table assistant_private.memories to authenticated;

create view public.assistant_memories with (security_invoker = true) as
  select entry_id, source_updated_at, memory from assistant_private.memories;
revoke all on table public.assistant_memories from public, anon, authenticated, service_role;
grant select on table public.assistant_memories to authenticated;

-- Every path that changes a source takes its entry lock before its job lock.
-- Keep a content-free inactive job as a tracking marker, so a later restoration
-- or re-sharing can be regenerated without scanning historical untracked posts.
create function assistant_private.capture_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare shared boolean; tracked boolean; newly_published boolean;
begin
  shared := new.status = 'published' and new.type in ('note','event') and new."deletedAt" is null;
  select exists (select 1 from assistant_private.jobs j where j.entry_id = new.id) into tracked;
  newly_published := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    newly_published := old.status <> 'published' or old.type = 'whisper';
  end if;

  -- Invalidated in the same source transaction, even while dispatch is paused.
  delete from assistant_private.memories where entry_id = new.id;
  if not shared then
    update assistant_private.jobs
    set state = 'inactive', token = null, claim_until = null, complete_until = null,
        request_id = null, last_error = null, source_updated_at = new."updatedAt"
    where entry_id = new.id;
  elsif tracked or newly_published then
    insert into assistant_private.jobs as current_job (entry_id,source_updated_at,retry_at)
    values (new.id,new."updatedAt",clock_timestamp() + interval '30 seconds')
    on conflict (entry_id) do update
      set source_updated_at = excluded.source_updated_at, state = 'queued', attempts = 0,
          retry_at = excluded.retry_at, token = null, claim_until = null,
          complete_until = null, request_id = null, last_error = null;
  end if;
  return new;
end;
$$;
create trigger entries_assistant_memory after insert or update on public.entries
  for each row execute function assistant_private.capture_entry();

-- This capability is deliberately not a login JWT. Anonymous access is limited
-- to an unguessable, short-lived token for one entry and exact source revision.
-- One successful claim consumes the read phase; one completion consumes write.
create function assistant_private.claim(p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare entry_uuid uuid; source public.entries%rowtype; job assistant_private.jobs%rowtype;
begin
  if p_token is null or not exists (select 1 from assistant_private.settings where singleton and enabled)
    or not exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady") then return null; end if;
  select j.entry_id into entry_uuid from assistant_private.jobs j where j.token = p_token;
  if not found then return null; end if;
  select * into source from public.entries where id = entry_uuid for update;
  if not found then return null; end if;
  select * into job from assistant_private.jobs where entry_id = entry_uuid for update;
  if not found or job.token is distinct from p_token or job.state <> 'dispatched'
    or job.claim_until <= clock_timestamp() or job.source_updated_at <> source."updatedAt"
    or source.status <> 'published' or source.type not in ('note','event') or source."deletedAt" is not null then return null; end if;
  update assistant_private.jobs set state = 'working', claim_until = null,
    complete_until = clock_timestamp() + interval '120 seconds' where entry_id = entry_uuid;
  return jsonb_build_object('id',source.id,'title',source.title,'content',source.content,
    'tags',source.tags,'mood',source.mood,'occurredAt',source."occurredAt");
end;
$$;

create function assistant_private.complete(p_token uuid, p_memory jsonb)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare entry_uuid uuid; source public.entries%rowtype; job assistant_private.jobs%rowtype;
begin
  if p_token is null or not exists (select 1 from assistant_private.settings where singleton and enabled)
    or not exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady") then return false; end if;
  select j.entry_id into entry_uuid from assistant_private.jobs j where j.token = p_token;
  if not found then return false; end if;
  select * into source from public.entries where id = entry_uuid for update;
  if not found then return false; end if;
  select * into job from assistant_private.jobs where entry_id = entry_uuid for update;
  if not found or job.token is distinct from p_token or job.state <> 'working'
    or job.complete_until <= clock_timestamp() or job.source_updated_at <> source."updatedAt"
    or source.status <> 'published' or source.type not in ('note','event') or source."deletedAt" is not null then return false; end if;
  if not assistant_private.valid_memory(p_memory) then
    update assistant_private.jobs set state = case when attempts >= 3 then 'failed' else 'queued' end,
      token = null, claim_until = null, complete_until = null,
      retry_at = clock_timestamp() + interval '5 minutes', last_error = 'INVALID_MEMORY'
    where entry_id = entry_uuid;
    return false;
  end if;
  insert into assistant_private.memories as existing_memory (entry_id,source_updated_at,memory)
  values (entry_uuid,source."updatedAt",p_memory)
  on conflict (entry_id) do update set source_updated_at = excluded.source_updated_at,
    memory = excluded.memory, created_at = clock_timestamp();
  update assistant_private.jobs set state = 'ready', token = null, claim_until = null,
    complete_until = null, last_error = null where entry_id = entry_uuid;
  return true;
end;
$$;

create function public.assistant_memory_claim(p_token uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select assistant_private.claim(p_token);
$$;
create function public.assistant_memory_complete(p_token uuid, p_memory jsonb)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select assistant_private.complete(p_token,p_memory);
$$;

-- One cron pass handles at most three entries; each revision gets at most three
-- dispatches total. A lost pg_net request or worker crash becomes a bounded retry.
-- Advisory try-lock plus SKIP LOCKED prevents overlapping dispatchers waiting on
-- publishers or on each other. Tokens never appear in cron.job or error strings.
create function assistant_private.dispatch()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare config assistant_private.settings%rowtype; candidate record;
  job assistant_private.jobs%rowtype; next_token uuid; request bigint; sent integer := 0;
begin
  select * into config from assistant_private.settings where singleton;
  if not found or not config.enabled
    or not exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady")
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
    or not pg_try_advisory_xact_lock(hashtextextended('assistant-shared-memory-dispatch',0)) then return 0; end if;

  for candidate in
    select e.id from public.entries e join assistant_private.jobs j on j.entry_id = e.id
    where e.status = 'published' and e.type in ('note','event') and e."deletedAt" is null
      and j.source_updated_at = e."updatedAt" and j.retry_at <= clock_timestamp()
      and (j.state = 'queued' or (j.state = 'dispatched' and j.claim_until <= clock_timestamp())
        or (j.state = 'working' and j.complete_until <= clock_timestamp()))
    order by j.retry_at,e.id limit 3 for update of e skip locked
  loop
    select * into job from assistant_private.jobs where entry_id = candidate.id for update;
    if job.attempts >= 3 then
      update assistant_private.jobs set state = 'failed', token = null, claim_until = null,
        complete_until = null, last_error = 'ATTEMPTS_EXHAUSTED' where entry_id = candidate.id;
      continue;
    end if;
    next_token := gen_random_uuid();
    update assistant_private.jobs set state = 'dispatched', attempts = attempts + 1,
      token = next_token, claim_until = clock_timestamp() + interval '90 seconds', complete_until = null,
      retry_at = clock_timestamp() + case when job.attempts = 0 then interval '2 minutes' else interval '5 minutes' end,
      request_id = null, last_error = null where entry_id = candidate.id;
    begin
      select net.http_post(
        url := config.callback_url,
        headers := jsonb_build_object('Content-Type','application/json','X-Assistant-Memory-Token',next_token::text),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      ) into request;
      if request is null then raise exception 'DISPATCH_UNAVAILABLE'; end if;
      update assistant_private.jobs set request_id = request where entry_id = candidate.id;
      sent := sent + 1;
    exception when others then
      update assistant_private.jobs set state = case when attempts >= 3 then 'failed' else 'queued' end,
        token = null, claim_until = null, complete_until = null, last_error = 'DISPATCH_UNAVAILABLE'
      where entry_id = candidate.id;
    end;
  end loop;
  return sent;
end;
$$;

revoke all on function assistant_private.valid_memory(jsonb), assistant_private.read_enabled(),
  assistant_private.capture_entry(), assistant_private.claim(uuid), assistant_private.complete(uuid,jsonb),
  assistant_private.dispatch(), public.assistant_memory_claim(uuid), public.assistant_memory_complete(uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function assistant_private.read_enabled() to authenticated;
grant execute on function assistant_private.claim(uuid), assistant_private.complete(uuid,jsonb),
  public.assistant_memory_claim(uuid), public.assistant_memory_complete(uuid,jsonb) to anon, authenticated;

-- Do not silently enable dispatch or create jobs for pre-existing publications.
-- pg_net is optional in isolated local tests. Hosted installations must verify
-- these prerequisites before the owner enables assistant_private.settings.
do $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
    and current_setting('pg_net.ttl',true) is not null
    and exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
    and to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('assistant-shared-memory','* * * * *','select assistant_private.dispatch()');
  end if;
end;
$$;
