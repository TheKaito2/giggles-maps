-- claiming or adding a shop issues its counter QR code (first scan = Verified shop)
create or replace function public.claim_shop(p_place bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_place public.places;
begin
  if not public.is_real_user() then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  select * into v_place from public.places where id = p_place and min_level = 0 for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if v_place.shop_id is not null then raise exception 'already_claimed' using errcode = 'P0001'; end if;
  if (select count(*) from public.shops where owner_id = auth.uid()) >= 10 then raise exception 'too_many_shops' using errcode = 'P0001'; end if;
  insert into public.shops (owner_id, name) values (auth.uid(), v_place.name) returning id into v_shop;
  update public.places set shop_id = v_shop, qr_code = coalesce(qr_code, public.new_code(6)) where id = p_place;
  return v_shop;
end;
$$;

create or replace function public.add_shop(p_name text, p_kind text, p_lat float8, p_lng float8, p_here_lat float8, p_here_lng float8)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_place bigint; v_cat text; v_detour boolean;
begin
  if not public.is_real_user() then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  if p_lat not between 5 and 21 or p_lng not between 97 and 106 or p_here_lat is null
     or extensions.st_distance(extensions.st_point(p_lng, p_lat)::extensions.geography,
                               extensions.st_point(p_here_lng, p_here_lat)::extensions.geography) > 100 then
    raise exception 'be_there' using errcode = 'P0001';
  end if;
  select category, detour into v_cat, v_detour from public.places where kind = p_kind group by category, detour order by count(*) desc limit 1;
  if v_cat is null then raise exception 'bad_kind' using errcode = 'P0001'; end if;
  if (select count(*) from public.shops where owner_id = auth.uid()) >= 10 then raise exception 'too_many_shops' using errcode = 'P0001'; end if;
  insert into public.shops (owner_id, name) values (auth.uid(), public.clean_name(p_name, 80)) returning id into v_shop;
  insert into public.places (name, category, kind, detour, location, source, shop_id, tier, local, otop, community, qr_code)
  values (public.clean_name(p_name, 80), v_cat, p_kind, v_detour, extensions.st_point(p_lng, p_lat)::extensions.geography, 'owner', v_shop, 1,
          v_cat in ('food', 'cafe', 'craft', 'market'), p_kind = 'otop', p_kind = 'community_enterprise', public.new_code(6))
  returning id into v_place;
  return v_place;
end;
$$;
