create table memory_private.activity_capture (
  id boolean primary key default true check (id),
  started_at timestamptz not null default clock_timestamp()
);

create table memory_private.activity_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('login', 'publish', 'comment', 'edit', 'delete', 'restore')),
  entry_id uuid,
  occurred_at timestamptz not null
);

create index activity_events_time_idx on memory_private.activity_events (occurred_at desc, id desc);
create index activity_events_edit_idx on memory_private.activity_events (actor_id, entry_id, occurred_at)
  where action = 'edit';

alter table memory_private.activity_capture enable row level security;
alter table memory_private.activity_events enable row level security;
revoke all on memory_private.activity_capture, memory_private.activity_events from public, anon, authenticated, service_role;

-- These existing rows retain their author and creation time. There is no
-- equivalent complete history of earlier logins, edits or trash operations.
insert into memory_private.activity_events (actor_id, action, entry_id, occurred_at)
select e."authorId", 'publish', e.id, e."createdAt"
from public.entries e join public.profiles p on p.id = e."authorId" and p.role = 'member'
where e.status = 'published'
union all
select c."authorId", 'comment', c."entryId", c."createdAt"
from public.comments c join public.profiles p on p.id = c."authorId" and p.role = 'member';

insert into memory_private.activity_capture default values;

create function memory_private.capture_session_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into memory_private.activity_events (actor_id, action, occurred_at)
  select p.id, 'login', coalesce(new.created_at, clock_timestamp())
  from public.profiles p where p.id = new.user_id and p.role = 'member';
  return new;
end;
$$;

create function memory_private.capture_entry_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  event_action text;
begin
  if memory_private.member_role() is distinct from 'member' or new.status <> 'published' then
    return new;
  end if;

  if tg_op = 'INSERT' or old.status = 'draft' then
    event_action := 'publish';
  elsif old."deletedAt" is null and new."deletedAt" is not null then
    event_action := 'delete';
  elsif old."deletedAt" is not null and new."deletedAt" is null then
    event_action := 'restore';
  elsif new."deletedAt" is null and
      row(old.type, old.title, old.content, old."occurredAt", old.mood, old.tags)
        is distinct from row(new.type, new.title, new.content, new."occurredAt", new.mood, new.tags) then
    event_action := 'edit';
  end if;

  if event_action is not null then
    insert into memory_private.activity_events (actor_id, action, entry_id, occurred_at)
    values (actor, event_action, new.id, new."updatedAt");
  end if;
  return new;
end;
$$;

-- The publication RPC writes status again when saving a published record,
-- including attachment-only edits. Its compare-and-swap timestamp identifies
-- the metadata edit already counted by the preceding update.
create function memory_private.capture_attachment_save()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if memory_private.member_role() = 'member' and not exists (
    select 1 from memory_private.activity_events
    where actor_id = actor and action = 'edit' and entry_id = new.id and occurred_at = old."updatedAt"
  ) then
    insert into memory_private.activity_events (actor_id, action, entry_id, occurred_at)
    values (actor, 'edit', new.id, new."updatedAt");
  end if;
  return new;
end;
$$;

create function memory_private.capture_comment_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if memory_private.member_role() = 'member' and new."authorId" = auth.uid() then
    insert into memory_private.activity_events (actor_id, action, entry_id, occurred_at)
    values (new."authorId", 'comment', new."entryId", new."createdAt");
  end if;
  return new;
end;
$$;

revoke all on function memory_private.capture_session_created(), memory_private.capture_entry_activity(),
  memory_private.capture_attachment_save(), memory_private.capture_comment_activity()
  from public, anon, authenticated, service_role;

create trigger memory_activity_entry after insert or update on public.entries
  for each row execute function memory_private.capture_entry_activity();
create trigger memory_activity_save after update of status on public.entries
  for each row when (old.status = 'published' and new.status = 'published'
    and old."deletedAt" is null and new."deletedAt" is null)
  execute function memory_private.capture_attachment_save();
create trigger memory_activity_comment after insert on public.comments
  for each row execute function memory_private.capture_comment_activity();
create trigger memory_activity_session after insert on auth.sessions
  for each row execute function memory_private.capture_session_created();

create function memory_private.read_admin_activity(p_days integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  measured_at timestamptz := statement_timestamp();
  since_at timestamptz;
  accounts jsonb;
  recent jsonb;
  resources jsonb;
begin
  if memory_private.member_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
  if p_days is null or p_days not in (0, 7, 30, 90) then
    raise exception using errcode = '22023', message = 'Unsupported activity window';
  end if;
  since_at := case when p_days = 0 then '-infinity'::timestamptz
    else measured_at - make_interval(days => p_days) end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', report.slot, 'name', report.name, 'lastLoginAt', report.last_sign_in_at,
    'logins', report.logins, 'posts', report.posts, 'comments', report.comments,
    'edits', report.edits, 'deletes', report.deletes, 'restores', report.restores
  ) order by report.slot), '[]'::jsonb) into accounts
  from (
    select p.slot, p.name, u.last_sign_in_at,
      count(*) filter (where a.action = 'login') as logins,
      count(*) filter (where a.action = 'publish') as posts,
      count(*) filter (where a.action = 'comment') as comments,
      count(*) filter (where a.action = 'edit') as edits,
      count(*) filter (where a.action = 'delete') as deletes,
      count(*) filter (where a.action = 'restore') as restores
    from public.profiles p join auth.users u on u.id = p.id
    left join memory_private.activity_events a on a.actor_id = p.id and a.occurred_at >= since_at
    where p.role = 'member'
    group by p.slot, p.name, u.last_sign_in_at
  ) report;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', activity.slot, 'name', activity.name, 'action', activity.action, 'at', activity.occurred_at,
    'title', activity.title
  ) order by activity.occurred_at desc, activity.id desc), '[]'::jsonb) into recent
  from (
    select a.id, a.action, a.occurred_at, p.slot, p.name, nullif(e.title, '') as title
    from memory_private.activity_events a
    join public.profiles p on p.id = a.actor_id and p.role = 'member'
    left join public.entries e on e.id = a.entry_id
    where a.occurred_at >= since_at
    order by a.occurred_at desc, a.id desc
    limit 40
  ) activity;

  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'storageBytes', coalesce(sum(bytes), 0),
    'storageObjects', count(*),
    'measuredObjects', count(bytes),
    'connections', (select count(*) from pg_stat_activity where backend_type = 'client backend'),
    'maxConnections', current_setting('max_connections')::integer
  ) into resources
  from (
    select case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric end as bytes
    from storage.objects o where o.bucket_id in ('memory-media', 'login-photos')
  ) stored_objects;

  return jsonb_build_object(
    'measuredAt', measured_at,
    'trackedSince', (select started_at from memory_private.activity_capture where id),
    'accounts', accounts,
    'recent', recent,
    'resources', resources
  );
end;
$$;

create function public.admin_activity_report(p_days integer default 30)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select memory_private.read_admin_activity(p_days);
$$;

revoke all on function memory_private.read_admin_activity(integer), public.admin_activity_report(integer)
  from public, anon, authenticated, service_role;
grant execute on function memory_private.read_admin_activity(integer), public.admin_activity_report(integer)
  to authenticated;
