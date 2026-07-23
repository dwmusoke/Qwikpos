-- =====================================================================
-- QWICKPOS — SCHEMA V5
-- Brands, Units, Product Variants, Sales Returns, Purchase Requests,
-- Purchase Returns, Pending Payments
-- =====================================================================

-- ── BRANDS ───────────────────────────────────────────────────────────
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  logo_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);
create index if not exists idx_brands_business on brands(business_id);

-- ── UNITS ────────────────────────────────────────────────────────────
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  abbreviation text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);
create index if not exists idx_units_business on units(business_id);

-- Seed default units
insert into units (business_id, name, abbreviation) values
  -- We'll insert per-business via RPC; these are just reference values
  -- The actual seed happens via the UI or a helper function
(null, 'Piece', 'pc'),
(null, 'Kilogram', 'kg'),
(null, 'Gram', 'g'),
(null, 'Litre', 'L'),
(null, 'Millilitre', 'mL'),
(null, 'Box', 'box'),
(null, 'Carton', 'ctn'),
(null, 'Pack', 'pk'),
(null, 'Bag', 'bag'),
(null, 'Bottle', 'btl'),
(null, 'Can', 'can'),
(null, 'Roll', 'roll'),
(null, 'Metre', 'm'),
(null, 'Centimetre', 'cm'),
(null, 'Pair', 'pair'),
(null, 'Set', 'set'),
(null, 'Dozen', 'dz')
on conflict do nothing;

-- ── BRANDS ON PRODUCTS ───────────────────────────────────────────────
alter table products add column if not exists brand_id uuid references brands(id);

-- ── PRODUCT VARIANTS ─────────────────────────────────────────────────
create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  sku text,
  barcode text,
  cost_price numeric(18,2),
  selling_price numeric(18,2),
  wholesale_price numeric(18,2),
  attributes jsonb default '{}',
  is_active boolean default true,
  created_at timestamptz default now()
);
create index if not exists idx_variants_product on product_variants(product_id);
create index if not exists idx_variants_business on product_variants(business_id);

-- Stock per variant per branch
create table if not exists variant_stock (
  variant_id uuid references product_variants(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  quantity numeric(18,2) not null default 0,
  primary key (variant_id, branch_id)
);

-- ── SALES RETURNS ────────────────────────────────────────────────────
create table if not exists sales_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  sale_id uuid references sales(id),
  return_number text,
  reason text,
  refund_amount numeric(18,2) default 0,
  refund_method text default 'cash' check (refund_method in ('cash','mobile_money','bank','card','credit','exchange')),
  status text default 'pending' check (status in ('pending','approved','completed','rejected')),
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);
create index if not exists idx_returns_business on sales_returns(business_id);
create index if not exists idx_returns_sale on sales_returns(sale_id);

create table if not exists sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid references sales_returns(id) on delete cascade,
  sale_item_id uuid references sale_items(id),
  product_id uuid references products(id),
  variant_id uuid references product_variants(id),
  quantity numeric(18,2) not null default 0,
  unit_price numeric(18,2) default 0,
  refund_amount numeric(18,2) default 0,
  created_at timestamptz default now()
);
create index if not exists idx_return_items_return on sale_return_items(return_id);

-- ── PURCHASE REQUESTS ────────────────────────────────────────────────
create table if not exists purchase_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  request_number text,
  status text default 'draft' check (status in ('draft','submitted','approved','rejected','converted')),
  notes text,
  requested_by uuid references app_users(id),
  approved_by uuid references app_users(id),
  approved_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_preq_business on purchase_requests(business_id);

create table if not exists purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references purchase_requests(id) on delete cascade,
  product_id uuid references products(id),
  variant_id uuid references product_variants(id),
  quantity numeric(18,2) not null default 0,
  estimated_cost numeric(18,2) default 0,
  notes text,
  created_at timestamptz default now()
);
create index if not exists idx_preq_items_request on purchase_request_items(request_id);

-- ── PURCHASE RETURNS ─────────────────────────────────────────────────
create table if not exists purchase_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  purchase_order_id uuid references purchase_orders(id),
  supplier_id uuid references suppliers(id),
  return_number text,
  reason text,
  refund_amount numeric(18,2) default 0,
  status text default 'pending' check (status in ('pending','approved','completed','rejected')),
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);
create index if not exists idx_pret_business on purchase_returns(business_id);
create index if not exists idx_pret_supplier on purchase_returns(supplier_id);

create table if not exists purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid references purchase_returns(id) on delete cascade,
  po_item_id uuid references purchase_order_items(id),
  product_id uuid references products(id),
  variant_id uuid references product_variants(id),
  quantity numeric(18,2) not null default 0,
  unit_cost numeric(18,2) default 0,
  refund_amount numeric(18,2) default 0,
  created_at timestamptz default now()
);
create index if not exists idx_pret_items_return on purchase_return_items(return_id);

