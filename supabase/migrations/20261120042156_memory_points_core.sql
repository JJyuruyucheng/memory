-- Private points ledger. Browsers can only call the explicitly granted RPCs.
create function memory_private.points_day(p_time timestamptz)
returns date language sql immutable set search_path = '' as $$
  select (p_time at time zone 'Asia/Shanghai')::date;
$$;

create function memory_private.points_cover_valid(p_cover text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  contents bytea;
begin
  if p_cover is null or p_cover ~ '^\./assets/reward-covers/(drink|dessert|gift|transport|reconcile|movie|cash|flight)\.webp$' then
    return true;
  end if;
  if char_length(p_cover) > 240023 or p_cover !~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$' then
    return false;
  end if;
  begin
    contents := decode(substr(p_cover, 24), 'base64');
  exception when invalid_parameter_value or invalid_text_representation then
    return false;
  end;
  return octet_length(contents) between 16 and 180000
    and substring(contents from 1 for 4) = decode('52494646','hex')
    and substring(contents from 9 for 4) = decode('57454250','hex');
end;
$$;

create table memory_private.points_settings (
  singleton boolean primary key default true check (singleton),
  activated_on date not null default memory_private.points_day(clock_timestamp())
);
insert into memory_private.points_settings default values;

-- Keep the existing shared anniversary card aligned with the rewards date.
update public.settings s
set anniversaries = (
  select jsonb_agg(
    case when item->>'date' = '2024-01-01'
      and item->>'title' in ('相恋', '开始相爱的那一天')
      then item || jsonb_build_object('title', '开始相爱的那一天', 'yearly', true)
      else item end
    order by position
  )
  from jsonb_array_elements(s.anniversaries) with ordinality as a(item, position)
)
where s.id = 1 and exists (
  select 1 from jsonb_array_elements(s.anniversaries) item
  where item->>'date' = '2024-01-01'
    and item->>'title' in ('相恋', '开始相爱的那一天')
);

create table memory_private.points_accounts (
  user_id uuid primary key references public.profiles(id),
  balance bigint not null default 0 check (balance >= 0)
);

create table memory_private.points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  event_key text not null check (char_length(event_key) between 1 and 240),
  kind text not null check (char_length(kind) between 1 and 64),
  amount integer not null check (amount <> 0),
  entry_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, event_key)
);
create index points_ledger_recent_idx on memory_private.points_ledger (user_id, created_at desc, id desc);

create table memory_private.points_checkin_attempts (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  day date not null,
  started_at timestamptz not null,
  expires_at timestamptz not null
);
create index points_checkin_attempts_cleanup_idx on memory_private.points_checkin_attempts (user_id, expires_at);

create table memory_private.points_checkins (
  user_id uuid not null references public.profiles(id),
  day date not null,
  streak_start date not null,
  token uuid not null unique,
  checked_at timestamptz not null,
  primary key (user_id, day),
  check (streak_start <= day)
);

create table memory_private.points_memory_confirmations (
  entry_id uuid primary key references public.entries(id) on delete cascade,
  confirmed_by uuid[] not null default '{}' check (cardinality(confirmed_by) <= 2),
  completed_at timestamptz
);

create table memory_private.points_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) <= 1500),
  reward integer not null check (reward > 0),
  created_at timestamptz not null default clock_timestamp(),
  confirmed_by uuid[] not null default '{}' check (cardinality(confirmed_by) <= 2),
  completed_at timestamptz
);

create table memory_private.points_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text not null check (char_length(description) <= 1500),
  price integer not null check (price > 0),
  stock integer not null check (stock >= 0),
  cover text check (memory_private.points_cover_valid(cover)),
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  position bigint generated always as identity
);

create table memory_private.points_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  request_id uuid not null,
  product_id uuid not null references memory_private.points_products(id),
  product_version bigint not null,
  name text not null,
  description text not null,
  price integer not null check (price > 0),
  cover text,
  redeemed_at timestamptz not null default clock_timestamp(),
  used_at timestamptz,
  unique (user_id, request_id)
);
create index points_orders_buyer_idx on memory_private.points_orders (user_id, redeemed_at desc, id desc);

