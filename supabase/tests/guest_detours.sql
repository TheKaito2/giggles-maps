-- Guest and free detour quotas (migration 073), on the linked database inside a rolled-back transaction:
--   supabase db query --linked -f supabase/tests/guest_detours.sql      (every row: ok = true)
begin;
insert into auth.users (id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000a0001', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000a0002', 'authenticated', 'authenticated', false);
create temp table t_out (k text, ok boolean, v text);
do $$
declare g uuid := '00000000-0000-4000-8000-0000000a0001'; f uuid := '00000000-0000-4000-8000-0000000a0002'; r text;
begin
  r := public.plan_allowed(g, false, 'A', 'A', false, true);  insert into t_out values ('guest: first destination', r = 'ok', r);
  r := public.plan_allowed(g, false, 'A', 'A', false, true);  insert into t_out values ('guest: same destination again (other time options)', r = 'ok', r);
  r := public.plan_allowed(g, false, 'B', 'B', false, true);  insert into t_out values ('guest: second destination', r = 'sign_in_required', r);
  r := public.plan_allowed(g, true, 'A|1', 'A', false, true); insert into t_out values ('guest: change 1', r = 'ok', r);
  r := public.plan_allowed(g, true, 'A|2', 'A', false, true); insert into t_out values ('guest: change 2', r = 'ok', r);
  r := public.plan_allowed(g, true, 'A|3', 'A', false, true); insert into t_out values ('guest: change 3', r = 'ok', r);
  r := public.plan_allowed(g, true, 'A|4', 'A', false, true); insert into t_out values ('guest: change 4', r = 'sign_in_required', r);
  r := public.plan_allowed(f, false, 'A', 'A', false);        insert into t_out values ('free: destination 1 (old 5-argument call)', r = 'ok', r);
  r := public.plan_allowed(f, false, 'B', 'B', false);        insert into t_out values ('free: destination 2', r = 'ok', r);
  r := public.plan_allowed(f, false, 'C', 'C', false);        insert into t_out values ('free: destination 3', r = 'ok', r);
  r := public.plan_allowed(f, false, 'D', 'D', false);        insert into t_out values ('free: destination 4', r = 'detour_limit', r);
  r := public.plan_allowed(f, false, 'D', 'D', true);         insert into t_out values ('member: no limit', r = 'ok', r);
end $$;
select k, ok, v from t_out;
rollback;
