-- Review fixes for 101.
-- place_links: the cursor moves only after a batch is saved (place_links_commit), so a batch that failed (routing server
--   off, a write error) is tried again next run instead of being skipped until the next pass.
-- apply_shop_invoice: extends the tier by the invoice's own period on top of what's left (a shop that subscribes with days
--   left from a one-off payment keeps them); records the subscription id and status only for the shop's own subscription
--   (a late invoice from an old one can't overwrite them); a second, duplicate subscription is reported as 'duplicate' so
--   stripe-webhook stops it renewing.

create or replace function public.place_links_batch(p_mode text, p_n int default 60) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_last bigint; v_reach float8 := case p_mode when 'auto' then 40000 when 'bicycle' then 20000 else 5000 end; r jsonb;
begin
  select last_id into v_last from public.place_links_cursor where mode = p_mode;
  select coalesce(jsonb_agg(jsonb_build_object('id', src.id, 'lat', extensions.st_y(src.location::extensions.geometry),
           'lng', extensions.st_x(src.location::extensions.geometry), 'near', src.near) order by src.id), '[]')
    into r
    from (select p.id, p.location,
            (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'lat', extensions.st_y(q.location::extensions.geometry),
                      'lng', extensions.st_x(q.location::extensions.geometry))), '[]')
               from (select q.id, q.location from public.places q
                      where q.tier >= 2 and q.id <> p.id and extensions.st_dwithin(q.location, p.location, v_reach)
                      order by q.location operator(extensions.<->) p.location limit 8) q) as near
            from public.places p where p.tier >= 2 and p.id > v_last order by p.id limit p_n) src;
  return r;
end $$;
revoke execute on function public.place_links_batch(text, int) from public, anon, authenticated;

-- after a batch is saved: move past it (p_last = 0: the places ran out, start a new pass)
create or replace function public.place_links_commit(p_mode text, p_last bigint) returns void
language sql security definer set search_path = '' as $$
  update public.place_links_cursor set last_id = p_last,
    pass_started = case when p_last = 0 or last_id = 0 then now() else pass_started end
   where mode = p_mode
$$;
revoke execute on function public.place_links_commit(text, bigint) from public, anon, authenticated;

-- the cron call waits for the run (up to 100 s of work): pg_net's default 5 s gave up while the function was still working
select cron.schedule('build-place-links', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://xrlxfvwrkowaybtkkrdl.supabase.co/functions/v1/build-place-links',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
$$);

drop function if exists public.apply_shop_invoice(text, uuid, text, numeric, timestamptz, text);
create function public.apply_shop_invoice(p_invoice text, p_shop uuid, p_kind text, p_amount numeric,
  p_period_start timestamptz, p_period_end timestamptz, p_subscription text) returns text
language plpgsql set search_path = '' as $$
declare s public.shops; v_dup boolean;
begin
  if p_kind not in ('partner', 'choice') then raise exception 'unknown subscription kind %', p_kind; end if;
  select * into s from public.shops where id = p_shop for update;
  if not found then return 'no_shop'; end if;
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id) values (p_invoice, p_kind, p_amount, p_shop);
  -- another subscription is already running for this shop: this one is the duplicate
  v_dup := s.stripe_subscription_id is not null and s.stripe_subscription_id <> p_subscription
           and s.subscription_status in ('active', 'cancelling');
  update public.shops set
    tier = case when tier = 'choice' and tier_until > now() and p_kind = 'partner' then 'choice' else p_kind end,
    tier_until = greatest(coalesce(tier_until, now()), now()) + greatest(p_period_end - p_period_start, interval '0'),
    stripe_subscription_id = case when v_dup then stripe_subscription_id else p_subscription end,
    subscription_status = case when v_dup then subscription_status
                               when stripe_subscription_id = p_subscription then subscription_status   -- keep a 'cancelling'
                               else 'active' end
   where id = p_shop;
  return case when v_dup then 'duplicate' else 'applied' end;
exception when unique_violation then
  return 'already_applied';   -- Stripe retried an invoice we already applied
end $$;
revoke execute on function public.apply_shop_invoice(text, uuid, text, numeric, timestamptz, timestamptz, text) from public, anon, authenticated;
