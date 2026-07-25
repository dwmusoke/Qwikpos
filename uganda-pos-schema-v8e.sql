-- =====================================================================
-- QWICKPOS — SCHEMA V8E
-- Batch tracking, expiry management, enhanced stock counts
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- 1. STOCK BATCHES — per-batch quantity tracking with expiry dates
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists stock_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  batch_number text not null,
  expiry_date date,
  quantity numeric(18,2) not null default 0,
  cost_price numeric(18,2) default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_stock_batches_product_branch on stock_batches(product_id, branch_id);
create index if not exists idx_stock_batches_expiry on stock_batches(expiry_date) where expiry_date is not null;

alter table stock_batches enable row level security;
drop policy if exists business_isolation_stock_batches on stock_batches;
create policy business_isolation_stock_batches on stock_batches for all
  using (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true))
  with check (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. STOCK COUNTS — header table for count sessions
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists stock_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  count_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft','in_progress','completed','cancelled')),
  notes text,
  counted_by uuid references app_users(id),
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table stock_counts enable row level security;
drop policy if exists business_isolation_stock_counts on stock_counts;
create policy business_isolation_stock_counts on stock_counts for all
  using (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true))
  with check (business_id = auth_business_id()
    or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true));

-- ═══════════════════════════════════════════════════════════════════════
-- 3. STOCK COUNT ITEMS — per-product rows within a count session
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists stock_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid references stock_counts(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  system_qty numeric(18,2) not null default 0,
  counted_qty numeric(18,2) not null default 0,
  variance numeric(18,2) generated always as (counted_qty - system_qty) stored,
  batch_id uuid references stock_batches(id),
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_stock_count_items_count on stock_count_items(count_id);

alter table stock_count_items enable row level security;
drop policy if exists business_isolation_stock_count_items on stock_count_items;
create policy business_isolation_stock_count_items on stock_count_items for all
  using (exists (
    select 1 from stock_counts sc
    where sc.id = stock_count_items.count_id
      and (sc.business_id = auth_business_id()
        or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true))
  ))
  with check (exists (
    select 1 from stock_counts sc
    where sc.id = stock_count_items.count_id
      and (sc.business_id = auth_business_id()
        or exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true))
  ));

-- ═══════════════════════════════════════════════════════════════════════
-- 4. RPC: adjust_stock_batch — create/update batch and sync product_stock
-- ═══════════════════════════════════════════════════════════════════════
create or replace function adjust_stock_batch(
  p_product_id uuid,
  p_branch_id uuid,
  p_batch_number text,
  p_quantity numeric,
  p_expiry_date date default null,
  p_cost_price numeric default 0,
  p_notes text default null
) returns void
language plpgsql security definer as $$
declare
  v_business uuid;
  v_existing numeric;
begin
  select business_id into v_business from products where id = p_product_id;

  -- Upsert the batch
  insert into stock_batches (business_id, branch_id, product_id, batch_number, expiry_date, quantity, cost_price, notes)
  values (v_business, p_branch_id, p_product_id, p_batch_number, p_expiry_date, p_quantity, p_cost_price, p_notes)
  on conflict (business_id, branch_id, product_id, batch_number)
  do update set
    quantity = p_quantity,
    expiry_date = coalesce(p_expiry_date, stock_batches.expiry_date),
    cost_price = case when p_cost_price > 0 then p_cost_price else stock_batches.cost_price end,
    notes = coalesce(p_notes, stock_batches.notes),
    updated_at = now();

  -- Sync product_stock: sum all batches for this product+branch
  select coalesce(sum(quantity), 0) into v_existing
  from stock_batches
  where product_id = p_product_id and branch_id = p_branch_id;

  insert into product_stock (product_id, branch_id, quantity)
  values (p_product_id, p_branch_id, v_existing)
  on conflict (product_id, branch_id)
  do update set quantity = v_existing;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. RPC: delete_stock_batch — remove a batch and sync product_stock
