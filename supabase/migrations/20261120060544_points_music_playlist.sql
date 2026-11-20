-- Keep both playlists in the same table so the media cleanup policy checks both.
alter table public.background_music
  drop constraint background_music_id_check,
  add constraint background_music_id_check check (id in (1, 2));

-- This reserved audio ID resolves to the site's bundled instrumental in the provider.
insert into public.background_music (id, current_id, tracks) values (
  2,
  '50000000-0000-4000-8000-000000000004',
  '[{"id":"50000000-0000-4000-8000-000000000004","title":"朝夕小调","artist":"朝夕","audio":"50000000-0000-4000-8000-000000000004"}]'::jsonb
);
