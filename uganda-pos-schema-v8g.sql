-- =====================================================================
-- QWICKPOS — SCHEMA V8G
-- Seed default accounts for ALL existing businesses that are missing them.
-- One-time migration: safe to re-run (uses ON CONFLICT DO NOTHING).
-- =====================================================================

-- Ensure the seed function exists (idempotent)
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


-- ── One-time backfill: seed accounts for every business that has none ──
DO $$
DECLARE
  b RECORD;
  seeded INT := 0;
BEGIN
  FOR b IN
    SELECT bu.id
    FROM businesses bu
    WHERE NOT EXISTS (
      SELECT 1 FROM account_balances ab WHERE ab.business_id = bu.id
    )
  LOOP
    PERFORM seed_default_accounts(b.id);
    seeded := seeded + 1;
  END LOOP;
  RAISE NOTICE 'Seeded default accounts for % businesses', seeded;
END;
$$;


-- ── Verify ──
-- Run this after migration to confirm:
--   SELECT bu.id, bu.name, count(ab.id) AS account_count
--   FROM businesses bu
--   LEFT JOIN account_balances ab ON ab.business_id = bu.id
--   GROUP BY bu.id, bu.name
--   ORDER BY bu.name;


-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
