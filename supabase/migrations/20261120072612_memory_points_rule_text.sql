-- Rule text is display copy stored beside the points settings. Award and
-- redemption functions continue to use their existing database rules.
create function memory_private.points_rule_lines_valid(p_lines text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    cardinality(p_lines) between 1 and 24
    and array_ndims(p_lines) = 1
    and not exists (
      select 1 from unnest(p_lines) as rule(line)
      where line is null or line !~ '[^[:space:]]'
        or char_length(line) > 200 or line ~ '[[:cntrl:]]'
    ),
    false
  );
$$;

alter table memory_private.points_settings
  add column rules text[] not null default array[
    '北京时间每日前台停留 60 秒自动签到，得 0.5 分。',
    '每轮连签满 7、30、180、365 天，分别奖同等积分。天数持续累计，断签后重开一轮。',
    '发布帖子得1分。收到对方有效点赞、评论或回复，各得 0.2 分。',
    '共同回忆双方都确认后，作者得 5 分。共同挑战按设定奖励发放。',
    '每年 1 月 1 日发放 50 分纪念日积分。',
    '兑换扣积分和库存，兑换及使用不可撤销。现金券与补贴按 1 分抵 1 元线下兑现。'
  ] check (memory_private.points_rule_lines_valid(rules)),
  add column rules_version bigint not null default 1 check (rules_version > 0);

create function memory_private.points_rules()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform memory_private.points_require();
  return (
    select jsonb_build_object('lines', rules, 'version', rules_version)
    from memory_private.points_settings where singleton
  );
end;
$$;

create function memory_private.points_admin_save_rules(p_lines text[], p_version bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  settings memory_private.points_settings%rowtype;
begin
  perform memory_private.points_require('admin');
  if p_version is null or p_version < 1 or not memory_private.points_rule_lines_valid(p_lines) then
    raise exception using errcode = '22023', message = 'POINTS_INVALID_RULES';
  end if;
  select * into settings from memory_private.points_settings where singleton for update;
  if settings.rules is distinct from p_lines then
    if settings.rules_version is distinct from p_version then
      raise exception using errcode = 'P0001', message = 'POINTS_RULES_CHANGED';
    end if;
    update memory_private.points_settings set rules = p_lines, rules_version = rules_version + 1
    where singleton returning * into settings;
  end if;
  return jsonb_build_object('lines', settings.rules, 'version', settings.rules_version);
end;
$$;

create function public.points_rules()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select memory_private.points_rules();
$$;

create function public.points_admin_save_rules(p_lines text[], p_version bigint)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select memory_private.points_admin_save_rules(p_lines, p_version);
$$;

revoke all on function memory_private.points_rule_lines_valid(text[]), memory_private.points_rules(),
  memory_private.points_admin_save_rules(text[], bigint), public.points_rules(),
  public.points_admin_save_rules(text[], bigint)
from public, anon, authenticated, service_role;

grant execute on function memory_private.points_rules(), memory_private.points_admin_save_rules(text[], bigint),
  public.points_rules(), public.points_admin_save_rules(text[], bigint)
to authenticated;
