-- Manual rollback: restore the pre-sort publication behavior; existing file bytes
-- and saved positions remain unchanged. Function ownership/ACL are preserved.
create or replace function memory_private.publish_entry(p_entry_id uuid,p_media_ids uuid[],p_expected_updated_at timestamptz default null)
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
