-- Preserve the creation sequence for deterministic price ties and newly added products.
alter table memory_private.points_products
  add column sort_position bigint check (sort_position > 0),
  add constraint points_products_sort_position_unique unique (sort_position) deferrable initially immediate;

create or replace function memory_private.points_product_json(p_product memory_private.points_products)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(p_product) - array['position', 'sort_position'];
$$;

create function memory_private.points_catalog_ordered(p_include_inactive boolean)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(
    jsonb_agg(memory_private.points_product_json(p) order by
      p.sort_position nulls last,
      case when ordering.custom_order then p.position else p.price end,
      p.position, p.id),
    '[]'::jsonb)
  from memory_private.points_products p
  cross join (
    select exists (
      select 1 from memory_private.points_products where sort_position is not null
    ) as custom_order
  ) ordering
  where p_include_inactive or p.active;
$$;

create or replace function memory_private.points_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform memory_private.points_require();
  return memory_private.points_catalog_ordered(false);
end;
$$;

create or replace function memory_private.points_admin_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform memory_private.points_require('admin');
  return memory_private.points_catalog_ordered(true);
end;
$$;

create function memory_private.points_admin_reorder_products(p_product_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform memory_private.points_require('admin');
  if p_product_ids is null
    or (cardinality(p_product_ids) > 0 and array_ndims(p_product_ids) <> 1)
    or cardinality(p_product_ids) <> (select count(distinct id) from unnest(p_product_ids) as supplied(id)) then
    raise exception using errcode = '22023', message = 'POINTS_INVALID_REQUEST';
  end if;

  -- Lock before validating the exact set so inserts cannot slip between
  -- validation and save. Checkout's SELECT FOR UPDATE must also wait here;
  -- allowing it to hold a row while waiting to write could deadlock the reorder.
  lock table memory_private.points_products in exclusive mode;
  if cardinality(p_product_ids) <> (select count(*) from memory_private.points_products)
    or exists (select 1 from memory_private.points_products where not (id = any(p_product_ids))) then
    raise exception using errcode = 'P0001', message = 'POINTS_CHANGED';
  end if;

  update memory_private.points_products p
  set sort_position = supplied.position
  from unnest(p_product_ids) with ordinality as supplied(id, position)
  where p.id = supplied.id and p.sort_position is distinct from supplied.position;

  return memory_private.points_catalog_ordered(true);
end;
$$;

create function public.points_admin_reorder_products(p_product_ids uuid[])
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_admin_reorder_products(p_product_ids);
$$;

revoke all on function memory_private.points_catalog_ordered(boolean),
  memory_private.points_admin_reorder_products(uuid[]), public.points_admin_reorder_products(uuid[])
from public, anon, authenticated, service_role;
grant execute on function memory_private.points_admin_reorder_products(uuid[]), public.points_admin_reorder_products(uuid[])
to authenticated;

-- Settlements that were already completed retain their original ledger entries.
create or replace function memory_private.points_confirm_memory(p_entry_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  author_id uuid;
  confirmation memory_private.points_memory_confirmations%rowtype;
  locked_account uuid;
begin
  select e."authorId" into author_id from public.entries e
  where e.id = p_entry_id and e.status = 'published' and e.type in ('note', 'event') and e."deletedAt" is null
    and exists (select 1 from public.profiles where id = e."authorId" and slot in (1, 2) and role = 'member')
  for share of e;
  if not found then
    raise exception using errcode = 'P0001', message = 'POINTS_UNAVAILABLE';
  end if;
  insert into memory_private.points_memory_confirmations (entry_id) values (p_entry_id) on conflict do nothing;
  select * into confirmation from memory_private.points_memory_confirmations where entry_id = p_entry_id for update;
  if confirmation.completed_at is null and not (account_id = any(confirmation.confirmed_by)) then
    confirmation.confirmed_by := array_append(confirmation.confirmed_by, account_id);
    if cardinality(confirmation.confirmed_by) = 2 then
      -- The returned summary can settle the confirmer's own anniversary.
      -- Take both potential wallet locks in the same order as other awards.
      for locked_account in select distinct unnest(array[account_id, author_id]) order by 1 loop
        perform memory_private.points_lock_account(locked_account);
      end loop;
      perform memory_private.points_award(author_id, 'memory:' || p_entry_id::text, 500, 'memory', p_entry_id);
      confirmation.completed_at := clock_timestamp();
    end if;
    update memory_private.points_memory_confirmations
    set confirmed_by = confirmation.confirmed_by, completed_at = confirmation.completed_at where entry_id = p_entry_id;
  end if;
  return memory_private.points_summary();
end;
$$;
