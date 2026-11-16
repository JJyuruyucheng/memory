-- Run once as the trusted project database administrator after schema installation.
-- This is a verification script, not a migration. It needs no passwords or API keys.
-- It tests SQL/RLS authorization, not JWT signatures, native CAPTCHA, file bytes,
-- Storage API transactions, concurrent requests, or the browser integration.
-- Existing profile identities are reused without changing them. If profiles is
-- empty, four temporary auth.users rows and three profiles are created instead.
-- No existing auth.users row, password, identity, or session is updated/deleted.
-- All fixtures, guard changes, and business writes are rolled back at the end.
-- Execute this as one SQL batch; stop on any unexpected error (psql: ON_ERROR_STOP).

begin;
set local statement_timeout = '45s';
set local lock_timeout = '5s';

create temporary table memory_review_actors (label text primary key, id uuid not null) on commit drop;
create temporary table memory_review_ids (label text primary key, id uuid not null default gen_random_uuid()) on commit drop;
create temporary table memory_review_results (label text primary key, detail text not null default 'ok') on commit drop;
create temporary table memory_review_media (label text primary key,id uuid not null,"storagePath" text not null) on commit drop;
insert into memory_review_ids(label) values ('entry_a'),('entry_b'),('draft_a'),('limits_a'),('empty_a'),('publish_limit_a');

do $$
declare profile_count integer; run_id uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where email like 'memory-isolation-%@memory.invalid') then
    raise exception 'Unexpected old isolation fixtures exist; inspect them before running this script';
  end if;
  select count(*) into profile_count from public.profiles;
  if profile_count = 0 then
    insert into memory_review_actors(label,id) values ('a',gen_random_uuid()),('b',gen_random_uuid()),('admin',gen_random_uuid()),('outsider',gen_random_uuid());
    insert into auth.users(id,email)
      select id,'memory-isolation-' || run_id::text || '-' || label || '@memory.invalid' from memory_review_actors;
    insert into public.profiles(id,slot,username,name,role)
      select id,case label when 'a' then 1 when 'b' then 2 else 3 end,
        case label when 'a' then 'xbl' when 'b' then 'll' else 'memory-review-admin' end,
        '隔离验证临时身份',case label when 'admin' then 'admin' else 'member' end
      from memory_review_actors where label <> 'outsider';
  elsif profile_count = 3
    and exists (select 1 from public.profiles where slot=1 and username='xbl' and role='member')
    and exists (select 1 from public.profiles where slot=2 and username='ll' and role='member')
    and exists (select 1 from public.profiles where slot=3 and role='admin') then
    insert into memory_review_actors(label,id)
      select case slot when 1 then 'a' when 2 then 'b' else 'admin' end,id from public.profiles;
    insert into memory_review_actors(label,id) values ('outsider',gen_random_uuid());
    insert into auth.users(id,email)
      select id,'memory-isolation-' || run_id::text || '-outsider@memory.invalid' from memory_review_actors where label='outsider';
  else
    raise exception 'Expected either zero profiles or the three configured fixed identities';
  end if;
end;
$$;

-- Temporary, SECURITY INVOKER test helpers deliberately simulate request claims.
-- They disappear on ROLLBACK and must never be installed in an exposed schema.
create function pg_temp.review_actor(actor_label text) returns void
language plpgsql security invoker set search_path = '' as $$
declare actor uuid;
begin
  select id into actor from pg_temp.memory_review_actors where label=actor_label;
  if not found then raise exception 'Unknown test actor'; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',actor::text,true);
  perform pg_catalog.set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
