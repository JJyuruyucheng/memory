-- Existing solar rows and RLS are preserved. A lunar row retains its solar
-- anchor in date for older readers and explicitly carries its calendar fields.
create or replace function memory_private.valid_anniversaries(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item jsonb;
  item_date date;
  lunar jsonb;
  lunar_year numeric;
  lunar_month numeric;
  lunar_day numeric;
begin
  if value is null or jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 100 then
    return false;
  end if;
  for item in select jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item -> 'id') is distinct from 'string'
      or char_length(item ->> 'id') not between 1 and 100
      or jsonb_typeof(item -> 'title') is distinct from 'string'
      or char_length(btrim(item ->> 'title')) not between 1 and 120
      or (item ->> 'title') ~ '^[[:space:]]*$'
      or jsonb_typeof(item -> 'date') is distinct from 'string'
      or (item ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(item -> 'yearly') is distinct from 'boolean' then
      return false;
    end if;
    item_date := (item ->> 'date')::date;
    if item_date < date '1000-01-01' or item_date > date '9999-12-31'
      or to_char(item_date, 'YYYY-MM-DD') <> item ->> 'date' then
      return false;
    end if;

    if item ? 'calendar' and (
      jsonb_typeof(item -> 'calendar') is distinct from 'string'
      or item ->> 'calendar' not in ('solar', 'lunar')
    ) then
      return false;
    end if;
    if item ->> 'calendar' is distinct from 'lunar' then
      if item ? 'lunar' then return false; end if;
      continue;
    end if;
    lunar := item -> 'lunar';
    if jsonb_typeof(lunar) is distinct from 'object'
      or jsonb_typeof(lunar -> 'year') is distinct from 'number'
      or jsonb_typeof(lunar -> 'month') is distinct from 'number'
      or jsonb_typeof(lunar -> 'day') is distinct from 'number'
      or jsonb_typeof(lunar -> 'leap') is distinct from 'boolean' then
      return false;
    end if;
    lunar_year := (lunar ->> 'year')::numeric;
    lunar_month := (lunar ->> 'month')::numeric;
    lunar_day := (lunar ->> 'day')::numeric;
    if lunar_year <> trunc(lunar_year) or lunar_year not between 1900 and 2100
      or lunar_month <> trunc(lunar_month) or lunar_month not between 1 and 12
      or lunar_day <> trunc(lunar_day) or lunar_day not between 1 and 30
      or extract(year from item_date) not between lunar_year and lunar_year + 1 then
      return false;
    end if;
  end loop;
  return jsonb_array_length(value) = (
    select count(distinct a.anniversary ->> 'id')
    from jsonb_array_elements(value) as a(anniversary)
  );
exception when others then return false;
end;
$$;
