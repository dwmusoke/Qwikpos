-- =====================================================================
-- QWICKPOS — SCHEMA V8C
-- Add missing branches columns and document template columns
-- =====================================================================

-- Branches: add missing columns
alter table branches add column if not exists email text;
alter table branches add column if not exists is_active boolean default true;
alter table branches add column if not exists location text;
alter table branches add column if not exists contact_person text;

-- Businesses: document template config columns
alter table businesses add column if not exists tpl_primary_color text default '#0f6b4a';
alter table businesses add column if not exists tpl_font_size text default '13';
alter table businesses add column if not exists tpl_invoice_title text default 'TAX INVOICE';
alter table businesses add column if not exists tpl_footer_text text default 'Thank you for your business!';
alter table businesses add column if not exists tpl_show_logo boolean default true;
alter table businesses add column if not exists tpl_show_name boolean default true;
alter table businesses add column if not exists tpl_show_tin boolean default true;
alter table businesses add column if not exists tpl_show_addr boolean default true;
alter table businesses add column if not exists tpl_show_phone boolean default true;
alter table businesses add column if not exists tpl_show_email boolean default false;
alter table businesses add column if not exists tpl_show_date boolean default true;
alter table businesses add column if not exists tpl_show_inv boolean default true;
alter table businesses add column if not exists tpl_show_server boolean default true;
alter table businesses add column if not exists tpl_show_tax boolean default true;
alter table businesses add column if not exists tpl_show_disc boolean default true;
alter table businesses add column if not exists tpl_show_footer boolean default true;

-- Businesses: messaging config columns
alter table businesses add column if not exists email_from_name text;
alter table businesses add column if not exists email_from text;
alter table businesses add column if not exists email_signature text;
alter table businesses add column if not exists email_enabled boolean default false;
alter table businesses add column if not exists smtp_host text;
alter table businesses add column if not exists smtp_port text default '587';
alter table businesses add column if not exists smtp_username text;
alter table businesses add column if not exists smtp_password text;
alter table businesses add column if not exists whatsapp_number text;
alter table businesses add column if not exists whatsapp_provider text;
alter table businesses add column if not exists whatsapp_api_key text;
alter table businesses add column if not exists whatsapp_enabled boolean default false;