create table memory_private.points_inbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  kind text not null check (char_length(kind) between 1 and 64),
  event_key text not null check (char_length(event_key) between 1 and 240),
  actor_id uuid references public.profiles(id),
  entry_id uuid,
  comment_id uuid,
  order_id uuid references memory_private.points_orders(id),
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique (recipient_id, kind, event_key)
);
create index points_inbox_recipient_idx on memory_private.points_inbox (recipient_id, created_at desc, id desc);

alter table memory_private.points_settings enable row level security;
alter table memory_private.points_accounts enable row level security;
alter table memory_private.points_ledger enable row level security;
alter table memory_private.points_checkin_attempts enable row level security;
alter table memory_private.points_checkins enable row level security;
alter table memory_private.points_memory_confirmations enable row level security;
alter table memory_private.points_challenges enable row level security;
alter table memory_private.points_products enable row level security;
alter table memory_private.points_orders enable row level security;
alter table memory_private.points_inbox enable row level security;

revoke all on table memory_private.points_settings, memory_private.points_accounts,
  memory_private.points_ledger, memory_private.points_checkin_attempts, memory_private.points_checkins,
  memory_private.points_memory_confirmations, memory_private.points_challenges, memory_private.points_products,
  memory_private.points_orders, memory_private.points_inbox from public, anon, authenticated, service_role;
revoke all on sequence memory_private.points_products_position_seq from public, anon, authenticated, service_role;

insert into memory_private.points_products (name, description, price, stock, cover)
values
  ('今天的饮料我请', '下一杯喜欢的饮料，抵 ¥12。', 1200, 1, './assets/reward-covers/drink.webp'),
  ('下次约会甜点', '下次约会的甜点，抵 ¥20。', 2000, 1, './assets/reward-covers/dessert.webp'),
  ('一份小礼物', '挑一件想要的小东西，抵 ¥30。', 3000, 1, './assets/reward-covers/gift.webp'),
  ('见面交通补贴', '见面的车票或打车费，凭至少 ¥50 的净实付抵 ¥50。', 5000, 1, './assets/reward-covers/transport.webp'),
  ('和好邀约卡', '发出一次想好好聊聊的邀请，对方可以改期或跳过。', 10000, 1, './assets/reward-covers/reconcile.webp'),
  ('下次电影我选', '下次两人一起看电影时，由持卡人选片。', 1000, 1, './assets/reward-covers/movie.webp'),
  ('现金券', '在线下领取 ¥20，兑付人和持有人约定时间。', 2000, 1, './assets/reward-covers/cash.webp'),
  ('机票补贴', '凭至少 ¥100 的机票净实付抵 ¥100。', 10000, 1, './assets/reward-covers/flight.webp');

create function memory_private.points_require(p_role text default null)
returns uuid language plpgsql stable set search_path = '' as $$
declare
  account_id uuid := auth.uid();
  actual_role text := memory_private.member_role();
begin
  if account_id is null or actual_role is null or (p_role is not null and actual_role <> p_role) then
    raise exception using errcode = '42501', message = 'Points access denied';
  end if;
  return account_id;
end;
$$;

create function memory_private.points_lock_account(p_user_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
begin
  insert into memory_private.points_accounts (user_id) values (p_user_id) on conflict do nothing;
  perform 1 from memory_private.points_accounts where user_id = p_user_id for update;
end;
$$;

-- The caller owns the surrounding transaction and supplies only trusted event data.
create function memory_private.points_award(
  p_user_id uuid, p_event_key text, p_amount integer, p_kind text, p_entry_id uuid default null
)
returns boolean language plpgsql volatile set search_path = '' as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'A points award must be positive';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and slot in (1, 2) and role = 'member') then
    return false;
  end if;
  perform memory_private.points_lock_account(p_user_id);
  insert into memory_private.points_ledger (user_id, event_key, kind, amount, entry_id)
  values (p_user_id, p_event_key, p_kind, p_amount, p_entry_id)
  on conflict (user_id, event_key) do nothing;
  if not found then
    return false;
  end if;
  update memory_private.points_accounts set balance = balance + p_amount where user_id = p_user_id;
  return true;
