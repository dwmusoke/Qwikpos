-- =====================================================================
-- QWICKPOS — SCHEMA V8
-- Fix app_users RLS policy to allow self-read,
-- and add a security-definer helper so the app can always read the
-- current user's own row during bootstrap (even before signup completes).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fixed RLS policy for app_users
--    The old policy only matched business_id = auth_business_id(), which
--    returns NULL for users with no business_id yet (new signups,
--    superadmins), making the policy never match.
--    Now also allows id = auth.uid() so every user can always read
--    their own row regardless of business_id.
-- ---------------------------------------------------------------------
drop policy if exists business_isolation_app_users on app_users;
create policy business_isolation_app_users on app_users
  for select using (business_id = auth_business_id() OR id = auth.uid());

drop policy if exists business_update_app_users on app_users;
create policy business_update_app_users on app_users
  for update using (business_id = auth_business_id() OR id = auth.uid())
  with check (business_id = auth_business_id() OR id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. SECURITY-DEFINER HELPERS
--    get_my_app_user() - app can always fetch the current user's app_users row
-- ---------------------------------------------------------------------
drop function if exists get_my_app_user();
create or replace function get_my_app_user()
returns jsonb
language sql security definer stable as $$
  select to_jsonb(app_users.*) from app_users where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- 3. SUPERADMIN PLATFORM HELPERS (bypass RLS — superadmin-only)
-- ---------------------------------------------------------------------
drop function if exists admin_get_businesses();
create or replace function admin_get_businesses()
returns jsonb
language plpgsql security definer stable as $$
begin
  if not exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(b.*)) from businesses b), '[]'::jsonb);
end;
$$;

drop function if exists admin_get_users();
create or replace function admin_get_users()
returns jsonb
language plpgsql security definer stable as $$
begin
  if not exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(u.*)) from app_users u), '[]'::jsonb);
end;
$$;

drop function if exists admin_get_subscriptions();
create or replace function admin_get_subscriptions()
returns jsonb
language plpgsql security definer stable as $$
begin
  if not exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'business_id', s.business_id, 'plan_id', s.plan_id,
    'status', s.status, 'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end, 'current_period_start', s.current_period_start,
    'auto_renew', s.auto_renew, 'created_at', s.created_at, 'updated_at', s.updated_at,
    'plans', (select to_jsonb(p.*) from plans p where p.id = s.plan_id)
  )) from subscriptions s), '[]'::jsonb);
end;
$$;

drop function if exists admin_get_payments();
create or replace function admin_get_payments()
returns jsonb
language plpgsql security definer stable as $$
begin
  if not exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'business_id', p.business_id, 'plan_id', p.plan_id,
    'amount', p.amount, 'currency', p.currency, 'status', p.status,
    'flw_tx_ref', p.flw_tx_ref, 'created_at', p.created_at,
    'plans', (select to_jsonb(pl.*) from plans pl where pl.id = p.plan_id)
  )) from subscription_payments p order by p.created_at desc limit 50), '[]'::jsonb);
end;
$$;

drop function if exists admin_get_branches();
create or replace function admin_get_branches()
returns jsonb
language plpgsql security definer stable as $$
begin
  if not exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(b.*)) from branches b), '[]'::jsonb);
end;
$$;

drop function if exists admin_get_sales_summary();
create or replace function admin_get_sales_summary()
returns jsonb
language plpgsql security definer stable as $$
begin
  if not exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(s.*)) from sales s), '[]'::jsonb);
end;
$$;

drop function if exists admin_get_products_summary();
create or replace function admin_get_products_summary()
returns jsonb
language plpgsql security definer stable as $$
begin
  if not exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(p.*)) from products p), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. PLATFORM SETTINGS TABLE
-- ---------------------------------------------------------------------
create table if not exists platform_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text,
  updated_at timestamptz default now()
);
insert into platform_settings (key, value) values
  ('system_name', 'Qwickpos'),
  ('support_email', 'support@qwickpos.com'),
  ('maintenance_mode', 'false'),
  ('default_trial_days', '14')
on conflict (key) do nothing;

drop trigger if exists trg_platform_settings_updated_at on platform_settings;
create trigger trg_platform_settings_updated_at before update on platform_settings
  for each row execute function set_updated_at();

drop function if exists admin_get_platform_settings();
create or replace function admin_get_platform_settings()
returns jsonb
language plpgsql security definer stable as $$
begin
  if not exists (select 1 from app_users where id = auth.uid() and role = 'superadmin' and is_active = true) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(s.*)) from platform_settings s), '[]'::jsonb);
end;
$$;
grant execute on function admin_get_platform_settings() to authenticated;

grant execute on function admin_get_businesses() to authenticated;
grant execute on function admin_get_users() to authenticated;
grant execute on function admin_get_subscriptions() to authenticated;
grant execute on function admin_get_payments() to authenticated;
grant execute on function admin_get_branches() to authenticated;
grant execute on function admin_get_sales_summary() to authenticated;
grant execute on function admin_get_products_summary() to authenticated;

-- ---------------------------------------------------------------------
-- 4. SELF-SERVE SIGNUP (security definer — creates the tenant + owner
--    in one call, right after supabase.auth.signUp() on the client)
-- ---------------------------------------------------------------------
drop function if exists create_business_and_owner(text, text, text, text, text);
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

-- ---------------------------------------------------------------------
-- 5. THEME COLUMNS for businesses table
-- ---------------------------------------------------------------------
alter table businesses add column if not exists theme_color text default '#0f6b4a';
alter table businesses add column if not exists theme_font_size text default '15px';
alter table businesses add column if not exists logo_url text;
