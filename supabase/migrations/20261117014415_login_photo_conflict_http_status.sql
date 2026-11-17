-- A stale application revision must be an HTTP 409, not a retried serialization failure.
-- All existing authorization, row locks, object validation and grants remain unchanged.
create or replace function memory_login.publish(p_photo_ids uuid[],p_expected_revision integer)
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
  if p_expected_revision is null or p_expected_revision <> current_gallery.revision then raise exception using errcode = 'PT409', message = 'Login photos changed elsewhere; reload before saving'; end if;
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
