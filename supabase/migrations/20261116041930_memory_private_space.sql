-- Memory private space. Auth/bootstrap and private bucket require separate official API configuration.

create schema memory_private;
revoke all on schema memory_private from public, anon, authenticated;
grant usage on schema memory_private to authenticated;

-- Fail closed until the project owner verifies native Auth CAPTCHA and disables signup.
-- No API role receives a grant on this table. Only a trusted database administrator opens it.
create table memory_private.runtime_guard (
  id smallint primary key default 1 check (id = 1),
  "authReady" boolean not null default false
);
alter table memory_private.runtime_guard enable row level security;
revoke all on table memory_private.runtime_guard from public,anon,authenticated,service_role;
insert into memory_private.runtime_guard (id) values (1);

create function memory_private.valid_tags(value text[])
returns boolean language sql immutable set search_path = '' as $$
  select value is not null
    and cardinality(value) <= 20
    and (cardinality(value) = 0 or array_ndims(value) = 1)
    and not exists (select 1 from unnest(value) tag where tag is null or tag <> regexp_replace(tag, '^[[:space:]]+|[[:space:]]+$', '', 'g') or char_length(tag) not between 1 and 40)
    and cardinality(value) = (select count(distinct tag) from unnest(value) tag);
$$;

create function memory_private.valid_anniversaries(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; item_date date;
begin
  if value is null or jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 100 then return false; end if;
  for item in select jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item -> 'id') is distinct from 'string'
      or char_length(item ->> 'id') not between 1 and 100
      or jsonb_typeof(item -> 'title') is distinct from 'string'
      or char_length(btrim(item ->> 'title')) not between 1 and 120
      or (item ->> 'title') ~ '^[[:space:]]*$'
      or jsonb_typeof(item -> 'date') is distinct from 'string'
      or (item ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(item -> 'yearly') is distinct from 'boolean' then return false; end if;
    item_date := (item ->> 'date')::date;
    if item_date < date '1000-01-01' or item_date > date '9999-12-31'
      or to_char(item_date, 'YYYY-MM-DD') <> item ->> 'date' then return false; end if;
  end loop;
  return jsonb_array_length(value) = (select count(distinct a.anniversary ->> 'id') from jsonb_array_elements(value) as a(anniversary));
exception when others then return false;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  slot smallint not null unique check (slot between 1 and 3),
  username text not null unique check (username ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60 and name !~ '^[[:space:]]*$'),
  role text not null check (role in ('member', 'admin')),
  color text not null default '#D78789' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint profiles_fixed_slots check (
    (slot = 1 and username = 'xbl' and role = 'member') or
    (slot = 2 and username = 'll' and role = 'member') or
    (slot = 3 and username not in ('xbl', 'll') and role = 'admin')
  )
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  "authorId" uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'published')),
  type text not null default 'note' check (type in ('note', 'event')),
  title text not null default '' check (char_length(title) <= 120),
  content text not null default '' check (char_length(content) <= 20000),
  "occurredAt" timestamptz not null default now() check ("occurredAt" >= timestamptz '1000-01-01 00:00:00+00' and "occurredAt" < timestamptz '10000-01-01 00:00:00+00'),
  mood text check (mood in ('happy', 'neutral', 'sad')),
  tags text[] not null default '{}' check (memory_private.valid_tags(tags)),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "deletedAt" timestamptz check ("deletedAt" is null or isfinite("deletedAt")),
  constraint entries_event_title check (type <> 'event' or title !~ '^[[:space:]]*$')
);
create index entries_author_idx on public.entries ("authorId");
create index entries_timeline_idx on public.entries ("occurredAt" desc, "createdAt" desc);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  "entryId" uuid not null references public.entries(id) on delete restrict,
  "authorId" uuid not null references public.profiles(id) on delete restrict,
  "uploadedBy" uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 255),
  "mimeType" text not null check ("mimeType" in ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime')),
  size bigint not null check (size between 1 and 50000000),
  type text not null check (type in ('image', 'video')),
  "storagePath" text not null unique,
  position integer not null check (position >= 0),
  status text not null default 'pending' check (status in ('pending', 'ready', 'retired')),
  attached boolean not null default false check (not attached or status = 'ready'),
  "createdAt" timestamptz not null default now(),
  constraint media_mime_kind check (type = case when "mimeType" like 'image/%' then 'image' else 'video' end),
  constraint media_path_bound check ("storagePath" = "authorId"::text || '/' || "entryId"::text || '/' || id::text),
  unique ("entryId", position)
);
create index media_author_idx on public.media ("authorId");
create index media_uploader_idx on public.media ("uploadedBy");

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  "entryId" uuid not null references public.entries(id) on delete restrict,
  "authorId" uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  content text not null check (char_length(content) between 1 and 5000 and content !~ '^[[:space:]]*$'),
  "createdAt" timestamptz not null default now()
);
create index comments_entry_idx on public.comments ("entryId", "createdAt");
create index comments_author_idx on public.comments ("authorId");

