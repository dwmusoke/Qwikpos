-- =====================================================================
-- QWICKPOS — SCHEMA V15
-- Atomic stock operations + unique constraint on stock_batches.
-- Safe to re-run.
-- =====================================================================

-- 1. Unique constraint on stock_batches (required by adjust_stock_batch upsert)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ux_stock_batches_key') then
    alter table stock_batches add constraint ux_stock_batches_key unique (business_id, branch_id, product_id, batch_number);
  end if;
end $$;

-- 2. Atomic transfer (source deduction + destination addition + two movements)
create or replace function transfer_stock(
  p_business_id uuid,
  p_product_id uuid,
  p_from_branch uuid,
  p_to_branch uuid,
  p_quantity numeric,
  p_notes text default null,
  p_user_id uuid default null
) returns uuid
language plpgsql security definer as $$
declare
  v_from_stock numeric;
  v_transfer_id uuid := gen_random_uuid();
begin
  if p_from_branch = p_to_branch then
    raise exception 'Source and destination must be different';
  end if;
  if p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  -- Lock the source row
  select quantity into v_from_stock from product_stock
    where product_id = p_product_id and branch_id = p_from_branch for update;
  if coalesce(v_from_stock, 0) < p_quantity then
    raise exception 'Insufficient stock at source (available: %)', coalesce(v_from_stock, 0);
  end if;

  -- Deduct source (atomic delta)
  insert into product_stock (product_id, branch_id, quantity)
    values (p_product_id, p_from_branch, -p_quantity)
    on conflict (product_id, branch_id) do update
      set quantity = product_stock.quantity - p_quantity, updated_at = now();

  -- Add destination (atomic delta)
  insert into product_stock (product_id, branch_id, quantity)
    values (p_product_id, p_to_branch, p_quantity)
    on conflict (product_id, branch_id) do update
      set quantity = product_stock.quantity + p_quantity, updated_at = now();

  -- Movements
  insert into stock_movements (business_id, branch_id, product_id, type, quantity, reference, created_by)
    values (p_business_id, p_from_branch, p_product_id, 'transfer', -p_quantity,
            'Transfer out' || coalesce(': ' || p_notes, ''), p_user_id);
  insert into stock_movements (business_id, branch_id, product_id, type, quantity, reference, created_by)
    values (p_business_id, p_to_branch, p_product_id, 'transfer', p_quantity,
            'Transfer in' || coalesce(': ' || p_notes, ''), p_user_id);

  return v_transfer_id;
end;
$$;
grant execute on function transfer_stock(uuid, uuid, uuid, uuid, numeric, text, uuid) to authenticated;

-- 3. Atomic stock adjust (delta-based, replaces fetch-then-write upsert)
create or replace function adjust_product_stock(
  p_product_id uuid,
  p_branch_id uuid,
  p_delta numeric
) returns numeric
language plpgsql security definer as $$
declare
  v_new numeric;
begin
  insert into product_stock (product_id, branch_id, quantity)
    values (p_product_id, p_branch_id, p_delta)
    on conflict (product_id, branch_id) do update
      set quantity = product_stock.quantity + p_delta, updated_at = now()
    returning quantity into v_new;
  return v_new;
end;
$$;
grant execute on function adjust_product_stock(uuid, uuid, numeric) to authenticated;

-- 4. Receive purchase order (flips status + adds stock atomically)
create or replace function receive_purchase_order(p_po_id uuid) returns void
language plpgsql security definer as $$
declare
  r record;
  v_branch uuid;
begin
  select branch_id into v_branch from purchase_orders where id = p_po_id;
  if v_branch is null then raise exception 'PO has no branch'; end if;

  for r in select product_id, quantity from purchase_order_items where po_id = p_po_id loop
    insert into product_stock (product_id, branch_id, quantity)
      values (r.product_id, v_branch, r.quantity)
      on conflict (product_id, branch_id) do update
        set quantity = product_stock.quantity + r.quantity, updated_at = now();
    insert into stock_movements (business_id, branch_id, product_id, type, quantity, reference, created_by)
      select business_id, v_branch, r.product_id, 'in', r.quantity, 'PO received: ' || po_number, null
      from purchase_orders where id = p_po_id;
  end loop;

  update purchase_orders set status = 'received', received_at = now() where id = p_po_id;
end;
$$;
grant execute on function receive_purchase_order(uuid) to authenticated;

-- =====================================================================
-- END OF SCHEMA V15
-- =====================================================================