end;
$$;

create function memory_private.points_notify(
  p_recipient uuid, p_kind text, p_event_key text, p_actor uuid default null,
  p_entry_id uuid default null, p_comment_id uuid default null, p_order_id uuid default null
)
returns boolean language plpgsql volatile set search_path = '' as $$
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then
    return false;
  end if;
  insert into memory_private.points_inbox (recipient_id, kind, event_key, actor_id, entry_id, comment_id, order_id)
  values (p_recipient, p_kind, p_event_key, p_actor, p_entry_id, p_comment_id, p_order_id)
  on conflict (recipient_id, kind, event_key) do nothing;
  return found;
end;
$$;

create function memory_private.points_sync_anniversary(p_user_id uuid, p_day date)
returns void language plpgsql volatile set search_path = '' as $$
declare
  anniversary_start constant date := date '2024-01-01';
  active_since date;
  due_on date;
  due_year integer;
  award_key text;
begin
  select greatest(anniversary_start, activated_on) into active_since from memory_private.points_settings;
  if not exists (select 1 from memory_private.runtime_guard where id = 1 and "authReady") or p_day < active_since then
    return;
  end if;
  for due_year in extract(year from active_since)::integer .. extract(year from p_day)::integer loop
    due_on := make_date(due_year, 1, 1);
    award_key := 'anniversary:' || to_char(due_on, 'YYYY-MM-DD');
    if due_on >= active_since and due_on <= p_day and not exists (
      select 1 from memory_private.points_ledger
      where user_id = p_user_id and event_key = award_key
    ) then
      perform memory_private.points_award(p_user_id, award_key, 5000, 'anniversary');
    end if;
  end loop;
end;
$$;

create function memory_private.points_run_anniversaries()
returns void language plpgsql volatile set search_path = '' as $$
declare
  account_id uuid;
  today date := memory_private.points_day(clock_timestamp());
begin
  for account_id in select id from public.profiles where slot in (1, 2) and role = 'member' order by id loop
    perform memory_private.points_sync_anniversary(account_id, today);
  end loop;
end;
$$;

create function memory_private.points_summary()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  today date := memory_private.points_day(clock_timestamp());
  latest memory_private.points_checkins%rowtype;
  streak_count integer := 0;
  next_date date := make_date(extract(year from today)::integer, 1, 1);
begin
  perform memory_private.points_sync_anniversary(account_id, today);
  select * into latest from memory_private.points_checkins where user_id = account_id and day <= today order by day desc limit 1;
  if found and latest.day >= today - 1 then
    streak_count := latest.day - latest.streak_start + 1;
  end if;
  if next_date <= today then
    next_date := make_date(extract(year from today)::integer + 1, 1, 1);
  end if;
  return jsonb_build_object(
    'balance', coalesce((select balance from memory_private.points_accounts where user_id = account_id), 0),
    'day', today, 'checked_in', coalesce(latest.day = today, false), 'streak', streak_count,
    'next_milestone', (select min(milestone) from unnest(array[7,30,180,365]) milestone where milestone > streak_count),
    'anniversary', jsonb_build_object('date', date '2024-01-01', 'title', '开始相爱的那一天', 'reward', 5000, 'next_date', next_date),
    'ledger', coalesce((
      select jsonb_agg(to_jsonb(recent) order by recent.created_at desc, recent.id desc) from (
        select l.id, l.kind, l.amount, e.id as entry_id, l.created_at
        from memory_private.points_ledger l
        left join public.entries e on e.id = l.entry_id and e.status = 'published' and e.type in ('note', 'event') and e."deletedAt" is null
        where l.user_id = account_id order by l.created_at desc, l.id desc limit 100
      ) recent
    ), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(jsonb_build_object('entry_id', e.id, 'title', e.title, 'confirmed_by', c.confirmed_by, 'complete', c.completed_at is not null) order by e."updatedAt" desc)
      from memory_private.points_memory_confirmations c join public.entries e on e.id = c.entry_id
      where e.status = 'published' and e.type in ('note', 'event') and e."deletedAt" is null
    ), '[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description, 'reward', c.reward,
        'created_at', c.created_at, 'confirmed_by', c.confirmed_by, 'complete', c.completed_at is not null) order by c.created_at desc, c.id desc)
      from memory_private.points_challenges c
    ), '[]'::jsonb)
  );
