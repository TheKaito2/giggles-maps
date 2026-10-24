-- Watch an ad to keep planning: at the daily limit a free account can watch an ad for +1 detour (or +5 changes), up to 3 ads a day.
-- On the web nobody can verify the ad was watched (Google's rewarded-ad verification is app-only), so the reward needs an
-- ad-length wait: claimed at least 15 s after it started, and capped per day.

create table public.ad_rewards (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  day date not null default (now() at time zone 'Asia/Bangkok')::date,
  kind text not null check (kind in ('detour', 'edit')),
  started_at timestamptz not null default now(),
  granted_at timestamptz
);
create index ad_rewards_user_day on public.ad_rewards (user_id, day);
alter table public.ad_rewards enable row level security;

create function public.start_ad_reward(p_kind text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_day date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if p_kind not in ('detour', 'edit') then raise exception 'bad_kind' using errcode = 'P0001'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and member_since is not null) then raise exception 'not_needed' using errcode = 'P0001'; end if;
  if (select count(*) from public.ad_rewards where user_id = auth.uid() and day = v_day and granted_at is not null) >= 3 then
    raise exception 'ad_limit' using errcode = 'P0001';
  end if;
  delete from public.ad_rewards where user_id = auth.uid() and granted_at is null and started_at < now() - interval '1 hour';
  insert into public.ad_rewards (user_id, kind) values (auth.uid(), p_kind) returning id into v_id;
  return v_id;
end $$;

create function public.claim_ad_reward(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.ad_rewards;
begin
  perform pg_advisory_xact_lock(hashtext('ad_rewards:' || auth.uid()::text));
  select * into r from public.ad_rewards where id = p_id and user_id = auth.uid() and granted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if now() - r.started_at < interval '15 seconds' then raise exception 'too_soon' using errcode = 'P0001'; end if;
  if (select count(*) from public.ad_rewards where user_id = auth.uid() and day = r.day and granted_at is not null) >= 3 then
    raise exception 'ad_limit' using errcode = 'P0001';
  end if;
  update public.ad_rewards set granted_at = now() where id = p_id;
end $$;

revoke execute on function public.start_ad_reward(text), public.claim_ad_reward(bigint) from public, anon;
grant execute on function public.start_ad_reward(text), public.claim_ad_reward(bigint) to authenticated;

-- today's free allowance: 3 detours + 1 per detour ad, 10 changes + 5 per change ad
create function public.plan_allowance(p_user uuid, out detours int, out edits int)
language sql stable security definer set search_path = '' as $$
  select 3 + count(*) filter (where kind = 'detour')::int, 10 + 5 * count(*) filter (where kind = 'edit')::int
    from public.ad_rewards where user_id = p_user and day = (now() at time zone 'Asia/Bangkok')::date and granted_at is not null
$$;
revoke execute on function public.plan_allowance(uuid) from public, anon, authenticated;

create or replace function public.plan_allowed(p_user uuid, p_edit boolean, p_key text, p_dest text, p_member boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
  v_edit boolean;
  v_key text;
  v_allow record;
begin
  perform pg_advisory_xact_lock(hashtext('plan_usage:' || p_user::text));
  delete from public.plan_usage where user_id = p_user and at < now() - interval '3 days';
  -- everyone: at most 20 plans a minute; a day: 300 for members, 100 for free accounts
  if (select count(*) from public.plan_usage where user_id = p_user and at > now() - interval '1 minute') >= 20 then return 'slow_down'; end if;
  if (select count(*) from public.plan_usage where user_id = p_user and day = v_day) >= (case when p_member then 300 else 100 end) then return 'slow_down'; end if;
  -- an edit of a destination not planned today is a new detour
  v_edit := p_edit and exists (select 1 from public.plan_usage where user_id = p_user and day = v_day and kind = 'detour' and key = p_dest);
  v_key := case when v_edit then p_key else p_dest end;
  select * into v_allow from public.plan_allowance(p_user);
  if not p_member
    and not exists (select 1 from public.plan_usage where user_id = p_user and day = v_day and kind = (case when v_edit then 'edit' else 'detour' end) and key = v_key)
    and (select count(distinct key) from public.plan_usage where user_id = p_user and day = v_day and kind = (case when v_edit then 'edit' else 'detour' end))
        >= (case when v_edit then v_allow.edits else v_allow.detours end) then
    return case when v_edit then 'edit_limit' else 'detour_limit' end;
  end if;
  insert into public.plan_usage (user_id, day, kind, key) values (p_user, v_day, case when v_edit then 'edit' else 'detour' end, v_key);
  return 'ok';
end $$;

create or replace function public.my_plan_usage() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'member', coalesce((select member_since is not null from public.profiles where id = auth.uid()), false),
    'detours', (select count(distinct key) from public.plan_usage where user_id = auth.uid() and kind = 'detour' and day = (now() at time zone 'Asia/Bangkok')::date),
    'edits', (select count(distinct key) from public.plan_usage where user_id = auth.uid() and kind = 'edit' and day = (now() at time zone 'Asia/Bangkok')::date),
    'max_detours', a.detours, 'max_edits', a.edits,
    'ads_left', greatest(0, 3 - (select count(*) from public.ad_rewards where user_id = auth.uid() and day = (now() at time zone 'Asia/Bangkok')::date and granted_at is not null)))
  from public.plan_allowance(auth.uid()) a
$$;
