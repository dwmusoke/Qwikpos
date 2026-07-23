-- =====================================================================
-- QWICKPOS SCHEMA V6 — Audit Logs, Notifications, Leads, Deliveries, HRM
-- Run this AFTER schema v5 in Supabase SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AUDIT LOGS — track every important action
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  user_id UUID REFERENCES auth.users(id),
  user_name TEXT NOT NULL DEFAULT 'System',
  user_role TEXT,
  action TEXT NOT NULL,          -- 'create', 'update', 'delete', 'login', 'logout', 'void', 'approve', 'export'
  entity_type TEXT NOT NULL,     -- 'sale', 'product', 'customer', 'supplier', 'purchase', 'stock_transfer', 'settings', etc.
  entity_id UUID,
  entity_name TEXT,              -- human-readable name/number of the entity
  old_value JSONB,               -- previous state (for updates)
  new_value JSONB,               -- new state (for creates/updates)
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,                -- any extra context
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_business ON audit_logs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- RPC helper to insert audit log
CREATE OR REPLACE FUNCTION insert_audit_log(
  p_business_id UUID,
  p_branch_id UUID,
  p_user_id UUID,
  p_user_name TEXT,
  p_user_role TEXT,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_entity_name TEXT,
  p_old_value JSONB DEFAULT NULL,
  p_new_value JSONB DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit_logs (
    business_id, branch_id, user_id, user_name, user_role,
    action, entity_type, entity_id, entity_name,
    old_value, new_value, ip_address, metadata
  ) VALUES (
    p_business_id, p_branch_id, p_user_id, p_user_name, p_user_role,
    p_action, p_entity_type, p_entity_id, p_entity_name,
    p_old_value, p_new_value, p_ip_address, p_metadata
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------
-- 2. NOTIFICATION TEMPLATES — configurable email/SMS templates
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- 'receipt', 'low_stock', 'payment_reminder', 'delivery_update'
  channel TEXT NOT NULL DEFAULT 'email', -- 'email', 'sms', 'both'
  subject TEXT,                          -- email subject
  body_template TEXT NOT NULL,           -- template with {{variables}}
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, name, channel)
);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_templates_all" ON notification_templates
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 3. NOTIFICATION LOG — sent email/SMS history
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_name TEXT,
  channel TEXT NOT NULL,               -- 'email', 'sms'
  recipient TEXT NOT NULL,             -- email address or phone number
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'sent',          -- 'sent', 'failed', 'pending'
  error_message TEXT,
  entity_type TEXT,                    -- 'sale', 'customer', 'delivery', etc.
  entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_business ON notification_log(business_id, created_at DESC);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_log_all" ON notification_log
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 4. LEADS (CRM) — sales pipeline
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  source TEXT,                          -- 'website', 'referral', 'walk_in', 'social_media', 'cold_call', 'other'
  status TEXT DEFAULT 'new',            -- 'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'
  priority TEXT DEFAULT 'medium',       -- 'low', 'medium', 'high', 'urgent'
  value NUMERIC DEFAULT 0,              -- estimated deal value
  assigned_to UUID REFERENCES app_users(id),
  notes TEXT,
  next_followup_at TIMESTAMPTZ,
  customer_id UUID REFERENCES customers(id),  -- linked customer if won
  lost_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_business ON leads(business_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_all" ON leads
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- Lead activity log
CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES app_users(id),
  user_name TEXT,
  activity_type TEXT NOT NULL,          -- 'note', 'call', 'email', 'meeting', 'status_change', 'followup'
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id, created_at DESC);

ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_activities_all" ON lead_activities
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 5. DELIVERIES — order delivery tracking
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  delivery_number TEXT NOT NULL,
  sale_id UUID REFERENCES sales(id),
  purchase_id UUID,                     -- for inbound deliveries from suppliers
  customer_id UUID REFERENCES customers(id),
  supplier_id UUID REFERENCES suppliers(id),
  status TEXT DEFAULT 'pending',        -- 'pending', 'assigned', 'in_transit', 'delivered', 'failed', 'returned'
  priority TEXT DEFAULT 'normal',       -- 'normal', 'express', 'scheduled'
  delivery_address TEXT,
  delivery_notes TEXT,
  assigned_to TEXT,                     -- delivery person name/ID
  estimated_delivery TIMESTAMPTZ,
  actual_delivery TIMESTAMPTZ,
  signature_url TEXT,                   -- proof of delivery
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_business ON deliveries(business_id, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_sale ON deliveries(sale_id);

ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deliveries_all" ON deliveries
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- Delivery items
CREATE TABLE IF NOT EXISTS delivery_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC DEFAULT 0
);

