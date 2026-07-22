-- =====================================================================
-- QWICKPOS — MULTIVENDOR / SUBSCRIPTION BILLING MIGRATION
-- Run AFTER uganda-pos-schema.sql (+ uganda-pos-seed.sql if already run).
-- Safe to re-run (uses IF NOT EXISTS / DROP+CREATE for policies).
--
-- Turns the single-tenant POS into a self-serve multi-vendor SaaS:
--   - Any shop can sign up on its own (no more manual SQL linking)
--   - Each vendor business gets a subscription (Starter/Growth/Pro)
--   - 14-day free trial, then payment is collected via Flutterwave
--   - A 'superadmin' role can see/manage every vendor from one console
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ALLOW THE 'superadmin' ROLE
-- ---------------------------------------------------------------------
alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in ('admin','manager','cashier','inventory_clerk','accountant','superadmin'));

-- ---------------------------------------------------------------------
-- 2. PLANS
-- ---------------------------------------------------------------------
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                 -- 'starter' | 'growth' | 'pro'
  name text not null,
  description text,
  price_ugx numeric(18,2) not null,          -- monthly price, always billed in UGX via Flutterwave
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly','yearly')),
  features jsonb not null default '{}'::jsonb,
  is_active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now()
);

insert into plans (code, name, description, price_ugx, sort_order, features) values
  ('starter', 'Starter', 'For a single till getting started with digital sales.', 60000, 1,
    '{"max_branches":1,"max_users":3,"multi_currency":false,"efris":false,"reports_export":false,"accounting":false,"priority_support":false}'::jsonb),
  ('growth', 'Growth', 'Multi-currency selling and EFRIS-ready invoicing.', 150000, 2,
    '{"max_branches":2,"max_users":8,"multi_currency":true,"efris":true,"reports_export":true,"accounting":true,"priority_support":false}'::jsonb),
  ('pro', 'Pro', 'Multi-branch operations with full reporting and support.', 300000, 3,
    '{"max_branches":999,"max_users":999,"multi_currency":true,"efris":true,"reports_export":true,"accounting":true,"priority_support":true}'::jsonb)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. SUBSCRIPTIONS + PAYMENTS
-- ---------------------------------------------------------------------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid unique references businesses(id) on delete cascade,
  plan_id uuid references plans(id),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','cancelled','expired')),
  trial_ends_at timestamptz,
  current_period_start timestamptz default now(),
  current_period_end timestamptz,
  auto_renew boolean default true,
  flutterwave_customer_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  plan_id uuid references plans(id),
  amount numeric(18,2) not null,
  currency text not null default 'UGX',
  flw_tx_ref text unique not null,
  flw_transaction_id text,
  status text not null default 'pending' check (status in ('pending','successful','failed')),
  paid_at timestamptz,
  raw_response jsonb,
  created_at timestamptz default now()
);

drop trigger if exists trg_subscriptions_updated_at on subscriptions;
create trigger trg_subscriptions_updated_at before update on subscriptions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 4. SUPERADMIN HELPER (security definer — avoids RLS recursion)
-- ---------------------------------------------------------------------
create or replace function is_superadmin() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true
  );
$$;

-- ---------------------------------------------------------------------
-- 5. SELF-SERVE SIGNUP (security definer — creates the tenant + owner
--    in one call, right after supabase.auth.signUp() on the client)
-- ---------------------------------------------------------------------
create or replace function create_business_and_owner(
  p_business_name text,
  p_full_name text,
  p_phone text,
  p_base_currency text,
  p_plan_code text
) returns uuid
language plpgsql security definer as $$
declare
  v_business_id uuid;
  v_branch_id uuid;
  v_plan_id uuid;
  v_currency text := coalesce(nullif(p_base_currency, ''), 'UGX');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from app_users where id = auth.uid()) then
    raise exception 'This login is already linked to a business.';
  end if;

  insert into businesses (name, base_currency, efris_mode)
  values (p_business_name, v_currency, 'sandbox')
  returning id into v_business_id;

  insert into branches (business_id, name, is_main)
  values (v_business_id, 'Main Branch', true)
  returning id into v_branch_id;

  insert into app_users (id, business_id, branch_id, full_name, phone, role)
  values (auth.uid(), v_business_id, v_branch_id, p_full_name, p_phone, 'admin');

  insert into currencies (code, name, symbol, decimal_places, is_base, is_active)
  values (v_currency, case when v_currency = 'UGX' then 'Uganda Shilling' else v_currency end,
          case when v_currency = 'UGX' then 'USh' else v_currency end, case when v_currency = 'UGX' then 0 else 2 end, true, true)
  on conflict (code) do nothing;

  insert into exchange_rates (currency_code, rate_to_base, source)
  values (v_currency, 1, 'manual');

  insert into categories (business_id, name, icon) values (v_business_id, 'General', '📦');

  select id into v_plan_id from plans where code = coalesce(nullif(p_plan_code, ''), 'starter') limit 1;

  insert into subscriptions (business_id, plan_id, status, trial_ends_at, current_period_start)
  values (v_business_id, v_plan_id, 'trialing', now() + interval '14 days', now());

  return v_business_id;
