-- Place page: reviews (verified visits only), photos (Wikimedia, public check-in photos, owners later), saved lists,
-- busy times from check-ins, and suggested edits / missing places reviewed by an admin.

alter table public.profiles add column is_admin boolean not null default false;
alter table public.checkins add column public_photo boolean not null default false;

-- ---------- reviews: only people who checked in at the place ----------
create table public.reviews (
  user_id uuid not null references auth.users on delete cascade,
  place_id bigint not null references public.places on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(body) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index reviews_place_idx on public.reviews (place_id, updated_at desc);
alter table public.reviews enable row level security;

create table public.review_reports (
  review_user uuid not null, place_id bigint not null, reporter uuid not null references auth.users on delete cascade,
  reason text check (char_length(reason) <= 200), created_at timestamptz not null default now(),
  primary key (review_user, place_id, reporter),
  foreign key (review_user, place_id) references public.reviews on delete cascade
);
alter table public.review_reports enable row level security;

-- the planner rating: the review average once a place has 3 reviews
create or replace function public.reviews_to_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_place bigint := coalesce(new.place_id, old.place_id); v_n int; v_avg numeric;
begin
  select count(*), avg(rating) into v_n, v_avg from public.reviews where place_id = v_place;
  if v_n >= 3 then update public.places set rating = round(v_avg, 1) where id = v_place; end if;
  return null;
end;
$$;
create trigger reviews_rating after insert or update or delete on public.reviews
  for each row execute function public.reviews_to_rating();

create or replace function public.write_review(p_place bigint, p_rating int, p_body text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_first boolean;
begin
  if not exists (select 1 from public.checkins where user_id = auth.uid() and place_id = p_place and status <> 'rejected') then
    raise exception 'check_in_first' using errcode = 'P0001';
  end if;
  if p_rating not between 1 and 5 then raise exception 'bad_rating' using errcode = 'P0001'; end if;
  v_first := not exists (select 1 from public.reviews where user_id = auth.uid() and place_id = p_place);
  insert into public.reviews (user_id, place_id, rating, body)
  values (auth.uid(), p_place, p_rating, left(nullif(trim(p_body), ''), 1000))
  on conflict (user_id, place_id) do update set rating = excluded.rating, body = excluded.body, updated_at = now();
  if v_first then update public.profiles set xp = xp + 20 where id = auth.uid(); end if;
end;
$$;

create or replace function public.delete_review(p_place bigint) returns void
language sql security definer set search_path = '' as $$
  delete from public.reviews where user_id = auth.uid() and place_id = p_place
$$;

create or replace function public.report_review(p_user uuid, p_place bigint, p_reason text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.review_reports (review_user, place_id, reporter, reason)
  values (p_user, p_place, auth.uid(), left(p_reason, 200)) on conflict do nothing
$$;

-- ---------- photos ----------
create table public.place_photos (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places on delete cascade,
  source text not null check (source in ('wikimedia', 'owner')),
  url text not null,
  credit text,
  licence text,
  created_at timestamptz not null default now()
);
create index place_photos_place_idx on public.place_photos (place_id);
alter table public.place_photos enable row level security;
create policy "place photos are public" on public.place_photos for select using (true);

create or replace function public.set_public_photo(p_checkin uuid, p_public boolean) returns void
language sql security definer set search_path = '' as $$
  update public.checkins set public_photo = p_public where id = p_checkin and user_id = auth.uid()
$$;

-- public check-in photos can be opened by anyone signed in
create or replace function public.can_see_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.checkins c
     where c.selfie_path = p_path and not c.photo_hidden and c.status <> 'rejected'
       and (c.public_photo or public.is_friend(auth.uid(), c.user_id)
            or exists (select 1 from public.trips t
                         join public.trip_members a on a.trip_id = t.id and a.user_id = auth.uid() and a.left_at is null
                         join public.trip_members b on b.trip_id = t.id and b.user_id = c.user_id
                        where t.ended_at is null and t.ends_at > now()
                          and c.created_at >= b.joined_at and (b.left_at is null or c.created_at <= b.left_at))))
$$;

-- ---------- saved lists ----------
create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  shared boolean not null default false,
  created_at timestamptz not null default now()
);
create index lists_user_idx on public.lists (user_id);
create table public.list_places (
  list_id uuid not null references public.lists on delete cascade,
  place_id bigint not null references public.places on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, place_id)
);
alter table public.lists enable row level security;
alter table public.list_places enable row level security;

