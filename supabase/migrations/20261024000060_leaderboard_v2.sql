-- Leaderboard v2: weekly and all-time boards, a friends scope, category boards (provinces, landmarks, temples, food),
-- province champions (most visit-days in 90 days), place regulars (most visit-days in 60 days) and weekly rewards.
-- Demo check-ins never count; global boards only rank people who chose to be on the leaderboard.

-- Monday 00:00 Bangkok of the week holding p_at
create or replace function public.week_start(p_at timestamptz default now())
returns timestamptz language sql stable set search_path = '' as $$
  select date_trunc('week', p_at at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'
$$;

-- one player's score on a board: XP or a count of non-demo stamps, all-time (p_from null) or in [p_from, p_to)
create or replace function public.board_value(p_user uuid, p_metric text, p_from timestamptz default null, p_to timestamptz default null)
returns int language sql stable security definer set search_path = '' as $$
  with st as (
    select s.*, pl.category from public.stamps s join public.places pl on pl.id = s.place_id
     where s.user_id = p_user and not public.is_demo_checkin(s.checkin_id)
       and (p_from is null or s.earned_at >= p_from) and (p_to is null or s.earned_at < p_to))
  select (case p_metric
    when 'xp' then case when p_from is null then public.board_xp(p_user) else
        coalesce((select sum(xp) from st), 0)
      + coalesce((select sum(c.xp) from public.challenge_claims c where c.user_id = p_user and c.claimed_at >= p_from
                    and (p_to is null or c.claimed_at < p_to)), 0)
      + coalesce((select sum(f.xp) from public.fortune_pulls f where f.user_id = p_user and f.created_at >= p_from
                    and (p_to is null or f.created_at < p_to) and not public.is_demo_checkin(f.checkin_id)), 0) end
    when 'provinces' then (select count(distinct province_id) from st where province_id is not null)
    when 'landmarks' then (select count(*) from st where tier = 3)
    when 'temples' then (select count(*) from st where category = 'temple')
    when 'food' then (select count(*) from st where category = 'food')
  end)::int
$$;

-- ponytail: scores every player in the pool on each call; fine for hundreds of players, cache per week when it isn't
create or replace function public.board(p_scope text default 'everyone', p_period text default 'all', p_metric text default 'xp')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := case when p_period = 'week' then public.week_start() end;
begin
  if p_scope not in ('everyone', 'friends') or p_period not in ('week', 'all')
     or p_metric not in ('xp', 'provinces', 'landmarks', 'temples', 'food') then
    raise exception 'bad_board' using errcode = 'P0001';
  end if;
  return (
    with pool as (
      select pr.id from public.profiles pr
       where pr.nickname is not null
         and case when p_scope = 'friends' then pr.id = auth.uid() or public.is_friend(auth.uid(), pr.id) else pr.on_leaderboard end
    ), scored as (
      select id, public.board_value(id, p_metric, v_from) v from pool
    ), ranked as (
      select id, v, rank() over (order by v desc) rnk from scored where v > 0
    ), mine as (
      select coalesce((select v from scored where id = auth.uid()), 0) v
    )
    select jsonb_build_object(
      'scope', p_scope, 'period', p_period, 'metric', p_metric,
      'ends', case when p_period = 'week' then v_from + interval '7 days' end,
      'top', coalesce((select jsonb_agg(public.board_card(t.id) || jsonb_build_object('rank', t.rnk, 'value', t.v) order by t.rnk, t.id)
               from (select * from ranked order by rnk, id limit 50) t), '[]'),
      'me', case when auth.uid() in (select id from pool) then public.board_card(auth.uid())
              || jsonb_build_object('rank', (select rnk from ranked where id = auth.uid()), 'value', (select v from mine)) end,
      -- the player just above you: who the chase bar is after
      'next', (select public.board_card(r.id) || jsonb_build_object('rank', r.rnk, 'value', r.v)
                 from ranked r where r.v > (select v from mine) order by r.v, r.id desc limit 1),
      'total', (select count(*) from ranked))
  );
end;
$$;

-- per province, who visited most on different days in the last 90 days (ties: who got there first). Board players only;
-- a visit-day is one approved, non-demo check-in day, so checking in twice at once doesn't farm a crown.
create or replace function public.province_leaders()
returns table (province_id smallint, user_id uuid, n int) language sql stable security definer set search_path = '' as $$
  with days as (
    select distinct c.user_id, pl.province_id, pl.id place_id, (c.created_at at time zone 'Asia/Bangkok')::date d, c.created_at
      from public.checkins c join public.places pl on pl.id = c.place_id join public.profiles pr on pr.id = c.user_id
     where c.status = 'approved' and c.created_at > now() - interval '90 days' and pl.province_id is not null
       and not coalesce((c.client->>'demo')::boolean, false) and pr.on_leaderboard and pr.nickname is not null
  ), counts as (
    select user_id, province_id, count(distinct (place_id, d))::int n, max(created_at) reached from days group by 1, 2
  )
  select distinct on (province_id) province_id, user_id, n from counts order by province_id, n desc, reached, user_id
$$;

create or replace function public.province_champions()
returns jsonb language sql stable security definer set search_path = '' as $$
  with mine as (
    select pl.province_id, count(distinct (pl.id, (c.created_at at time zone 'Asia/Bangkok')::date))::int n
      from public.checkins c join public.places pl on pl.id = c.place_id
     where c.user_id = auth.uid() and c.status = 'approved' and c.created_at > now() - interval '90 days'
       and not coalesce((c.client->>'demo')::boolean, false) and pl.province_id is not null
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'province', jsonb_build_object('id', pv.id, 'iso', pv.iso, 'name_en', pv.name_en, 'name_th', pv.name_th),
           'champion', public.who_of(l.user_id), 'visits', l.n, 'mine', l.user_id = auth.uid(),
           'my_visits', coalesce(m.n, 0), 'need', case when l.user_id = auth.uid() then 0 else l.n - coalesce(m.n, 0) + 1 end)
         order by (l.user_id = auth.uid()) desc, (m.n is not null) desc, l.n desc), '[]')
    from public.province_leaders() l join public.provinces pv on pv.id = l.province_id left join mine m on m.province_id = l.province_id
