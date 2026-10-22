-- Daily 03:17 UTC: delete selfies older than 30 days via the purge-selfies function.
-- The shared secret lives in Vault as 'cron_secret' (set outside migrations, never committed).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('purge-selfies', '17 3 * * *', $$
  select net.http_post(
    url := 'https://xrlxfvwrkowaybtkkrdl.supabase.co/functions/v1/purge-selfies',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
