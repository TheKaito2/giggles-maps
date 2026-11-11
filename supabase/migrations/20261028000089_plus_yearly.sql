-- Yearly Giggles Plus (web, Stripe): kind 'plus_year' adds 365 days, like 'plus' adds 30. Price lives in stripe-checkout.
-- apply_payment is otherwise unchanged from 20261024000064_monetization_v5_hardening.sql; create or replace keeps its
-- grants (service role only).

alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check
  check (kind in ('credit', 'plus', 'plus_year', 'membership', 'partner', 'choice'));

create or replace function public.apply_payment(p_session text, p_kind text, p_amount numeric, p_shop uuid default null, p_user uuid default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id, user_id)
  values (p_session, p_kind, p_amount, p_shop, p_user);
  if p_kind = 'credit' then
    update public.shops set wallet_thb = wallet_thb + p_amount where id = p_shop;
  elsif p_kind in ('plus', 'plus_year') then
    update public.profiles set plus_until = greatest(coalesce(plus_until, now()), now())
      + case when p_kind = 'plus_year' then interval '365 days' else interval '30 days' end where id = p_user;
  elsif p_kind = 'membership' then
    update public.profiles set member_since = coalesce(member_since, now()), membership_plus_given = true,
      plus_until = case when not membership_plus_given then greatest(coalesce(plus_until, now()), now()) + interval '90 days' else plus_until end
     where id = p_user;
  elsif p_kind in ('partner', 'choice') then
    -- a Partner payment keeps a live Giggles Choice (the days add on); Choice upgrades a Partner
    update public.shops set tier = case when tier = 'choice' and tier_until > now() then 'choice' else p_kind end,
      tier_until = greatest(coalesce(tier_until, now()), now()) + interval '30 days' where id = p_shop;
  else
    raise exception 'unknown payment kind %', p_kind;
  end if;
  return true;
exception when unique_violation then
  return false;  -- Stripe retried an event we already applied
end $$;
