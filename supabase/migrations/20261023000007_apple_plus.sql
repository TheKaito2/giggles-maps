-- Giggles Plus bought in the iOS app (StoreKit 2 auto-renewing subscription).
-- One row per Apple subscription (original transaction). plus_until on profiles stays the single switch the
-- planner reads; Apple extends it on purchase/renewal and cuts it on refund/revoke.
create table public.apple_subscriptions (
  original_transaction_id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  product_id text not null,
  environment text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.apple_subscriptions enable row level security;
create policy "own apple subscriptions" on public.apple_subscriptions for select using (user_id = auth.uid());

create or replace function public.apply_apple_plus(
  p_otid text, p_user uuid, p_product text, p_env text, p_expires timestamptz, p_revoked timestamptz)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare v_until timestamptz;
begin
  -- the same Apple subscription can never move to another account
  if exists (select 1 from public.apple_subscriptions where original_transaction_id = p_otid and user_id <> p_user) then
    raise exception 'subscription belongs to another account' using errcode = 'P0001';
  end if;
  insert into public.apple_subscriptions (original_transaction_id, user_id, product_id, environment, expires_at, revoked_at)
  values (p_otid, p_user, p_product, p_env, p_expires, p_revoked)
  on conflict (original_transaction_id) do update
    set expires_at = greatest(public.apple_subscriptions.expires_at, excluded.expires_at),
        revoked_at = excluded.revoked_at, environment = excluded.environment, updated_at = now();

  if p_revoked is null and p_expires > now() then
    update public.profiles set plus_until = greatest(coalesce(plus_until, now()), p_expires) where id = p_user
    returning plus_until into v_until;
  else
    -- refunded/revoked/expired: end Plus unless a later web pass keeps it going
    update public.profiles set plus_until = case when plus_until <= p_expires + interval '1 day' then now() else plus_until end
    where id = p_user returning plus_until into v_until;
  end if;
  return v_until;
end;
$$;
revoke execute on function public.apply_apple_plus(text, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
