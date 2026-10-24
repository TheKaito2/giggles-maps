-- Leaderboard hardening (security review of 060):
-- - weekly prizes pay exactly 3 places (ties no longer all win), and only to players with a real stamp that week;
-- - leading your friends needs a strict lead over at least 2 friends who also scored, with friendships from before the week;
-- - crowns count distinct days (not place-days); a place's regular respects member-only places; award weeks snap to Monday;
-- - coin balances and the awards table aren't readable by clients directly.

create or replace function public.province_leaders()
returns table (province_id smallint, user_id uuid, n int) language sql stable security definer set search_path = '' as $$
  with days as (
    select distinct c.user_id, pl.province_id, pl.id place_id, (c.created_at at time zone 'Asia/Bangkok')::date d, c.created_at
      from public.checkins c join public.places pl on pl.id = c.place_id join public.profiles pr on pr.id = c.user_id
     where c.status = 'approved' and c.created_at > now() - interval '90 days' and pl.province_id is not null
       and not coalesce((c.client->>'demo')::boolean, false) and pr.on_leaderboard and pr.nickname is not null
  ), counts as (
    select user_id, province_id, count(distinct d)::int n, max(created_at) reached from days group by 1, 2
  )
  select distinct on (province_id) province_id, user_id, n from counts order by province_id, n desc, reached, user_id
$$;

create or replace function public.province_champions()
returns jsonb language sql stable security definer set search_path = '' as $$
  with mine as (
    select pl.province_id, count(distinct (c.created_at at time zone 'Asia/Bangkok')::date)::int n
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

create or replace function public.place_regular(p_place bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('who', public.who_of(user_id), 'visits', n, 'friend', public.is_friend(auth.uid(), user_id), 'mine', user_id = auth.uid())
    from (select c.user_id, count(distinct (c.created_at at time zone 'Asia/Bangkok')::date)::int n, max(c.created_at) reached
            from public.checkins c join public.profiles pr on pr.id = c.user_id
           where c.place_id = p_place and c.status = 'approved' and c.created_at > now() - interval '60 days'
             and not coalesce((c.client->>'demo')::boolean, false) and pr.on_leaderboard and pr.nickname is not null
           group by 1) v
   where n >= 2 and exists (select 1 from public.places p where p.id = p_place and p.min_level <= public.unlock_level(auth.uid()))
   order by n desc, reached, user_id limit 1
$$;

create or replace function public.award_week(p_week_start timestamptz default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := public.week_start(coalesce(p_week_start, now() - interval '7 days'));   -- always a Monday
  v_to timestamptz := v_from + interval '7 days';
  v_week date := (v_from at time zone 'Asia/Bangkok')::date;
  r record; v_n int := 0;
begin
  for r in
    with xp as (select pr.id, pr.on_leaderboard, public.board_value(pr.id, 'xp', v_from, v_to) v,
                       -- a real (non-demo) stamp that week: a quest claim alone doesn't win anything
                       exists (select 1 from public.stamps s where s.user_id = pr.id and s.earned_at >= v_from and s.earned_at < v_to
                                 and not public.is_demo_checkin(s.checkin_id)) stamped
                  from public.profiles pr where pr.nickname is not null),
    top as (select id, row_number() over (order by v desc, id) rn from xp where on_leaderboard and v > 0 and stamped),
    -- each player and their friends from before the week (new friendships can't be made to farm it)
    pairs as (select x.id, o.v ov from xp x
                join public.friendships f on x.id in (f.a, f.b) and f.created_at < v_from
                join xp o on o.id = case when f.a = x.id then f.b else f.a end),
    lead as (select x.id from xp x join pairs p on p.id = x.id
              where x.v > 0 and x.stamped group by x.id, x.v
             having x.v > max(p.ov) and count(*) filter (where p.ov > 0) >= 2)
    select 'everyone' scope, id, rn::smallint rnk, (array[100, 60, 40])[rn] coins from top where rn <= 3
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

revoke all on table public.weekly_awards from anon, authenticated;
revoke execute on function public.coins_of(uuid) from public, anon, authenticated;
revoke all on function public.province_leaders(), public.award_week(timestamptz) from public, anon, authenticated;