-- my lists (the two defaults are made on first use), each with its places
create or replace function public.my_lists() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.lists where user_id = auth.uid()) then
    insert into public.lists (user_id, name) values (auth.uid(), 'Want to go'), (auth.uid(), 'Favourites');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'shared', l.shared,
           'places', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category,
                       'lat', extensions.st_y(p.location::extensions.geometry), 'lng', extensions.st_x(p.location::extensions.geometry))
                       order by lp.added_at desc)
                     from public.list_places lp join public.places p on p.id = lp.place_id where lp.list_id = l.id), '[]'))
           order by l.created_at)
         from public.lists l where l.user_id = auth.uid()), '[]');
end;
$$;

create or replace function public.save_place(p_list uuid, p_place bigint, p_saved boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.lists where id = p_list and user_id = auth.uid()) then
    raise exception 'not_your_list' using errcode = 'P0001';
  end if;
  if p_saved then
    insert into public.list_places (list_id, place_id) values (p_list, p_place) on conflict do nothing;
  else
    delete from public.list_places where list_id = p_list and place_id = p_place;
  end if;
end;
$$;

create or replace function public.create_list(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select count(*) from public.lists where user_id = auth.uid()) >= 30 then raise exception 'too_many_lists' using errcode = 'P0001'; end if;
  insert into public.lists (user_id, name) values (auth.uid(), public.clean_name(p_name, 40)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_list(p_list uuid, p_name text default null, p_shared boolean default null, p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_delete then delete from public.lists where id = p_list and user_id = auth.uid(); return; end if;
  update public.lists set name = coalesce(public.clean_name(p_name, 40), name), shared = coalesce(p_shared, shared)
   where id = p_list and user_id = auth.uid();
end;
$$;

-- a friend shared list
create or replace function public.friend_lists(p_friend uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
           'places', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category,
                       'lat', extensions.st_y(p.location::extensions.geometry), 'lng', extensions.st_x(p.location::extensions.geometry)))
                     from public.list_places lp join public.places p on p.id = lp.place_id where lp.list_id = l.id), '[]'))), '[]')
    from public.lists l where l.user_id = p_friend and l.shared and public.is_friend(auth.uid(), p_friend)
$$;

-- ---------- suggested edits and missing places ----------
create table public.place_edits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  place_id bigint references public.places on delete cascade,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index place_edits_pending_idx on public.place_edits (created_at) where status = 'pending';
alter table public.place_edits enable row level security;

-- payload keys allowed: name, name_th, kind, opening_hours, phone, website, closed (and lat, lng for a new place)
create or replace function public.suggest_edit(p_place bigint, p_payload jsonb, p_here_lat float8 default null, p_here_lng float8 default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_clean jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 2000 then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  select coalesce(jsonb_object_agg(key, value), '{}') into v_clean from jsonb_each(p_payload)
   where key in ('name', 'name_th', 'kind', 'opening_hours', 'phone', 'website', 'closed', 'lat', 'lng');
  if v_clean = '{}'::jsonb then raise exception 'bad_edit' using errcode = 'P0001'; end if;
  if v_clean ? 'kind' and not exists (select 1 from public.places where kind = v_clean->>'kind' limit 1) then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if p_place is null then
    -- a missing place: you must be standing within 100 m of where you pin it
    if not (v_clean ? 'name' and v_clean ? 'kind' and v_clean ? 'lat' and v_clean ? 'lng') or p_here_lat is null
       or extensions.st_distance(extensions.st_point((v_clean->>'lng')::float8, (v_clean->>'lat')::float8)::extensions.geography,
                                 extensions.st_point(p_here_lng, p_here_lat)::extensions.geography) > 100 then
      raise exception 'be_there' using errcode = 'P0001';
    end if;
  end if;
  if (select count(*) from public.place_edits where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_edits' using errcode = 'P0001';
  end if;
  insert into public.place_edits (user_id, place_id, payload) values (auth.uid(), p_place, v_clean);
end;
$$;

create or replace function public.admin_edits() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'place_id', e.place_id, 'payload', e.payload, 'at', e.created_at,
           'who', public.who_of(e.user_id), 'place', (select jsonb_build_object('name', p.name, 'kind', p.kind, 'opening_hours', p.opening_hours,
             'phone', p.phone, 'website', p.website) from public.places p where p.id = e.place_id)) order by e.created_at)
         from public.place_edits e where e.status = 'pending'), '[]');
end;
$$;

