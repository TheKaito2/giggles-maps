-- More landmark photos: up to 8 freely licensed Wikimedia Commons photos per Landmark/Icon (tier >= 3 with a Wikidata id),
-- from the place's Commons category (Wikidata P373) and main image (P18). place_photos keeps its one Wikimedia photo;
-- this table holds the others, each with what CC BY / BY-SA require us to show: author, licence (+ link) and source page.
-- The rows are made offline by supabase/tools/commons_photos.py into supabase/data/commons_photos_1..5.sql (8.4 MB in all:
-- too big for a migration, and `supabase db query` refuses bodies over ~5 MB, hence the parts); this migration is only the
-- table and its read RPC. Apply the parts after it, in order (part 1 empties the table; each part is one transaction):
--   for f in supabase/data/commons_photos_*.sql; do supabase db query --linked -f "$f"; done

create table public.place_commons_photos (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places on delete cascade,
  rank smallint not null,             -- order on the place page, 1 first (landscape first)
  file text not null,                 -- Commons file title, without "File:"
  url text not null,                  -- 1280 px thumbnail (the original when it is smaller)
  small_url text not null,            -- 500 px thumbnail, for the photo strip
  author text not null,
  licence text not null,              -- short name: CC BY-SA 4.0, CC0, Public domain...
  licence_url text,
  page_url text not null,             -- the file's Commons page (attribution link)
  width int not null,
  height int not null,
  unique (place_id, file)
);
create index place_commons_photos_place_idx on public.place_commons_photos (place_id, rank);
alter table public.place_commons_photos enable row level security;
create policy "commons photos are public" on public.place_commons_photos for select using (true);
revoke all on public.place_commons_photos from public, anon, authenticated;   -- loaded by the seed only
grant select on public.place_commons_photos to anon, authenticated;

-- up to 8 Commons photos of a place, for its page (after the owner's and travellers' photos); nothing for a locked place
create function public.place_commons_photos(p_place bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('url', c.url, 'small_url', c.small_url, 'author', c.author, 'licence', c.licence,
           'licence_url', c.licence_url, 'page_url', c.page_url, 'width', c.width, 'height', c.height) order by c.rank), '[]')
    from (select * from public.place_commons_photos c where c.place_id = p_place order by c.rank limit 8) c
   where exists (select 1 from public.places p where p.id = p_place and p.min_level <= public.unlock_level(auth.uid()))
$$;
revoke execute on function public.place_commons_photos(bigint) from public;
grant execute on function public.place_commons_photos(bigint) to anon, authenticated;