create table public.reactions (
  "entryId" uuid not null references public.entries(id) on delete restrict,
  "userId" uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  "createdAt" timestamptz not null default now(),
  primary key ("entryId", "userId")
);
create index reactions_user_idx on public.reactions ("userId");

create table public.favorites (
  "entryId" uuid not null references public.entries(id) on delete restrict,
  "userId" uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  "createdAt" timestamptz not null default now(),
  primary key ("entryId", "userId")
);
create index favorites_user_idx on public.favorites ("userId");

create table public.settings (
  id smallint primary key default 1 check (id = 1),
  "spaceName" text not null default '朝夕' check (char_length(btrim("spaceName")) between 1 and 60 and "spaceName" !~ '^[[:space:]]*$'),
  subtitle text not null default '' check (char_length(subtitle) <= 300),
  "startDate" date not null default current_date check ("startDate" between date '1000-01-01' and date '9999-12-31'),
  anniversaries jsonb not null default '[]' check (memory_private.valid_anniversaries(anniversaries)),
  "updatedAt" timestamptz not null default now()
);
-- A neutral initial value, not a claimed personal anniversary. Admin must set the real date.
insert into public.settings (id) values (1);

-- Every authorization lookup uses the current UUID and this non-client-editable whitelist.
-- Keep this helper private to avoid recursive profiles RLS; no JWT user_metadata is trusted.
create function memory_private.member_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p join memory_private.runtime_guard g on g.id = 1 and g."authReady"
  where auth.uid() is not null and p.id = auth.uid();
$$;
create function memory_private.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and memory_private.member_role() is not null;
$$;

