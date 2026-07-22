-- =====================================================================
-- QWICKPOS — SCHEMA V2
-- Run AFTER uganda-pos-schema.sql + uganda-pos-schema-billing.sql.
-- Adds: real EFRIS provider credentials, EFRIS product fields,
-- quotations (fixes the stock trigger), expenses, and daily SMS summary.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. LIVE EFRIS — per-business provider credentials (e.g. EFRIS Simplified)
--
-- The API key is written by the business admin from Settings but is
-- NEVER readable back from the browser — there is deliberately no SELECT
-- policy for `authenticated` below. Only your edge functions (using the
-- service-role key, which bypasses RLS) can read it. This is the same
-- "write-only secret" pattern as a password field.
-- ---------------------------------------------------------------------
create table if not exists efris_provider_credentials (
  business_id uuid primary key references businesses(id) on delete cascade,
  provider text not null default 'efris_simplified' check (provider in ('efris_simplified', 'weaf')),
  api_key text not null,
  is_active boolean default true,
  updated_at timestamptz default now()
);

alter table efris_provider_credentials enable row level security;

drop policy if exists efris_creds_write on efris_provider_credentials;
create policy efris_creds_write on efris_provider_credentials
  for insert with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists efris_creds_update on efris_provider_credentials;
create policy efris_creds_update on efris_provider_credentials
  for update using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

-- Intentionally no SELECT policy — see comment above.

alter table businesses add column if not exists efris_provider text default 'efris_simplified';
alter table businesses add column if not exists efris_live_enabled boolean default false;

-- ---------------------------------------------------------------------
-- 2. EFRIS PRODUCT FIELDS — required by URA's goods registry
-- ---------------------------------------------------------------------
alter table products add column if not exists efris_commodity_category_id text;
alter table products add column if not exists efris_measure_unit text default '101'; -- 101 = Pieces (EFRIS rateUnit dictionary)
alter table products add column if not exists efris_registered_at timestamptz;

alter table efris_invoices add column if not exists ura_invoice_id text; -- EFRIS's own internal invoiceId (needed later for credit/debit notes)

-- ---------------------------------------------------------------------
-- 3. QUOTATIONS — fix the stock trigger so quotations never touch
--    inventory (a quotation is not a completed sale). Retail sales and
--    delivery notes still deduct stock as before.
-- ---------------------------------------------------------------------
create or replace function apply_sale_stock() returns trigger as $$
declare
  v_branch uuid;
  v_business uuid;
  v_sale_type text;
begin
  select branch_id, business_id, sale_type into v_branch, v_business, v_sale_type from sales where id = new.sale_id;

  if v_sale_type = 'quotation' then
    return new; -- quotations are not fulfilled yet — no stock movement
  end if;

  insert into product_stock (product_id, branch_id, quantity)
  values (new.product_id, v_branch, -new.quantity)
  on conflict (product_id, branch_id)
  do update set quantity = product_stock.quantity - new.quantity;

  insert into stock_movements (business_id, branch_id, product_id, type, quantity, reference, created_at)
  values (v_business, v_branch, new.product_id, 'sale', new.quantity, new.sale_id::text, now());

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 4. EXPENSES — needed for P&L / Cash Flow statements
-- ---------------------------------------------------------------------
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  category text not null,             -- e.g. Rent, Utilities, Salaries, Transport, Airtime
  description text,
  amount numeric(18,2) not null,      -- in the currency below
  currency_code text not null default 'UGX',
  amount_base numeric(18,2) not null, -- converted to base currency at time of entry
  payment_method text default 'cash' check (payment_method in ('cash', 'mobile_money', 'bank', 'card', 'credit')),
  expense_date date not null default current_date,
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

alter table expenses enable row level security;

drop policy if exists business_isolation_expenses on expenses;
create policy business_isolation_expenses on expenses
  for select using (business_id = auth_business_id() or is_superadmin());

drop policy if exists business_insert_expenses on expenses;
create policy business_insert_expenses on expenses
  for insert with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists business_update_expenses on expenses;
create policy business_update_expenses on expenses
  for update using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists business_delete_expenses on expenses;
create policy business_delete_expenses on expenses
  for delete using (
    (business_id = auth_business_id() and is_admin_or_manager())
    or is_superadmin()
  );