ALTER TABLE delivery_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_items_all" ON delivery_items
  FOR ALL USING (
    delivery_id IN (
      SELECT id FROM deliveries WHERE business_id IN (
        SELECT business_id FROM app_users WHERE id = auth.uid()
      )
    )
  );

-- Delivery status log
CREATE TABLE IF NOT EXISTS delivery_status_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  notes TEXT,
  changed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE delivery_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_status_log_all" ON delivery_status_log
  FOR ALL USING (
    delivery_id IN (
      SELECT id FROM deliveries WHERE business_id IN (
        SELECT business_id FROM app_users WHERE id = auth.uid()
      )
    )
  );


-- ---------------------------------------------------------------------
-- 6. HRM — Employees, Departments, Attendance, Payroll, Leave
-- ---------------------------------------------------------------------

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  manager_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_all" ON departments
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- Designations (job titles)
CREATE TABLE IF NOT EXISTS designations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  min_salary NUMERIC DEFAULT 0,
  max_salary NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE designations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "designations_all" ON designations
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- Employees
CREATE TABLE IF NOT EXISTS employees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  app_user_id UUID REFERENCES auth.users(id),  -- linked to app login
  employee_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  gender TEXT,
  date_of_birth DATE,
  hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
  department_id UUID REFERENCES departments(id),
  designation_id UUID REFERENCES designations(id),
  employment_type TEXT DEFAULT 'full_time',   -- 'full_time', 'part_time', 'contract', 'intern'
  status TEXT DEFAULT 'active',               -- 'active', 'on_leave', 'terminated'
  salary NUMERIC DEFAULT 0,
  salary_type TEXT DEFAULT 'monthly',         -- 'monthly', 'weekly', 'hourly'
  bank_name TEXT,
  bank_account TEXT,
  tax_id TEXT,
  address TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_business ON employees(business_id, status);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employees_all" ON employees
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  status TEXT DEFAULT 'present',        -- 'present', 'absent', 'half_day', 'late', 'on_leave'
  hours_worked NUMERIC DEFAULT 0,
  overtime_hours NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(business_id, date);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_all" ON attendance
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- Leave types
CREATE TABLE IF NOT EXISTS leave_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- 'Annual', 'Sick', 'Maternity', 'Unpaid'
  days_per_year NUMERIC DEFAULT 0,
  is_paid BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_types_all" ON leave_types
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- Leave requests
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',        -- 'pending', 'approved', 'rejected', 'cancelled'
  approved_by UUID REFERENCES app_users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(business_id, status);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_requests_all" ON leave_requests
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );

-- Payroll
CREATE TABLE IF NOT EXISTS payroll (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_salary NUMERIC DEFAULT 0,
  overtime_pay NUMERIC DEFAULT 0,
  bonuses NUMERIC DEFAULT 0,
  deductions NUMERIC DEFAULT 0,
  tax NUMERIC DEFAULT 0,
  net_pay NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'draft',          -- 'draft', 'processed', 'paid'
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_business ON payroll(business_id, period_start DESC);

ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_all" ON payroll
  FOR ALL USING (
    business_id IN (SELECT business_id FROM app_users WHERE id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 7. RPC: next delivery number
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_delivery_number(p_business_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_count BIGINT;
  v_prefix TEXT;
  v_year TEXT;
BEGIN
  v_year := TO_CHAR(now(), 'YYYY');
  SELECT COUNT(*) INTO v_count
  FROM deliveries
  WHERE business_id = p_business_id
    AND delivery_number LIKE 'DEL-' || v_year || '-%';

  v_prefix := 'DEL-' || v_year || '-';
  RETURN v_prefix || LPAD((v_count + 1)::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
