-- A purge request is irreversible from the moment this marker is set. Workers
-- may retry cleanup after a failed request without reopening the restore path.
alter table public.entries
  add column "purgeRequestedAt" timestamptz check (
    "purgeRequestedAt" is null or ("deletedAt" is not null and isfinite("purgeRequestedAt"))
  );

create index memory_recycle_due_idx on public.entries ("deletedAt", id)
where "deletedAt" is not null;

create table memory_private.recycle_settings (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null default clock_timestamp(),
  callback_url text,
  cron_token text not null default (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  )
);
insert into memory_private.recycle_settings default values;

create table memory_private.recycle_leases (
  entry_id uuid primary key references public.entries(id) on delete cascade,
  lease_id uuid not null unique,
  lease_until timestamptz not null
);
alter table memory_private.recycle_settings enable row level security;
alter table memory_private.recycle_leases enable row level security;
revoke all on table memory_private.recycle_settings, memory_private.recycle_leases
from public, anon, authenticated, service_role;

create function memory_private.recycle_guard_restore()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old."purgeRequestedAt" is not null and new."deletedAt" is distinct from old."deletedAt" then
    raise exception using errcode = 'P0001', message = 'RECYCLE_IN_PROGRESS';
  end if;
  -- Keep the first deletion time until the record is actually restored.
  if old."deletedAt" is not null and new."deletedAt" is not null then
    new."deletedAt" := old."deletedAt";
  end if;
  return new;
end;
$$;

-- This follows entries_guard, which first replaces a supplied date with server time.
create trigger entries_recycle_guard before update of "deletedAt" on public.entries
for each row execute function memory_private.recycle_guard_restore();

create function memory_private.recycle_media_paths(p_entry_id uuid, p_author_id uuid)
returns table (path text) language sql stable set search_path = '' as $$
  select m."storagePath" from public.media m where m."entryId" = p_entry_id
  union
  select o.name
  from storage.objects o
  where o.bucket_id = 'memory-media'
    and o.name like p_author_id::text || '/' || p_entry_id::text || '/%'
    and split_part(o.name, '/', 3) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and cardinality(string_to_array(o.name, '/')) = 3;
$$;

-- The caller must hold the entry row lock before requesting a lease.
create function memory_private.recycle_claim(p_entry_id uuid, p_author_id uuid, p_now timestamptz)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  claimed_lease uuid;
begin
  update public.entries set "purgeRequestedAt" = p_now
  where id = p_entry_id and "deletedAt" is not null and "purgeRequestedAt" is null;

  insert into memory_private.recycle_leases as current_lease (entry_id, lease_id, lease_until)
  values (p_entry_id, gen_random_uuid(), p_now + interval '2 minutes')
  on conflict (entry_id) do update set lease_id = excluded.lease_id, lease_until = excluded.lease_until
    where current_lease.lease_until <= p_now
  returning lease_id into claimed_lease;

  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'entry_id', p_entry_id, 'lease_id', claimed_lease,
    'media_paths', coalesce((
      select jsonb_agg(p.path order by p.path) from memory_private.recycle_media_paths(p_entry_id, p_author_id) p
    ), '[]'::jsonb)
  );
end;
$$;

