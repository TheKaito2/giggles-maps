-- Demo mode's pretend partners: in demo mode (only), these real places show a Partner / Giggles Choice badge and members'
-- demo plans treat them as paid. Nothing here touches real ranking: plan-route reads this table only for requests marked demo,
-- and places_tiers (what real users see) never looks at it. The shops themselves have not signed up.
create table public.demo_partners (
  place_id bigint primary key references public.places on delete cascade,
  tier text not null check (tier in ('partner', 'choice'))
);
alter table public.demo_partners enable row level security;
create policy "anyone reads demo partners" on public.demo_partners for select using (true);

-- the places Giggles Maps shows most on routes around Bangkok and Sakon Nakhon (where demo mode starts): cafés, food,
-- markets and craft shops; the best quarter by how often they're shown are Giggles Choice
with shown as (
  select p.id, count(*) n,
         case when extensions.st_dwithin(p.location, extensions.st_point(100.5018, 13.7563)::extensions.geography, 20000) then 'bkk' else 'sakon' end area
    from public.route_stops s join public.places p on p.id = s.place_id
   where p.category in ('cafe', 'food', 'market', 'craft')
     and (extensions.st_dwithin(p.location, extensions.st_point(100.5018, 13.7563)::extensions.geography, 20000)
       or extensions.st_dwithin(p.location, extensions.st_point(104.149, 17.163)::extensions.geography, 15000))
   group by p.id, area
), ranked as (
  select id, area, row_number() over (partition by area order by n desc, id) r from shown
)
insert into public.demo_partners (place_id, tier)
select id, case when r % 4 = 1 then 'choice' else 'partner' end
  from ranked where (area = 'bkk' and r <= 32) or (area = 'sakon' and r <= 12);
