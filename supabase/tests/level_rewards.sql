-- Level rewards, review shakes and place-photo coins (migration 072), checked on the linked database inside a transaction
-- that is rolled back, so nothing is kept:  supabase db query --linked -f supabase/tests/level_rewards.sql
-- Every row of the result should read ok = true.
begin;
create temp table t_out (k text, ok boolean, v text);
grant all on t_out to authenticated;
-- a throwaway traveller at level 3 (900 XP) with a stamp at one place and 4 uploaded photos
insert into auth.users (id, aud, role, is_anonymous) values ('00000000-0000-4000-8000-00000000c0de', 'authenticated', 'authenticated', true);
insert into public.profiles (id) values ('00000000-0000-4000-8000-00000000c0de') on conflict do nothing;
update public.profiles set xp = 900 where id = '00000000-0000-4000-8000-00000000c0de';
create temp table t_place as select id, location from public.places where tier = 2 limit 1;
grant select on t_place to authenticated;
with c as (insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, status)
           select '00000000-0000-4000-8000-00000000c0de', id, location, 5, 3, 'approved' from t_place returning id, place_id)
insert into public.stamps (user_id, place_id, checkin_id, tier, coins) select '00000000-0000-4000-8000-00000000c0de', place_id, id, 2, 10 from c;
insert into storage.objects (bucket_id, name, owner) select 'place-photos', '00000000-0000-4000-8000-00000000c0de/' || f, '00000000-0000-4000-8000-00000000c0de'
  from unnest(array['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']) f;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0de","role":"authenticated"}';
do $$
declare v_place bigint := (select id from t_place); r jsonb;
begin
  r := public.choose_level_perk(2, 'coins');
  insert into t_out values ('pick level 2 coins', (r->>'coins')::int = 1, r::text);
  r := public.choose_level_perk(3, 'luck');
  insert into t_out values ('pick level 3 luck', (r->>'luck')::int = 1 and (r->>'coins')::int = 1, r::text);
  begin perform public.choose_level_perk(4, 'luck'); insert into t_out values ('level 4 not reached', false, 'no error');
  exception when others then insert into t_out values ('level 4 not reached', sqlerrm = 'level_not_reached', sqlerrm); end;
  begin perform public.choose_level_perk(2, 'luck'); insert into t_out values ('pick twice', false, 'no error');
  exception when others then insert into t_out values ('pick twice', sqlerrm = 'already_chosen', sqlerrm); end;
  begin perform public.buy_item('frame', 'cloud-puff'); insert into t_out values ('buy a level item', false, 'no error');
  exception when others then insert into t_out values ('buy a level item', sqlerrm = 'level_reward', sqlerrm); end;
  begin insert into public.level_perks values (auth.uid(), 4, 'coins'); insert into t_out values ('write perks directly', false, 'no error');
  exception when others then insert into t_out values ('write perks directly', sqlstate = '42501', sqlerrm); end;

  r := public.write_review(v_place, 4, 'nice');
  insert into t_out values ('short review: XP, no shake', (r->>'xp')::int = 20 and not (r->>'shake')::boolean, r::text);
  r := public.write_review(v_place, 4, 'Lovely quiet spot with great coffee and plenty of shade by the pond.');
  insert into t_out values ('written review: a shake', (r->>'shake')::boolean, r::text);
  r := public.write_review(v_place, 5, 'Lovely quiet spot with great coffee and plenty of shade by the pond again.');
  insert into t_out values ('second written review: no shake', not (r->>'shake')::boolean, r::text);

  r := public.add_place_photo(v_place, auth.uid()::text || '/a.jpg');
  insert into t_out values ('first photo: 10 coins + 10% perk', (r->>'coins_earned')::int = 11, r::text);
  r := public.add_place_photo(v_place, auth.uid()::text || '/b.jpg');
  insert into t_out values ('second photo: no coins', (r->>'coins_earned')::int = 0, r::text);
  perform public.add_place_photo(v_place, auth.uid()::text || '/c.jpg');
  begin perform public.add_place_photo(v_place, auth.uid()::text || '/d.jpg'); insert into t_out values ('fourth photo', false, 'no error');
  exception when others then insert into t_out values ('fourth photo', sqlerrm = 'photo_limit', sqlerrm); end;
  begin perform public.add_place_photo(v_place, 'someone-else/x.jpg'); insert into t_out values ('photo in another folder', false, 'no error');
  exception when others then insert into t_out values ('photo in another folder', sqlerrm = 'bad_photo', sqlerrm); end;
  insert into t_out values ('photos on the place page',
    (select count(*) from jsonb_array_elements(public.place_page(v_place)->'photos') x where x->>'source' = 'traveller') = 3, null);
end $$;
reset role;
insert into t_out values ('level 2 cosmetic wearable, level 4 not',
  public.can_wear('00000000-0000-4000-8000-00000000c0de', 'frame', 'cloud-puff') and not public.can_wear('00000000-0000-4000-8000-00000000c0de', 'title', 'cloud-hopper'), null);
insert into public.weekly_awards (week, scope, user_id, rank, coins) values ('2000-01-03', 'everyone', '00000000-0000-4000-8000-00000000c0de', 1, 100);
insert into t_out select 'coin perk on a weekly award', coins = 110, coins::text from public.weekly_awards where week = '2000-01-03' and user_id = '00000000-0000-4000-8000-00000000c0de';
select k, ok, v from t_out;
rollback;