create function memory_private.recycle_claim_manual(p_entry_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  member_role text := memory_private.member_role();
  candidate record;
  claim jsonb;
  claims jsonb := '[]'::jsonb;
  queued integer := 0;
begin
  if actor is null or member_role is null then
    raise exception using errcode = '42501', message = 'RECYCLE_UNAUTHORIZED';
  end if;
  for candidate in
    select e.id, e."authorId", e."purgeRequestedAt"
    from public.entries e
    where e."deletedAt" is not null
      and (e."authorId" = actor or (member_role = 'admin' and e.status = 'published'))
      and ((p_entry_id is null and e.status = 'published') or e.id = p_entry_id)
    order by e.id
    for update of e
  loop
    queued := queued + 1;
    if jsonb_array_length(claims) < 10 then
      claim := memory_private.recycle_claim(candidate.id, candidate."authorId", clock_timestamp());
      if claim is not null then
        claims := claims || jsonb_build_array(claim);
      end if;
    elsif candidate."purgeRequestedAt" is null then
      update public.entries set "purgeRequestedAt" = clock_timestamp() where id = candidate.id;
    end if;
  end loop;
  if p_entry_id is not null and queued = 0 then
    raise exception using errcode = 'P0001', message = 'RECYCLE_UNAVAILABLE';
  end if;
  return jsonb_build_object('queued', queued, 'claims', claims);
end;
$$;

create function memory_private.recycle_claim_expired(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  now_at timestamptz := clock_timestamp();
  due_before timestamptz := now_at - interval '168 hours';
  activated_at timestamptz;
  candidate record;
  claim jsonb;
  claims jsonb := '[]'::jsonb;
begin
  select s.activated_at into activated_at from memory_private.recycle_settings s
  where s.singleton and s.cron_token = p_token;
  if not found or not exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady") then
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

create function memory_private.recycle_finalize(p_entry_id uuid, p_lease_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  author_id uuid;
begin
  select e."authorId" into author_id
  from public.entries e
  where e.id = p_entry_id and e."deletedAt" is not null and e."purgeRequestedAt" is not null
  for update of e;
  if not found or not exists (
    select 1 from memory_private.recycle_leases l where l.entry_id = p_entry_id and l.lease_id = p_lease_id
  ) or not exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady") then
    return false;
  end if;

  -- Only Storage API removes object bytes and metadata. A partial/failed object
  -- deletion keeps the row, its media paths and its irreversible request marker.
  if exists (
    select 1 from memory_private.recycle_media_paths(p_entry_id, author_id) p
    join storage.objects o on o.bucket_id = 'memory-media' and o.name = p.path
  ) then
    raise exception using errcode = 'P0001', message = 'RECYCLE_STORAGE_REMAINS';
  end if;

  delete from public.comments where "entryId" = p_entry_id;
  delete from public.reactions where "entryId" = p_entry_id;
  delete from public.favorites where "entryId" = p_entry_id;
  delete from public.media where "entryId" = p_entry_id;
  delete from memory_private.points_inbox where entry_id = p_entry_id;
  -- The already-earned points ledger and activity counts retain their history.
  -- The entry FK removes the confirmation and worker lease automatically.
  delete from public.entries where id = p_entry_id;
  return found;
end;
$$;


create function public.recycle_claim_manual(p_entry_id uuid default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.recycle_claim_manual(p_entry_id);
$$;

create function public.recycle_claim_expired(p_token text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.recycle_claim_expired(p_token);
$$;

create function public.recycle_finalize(p_entry_id uuid, p_lease_id uuid)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select memory_private.recycle_finalize(p_entry_id, p_lease_id);
$$;

-- Configure only after deploying the project-owned Edge Function. The token
-- stays in the private settings and is resolved at dispatch, not in cron.job.
create function memory_private.recycle_set_callback(p_url text)
returns void language plpgsql volatile set search_path = '' as $$
begin
  if p_url is not null and p_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/memory-recycle$' then
    raise exception using errcode = '22023', message = 'Invalid recycle purge function URL';
  end if;
  update memory_private.recycle_settings set callback_url = p_url where singleton;
end;
$$;

create function memory_private.recycle_dispatch()
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
  perform net.http_post(
    url := settings.callback_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-memory-recycle-token', settings.cron_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function memory_private.recycle_guard_restore(), memory_private.recycle_media_paths(uuid, uuid),
  memory_private.recycle_claim(uuid, uuid, timestamptz), memory_private.recycle_claim_manual(uuid),
  memory_private.recycle_claim_expired(text), memory_private.recycle_finalize(uuid, uuid),
  public.recycle_claim_manual(uuid), public.recycle_claim_expired(text), public.recycle_finalize(uuid, uuid),
  memory_private.recycle_set_callback(text), memory_private.recycle_dispatch()
from public, anon, authenticated, service_role;
grant execute on function memory_private.recycle_claim_manual(uuid), public.recycle_claim_manual(uuid)
to authenticated;
grant execute on function memory_private.recycle_claim_expired(text), memory_private.recycle_finalize(uuid, uuid),
  public.recycle_claim_expired(text), public.recycle_finalize(uuid, uuid)
to service_role;

-- Supabase preloads pg_net. Isolated PostgreSQL without it still supports the
-- full claim/finalize protocol; the hosted worker is configured after deploy.
do $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
    and current_setting('pg_net.ttl', true) is not null
    and exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
    and to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('memory-recycle-purge', '*/5 * * * *', 'select memory_private.recycle_dispatch()');
  end if;
end;
$$;