end;
$$;

grant execute on function create_business_and_owner(text, text, text, text, text) to authenticated;
grant execute on function is_superadmin() to authenticated, anon;

-- ---------------------------------------------------------------------
-- 6. RLS — plans (public pricing page, even before login)
-- ---------------------------------------------------------------------
alter table plans enable row level security;

drop policy if exists plans_public_read on plans;
create policy plans_public_read on plans for select using (is_active = true or is_superadmin());

drop policy if exists plans_superadmin_write on plans;
create policy plans_superadmin_write on plans for all
  using (is_superadmin()) with check (is_superadmin());

-- ---------------------------------------------------------------------
-- 7. RLS — subscriptions & subscription_payments
--    (writes normally happen via the security-definer RPC above, or via
--    the Flutterwave edge functions using the service-role key, which
--    bypasses RLS entirely — so authenticated users only need read here)
-- ---------------------------------------------------------------------
alter table subscriptions enable row level security;

drop policy if exists subscriptions_read on subscriptions;
create policy subscriptions_read on subscriptions for select
  using (business_id = auth_business_id() or is_superadmin());

drop policy if exists subscriptions_superadmin_write on subscriptions;
create policy subscriptions_superadmin_write on subscriptions for all
  using (is_superadmin()) with check (is_superadmin());

alter table subscription_payments enable row level security;

drop policy if exists subscription_payments_read on subscription_payments;
create policy subscription_payments_read on subscription_payments for select
  using (business_id = auth_business_id() or is_superadmin());

drop policy if exists subscription_payments_superadmin_write on subscription_payments;
create policy subscription_payments_superadmin_write on subscription_payments for all
  using (is_superadmin()) with check (is_superadmin());

-- ---------------------------------------------------------------------
-- 8. Extend existing tenant-isolation policies so superadmin can also
--    see/support every vendor's data from the admin console.
-- ---------------------------------------------------------------------
drop policy if exists business_isolation_businesses on businesses;
create policy business_isolation_businesses on businesses
  for select using (id = auth_business_id() or is_superadmin());

drop policy if exists business_update_businesses on businesses;
create policy business_update_businesses on businesses
  for update using (id = auth_business_id() or is_superadmin())
  with check (id = auth_business_id() or is_superadmin());

drop policy if exists business_isolation_app_users on app_users;
create policy business_isolation_app_users on app_users
  for select using (business_id = auth_business_id() or id = auth.uid() or is_superadmin());

drop policy if exists business_update_app_users on app_users;
create policy business_update_app_users on app_users
  for update using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists business_isolation_products on products;
create policy business_isolation_products on products
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists business_isolation_sales on sales;
create policy business_isolation_sales on sales
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists business_isolation_customers on customers;
create policy business_isolation_customers on customers
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists business_isolation_efris on efris_invoices;
create policy business_isolation_efris on efris_invoices
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists business_isolation_sale_items on sale_items;
create policy business_isolation_sale_items on sale_items
  for all using (sale_id in (select id from sales where business_id = auth_business_id()) or is_superadmin())
  with check (sale_id in (select id from sales where business_id = auth_business_id()) or is_superadmin());

drop policy if exists business_isolation_payments on payments;
create policy business_isolation_payments on payments
  for all using (sale_id in (select id from sales where business_id = auth_business_id()) or is_superadmin())
  with check (sale_id in (select id from sales where business_id = auth_business_id()) or is_superadmin());

-- ---------------------------------------------------------------------
-- 9. Make your first superadmin (run manually once, after you've signed
--    up a normal account through the app to get an auth user + row in
--    app_users). Replace the email with your own.
-- ---------------------------------------------------------------------
-- update app_users set role = 'superadmin', business_id = null, branch_id = null
-- where id = (select id from auth.users where email = 'you@yourcompany.com');
-- =====================================================================
-- END OF BILLING MIGRATION
-- =====================================================================
