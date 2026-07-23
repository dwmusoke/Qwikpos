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
-- 2. Security-definer helper so the app can always fetch the current
--    user's app_users row without worrying about RLS.
-- ---------------------------------------------------------------------
create or replace function get_my_app_user()
returns jsonb
language sql security definer stable as $$
  select to_jsonb(app_users.*) from app_users where id = auth.uid()
$$;
