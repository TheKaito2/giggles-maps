-- The shop pitch (docs/UPDATE-PLAN.md section 4).
-- shop_reach: adds visit_rate, how often a stop shown on a Giggles route was then visited (approved, non-demo check-ins
--   over stop impressions, all places, last 30 days), so the return calculator's visit estimate comes from real data.
-- sponsor_leads: the "for provinces and brands" contact form (sponsored quests). Anyone may send one; nobody but the
--   service role reads them; at most 50 a day in total, so a script can't flood it.

create or replace function public.shop_reach(p_place bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', p.name,
    'shown_30d', (select count(*) from public.route_stops s where s.place_id = p.id and s.shown_at > now() - interval '30 days'),
    'trips_near_30d', (select count(*) from public.routes r where r.created_at > now() - interval '30 days'
                         and (extensions.st_dwithin(r.origin, p.location, 20000) or extensions.st_dwithin(r.dest, p.location, 20000))),
    'visit_rate', (select round(
        (select count(*) from public.checkins c where c.status = 'approved' and not coalesce((c.client->>'demo')::boolean, false)
           and c.created_at > now() - interval '30 days')::numeric
        / nullif((select count(*) from public.route_stops s where s.kind = 'stop' and s.shown_at > now() - interval '30 days'), 0), 4)))
  from public.places p where p.id = p_place
$$;

create table if not exists public.sponsor_leads (
  id bigserial primary key,
  org text not null check (char_length(org) between 2 and 120),
  contact text not null check (char_length(contact) between 3 and 160),
  message text check (char_length(message) <= 1000),
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sponsor_leads enable row level security;   -- no policies: read through the service role only
revoke all on public.sponsor_leads from anon, authenticated;

create or replace function public.send_sponsor_lead(p_org text, p_contact text, p_message text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_org, ''))) < 2 or char_length(btrim(coalesce(p_contact, ''))) < 3 then
    raise exception 'missing_fields' using errcode = 'P0001';
  end if;
  if (select count(*) from public.sponsor_leads where created_at > now() - interval '1 day') >= 50 then
    raise exception 'try_tomorrow' using errcode = 'P0001';
  end if;
  insert into public.sponsor_leads (org, contact, message, user_id)
  values (left(btrim(p_org), 120), left(btrim(p_contact), 160), nullif(left(btrim(coalesce(p_message, '')), 1000), ''), auth.uid());
end $$;
revoke execute on function public.send_sponsor_lead(text, text, text) from public;
grant execute on function public.send_sponsor_lead(text, text, text) to anon, authenticated;