create function memory_private.can_edit_entry(entry_id uuid, require_active boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select memory_private.is_member() and exists (
    select 1 from public.entries e join public.profiles p on p.id = auth.uid()
    where e.id = entry_id and (not require_active or e."deletedAt" is null)
      and (e.status = 'published' or e."authorId" = p.id)
      and (e."authorId" = p.id or p.role = 'admin')
  );
$$;

create function memory_private.entry_is_active(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select memory_private.is_member() and exists (
    select 1 from public.entries e join public.profiles p on p.id = auth.uid()
    where e.id = entry_id and e.status = 'published' and e."deletedAt" is null
  );
$$;

create function memory_private.entry_is_published(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and memory_private.is_member() and exists (
    select 1 from public.entries e where e.id = entry_id and e.status = 'published'
  );
$$;

create function memory_private.guard_entry()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new."authorId" is distinct from old."authorId" or new."createdAt" is distinct from old."createdAt" then
      raise exception using errcode = '23514', message = 'Entry identity, author, and creation time are immutable';
    end if;
    if old."deletedAt" is not null and row(new.type,new.title,new.content,new."occurredAt",new.mood,new.tags)
      is distinct from row(old.type,old.title,old.content,old."occurredAt",old.mood,old.tags) then
      raise exception using errcode = '23514', message = 'Restore an entry before editing it';
    end if;
    new."updatedAt" := greatest(clock_timestamp(), old."updatedAt" + interval '1 microsecond');
    if new."deletedAt" is not null and new."deletedAt" is distinct from old."deletedAt" then new."deletedAt" := new."updatedAt"; end if;
  end if;
  if new.status = 'published' and new.title ~ '^[[:space:]]*$' and new.content ~ '^[[:space:]]*$'
    and not exists (select 1 from public.media m where m."entryId" = new.id and m.attached and m.status = 'ready') then
    raise exception using errcode = '23514', message = 'A published entry requires text or a ready attached file';
  end if;
  return new;
end;
$$;
create trigger entries_guard before update on public.entries for each row execute function memory_private.guard_entry();

create function memory_private.touch_settings()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id then raise exception using errcode = '23514', message = 'Settings identity is immutable'; end if;
  new."updatedAt" := greatest(clock_timestamp(), old."updatedAt" + interval '1 microsecond');
  return new;
end;
$$;
create trigger settings_touch before update on public.settings for each row execute function memory_private.touch_settings();

alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.media enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.favorites enable row level security;
alter table public.settings enable row level security;

revoke all on table public.profiles,public.entries,public.media,public.comments,public.reactions,public.favorites,public.settings from public,anon,authenticated;
grant usage on schema public to authenticated;
grant select on table public.profiles,public.entries,public.media,public.comments,public.reactions,public.favorites,public.settings to authenticated;
grant insert (id,"authorId",type,title,content,"occurredAt",mood,tags) on public.entries to authenticated;
grant update (type,title,content,"occurredAt",mood,tags,"deletedAt") on public.entries to authenticated;
grant insert (id,"entryId","authorId",content) on public.comments to authenticated;
grant insert ("entryId","userId") on public.reactions,public.favorites to authenticated;
grant delete on public.reactions,public.favorites to authenticated;
grant update ("spaceName",subtitle,"startDate",anniversaries) on public.settings to authenticated;
-- Trusted bootstrap/backup clients only. Never give this credential to a browser.
grant select,insert,update,delete on public.profiles,public.entries,public.media,public.comments,public.reactions,public.favorites,public.settings to service_role;

create policy profiles_read on public.profiles for select to authenticated using ((select memory_private.member_role()) is not null);
create policy entries_read on public.entries for select to authenticated
  using ((select memory_private.member_role()) is not null and (status = 'published' or "authorId" = (select auth.uid())));
create policy entries_insert on public.entries for insert to authenticated with check ((select memory_private.member_role()) is not null and "authorId" = (select auth.uid()));
create policy entries_update on public.entries for update to authenticated
  using ((select memory_private.member_role()) is not null and (status = 'published' or "authorId" = (select auth.uid())) and ("authorId" = (select auth.uid()) or (select memory_private.member_role()) = 'admin'))
  with check ((select memory_private.member_role()) is not null and (status = 'published' or "authorId" = (select auth.uid())) and ("authorId" = (select auth.uid()) or (select memory_private.member_role()) = 'admin'));
create policy media_read on public.media for select to authenticated
  using ((select memory_private.member_role()) is not null and ("authorId" = (select auth.uid())
    or (memory_private.entry_is_published("entryId") and ((attached and status = 'ready') or (select memory_private.member_role()) = 'admin'))));
create policy comments_read on public.comments for select to authenticated using (memory_private.entry_is_published("entryId"));
create policy comments_insert on public.comments for insert to authenticated
  with check ((select memory_private.member_role()) is not null and "authorId" = (select auth.uid()) and memory_private.entry_is_active("entryId"));
create policy reactions_read on public.reactions for select to authenticated using (memory_private.entry_is_published("entryId"));
create policy reactions_insert on public.reactions for insert to authenticated
  with check ((select memory_private.member_role()) is not null and "userId" = (select auth.uid()) and memory_private.entry_is_active("entryId"));
create policy reactions_delete on public.reactions for delete to authenticated using ((select memory_private.member_role()) is not null and "userId" = (select auth.uid()));
create policy favorites_read on public.favorites for select to authenticated using (memory_private.entry_is_published("entryId"));
create policy favorites_insert on public.favorites for insert to authenticated
  with check ((select memory_private.member_role()) is not null and "userId" = (select auth.uid()) and memory_private.entry_is_active("entryId"));
create policy favorites_delete on public.favorites for delete to authenticated using ((select memory_private.member_role()) is not null and "userId" = (select auth.uid()));
create policy settings_read on public.settings for select to authenticated using ((select memory_private.member_role()) is not null);
create policy settings_update on public.settings for update to authenticated using ((select memory_private.member_role()) = 'admin') with check ((select memory_private.member_role()) = 'admin');

-- Media writes are RPC-only. All routines lock entry first, then the media row.
-- Published/attached images are limited to nine. Staging is separately bounded to
-- ten total unattached files and nine unattached images, including retired files.
create function memory_private.reserve_media(p_entry_id uuid,p_name text,p_mime_type text,p_size bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare entry_row public.entries%rowtype; media_row public.media%rowtype; actor uuid := auth.uid(); new_id uuid := gen_random_uuid(); new_type text;
begin
  if actor is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  select * into entry_row from public.entries where id = p_entry_id for update;
  if not found or not memory_private.can_edit_entry(p_entry_id,true) then raise exception using errcode = '42501', message = 'Entry unavailable or not editable'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 255 or p_name ~ '^[[:space:]]*$' or p_size is null or p_size not between 1 and 50000000
    or p_mime_type is null or p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime') then
    raise exception using errcode = '22023', message = 'Invalid media metadata or file exceeds 50,000,000 bytes';
  end if;
  new_type := case when p_mime_type like 'image/%' then 'image' else 'video' end;
  if (select count(*) from public.media where "entryId" = p_entry_id and not attached) >= 10 then
    raise exception using errcode = '23514', message = 'At most ten staging files per entry; clean up unfinished or retired uploads first';
  end if;
  if new_type = 'image' and (select count(*) from public.media where "entryId" = p_entry_id and type = 'image' and not attached) >= 9 then
    raise exception using errcode = '23514', message = 'At most nine staging images per entry; clean up unfinished or retired uploads first';
  end if;
  insert into public.media (id,"entryId","authorId","uploadedBy",name,"mimeType",size,type,"storagePath",position)
    values (new_id,p_entry_id,entry_row."authorId",actor,btrim(p_name),p_mime_type,p_size,new_type,
      entry_row."authorId"::text || '/' || p_entry_id::text || '/' || new_id::text,
      coalesce((select max(position) + 1 from public.media where "entryId" = p_entry_id),0)) returning * into media_row;
  return to_jsonb(media_row);
end;
$$;

create function memory_private.finalize_media(p_media_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare entry_id uuid; media_row public.media%rowtype; object_row storage.objects%rowtype; actor uuid := auth.uid();
begin
  if actor is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  select "entryId" into entry_id from public.media where id = p_media_id;
  if not found then raise exception using errcode = '42501', message = 'Attachment unavailable'; end if;
  perform 1 from public.entries where id = entry_id for update;
  if not memory_private.can_edit_entry(entry_id,true) then raise exception using errcode = '42501', message = 'Entry unavailable or not editable'; end if;
  select * into media_row from public.media where id = p_media_id for update;
  if not found then raise exception using errcode = '42501', message = 'Attachment unavailable'; end if;
  if media_row.status = 'ready' then return to_jsonb(media_row); end if;
  if media_row.status = 'retired' then raise exception using errcode = '23514', message = 'Retired attachments cannot be finalized again'; end if;
  select * into object_row from storage.objects where bucket_id = 'memory-media' and name = media_row."storagePath";
  if not found then raise exception using errcode = '23514', message = 'Upload is not complete; retry finalization'; end if;
  if object_row.owner_id is distinct from media_row."uploadedBy"::text
    or object_row.metadata ->> 'mimetype' is distinct from media_row."mimeType"
    or (case when object_row.metadata ->> 'size' ~ '^[0-9]+$' then (object_row.metadata ->> 'size')::numeric else null end) is distinct from media_row.size then
    raise exception using errcode = '23514', message = 'Uploaded object metadata does not match the reserved attachment';
  end if;
  update public.media set status = 'ready' where id = p_media_id returning * into media_row;
  return to_jsonb(media_row);
end;
$$;

create function memory_private.discard_media(p_media_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare entry_id uuid; media_row public.media%rowtype; actor uuid := auth.uid();
begin
  if actor is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  select "entryId" into entry_id from public.media where id = p_media_id;
  if not found then raise exception using errcode = '42501', message = 'Attachment unavailable'; end if;
  perform 1 from public.entries where id = entry_id for update;
  select * into media_row from public.media where id = p_media_id for update;
  if not found or not memory_private.can_edit_entry(entry_id,false) then raise exception using errcode = '42501', message = 'Attachment unavailable or not editable'; end if;
  if media_row.attached then raise exception using errcode = '23514', message = 'Detach saved media through publish_entry before deleting it'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'memory-media' and name = media_row."storagePath") then
    raise exception using errcode = '23514', message = 'Remove the object through the Storage API before discarding its attachment row';
  end if;
  delete from public.media where id = p_media_id;
end;
$$;

create function memory_private.publish_entry(p_entry_id uuid,p_media_ids uuid[],p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare entry_row public.entries%rowtype; actor uuid := auth.uid(); selected_count bigint;
begin
  if actor is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  select * into entry_row from public.entries where id = p_entry_id for update;
  if not found or not memory_private.can_edit_entry(p_entry_id,true) then raise exception using errcode = '42501', message = 'Entry unavailable or not editable'; end if;
  if p_expected_updated_at is not null and entry_row."updatedAt" is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'Entry was changed elsewhere; reload before publishing';
  end if;
  if p_media_ids is null or (cardinality(p_media_ids) > 0 and array_ndims(p_media_ids) <> 1)
    or cardinality(p_media_ids) <> (select count(distinct value) from unnest(p_media_ids) value) then
    raise exception using errcode = '22023', message = 'Media IDs must be a unique array without null elements';
  end if;
  if cardinality(p_media_ids) > 10 then raise exception using errcode = '23514', message = 'A published entry can contain at most ten files'; end if;
  perform 1 from public.media where "entryId" = p_entry_id order by id for update;
  select count(*) into selected_count from public.media m
    where m.id = any(p_media_ids) and m."entryId" = p_entry_id and m."authorId" = entry_row."authorId" and m.status = 'ready';
  if selected_count <> cardinality(p_media_ids) then raise exception using errcode = '23514', message = 'Selected attachments must be ready and belong to this entry'; end if;
  if (select count(*) from public.media where id = any(p_media_ids) and type = 'image') > 9 then
    raise exception using errcode = '23514', message = 'A published entry can contain at most nine images';
  end if;
  if entry_row.title ~ '^[[:space:]]*$' and entry_row.content ~ '^[[:space:]]*$' and selected_count = 0 then
    raise exception using errcode = '23514', message = 'A published entry requires text or a ready attached file';
  end if;
  -- Every selected object must still exist. Deletion/upload policies take the same entry
  -- lock, serializing metadata mutations; S3 bytes and SQL are still not one transaction.
  if exists (
    select 1 from public.media m where m.id = any(p_media_ids) and not exists (
      select 1 from storage.objects o where o.bucket_id = 'memory-media' and o.name = m."storagePath"
        and o.owner_id = m."uploadedBy"::text and o.metadata ->> 'mimetype' = m."mimeType"
        and case when o.metadata ->> 'size' ~ '^[0-9]+$' then (o.metadata ->> 'size')::numeric else null end = m.size
    )
  ) then raise exception using errcode = '23514', message = 'A selected file is unavailable or has invalid metadata'; end if;
  if (select count(*) from public.media where "entryId" = p_entry_id and not (id = any(p_media_ids))) > 10
    or (select count(*) from public.media where "entryId" = p_entry_id and not (id = any(p_media_ids)) and type = 'image') > 9 then
    raise exception using errcode = '23514', message = 'Too many files would remain in staging; clean up unused uploads first';
  end if;
  update public.media set attached = false,status = 'retired'
    where "entryId" = p_entry_id and attached and not (id = any(p_media_ids));
  update public.media set attached = true where "entryId" = p_entry_id and id = any(p_media_ids);
  update public.entries set status = 'published' where id = p_entry_id returning * into entry_row;
  return to_jsonb(entry_row);
end;
$$;

-- Public RPC wrappers never elevate privileges. The private implementations authorize explicitly.
create function public.reserve_media(p_entry_id uuid,p_name text,p_mime_type text,p_size bigint)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select memory_private.reserve_media(p_entry_id,p_name,p_mime_type,p_size); $$;
create function public.finalize_media(p_media_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select memory_private.finalize_media(p_media_id); $$;
create function public.discard_media(p_media_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select memory_private.discard_media(p_media_id); $$;
create function public.publish_entry(p_entry_id uuid,p_media_ids uuid[],p_expected_updated_at timestamptz default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select memory_private.publish_entry(p_entry_id,p_media_ids,p_expected_updated_at); $$;

-- Storage policies are metadata authorization only; file bytes are written/deleted only by Storage API.
create function memory_private.can_read_object(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select memory_private.is_member() and exists (
    select 1 from public.media m join public.entries e on e.id = m."entryId" join public.profiles p on p.id = auth.uid()
    where m."storagePath" = object_name and (e."authorId" = p.id
      or (e.status = 'published' and ((m.status = 'ready' and m.attached) or p.role = 'admin')))
  );
$$;
create function memory_private.can_upload_object(object_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare entry_id uuid; entry_row public.entries%rowtype; media_row public.media%rowtype; actor uuid := auth.uid();
begin
  if actor is null or not memory_private.is_member() then return false; end if;
  select "entryId" into entry_id from public.media where "storagePath" = object_name;
  if not found then return false; end if;
  -- Serialize the actual Storage INSERT with discard/finalize. An existence-only policy
  -- could otherwise let a reservation disappear while an object insertion commits.
  select * into entry_row from public.entries where id = entry_id for update;
  if not found then return false; end if;
  select * into media_row from public.media where "storagePath" = object_name for update;
  if not found then return false; end if;
  return media_row.status = 'pending' and media_row."uploadedBy" = actor and entry_row."deletedAt" is null
    and media_row."authorId" = entry_row."authorId"
    and (entry_row.status = 'published' or entry_row."authorId" = actor)
    and (entry_row."authorId" = actor or memory_private.member_role() = 'admin');
end;
$$;
create function memory_private.can_delete_object(object_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare entry_id uuid; entry_row public.entries%rowtype; media_row public.media%rowtype; actor uuid := auth.uid();
begin
  if actor is null or not memory_private.is_member() then return false; end if;
  select "entryId" into entry_id from public.media where "storagePath" = object_name;
  if not found then return false; end if;
  select * into entry_row from public.entries where id = entry_id for update;
  if not found then return false; end if;
  select * into media_row from public.media where "storagePath" = object_name for update;
  if not found then return false; end if;
  return not media_row.attached and media_row."authorId" = entry_row."authorId"
    and (entry_row.status = 'published' or entry_row."authorId" = actor)
    and (entry_row."authorId" = actor or memory_private.member_role() = 'admin');
end;
$$;

-- Bucket provisioning itself is performed through Storage API (private, size 50,000,000,
-- allowedMimeTypes exactly the eight types above), not SQL mutation of storage.buckets.
-- No UPDATE policy: uploading with upsert, object replacement, and move/rename are denied.
create policy memory_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'memory-media' and memory_private.can_read_object(name));
create policy memory_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-media' and memory_private.can_upload_object(name));
create policy memory_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'memory-media' and memory_private.can_delete_object(name));

-- Revoke PostgreSQL's implicit PUBLIC EXECUTE on every new function before granting narrowly.
revoke all on all functions in schema memory_private from public,anon,authenticated,service_role;
revoke all on function public.reserve_media(uuid,text,text,bigint),public.finalize_media(uuid),public.discard_media(uuid),public.publish_entry(uuid,uuid[],timestamptz) from public,anon,authenticated,service_role;
grant execute on function memory_private.valid_tags(text[]),memory_private.valid_anniversaries(jsonb),memory_private.member_role(),memory_private.is_member(),
  memory_private.can_edit_entry(uuid,boolean),memory_private.entry_is_active(uuid),memory_private.entry_is_published(uuid),
  memory_private.reserve_media(uuid,text,text,bigint),memory_private.finalize_media(uuid),memory_private.discard_media(uuid),memory_private.publish_entry(uuid,uuid[],timestamptz),
  memory_private.can_read_object(text),memory_private.can_upload_object(text),memory_private.can_delete_object(text) to authenticated;
grant execute on function public.reserve_media(uuid,text,text,bigint),public.finalize_media(uuid),public.discard_media(uuid),public.publish_entry(uuid,uuid[],timestamptz) to authenticated;
grant usage on schema memory_private to service_role;
grant execute on function memory_private.valid_tags(text[]),memory_private.valid_anniversaries(jsonb) to service_role;