end;
$$;
create function pg_temp.review_ok(condition boolean, test_label text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if condition is distinct from true then raise exception 'Isolation assertion failed: %',test_label; end if;
  insert into pg_temp.memory_review_results(label) values (test_label);
end;
$$;
create function pg_temp.review_error(command text, expected_states text[], test_label text, expected_message text default null) returns void
language plpgsql security invoker set search_path = '' as $$
declare caught text; caught_message text;
begin
  begin execute command; exception when others then get stacked diagnostics caught=returned_sqlstate,caught_message=message_text; end;
  if caught is null or not (caught=any(expected_states)) or (expected_message is not null and caught_message !~* expected_message) then
    raise exception 'Isolation assertion failed: %, expected SQLSTATE % / message %, got % / %',test_label,expected_states,coalesce(expected_message,'any'),coalesce(caught,'no error'),coalesce(caught_message,'none');
  end if;
  insert into pg_temp.memory_review_results(label,detail) values (test_label,'expected SQLSTATE ' || caught);
end;
$$;
create function pg_temp.review_rows(command text, expected_count bigint, test_label text) returns void
language plpgsql security invoker set search_path = '' as $$
declare affected bigint;
begin
  execute command; get diagnostics affected=row_count;
  perform pg_temp.review_ok(affected=expected_count,test_label);
end;
$$;
grant select on memory_review_actors,memory_review_ids to anon,authenticated;
grant select,insert on memory_review_results to anon,authenticated;
grant select,insert on memory_review_media to anon,authenticated;
grant execute on function pg_temp.review_actor(text),pg_temp.review_ok(boolean,text),pg_temp.review_error(text,text[],text,text),pg_temp.review_rows(text,bigint,text) to anon,authenticated;

select pg_temp.review_ok(
  (select count(*)=7 and bool_and(c.relrowsecurity) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('profiles','entries','media','comments','reactions','favorites','settings')),
  'all seven public application tables enable RLS');
select pg_temp.review_ok(
  not has_function_privilege('anon','public.reserve_media(uuid,text,text,bigint)','EXECUTE')
  and not has_function_privilege('anon','public.finalize_media(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.discard_media(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.publish_entry(uuid,uuid[],timestamp with time zone)','EXECUTE'),
  'anonymous cannot execute any application write RPC');

-- Guard remains closed even for an enrolled identity with a simulated valid JWT.
update memory_private.runtime_guard set "authReady"=false where id=1;
set local role authenticated;
select pg_temp.review_actor('a');
select pg_temp.review_ok((select count(*)=0 from public.profiles),'guard hides profiles');
select pg_temp.review_ok((select count(*)=0 from public.entries),'guard hides entries');
select pg_temp.review_ok((select count(*)=0 from public.media),'guard hides media registrations');
select pg_temp.review_ok((select count(*)=0 from public.settings),'guard hides settings');
select pg_temp.review_error($q$insert into public.entries(title,content) values ('隔离验证','guard closed')$q$,array['42501'],'guard blocks entry creation');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='entry_a'),'a.jpg','image/jpeg',1)$q$,array['42501'],'guard blocks reservation RPC');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='entry_a'),'{}'::uuid[],null)$q$,array['42501'],'guard blocks publish RPC');
select pg_temp.review_ok(not memory_private.can_read_object('unregistered/path') and not memory_private.can_upload_object('unregistered/path') and not memory_private.can_delete_object('unregistered/path'),'guard blocks object helpers');
reset role;
update memory_private.runtime_guard set "authReady"=true where id=1;

set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub','',true);
select pg_catalog.set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ declare table_name text; begin
  foreach table_name in array array['profiles','entries','media','comments','reactions','favorites','settings'] loop
    perform pg_temp.review_error('select * from public.' || quote_ident(table_name),array['42501'],'anonymous table denied: ' || table_name);
  end loop;
end; $$;
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='entry_a'),'{}'::uuid[],null)$q$,array['42501'],'anonymous publish denied');
reset role;

set local role authenticated;
select pg_temp.review_actor('outsider');
select pg_temp.review_ok((select count(*)=0 from public.profiles),'unlisted authenticated user sees no profiles');
select pg_temp.review_ok((select count(*)=0 from public.entries),'unlisted authenticated user sees no entries');
select pg_temp.review_ok((select count(*)=0 from public.settings),'unlisted authenticated user sees no settings');
select pg_temp.review_error($q$insert into public.entries(title) values ('未授权')$q$,array['42501'],'unlisted authenticated user cannot create entries');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='entry_a'),'a.jpg','image/jpeg',1)$q$,array['42501'],'unlisted authenticated user cannot reserve media');
select pg_temp.review_error($q$update public.profiles set role='admin' where id=(select id from pg_temp.memory_review_actors where label='outsider')$q$,array['42501'],'unlisted authenticated user cannot self-enroll as admin');
select pg_temp.review_ok(not memory_private.can_read_object('unregistered/path') and not memory_private.can_upload_object('unregistered/path') and not memory_private.can_delete_object('unregistered/path'),'unlisted authenticated user cannot access objects');

