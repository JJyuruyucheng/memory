create function memory_private.valid_music_playlist(items jsonb, chosen uuid)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item jsonb;
  ids uuid[] := '{}'::uuid[];
  audio_ids uuid[] := '{}'::uuid[];
  track_id uuid;
  audio_id uuid;
  uuid_pattern constant text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(items) is distinct from 'array' then return false; end if;
  if jsonb_array_length(items) > 100 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or not (coalesce(item->>'id', '') ~ uuid_pattern)
      or jsonb_typeof(item->'title') is distinct from 'string'
      or char_length(btrim(item->>'title')) not between 1 and 80
      or jsonb_typeof(item->'artist') is distinct from 'string'
      or char_length(item->>'artist') > 80
      or not (item ? 'audio') then return false; end if;
    track_id := (item->>'id')::uuid;
    if track_id = any(ids) then return false; end if;
    ids := array_append(ids, track_id);
    if item->>'audio' is not null then
      if not (item->>'audio' ~ uuid_pattern) then return false; end if;
      audio_id := (item->>'audio')::uuid;
      if audio_id = any(audio_ids) then return false; end if;
      audio_ids := array_append(audio_ids, audio_id);
    end if;
  end loop;
  return (chosen is null and cardinality(ids) = 0) or coalesce(chosen = any(ids), false);
end;
$$;
revoke all on function memory_private.valid_music_playlist(jsonb, uuid) from public, anon;
grant execute on function memory_private.valid_music_playlist(jsonb, uuid) to authenticated;

create table public.background_music (
  id smallint primary key default 1 check (id = 1),
  revision integer not null default 0 check (revision >= 0),
  current_id uuid,
  tracks jsonb not null check (memory_private.valid_music_playlist(tracks, current_id))
);
alter table public.background_music enable row level security;
revoke all on public.background_music from public, anon, authenticated;
grant select on public.background_music to authenticated;
grant update (current_id, tracks) on public.background_music to authenticated;
create policy background_music_read on public.background_music for select to authenticated using ((select memory_private.is_member()));
create policy background_music_edit on public.background_music for update to authenticated
  using ((select memory_private.is_member())) with check ((select memory_private.is_member()));

create function memory_private.next_music_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function memory_private.next_music_revision() from public, anon, authenticated;
create trigger background_music_revision before update on public.background_music
for each row execute function memory_private.next_music_revision();

insert into public.background_music (current_id, tracks) values (
  '50000000-0000-4000-8000-000000000001',
  '[{"id":"50000000-0000-4000-8000-000000000001","title":"稻香","artist":"周杰伦","audio":null},
    {"id":"50000000-0000-4000-8000-000000000002","title":"花海","artist":"周杰伦","audio":null},
    {"id":"50000000-0000-4000-8000-000000000003","title":"青花瓷","artist":"周杰伦","audio":null}]'::jsonb
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory-bgm', 'memory-bgm', false, 26214400, array['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/flac']);
create policy memory_bgm_read on storage.objects for select to authenticated
using (bucket_id = 'memory-bgm' and (select memory_private.is_member()));
create policy memory_bgm_upload on storage.objects for insert to authenticated
with check (bucket_id = 'memory-bgm' and (select memory_private.is_member()) and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$');
create policy memory_bgm_delete on storage.objects for delete to authenticated
using (bucket_id = 'memory-bgm' and (select memory_private.is_member()) and not exists (
  select 1 from public.background_music music, jsonb_array_elements(music.tracks) track where track->>'audio' = storage.objects.name
));

create table public.member_usage_minutes (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  minute_at timestamptz not null default date_trunc('minute', statement_timestamp()),
  primary key (user_id, minute_at)
);
alter table public.member_usage_minutes enable row level security;
revoke all on public.member_usage_minutes from public, anon, authenticated;
grant select, insert on public.member_usage_minutes to authenticated;
create policy member_usage_write on public.member_usage_minutes for insert to authenticated with check (
  user_id = (select auth.uid()) and (select memory_private.member_role()) = 'member'
  and minute_at = date_trunc('minute', statement_timestamp())
);
create policy member_usage_admin on public.member_usage_minutes for select to authenticated
using ((select memory_private.member_role()) = 'admin');

create function public.record_active_minute()
returns void language sql set search_path = '' as $$
  insert into public.member_usage_minutes (user_id)
  select auth.uid() where memory_private.member_role() = 'member'
  on conflict do nothing;
$$;
revoke all on function public.record_active_minute() from public, anon;
grant execute on function public.record_active_minute() to authenticated;

create or replace function public.admin_activity_report(p_days integer default 30)
returns jsonb language sql stable set search_path = '' as $$
  with report as (select memory_private.read_admin_activity(p_days) as value),
  minutes as (
    select profiles.slot, count(usage.minute_at) as total
    from public.profiles profiles left join public.member_usage_minutes usage on usage.user_id = profiles.id
      and (p_days = 0 or usage.minute_at >= now() - make_interval(days => p_days))
    where profiles.role = 'member'
    group by profiles.slot
  )
  select jsonb_set(report.value, '{accounts}', coalesce((
    select jsonb_agg(account.value || jsonb_build_object('activeMinutes', coalesce(minutes.total, 0)) order by account.ordinality)
    from jsonb_array_elements(report.value->'accounts') with ordinality as account(value, ordinality)
    left join minutes on minutes.slot = (account.value->>'slot')::smallint
  ), '[]'::jsonb)) from report;
$$;
