-- =====================================================================
-- MIGRATION v8k — EFRIS hardening
--
-- 1. Enable RLS on efris_queue (security gap: any authed user could read/write)
-- 2. Add business-scoped policies via the parent efris_invoices table
-- 3. Add max_retries and next_retry_at columns for auto-retry support
-- 4. Add invoice_type column to efris_invoices for credit/debit notes
-- =====================================================================

-- 1. Enable RLS on efris_queue
ALTER TABLE efris_queue ENABLE ROW LEVEL SECURITY;

-- 2. Business-scoped policies (join through efris_invoices to get business_id)
CREATE POLICY business_isolation_efris_queue_select ON efris_queue
  FOR SELECT USING (
    efris_invoice_id IN (
      SELECT id FROM efris_invoices WHERE business_id = auth_business_id()
    )
  );

CREATE POLICY business_isolation_efris_queue_insert ON efris_queue
  FOR INSERT WITH CHECK (
    efris_invoice_id IN (
      SELECT id FROM efris_invoices WHERE business_id = auth_business_id()
    )
  );

CREATE POLICY business_isolation_efris_queue_update ON efris_queue
  FOR UPDATE USING (
    efris_invoice_id IN (
      SELECT id FROM efris_invoices WHERE business_id = auth_business_id()
    )
  );

-- 3. Auto-retry columns on efris_queue
ALTER TABLE efris_queue ADD COLUMN IF NOT EXISTS max_retries int DEFAULT 3;
ALTER TABLE efris_queue ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

-- 4. Invoice type column on efris_invoices (1=standard, 2=credit note, 3=debit note)
ALTER TABLE efris_invoices ADD COLUMN IF NOT EXISTS invoice_type text DEFAULT '1';
ALTER TABLE efris_invoices ADD COLUMN IF NOT EXISTS original_invoice_id uuid REFERENCES efris_invoices(id);
