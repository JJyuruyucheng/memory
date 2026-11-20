alter table public.comments
  add column "replyToId" uuid,
  add constraint comments_entry_id_unique unique ("entryId", id),
  add constraint comments_reply_not_self check ("replyToId" <> id),
  add constraint comments_reply_same_entry foreign key ("entryId", "replyToId")
    references public.comments ("entryId", id) on delete set null ("replyToId");

create index comments_reply_to_idx on public.comments ("entryId", "replyToId")
  where "replyToId" is not null;
grant insert ("replyToId") on public.comments to authenticated;

create function memory_private.points_partner_of(p_user_id uuid)
returns uuid language sql stable set search_path = '' as $$
  select partner.id
  from public.profiles partner
  where partner.role = 'member' and partner.id <> p_user_id
    and exists (select 1 from public.profiles actor where actor.id = p_user_id and actor.role = 'member');
$$;

-- Hold the shared entry stable while writing its event to the ledger and inbox.
create function memory_private.points_shared_entry_author(p_entry_id uuid)
returns uuid language sql set search_path = '' as $$
  select e."authorId"
  from public.entries e
  where e.id = p_entry_id and e.status = 'published' and e.type <> 'whisper' and e."deletedAt" is null
  for share;
$$;

create function memory_private.points_capture_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  event_key text := 'post:' || new.id::text;
  recipient uuid;
begin
  if new.status <> 'published' or new.type = 'whisper' or new."deletedAt" is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then
    return new;
  end if;

  if actor = new."authorId" and memory_private.member_role() = 'member' then
    perform memory_private.points_award(actor, event_key, 100, 'post', new.id);
  elsif actor is null and exists (
    select 1 from public.profiles p
    join memory_private.runtime_guard g on g.id = 1 and g."authReady"
    where p.id = new."authorId" and p.slot = 1 and p.username = 'xbl' and p.role = 'member'
  ) then
    -- The trusted xbl publisher may notify the partner without earning points.
    actor := new."authorId";
  else
    return new;
  end if;

  recipient := memory_private.points_partner_of(actor);
  if recipient is not null then
    perform memory_private.points_notify(recipient, 'post', event_key, actor, new.id);
  end if;
  return new;
end;
$$;

create function memory_private.points_capture_reaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  recipient uuid;
  event_key text;
begin
  if actor is distinct from new."userId" or memory_private.member_role() is distinct from 'member' then
    return new;
  end if;

  recipient := memory_private.points_shared_entry_author(new."entryId");
  if recipient is null or recipient is distinct from memory_private.points_partner_of(actor) then
    return new;
  end if;

  event_key := 'like:' || new."entryId"::text || ':' || actor::text;
  perform memory_private.points_award(recipient, event_key, 20, 'like', new."entryId");
  perform memory_private.points_notify(recipient, 'like', event_key, actor, new."entryId");
  return new;
end;
$$;

create function memory_private.points_capture_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  entry_author uuid;
  recipient uuid;
  event_kind text;
  event_key text;
begin
  if actor is distinct from new."authorId" or memory_private.member_role() is distinct from 'member' then
    return new;
  end if;

  entry_author := memory_private.points_shared_entry_author(new."entryId");
  if entry_author is null then
    return new;
  end if;

  if new."replyToId" is null then
    recipient := entry_author;
    event_kind := 'comment';
  else
    select c."authorId" into recipient from public.comments c
    where c."entryId" = new."entryId" and c.id = new."replyToId";
    event_kind := 'reply';
  end if;

  if recipient is null or recipient is distinct from memory_private.points_partner_of(actor) then
    return new;
  end if;

  event_key := event_kind || ':' || new.id::text;
  perform memory_private.points_award(recipient, event_key, 20, event_kind, new."entryId");
  perform memory_private.points_notify(recipient, event_kind, event_key, actor, new."entryId", new.id);
  return new;
end;
$$;

revoke all on function memory_private.points_partner_of(uuid), memory_private.points_shared_entry_author(uuid),
  memory_private.points_capture_entry(), memory_private.points_capture_reaction(), memory_private.points_capture_comment()
  from public, anon, authenticated, service_role;

create trigger points_entry_published after insert or update of status on public.entries
  for each row execute function memory_private.points_capture_entry();
create trigger points_reaction_added after insert on public.reactions
  for each row execute function memory_private.points_capture_reaction();
create trigger points_comment_added after insert on public.comments
  for each row execute function memory_private.points_capture_comment();
