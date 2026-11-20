-- Current confirmation state and the one-time points settlement are independent.
create function memory_private.points_set_memory_confirmation(p_entry_id uuid, p_confirmed boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  author_id uuid;
  confirmation memory_private.points_memory_confirmations%rowtype;
  locked_account uuid;
begin
  if p_confirmed is null then
    raise exception using errcode = '22023', message = 'POINTS_INVALID_REQUEST';
  end if;
  select e."authorId" into author_id from public.entries e
  where e.id = p_entry_id and e.status = 'published' and e.type in ('note', 'event') and e."deletedAt" is null
    and exists (select 1 from public.profiles where id = e."authorId" and slot in (1, 2) and role = 'member')
  for share of e;
  if not found then
    raise exception using errcode = 'P0001', message = 'POINTS_UNAVAILABLE';
  end if;
  if p_confirmed then
    insert into memory_private.points_memory_confirmations (entry_id) values (p_entry_id) on conflict do nothing;
  end if;
  select * into confirmation from memory_private.points_memory_confirmations where entry_id = p_entry_id for update;
  if not found or (account_id = any(confirmation.confirmed_by)) = p_confirmed then
    return memory_private.points_summary();
  end if;

  if p_confirmed then
    confirmation.confirmed_by := array_append(confirmation.confirmed_by, account_id);
  else
    confirmation.confirmed_by := array_remove(confirmation.confirmed_by, account_id);
  end if;
  if cardinality(confirmation.confirmed_by) = 2 then
    -- The same event key also covers settlements made before this migration.
    -- A re-confirmation updates the state but cannot mint a second award.
    -- The summary may settle the caller's anniversary, so lock wallets in UUID order.
    for locked_account in select distinct unnest(array[account_id, author_id]) order by 1 loop
      perform memory_private.points_lock_account(locked_account);
    end loop;
    perform memory_private.points_award(author_id, 'memory:' || p_entry_id::text, 500, 'memory', p_entry_id);
    confirmation.completed_at := clock_timestamp();
  else
    confirmation.completed_at := null;
  end if;
  update memory_private.points_memory_confirmations
  set confirmed_by = confirmation.confirmed_by, completed_at = confirmation.completed_at where entry_id = p_entry_id;
  return memory_private.points_summary();
end;
$$;

create function public.points_set_memory_confirmation(p_entry_id uuid, p_confirmed boolean)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_set_memory_confirmation(p_entry_id, p_confirmed);
$$;

revoke all on function memory_private.points_set_memory_confirmation(uuid, boolean),
  public.points_set_memory_confirmation(uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function memory_private.points_set_memory_confirmation(uuid, boolean),
  public.points_set_memory_confirmation(uuid, boolean)
to authenticated;

-- Existing tabs can still explicitly confirm via the original RPC.
create or replace function memory_private.points_confirm_memory(p_entry_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_set_memory_confirmation(p_entry_id, true);
$$;