create or replace function public.review_edit(p_edit bigint, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.place_edits; v_kind text; v_cat text; v_detour boolean;
begin
  if not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then raise exception 'admins_only' using errcode = 'P0001'; end if;
  select * into e from public.place_edits where id = p_edit and status = 'pending' for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.place_edits set status = case when p_approve then 'approved' else 'rejected' end, reviewed_at = now() where id = p_edit;
  if not p_approve then return; end if;
  v_kind := e.payload->>'kind';
  if v_kind is not null then
    select category, detour into v_cat, v_detour from public.places where kind = v_kind group by category, detour order by count(*) desc limit 1;
  end if;
  if e.place_id is null then
    insert into public.places (name, name_th, category, kind, detour, location, source, opening_hours, phone, website, tier)
    values (e.payload->>'name', e.payload->>'name_th', v_cat, v_kind, v_detour,
            extensions.st_point((e.payload->>'lng')::float8, (e.payload->>'lat')::float8)::extensions.geography, 'team',
            e.payload->>'opening_hours', e.payload->>'phone', e.payload->>'website', 1);
  elsif coalesce((e.payload->>'closed')::boolean, false) then
    delete from public.places where id = e.place_id and not exists (select 1 from public.stamps where place_id = e.place_id);
    update public.places set min_level = 10, detour = false where id = e.place_id;   -- stamped places stay for passports, hidden from the map
  else
    update public.places set name = coalesce(e.payload->>'name', name), name_th = coalesce(e.payload->>'name_th', name_th),
           kind = coalesce(v_kind, kind), category = coalesce(v_cat, category), detour = coalesce(v_detour, detour),
           opening_hours = coalesce(e.payload->>'opening_hours', opening_hours), phone = coalesce(e.payload->>'phone', phone),
           website = coalesce(e.payload->>'website', website)
     where id = e.place_id;
  end if;
  update public.profiles set xp = xp + 50 where id = e.user_id;
end;
$$;

create or replace function public.achievements(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with v as (
    select
      (select count(distinct province_id) from public.stamps where user_id = p_user and province_id is not null)::int as provinces,
      (select count(*) from public.stamps where user_id = p_user and tier = 3)::int as landmarks,
      (select count(*) from public.stamps where user_id = p_user)::int as stamps,
      (select count(*) from public.checkins where user_id = p_user and status <> 'rejected' and selfie_path is not null)::int as photos,
      (select count(*) from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_user and pl.category = 'food')::int as food,
      (select count(*) from public.stamps st join public.places pl on pl.id = st.place_id where st.user_id = p_user and pl.category = 'temple')::int as temples,
      (select count(*) from public.friendships where p_user in (a, b))::int as friends,
      (select count(distinct m.trip_id) from public.trip_members m
        where m.user_id = p_user and exists (select 1 from public.trip_members o where o.trip_id = m.trip_id and o.user_id <> p_user))::int as crew,
      (select count(*) from public.challenge_claims where user_id = p_user)::int as quests,
      (select public.level_for(xp) from public.profiles where id = p_user) as lvl,
      (select count(*) from public.place_edits where user_id = p_user and status = 'approved')::int as edits
  ),
  b (slug, name_en, name_th, icon, val, goals, ord) as (
    select 'province-hopper', 'Province Hopper', 'นักเก็บจังหวัด', 'map', provinces, array[1, 5, 15, 40, 77], 1 from v union all
    select 'landmark-hunter', 'Landmark Hunter', 'นักล่าแลนด์มาร์ก', 'landmark', landmarks, array[1, 5, 15, 40, 100], 2 from v union all
    select 'collector', 'Collector', 'นักสะสม', 'stamp', stamps, array[5, 25, 75, 200, 500], 3 from v union all
    select 'shutterbug', 'Shutterbug', 'ตากล้อง', 'camera', photos, array[1, 10, 50, 150, 400], 4 from v union all
    select 'foodie', 'Foodie', 'นักชิม', 'utensils', food, array[1, 10, 30, 75, 150], 5 from v union all
    select 'temple-runner', 'Temple Runner', 'สายบุญ', 'temple', temples, array[1, 10, 30, 75, 150], 6 from v union all
    select 'social-butterfly', 'Social Butterfly', 'ผีเสื้อสังคม', 'users', friends, array[1, 3, 10, 25, 50], 7 from v union all
    select 'road-crew', 'Road Crew', 'แก๊งโรดทริป', 'car', crew, array[1, 3, 10, 25, 50], 8 from v union all
    select 'quest-master', 'Quest Master', 'เจ้าแห่งเควสต์', 'trophy', quests, array[5, 25, 100, 250, 500], 9 from v union all
    select 'high-flyer', 'High Flyer', 'เลเวลสูง', 'star', lvl, array[2, 4, 6, 8, 10], 10 from v union all
    select 'map-maker', 'Map Maker', 'นักทำแผนที่', 'pin', edits, array[1, 5, 20, 50, 150], 11 from v
  )
  select jsonb_agg(jsonb_build_object('slug', slug, 'name_en', name_en, 'name_th', name_th, 'icon', icon, 'value', val,
           'tier', (select count(*) from unnest(goals) g where val >= g), 'goals', to_jsonb(goals),
           'next', goals[least(5, 1 + (select count(*) from unnest(goals) g where val >= g))::int]) order by ord)
    from b
$$;
revoke execute on function public.achievements(uuid) from public, anon, authenticated;

-- ---------- the place page ----------
create or replace function public.place_page(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'name_th', p.name_th, 'kind', p.kind, 'category', p.category, 'tier', p.tier,
    'lat', extensions.st_y(p.location::extensions.geometry), 'lng', extensions.st_x(p.location::extensions.geometry),
    'opening_hours', p.opening_hours, 'phone', p.phone, 'website', p.website, 'address', p.address,
    'local', p.local, 'otop', p.otop, 'community', p.community, 'detour', p.detour,
    'rating', (select round(avg(rating), 1) from public.reviews r where r.place_id = p.id having count(*) >= 3),
    'review_count', (select count(*) from public.reviews r where r.place_id = p.id),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('who', public.who_of(r.user_id), 'rating', r.rating, 'body', r.body,
                 'at', r.updated_at, 'mine', r.user_id = auth.uid()) order by r.updated_at desc)
               from (select * from public.reviews r where r.place_id = p.id order by r.updated_at desc limit 20) r), '[]'),
    'checked_in', exists (select 1 from public.checkins c where c.user_id = auth.uid() and c.place_id = p.id and c.status <> 'rejected'),
    'stamped', exists (select 1 from public.stamps s where s.user_id = auth.uid() and s.place_id = p.id),
    'photos', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('url', ph.url, 'credit', ph.credit, 'licence', ph.licence, 'source', ph.source) x
                   from public.place_photos ph where ph.place_id = p.id
                 union all
                 select jsonb_build_object('path', c.selfie_path, 'credit', coalesce(pr.nickname, 'Explorer'), 'source', 'checkin')
                   from public.checkins c join public.profiles pr on pr.id = c.user_id
                  where c.place_id = p.id and c.public_photo and not c.photo_hidden and c.status <> 'rejected' and c.selfie_path is not null
                  limit 30) y), '[]'),
    'busy', (select case when count(*) >= 20 then jsonb_agg(n order by h) end from (
               select h, (select count(*) from public.checkins c where c.place_id = p.id and c.status <> 'rejected'
                           and extract(isodow from c.created_at at time zone 'Asia/Bangkok') = extract(isodow from now() at time zone 'Asia/Bangkok')
                           and extract(hour from c.created_at at time zone 'Asia/Bangkok') = h) n
                 from generate_series(6, 23) h) hist),
    'saved_in', coalesce((select jsonb_agg(lp.list_id) from public.list_places lp join public.lists l on l.id = lp.list_id
                          where lp.place_id = p.id and l.user_id = auth.uid()), '[]'))
  from public.places p where p.id = p_id and p.min_level <= public.unlock_level(auth.uid())
$$;

-- ---------- grants ----------
revoke execute on function public.write_review(bigint, int, text), public.delete_review(bigint), public.report_review(uuid, bigint, text),
  public.set_public_photo(uuid, boolean), public.my_lists(), public.save_place(uuid, bigint, boolean), public.create_list(text),
  public.update_list(uuid, text, boolean, boolean), public.friend_lists(uuid), public.suggest_edit(bigint, jsonb, float8, float8),
  public.admin_edits(), public.review_edit(bigint, boolean), public.place_page(bigint) from public, anon;
grant execute on function public.write_review(bigint, int, text), public.delete_review(bigint), public.report_review(uuid, bigint, text),
  public.set_public_photo(uuid, boolean), public.my_lists(), public.save_place(uuid, bigint, boolean), public.create_list(text),
  public.update_list(uuid, text, boolean, boolean), public.friend_lists(uuid), public.suggest_edit(bigint, jsonb, float8, float8),
  public.admin_edits(), public.review_edit(bigint, boolean), public.place_page(bigint) to authenticated;
revoke execute on function public.reviews_to_rating() from public, anon, authenticated;
