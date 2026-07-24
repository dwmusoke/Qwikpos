-- =====================================================================
-- QWICKPOS — SCHEMA V8C
-- Add missing columns, tables, and fix RLS policies
-- =====================================================================

-- Fix is_superadmin() to also check auth.users metadata as fallback
create or replace function is_superadmin() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true
  )
  or
  exists (
    select 1 from auth.users where id = auth.uid() and raw_app_meta_data->>'role' = 'superadmin'
  );
$$;

create or replace function auth_business_id() returns uuid
language sql security definer stable as $$
  select business_id from app_users where id = auth.uid()
$$;

-- SECURITY DEFINER branch creation — bypasses RLS completely
create or replace function create_branch(
  p_business_id uuid,
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_location text default null,
  p_contact_person text default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_branch jsonb;
begin
  insert into branches (business_id, name, is_main, is_active, phone, email, address, location, contact_person)
  values (p_business_id, p_name, false, true, p_phone, p_email, p_address, p_location, p_contact_person)
  returning to_jsonb(branches.*) into v_branch;
  return v_branch;
end;
$$;
grant execute on function create_branch(uuid, text, text, text, text, text, text) to authenticated;

-- SECURITY DEFINER branch update — bypasses RLS completely
create or replace function update_branch(
  p_branch_id uuid,
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_location text default null,
  p_contact_person text default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_branch jsonb;
begin
  update branches set
    name = p_name,
    phone = p_phone,
    email = p_email,
    address = p_address,
    location = p_location,
    contact_person = p_contact_person
  where id = p_branch_id
  returning to_jsonb(branches.*) into v_branch;
  return v_branch;
end;
$$;
grant execute on function update_branch(uuid, text, text, text, text, text, text) to authenticated;

-- SECURITY DEFINER branch delete — bypasses RLS completely
create or replace function delete_branch(
  p_branch_id uuid
) returns void
language plpgsql security definer as $$
begin
  delete from branches where id = p_branch_id;
end;
$$;
grant execute on function delete_branch(uuid) to authenticated;

-- Fix branches RLS — drop and recreate with proper policies
alter table branches enable row level security;
drop policy if exists business_isolation_branches on branches;
create policy business_isolation_branches on branches
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

-- Storage buckets: ensure they exist and are public
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true)
    ON CONFLICT (id) DO UPDATE SET public = true;
  INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true)
    ON CONFLICT (id) DO UPDATE SET public = true;
END $$;

-- Remove ALL existing policies on storage.objects (clean slate)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Full access policies for logos bucket
CREATE POLICY "logos_all" ON storage.objects
  FOR ALL USING (bucket_id = 'logos')
  WITH CHECK (bucket_id = 'logos');

-- Full access policies for product-images bucket
CREATE POLICY "product_images_all" ON storage.objects
  FOR ALL USING (bucket_id = 'product-images')
  WITH CHECK (bucket_id = 'product-images');

-- Fix product_stock RLS policy (inline superadmin check — more reliable)
alter table product_stock enable row level security;
drop policy if exists business_isolation_product_stock on product_stock;
create policy business_isolation_product_stock on product_stock
  for all using (
    branch_id in (select id from branches where business_id = auth_business_id())
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true)
  )
  with check (
    branch_id in (select id from branches where business_id = auth_business_id())
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true)
  );

-- Fix stock_movements RLS policy
alter table stock_movements enable row level security;
drop policy if exists business_isolation_stock_movements on stock_movements;
create policy business_isolation_stock_movements on stock_movements
  for all using (
    business_id in (select id from businesses)
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true)
  )
  with check (
    business_id in (select id from businesses)
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true)
  );

-- SECURITY DEFINER stock upsert — bypasses RLS on product_stock
create or replace function upsert_product_stock(p_product_id uuid, p_branch_id uuid, p_quantity numeric)
returns void
language plpgsql security definer as $$
begin
  insert into product_stock (product_id, branch_id, quantity)
  values (p_product_id, p_branch_id, p_quantity)
  on conflict (product_id, branch_id) do update set quantity = p_quantity;
