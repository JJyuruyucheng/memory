-- Run as the project database administrator in an initialized space.
-- The synthetic sessions and record are rolled back and never sent to clients.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table activity_check (
  id uuid not null default gen_random_uuid(),
  first_member uuid not null,
  second_member uuid not null,
  admin uuid not null,
  before_report jsonb
) on commit drop;
insert into activity_check (first_member, second_member, admin)
select
  (select id from public.profiles where slot = 1 and role = 'member'),
  (select id from public.profiles where slot = 2 and role = 'member'),
  (select id from public.profiles where slot = 3 and role = 'admin');
grant select, update (before_report) on activity_check to authenticated;

set local role anon;
do $$
begin
  begin
    perform public.admin_activity_report(30);
    raise exception 'Anonymous activity access was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
do $$
declare
  fixture activity_check%rowtype;
begin
  select * into fixture from activity_check;
  perform set_config('request.jwt.claim.sub', fixture.admin::text, true);
  update activity_check set before_report = public.admin_activity_report(0);

  begin
    perform public.admin_activity_report(8);
    raise exception 'Unsupported date range was accepted';
  exception when invalid_parameter_value then null;
  end;

  perform set_config('request.jwt.claim.sub', fixture.first_member::text, true);
  begin
    perform public.admin_activity_report(30);
    raise exception 'Member activity access was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform memory_private.read_admin_activity(30);
    raise exception 'Member could call the private report';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from memory_private.activity_events;
    raise exception 'Member could read raw activity rows';
  exception when insufficient_privilege then null;
  end;

  insert into public.entries (id, type, title, tags)
  values (fixture.id, 'note', 'Activity verification fixture', array['verify']);
  perform public.publish_entry(fixture.id, '{}'::uuid[], (select "updatedAt" from public.entries where id = fixture.id));
  update public.entries set content = 'Edited fixture' where id = fixture.id;
  perform public.publish_entry(fixture.id, '{}'::uuid[], (select "updatedAt" from public.entries where id = fixture.id));
  update public.entries set content = 'Edited fixture' where id = fixture.id;
  perform public.publish_entry(fixture.id, '{}'::uuid[], (select "updatedAt" from public.entries where id = fixture.id));

  perform set_config('request.jwt.claim.sub', fixture.second_member::text, true);
  insert into public.comments ("entryId", content) values (fixture.id, 'Test comment');
  perform set_config('request.jwt.claim.sub', fixture.first_member::text, true);
  update public.entries set "deletedAt" = statement_timestamp() where id = fixture.id;
  update public.entries set "deletedAt" = null where id = fixture.id;
end;
$$;
reset role;

insert into auth.sessions (id, user_id, created_at)
select id, first_member, statement_timestamp() from activity_check;
update auth.sessions set refreshed_at = statement_timestamp()
where id = (select id from activity_check);

set local role authenticated;
do $$
declare
  fixture activity_check%rowtype;
  after_report jsonb;
  account_before jsonb;
  account_after jsonb;
begin
  select * into fixture from activity_check;
  perform set_config('request.jwt.claim.sub', fixture.admin::text, true);
  after_report := public.admin_activity_report(0);
  if jsonb_array_length(after_report->'accounts') is distinct from 2
    or not (after_report->'resources' ?& array['databaseBytes', 'storageBytes', 'connections', 'maxConnections'])
    or after_report->>'trackedSince' is null then
    raise exception 'Admin report accounts or resources were missing';
  end if;

  account_before := fixture.before_report->'accounts'->0;
  account_after := after_report->'accounts'->0;
  if (account_after->>'logins')::integer - (account_before->>'logins')::integer is distinct from 1
    or (account_after->>'posts')::integer - (account_before->>'posts')::integer is distinct from 1
    or (account_after->>'edits')::integer - (account_before->>'edits')::integer is distinct from 2
    or (account_after->>'deletes')::integer - (account_before->>'deletes')::integer is distinct from 1
    or (account_after->>'restores')::integer - (account_before->>'restores')::integer is distinct from 1
    or account_after->'comments' is distinct from account_before->'comments' then
    raise exception 'Session or record actions were miscounted';
  end if;
  account_before := fixture.before_report->'accounts'->1;
  account_after := after_report->'accounts'->1;
  if (account_after->>'comments')::integer - (account_before->>'comments')::integer is distinct from 1
    or account_after->'logins' is distinct from account_before->'logins'
    or account_after->'posts' is distinct from account_before->'posts' then
    raise exception 'Activity was assigned to the wrong member';
  end if;
  if not exists (select 1 from jsonb_to_recordset(after_report->'recent') as item(action text, slot integer)
    where item.action = 'login' and item.slot = 1) then
    raise exception 'The new login is missing from recent activity';
  end if;
end;
$$;

rollback;
select 'admin_activity_verified' as result;