-- ── UNITS SEED PER BUSINESS (RPC) ────────────────────────────────────
create or replace function seed_default_units(p_business_id uuid)
returns void as $$
begin
  insert into units (business_id, name, abbreviation) values
    (p_business_id, 'Piece', 'pc'),
    (p_business_id, 'Kilogram', 'kg'),
    (p_business_id, 'Gram', 'g'),
    (p_business_id, 'Litre', 'L'),
    (p_business_id, 'Millilitre', 'mL'),
    (p_business_id, 'Box', 'box'),
    (p_business_id, 'Carton', 'ctn'),
    (p_business_id, 'Pack', 'pk'),
    (p_business_id, 'Bag', 'bag'),
    (p_business_id, 'Bottle', 'btl'),
    (p_business_id, 'Can', 'can'),
    (p_business_id, 'Roll', 'roll'),
    (p_business_id, 'Metre', 'm'),
    (p_business_id, 'Centimetre', 'cm'),
    (p_business_id, 'Pair', 'pair'),
    (p_business_id, 'Set', 'set'),
    (p_business_id, 'Dozen', 'dz')
  on conflict do nothing;
end;
$$ language plpgsql;

-- ── RETURN NUMBER GENERATORS ─────────────────────────────────────────
create or replace function next_return_number()
returns text as $$
declare
  n bigint;
begin
  select count(*) + 1 into n from sales_returns where business_id = auth.uid();
  return 'RET-' || lpad(n::text, 5, '0');
end;
$$ language plpgsql;

create or replace function next_purchase_return_number()
returns text as $$
declare
  n bigint;
begin
  select count(*) + 1 into n from purchase_returns where business_id = auth.uid();
  return 'PR-' || lpad(n::text, 5, '0');
end;
$$ language plpgsql;

create or replace function next_request_number()
returns text as $$
declare
  n bigint;
begin
  select count(*) + 1 into n from purchase_requests where business_id = auth.uid();
  return 'PRQ-' || lpad(n::text, 5, '0');
end;
$$ language plpgsql;

-- ── RLS POLICIES ─────────────────────────────────────────────────────
alter table brands enable row level security;
alter table units enable row level security;
alter table product_variants enable row level security;
alter table variant_stock enable row level security;
alter table sales_returns enable row level security;
alter table sale_return_items enable row level security;
alter table purchase_requests enable row level security;
alter table purchase_request_items enable row level security;
alter table purchase_returns enable row level security;
alter table purchase_return_items enable row level security;

-- Brands
create policy "brands_isolated" on brands for all using (business_id = auth_business_id());
create policy "brands_anon" on brands for select using (true);

-- Units
create policy "units_isolated" on units for all using (business_id = auth_business_id());
create policy "units_anon" on units for select using (true);

-- Product variants
create policy "variants_isolated" on product_variants for all using (business_id = auth_business_id());
create policy "variants_anon" on product_variants for select using (true);

-- Variant stock
create policy "variant_stock_isolated" on variant_stock for all using (
  exists (select 1 from product_variants pv where pv.id = variant_id and pv.business_id = auth_business_id())
);
create policy "variant_stock_anon" on variant_stock for select using (true);

-- Sales returns
create policy "returns_isolated" on sales_returns for all using (business_id = auth_business_id());
create policy "returns_anon" on sales_returns for select using (true);

-- Sale return items
create policy "return_items_isolated" on sale_return_items for all using (
  exists (select 1 from sales_returns sr where sr.id = return_id and sr.business_id = auth_business_id())
);
create policy "return_items_anon" on sale_return_items for select using (true);

-- Purchase requests
create policy "preq_isolated" on purchase_requests for all using (business_id = auth_business_id());
create policy "preq_anon" on purchase_requests for select using (true);

-- Purchase request items
create policy "preq_items_isolated" on purchase_request_items for all using (
  exists (select 1 from purchase_requests pr where pr.id = request_id and pr.business_id = auth_business_id())
);
create policy "preq_items_anon" on purchase_request_items for select using (true);

-- Purchase returns
create policy "pret_isolated" on purchase_returns for all using (business_id = auth_business_id());
create policy "pret_anon" on purchase_returns for select using (true);

-- Purchase return items
create policy "pret_items_isolated" on purchase_return_items for all using (
  exists (select 1 from purchase_returns pr where pr.id = return_id and pr.business_id = auth_business_id())
);
create policy "pret_items_anon" on purchase_return_items for select using (true);
