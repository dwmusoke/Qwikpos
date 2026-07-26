-- =====================================================================
-- QWICKPOS — SCHEMA V8I
-- Add delivery_persons table + auto-create deliveries from POS
-- =====================================================================

-- 1. DELIVERY PERSONS — managed list of riders/drivers
CREATE TABLE IF NOT EXISTS delivery_persons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  vehicle_type TEXT DEFAULT 'motorcycle',  -- 'motorcycle', 'car', 'van', 'bicycle', 'on_foot'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, full_name)
);

ALTER TABLE delivery_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_persons_all" ON delivery_persons
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );


-- 2. Add assigned_to_id FK to deliveries (keep assigned_to text for compat)
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS assigned_to_id UUID
  REFERENCES delivery_persons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deliveries_assigned ON deliveries(assigned_to_id);


-- 3. RPC: auto-create delivery + items from a completed sale
CREATE OR REPLACE FUNCTION create_delivery_from_sale(
  p_sale_id UUID,
  p_assigned_to_id UUID DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal',
  p_estimated_delivery TIMESTAMPTZ DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sale RECORD;
  v_delivery_id UUID;
  v_delivery_number TEXT;
  v_delivery jsonb;
  v_item RECORD;
BEGIN
  -- Fetch sale
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  -- Check delivery not already created
  IF EXISTS (SELECT 1 FROM deliveries WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'Delivery already exists for this sale';
  END IF;

  -- Generate delivery number
  v_delivery_number := next_delivery_number(v_sale.business_id);

  -- Create delivery
  INSERT INTO deliveries (
    business_id, branch_id, delivery_number, sale_id, customer_id,
    status, priority, delivery_address, delivery_notes,
    assigned_to_id, estimated_delivery
  ) VALUES (
    v_sale.business_id, v_sale.branch_id, v_delivery_number, p_sale_id, v_sale.customer_id,
    CASE WHEN p_assigned_to_id IS NOT NULL THEN 'assigned' ELSE 'pending' END,
    p_priority,
    v_sale.delivery_address,
    v_sale.notes,
    p_assigned_to_id,
    p_estimated_delivery
  ) RETURNING id INTO v_delivery_id;

  -- Copy sale items into delivery_items
  INSERT INTO delivery_items (delivery_id, product_id, product_name, quantity, unit_price)
  SELECT v_delivery_id, si.product_id, si.product_name, si.quantity, si.unit_price
  FROM sale_items si WHERE si.sale_id = p_sale_id;

  -- Log initial status
  INSERT INTO delivery_status_log (delivery_id, status, notes, changed_by)
  VALUES (v_delivery_id, 'pending', 'Auto-created from sale', 'system');

  -- Build response
  SELECT to_jsonb(d.*) INTO v_delivery FROM deliveries d WHERE d.id = v_delivery_id;
  RETURN v_delivery;
END;
$$;

GRANT EXECUTE ON FUNCTION create_delivery_from_sale(UUID, UUID, text, TIMESTAMPTZ) TO authenticated;


-- 4. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
