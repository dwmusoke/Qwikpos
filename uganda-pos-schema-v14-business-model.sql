-- =====================================================================
-- QWICKPOS — SCHEMA V14
-- Business-model flags: modules adapt per business type (pharmacy,
-- manufacturing, services …). Safe to re-run.
-- =====================================================================

alter table businesses add column if not exists enable_batch_tracking boolean default false;
alter table businesses add column if not exists enable_expiry_tracking boolean default false;
alter table businesses add column if not exists enable_production boolean default false;
alter table businesses add column if not exists enable_wholesale_pricing boolean default false;
alter table businesses add column if not exists is_service_business boolean default false;

-- Backfill from business_type so existing tenants inherit the right modules
update businesses set
  enable_batch_tracking = true, enable_expiry_tracking = true
where business_type in ('food', 'pharmacy');

update businesses set enable_wholesale_pricing = true
where business_type = 'wholesale';

update businesses set is_service_business = true
where business_type = 'services';

update businesses set
  enable_production = true, enable_batch_tracking = true
where business_type = 'manufacturing';

-- =====================================================================
-- END OF SCHEMA V14
-- =====================================================================
