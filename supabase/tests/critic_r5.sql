-- Migration 094: demo mode never reaches the ride-along bonus, a real visit over a demo stamp counts its XP once, a demo stamp
-- doesn't use up a real new province, and shared trips label paid stops. Checked on the linked database, rolled back:
--   supabase db query --linked -f supabase/tests/critic_r5.sql
-- Every row of the result should read ok = true.
begin;
create temp table t_out (k text, ok boolean, v text);
insert into t_out values
  ('group_partner_here ignores demo check-ins', pg_get_functiondef('public.group_partner_here'::regproc) like '%(c.client->>''demo'')::boolean%', null),
  ('v5: no group branch in demo mode', pg_get_functiondef('public.record_checkin_v5'::regproc) like '%if v_trip is not null and not v_demo then%', null),
  ('v5: demo partner stamps get no bonus', pg_get_functiondef('public.record_checkin_v5'::regproc) like '%st.earned_at >= m.joined_at and not public.is_demo_checkin(st.checkin_id)%', null),
  ('v5: replaced demo XP comes off', pg_get_functiondef('public.record_checkin_v5'::regproc) like '%xp + v_xp - v_replaced_xp%', null),
  ('v5: demo stamp keeps the new province', pg_get_functiondef('public.record_checkin_v5'::regproc) like '%(v_demo or not public.is_demo_checkin(checkin_id))%', null),
  ('shared trip stops carry partner fields', pg_get_functiondef('public.view_shared_trip'::regproc) like '%partner_tier%', null);
select * from t_out;
rollback;
