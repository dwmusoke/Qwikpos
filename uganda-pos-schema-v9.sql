-- =====================================================================
-- MIGRATION v9 — EFRIS Sandbox API (standalone mock middleware)
--
-- Exposes a mock EFRIS Simplified API for third-party POS/ERP/accounting
-- vendors to test their URA EFRIS integration without a real account.
--
-- 1. sandbox_api_keys — vendor API keys with tier, rate limits
-- 2. sandbox_invoices — all sandbox invoices generated via the API
-- 3. sandbox_usage — request-level logs for rate limiting + analytics
-- 4. Sequences, triggers, RLS policies
-- =====================================================================

-- Sequence for sandbox fiscal invoice numbers
create sequence if not exists sandbox_fiscal_invoice_seq start 1;

create or replace function next_sandbox_fiscal_number() returns text
language plpgsql as $$
begin
  return 'SFDN-' || lpad(nextval('sandbox_fiscal_invoice_seq')::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------------
-- 1. SANDBOX API KEYS
-- ---------------------------------------------------------------------
create table if not exists sandbox_api_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  api_key_hash text unique not null,          -- SHA-256 hash of the key (never store plaintext)
  api_key_prefix text not null,               -- first 8 chars for display ("sbx_abc1...")
  label text,
  tier text not null default 'free' check (tier in ('free','starter','pro')),
  rate_limit int not null default 100,        -- requests per hour
  daily_limit int not null default 100,        -- invoices per day
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_sandbox_api_keys_updated_at on sandbox_api_keys;
create trigger trg_sandbox_api_keys_updated_at before update on sandbox_api_keys
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 2. SANDBOX INVOICES
-- ---------------------------------------------------------------------
create table if not exists sandbox_invoices (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references sandbox_api_keys(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  tin text not null,
  fiscal_invoice_number text not null,
  invoice_type text not null default '1',
  status text not null default 'accepted' check (status in ('accepted','rejected')),
  gross_amount numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  currency_code text not null default 'UGX',
  payload_json jsonb,
  response_json jsonb,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists idx_sandbox_invoices_tin on sandbox_invoices(tin);
create index if not exists idx_sandbox_invoices_api_key on sandbox_invoices(api_key_id);
create index if not exists idx_sandbox_invoices_created on sandbox_invoices(created_at desc);

-- ---------------------------------------------------------------------
-- 3. SANDBOX USAGE (request-level logs)
-- ---------------------------------------------------------------------
create table if not exists sandbox_usage (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references sandbox_api_keys(id) on delete cascade,
  endpoint text not null,            -- 'register-good' | 'generate-invoice' | 'list-invoices'
  tin text,
  status text not null,              -- 'accepted' | 'rejected' | 'rate_limited' | 'error'
  response_time_ms int,
  created_at timestamptz default now()
);

create index if not exists idx_sandbox_usage_api_key_created on sandbox_usage(api_key_id, created_at desc);
create index if not exists idx_sandbox_usage_created on sandbox_usage(created_at desc);

-- ---------------------------------------------------------------------
-- 4. RLS POLICIES
-- ---------------------------------------------------------------------
alter table sandbox_api_keys enable row level security;

drop policy if exists sandbox_api_keys_isolation on sandbox_api_keys;
create policy sandbox_api_keys_isolation on sandbox_api_keys
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

alter table sandbox_invoices enable row level security;

drop policy if exists sandbox_invoices_isolation on sandbox_invoices;
create policy sandbox_invoices_isolation on sandbox_invoices
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

alter table sandbox_usage enable row level security;

drop policy if exists sandbox_usage_isolation on sandbox_usage;
create policy sandbox_usage_isolation on sandbox_usage
  for all using (
    api_key_id in (select id from sandbox_api_keys where business_id = auth_business_id())
    or is_superadmin()
  )
  with check (
    api_key_id in (select id from sandbox_api_keys where business_id = auth_business_id())
    or is_superadmin()
  );

-- ---------------------------------------------------------------------
-- 5. RPC: Generate a sandbox API key for a business
-- ---------------------------------------------------------------------
create or replace function create_sandbox_api_key(
  p_business_id uuid,
  p_label text
) returns text
language plpgsql security definer as $$
declare
  v_key text;
  v_hash text;
  v_prefix text;
begin
  if not is_superadmin() and p_business_id != coalesce(auth_business_id(), '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'Not authorized';
  end if;

  -- Generate key: sbx_<random>_<timestamp>
  v_key := 'sbx_' || replace(gen_random_uuid()::text, '-', '') || '_' || extract(epoch from now())::int::text;

  -- Hash with SHA-256 for storage (never store plaintext)
  v_hash := encode(sha256(v_key::bytea), 'hex');
  v_prefix := left(v_key, 20) || '...';

  insert into sandbox_api_keys (business_id, api_key_hash, api_key_prefix, label, tier, rate_limit, daily_limit)
  values (p_business_id, v_hash, v_prefix, p_label, 'free', 100, 100);

  -- Return the plaintext key (shown once, never stored)
  return v_key;
end;
$$;

grant execute on function create_sandbox_api_key(uuid, text) to authenticated;

-- =====================================================================
-- END OF MIGRATION v9
-- =====================================================================