end;
$$;

create function memory_private.points_begin_checkin()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  now_at timestamptz := clock_timestamp();
  today date := memory_private.points_day(now_at);
  midnight timestamptz := (today + 1)::timestamp at time zone 'Asia/Shanghai';
  attempt memory_private.points_checkin_attempts%rowtype;
  checked_in boolean;
begin
  select exists (select 1 from memory_private.points_checkins where user_id = account_id and day = today) into checked_in;
  if not checked_in then
    delete from memory_private.points_checkin_attempts where user_id = account_id and expires_at <= now_at;
    if midnight - now_at > interval '60 seconds' then
      insert into memory_private.points_checkin_attempts (user_id, day, started_at, expires_at)
      values (account_id, today, now_at, least(midnight, now_at + interval '5 minutes'))
      returning * into attempt;
    end if;
  end if;
  return jsonb_build_object(
    'day', today, 'checked_in', checked_in, 'token', attempt.token, 'wait_seconds', 60,
    'expires_at', coalesce(attempt.expires_at, midnight), 'server_time', now_at, 'next_day_at', midnight
  );
end;
$$;

create function memory_private.points_finish_checkin(p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  attempt memory_private.points_checkin_attempts%rowtype;
  now_at timestamptz;
  today date;
  streak_start_day date;
  streak_count integer;
  bonus integer;
begin
  if p_token is null then
    raise exception using errcode = 'P0001', message = 'POINTS_CHECKIN_EXPIRED';
  end if;
  perform memory_private.points_lock_account(account_id);
  now_at := clock_timestamp();
  today := memory_private.points_day(now_at);
  if exists (select 1 from memory_private.points_checkins where user_id = account_id and day = today) then
    return memory_private.points_summary();
  end if;
  select * into attempt from memory_private.points_checkin_attempts where user_id = account_id and token = p_token;
  if not found or attempt.day <> today or now_at >= attempt.expires_at then
    raise exception using errcode = 'P0001', message = 'POINTS_CHECKIN_EXPIRED';
  end if;
  if now_at < attempt.started_at + interval '60 seconds' then
    raise exception using errcode = 'P0001', message = 'POINTS_CHECKIN_EARLY';
  end if;
  select streak_start into streak_start_day from memory_private.points_checkins where user_id = account_id and day = today - 1;
  streak_start_day := coalesce(streak_start_day, today);
  streak_count := today - streak_start_day + 1;
  insert into memory_private.points_checkins (user_id, day, streak_start, token, checked_at)
  values (account_id, today, streak_start_day, p_token, now_at);
  perform memory_private.points_award(account_id, 'checkin:' || to_char(today, 'YYYY-MM-DD'), 50, 'checkin');
  bonus := case streak_count when 7 then 700 when 30 then 3000 when 180 then 18000 when 365 then 36500 end;
  if bonus is not null then
    perform memory_private.points_award(account_id, 'streak:' || to_char(streak_start_day, 'YYYY-MM-DD') || ':' || streak_count, bonus, 'streak');
  end if;
  delete from memory_private.points_checkin_attempts where user_id = account_id and day = today;
  return memory_private.points_summary();
end;
$$;

-- Each shared activity locks its activity row, then both wallets in UUID order.
create function memory_private.points_confirm_memory(p_entry_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  confirmation memory_private.points_memory_confirmations%rowtype;
  participant uuid;
begin
  perform 1 from public.entries
  where id = p_entry_id and status = 'published' and type in ('note', 'event') and "deletedAt" is null
    and exists (select 1 from public.profiles where id = public.entries."authorId" and slot in (1, 2) and role = 'member')
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'POINTS_UNAVAILABLE';
  end if;
  insert into memory_private.points_memory_confirmations (entry_id) values (p_entry_id) on conflict do nothing;
  select * into confirmation from memory_private.points_memory_confirmations where entry_id = p_entry_id for update;
  if confirmation.completed_at is null and not (account_id = any(confirmation.confirmed_by)) then
    confirmation.confirmed_by := array_append(confirmation.confirmed_by, account_id);
    if cardinality(confirmation.confirmed_by) = 2 then
      for participant in select unnest(confirmation.confirmed_by) order by 1 loop
        perform memory_private.points_award(participant, 'memory:' || p_entry_id::text, 500, 'memory', p_entry_id);
      end loop;
      confirmation.completed_at := clock_timestamp();
    end if;
    update memory_private.points_memory_confirmations
    set confirmed_by = confirmation.confirmed_by, completed_at = confirmation.completed_at where entry_id = p_entry_id;
  end if;
  return memory_private.points_summary();
end;
$$;

create function memory_private.points_challenge_json(p_challenge memory_private.points_challenges)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_challenge.id, 'title', p_challenge.title, 'description', p_challenge.description,
    'reward', p_challenge.reward, 'created_at', p_challenge.created_at, 'confirmed_by', p_challenge.confirmed_by,
    'complete', p_challenge.completed_at is not null
  );
$$;

create function memory_private.points_confirm_challenge(p_challenge_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  challenge memory_private.points_challenges%rowtype;
  participant uuid;
begin
  select * into challenge from memory_private.points_challenges where id = p_challenge_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'POINTS_UNAVAILABLE';
  end if;
  if challenge.completed_at is null and not (account_id = any(challenge.confirmed_by)) then
    challenge.confirmed_by := array_append(challenge.confirmed_by, account_id);
    if cardinality(challenge.confirmed_by) = 2 then
      for participant in select unnest(challenge.confirmed_by) order by 1 loop
        perform memory_private.points_award(participant, 'challenge:' || p_challenge_id::text, challenge.reward, 'challenge');
      end loop;
      challenge.completed_at := clock_timestamp();
    end if;
    update memory_private.points_challenges
    set confirmed_by = challenge.confirmed_by, completed_at = challenge.completed_at where id = p_challenge_id;
  end if;
  return memory_private.points_summary();
end;
$$;

create function memory_private.points_admin_challenges()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform memory_private.points_require('admin');
  return coalesce((
    select jsonb_agg(memory_private.points_challenge_json(c) order by c.created_at desc, c.id desc)
    from memory_private.points_challenges c
  ), '[]'::jsonb);
end;
$$;

create function memory_private.points_admin_create_challenge(p_title text, p_description text, p_reward integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  challenge memory_private.points_challenges%rowtype;
begin
  perform memory_private.points_require('admin');
  if p_title is null or btrim(p_title) = '' or char_length(btrim(p_title)) > 120
    or char_length(coalesce(p_description, '')) > 1500 or p_reward is null or p_reward <= 0 then
    raise exception using errcode = '22023', message = 'POINTS_INVALID_CHALLENGE';
  end if;
  insert into memory_private.points_challenges (title, description, reward)
  values (btrim(p_title), btrim(coalesce(p_description, '')), p_reward) returning * into challenge;
  return memory_private.points_challenge_json(challenge);
end;
$$;

create function memory_private.points_product_json(p_product memory_private.points_products)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(p_product) - 'position';
$$;

create function memory_private.points_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform memory_private.points_require();
  return coalesce((
    select jsonb_agg(memory_private.points_product_json(p) order by p.position)
    from memory_private.points_products p where p.active
  ), '[]'::jsonb);
end;
$$;

create function memory_private.points_admin_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform memory_private.points_require('admin');
  return coalesce((
    select jsonb_agg(memory_private.points_product_json(p) order by p.position)
    from memory_private.points_products p
  ), '[]'::jsonb);
end;
$$;

create function memory_private.points_admin_save_product(
  p_product_id uuid, p_version bigint, p_name text, p_description text,
  p_price integer, p_stock integer, p_cover text, p_active boolean
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  product memory_private.points_products%rowtype;
begin
  perform memory_private.points_require('admin');
  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 120
    or char_length(coalesce(p_description, '')) > 1500 or p_price is null or p_price <= 0
    or p_stock is null or p_stock < 0 or p_active is null or not memory_private.points_cover_valid(p_cover) then
    raise exception using errcode = '22023', message = 'POINTS_INVALID_PRODUCT';
  end if;
  if p_product_id is null then
    insert into memory_private.points_products (name, description, price, stock, cover, active)
    values (btrim(p_name), btrim(coalesce(p_description, '')), p_price, p_stock, p_cover, p_active)
    returning * into product;
  else
    update memory_private.points_products
    set name = btrim(p_name), description = btrim(coalesce(p_description, '')), price = p_price,
      stock = p_stock, cover = p_cover, active = p_active, version = version + 1
    where id = p_product_id and version = p_version returning * into product;
    if not found then
      raise exception using errcode = 'P0001', message = 'POINTS_CHANGED';
    end if;
  end if;
  return memory_private.points_product_json(product);
end;
$$;

create function memory_private.points_order_json(p_order memory_private.points_orders, p_include_user boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(p_order) - 'request_id' - 'product_version' -
    case when p_include_user then array[]::text[] else array['user_id']::text[] end;
$$;

create function memory_private.points_backpack()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
begin
  return coalesce((
    select jsonb_agg(memory_private.points_order_json(o) order by o.redeemed_at desc, o.id desc)
    from memory_private.points_orders o where o.user_id = account_id
  ), '[]'::jsonb);
end;
$$;

create function memory_private.points_admin_orders()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform memory_private.points_require('admin');
  return coalesce((
    select jsonb_agg(memory_private.points_order_json(o, true) order by o.redeemed_at desc, o.id desc)
    from memory_private.points_orders o
  ), '[]'::jsonb);
end;
$$;

create function memory_private.points_redeem(p_product_id uuid, p_version bigint, p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  product memory_private.points_products%rowtype;
  purchase memory_private.points_orders%rowtype;
  admin_id uuid;
begin
  if p_product_id is null or p_version is null or p_version < 1 or p_request_id is null then
    raise exception using errcode = '22023', message = 'POINTS_INVALID_REQUEST';
  end if;
  perform memory_private.points_lock_account(account_id);
  select * into purchase from memory_private.points_orders where user_id = account_id and request_id = p_request_id;
  if found then
    if purchase.product_id <> p_product_id or purchase.product_version <> p_version then
      raise exception using errcode = 'P0001', message = 'POINTS_REQUEST_CONFLICT';
    end if;
    return memory_private.points_order_json(purchase);
  end if;
  perform memory_private.points_sync_anniversary(account_id, memory_private.points_day(clock_timestamp()));
  select * into product from memory_private.points_products where id = p_product_id and active for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'POINTS_UNAVAILABLE';
  end if;
  if product.stock = 0 then
    raise exception using errcode = 'P0001', message = 'POINTS_SOLD_OUT';
  end if;
  if product.version <> p_version then
    raise exception using errcode = 'P0001', message = 'POINTS_CHANGED';
  end if;
  update memory_private.points_accounts set balance = balance - product.price
  where user_id = account_id and balance >= product.price;
  if not found then
    raise exception using errcode = 'P0001', message = 'POINTS_LOW_BALANCE';
  end if;
  select id into admin_id from public.profiles where slot = 3 and role = 'admin';
  if not found then
    raise exception using errcode = 'P0001', message = 'POINTS_UNAVAILABLE';
  end if;
  update memory_private.points_products set stock = stock - 1, version = version + 1 where id = p_product_id;
  insert into memory_private.points_orders (user_id, request_id, product_id, product_version, name, description, price, cover)
  values (account_id, p_request_id, product.id, product.version, product.name, product.description, product.price, product.cover)
  returning * into purchase;
  insert into memory_private.points_ledger (user_id, event_key, kind, amount)
  values (account_id, 'redeem:' || purchase.id::text, 'redeem', -product.price);
  perform memory_private.points_notify(admin_id, 'exchange', 'exchange:' || purchase.id::text, account_id, null, null, purchase.id);
  return memory_private.points_order_json(purchase);
end;
$$;

create function memory_private.points_use(p_order_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require('member');
  purchase memory_private.points_orders%rowtype;
begin
  update memory_private.points_orders set used_at = clock_timestamp()
  where id = p_order_id and user_id = account_id and used_at is null returning * into purchase;
  if not found then
    select * into purchase from memory_private.points_orders where id = p_order_id and user_id = account_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'POINTS_UNAVAILABLE';
    end if;
  end if;
  return memory_private.points_order_json(purchase);
end;
$$;

create function memory_private.points_notification_rows(p_user_id uuid)
returns table (
  id uuid, kind text, actor_id uuid, actor_name text, entry_id uuid, entry_title text, comment_id uuid,
  order_id uuid, order_name text, order_price integer, created_at timestamptz, read_at timestamptz
)
language sql stable set search_path = '' as $$
  select i.id, i.kind, i.actor_id, a.name, e.id, e.title, c.id, o.id, o.name, o.price, i.created_at, i.read_at
  from memory_private.points_inbox i
  left join public.profiles a on a.id = i.actor_id
  left join public.entries e on e.id = i.entry_id and e.status = 'published' and e.type in ('note', 'event') and e."deletedAt" is null
  left join public.comments c on c.id = i.comment_id and c."entryId" = e.id
  left join memory_private.points_orders o on o.id = i.order_id
  where i.recipient_id = p_user_id
    and (i.entry_id is null or e.id is not null) and (i.comment_id is null or c.id is not null);
$$;

create function memory_private.points_notifications()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require();
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(recent) order by recent.created_at desc, recent.id desc)
      from (select * from memory_private.points_notification_rows(account_id) order by created_at desc, id desc limit 100) recent
    ), '[]'::jsonb),
    'unread', (select count(*) from memory_private.points_notification_rows(account_id) where read_at is null)
  );
end;
$$;

create function memory_private.points_read_notifications(p_ids uuid[] default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  account_id uuid := memory_private.points_require();
begin
  update memory_private.points_inbox i set read_at = clock_timestamp()
  from memory_private.points_notification_rows(account_id) visible
  where i.recipient_id = account_id and i.id = visible.id and i.read_at is null and (p_ids is null or i.id = any(p_ids));
  return memory_private.points_notifications();
end;
$$;

-- The only Data API exposure is these invoker wrappers. Each matching private
-- implementation verifies auth.uid(), the runtime guard and the relevant role.
create function public.points_summary()
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_summary();
$$;
create function public.points_catalog()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select memory_private.points_catalog();
$$;
create function public.points_backpack()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select memory_private.points_backpack();
$$;
create function public.points_notifications()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select memory_private.points_notifications();
$$;
create function public.points_read_notifications(p_ids uuid[] default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_read_notifications(p_ids);
$$;
create function public.points_begin_checkin()
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_begin_checkin();
$$;
create function public.points_finish_checkin(p_token uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_finish_checkin(p_token);
$$;
create function public.points_redeem(p_product_id uuid, p_version bigint, p_request_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_redeem(p_product_id, p_version, p_request_id);
$$;
create function public.points_use(p_order_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_use(p_order_id);
$$;
create function public.points_confirm_memory(p_entry_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_confirm_memory(p_entry_id);
$$;
create function public.points_confirm_challenge(p_challenge_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_confirm_challenge(p_challenge_id);
$$;
create function public.points_admin_catalog()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select memory_private.points_admin_catalog();
$$;
create function public.points_admin_orders()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select memory_private.points_admin_orders();
$$;
create function public.points_admin_challenges()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select memory_private.points_admin_challenges();
$$;
create function public.points_admin_save_product(p_product_id uuid, p_version bigint, p_name text, p_description text,
  p_price integer, p_stock integer, p_cover text, p_active boolean)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_admin_save_product(p_product_id, p_version, p_name, p_description, p_price, p_stock, p_cover, p_active);
$$;
create function public.points_admin_create_challenge(p_title text, p_description text, p_reward integer)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_admin_create_challenge(p_title, p_description, p_reward);
$$;

revoke all on function
  memory_private.points_day(timestamptz),
  memory_private.points_cover_valid(text),
  memory_private.points_require(text),
  memory_private.points_lock_account(uuid),
  memory_private.points_award(uuid, text, integer, text, uuid),
  memory_private.points_notify(uuid, text, text, uuid, uuid, uuid, uuid),
  memory_private.points_sync_anniversary(uuid, date),
  memory_private.points_run_anniversaries(),
  memory_private.points_notification_rows(uuid),
  memory_private.points_challenge_json(memory_private.points_challenges),
  memory_private.points_product_json(memory_private.points_products),
  memory_private.points_order_json(memory_private.points_orders, boolean)
from public, anon, authenticated, service_role;

revoke all on function
  memory_private.points_summary(),
  memory_private.points_catalog(),
  memory_private.points_backpack(),
  memory_private.points_notifications(),
  memory_private.points_read_notifications(uuid[]),
  memory_private.points_begin_checkin(),
  memory_private.points_finish_checkin(uuid),
  memory_private.points_redeem(uuid, bigint, uuid),
  memory_private.points_use(uuid),
  memory_private.points_confirm_memory(uuid),
  memory_private.points_confirm_challenge(uuid),
  memory_private.points_admin_catalog(),
  memory_private.points_admin_orders(),
  memory_private.points_admin_challenges(),
  memory_private.points_admin_save_product(uuid, bigint, text, text, integer, integer, text, boolean),
  memory_private.points_admin_create_challenge(text, text, integer)
from public, anon, authenticated, service_role;

revoke all on function
  public.points_summary(),
  public.points_catalog(),
  public.points_backpack(),
  public.points_notifications(),
  public.points_read_notifications(uuid[]),
  public.points_begin_checkin(),
  public.points_finish_checkin(uuid),
  public.points_redeem(uuid, bigint, uuid),
  public.points_use(uuid),
  public.points_confirm_memory(uuid),
  public.points_confirm_challenge(uuid),
  public.points_admin_catalog(),
  public.points_admin_orders(),
  public.points_admin_challenges(),
  public.points_admin_save_product(uuid, bigint, text, text, integer, integer, text, boolean),
  public.points_admin_create_challenge(text, text, integer)
from public, anon, authenticated, service_role;

grant execute on function
  memory_private.points_summary(),
  memory_private.points_catalog(),
  memory_private.points_backpack(),
  memory_private.points_notifications(),
  memory_private.points_read_notifications(uuid[]),
  memory_private.points_begin_checkin(),
  memory_private.points_finish_checkin(uuid),
  memory_private.points_redeem(uuid, bigint, uuid),
  memory_private.points_use(uuid),
  memory_private.points_confirm_memory(uuid),
  memory_private.points_confirm_challenge(uuid),
  memory_private.points_admin_catalog(),
  memory_private.points_admin_orders(),
  memory_private.points_admin_challenges(),
  memory_private.points_admin_save_product(uuid, bigint, text, text, integer, integer, text, boolean),
  memory_private.points_admin_create_challenge(text, text, integer)
to authenticated;

grant execute on function
  public.points_summary(),
  public.points_catalog(),
  public.points_backpack(),
  public.points_notifications(),
  public.points_read_notifications(uuid[]),
  public.points_begin_checkin(),
  public.points_finish_checkin(uuid),
  public.points_redeem(uuid, bigint, uuid),
  public.points_use(uuid),
  public.points_confirm_memory(uuid),
  public.points_confirm_challenge(uuid),
  public.points_admin_catalog(),
  public.points_admin_orders(),
  public.points_admin_challenges(),
  public.points_admin_save_product(uuid, bigint, text, text, integer, integer, text, boolean),
  public.points_admin_create_challenge(text, text, integer)
to authenticated;

-- Supabase supports pg_cron on hosted projects. An account's first read
-- also settles any due anniversary if a scheduled run was unavailable.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
    and current_setting('cron.database_name', true) = current_database()
    and exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('memory-points-anniversary', '5 16 * * *', 'select memory_private.points_run_anniversaries()');
  end if;
end;
$$;
