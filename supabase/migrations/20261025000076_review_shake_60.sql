-- Review shakes ask for 60 characters (was 20): "Nice temple, very good" earned a shake, which pays for junk reviews and
-- weakens the one thing reviews here promise (verified visits). Consumer review, 25 Oct.
create or replace function public.write_review(p_place bigint, p_rating int, p_body text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_xp int := 0; v_shake boolean := false;
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
    if found then perform public.grant_fortune_ticket(auth.uid()); v_shake := true; end if;
  end if;
  return jsonb_build_object('xp', v_xp, 'shake', v_shake,
    'tickets', coalesce((select balance from public.fortune_tickets where user_id = auth.uid()), 0));
end;
$$;