-- ---------------------------------------------------------------------
-- 5. DAILY SUMMARY (SMS / WhatsApp)
-- ---------------------------------------------------------------------
alter table businesses add column if not exists daily_summary_enabled boolean default false;
alter table businesses add column if not exists daily_summary_phone text; -- E.164 format, e.g. +2567xxxxxxxx
alter table businesses add column if not exists daily_summary_channel text default 'sms' check (daily_summary_channel in ('sms', 'whatsapp'));

-- ---------------------------------------------------------------------
-- 6. QUOTATIONS — convert-to-sale linkage + expiry
-- ---------------------------------------------------------------------
-- A quotation is just a `sales` row with sale_type = 'quotation' (stock and
-- EFRIS are already skipped for these — see apply_sale_stock() above and
-- the client-side staging check in view-pos.js). "Convert to Sale" does NOT
-- mutate this row's items in place; it creates a brand new sale_type='retail'
-- sale (so the normal stock-deduction trigger and EFRIS staging both fire
-- exactly as they do for any other sale) and links back here.
alter table sales drop constraint if exists sales_status_check;
alter table sales add constraint sales_status_check
  check (status in ('completed', 'held', 'voided', 'refunded', 'converted', 'expired'));

alter table sales add column if not exists converted_sale_id uuid references sales(id);
alter table sales add column if not exists quote_expires_at date;

-- ---------------------------------------------------------------------
-- 7. ACCOUNTING — gate the new Accounting tab (expenses + statements)
-- behind Growth/Pro, same tier as reports_export. Idempotent update in
-- case uganda-pos-schema-billing.sql's plans insert already ran once
-- (its `on conflict do nothing` won't retrofit existing rows).
-- ---------------------------------------------------------------------
update plans set features = features || '{"accounting":false}'::jsonb where code = 'starter' and not (features ? 'accounting');
update plans set features = features || '{"accounting":true}'::jsonb where code in ('growth', 'pro') and not (features ? 'accounting');

-- ---------------------------------------------------------------------
-- 8. RLS HARDENING — the original schema.sql shipped with a documented
-- gap: branches, categories, suppliers, product_stock, stock_movements,
-- purchase_orders/_items and supplier_payments had NO row-level security,
-- meaning any authenticated user (from any business) could read every
-- tenant's supplier/purchasing/stock data. The new Accounting statements
-- (task 26) read directly from purchase_order_items and supplier_payments
-- for the Balance Sheet/Cash Flow, which made this the moment to close it.
-- The client already scopes every query by business_id, so this is
-- defense-in-depth — it does not change any existing app behaviour.
-- currencies/exchange_rates/tax_categories stay unscoped — they're shared
-- reference data by design, not per-tenant.
-- ---------------------------------------------------------------------
alter table branches enable row level security;
drop policy if exists business_isolation_branches on branches;
create policy business_isolation_branches on branches
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

alter table categories enable row level security;
drop policy if exists business_isolation_categories on categories;
create policy business_isolation_categories on categories
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

alter table suppliers enable row level security;
drop policy if exists business_isolation_suppliers on suppliers;
create policy business_isolation_suppliers on suppliers
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

alter table stock_movements enable row level security;
drop policy if exists business_isolation_stock_movements on stock_movements;
create policy business_isolation_stock_movements on stock_movements
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

alter table product_stock enable row level security;
drop policy if exists business_isolation_product_stock on product_stock;
create policy business_isolation_product_stock on product_stock
  for all using (branch_id in (select id from branches where business_id = auth_business_id()) or is_superadmin())
  with check (branch_id in (select id from branches where business_id = auth_business_id()) or is_superadmin());

alter table purchase_orders enable row level security;
drop policy if exists business_isolation_purchase_orders on purchase_orders;
create policy business_isolation_purchase_orders on purchase_orders
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

alter table purchase_order_items enable row level security;
drop policy if exists business_isolation_po_items on purchase_order_items;
create policy business_isolation_po_items on purchase_order_items
  for all using (po_id in (select id from purchase_orders where business_id = auth_business_id()) or is_superadmin())
  with check (po_id in (select id from purchase_orders where business_id = auth_business_id()) or is_superadmin());

alter table supplier_payments enable row level security;
drop policy if exists business_isolation_supplier_payments on supplier_payments;
create policy business_isolation_supplier_payments on supplier_payments
  for all using (supplier_id in (select id from suppliers where business_id = auth_business_id()) or is_superadmin())
  with check (supplier_id in (select id from suppliers where business_id = auth_business_id()) or is_superadmin());

-- =====================================================================
-- END OF SCHEMA V2
-- =====================================================================
