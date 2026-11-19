alter table public.background_music
  add column play_mode text not null default 'sequence' check (play_mode in ('sequence', 'shuffle'));
grant update (play_mode) on public.background_music to authenticated;

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'text/plain')
where id = 'memory-bgm';

alter policy memory_bgm_delete on storage.objects using (
  bucket_id = 'memory-bgm' and (select memory_private.is_member()) and not exists (
    select 1 from public.background_music music, jsonb_array_elements(music.tracks) track
    where storage.objects.name in (track->>'audio', track->>'lyrics')
  )
);
