-- =====================================================================
-- QWICKPOS — SCHEMA V8D
-- Create missing tables, add missing columns, fix stock trigger, taxes
-- =====================================================================

-- Add branch_id to purchase_orders (missing from original schema)
alter table purchase_orders add column if not exists branch_id uuid references branches(id);

-- ═══════════════════════════════════════════════════════════════════════
-- FIX STOCK TRIGGER: SECURITY DEFINER to bypass RLS on product_stock
-- ═══════════════════════════════════════════════════════════════════════
create or replace function apply_sale_stock() returns trigger as $$
declare
  v_branch uuid;
  v_business uuid;
  v_sale_type text;
begin
  select branch_id, business_id, sale_type into v_branch, v_business, v_sale_type from sales where id = new.sale_id;

  if v_sale_type = 'quotation' then
    return new;
  end if;

  insert into product_stock (product_id, branch_id, quantity)
  values (new.product_id, v_branch, -new.quantity)
  on conflict (product_id, branch_id)
  do update set quantity = product_stock.quantity - new.quantity;

  insert into stock_movements (business_id, branch_id, product_id, type, quantity, reference, created_at)
  values (v_business, v_branch, new.product_id, 'sale', new.quantity, new.sale_id::text, now());

  return new;
end;
$$ language plpgsql security definer;

-- Ensure trigger exists on sale_items
drop trigger if exists trg_apply_sale_stock on sale_items;
create trigger trg_apply_sale_stock after insert on sale_items
  for each row execute function apply_sale_stock();

-- ═══════════════════════════════════════════════════════════════════════
-- FIX TAX CATEGORIES: ensure seed data exists
-- ═══════════════════════════════════════════════════════════════════════
insert into tax_categories (code, name, rate, efris_tax_code) values
  ('STD', 'Standard Rated (18%)', 18.00, '01'),
  ('ZERO', 'Zero Rated', 0.00, '02'),
  ('EXEMPT', 'Exempt', 0.00, '03'),
  ('DEEMED', 'Deemed VAT', 18.00, '04')
on conflict (code) do nothing;

-- Coupons
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  code text not null,
  discount_type text default 'percentage',
  discount_value numeric(18,2) default 0,
  description text,
  max_uses integer default 0,
  uses_count integer default 0,
  expires_at timestamptz,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table coupons enable row level security;
drop policy if exists business_isolation_coupons on coupons;
create policy business_isolation_coupons on coupons for all
  using (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true))
  with check (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true));

-- Gift Cards
create table if not exists gift_cards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  code text not null,
  recipient_name text,
  recipient_email text,
  initial_amount numeric(18,2) default 0,
  balance numeric(18,2) default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table gift_cards enable row level security;
drop policy if exists business_isolation_gift_cards on gift_cards;
create policy business_isolation_gift_cards on gift_cards for all
  using (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true))
  with check (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true));

-- Leads
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  company text,
  source text,
  status text default 'new',
  notes text,
  assigned_to uuid references app_users(id),
  created_at timestamptz default now()
);

alter table leads enable row level security;
drop policy if exists business_isolation_leads on leads;
create policy business_isolation_leads on leads for all
  using (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true))
  with check (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true));

-- Deliveries
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  order_id uuid references orders(id),
  customer_id uuid references customers(id),
  address text,
  status text default 'pending',
  scheduled_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

alter table deliveries enable row level security;
drop policy if exists business_isolation_deliveries on deliveries;
create policy business_isolation_deliveries on deliveries for all
  using (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true))
  with check (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true));
