-- =====================================================================
-- ADD BRANDS SUPPORT
-- Run this in Supabase SQL Editor after the main schema
-- =====================================================================

-- 1. Create brands table
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists idx_brands_business on brands(business_id);

-- 2. Add brand_id to products
alter table products add column if not exists brand_id uuid references brands(id);

create index if not exists idx_products_brand on products(brand_id);

-- 3. RLS policies
alter table brands enable row level security;

drop policy if exists brands_isolation on brands;
create policy brands_isolation on brands
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

-- 4. Helper function to get brands (if needed for bootstrap)
-- Brands are loaded in loadBootstrapData() in uganda-pos-core.js