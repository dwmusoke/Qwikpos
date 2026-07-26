-- =====================================================================
-- FIX v9 — Add missing api_key_hash column to sandbox_api_keys
-- Run this if the table was created without the full schema
-- =====================================================================

-- Drop legacy api_key column if it exists (we use api_key_hash instead)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'api_key'
  ) THEN
    ALTER TABLE sandbox_api_keys DROP COLUMN api_key;
    RAISE NOTICE 'Dropped legacy api_key column';
  END IF;
END $$;

-- Add api_key_hash if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'api_key_hash'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN api_key_hash text unique not null default '';
    RAISE NOTICE 'Added api_key_hash column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'api_key_prefix'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN api_key_prefix text not null default '';
    RAISE NOTICE 'Added api_key_prefix column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'tier'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN tier text not null default 'free';
    RAISE NOTICE 'Added tier column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'rate_limit'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN rate_limit int not null default 100;
    RAISE NOTICE 'Added rate_limit column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'daily_limit'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN daily_limit int not null default 100;
    RAISE NOTICE 'Added daily_limit column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN is_active boolean not null default true;
    RAISE NOTICE 'Added is_active column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'last_used_at'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN last_used_at timestamptz;
    RAISE NOTICE 'Added last_used_at column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN created_at timestamptz default now();
    RAISE NOTICE 'Added created_at column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_api_keys' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD COLUMN updated_at timestamptz default now();
    RAISE NOTICE 'Added updated_at column';
  END IF;
END $$;

-- Ensure sandbox_invoices has all columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'api_key_id'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN api_key_id uuid not null references sandbox_api_keys(id) on delete cascade;
    RAISE NOTICE 'Added api_key_id to sandbox_invoices';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'business_id'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN business_id uuid not null references businesses(id) on delete cascade;
    RAISE NOTICE 'Added business_id to sandbox_invoices';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'tin'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN tin text not null default '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'fiscal_invoice_number'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN fiscal_invoice_number text not null default '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'invoice_type'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN invoice_type text not null default '1';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'status'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN status text not null default 'accepted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'gross_amount'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN gross_amount numeric(18,2) not null default 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'vat_amount'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN vat_amount numeric(18,2) not null default 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'currency_code'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN currency_code text not null default 'UGX';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'payload_json'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN payload_json jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'response_json'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN response_json jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN error_message text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_invoices' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE sandbox_invoices ADD COLUMN created_at timestamptz default now();
  END IF;
END $$;

-- Ensure sandbox_invoices indexes
create index if not exists idx_sandbox_invoices_tin on sandbox_invoices(tin);
create index if not exists idx_sandbox_invoices_api_key on sandbox_invoices(api_key_id);
create index if not exists idx_sandbox_invoices_created on sandbox_invoices(created_at desc);

-- Ensure sandbox_usage has all columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_usage' AND column_name = 'api_key_id'
  ) THEN
    ALTER TABLE sandbox_usage ADD COLUMN api_key_id uuid not null references sandbox_api_keys(id) on delete cascade;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_usage' AND column_name = 'endpoint'
  ) THEN
    ALTER TABLE sandbox_usage ADD COLUMN endpoint text not null default '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_usage' AND column_name = 'tin'
  ) THEN
    ALTER TABLE sandbox_usage ADD COLUMN tin text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_usage' AND column_name = 'status'
  ) THEN
    ALTER TABLE sandbox_usage ADD COLUMN status text not null default '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_usage' AND column_name = 'response_time_ms'
  ) THEN
    ALTER TABLE sandbox_usage ADD COLUMN response_time_ms int;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sandbox_usage' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE sandbox_usage ADD COLUMN created_at timestamptz default now();
  END IF;
END $$;

create index if not exists idx_sandbox_usage_api_key_created on sandbox_usage(api_key_id, created_at desc);
create index if not exists idx_sandbox_usage_created on sandbox_usage(created_at desc);

-- Ensure RLS is enabled and policies exist
ALTER TABLE sandbox_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sandbox_api_keys_isolation ON sandbox_api_keys;
CREATE POLICY sandbox_api_keys_isolation ON sandbox_api_keys
  FOR ALL USING (business_id = auth_business_id() or is_superadmin())
  WITH CHECK (business_id = auth_business_id() or is_superadmin());

DROP POLICY IF EXISTS sandbox_invoices_isolation ON sandbox_invoices;
CREATE POLICY sandbox_invoices_isolation ON sandbox_invoices
  FOR ALL USING (business_id = auth_business_id() or is_superadmin())
  WITH CHECK (business_id = auth_business_id() or is_superadmin());

DROP POLICY IF EXISTS sandbox_usage_isolation ON sandbox_usage;
CREATE POLICY sandbox_usage_isolation ON sandbox_usage
  FOR ALL USING (
    api_key_id in (select id from sandbox_api_keys where business_id = auth_business_id())
    or is_superadmin()
  )
  WITH CHECK (
    api_key_id in (select id from sandbox_api_keys where business_id = auth_business_id())
    or is_superadmin()
  );

-- Ensure constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sandbox_api_keys_tier_check'
  ) THEN
    ALTER TABLE sandbox_api_keys ADD CONSTRAINT sandbox_api_keys_tier_check
      CHECK (tier in ('free','starter','pro'));
  END IF;
END $$;

-- Ensure trigger exists
drop trigger if exists trg_sandbox_api_keys_updated_at on sandbox_api_keys;
create trigger trg_sandbox_api_keys_updated_at before update on sandbox_api_keys
  for each row execute function set_updated_at();

-- Recreate RPC function (idempotent)
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

  v_key := 'sbx_' || replace(gen_random_uuid()::text, '-', '') || '_' || extract(epoch from now())::int::text;
  v_hash := encode(sha256(v_key::bytea), 'hex');
  v_prefix := left(v_key, 20) || '...';

  insert into sandbox_api_keys (business_id, api_key_hash, api_key_prefix, label, tier, rate_limit, daily_limit)
  values (p_business_id, v_hash, v_prefix, p_label, 'free', 100, 100);

  return v_key;
end;
$$;

grant execute on function create_sandbox_api_key(uuid, text) to authenticated;
