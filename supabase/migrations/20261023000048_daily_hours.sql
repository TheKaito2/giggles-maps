-- The planner checks you arrive while a place is open using open_min/close_min, but only 4 places had them: the
-- OpenStreetMap opening_hours text was never turned into minutes. Places open the same hours every day
-- ("Mo-Su 08:00-17:00", "08:00-17:00", "24/7") get exact minutes; anything that varies by day stays unknown (null)
-- rather than guessed. A trigger keeps them in step with whatever writes opening_hours (importer, owners, edits).
create or replace function public.daily_hours(p_text text, out open_min int, out close_min int)
language plpgsql immutable set search_path = '' as $$
declare m text[];
begin
  if p_text is null then return; end if;
  if trim(p_text) = '24/7' then open_min := 0; close_min := 1440; return; end if;
  m := regexp_match(trim(p_text), '^(?:Mo-Su )?([0-2]\d):([0-5]\d)-([0-2]\d):([0-5]\d)$');
  if m is null then return; end if;
  open_min := m[1]::int * 60 + m[2]::int;
  close_min := m[3]::int * 60 + m[4]::int;
  if open_min >= 1440 or close_min > 1440 then open_min := null; close_min := null; return; end if;
  if close_min <= open_min then close_min := 1440; end if;   -- past midnight (18:00-02:00): plan as closing at midnight
end;
$$;

create or replace function public.places_daily_hours() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.opening_hours is not null then
    select h.open_min, h.close_min into new.open_min, new.close_min from public.daily_hours(new.opening_hours) h;
  end if;
  return new;
end;
$$;

drop trigger if exists places_daily_hours on public.places;
create trigger places_daily_hours before insert or update of opening_hours on public.places
  for each row execute function public.places_daily_hours();

update public.places set open_min = (public.daily_hours(opening_hours)).open_min,
                         close_min = (public.daily_hours(opening_hours)).close_min
 where opening_hours is not null;

revoke execute on function public.daily_hours(text), public.places_daily_hours() from public, anon, authenticated;
