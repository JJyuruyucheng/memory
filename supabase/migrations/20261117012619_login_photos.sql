-- Dedicated login-page selection. These deliberately public photographs never
-- reference private entries/media, and the private memory-media bucket is unchanged.
-- Create the private `login-photos` bucket through the official Storage API:
-- public=false, fileSizeLimit=5000000, allowedMimeTypes=JPEG/PNG/WebP only.
create schema memory_login;
revoke all on schema memory_login from public,anon,authenticated;
grant usage on schema memory_login to anon,authenticated;

create table memory_login.gallery (
  id smallint primary key default 1 check (id = 1),
  revision integer not null default 0 check (revision >= 0),
  photos uuid[] not null default '{}' check (cardinality(photos) <= 8)
);
create table memory_login.assets (
  id uuid primary key default gen_random_uuid(),
  "createdBy" uuid not null references public.profiles(id) on delete restrict,
  "storagePath" text not null unique,
  "mimeType" text not null check ("mimeType" in ('image/jpeg','image/png','image/webp')),
  size bigint not null check (size between 1 and 5000000),
  status text not null default 'pending' check (status in ('pending','ready','retired')),
  "createdAt" timestamptz not null default now(),
  constraint login_photo_path check ("storagePath" = 'slides/' || id::text)
);
create index login_assets_creator_idx on memory_login.assets ("createdBy");
alter table memory_login.gallery enable row level security;
alter table memory_login.assets enable row level security;
revoke all on table memory_login.gallery,memory_login.assets from public,anon,authenticated,service_role;
insert into memory_login.gallery (id) values (1);

create function memory_login.is_open()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady");
$$;
create function memory_login.manifest()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('revision',g.revision,'photos',coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'path',a."storagePath",'mimeType',a."mimeType",'size',a.size) order by p.ordinality)
    from unnest(g.photos) with ordinality p(id,ordinality)
    join memory_login.assets a on a.id = p.id and a.status = 'ready'
  ),'[]'::jsonb)) from memory_login.gallery g where g.id = 1 and memory_login.is_open()),
    jsonb_build_object('revision',0,'photos','[]'::jsonb));