end;
$$;
grant execute on function upsert_product_stock(uuid, uuid, numeric) to authenticated;

-- SECURITY DEFINER stock movement insert — bypasses RLS on stock_movements
create or replace function insert_stock_movement(
  p_business_id uuid, p_branch_id uuid, p_product_id uuid,
  p_type text, p_quantity numeric, p_notes text, p_created_by uuid
) returns void
language plpgsql security definer as $$
begin
  insert into stock_movements (business_id, branch_id, product_id, type, quantity, notes, created_by)
  values (p_business_id, p_branch_id, p_product_id, p_type, p_quantity, p_notes, p_created_by);
end;
$$;
grant execute on function insert_stock_movement(uuid, uuid, uuid, text, numeric, text, uuid) to authenticated;

-- SECURITY DEFINER supplier insert/update — bypasses RLS
create or replace function upsert_supplier(
  p_business_id uuid,
  p_name text,
  p_contact_person text default null,
  p_phone text default null,
  p_email text default null,
  p_tin text default null,
  p_address text default null,
  p_id uuid default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_supplier jsonb;
begin
  if p_id is null then
    insert into suppliers (business_id, name, contact_person, phone, email, tin, address)
    values (p_business_id, p_name, p_contact_person, p_phone, p_email, p_tin, p_address)
    returning to_jsonb(suppliers.*) into v_supplier;
  else
    update suppliers set
      name = p_name, contact_person = p_contact_person, phone = p_phone,
      email = p_email, tin = p_tin, address = p_address
    where id = p_id
    returning to_jsonb(suppliers.*) into v_supplier;
  end if;
  return v_supplier;
end;
$$;
grant execute on function upsert_supplier(uuid, text, text, text, text, text, text, uuid) to authenticated;

-- SECURITY DEFINER supplier delete — bypasses RLS
create or replace function delete_supplier(p_id uuid) returns void
language plpgsql security definer as $$
begin
  delete from suppliers where id = p_id;
end;
$$;
grant execute on function delete_supplier(uuid) to authenticated;

-- SECURITY DEFINER product insert/update — bypasses RLS
create or replace function upsert_product(
  p_business_id uuid,
  p_name text,
  p_sku text default null,
  p_barcode text default null,
  p_description text default null,
  p_category_id uuid default null,
  p_supplier_id uuid default null,
  p_unit text default null,
  p_cost_price numeric default 0,
  p_selling_price numeric default 0,
  p_wholesale_price numeric default 0,
  p_tax_category_code text default null,
  p_reorder_level numeric default 0,
  p_image_url text default null,
  p_is_active boolean default true,
  p_brand_id uuid default null,
  p_id uuid default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_product jsonb;
begin
  if p_id is null then
    insert into products (business_id, name, sku, barcode, description, category_id, supplier_id, unit,
      cost_price, selling_price, wholesale_price, tax_category_code, reorder_level, image_url, is_active, brand_id)
    values (p_business_id, p_name, p_sku, p_barcode, p_description, p_category_id, p_supplier_id, p_unit,
      p_cost_price, p_selling_price, p_wholesale_price, p_tax_category_code, p_reorder_level, p_image_url, p_is_active, p_brand_id)
    returning to_jsonb(products.*) into v_product;
  else
    update products set
      name = p_name, sku = p_sku, barcode = p_barcode, description = p_description,
      category_id = p_category_id, supplier_id = p_supplier_id, unit = p_unit,
      cost_price = p_cost_price, selling_price = p_selling_price, wholesale_price = p_wholesale_price,
      tax_category_code = p_tax_category_code, reorder_level = p_reorder_level,
      image_url = p_image_url, is_active = p_is_active, brand_id = p_brand_id
    where id = p_id
    returning to_jsonb(products.*) into v_product;
  end if;
  return v_product;
end;
$$;

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

-- Refresh PostgREST schema cache so new RPC functions are immediately available
notify pgrst, 'reload schema';