select pg_temp.review_actor('a');
insert into public.entries(id,title,content,"occurredAt")
  select id,'隔离验证 A','仅供事务测试','2026-11-16T12:00:00+08:00'::timestamptz from memory_review_ids where label='entry_a';
insert into public.entries(id,title,content) select id,'私有草稿','草稿不能提前共享' from memory_review_ids where label='draft_a';
insert into public.entries(id,title,content) select id,'附件上限','仅检查数据库登记' from memory_review_ids where label='limits_a';
insert into public.entries(id) select id from memory_review_ids where label='empty_a';
insert into public.entries(id,title) select id,'发布数量检查' from memory_review_ids where label='publish_limit_a';
select pg_temp.review_ok((select status='draft' and "authorId"=auth.uid() from public.entries where id=(select id from memory_review_ids where label='entry_a')),'new entries are own unpublished drafts');
select pg_temp.review_error($q$insert into public.entries("authorId",title) values ((select id from pg_temp.memory_review_actors where label='b'),'冒名')$q$,array['42501'],'member cannot forge another author');
select pg_temp.review_error($q$insert into public.entries(type,title) values ('event','')$q$,array['23514'],'event requires a title');
select pg_temp.review_error($q$insert into public.entries(title,"occurredAt") values ('无效日期','infinity'::timestamptz)$q$,array['23514'],'infinite occurrence time rejected');
select pg_temp.review_error($q$insert into public.entries(title,mood) values ('无效心情','unknown')$q$,array['23514'],'invalid mood rejected');
select pg_temp.review_error($q$insert into public.entries(title,tags) values ('重复标签',array['相伴','相伴'])$q$,array['23514'],'duplicate tags rejected');
select pg_temp.review_error($q$update public.entries set "authorId"=(select id from pg_temp.memory_review_actors where label='b') where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,array['42501','23514'],'entry author immutable');
select pg_temp.review_error($q$update public.entries set "createdAt"=now() where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,array['42501','23514'],'entry creation time immutable');
select pg_temp.review_error($q$update public.entries set status='published' where id=(select id from pg_temp.memory_review_ids where label='draft_a')$q$,array['42501','23514'],'direct publication bypass denied');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='empty_a'),'{}'::uuid[],null)$q$,array['23514','22023'],'empty draft cannot publish');
select public.publish_entry((select id from memory_review_ids where label='entry_a'),'{}'::uuid[],null);
select pg_temp.review_ok((select status='published' from public.entries where id=(select id from memory_review_ids where label='entry_a')),'author can publish own valid draft');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='entry_a'),'{}'::uuid[],'2000-01-01T00:00:00Z')$q$,array['40001','23505'],'stale publish version rejected');

