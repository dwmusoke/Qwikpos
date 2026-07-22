-- =====================================================================
-- QWICKPOS — SCHEMA V4
-- Run AFTER uganda-pos-schema-v3.sql.
-- Adds: production/BOM, inventory valuation tracking.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BILL OF MATERIALS (BOM) / RECIPES
--    A "finished product" is made from "component products". Each BOM
--    line says "1 unit of finished_product requires qty units of
--    component_product".
-- ---------------------------------------------------------------------
create table if not exists bom (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  finished_product_id uuid references products(id) on delete cascade,
  name text,                              -- optional: "Standard Bundle", "Gift Pack"
  yield_qty numeric(18,2) default 1,      -- how many units of finished product one build produces
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table bom enable row level security;

drop policy if exists business_isolation_bom on bom;
create policy business_isolation_bom on bom
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

create table if not exists bom_items (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid references bom(id) on delete cascade,
  component_product_id uuid references products(id) on delete cascade,
  quantity numeric(18,2) not null default 1
);

alter table bom_items enable row level security;

drop policy if exists business_isolation_bom_items on bom_items;
create policy business_isolation_bom_items on bom_items
  for all using (
    bom_id in (select id from bom where business_id = auth_business_id())
    or is_superadmin()
  ) with check (
    bom_id in (select id from bom where business_id = auth_business_id())
    or is_superadmin()
  );

-- ---------------------------------------------------------------------
-- 2. PRODUCTION LOGS (assemble / disassemble history)
-- ---------------------------------------------------------------------
create table if not exists production_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  bom_id uuid references bom(id),
  finished_product_id uuid references products(id),
  action text not null check (action in ('assemble', 'disassemble')),
  quantity numeric(18,2) not null,
  notes text,
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

alter table production_logs enable row level security;

drop policy if exists business_isolation_production_logs on production_logs;
create policy business_isolation_production_logs on production_logs
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

-- ---------------------------------------------------------------------
-- 3. INVENTORY VALUATION SNAPSHOT
--    Records the total stock value at a point in time, per branch or
--    business-wide, for reporting and COGS calculation.
-- ---------------------------------------------------------------------
create table if not exists inventory_valuations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  snapshot_date date not null default current_date,
  total_items numeric(18,2) default 0,
  total_cost_value numeric(18,2) default 0,
  total_retail_value numeric(18,2) default 0,
  notes text,
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

create index if not exists idx_valuations_business on inventory_valuations(business_id, snapshot_date desc);

alter table inventory_valuations enable row level security;

drop policy if exists business_isolation_valuations on inventory_valuations;
create policy business_isolation_valuations on inventory_valuations
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

-- ---------------------------------------------------------------------
-- 4. PRODUCT COST TRACKING (FIFO layers)
--    Each stock-in movement records the unit cost at that time. When
--    stock is sold or consumed, we deduct from the oldest cost layer
--    first (FIFO) to calculate accurate COGS.
-- ---------------------------------------------------------------------
create table if not exists stock_cost_layers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  branch_id uuid references branches(id),
  quantity_remaining numeric(18,2) not null default 0,
  unit_cost numeric(18,2) not null,
  source text default 'purchase' check (source in ('purchase', 'production', 'adjustment', 'opening')),
  reference_id uuid,                        -- links to purchase_order_items, production_logs, etc.
  created_at timestamptz default now()
);

create index if not exists idx_cost_layers_product on stock_cost_layers(product_id, branch_id, created_at);

alter table stock_cost_layers enable row level security;

drop policy if exists business_isolation_cost_layers on stock_cost_layers;
create policy business_isolation_cost_layers on stock_cost_layers
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

-- =====================================================================
-- END OF SCHEMA V4
-- =====================================================================
