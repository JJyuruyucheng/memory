-- A whisper is private to its author and the enrolled business administrator.
-- Existing note/event records retain shared visibility. Drafts remain strictly
-- author-only, including for administrators. No Auth/Storage metadata is changed.

alter table public.entries drop constraint entries_type_check;
alter table public.entries add constraint entries_type_check check (type in ('note','event','whisper'));

alter policy entries_read on public.entries using (
  (select memory_private.member_role()) is not null
  and (
    "authorId" = (select auth.uid())
    or (status = 'published' and (type <> 'whisper' or (select memory_private.member_role()) = 'admin'))
  )
);

-- Every child SELECT and INSERT policy already calls these helpers. Keep the
-- privacy check here too: SECURITY DEFINER lookups must not bypass row privacy.
create or replace function memory_private.entry_is_published(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select memory_private.is_member() and exists (
    select 1 from public.entries e
    where e.id = entry_id and e.status = 'published'
      and (e.type <> 'whisper' or e."authorId" = auth.uid() or memory_private.member_role() = 'admin')
  );
$$;

create or replace function memory_private.entry_is_active(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select memory_private.entry_is_published(entry_id) and exists (
    select 1 from public.entries e where e.id = entry_id and e."deletedAt" is null
  );
$$;

-- In addition to row metadata, direct private Storage downloads must be hidden.
-- Authors retain access to their staging/drafts; admins only maintain published
-- entries. Partner access requires a shared published entry and an attached file.
create or replace function memory_private.can_read_object(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select memory_private.is_member() and exists (
    select 1 from public.media m join public.entries e on e.id = m."entryId" join public.profiles p on p.id = auth.uid()
    where m."storagePath" = object_name and (e."authorId" = p.id
      or (e.status = 'published' and (e.type <> 'whisper' or p.role = 'admin')
        and ((m.status = 'ready' and m.attached) or p.role = 'admin')))
  );
$$;

-- Even a previously shared favorite/reaction cannot be modified blindly after
-- its parent becomes a whisper invisible to the caller.
alter policy reactions_delete on public.reactions using (
  (select memory_private.member_role()) is not null and "userId" = (select auth.uid())
  and memory_private.entry_is_published("entryId")
);
alter policy favorites_delete on public.favorites using (
  (select memory_private.member_role()) is not null and "userId" = (select auth.uid())
  and memory_private.entry_is_published("entryId")
);

-- CREATE OR REPLACE retains existing ACLs. State them explicitly so no future
-- copy of this migration can accidentally expose private helpers to PUBLIC.
revoke all on function memory_private.entry_is_published(uuid),memory_private.entry_is_active(uuid),memory_private.can_read_object(text) from public,anon,service_role;
grant execute on function memory_private.entry_is_published(uuid),memory_private.entry_is_active(uuid),memory_private.can_read_object(text) to authenticated;
