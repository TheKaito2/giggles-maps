-- Prices v6 (docs/MONETIZATION.md): monthly Plus and the ฿349 membership are no longer sold. New:
--   trip_pass : Plus for 7 days (฿79)
--   plus_year : Plus for 365 days (฿890), the main plan
--   lifetime  : Plus forever (฿2,990), which includes everything membership gave (member_since)
-- "Forever" is plus_until = 2100-01-01: every existing check (plus_until > now()) keeps working, and the app shows any
-- date from 2099 on as "Forever". Old kinds stay valid for payment history and for subscriptions still running out.

alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check
  check (kind in ('credit', 'plus', 'plus_year', 'membership', 'partner', 'choice', 'trip_pass', 'lifetime'));

create or replace function public.apply_payment(p_session text, p_kind text, p_amount numeric, p_shop uuid default null, p_user uuid default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.payments (stripe_session_id, kind, amount_thb, shop_id, user_id)
  values (p_session, p_kind, p_amount, p_shop, p_user);
  if p_kind = 'credit' then
    update public.shops set wallet_thb = wallet_thb + p_amount where id = p_shop;
  elsif p_kind in ('plus', 'plus_year', 'trip_pass') then
    update public.profiles set plus_until = greatest(coalesce(plus_until, now()), now())
      + case p_kind when 'plus_year' then interval '365 days' when 'trip_pass' then interval '7 days' else interval '30 days' end
     where id = p_user;
  elsif p_kind = 'lifetime' then
    update public.profiles set member_since = coalesce(member_since, now()), membership_plus_given = true,
      plus_until = greatest(coalesce(plus_until, now()), '2100-01-01'::timestamptz) where id = p_user;
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

-- Apple: the one-time products. Membership (old, ฿349) and Lifetime (new) share the table; a refunded Lifetime also ends
-- its forever Plus, unless a web Lifetime keeps it.
alter table public.apple_memberships add column if not exists lifetime boolean not null default false;

drop function if exists public.apply_apple_membership(text, uuid, text, timestamptz);
create function public.apply_apple_membership(p_otid text, p_user uuid, p_env text, p_revoked timestamptz, p_lifetime boolean default false)
returns timestamptz language plpgsql set search_path = '' as $$
declare v_since timestamptz;
begin
  if exists (select 1 from public.apple_memberships where original_transaction_id = p_otid and user_id <> p_user) then
    raise exception 'membership belongs to another account' using errcode = 'P0001';
  end if;
  insert into public.apple_memberships (original_transaction_id, user_id, environment, revoked_at, lifetime)
  values (p_otid, p_user, p_env, p_revoked, p_lifetime)
  on conflict (original_transaction_id) do update set revoked_at = excluded.revoked_at, environment = excluded.environment,
    lifetime = excluded.lifetime, updated_at = now();
  if p_revoked is null then
    update public.profiles set member_since = coalesce(member_since, now()), membership_plus_given = true,
      plus_until = case
        when p_lifetime then greatest(coalesce(plus_until, now()), '2100-01-01'::timestamptz)
        when not membership_plus_given then greatest(coalesce(plus_until, now()), now()) + interval '90 days'
        else plus_until end
     where id = p_user returning member_since into v_since;
  else
    -- keep what a web (Stripe) purchase still pays for
    update public.profiles set
      member_since = case when exists (select 1 from public.payments where user_id = p_user and kind in ('membership', 'lifetime'))
        then member_since else null end,
      plus_until = case when p_lifetime and plus_until >= '2099-01-01'
          and not exists (select 1 from public.payments where user_id = p_user and kind = 'lifetime') then now() else plus_until end
     where id = p_user returning member_since into v_since;
  end if;
  return v_since;
end $$;
revoke execute on function public.apply_apple_membership(text, uuid, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.apply_apple_membership(text, uuid, text, timestamptz, boolean) to service_role;
