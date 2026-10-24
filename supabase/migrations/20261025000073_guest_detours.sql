-- Guests can try the planner: one destination (all its time options) and 3 changes a day, then "sign in to plan more".
-- Before, guests met a sign-in wall before seeing a single plan. Fresh guest accounts to get around this are capped by
-- Supabase's per-IP limit on anonymous sign-ins (and the app makes one guest per visit), so the shared router stays safe.
drop function public.plan_allowed(uuid, boolean, text, text, boolean);
create function public.plan_allowed(p_user uuid, p_edit boolean, p_key text, p_dest text, p_member boolean, p_guest boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
  v_edit boolean;
  v_key text;
  v_kind text;
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
  v_kind := case when v_edit then 'edit' else 'detour' end;
  if not p_member and not exists (select 1 from public.plan_usage where user_id = p_user and day = v_day and kind = v_kind and key = v_key) then
    if p_guest then
      -- a guest's taste of it: 1 destination and 3 changes a day
      if (select count(distinct key) from public.plan_usage where user_id = p_user and day = v_day and kind = v_kind) >= (case when v_edit then 3 else 1 end) then
        return 'sign_in_required';
      end if;
    else
      select * into v_allow from public.plan_allowance(p_user);
      if (select count(distinct key) from public.plan_usage where user_id = p_user and day = v_day and kind = v_kind)
          >= (case when v_edit then v_allow.edits else v_allow.detours end) then
        return case when v_edit then 'edit_limit' else 'detour_limit' end;
      end if;
    end if;
  end if;
  insert into public.plan_usage (user_id, day, kind, key) values (p_user, v_day, v_kind, v_key);
  return 'ok';
end $$;
revoke execute on function public.plan_allowed(uuid, boolean, text, text, boolean, boolean) from public, anon, authenticated;
