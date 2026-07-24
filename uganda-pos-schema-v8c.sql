-- =====================================================================
-- QWICKPOS — SCHEMA V8C
-- Add missing columns and tables across multiple tables
-- =====================================================================

-- Orders table (referenced by uganda-pos-view-orders.js, not in base schema)
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  customer_id uuid references customers(id),
  order_number text,
  status text default 'pending',
  total_base numeric(18,2) default 0,
  items_count integer default 0,
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

alter table orders enable row level security;
drop policy if exists orders_select on orders;
create policy orders_select on orders for select using (business_id = auth_business_id() OR is_superadmin());
drop policy if exists orders_insert on orders;
create policy orders_insert on orders for insert with check (business_id = auth_business_id());
drop policy if exists orders_update on orders;
create policy orders_update on orders for update using (business_id = auth_business_id()) with check (business_id = auth_business_id());
drop policy if exists orders_delete on orders;
create policy orders_delete on orders for delete using (business_id = auth_business_id() OR is_superadmin());

-- Branches: add missing columns
alter table branches add column if not exists email text;
alter table branches add column if not exists is_active boolean default true;
alter table branches add column if not exists location text;
alter table branches add column if not exists contact_person text;

-- Suppliers: add missing address column
alter table suppliers add column if not exists address text;

-- Customers: add missing notes column (used in POS Add Customer modal)
alter table customers add column if not exists notes text;

-- Products: add missing brand_id column (links to brands table from v5)
alter table products add column if not exists brand_id uuid references brands(id);

-- Businesses: document template config columns
alter table businesses add column if not exists tpl_primary_color text default '#0f6b4a';
alter table businesses add column if not exists tpl_font_size text default '13';
alter table businesses add column if not exists tpl_invoice_title text default 'TAX INVOICE';
alter table businesses add column if not exists tpl_footer_text text default 'Thank you for your business!';
alter table businesses add column if not exists tpl_show_logo boolean default true;
alter table businesses add column if not exists tpl_show_name boolean default true;
alter table businesses add column if not exists tpl_show_tin boolean default true;
alter table businesses add column if not exists tpl_show_addr boolean default true;
alter table businesses add column if not exists tpl_show_phone boolean default true;
alter table businesses add column if not exists tpl_show_email boolean default false;
alter table businesses add column if not exists tpl_show_date boolean default true;
alter table businesses add column if not exists tpl_show_inv boolean default true;
alter table businesses add column if not exists tpl_show_server boolean default true;
alter table businesses add column if not exists tpl_show_tax boolean default true;
alter table businesses add column if not exists tpl_show_disc boolean default true;
alter table businesses add column if not exists tpl_show_footer boolean default true;

-- Businesses: messaging config columns
alter table businesses add column if not exists email_from_name text;
alter table businesses add column if not exists email_from text;
alter table businesses add column if not exists email_signature text;
alter table businesses add column if not exists email_enabled boolean default false;
alter table businesses add column if not exists smtp_host text;
alter table businesses add column if not exists smtp_port text default '587';
alter table businesses add column if not exists smtp_username text;
alter table businesses add column if not exists smtp_password text;
alter table businesses add column if not exists whatsapp_number text;
alter table businesses add column if not exists whatsapp_provider text;
alter table businesses add column if not exists whatsapp_api_key text;
alter table businesses add column if not exists whatsapp_enabled boolean default false;
