-- Trusted administrator SQL/RLS verification only. Run as one batch and stop on
-- error. It simulates claims rather than testing JWT signatures or real bytes.
-- No storage.objects/buckets INSERT/UPDATE/DELETE, no Auth/session mutations,
-- no existing profile edits. All temporary gallery/guard/asset writes roll back.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
create temporary table login_review_ids (label text primary key,id uuid not null default gen_random_uuid()) on commit drop;
create temporary table login_review_results (label text primary key) on commit drop;
create temporary table login_review_room (remaining integer not null) on commit drop;
insert into login_review_ids (label,id) select case slot when 1 then 'a' when 2 then 'b' else 'admin' end,id from public.profiles;
insert into login_review_ids (label) values ('outsider'),('selected'),('pending_a'),('ready_b'),('retired_b');
do $$ begin
  if (select count(*) from pg_temp.login_review_ids where label in ('a','b','admin')) <> 3 then raise exception 'Expected the three configured identities'; end if;
end; $$;
create function pg_temp.login_review_ok(value boolean,label text) returns void language plpgsql security invoker set search_path = '' as $$
begin if value is distinct from true then raise exception 'Login photo assertion failed: %',label; end if; insert into pg_temp.login_review_results values (label); end; $$;
create function pg_temp.login_review_actor(label text) returns void language plpgsql security invoker set search_path = '' as $$
declare actor uuid; begin
  select id into actor from pg_temp.login_review_ids ids where ids.label = login_review_actor.label;
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(actor::text,''),true);
  perform pg_catalog.set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role',case when actor is null then 'anon' else 'authenticated' end)::text,true);
end; $$;
create function pg_temp.login_review_error(command text,expected text,label text) returns void language plpgsql security invoker set search_path = '' as $$
declare caught text; begin
  begin execute command; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
  if caught is distinct from expected then raise exception 'Login photo assertion failed: %, expected %, got %',label,expected,coalesce(caught,'no error'); end if;
  insert into pg_temp.login_review_results values (label);
end; $$;
grant select on login_review_ids,login_review_room to anon,authenticated;
grant select,insert on login_review_results to anon,authenticated;
grant execute on function pg_temp.login_review_ok(boolean,text),pg_temp.login_review_actor(text),pg_temp.login_review_error(text,text,text) to anon,authenticated;

select pg_temp.login_review_ok(not has_table_privilege('anon','memory_login.assets','SELECT') and not has_table_privilege('authenticated','memory_login.assets','SELECT') and not has_table_privilege('authenticated','memory_login.gallery','UPDATE'),'no direct asset or gallery API grants');
select pg_temp.login_review_ok(not has_function_privilege('anon','public.reserve_login_photo(text,bigint)','EXECUTE') and not has_function_privilege('anon','public.finalize_login_photo(uuid)','EXECUTE') and not has_function_privilege('anon','public.publish_login_photos(uuid[],integer)','EXECUTE') and not has_function_privilege('anon','public.get_login_photo_cleanup()','EXECUTE') and not has_function_privilege('anon','public.discard_login_photo(uuid)','EXECUTE'),'anonymous lacks all write and cleanup RPC permissions');
select pg_temp.login_review_ok((select count(*) = 2 and bool_and(c.relrowsecurity) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='memory_login' and c.relname in ('assets','gallery')),'private gallery and assets also enable RLS');
select pg_temp.login_review_ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='memory_login'),'private privileged functions have fixed empty search path');

update memory_private.runtime_guard set "authReady" = true where id = 1;
insert into memory_login.assets(id,"createdBy","storagePath","mimeType",size,status)
  select ids.id,(select id from login_review_ids where label = case when ids.label in ('selected','pending_a') then 'a' else 'b' end),'slides/' || ids.id::text,'image/png',68,
    case ids.label when 'pending_a' then 'pending' when 'retired_b' then 'retired' else 'ready' end
  from login_review_ids ids where label in ('selected','pending_a','ready_b','retired_b');
update memory_login.gallery set photos=array[(select id from login_review_ids where label='selected')],revision=100 where id=1;
set local role anon;
select pg_temp.login_review_actor(null);
select pg_temp.login_review_ok((public.get_login_photos()->>'revision')::integer=100 and jsonb_array_length(public.get_login_photos()->'photos')=1 and public.get_login_photos()->'photos'->0->>'id'=(select id::text from pg_temp.login_review_ids where label='selected'),'anonymous sees exactly selected manifest');
select pg_temp.login_review_ok((select count(*)=4 from jsonb_object_keys(public.get_login_photos()->'photos'->0)) and position((select id::text from pg_temp.login_review_ids where label='a') in public.get_login_photos()::text)=0,'public manifest excludes uploader identity and original filename');
select pg_temp.login_review_ok(memory_login.can_read_object('slides/'||(select id::text from pg_temp.login_review_ids where label='selected')) and not memory_login.can_read_object('slides/'||(select id::text from pg_temp.login_review_ids where label='pending_a')) and not memory_login.can_read_object('slides/'||(select id::text from pg_temp.login_review_ids where label='retired_b')) and not memory_login.can_read_object('slides/'||(select id::text from pg_temp.login_review_ids where label='ready_b')),'anonymous object helper excludes pending ready-unselected and retired');
select pg_temp.login_review_error($q$select public.reserve_login_photo('image/png',68)$q$,'42501','anonymous cannot reserve');
select pg_temp.login_review_error($q$select public.publish_login_photos('{}',100)$q$,'42501','anonymous cannot publish');
reset role;

