-- This week's set follows the calendar: Songkran led the shop in late October, with Loy Krathong (next month) buried.
CREATE OR REPLACE FUNCTION public.shop_today()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with d as (select (now() at time zone 'Asia/Bangkok')::date as day)
  select jsonb_build_object(
    'ends', ((select day from d) + 1)::timestamp at time zone 'Asia/Bangkok',
    'picks', (select jsonb_agg(jsonb_build_object('kind', kind, 'id', id)) from (
                select i.kind, i.id from public.shop_items i, d
                 where i.price > 0 and not i.plus and not i.gacha_only and i.price < 2000
                 order by md5(i.kind || i.id || d.day::text) limit 6) p),
    'sets', (select jsonb_agg(jsonb_build_object('id', s.id, 'name_en', s.name_en, 'name_th', s.name_th, 'blurb_en', s.blurb_en,
                     'items', to_jsonb(s.items),
                     'full', (select coalesce(sum(i.price), 0) from unnest(s.items) x join public.shop_items i
                               on i.kind = split_part(x, ':', 1) and i.id = substr(x, length(split_part(x, ':', 1)) + 2)),
                     'price', (select coalesce(sum(coins), 0) from public.set_missing(auth.uid(), s.id)))
                   -- the festival that's coming up leads: Loy Krathong in October-November, Songkran in March-April
                   order by (case when (s.id = 'loy-krathong' and extract(month from d.day) in (10, 11))
                                    or (s.id = 'songkran' and extract(month from d.day) in (3, 4)) then 0 else 1 end),
                            md5(s.id || extract(week from d.day)::text)) from public.shop_sets s, d))
$function$;
