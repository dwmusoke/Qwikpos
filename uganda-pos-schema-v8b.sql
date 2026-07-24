-- =====================================================================
-- QWICKPOS — SCHEMA V8B
-- Add coupon_code, delivery, contact, and order management columns
-- =====================================================================

-- Add coupon_code column to sales table
alter table sales add column if not exists coupon_code text;

-- Ensure branch_id column exists on sales (may already exist from v1)
alter table sales add column if not exists branch_id uuid references branches(id);

-- Delivery columns
alter table sales add column if not exists delivery boolean default false;
alter table sales add column if not exists delivery_address text;
alter table sales add column if not exists delivery_location text;
alter table sales add column if not exists delivery_cost numeric(18,2) default 0;

-- Contact columns
alter table sales add column if not exists contact_phone text;
alter table sales add column if not exists contact_email text;

-- Final total (grand_total + delivery_cost)
alter table sales add column if not exists final_total numeric(18,2);

-- Indexes
create index if not exists idx_sales_coupon on sales(coupon_code) where coupon_code is not null;
create index if not exists idx_sales_delivery on sales(delivery) where delivery = true;
