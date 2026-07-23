-- =====================================================================
-- QWICKPOS SCHEMA V7 — Fund Transfers & Deposits
-- Run this AFTER schema v6 in Supabase SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FUND TRANSFERS — move money between accounts/banks/cash
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_transfers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  from_account TEXT NOT NULL,          -- 'cash', 'bank_<name>', 'mobile_money_<provider>'
  to_account TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  fee NUMERIC DEFAULT 0,
  exchange_rate NUMERIC DEFAULT 1,
  reference TEXT,                       -- external ref number
  notes TEXT,
  status TEXT DEFAULT 'completed',     -- 'pending', 'completed', 'cancelled'
  initiated_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fund_transfers_business ON fund_transfers(business_id, created_at DESC);

ALTER TABLE fund_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fund_transfers_all" ON fund_transfers
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 2. DEPOSITS — bank/cash deposits tracking
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deposits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  account TEXT NOT NULL,               -- 'bank_<name>', 'mobile_money_<provider>'
  amount NUMERIC NOT NULL CHECK (amount > 0),
  deposit_method TEXT DEFAULT 'cash',  -- 'cash', 'cheque', 'transfer', 'mobile_money'
  reference TEXT,
  deposit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  status TEXT DEFAULT 'confirmed',     -- 'pending', 'confirmed', 'reversed'
  recorded_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deposits_business ON deposits(business_id, deposit_date DESC);

ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deposits_all" ON deposits
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 3. ACCOUNT BALANCES — running balances per account
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_balances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,          -- 'cash', 'bank_<name>', 'mobile_money_<provider>'
  account_type TEXT NOT NULL,          -- 'cash', 'bank', 'mobile_money', 'other'
  balance NUMERIC DEFAULT 0,
  currency_code TEXT DEFAULT 'UGX',
  last_updated TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, account_name)
);

ALTER TABLE account_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_balances_all" ON account_balances
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 4. SEED DEFAULT ACCOUNTS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_default_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO account_balances (business_id, account_name, account_type, balance)
  VALUES
    (p_business_id, 'cash', 'cash', 0),
    (p_business_id, 'bank_main', 'bank', 0),
    (p_business_id, 'mobile_money_mtn', 'mobile_money', 0),
    (p_business_id, 'mobile_money_airtel', 'mobile_money', 0)
  ON CONFLICT (business_id, account_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
