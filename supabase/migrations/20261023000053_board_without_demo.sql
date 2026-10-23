-- The all-time leaderboard leaves demo mode out (anyone can fake a location there): ranks use XP minus what demo
-- check-ins earned (their stamps and their Siam Si shakes), and board cards count only non-demo stamps and provinces.
-- Your own profile still shows everything you earned.
-- ponytail: computed per player on every leaderboard read; keep a running column if the board gets big

create or replace function public.is_demo_checkin(p_checkin uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select (client->>'demo')::boolean from public.checkins where id = p_checkin), false)
$$;

create or replace function public.board_xp(p_user uuid) returns int
language sql stable set search_path = '' as $$
  select greatest(0, pr.xp
    - coalesce((select sum(s.xp) from public.stamps s where s.user_id = p_user and public.is_demo_checkin(s.checkin_id)), 0)
    - coalesce((select sum(f.xp) from public.fortune_pulls f where f.user_id = p_user and public.is_demo_checkin(f.checkin_id)), 0))::int
  from public.profiles pr where pr.id = p_user
$$;

-- a leaderboard card: the profile card with board XP and non-demo stamp counts
create or replace function public.board_card(p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select public.card_of(p_user) || jsonb_build_object(
    'xp', public.board_xp(p_user), 'level', public.level_for(public.board_xp(p_user)),
    'stamps', (select count(*) from public.stamps s where s.user_id = p_user and not public.is_demo_checkin(s.checkin_id)),
    'provinces', (select count(distinct s.province_id) from public.stamps s
                   where s.user_id = p_user and s.province_id is not null and not public.is_demo_checkin(s.checkin_id)))
$$;

create or replace function public.leaderboard() returns jsonb
language sql stable security definer set search_path = '' as $$
  with board as (
    select pr.id, public.board_xp(pr.id) as bxp from public.profiles pr where pr.on_leaderboard and pr.nickname is not null and pr.xp > 0
  ), ranked as (
    select id, rank() over (order by bxp desc) as rnk from board where bxp > 0
  )
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(public.board_card(t.id) || jsonb_build_object('rank', t.rnk) order by t.rnk, t.id)
             from (select * from ranked order by rnk, id limit 50) t), '[]'),
    'me', (select public.board_card(r.id) || jsonb_build_object('rank', r.rnk) from ranked r where r.id = auth.uid()),
    'total', (select count(*) from ranked))
$$;

create or replace function public.profile_of(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
    'badges', public.achievements(p_id));
end;
$$;

revoke execute on function public.is_demo_checkin(uuid), public.board_xp(uuid), public.board_card(uuid) from public, anon, authenticated;