-- ═══════════════════════════════════════════════════════════════════════
create or replace function delete_stock_batch(
  p_batch_id uuid
) returns void
language plpgsql security definer as $$
declare
  v_product uuid;
  v_branch uuid;
  v_total numeric;
begin
  select product_id, branch_id into v_product, v_branch
  from stock_batches where id = p_batch_id;

  delete from stock_batches where id = p_batch_id;

  -- Recalculate total
  select coalesce(sum(quantity), 0) into v_total
  from stock_batches
  where product_id = v_product and branch_id = v_branch;

  insert into product_stock (product_id, branch_id, quantity)
  values (v_product, v_branch, v_total)
  on conflict (product_id, branch_id)
  do update set quantity = v_total;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. RPC: complete_stock_count — apply count variances to stock
-- ═══════════════════════════════════════════════════════════════════════
create or replace function complete_stock_count(
  p_count_id uuid
) returns void
language plpgsql security definer as $$
declare
  v_rec record;
  v_count record;
begin
  select * into v_count from stock_counts where id = p_count_id;

  -- Update status
  update stock_counts set status = 'completed', completed_at = now() where id = p_count_id;

  -- Apply each item's variance
  for v_rec in
    select sci.*, sc.branch_id, sc.business_id
    from stock_count_items sci
    join stock_counts sc on sc.id = sci.count_id
    where sci.count_id = p_count_id and sci.variance != 0
  loop
    -- Update product_stock
    insert into product_stock (product_id, branch_id, quantity)
    values (v_rec.product_id, v_rec.branch_id, v_rec.counted_qty)
    on conflict (product_id, branch_id)
    do update set quantity = v_rec.counted_qty;

    -- Log movement
    insert into stock_movements (business_id, branch_id, product_id, type, quantity, reference, notes, created_by)
    values (v_rec.business_id, v_rec.branch_id, v_rec.product_id, 'adjustment', v_rec.variance,
      'count:' || p_count_id::text, v_rec.notes, v_count.counted_by);

    -- Update batch quantities if batch_id is set
    if v_rec.batch_id is not null then
      update stock_batches set quantity = v_rec.counted_qty, updated_at = now()
        where id = v_rec.batch_id;
    end if;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. VIEW: expiry_alerts — products expiring within 30 days
-- ═══════════════════════════════════════════════════════════════════════
create or replace view expiry_alerts as
select
  sb.*,
  p.name as product_name,
  p.sku,
  b.name as branch_name,
  sb.expiry_date - current_date as days_until_expiry
from stock_batches sb
join products p on p.id = sb.product_id
join branches b on b.id = sb.branch_id
where sb.expiry_date is not null
  and sb.expiry_date <= current_date + interval '30 days'
  and sb.quantity > 0
order by sb.expiry_date asc;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. VIEW: batch_stock_summary — total stock per batch with product info
-- ═══════════════════════════════════════════════════════════════════════
create or replace view batch_stock_summary as
select
  sb.id,
  sb.business_id,
  sb.branch_id,
  sb.product_id,
  p.name as product_name,
  p.sku,
  p.unit,
  b.name as branch_name,
  sb.batch_number,
  sb.expiry_date,
  sb.quantity,
  sb.cost_price,
  sb.cost_price * sb.quantity as total_cost,
  sb.notes,
  sb.created_at,
  case
    when sb.expiry_date is null then 'no_expiry'
    when sb.expiry_date < current_date then 'expired'
    when sb.expiry_date <= current_date + interval '7 days' then 'expiring_7d'
    when sb.expiry_date <= current_date + interval '30 days' then 'expiring_30d'
    else 'ok'
  end as expiry_status
from stock_batches sb
join products p on p.id = sb.product_id
join branches b on b.id = sb.branch_id
where sb.quantity > 0
order by sb.expiry_date nulls last, p.name;
