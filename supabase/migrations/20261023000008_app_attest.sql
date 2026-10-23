-- App Attest: each iPhone install registers a hardware-backed key once; every check-in then carries an assertion
-- signed by that key. verify-checkin records attest_ok in checkins.client (logged, not enforced yet).
create table public.attest_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create table public.app_attest_keys (
  key_id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  public_key_pem text not null,
  sign_count bigint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.attest_challenges enable row level security;
alter table public.app_attest_keys enable row level security;
-- no client policies: only Edge Functions (service role) touch these
