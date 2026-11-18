alter table public.profiles add column "avatarJpeg" text;

alter table public.profiles add constraint profiles_avatar_jpeg_check check (
  "avatarJpeg" is null or (
    length("avatarJpeg") <= 65536 and length("avatarJpeg") % 4 = 0
    and "avatarJpeg" ~ '^/9j/[A-Za-z0-9+/]*={0,2}$'
  )
);

grant update (name, "avatarJpeg") on public.profiles to authenticated;

create policy profiles_edit_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select memory_private.member_role()) is not null)
  with check (id = (select auth.uid()) and (select memory_private.member_role()) is not null);
