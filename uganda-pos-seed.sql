-- =====================================================================
-- QWICKPOS — STARTER SEED DATA
-- Run AFTER uganda-pos-schema.sql
-- Replace the business/user details with your own before going live.
-- =====================================================================

-- 1. Create your business
insert into businesses (id, name, tin, business_type, address, phone, base_currency, efris_mode)
values ('00000000-0000-0000-0000-000000000001', 'My Uganda Shop', '1000123456', 'retail',
        'Kampala, Uganda', '+256700000000', 'UGX', 'sandbox')
on conflict (id) do nothing;

-- 2. Main branch
insert into branches (id, business_id, name, address, is_main)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
        'Main Branch', 'Kampala, Uganda', true)
on conflict (id) do nothing;

-- 3. Currencies (customize freely in Settings later)
insert into currencies (code, name, symbol, decimal_places, is_base, is_active) values
  ('UGX', 'Uganda Shilling', 'USh', 0, true, true),
  ('USD', 'US Dollar', '$', 2, false, true),
  ('KES', 'Kenyan Shilling', 'KSh', 2, false, true),
  ('EUR', 'Euro', '€', 2, false, true)
on conflict (code) do nothing;

-- 4. Starting exchange rates (1 unit of currency = X UGX). Update regularly in Settings > Currencies.
insert into exchange_rates (currency_code, rate_to_base, source) values
  ('UGX', 1, 'manual'),
  ('USD', 3800, 'manual'),
  ('KES', 29, 'manual'),
  ('EUR', 4100, 'manual');

-- 5. Starter categories (general retail)
insert into categories (business_id, name, icon) values
  ('00000000-0000-0000-0000-000000000001', 'General', '📦'),
  ('00000000-0000-0000-0000-000000000001', 'Beverages', '🥤'),
  ('00000000-0000-0000-0000-000000000001', 'Groceries', '🛒'),
  ('00000000-0000-0000-0000-000000000001', 'Electronics', '🔌'),
  ('00000000-0000-0000-0000-000000000001', 'Household', '🧴'),
  ('00000000-0000-0000-0000-000000000001', 'Stationery', '✏️')
on conflict do nothing;

-- 6. IMPORTANT: after creating your first login in Supabase Auth (see README),
-- link it to app_users like this (replace the UUID with the auth user's id):
--
-- insert into app_users (id, business_id, branch_id, full_name, role)
-- values ('<auth-user-uuid>', '00000000-0000-0000-0000-000000000001',
--         '00000000-0000-0000-0000-000000000002', 'Admin User', 'admin');
