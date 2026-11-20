-- Folders reference the canonical track IDs in the existing site and points playlists.
create function memory_private.valid_music_folders(items jsonb, active_folder uuid)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item jsonb;
  track_ids jsonb;
  folder_id uuid;
  folder_ids uuid[] := '{}'::uuid[];
  uuid_pattern constant text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(items) is distinct from 'array' then return false; end if;
  if jsonb_array_length(items) > 100 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    track_ids := item->'track_ids';
    if jsonb_typeof(item) is distinct from 'object'
      or not (coalesce(item->>'id', '') ~ uuid_pattern)
      or jsonb_typeof(item->'name') is distinct from 'string'
      or char_length(btrim(item->>'name')) not between 1 and 80
      or jsonb_typeof(track_ids) is distinct from 'array' then
      return false;
    end if;
    folder_id := (item->>'id')::uuid;
    if folder_id = any(folder_ids) or jsonb_array_length(track_ids) > 200 or exists (
      select track_id from jsonb_array_elements_text(track_ids) as entry(track_id)
      group by track_id
      having track_id is null or not (track_id ~ uuid_pattern) or count(*) > 1
    ) then
      return false;
    end if;
    folder_ids := array_append(folder_ids, folder_id);
  end loop;
  return active_folder is null or active_folder = any(folder_ids);
end;
$$;
revoke all on function memory_private.valid_music_folders(jsonb, uuid) from public, anon, authenticated;
grant execute on function memory_private.valid_music_folders(jsonb, uuid) to authenticated;

create table public.background_music_folders (
  id smallint primary key default 1 check (id = 1),
  revision integer not null default 0 check (revision >= 0),
  active_folder_id uuid,
  current_id uuid,
  folders jsonb not null default '[]'::jsonb check (memory_private.valid_music_folders(folders, active_folder_id))
);
insert into public.background_music_folders default values;
alter table public.background_music_folders enable row level security;
revoke all on public.background_music_folders from public, anon, authenticated;
grant select on public.background_music_folders to authenticated;
grant update (active_folder_id, current_id, folders) on public.background_music_folders to authenticated;
create policy background_music_folders_read on public.background_music_folders for select to authenticated
  using ((select memory_private.is_member()));
create policy background_music_folders_edit on public.background_music_folders for update to authenticated
  using ((select memory_private.is_member())) with check ((select memory_private.is_member()));

create function memory_private.prepare_music_folders_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  track_ids text[];
begin
  new.revision := old.revision + 1;
  if not memory_private.valid_music_folders(new.folders, new.active_folder_id) then
    return new; -- Let the table constraint reject malformed input.
  end if;

  select coalesce(array_agg(track->>'id'), '{}'::text[]) into track_ids
  from public.background_music, jsonb_array_elements(tracks) as items(track);
  select coalesce(jsonb_agg(jsonb_set(folder, '{track_ids}', (
    select coalesce(jsonb_agg(track_id order by position), '[]'::jsonb)
    from jsonb_array_elements_text(folder->'track_ids') with ordinality as items(track_id, position)
    where track_id = any(track_ids)
  )) order by ordinal), '[]'::jsonb) into new.folders
  from jsonb_array_elements(new.folders) with ordinality as folders(folder, ordinal);

  if not (new.current_id::text = any(track_ids)) then new.current_id := null; end if;
  return new;
end;
$$;
revoke all on function memory_private.prepare_music_folders_update() from public, anon, authenticated;
create trigger background_music_folders_revision before update on public.background_music_folders
  for each row execute function memory_private.prepare_music_folders_update();

-- The new file becomes a site track and a folder member in the same transaction.
create function public.save_music_to_folder(
  p_music_revision integer, p_folder_revision integer, p_folder_id uuid, p_track_id uuid,
  p_current_id uuid, p_play_mode text, p_tracks jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  music_row public.background_music%rowtype;
  folders_row public.background_music_folders%rowtype;
begin
  if not memory_private.is_member() then raise exception using errcode = '42501'; end if;
  if p_track_id is null or not (p_tracks @> jsonb_build_array(jsonb_build_object('id', p_track_id))) then
    raise exception using errcode = '23514';
  end if;

  update public.background_music
  set current_id = p_current_id, play_mode = p_play_mode, tracks = p_tracks
  where id = 1 and revision = p_music_revision
  returning * into music_row;
  if not found then raise exception using errcode = '40001'; end if;

  update public.background_music_folders f
  set folders = (
    select jsonb_agg(case
      when folder->>'id' = p_folder_id::text and not ((folder->'track_ids') ? p_track_id::text)
        then jsonb_set(folder, '{track_ids}', (folder->'track_ids') || to_jsonb(p_track_id))
      else folder end order by ordinal)
    from jsonb_array_elements(f.folders) with ordinality as items(folder, ordinal)
  )
  where f.id = 1 and f.revision = p_folder_revision
    and f.folders @> jsonb_build_array(jsonb_build_object('id', p_folder_id))
  returning * into folders_row;
  if not found then raise exception using errcode = '40001'; end if;

  return jsonb_build_object('music', to_jsonb(music_row), 'folderState', to_jsonb(folders_row));
end;
$$;
revoke all on function public.save_music_to_folder(integer, integer, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_music_to_folder(integer, integer, uuid, uuid, uuid, text, jsonb) to authenticated;
