-- =====================================================================
-- QWICKPOS — SUPABASE SCHEMA
-- Modern multi-currency Point of Sale with EFRIS (URA) readiness
-- Run this once in Supabase SQL editor (Project > SQL Editor > New query)
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. CORE / MULTI-BRANCH
-- ---------------------------------------------------------------------

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tin text,                              -- URA Tax Identification Number
  business_type text default 'retail',
  address text,
  phone text,
  email text,
  logo_url text,
  base_currency text not null default 'UGX',
  efris_device_no text,                  -- EFRIS device number (issued by URA)
  efris_mode text not null default 'sandbox' check (efris_mode in ('sandbox','live')),
  created_at timestamptz default now()
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  is_main boolean default false,
  created_at timestamptz default now()
);

-- App users, mirrors auth.users (Supabase Auth) with roles
create table if not exists app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  full_name text not null,
  phone text,
  role text not null default 'cashier'
    check (role in ('admin','manager','cashier','inventory_clerk','accountant')),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 2. MULTI-CURRENCY
-- ---------------------------------------------------------------------

create table if not exists currencies (
  code text primary key,                 -- ISO 4217, e.g. UGX, USD, KES, EUR
  name text not null,
  symbol text not null,
  decimal_places smallint not null default 2,
  is_base boolean default false,
  is_active boolean default true
);

-- Exchange rates always expressed as: 1 unit of `code` = `rate_to_base` units of base currency
create table if not exists exchange_rates (
  id uuid primary key default gen_random_uuid(),
  currency_code text references currencies(code) on delete cascade,
  rate_to_base numeric(18,6) not null,
  source text default 'manual' check (source in ('manual','api')),
  effective_at timestamptz default now(),
  created_by uuid references app_users(id)
);

create index if not exists idx_exchange_rates_currency on exchange_rates(currency_code, effective_at desc);

-- ---------------------------------------------------------------------
-- 3. TAX / EFRIS REFERENCE DATA
-- ---------------------------------------------------------------------

create table if not exists tax_categories (
  code text primary key,                 -- e.g. STD, ZERO, EXEMPT, DEEMED
  name text not null,
  rate numeric(5,2) not null default 0,  -- 18.00 for standard Uganda VAT
  efris_tax_code text                    -- code expected by EFRIS taxonomy
);

insert into tax_categories (code, name, rate, efris_tax_code) values
  ('STD', 'Standard Rated (18%)', 18.00, '01'),
  ('ZERO', 'Zero Rated', 0.00, '02'),
  ('EXEMPT', 'Exempt', 0.00, '03'),
  ('DEEMED', 'Deemed VAT', 18.00, '04')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 4. CATALOG
-- ---------------------------------------------------------------------

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  icon text,
  parent_id uuid references categories(id),
  created_at timestamptz default now()
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  contact_person text,
  phone text,
  email text,
  tin text,
  balance numeric(18,2) default 0,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  sku text,
  barcode text,
  name text not null,
  description text,
  category_id uuid references categories(id),
  supplier_id uuid references suppliers(id),
  unit text default 'pc',
  cost_price numeric(18,2) default 0,     -- stored in base currency
  selling_price numeric(18,2) not null default 0,   -- stored in base currency
  wholesale_price numeric(18,2),
  tax_category_code text references tax_categories(code) default 'STD',
  reorder_level numeric(18,2) default 5,
  batch_number text,
  expiry_date date,
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_products_business on products(business_id);
create index if not exists idx_products_barcode on products(barcode);
create unique index if not exists idx_products_sku on products(business_id, sku) where sku is not null;

