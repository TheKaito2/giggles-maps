-- Demo-shop visits are publicly readable for the MVP dashboard; never expose who visited.
revoke select on public.billable_visits from anon, authenticated;
grant select (id, checkin_id, place_id, shop_id, amount_thb, created_at, status, dispute_reason, disputed_at)
  on public.billable_visits to anon, authenticated;
