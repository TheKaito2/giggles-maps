-- A check-in's Siam Si shake waits 24 hours on the server (shake_fortune accepts it), but the app only offered it in the
-- check-in ceremony: close that first and it was lost. me() now lists the waiting ones, and the Siam Si card offers them.
CREATE OR REPLACE FUNCTION public.me()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('member', pr.member_since is not null, 'xp', pr.xp, 'plus_until', pr.plus_until,
           'nickname', pr.nickname, 'colour', pr.colour, 'friend_code', pr.friend_code, 'on_leaderboard', pr.on_leaderboard,
           'avatar', pr.avatar, 'joined', pr.created_at, 'coins', public.coins_of(pr.id), 'is_admin', pr.is_admin,
           'provinces', (select count(distinct province_id) from public.stamps where user_id = pr.id and province_id is not null),
           'look', public.look_of(pr.id), 'title', public.title_of(public.look_of(pr.id)),
           'owned', coalesce((select jsonb_agg(s.kind || ':' || s.item_id) from public.coin_spends s where s.user_id = pr.id), '[]'),
           'fortune_tickets', coalesce((select balance from public.fortune_tickets where user_id = pr.id), 0),
           'xp_boost_until', case when pr.xp_boost_until > now() then pr.xp_boost_until end,
           'perks', public.perks_of(pr.id),
           -- first-visit check-ins from the last day whose Siam Si shake is still waiting (closed before shaking)
           'pending_shakes', coalesce((select jsonb_agg(jsonb_build_object('checkin', c.id, 'place', p.name) order by c.created_at desc)
              from public.checkins c join public.places p on p.id = c.place_id
             where c.user_id = pr.id and c.rewarded and c.status = 'approved' and c.created_at > now() - interval '24 hours'
               and not exists (select 1 from public.fortune_pulls f where f.checkin_id = c.id)), '[]'))
    from public.profiles pr where pr.id = auth.uid()
$function$
