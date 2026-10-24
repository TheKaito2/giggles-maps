-- Code review of tonight's changes (25 Oct):
-- * guests: at most 20 plans a day (each a guest's one destination and a few changes), so throwaway guests can't drive
--   the shared router with 100 plans each
-- * place photos: hidden photos and uploaders' ids are no longer readable straight from the table (the app reads photos
--   through place_page only); the public bucket takes at most 60 files per account (it was open image hosting for guests)
-- * reports need a stamp at the place; a review's shake is only announced when one was really added (cap of 5)
-- * a claimed quest's chest shows the coins actually paid, after coin perks
create or replace function public.plan_allowed(p_user uuid, p_edit boolean, p_key text, p_dest text, p_member boolean, p_guest boolean default false)
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
  -- a day: 300 for members, 100 for free accounts, 20 for a guest (its one destination's time options and a few changes)
  if (select count(*) from public.plan_usage where user_id = p_user and day = v_day) >= (case when p_member then 300 when p_guest then 20 else 100 end) then return 'slow_down'; end if;
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

create or replace function public.write_review(p_place bigint, p_rating int, p_body text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_xp int := 0; v_shake boolean := false; v_before int;
begin
  if not exists (select 1 from public.checkins where user_id = auth.uid() and place_id = p_place and status = 'approved') then
    raise exception 'check_in_first' using errcode = 'P0001';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'bad_rating' using errcode = 'P0001'; end if;
  insert into public.reviews (user_id, place_id, rating, body)
  values (auth.uid(), p_place, p_rating, left(nullif(trim(p_body), ''), 1000))
  on conflict (user_id, place_id) do update set rating = excluded.rating, body = excluded.body, updated_at = now();
  insert into public.review_xp values (auth.uid(), p_place) on conflict do nothing;
  if found then update public.profiles set xp = xp + 20 where id = auth.uid(); v_xp := 20; end if;
  -- a couple of real sentences about the place (not just stars) earn one bonus shake per place, ever
  if char_length(coalesce(trim(p_body), '')) >= 60 then
    insert into public.review_shakes values (auth.uid(), p_place) on conflict do nothing;
    if found then
      -- only say "+1 shake" when one was added (bonus shakes are kept up to 5)
      v_before := coalesce((select balance from public.fortune_tickets where user_id = auth.uid()), 0);
      perform public.grant_fortune_ticket(auth.uid());
      v_shake := coalesce((select balance from public.fortune_tickets where user_id = auth.uid()), 0) > v_before;
    end if;
  end if;
  return jsonb_build_object('xp', v_xp, 'shake', v_shake,
    'tickets', coalesce((select balance from public.fortune_tickets where user_id = auth.uid()), 0));
end;
$$;

create or replace function public.claim_quest(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c record; v_before int; v_after int;
  v_plus boolean := exists (select 1 from public.profiles where id = auth.uid() and plus_until > now());
  v_member boolean := exists (select 1 from public.profiles where id = auth.uid() and member_since is not null);
  v_coins int;
begin
  select * into c from public.challenge_progress(auth.uid()) p where p.slug = p_slug and p.have >= p.need and not p.claimed limit 1;
  if not found then raise exception 'not_ready' using errcode = 'P0001'; end if;
  v_coins := case when v_plus then round(c.coins * 1.25) else c.coins end;
  select xp into v_before from public.profiles where id = auth.uid() for update;
  -- returning: the coins actually paid, after the coin perks' trigger (the chest showed the amount before it)
  insert into public.challenge_claims (user_id, slug, period, xp, coins) values (auth.uid(), c.slug, c.period, c.xp, v_coins) on conflict do nothing
  returning coins into v_coins;
  if not found then raise exception 'not_ready' using errcode = 'P0001'; end if;   -- claimed a moment ago
  update public.profiles set xp = xp + c.xp where id = auth.uid() returning xp into v_after;
  perform public.grant_fortune_ticket(auth.uid());   -- each finished quest: a bonus Siam Si shake
  insert into public.activity (user_id, kind, data)
  values (auth.uid(), 'challenge', jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', v_coins));
  if public.level_for(v_after) > public.level_for(v_before) then
    insert into public.activity (user_id, kind, data) values (auth.uid(), 'level', jsonb_build_object('level', public.level_for(v_after)));
  end if;
  return jsonb_build_object('slug', c.slug, 'title', c.title_en, 'title_th', c.title_th, 'xp', c.xp, 'coins', v_coins, 'member', v_member,
    'level', public.level_for(v_after), 'level_up', public.level_for(v_after) > public.level_for(v_before),
    'fortune_tickets', coalesce((select balance from public.fortune_tickets where user_id = auth.uid()), 0));
end;
$$;

create or replace function public.report_place_photo(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  -- only people who have been there can report (three fresh guests could hide anyone's photo before)
  insert into public.place_photo_reports (photo_id, reporter)
  select ph.id, auth.uid() from public.place_photos ph
   where ph.id = p_id and ph.source = 'traveller' and ph.user_id is distinct from auth.uid()
     and exists (select 1 from public.stamps s where s.user_id = auth.uid() and s.place_id = ph.place_id)
  on conflict do nothing;
  update public.place_photos set hidden = true
   where id = p_id and (select count(*) from public.place_photo_reports where photo_id = p_id) >= 3;
end;
$$;

drop policy "place photos are public" on public.place_photos;
create policy "place photos are public unless hidden" on public.place_photos for select using (not hidden);
revoke all on public.place_photos from anon, authenticated;   -- read through place_page (definer); written by RPCs only

-- how many files you already keep in the place-photos bucket (definer: the policy's own row security can't hide them)
create or replace function public.place_photo_files() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects where bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text
$$;
revoke execute on function public.place_photo_files() from public, anon;
grant execute on function public.place_photo_files() to authenticated;
drop policy "travellers upload place photos" on storage.objects;
create policy "travellers upload place photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.place_photo_files() < 60);
