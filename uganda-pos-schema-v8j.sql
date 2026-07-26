-- =====================================================================
-- QWICKPOS — SCHEMA v8j
-- Universal Product Variants System
-- =====================================================================

-- ── VARIANT TYPES ────────────────────────────────────────────────────
-- Defines attribute types (Size, Color, Weight, etc.) per business
-- with preset options for each type
create table if not exists variant_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,                    -- e.g. "Size", "Color", "Weight"
  options jsonb default '[]',            -- e.g. ["S","M","L","XL"]
  sort_order int default 0,
  created_at timestamptz default now()
);
create index if not exists idx_vt_business on variant_types(business_id);

alter table variant_types enable row level security;
create policy "variant_types_isolated" on variant_types for all
  using (business_id = auth_business_id());
create policy "variant_types_anon" on variant_types for select using (true);

-- ── ADD variant_id TO sale_items ─────────────────────────────────────
do $$ begin
  alter table sale_items add column variant_id uuid references product_variants(id);
exception when duplicate_column then null;
end $$;

-- ── ADD has_variants TO products ─────────────────────────────────────
do $$ begin
  alter table products add column has_variants boolean default false;
exception when duplicate_column then null;
end $$;

-- ── UPSERT VARIANT TYPE RPC ─────────────────────────────────────────
create or replace function upsert_variant_type(
  p_id uuid default null,
  p_business_id uuid default null,
  p_name text default null,
  p_options jsonb default '[]',
  p_sort_order int default 0
) returns uuid language plpgsql security definer as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if p_id is not null then
    update variant_types set name = p_name, options = p_options, sort_order = p_sort_order
    where id = p_id and business_id = p_business_id;
  else
    insert into variant_types (id, business_id, name, options, sort_order)
    values (v_id, p_business_id, p_name, p_options, p_sort_order);
  end if;
  return v_id;
end;
$$;

-- ── DELETE VARIANT TYPE RPC ──────────────────────────────────────────
create or replace function delete_variant_type(p_id uuid, p_business_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from variant_types where id = p_id and business_id = p_business_id;
end;
$$;

-- ── VARIANT STOCK TRIGGER ───────────────────────────────────────────
-- When a variant is deleted, clean up its stock
create or replace function cleanup_variant_stock()
returns trigger language plpgsql as $$
begin
  delete from variant_stock where variant_id = OLD.id;
  return OLD;
end;
$$;

drop trigger if exists trg_cleanup_variant_stock on product_variants;
create trigger trg_cleanup_variant_stock
  before delete on product_variants
  for each row execute function cleanup_variant_stock();

-- ── SEED DEFAULT VARIANT TYPES ──────────────────────────────────────
-- These are just suggestions; businesses can add their own
-- (Seeding is done in JS on first access, not in SQL)