select pg_temp.review_actor('b');
select pg_temp.review_ok((select count(*)=1 from public.entries where id=(select id from memory_review_ids where label='entry_a')),'partner can read published record');
select pg_temp.review_ok((select count(*)=0 from public.entries where id=(select id from memory_review_ids where label='draft_a')),'partner cannot read author draft');
select pg_temp.review_rows($q$update public.entries set content='越权修改' where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,0,'partner cannot update another author');
select pg_temp.review_rows($q$update public.entries set "deletedAt"=now() where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,0,'partner cannot soft-delete another author');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='entry_a'),'{}'::uuid[],null)$q$,array['42501'],'partner cannot publish another author');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='entry_a'),'a.jpg','image/jpeg',1)$q$,array['42501'],'partner cannot attach to another author');
insert into public.entries(id,title,content) select id,'隔离验证 B','另一名作者' from memory_review_ids where label='entry_b';
select public.publish_entry((select id from memory_review_ids where label='entry_b'),'{}'::uuid[],null);
insert into public.comments("entryId",content) select id,'授权的回应' from memory_review_ids where label='entry_a';
insert into public.reactions("entryId") select id from memory_review_ids where label='entry_a';
insert into public.favorites("entryId") select id from memory_review_ids where label='entry_a';
select pg_temp.review_ok((select "authorId"=auth.uid() from public.comments where "entryId"=(select id from memory_review_ids where label='entry_a')),'comment author is caller');
select pg_temp.review_error($q$insert into public.comments("entryId","authorId",content) values ((select id from pg_temp.memory_review_ids where label='entry_a'),(select id from pg_temp.memory_review_actors where label='a'),'冒名评论')$q$,array['42501'],'comment author cannot be forged');
select pg_temp.review_error($q$insert into public.reactions("entryId","userId") values ((select id from pg_temp.memory_review_ids where label='entry_a'),(select id from pg_temp.memory_review_actors where label='a'))$q$,array['42501'],'reaction user cannot be forged');
select pg_temp.review_error($q$insert into public.favorites("entryId","userId") values ((select id from pg_temp.memory_review_ids where label='entry_a'),(select id from pg_temp.memory_review_actors where label='a'))$q$,array['42501'],'favorite user cannot be forged');
select pg_temp.review_error($q$insert into public.comments("entryId",content) select id,'不应回应未发布草稿' from pg_temp.memory_review_ids where label='draft_a'$q$,array['42501'],'partner cannot comment on unpublished draft');

select pg_temp.review_actor('a');
select pg_temp.review_rows($q$delete from public.reactions where "entryId"=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,0,'author cannot remove partner reaction');
select pg_temp.review_rows($q$delete from public.favorites where "entryId"=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,0,'author cannot remove partner favorite');
select pg_temp.review_rows($q$update public.entries set "deletedAt"=now() where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,1,'author can soft-delete own entry');
select pg_temp.review_error($q$update public.entries set content='在回收站修改' where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,array['23514'],'deleted entry must be restored before editing');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='entry_a'),'a.jpg','image/jpeg',1)$q$,array['42501'],'deleted entry rejects new uploads');
select pg_temp.review_actor('b');
select pg_temp.review_rows($q$update public.entries set "deletedAt"=null where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,0,'partner cannot restore another author');
select pg_temp.review_error($q$insert into public.comments("entryId",content) select id,'回收站回应' from pg_temp.memory_review_ids where label='entry_a'$q$,array['42501'],'deleted entry rejects comments');

select pg_temp.review_actor('admin');
select pg_temp.review_ok((select count(*)=0 from public.entries where id=(select id from memory_review_ids where label='draft_a')),'admin cannot read another author unpublished draft');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='draft_a'),'a.jpg','image/jpeg',1)$q$,array['42501'],'admin cannot attach to another author private draft');
select pg_temp.review_rows($q$update public.entries set "deletedAt"=null where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,1,'admin can restore published entry');
select pg_temp.review_rows($q$update public.entries set content='管理员维护记录' where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,1,'admin can maintain published entry');
select pg_temp.review_rows($q$update public.settings set subtitle='隔离验证，事务结束会回滚' where id=1$q$,1,'admin can edit common settings');
select pg_temp.review_actor('a');
select pg_temp.review_rows($q$update public.settings set subtitle='不应生效' where id=1$q$,0,'ordinary member cannot edit common settings');
select pg_temp.review_error($q$update public.profiles set role='admin' where id=auth.uid()$q$,array['42501'],'ordinary member cannot change whitelist role');

select pg_temp.review_error($q$update public.entries set title='',content='' where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,array['23514'],'published record cannot be patched to empty');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='entry_a'),null,null)$q$,array['22023'],'null media selection rejected');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='entry_a'),array[null]::uuid[],null)$q$,array['22023'],'null element in media selection rejected');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='entry_a'),(select array_agg(gen_random_uuid()) from generate_series(1,11)),null)$q$,array['23514'],'eleven selected files rejected before lookup','at most ten files');
select pg_temp.review_error($q$update public.entries set title=E'\t',content=E'\n' where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,array['23514'],'published record cannot be patched to whitespace only');