create table if not exists product_stock (
  product_id uuid references products(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  quantity numeric(18,2) not null default 0,
  primary key (product_id, branch_id)
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  product_id uuid references products(id),
  type text not null check (type in ('in','out','adjustment','transfer','return','damaged','sale')),
  quantity numeric(18,2) not null,
  reference text,                         -- PO number, sale number, etc.
  notes text,
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 5. CRM (CUSTOMERS)
-- ---------------------------------------------------------------------

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  tin text,                              -- customer TIN for EFRIS B2B invoices
  address text,
  credit_limit numeric(18,2) default 0,
  balance numeric(18,2) default 0,
  loyalty_points numeric(18,2) default 0,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 6. SALES / POS
-- ---------------------------------------------------------------------

create sequence if not exists sale_number_seq start 1;

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  sale_number text unique not null,
  customer_id uuid references customers(id),
  cashier_id uuid references app_users(id),
  currency_code text references currencies(code) not null,
  exchange_rate numeric(18,6) not null default 1,   -- rate to base at time of sale
  subtotal numeric(18,2) not null default 0,        -- in sale currency
  discount_total numeric(18,2) not null default 0,
  vat_total numeric(18,2) not null default 0,
  grand_total numeric(18,2) not null default 0,
  grand_total_base numeric(18,2) not null default 0, -- converted to base currency
  status text not null default 'completed' check (status in ('completed','held','voided','refunded')),
  payment_status text not null default 'paid' check (payment_status in ('paid','partial','unpaid','credit')),
  sale_type text not null default 'retail' check (sale_type in ('retail','quotation','delivery_note')),
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_sales_business on sales(business_id, created_at desc);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,             -- snapshot at time of sale
  quantity numeric(18,2) not null,
  unit_price numeric(18,2) not null,       -- in sale currency
  discount numeric(18,2) default 0,
  tax_category_code text references tax_categories(code),
  vat_rate numeric(5,2) default 0,
  vat_amount numeric(18,2) default 0,
  line_total numeric(18,2) not null
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  method text not null check (method in ('cash','mobile_money','bank','card','credit')),
  provider text,                          -- e.g. MTN, Airtel, Visa
  currency_code text references currencies(code) not null,
  amount numeric(18,2) not null,          -- in payment currency
  amount_base numeric(18,2) not null,     -- converted to base currency
  reference text,
  received_by uuid references app_users(id),
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 7. SUPPLIERS / PURCHASING
-- ---------------------------------------------------------------------

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  po_number text unique not null,
  status text default 'draft' check (status in ('draft','ordered','received','cancelled')),
  expected_date date,
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid references purchase_orders(id) on delete cascade,
  product_id uuid references products(id),
  quantity numeric(18,2) not null,
  unit_cost numeric(18,2) not null
);

create table if not exists supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  amount numeric(18,2) not null,
  currency_code text references currencies(code),
  method text,
  reference text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 8. EFRIS (URA E-INVOICING) READINESS LAYER
-- No live URA connection is made by default — this stages fiscal
-- invoices in EFRIS-compatible structure, ready for API integration.
-- ---------------------------------------------------------------------

create sequence if not exists fiscal_invoice_seq start 1;

create table if not exists efris_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  sale_id uuid references sales(id) on delete cascade,
  fiscal_invoice_number text unique not null,
  invoice_type text not null default 'normal'
    check (invoice_type in ('normal','copy','proforma','credit_note','training')),
  supplier_tin text,
  customer_tin text,
  customer_name text,
  currency_code text,
  gross_amount numeric(18,2),
  vat_amount numeric(18,2),
  status text not null default 'pending'
    check (status in ('pending','queued','submitted','accepted','rejected','failed')),
  qr_code text,                          -- populated once EFRIS returns a verification code
  antifake_code text,                    -- EFRIS anti-fake code (returned by URA on success)
  payload_json jsonb,                    -- full EFRIS-ready request payload
  response_json jsonb,                   -- raw URA response, once integrated
  error_message text,
  submitted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists efris_queue (
  id uuid primary key default gen_random_uuid(),
  efris_invoice_id uuid references efris_invoices(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  retries int default 0,
  last_error text,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 9. AUDIT TRAIL
-- ---------------------------------------------------------------------

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  user_id uuid references app_users(id),
  action text not null,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 10. HELPER FUNCTIONS / TRIGGERS
-- ---------------------------------------------------------------------

create or replace function next_sale_number() returns text as $$
begin
  return 'INV-' || lpad(nextval('sale_number_seq')::text, 6, '0');
end;
$$ language plpgsql;

create or replace function next_fiscal_invoice_number() returns text as $$
begin
  return 'FDN-' || lpad(nextval('fiscal_invoice_seq')::text, 6, '0');
end;
$$ language plpgsql;

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at before update on products
  for each row execute function set_updated_at();

-- Decrement stock automatically when a sale_item is inserted
create or replace function apply_sale_stock() returns trigger as $$
declare
  v_branch uuid;
  v_business uuid;
begin
  select branch_id, business_id into v_branch, v_business from sales where id = new.sale_id;

  insert into product_stock (product_id, branch_id, quantity)
  values (new.product_id, v_branch, -new.quantity)
  on conflict (product_id, branch_id)
  do update set quantity = product_stock.quantity - new.quantity;

  insert into stock_movements (business_id, branch_id, product_id, type, quantity, reference, created_at)
  values (v_business, v_branch, new.product_id, 'sale', new.quantity, new.sale_id::text, now());

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_apply_sale_stock on sale_items;
create trigger trg_apply_sale_stock after insert on sale_items
  for each row execute function apply_sale_stock();

-- ---------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY (basic business-scoped isolation)
-- ---------------------------------------------------------------------

-- IMPORTANT: every table below that has RLS enabled MUST have a matching
-- policy, otherwise Postgres blocks ALL access to it (including your own
-- app) by default. If you add RLS to more tables later, always pair it
-- with a policy in the same migration.
--
-- A policy on app_users that queries app_users itself would recurse
-- infinitely, so we read the caller's business_id through this
-- `security definer` helper instead — it runs with elevated privileges
-- and bypasses RLS internally, breaking the loop.
create or replace function auth_business_id() returns uuid
language sql security definer stable as $$
  select business_id from app_users where id = auth.uid()
$$;

alter table businesses enable row level security;
alter table app_users enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table customers enable row level security;
alter table payments enable row level security;
alter table efris_invoices enable row level security;

-- businesses: a user may read/update only their own business
drop policy if exists business_isolation_businesses on businesses;
create policy business_isolation_businesses on businesses
  for select using (id = auth_business_id());

drop policy if exists business_update_businesses on businesses;
create policy business_update_businesses on businesses
  for update using (id = auth_business_id())
  with check (id = auth_business_id());

-- app_users: read/update teammates in the same business (client-side role
-- checks gate who can actually edit — see uganda-pos-view-settings.js)
drop policy if exists business_isolation_app_users on app_users;
create policy business_isolation_app_users on app_users
  for select using (business_id = auth_business_id());

drop policy if exists business_update_app_users on app_users;
create policy business_update_app_users on app_users
  for update using (business_id = auth_business_id())
  with check (business_id = auth_business_id());

drop policy if exists business_isolation_products on products;
create policy business_isolation_products on products
  for all using (business_id = auth_business_id())
  with check (business_id = auth_business_id());

drop policy if exists business_isolation_sales on sales;
create policy business_isolation_sales on sales
  for all using (business_id = auth_business_id())
  with check (business_id = auth_business_id());

drop policy if exists business_isolation_customers on customers;
create policy business_isolation_customers on customers
  for all using (business_id = auth_business_id())
  with check (business_id = auth_business_id());

drop policy if exists business_isolation_efris on efris_invoices;
create policy business_isolation_efris on efris_invoices
  for all using (business_id = auth_business_id())
  with check (business_id = auth_business_id());

-- sale_items / payments have no business_id column of their own — isolate
-- them through their parent sale instead. Required, since RLS is enabled
-- above on both tables.
drop policy if exists business_isolation_sale_items on sale_items;
create policy business_isolation_sale_items on sale_items
  for all using (sale_id in (select id from sales where business_id = auth_business_id()))
  with check (sale_id in (select id from sales where business_id = auth_business_id()));

drop policy if exists business_isolation_payments on payments;
create policy business_isolation_payments on payments
  for all using (sale_id in (select id from sales where business_id = auth_business_id()))
  with check (sale_id in (select id from sales where business_id = auth_business_id()));

-- NOTE: branches, currencies, exchange_rates, categories, suppliers,
-- product_stock, stock_movements, purchase_orders/_items, supplier_payments,
-- tax_categories, efris_queue and audit_log do not have RLS enabled yet —
-- they're reachable by any authenticated user for now. Add business-scoped
-- policies (same pattern as above) before storing real multi-tenant data.
-- =====================================================================
-- END OF SCHEMA — next run uganda-pos-seed.sql to load starter data
-- =====================================================================