$$;

-- a place's regular: most visit-days there in 60 days, at least 2 (Swarm's mayor)
create or replace function public.place_regular(p_place bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('who', public.who_of(user_id), 'visits', n, 'friend', public.is_friend(auth.uid(), user_id), 'mine', user_id = auth.uid())
    from (select c.user_id, count(distinct (c.created_at at time zone 'Asia/Bangkok')::date)::int n, max(c.created_at) reached
            from public.checkins c join public.profiles pr on pr.id = c.user_id
           where c.place_id = p_place and c.status = 'approved' and c.created_at > now() - interval '60 days'
             and not coalesce((c.client->>'demo')::boolean, false) and pr.on_leaderboard and pr.nickname is not null
           group by 1) v
   where n >= 2 order by n desc, reached, user_id limit 1
$$;

-- weekly rewards: last week's top 3 (everyone, by XP) and each player who led their friends
create table if not exists public.weekly_awards (
  week date not null, scope text not null check (scope in ('everyone', 'friends')),
  user_id uuid not null references auth.users(id) on delete cascade, rank smallint not null, coins int not null check (coins >= 0),
  awarded_at timestamptz not null default now(), primary key (week, scope, user_id));
alter table public.weekly_awards enable row level security;   -- read through the feed and coins_of only

alter table public.activity drop constraint if exists activity_kind_check;
alter table public.activity add constraint activity_kind_check
  check (kind in ('stamp', 'province', 'level', 'challenge', 'badge', 'nudge', 'fortune', 'comment', 'award'));

create or replace function public.award_week(p_week_start timestamptz default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := coalesce(p_week_start, public.week_start() - interval '7 days');
  v_to timestamptz := v_from + interval '7 days';
  v_week date := (v_from at time zone 'Asia/Bangkok')::date;
  r record; v_n int := 0;
begin
  for r in
    with xp as (select pr.id, pr.on_leaderboard, public.board_value(pr.id, 'xp', v_from, v_to) v
                  from public.profiles pr where pr.nickname is not null),
    top as (select id, rank() over (order by v desc) rnk from xp where on_leaderboard and v > 0),
    lead as (select x.id from xp x where x.v > 0
               and exists (select 1 from public.friendships f where x.id in (f.a, f.b))
               and x.v >= all (select o.v from xp o where public.is_friend(x.id, o.id))
               and exists (select 1 from xp o where public.is_friend(x.id, o.id) and o.v > 0))
    select 'everyone' scope, id, rnk::smallint rnk, (array[100, 60, 40])[rnk] coins from top where rnk <= 3
    union all select 'friends', id, 1::smallint, 30 from lead
  loop
    insert into public.weekly_awards (week, scope, user_id, rank, coins) values (v_week, r.scope, r.id, r.rnk, r.coins) on conflict do nothing;
    if found then
      v_n := v_n + 1;
      perform public.grant_fortune_ticket(r.id);
      insert into public.activity (user_id, kind, data)
      values (r.id, 'award', jsonb_build_object('week', v_week, 'scope', r.scope, 'rank', r.rnk, 'coins', r.coins));
    end if;
  end loop;
  return v_n;
end;
$$;

do $cron$ begin
  if exists (select 1 from cron.job where jobname = 'weekly-awards') then perform cron.unschedule('weekly-awards'); end if;
  perform cron.schedule('weekly-awards', '5 17 * * 0', 'select public.award_week()');   -- Monday 00:05 Bangkok
end $cron$;

create or replace function public.coins_of(p_user uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case when pr.member_since is null then 0 else
    coalesce((select sum(coins) from public.stamps where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.challenge_claims where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.fortune_pulls where user_id = p_user), 0)
    + coalesce((select sum(coins) from public.weekly_awards where user_id = p_user), 0)
    + 50 * (public.level_for(pr.xp) - 1)
    - coalesce((select sum(coins) from public.coin_spends where user_id = p_user), 0) end
  from public.profiles pr where pr.id = p_user
$function$;

create or replace function public.profile_of(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_pr public.profiles; v_bxp int;
begin
  if p_id <> auth.uid() and not public.is_friend(auth.uid(), p_id) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  select * into v_pr from public.profiles where id = p_id;
  v_bxp := public.board_xp(p_id);
  return public.card_of(p_id) || jsonb_build_object(
    'friend_code', case when p_id = auth.uid() then v_pr.friend_code end,
    'photos', (select count(*) from public.checkins where user_id = p_id and status <> 'rejected' and selfie_path is not null and not photo_hidden),
    'friends', (select count(*) from public.friendships where p_id in (a, b)),
    'rank', case when v_pr.on_leaderboard and v_pr.nickname is not null and v_bxp > 0 then
              (select count(*) + 1 from public.profiles o where o.on_leaderboard and o.nickname is not null and o.xp > 0
                 and public.board_xp(o.id) > v_bxp) end,
    'badges', public.achievements(p_id),
    'showcase', public.showcase_of(p_id),
    'crowns', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'name_en', pv.name_en, 'name_th', pv.name_th, 'visits', l.n) order by l.n desc)
                from public.province_leaders() l join public.provinces pv on pv.id = l.province_id where l.user_id = p_id), '[]'));