set local role authenticated;
select pg_temp.login_review_actor('outsider');
select pg_temp.login_review_error($q$select public.reserve_login_photo('image/png',68)$q$,'42501','fourth authenticated identity cannot reserve');
select pg_temp.login_review_error($q$select public.publish_login_photos('{}',100)$q$,'42501','fourth authenticated identity cannot publish');
select pg_temp.login_review_error($q$select public.get_login_photo_cleanup()$q$,'42501','fourth authenticated identity cannot inspect staging');
select pg_temp.login_review_actor('a');
select pg_temp.login_review_ok((select count(*)=2 from jsonb_array_elements(public.get_login_photo_cleanup()) item where item->>'id' in (select id::text from pg_temp.login_review_ids where label in ('pending_a','retired_b'))) and not exists (select 1 from jsonb_array_elements(public.get_login_photo_cleanup()) item where item->>'id'=(select id::text from pg_temp.login_review_ids where label='ready_b')),'member sees own staging and retired but not other member staging');
select pg_temp.login_review_ok(memory_login.can_read_object('slides/'||(select id::text from pg_temp.login_review_ids where label='pending_a')) and not memory_login.can_read_object('slides/'||(select id::text from pg_temp.login_review_ids where label='ready_b')),'member can read own pending but not partner pending');
select pg_temp.login_review_ok(not memory_login.can_delete_object('slides/'||(select id::text from pg_temp.login_review_ids where label='selected')) and not memory_login.can_delete_object('slides/'||(select id::text from pg_temp.login_review_ids where label='ready_b')),'member cannot delete selected or partner staging');
select pg_temp.login_review_error($q$select public.finalize_login_photo((select id from pg_temp.login_review_ids where label='pending_a'))$q$,'23514','finalize rejects missing object');
select pg_temp.login_review_error($q$select public.discard_login_photo((select id from pg_temp.login_review_ids where label='selected'))$q$,'42501','cannot discard selected photo metadata');
select pg_temp.login_review_error($q$select public.reserve_login_photo('image/svg+xml',68)$q$,'22023','SVG uploads rejected');
select pg_temp.login_review_error($q$select public.reserve_login_photo('image/png',5000001)$q$,'22023','oversize uploads rejected');
select pg_temp.login_review_error($q$select public.publish_login_photos(array_fill((select id from pg_temp.login_review_ids where label='selected'),array[9]),100)$q$,'22023','ninth selected photo rejected');
select pg_temp.login_review_error($q$select public.publish_login_photos(array[(select id from pg_temp.login_review_ids where label='selected'),(select id from pg_temp.login_review_ids where label='selected')],100)$q$,'22023','duplicate selected photo rejected');
select pg_temp.login_review_ok((public.publish_login_photos('{}',100)->>'revision')::integer=101,'first member can atomically clear selection');
select pg_temp.login_review_actor('b');
select pg_temp.login_review_ok((public.publish_login_photos('{}',101)->>'revision')::integer=102,'second member can edit selection');
select pg_temp.login_review_actor('admin');
select pg_temp.login_review_ok((public.publish_login_photos('{}',102)->>'revision')::integer=103,'administrator can edit selection');
select pg_temp.login_review_error($q$select public.publish_login_photos('{}',102)$q$,'PT409','stale revision rejected');
reset role;
insert into login_review_room select greatest(0,16-count(*)::integer) from memory_login.assets a cross join memory_login.gallery g where g.id=1 and a."createdBy"=(select id from login_review_ids where label='a') and not(a.id=any(g.photos));
set local role authenticated;
select pg_temp.login_review_actor('a');
do $$ begin for i in 1..(select remaining from pg_temp.login_review_room) loop perform public.reserve_login_photo('image/png',68); end loop; end; $$;
select pg_temp.login_review_error($q$select public.reserve_login_photo('image/png',68)$q$,'P0001','sixteen unselected files per actor quota enforced');
reset role;
-- Ensure a nonempty ready selection exists before closing the guard, otherwise
-- an already empty gallery would make this negative check vacuously pass.
update memory_login.assets set status='ready' where id=(select id from login_review_ids where label='selected');
update memory_login.gallery set photos=array[(select id from login_review_ids where label='selected')] where id=1;
update memory_private.runtime_guard set "authReady"=false where id=1;
set local role anon;
select pg_temp.login_review_actor(null);
select pg_temp.login_review_ok(jsonb_array_length(public.get_login_photos()->'photos')=0 and not memory_login.can_read_object('slides/'||(select id::text from pg_temp.login_review_ids where label='selected')),'guard closed hides fresh public selection');
reset role;
set local role authenticated;
select pg_temp.login_review_actor('a');
select pg_temp.login_review_error($q$select public.reserve_login_photo('image/png',68)$q$,'42501','guard closed denies member writes');
reset role;
select label from login_review_results order by label;
rollback;
