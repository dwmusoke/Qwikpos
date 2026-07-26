-- =====================================================================
-- QWICKPOS — SCHEMA V8H
-- Fix tax_categories RLS + ensure sales KPI works for all users
-- =====================================================================

-- 1. Fix tax_categories RLS — allow all authenticated users to manage
--    (tax categories are global/shared, not business-scoped)
drop policy if exists tax_categories_manage on tax_categories;
create policy tax_categories_manage on tax_categories for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists tax_categories_select on tax_categories;
create policy tax_categories_select on tax_categories for select
  using (true);


-- 2. Refresh PostgREST schema cache
notify pgrst, 'reload schema';