-- These reservations never upload bytes or write storage.objects/storage.buckets.
do $$ declare reservation jsonb; image_number integer; begin
  for image_number in 1..9 loop
    reservation := public.reserve_media((select id from pg_temp.memory_review_ids where label='limits_a'),'test-' || image_number || '.jpg','image/jpeg',1);
    insert into pg_temp.memory_review_media(label,id,"storagePath") values ('image-' || image_number,(reservation->>'id')::uuid,reservation->>'storagePath');
  end loop;
end; $$;
select pg_temp.review_ok((select count(*)=9 and bool_and(status='pending' and not attached and "uploadedBy"=auth.uid()) from public.media where "entryId"=(select id from memory_review_ids where label='limits_a')),'nine staging images allowed and attributed to caller');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='limits_a'),'tenth.jpg','image/jpeg',1)$q$,array['23514'],'tenth staging image rejected','nine staging images');
with reservation as materialized (select public.reserve_media((select id from memory_review_ids where label='limits_a'),'test.mp4','video/mp4',1) as value)
insert into memory_review_media(label,id,"storagePath") select 'video', (value->>'id')::uuid,value->>'storagePath' from reservation;
select pg_temp.review_ok((select count(*)=10 from public.media where "entryId"=(select id from memory_review_ids where label='limits_a')),'ten total staging files allowed');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='limits_a'),'eleventh.mp4','video/mp4',1)$q$,array['23514'],'eleventh staging file rejected','ten staging files');
select pg_temp.review_error($q$select public.finalize_media((select id from pg_temp.memory_review_media where label='image-1'))$q$,array['23514'],'finalization requires an actual uploaded object','not complete');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='limits_a'),array[(select id from pg_temp.memory_review_media where label='image-1')],null)$q$,array['23514'],'pending media cannot publish','must be ready');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='limits_a'),array[(select id from pg_temp.memory_review_media where label='image-1'),(select id from pg_temp.memory_review_media where label='image-1')],null)$q$,array['22023'],'duplicate selected media rejected');
select pg_temp.review_ok(memory_private.can_upload_object((select "storagePath" from memory_review_media where label='image-1')),'uploader can upload only a reserved pending object');
select pg_temp.review_ok(memory_private.can_read_object((select "storagePath" from memory_review_media where label='image-1')),'author may inspect own staged object');
select pg_temp.review_ok(not memory_private.can_upload_object((select "storagePath" || '/extra' from memory_review_media where label='image-1')),'unreserved object path denied');
select pg_temp.review_error($q$update public.media set attached=true where id=(select id from pg_temp.memory_review_media where label='image-1')$q$,array['42501'],'client cannot attach media by direct table update');
select pg_temp.review_error($q$delete from public.media where id=(select id from pg_temp.memory_review_media where label='image-1')$q$,array['42501'],'client cannot discard media by direct table delete');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='draft_a'),'bad.svg','image/svg+xml',1)$q$,array['22023'],'SVG MIME type rejected');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='draft_a'),'zero.jpg','image/jpeg',0)$q$,array['22023'],'zero byte file rejected');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='draft_a'),'large.jpg','image/jpeg',50000001)$q$,array['22023'],'file above 50000000 bytes rejected');
select pg_temp.review_error($q$select public.reserve_media((select id from pg_temp.memory_review_ids where label='draft_a'),'   ','image/jpeg',1)$q$,array['22023'],'blank file name rejected');
with reservation as materialized (select public.reserve_media((select id from memory_review_ids where label='draft_a'),'limit.mp4','video/mp4',50000000) as value)
insert into memory_review_media(label,id,"storagePath") select 'max-size',(value->>'id')::uuid,value->>'storagePath' from reservation;
select pg_temp.review_ok((select size=50000000 from public.media where id=(select id from memory_review_media where label='max-size')),'exact 50000000 byte metadata accepted');

