-- =====================================================================
-- QWICKPOS — SCHEMA V8F
-- Fix superadmin business creation: SECURITY DEFINER RPC + RLS INSERT
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- 1. RPC: admin_create_business — creates auth user + all business
--    records in one server-side call (bypasses RLS & anon key limits)
-- ═══════════════════════════════════════════════════════════════════════
create or replace function admin_create_business(
  p_business_name text,
  p_admin_name text,
  p_admin_email text,
  p_admin_password text,
  p_admin_phone text default null,
  p_base_currency text default 'UGX',
  p_plan_id uuid default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_caller_is_superadmin boolean;
  v_user_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_trial_end timestamptz;
  v_business jsonb;
  v_branch jsonb;
  v_user jsonb;
  v_sub jsonb;
begin
  -- ── auth check ──────────────────────────────────────────────────────
  select exists (
    select 1 from app_users
    where id = auth.uid() and role = 'superadmin' and is_active = true
  ) into v_caller_is_superadmin;

  if not v_caller_is_superadmin then
    raise exception 'Not authorized — superadmin role required';
  end if;

  -- ── validate inputs ────────────────────────────────────────────────
  if p_business_name is null or length(trim(p_business_name)) = 0 then
    raise exception 'Business name is required';
  end if;
  if p_admin_email is null or length(trim(p_admin_email)) = 0 then
    raise exception 'Admin email is required';
  end if;
  if p_admin_password is null or length(p_admin_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  -- ── create auth user ───────────────────────────────────────────────
  -- SECURITY DEFINER runs as function owner (postgres) which has
  -- write access to auth.users in Supabase projects.
  v_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    trim(lower(p_admin_email)),
    crypt(p_admin_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_admin_name),
    now(),
    now()
  );

  -- Also create auth identity so login works
  insert into auth.identities (
    id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    v_user_id,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', trim(lower(p_admin_email))),
    'email',
    now(),
    now(),
    now()
  );

  -- ── create business ────────────────────────────────────────────────
  insert into businesses (name, base_currency, primary_phone)
  values (trim(p_business_name), p_base_currency, nullif(trim(p_admin_phone), ''))
  returning id into v_business_id;

  -- ── create main branch ─────────────────────────────────────────────
  insert into branches (business_id, name, is_main, is_active)
  values (v_business_id, 'Main Branch', true, true)
  returning id into v_branch_id;

  -- ── link auth user as admin ────────────────────────────────────────
  insert into app_users (id, business_id, branch_id, full_name, phone, role, is_active)
  values (
    v_user_id,
    v_business_id,
    v_branch_id,
    trim(p_admin_name),
    nullif(trim(p_admin_phone), ''),
    'admin',
    true
  );

  -- ── seed default accounts ──────────────────────────────────────────
  perform seed_default_accounts(v_business_id);

  -- ── create trial subscription ──────────────────────────────────────
  v_trial_end := now() + interval '14 days';

  if p_plan_id is not null then
    insert into subscriptions (business_id, plan_id, status, trial_ends_at, current_period_end)
    values (v_business_id, p_plan_id, 'trialing', v_trial_end, v_trial_end);
  else
    -- default to starter plan if no plan specified
    insert into subscriptions (business_id, plan_id, status, trial_ends_at, current_period_end)
    select v_business_id, id, 'trialing', v_trial_end, v_trial_end
    from plans where code = 'starter' limit 1;
  end if;

  -- ── build response ─────────────────────────────────────────────────
  select to_jsonb(b.*) into v_business from businesses b where b.id = v_business_id;
  select to_jsonb(br.*) into v_branch from branches br where br.id = v_branch_id;
  select to_jsonb(au.*) into v_user from app_users au where au.id = v_user_id;
  select to_jsonb(s.*)  into v_sub  from subscriptions s  where s.business_id = v_business_id;

  return jsonb_build_object(
    'business', v_business,
    'branch',   v_branch,
    'user',     v_user,
    'subscription', v_sub
  );
end;
$$;

grant execute on function admin_create_business(text, text, text, text, text, text, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. RLS INSERT policies — safety net for any future direct inserts
-- ═══════════════════════════════════════════════════════════════════════

-- Businesses: allow superadmin to insert
drop policy if exists business_insert_businesses on businesses;
create policy business_insert_businesses on businesses
  for insert
  with check (
    exists (
      select 1 from app_users
      where id = auth.uid() and role = 'superadmin' and is_active = true
    )
  );

-- App_users: allow superadmin to insert
drop policy if exists business_insert_app_users on app_users;
create policy business_insert_app_users on app_users
  for insert
  with check (
    exists (
      select 1 from app_users
      where id = auth.uid() and role = 'superadmin' and is_active = true
    )
  );

-- Subscriptions: allow superadmin to insert
drop policy if exists business_insert_subscriptions on subscriptions;
create policy business_insert_subscriptions on subscriptions
  for insert
  with check (
    exists (
      select 1 from app_users
      where id = auth.uid() and role = 'superadmin' and is_active = true
    )
  );


-- ═══════════════════════════════════════════════════════════════════════
-- 3. Refresh PostgREST schema cache
-- ═══════════════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';
