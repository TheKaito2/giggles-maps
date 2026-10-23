-- 53 early OpenStreetMap places still carried the 4.2 placeholder from the first schema's column default. They have no
-- reviews, so the rating was invented: it showed as "★ 4.2" and ranked them above honestly unrated places.
update public.places p set rating = null
 where p.rating = 4.2 and p.source = 'osm'
   and not exists (select 1 from public.reviews r where r.place_id = p.id);