select pg_temp.review_actor('b');
select pg_temp.review_ok((select count(*)=0 from public.media where "entryId"=(select id from memory_review_ids where label='limits_a')),'partner cannot read draft staging registrations');
select pg_temp.review_ok(not memory_private.can_read_object((select "storagePath" from memory_review_media where label='image-1')) and not memory_private.can_upload_object((select "storagePath" from memory_review_media where label='image-1')) and not memory_private.can_delete_object((select "storagePath" from memory_review_media where label='image-1')),'partner cannot read upload or delete author staging object');
select pg_temp.review_error($q$select public.finalize_media((select id from pg_temp.memory_review_media where label='image-1'))$q$,array['42501'],'partner cannot finalize author staged media');
select pg_temp.review_error($q$select public.discard_media((select id from pg_temp.memory_review_media where label='image-1'))$q$,array['42501'],'partner cannot discard author staged media');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='entry_b'),array[(select id from pg_temp.memory_review_media where label='image-1')],null)$q$,array['23514'],'author cannot select media from another entry');
select pg_temp.review_actor('admin');
select pg_temp.review_ok(not memory_private.can_read_object((select "storagePath" from memory_review_media where label='image-1')) and not memory_private.can_delete_object((select "storagePath" from memory_review_media where label='image-1')),'admin cannot inspect or delete another author private draft object');
select pg_temp.review_error($q$select public.discard_media((select id from pg_temp.memory_review_media where label='image-1'))$q$,array['42501'],'admin cannot discard another author private draft media');

-- Exercise guard and outsider checks after real fixture rows/reservations exist.
reset role;
update memory_private.runtime_guard set "authReady"=false where id=1;
set local role authenticated;
select pg_temp.review_actor('a');
select pg_temp.review_ok((select count(*)=0 from public.entries where id in (select id from memory_review_ids)),'closed guard hides existing entries including owned draft');
select pg_temp.review_ok(not memory_private.can_read_object((select "storagePath" from memory_review_media where label='image-1')) and not memory_private.can_upload_object((select "storagePath" from memory_review_media where label='image-1')) and not memory_private.can_delete_object((select "storagePath" from memory_review_media where label='image-1')),'closed guard denies an actual reserved object path');
select pg_temp.review_error($q$select public.discard_media((select id from pg_temp.memory_review_media where label='image-1'))$q$,array['42501'],'closed guard blocks discarding existing reservation');
reset role;
update memory_private.runtime_guard set "authReady"=true where id=1;
set local role authenticated;
select pg_temp.review_actor('outsider');
select pg_temp.review_ok((select count(*)=0 from public.entries where id in (select id from memory_review_ids)),'unlisted user cannot read existing published or draft entries');
select pg_temp.review_ok((select count(*)=0 from public.comments where "entryId"=(select id from memory_review_ids where label='entry_a')),'unlisted user cannot read existing comments');
select pg_temp.review_ok((select count(*)=0 from public.media where "entryId"=(select id from memory_review_ids where label='limits_a')),'unlisted user cannot read existing staging media');
select pg_temp.review_ok(not memory_private.can_read_object((select "storagePath" from memory_review_media where label='image-1')),'unlisted user cannot read actual reserved object path');

select pg_temp.review_actor('a');
select public.discard_media((select id from memory_review_media where label='image-1'));
select pg_temp.review_ok((select count(*)=0 from public.media where id=(select id from memory_review_media where label='image-1')),'author can discard a pending reservation when no object exists');

-- Trusted SQL fixtures below intentionally model metadata only. No Storage-owned
-- table is changed; missing physical objects must still prevent publication.
reset role;
select pg_temp.review_error($q$update public.entries set "authorId"=(select id from pg_temp.memory_review_actors where label='b') where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,array['23514'],'identity trigger also prevents trusted-role author reassignment');
select pg_temp.review_error($q$update public.entries set "createdAt"="createdAt"-interval '1 day' where id=(select id from pg_temp.memory_review_ids where label='entry_a')$q$,array['23514'],'identity trigger also prevents trusted-role creation time reassignment');
do $$ declare image_number integer; media_id uuid; actor uuid; entry_id uuid; begin
  select id into actor from memory_review_actors where label='a';
  select id into entry_id from memory_review_ids where label='publish_limit_a';
  for image_number in 1..10 loop
    media_id:=gen_random_uuid();
    insert into public.media(id,"entryId","authorId","uploadedBy",name,"mimeType",size,type,"storagePath",position,status,attached)
      values (media_id,entry_id,actor,actor,'metadata-only.jpg','image/jpeg',1,'image',actor::text || '/' || entry_id::text || '/' || media_id::text,image_number-1,'ready',false);
    insert into memory_review_media(label,id,"storagePath") values ('ready-' || image_number,media_id,actor::text || '/' || entry_id::text || '/' || media_id::text);
  end loop;
