-- =====================================================================
-- QWICKPOS — SCHEMA V8D
-- Create missing tables: coupons, gift_cards, leads, deliveries
-- =====================================================================

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
