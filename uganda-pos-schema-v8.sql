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
-- 2. SECURITY-DEFINER HELPER
--    get_my_app_user() - app can always fetch the current user's app_users row
-- ---------------------------------------------------------------------
create or replace function get_my_app_user()
returns jsonb
language sql security definer stable as $$
  select to_jsonb(app_users.*) from app_users where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- 3. SELF-SERVE SIGNUP (security definer — creates the tenant + owner
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