end; $$;
-- Model an already attached file to exercise detachment authorization. This is
-- deliberately a metadata-only SQL fixture, not evidence of a successful upload.
do $$ declare media_id uuid:=gen_random_uuid(); actor uuid; entry_id uuid; begin
  select id into actor from memory_review_actors where label='a';
  select id into entry_id from memory_review_ids where label='entry_a';
  insert into public.media(id,"entryId","authorId","uploadedBy",name,"mimeType",size,type,"storagePath",position,status,attached)
    values (media_id,entry_id,actor,actor,'attached-metadata-only.jpg','image/jpeg',1,'image',actor::text || '/' || entry_id::text || '/' || media_id::text,0,'ready',true);
  insert into memory_review_media(label,id,"storagePath") values ('attached-fixture',media_id,actor::text || '/' || entry_id::text || '/' || media_id::text);
end; $$;
set local role authenticated;
select pg_temp.review_actor('a');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='publish_limit_a'),(select array_agg(id) from pg_temp.memory_review_media where label like 'ready-%'),null)$q$,array['23514'],'ten selected ready images fail final publication count','at most nine images');
select pg_temp.review_error($q$select public.publish_entry((select id from pg_temp.memory_review_ids where label='publish_limit_a'),(select array_agg(id) from pg_temp.memory_review_media where label like 'ready-%' and label<>'ready-10'),null)$q$,array['23514'],'nine metadata-only images still require real objects','selected file is unavailable');
select pg_temp.review_ok((select status='draft' from public.entries where id=(select id from memory_review_ids where label='publish_limit_a')),'failed publication leaves draft unpublished');
select pg_temp.review_ok((select bool_and(not attached) from public.media where "entryId"=(select id from memory_review_ids where label='publish_limit_a')),'failed publication does not attach partial selection');
select pg_temp.review_ok(not memory_private.can_delete_object((select "storagePath" from memory_review_media where label='attached-fixture')),'attached object cannot be physically deleted');
select pg_temp.review_ok(not memory_private.can_upload_object((select "storagePath" from memory_review_media where label='attached-fixture')),'ready attached object cannot be overwritten through insert');
select pg_temp.review_error($q$select public.discard_media((select id from pg_temp.memory_review_media where label='attached-fixture'))$q$,array['23514'],'attached registration cannot be discarded','Detach saved media');
select pg_temp.review_actor('b');
select pg_temp.review_ok(memory_private.can_read_object((select "storagePath" from memory_review_media where label='attached-fixture')),'partner authorized to read a published attached path');
select pg_temp.review_ok(not memory_private.can_delete_object((select "storagePath" from memory_review_media where label='attached-fixture')),'partner cannot delete a published attached path');
select pg_temp.review_actor('a');
select public.publish_entry((select id from memory_review_ids where label='entry_a'),'{}'::uuid[],null);
select pg_temp.review_ok((select not attached and status='retired' from public.media where id=(select id from memory_review_media where label='attached-fixture')),'publication retires removed attachment atomically');
select pg_temp.review_ok(memory_private.can_delete_object((select "storagePath" from memory_review_media where label='attached-fixture')),'author may clean up retired object path');
select pg_temp.review_error($q$select public.finalize_media((select id from pg_temp.memory_review_media where label='attached-fixture'))$q$,array['23514'],'retired media cannot be revived by finalization','Retired attachments');
select public.discard_media((select id from memory_review_media where label='attached-fixture'));
select pg_temp.review_ok((select count(*)=0 from public.media where id=(select id from memory_review_media where label='attached-fixture')),'retired metadata without a physical object can be discarded');

reset role;
select count(*) as passed_assertions,jsonb_agg(jsonb_build_object('test',label,'result',detail) order by label) as checks
from memory_review_results;
rollback;

-- A distinct cleanup check: zero does not replace the assertions above.
select count(*) as remaining_isolation_auth_users
from auth.users where email like 'memory-isolation-%@memory.invalid';
