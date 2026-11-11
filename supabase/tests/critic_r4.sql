-- Migration 093: demo check-ins never progress quests (stamps from a demo check-in don't count, the daily check-in quest
-- needs a real one), and record_checkin_v5 takes the traveller's lock before reading badges. Checked on the linked
-- database inside a transaction that is rolled back, so nothing is kept:
--   supabase db query --linked -f supabase/tests/critic_r4.sql
-- Every row of the result should read ok = true.
begin;
create temp table t_out (k text, ok boolean, v text);
insert into auth.users (id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000de731', 'authenticated', 'authenticated', false),   -- demo traveller
  ('00000000-0000-4000-8000-0000000de732', 'authenticated', 'authenticated', false);   -- real traveller (control)
insert into public.profiles (id) select ('00000000-0000-4000-8000-0000000de73' || n)::uuid from generate_series(1, 2) n on conflict do nothing;
-- five landmarks of one province: its province quest needs exactly these
create temp table t_lm as
  select p.id, p.province_id, p.tier, p.location from public.places p
   where p.tier >= 3 and p.province_id = (select province_id from public.places where tier >= 3 and province_id is not null
                                            group by province_id having count(*) >= 5 order by province_id limit 1)
   order by p.id limit 5;
insert into t_out select 'setup: five landmarks in one province', count(*) = 5, null from t_lm;
-- each traveller: an approved check-in today and a stamp at each landmark; de731's are demo, de732's real
with u(uid, demo) as (values ('00000000-0000-4000-8000-0000000de731'::uuid, true), ('00000000-0000-4000-8000-0000000de732'::uuid, false)),
c as (
  insert into public.checkins (user_id, place_id, location, accuracy_m, distance_m, client, status, rewarded)
  select u.uid, l.id, l.location, 5, 0, jsonb_build_object('demo', u.demo), 'approved', true from u, t_lm l
  returning id, user_id, place_id)
insert into public.stamps (user_id, place_id, checkin_id, tier, province_id, xp, coins)
  select c.user_id, c.place_id, c.id, l.tier, l.province_id, 150, 30 from c join t_lm l on l.id = c.place_id;

insert into t_out select 'demo: province quest not shown or 0', coalesce(max(have), 0) = 0, max(have)::text
  from public.challenge_progress('00000000-0000-4000-8000-0000000de731') where kind = 'province';
insert into t_out select 'demo: daily check-in not done', have = 0, have::text
  from public.challenge_progress('00000000-0000-4000-8000-0000000de731') where slug = 'daily-checkin';
insert into t_out select 'demo: weekly landmarks 0', have = 0, have::text
  from public.challenge_progress('00000000-0000-4000-8000-0000000de731') where slug = 'weekly-landmarks';
insert into t_out select 'real: province quest done (control)', bool_or(have >= need and need = 5), string_agg(have || '/' || need, ',')
  from public.challenge_progress('00000000-0000-4000-8000-0000000de732') where kind = 'province';
insert into t_out select 'real: daily check-in done (control)', have = 1, have::text
  from public.challenge_progress('00000000-0000-4000-8000-0000000de732') where slug = 'daily-checkin';
insert into t_out select 'real: weekly landmarks 3/3 (control)', have = 3, have::text
  from public.challenge_progress('00000000-0000-4000-8000-0000000de732') where slug = 'weekly-landmarks';

-- claim_quest as each traveller: demo gets not_ready, real gets the province quest
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000de731", "role": "authenticated"}', true);
do $$
declare s text := 'province-' || (select iso from public.provinces where id = (select province_id from t_lm limit 1));
begin
  begin
    perform public.claim_quest(s);
    insert into t_out values ('demo: claim_quest refused', false, 'claimed');
  exception when others then
    insert into t_out values ('demo: claim_quest refused', sqlerrm = 'not_ready', sqlerrm);
  end;
end $$;
insert into t_out select 'demo: claim_challenges claims nothing', public.claim_challenges('00000000-0000-4000-8000-0000000de731') = '[]'::jsonb, null;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000de732", "role": "authenticated"}', true);
insert into t_out select 'real: claim_quest pays 500 XP (control)', (r->>'xp')::int = 500, r::text
  from (select public.claim_quest('province-' || (select iso from public.provinces where id = (select province_id from t_lm limit 1)))) x(r);

-- record_checkin_v5: the lock comes before the badge snapshot
insert into t_out values ('v5: lock before badge snapshot',
  pg_get_functiondef('public.record_checkin_v5'::regproc) like '%begin%
  perform 1 from public.profiles where id = p_user for update;
  v_badges_before := public.achievements(p_user);%', null);
select * from t_out;
rollback;