$$;
create function memory_login.can_read_object(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select memory_login.is_open() and exists (
    select 1 from memory_login.assets a cross join memory_login.gallery g
    where g.id = 1 and a."storagePath" = object_name and (
      (a.status = 'ready' and a.id = any(g.photos))
      or (memory_private.member_role() is not null and (a."createdBy" = auth.uid() or a.status = 'retired'))
    )
  );
$$;

create function memory_login.reserve(p_mime_type text,p_size bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid := auth.uid(); new_id uuid := gen_random_uuid(); asset memory_login.assets%rowtype; selected uuid[];
begin
  if actor is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  if p_mime_type is null or p_mime_type not in ('image/jpeg','image/png','image/webp') or p_size is null or p_size not between 1 and 5000000 then
    raise exception using errcode = '22023', message = 'Login photos must be JPEG/PNG/WebP, at most 5,000,000 bytes';
  end if;
  select photos into selected from memory_login.gallery where id = 1 for update;
  if (select count(*) from memory_login.assets where "createdBy" = actor and not (id = any(selected))) >= 16 then
    raise exception using errcode = 'P0001', message = 'LOGIN_PHOTO_QUOTA';
  end if;
  insert into memory_login.assets (id,"createdBy","storagePath","mimeType",size)
    values (new_id,actor,'slides/' || new_id::text,p_mime_type,p_size) returning * into asset;
  return jsonb_build_object('id',asset.id,'path',asset."storagePath",'mimeType',asset."mimeType",'size',asset.size);
end;
$$;

create function memory_login.can_upload_object(object_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare asset memory_login.assets%rowtype; actor uuid := auth.uid();
begin
  if actor is null or memory_private.member_role() is null then return false; end if;
  select * into asset from memory_login.assets where "storagePath" = object_name for update;
  return found and asset."createdBy" = actor and asset.status = 'pending';
end;
$$;

create function memory_login.finalize(p_photo_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare asset memory_login.assets%rowtype; object_row storage.objects%rowtype; actor uuid := auth.uid();
begin
  if actor is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  select * into asset from memory_login.assets where id = p_photo_id for update;
  if not found or asset."createdBy" <> actor then raise exception using errcode = '42501', message = 'Upload unavailable'; end if;
  if asset.status = 'retired' then raise exception using errcode = '23514', message = 'A retired photo cannot be reused'; end if;
  select * into object_row from storage.objects where bucket_id = 'login-photos' and name = asset."storagePath";
  if not found or object_row.owner_id is distinct from actor::text
    or object_row.metadata ->> 'mimetype' is distinct from asset."mimeType"
    or (case when object_row.metadata ->> 'size' ~ '^[0-9]+$' then (object_row.metadata ->> 'size')::numeric else null end) is distinct from asset.size then
    raise exception using errcode = '23514', message = 'Uploaded object does not match the reserved photo';
  end if;
  update memory_login.assets set status = 'ready' where id = asset.id;
  return jsonb_build_object('id',asset.id,'path',asset."storagePath",'mimeType',asset."mimeType",'size',asset.size);
end;
$$;

create function memory_login.publish(p_photo_ids uuid[],p_expected_revision integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid := auth.uid(); current_gallery memory_login.gallery%rowtype; result_count integer;
begin
  if actor is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  if p_photo_ids is null or cardinality(p_photo_ids) > 8 or (cardinality(p_photo_ids) > 0 and array_ndims(p_photo_ids) <> 1)
    or exists (select 1 from unnest(p_photo_ids) photo where photo is null)
    or cardinality(p_photo_ids) <> (select count(distinct photo) from unnest(p_photo_ids) photo) then
    raise exception using errcode = '22023', message = 'Choose at most eight unique login photos';
  end if;
  select * into current_gallery from memory_login.gallery where id = 1 for update;
  if p_expected_revision is null or p_expected_revision <> current_gallery.revision then raise exception using errcode = '40001', message = 'Login photos changed elsewhere; reload before saving'; end if;
  -- Consistent gallery -> asset lock order matches deletion; storage INSERT only
  -- locks its pending asset, which cannot be selected until finalized.
  perform 1 from memory_login.assets where id = any(p_photo_ids || current_gallery.photos) order by id for update;
  select count(*) into result_count from memory_login.assets a where a.id = any(p_photo_ids)
    and a.status = 'ready' and (a.id = any(current_gallery.photos) or a."createdBy" = actor)
    and exists (select 1 from storage.objects o where o.bucket_id = 'login-photos' and o.name = a."storagePath"
      and o.owner_id = a."createdBy"::text and o.metadata ->> 'mimetype' = a."mimeType"
      and (case when o.metadata ->> 'size' ~ '^[0-9]+$' then (o.metadata ->> 'size')::numeric else null end) = a.size);
  if result_count <> cardinality(p_photo_ids) then raise exception using errcode = '42501', message = 'One or more selected photos are not ready or available'; end if;
  update memory_login.assets set status = 'retired' where id = any(current_gallery.photos) and not (id = any(p_photo_ids));
  update memory_login.gallery set photos = p_photo_ids,revision = revision + 1 where id = 1;
  return memory_login.manifest();
end;
$$;

create function memory_login.cleanup_candidates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'path',a."storagePath",'status',a.status,'createdAt',a."createdAt") order by a."createdAt")
    from memory_login.assets a cross join memory_login.gallery g where g.id = 1 and not (a.id = any(g.photos))
    and (a."createdBy" = auth.uid() or a.status = 'retired')),'[]'::jsonb);
end;
$$;

create function memory_login.can_delete_object(object_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare asset memory_login.assets%rowtype; selected uuid[]; actor uuid := auth.uid();
begin
  if actor is null or memory_private.member_role() is null then return false; end if;
  select photos into selected from memory_login.gallery where id = 1 for update;
  select * into asset from memory_login.assets where "storagePath" = object_name for update;
  return found and not (asset.id = any(selected)) and (asset."createdBy" = actor or asset.status = 'retired');
end;
$$;
create function memory_login.discard(p_photo_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare asset memory_login.assets%rowtype; selected uuid[]; actor uuid := auth.uid();
begin
  if actor is null or memory_private.member_role() is null then raise exception using errcode = '42501', message = 'Not authorized'; end if;
  select photos into selected from memory_login.gallery where id = 1 for update;
  select * into asset from memory_login.assets where id = p_photo_id for update;
  if not found then return; end if;
  if asset.id = any(selected) or (asset."createdBy" <> actor and asset.status <> 'retired') then raise exception using errcode = '42501', message = 'Photo unavailable for cleanup'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'login-photos' and name = asset."storagePath") then raise exception using errcode = '23514', message = 'Remove the object through Storage API first'; end if;
  delete from memory_login.assets where id = asset.id;
end;
$$;

create function public.get_login_photos() returns jsonb language sql stable security invoker set search_path = '' as $$ select memory_login.manifest(); $$;
create function public.reserve_login_photo(p_mime_type text,p_size bigint) returns jsonb language sql volatile security invoker set search_path = '' as $$ select memory_login.reserve(p_mime_type,p_size); $$;
create function public.finalize_login_photo(p_photo_id uuid) returns jsonb language sql volatile security invoker set search_path = '' as $$ select memory_login.finalize(p_photo_id); $$;
create function public.publish_login_photos(p_photo_ids uuid[],p_expected_revision integer) returns jsonb language sql volatile security invoker set search_path = '' as $$ select memory_login.publish(p_photo_ids,p_expected_revision); $$;
create function public.get_login_photo_cleanup() returns jsonb language sql stable security invoker set search_path = '' as $$ select memory_login.cleanup_candidates(); $$;
create function public.discard_login_photo(p_photo_id uuid) returns void language sql volatile security invoker set search_path = '' as $$ select memory_login.discard(p_photo_id); $$;

create policy login_photos_read on storage.objects for select to anon,authenticated
  using (bucket_id = 'login-photos' and memory_login.can_read_object(name));
create policy login_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'login-photos' and memory_login.can_upload_object(name));
create policy login_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'login-photos' and memory_login.can_delete_object(name));
-- There is no UPDATE/upsert policy; replacing a slide always creates a fresh path.
revoke all on all functions in schema memory_login from public,anon,authenticated,service_role;
revoke all on function public.get_login_photos(),public.reserve_login_photo(text,bigint),public.finalize_login_photo(uuid),public.publish_login_photos(uuid[],integer),public.get_login_photo_cleanup(),public.discard_login_photo(uuid) from public,anon,authenticated,service_role;
grant execute on function memory_login.manifest(),memory_login.can_read_object(text),public.get_login_photos() to anon,authenticated;
grant execute on function memory_login.reserve(text,bigint),memory_login.finalize(uuid),memory_login.publish(uuid[],integer),memory_login.cleanup_candidates(),memory_login.can_upload_object(text),memory_login.can_delete_object(text),memory_login.discard(uuid),public.reserve_login_photo(text,bigint),public.finalize_login_photo(uuid),public.publish_login_photos(uuid[],integer),public.get_login_photo_cleanup(),public.discard_login_photo(uuid) to authenticated;