end;
$function$;

create or replace function public.place_page(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'name_th', p.name_th, 'kind', p.kind, 'category', p.category, 'tier', p.tier,
    'lat', extensions.st_y(p.location::extensions.geometry), 'lng', extensions.st_x(p.location::extensions.geometry),
    'opening_hours', p.opening_hours, 'phone', p.phone, 'website', p.website, 'address', p.address,
    'local', p.local, 'otop', p.otop, 'community', p.community, 'detour', p.detour,
    'rating', (select round(avg(rating), 1) from public.reviews r where r.place_id = p.id having count(*) >= 3),
    'review_count', (select count(*) from public.reviews r where r.place_id = p.id),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('who', public.who_of(r.user_id), 'rating', r.rating, 'body', r.body,
                 'at', r.updated_at, 'mine', r.user_id = auth.uid()) order by r.updated_at desc)
               from (select * from public.reviews r where r.place_id = p.id order by r.updated_at desc limit 20) r), '[]'),
    'checked_in', exists (select 1 from public.checkins c where c.user_id = auth.uid() and c.place_id = p.id and c.status <> 'rejected'),
    'stamped', exists (select 1 from public.stamps s where s.user_id = auth.uid() and s.place_id = p.id),
    'photos', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('url', ph.url, 'credit', ph.credit, 'licence', ph.licence, 'source', ph.source) x
                   from public.place_photos ph where ph.place_id = p.id
                 union all
                 select jsonb_build_object('path', c.selfie_path, 'credit', coalesce(pr.nickname, 'Explorer'), 'source', 'checkin')
                   from public.checkins c join public.profiles pr on pr.id = c.user_id
                  where c.place_id = p.id and c.public_photo and not c.photo_hidden and c.status <> 'rejected' and c.selfie_path is not null
                  limit 30) y), '[]'),
    'busy', (select case when sum(n) >= 20 then jsonb_agg(case when n < 3 then 0 else n end order by h) end from (
               select h, (select count(*) from public.checkins c where c.place_id = p.id and c.status <> 'rejected'
                           and extract(isodow from c.created_at at time zone 'Asia/Bangkok') = extract(isodow from now() at time zone 'Asia/Bangkok')
                           and extract(hour from c.created_at at time zone 'Asia/Bangkok') = h) n
                 from generate_series(6, 23) h) hist),
    'regular', public.place_regular(p.id),
    'saved_in', coalesce((select jsonb_agg(lp.list_id) from public.list_places lp join public.lists l on l.id = lp.list_id
                          where lp.place_id = p.id and l.user_id = auth.uid()), '[]'))
  from public.places p where p.id = p_id and p.min_level <= public.unlock_level(auth.uid())
$function$;

revoke all on function public.board_value(uuid, text, timestamptz, timestamptz), public.province_leaders(), public.award_week(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.board(text, text, text), public.province_champions(), public.place_regular(bigint) from public, anon;
grant execute on function public.board(text, text, text), public.province_champions(), public.place_regular(bigint) to authenticated;
