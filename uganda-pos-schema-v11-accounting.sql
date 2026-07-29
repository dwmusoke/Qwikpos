-- =====================================================================
-- MIGRATION v11 — FULL DOUBLE-ENTRY ACCOUNTING (QuickBooks-level GL)
--
-- Adds: chart_of_accounts, journal_entries, journal_entry_lines
-- Auto-posting hooks: functions that post sales/purchases/expenses to GL
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CHART OF ACCOUNTS
-- ---------------------------------------------------------------------
create table if not exists chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  account_code text not null,                          -- e.g. 1-0001, 4-2000
  name text not null,                                  -- e.g. Cash at Bank
  type text not null check (type in (
    'asset','liability','equity','income','expense'
  )),
  subtype text,                                        -- e.g. Current Asset, Current Liability
  is_active boolean default true,
  is_system boolean default false,                     -- system-managed (can't delete)
  description text,
  parent_id uuid references chart_of_accounts(id),     -- hierarchical
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_coa_business on chart_of_accounts(business_id);
create unique index if not exists idx_coa_code on chart_of_accounts(business_id, account_code);

-- ---------------------------------------------------------------------
-- 2. JOURNAL ENTRIES (header)
-- ---------------------------------------------------------------------
create sequence if not exists journal_seq start 1;

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  journal_number text not null,                         -- JE-000001
  entry_date date not null,
  description text,                                    -- narration
  reference_type text,                                 -- sale, purchase, expense, deposit, transfer, manual
  reference_id uuid,                                   -- FK to source document
  reference_number text,                               -- e.g. INV-000001
  is_posted boolean default true,
  posted_at timestamptz default now(),
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

create unique index if not exists idx_je_num on journal_entries(business_id, journal_number);
create index if not exists idx_je_date on journal_entries(business_id, entry_date desc);
create index if not exists idx_je_ref on journal_entries(reference_type, reference_id);

-- ---------------------------------------------------------------------
-- 3. JOURNAL ENTRY LINES (double-entry rows)
-- ---------------------------------------------------------------------
create table if not exists journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid references journal_entries(id) on delete cascade,
  account_id uuid references chart_of_accounts(id),
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  description text,
  created_at timestamptz default now(),

  constraint chk_non_negative check (debit >= 0 and credit >= 0),
  constraint chk_not_both check (not (debit > 0 and credit > 0))
);

create index if not exists idx_jel_entry on journal_entry_lines(journal_entry_id);
create index if not exists idx_jel_account on journal_entry_lines(account_id, journal_entry_id);

-- ---------------------------------------------------------------------
-- 4. DEFAULT CHART OF ACCOUNTS (Uganda-standard)
-- ---------------------------------------------------------------------
insert into chart_of_accounts (business_id, account_code, name, type, subtype, is_system) values
  -- Assets (1-xxxx)
  (null, '1-1000', 'Cash & Bank',              'asset', 'Current Asset', true),
  (null, '1-1010', 'Petty Cash',               'asset', 'Current Asset', false),
  (null, '1-1020', 'Accounts Receivable',      'asset', 'Current Asset', true),
  (null, '1-1030', 'Inventory',                'asset', 'Current Asset', true),
  (null, '1-1040', 'Prepaid Expenses',          'asset', 'Current Asset', false),
  (null, '1-1500', 'Fixed Assets',             'asset', 'Fixed Asset', false),
  (null, '1-1510', 'Accumulated Depreciation', 'asset', 'Fixed Asset', false),
  -- Liabilities (2-xxxx)
  (null, '2-1000', 'Accounts Payable',         'liability', 'Current Liability', true),
  (null, '2-1010', 'VAT Payable',              'liability', 'Current Liability', true),
  (null, '2-1020', 'Sales Tax Payable',        'liability', 'Current Liability', false),
  (null, '2-1030', 'Payroll Payable',          'liability', 'Current Liability', false),
  (null, '2-1040', 'Loans Payable',            'liability', 'Long Term Liability', false),
  -- Equity (3-xxxx)
  (null, '3-1000', 'Owner Equity',             'equity', 'Equity', true),
  (null, '3-1010', 'Retained Earnings',        'equity', 'Equity', true),
  (null, '3-1020', 'Drawings',                 'equity', 'Equity', false),
  -- Income (4-xxxx)
  (null, '4-1000', 'Sales Revenue',            'income', 'Revenue', true),
  (null, '4-1010', 'Service Revenue',          'income', 'Revenue', false),
  (null, '4-1020', 'Discounts Allowed',        'income', 'Revenue', true),
  (null, '4-2000', 'Other Income',             'income', 'Other Income', false),
  -- Expenses (5-xxxx)
  (null, '5-1000', 'Cost of Goods Sold',       'expense', 'COGS', true),
  (null, '5-2000', 'Salaries & Wages',         'expense', 'Operating Expense', false),
  (null, '5-2010', 'Rent & Utilities',         'expense', 'Operating Expense', false),
  (null, '5-2020', 'Office Supplies',          'expense', 'Operating Expense', false),
  (null, '5-2030', 'Transport & Travel',       'expense', 'Operating Expense', false),
  (null, '5-2040', 'Marketing & Advertising',  'expense', 'Operating Expense', false),
  (null, '5-2050', 'Repairs & Maintenance',    'expense', 'Operating Expense', false),
  (null, '5-2060', 'Depreciation',             'expense', 'Operating Expense', false),
  (null, '5-2070', 'Bank Charges',             'expense', 'Operating Expense', false),
  (null, '5-2080', 'Tax Expense',              'expense', 'Operating Expense', false),
  (null, '5-3000', 'Miscellaneous Expense',    'expense', 'Other Expense', false)
on conflict (business_id, account_code) do nothing;

-- ---------------------------------------------------------------------
-- 5. AUTO-POSTING: Sales → GL
-- ---------------------------------------------------------------------
create or replace function post_sale_to_gl()
returns trigger as $$
declare
  v_journal_id uuid;
  v_journal_num text;
  v_acct_receivable uuid;
  v_sales_revenue uuid;
  v_vat_payable uuid;
  v_cogs uuid;
  v_inventory uuid;
  v_discounts uuid;
  v_total_lines numeric;
begin
  -- Only post completed, non-quotation sales
  if NEW.status != 'completed' or NEW.sale_type = 'quotation' then
    return NEW;
  end if;

  -- Get or create journal number
  v_journal_num := 'JE-' || to_char(NEW.created_at, 'YYYYMMDD') || '-' || NEW.sale_number;

  -- Skip if already posted
  if exists (select 1 from journal_entries where reference_type = 'sale' and reference_id = NEW.id) then
    return NEW;
  end if;

  -- Look up accounts
  select id into v_sales_revenue from chart_of_accounts where account_code = '4-1000' limit 1;
  select id into v_vat_payable from chart_of_accounts where account_code = '2-1010' limit 1;
  select id into v_acct_receivable from chart_of_accounts where account_code = '1-1020' limit 1;
  select id into v_cogs from chart_of_accounts where account_code = '5-1000' limit 1;
  select id into v_inventory from chart_of_accounts where account_code = '1-1030' limit 1;
  select id into v_discounts from chart_of_accounts where account_code = '4-1020' limit 1;

  -- Create journal entry
  insert into journal_entries (business_id, branch_id, journal_number, entry_date, description,
    reference_type, reference_id, reference_number, created_by)
  values (NEW.business_id, NEW.branch_id, v_journal_num, NEW.created_at::date,
    'Sale ' || NEW.sale_number, 'sale', NEW.id, NEW.sale_number, NEW.cashier_id)
  returning id into v_journal_id;

  -- Cash sale: Debit Cash, Credit Revenue + VAT
  if NEW.grand_total_base > 0 then
    insert into journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
      (v_journal_id, v_acct_receivable, NEW.grand_total_base, 0, 'Sale ' || NEW.sale_number),
      (v_journal_id, v_sales_revenue, 0, NEW.grand_total_base - NEW.vat_total, 'Revenue from ' || NEW.sale_number);
    if NEW.vat_total > 0 then
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
        (v_journal_id, v_vat_payable, 0, NEW.vat_total, 'VAT on ' || NEW.sale_number);
    end if;
    if NEW.discount_total > 0 then
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
        (v_journal_id, v_discounts, NEW.discount_total, 0, 'Discount on ' || NEW.sale_number);
    end if;
  end if;

  -- COGS entry: Debit COGS, Credit Inventory
  select coalesce(sum((si.quantity * si.unit_price)), 0) into v_total_lines
    from sale_items si where si.sale_id = NEW.id;
  if v_total_lines > 0 then
    insert into journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
      (v_journal_id, v_cogs, v_total_lines, 0, 'COGS for ' || NEW.sale_number),
      (v_journal_id, v_inventory, 0, v_total_lines, 'Inventory reduction for ' || NEW.sale_number);
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_post_sale_to_gl on sales;
create trigger trg_post_sale_to_gl
  after insert on sales
  for each row execute function post_sale_to_gl();

-- ---------------------------------------------------------------------
-- 6. AUTO-POSTING: Expenses → GL
-- ---------------------------------------------------------------------
create or replace function post_expense_to_gl()
returns trigger as $$
declare
  v_journal_id uuid;
  v_journal_num text;
  v_expense_account uuid;
  v_cash_account uuid;
  v_account_code text;
begin
  v_journal_num := 'JE-EXP-' || to_char(NEW.created_at, 'YYYYMMDD') || '-' || NEW.id::text;

  -- Determine expense account based on category
  v_account_code := case upper(NEW.category)
    when 'SALARY' then '5-2000'
    when 'RENT' then '5-2010'
    when 'UTILITIES' then '5-2010'
    when 'SUPPLIES' then '5-2020'
    when 'TRANSPORT' then '5-2030'
    when 'MARKETING' then '5-2040'
    when 'MAINTENANCE' then '5-2050'
    when 'BANK_CHARGES' then '5-2070'
    when 'TAX' then '5-2080'
    else '5-3000'
  end;

  select id into v_expense_account from chart_of_accounts where account_code = v_account_code limit 1;
  select id into v_cash_account from chart_of_accounts where account_code = '1-1000' limit 1;

  insert into journal_entries (business_id, journal_number, entry_date, description,
    reference_type, reference_id, reference_number, created_by)
  values (NEW.business_id, v_journal_num, NEW.expense_date, COALESCE(NEW.description, NEW.category),
    'expense', NEW.id, NEW.category, NEW.created_by)
  returning id into v_journal_id;

  insert into journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
    (v_journal_id, v_expense_account, NEW.amount_base, 0, COALESCE(NEW.description, NEW.category)),
    (v_journal_id, v_cash_account, 0, NEW.amount_base, 'Payment for ' || COALESCE(NEW.description, NEW.category));

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_post_expense_to_gl on expenses;
create trigger trg_post_expense_to_gl
  after insert on expenses
  for each row execute function post_expense_to_gl();

-- ---------------------------------------------------------------------
-- 7. AUTO-POSTING: Payments (receive money) → GL
-- ---------------------------------------------------------------------
create or replace function post_payment_to_gl()
returns trigger as $$
declare
  v_journal_id uuid;
  v_journal_num text;
  v_cash_account uuid;
  v_ar_account uuid;
  v_sale_number text;
begin
  -- Get sale number
  select sale_number into v_sale_number from sales where id = NEW.sale_id;

  v_journal_num := 'JE-PMT-' || to_char(NEW.created_at, 'YYYYMMDD') || '-' || v_sale_number;

  select id into v_cash_account from chart_of_accounts where account_code = '1-1000' limit 1;
  select id into v_ar_account from chart_of_accounts where account_code = '1-1020' limit 1;

  insert into journal_entries (business_id, journal_number, entry_date, description,
    reference_type, reference_id, reference_number, created_by)
  values ((select business_id from sales where id = NEW.sale_id), v_journal_num,
    NEW.created_at::date, 'Payment received for ' || v_sale_number,
    'payment', NEW.id, v_sale_number, NEW.received_by)
  returning id into v_journal_id;

  insert into journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
    (v_journal_id, v_cash_account, NEW.amount_base, 0, 'Payment received ' || v_sale_number),
    (v_journal_id, v_ar_account, 0, NEW.amount_base, 'Receipt for ' || v_sale_number);

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_post_payment_to_gl on payments;
create trigger trg_post_payment_to_gl
  after insert on payments
  for each row execute function post_payment_to_gl();

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
alter table chart_of_accounts enable row level security;
alter table journal_entries enable row level security;
alter table journal_entry_lines enable row level security;

drop policy if exists coa_isolation on chart_of_accounts;
create policy coa_isolation on chart_of_accounts
  for all using (business_id = auth_business_id() or business_id is null or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists je_isolation on journal_entries;
create policy je_isolation on journal_entries
  for all using (business_id = auth_business_id() or is_superadmin())
  with check (business_id = auth_business_id() or is_superadmin());

drop policy if exists jel_isolation on journal_entry_lines;
create policy jel_isolation on journal_entry_lines
  for all using (
    journal_entry_id in (select id from journal_entries where business_id = auth_business_id())
    or is_superadmin()
  )
  with check (
    journal_entry_id in (select id from journal_entries where business_id = auth_business_id())
    or is_superadmin()
  );

-- ---------------------------------------------------------------------
-- 9. GL REPORT (Trial Balance) — computed from journal_entry_lines
-- ---------------------------------------------------------------------
create or replace function fn_trial_balance(p_business_id uuid, p_date date)
returns table (
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  total_debit numeric,
  total_credit numeric,
  balance numeric
) as $$
begin
  return query
  select
    coa.id as account_id,
    coa.account_code,
    coa.name as account_name,
    coa.type as account_type,
    coalesce(sum(jel.debit), 0) as total_debit,
    coalesce(sum(jel.credit), 0) as total_credit,
    coalesce(sum(jel.debit), 0) - coalesce(sum(jel.credit), 0) as balance
  from chart_of_accounts coa
  left join journal_entry_lines jel on jel.account_id = coa.id
  left join journal_entries je on je.id = jel.journal_entry_id
    and je.business_id = p_business_id
    and je.entry_date <= p_date
    and je.is_posted = true
  where coa.business_id = p_business_id or coa.business_id is null
  group by coa.id, coa.account_code, coa.name, coa.type
  having coalesce(sum(jel.debit), 0) != coalesce(sum(jel.credit), 0)
     or coalesce(sum(jel.debit), 0) > 0
  order by coa.account_code;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 10. BALANCE SHEET
-- ---------------------------------------------------------------------
create or replace function fn_balance_sheet(p_business_id uuid, p_date date)
returns table (
  section text,
  account_id uuid,
  account_code text,
  account_name text,
  amount numeric
) as $$
declare
  v_net_income numeric;
begin
  -- Net income/loss for period
  select coalesce(sum(
    case when coa.type in ('income','expense') then
      case when coa.type = 'income' then jel.credit - jel.debit
           else jel.debit - jel.credit end
    else 0 end
  ), 0) into v_net_income
  from chart_of_accounts coa
  join journal_entry_lines jel on jel.account_id = coa.id
  join journal_entries je on je.id = jel.journal_entry_id
  where (coa.business_id = p_business_id or coa.business_id is null)
    and je.business_id = p_business_id
    and je.entry_date <= p_date
    and je.is_posted = true
    and coa.type in ('income', 'expense');

  return query
  select
    coa.type as section,
    coa.id,
    coa.account_code,
    coa.name,
    coalesce(sum(jel.debit), 0) - coalesce(sum(jel.credit), 0) as amount
  from chart_of_accounts coa
  left join journal_entry_lines jel on jel.account_id = coa.id
  left join journal_entries je on je.id = jel.journal_entry_id
    and je.business_id = p_business_id
    and je.entry_date <= p_date
    and je.is_posted = true
  where (coa.business_id = p_business_id or coa.business_id is null)
    and coa.type in ('asset', 'liability', 'equity')
  group by coa.type, coa.id, coa.account_code, coa.name
  having coalesce(sum(jel.debit), 0) - coalesce(sum(jel.credit), 0) != 0
  union all
  select 'equity' as section, null::uuid, '', 'Net Income (Current Period)', v_net_income
  where v_net_income != 0
  order by section, account_code;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 11. P&L (Profit & Loss)
-- ---------------------------------------------------------------------
create or replace function fn_profit_loss(p_business_id uuid, p_from date, p_to date)
returns table (
  section text,
  account_id uuid,
  account_code text,
  account_name text,
  amount numeric
) as $$
begin
  return query
  select
    coa.type as section,
    coa.id,
    coa.account_code,
    coa.name,
    coalesce(sum(case when coa.type = 'income' then jel.credit - jel.debit
                      else jel.debit - jel.credit end), 0) as amount
  from chart_of_accounts coa
  left join journal_entry_lines jel on jel.account_id = coa.id
  left join journal_entries je on je.id = jel.journal_entry_id
    and je.business_id = p_business_id
    and je.entry_date between p_from and p_to
    and je.is_posted = true
  where (coa.business_id = p_business_id or coa.business_id is null)
    and coa.type in ('income', 'expense')
  group by coa.type, coa.id, coa.account_code, coa.name
  having coalesce(sum(jel.debit - jel.credit), 0) != 0
  order by coa.type, coa.account_code;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 12. NEXT JOURNAL NUMBER RPC
-- ---------------------------------------------------------------------
create or replace function fn_next_journal_number()
returns text as $$
declare
  v_next int;
begin
  select coalesce(max(regexp_replace(journal_number, '[^0-9]', '', 'g')::int), 0) + 1
    into v_next from journal_entries;
  return 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_next::text, 4, '0');
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 13. BACKFILL — post ALL existing sales/expenses/payments to GL
-- ---------------------------------------------------------------------
create or replace function fn_backfill_gl(p_business_id uuid)
returns text as $$
declare
  v_count int := 0;
  v_sale record;
  v_expense record;
  v_payment record;
begin
  -- Post all completed, non-quotation sales
  for v_sale in
    select * from sales
    where business_id = p_business_id
      and status = 'completed'
      and sale_type != 'quotation'
      and not exists (select 1 from journal_entries je where je.reference_type = 'sale' and je.reference_id = sales.id)
  loop
    perform post_sale_to_gl() from sales where id = v_sale.id;
    v_count := v_count + 1;
  end loop;

  -- Post all expenses
  for v_expense in
    select * from expenses
    where business_id = p_business_id
      and not exists (select 1 from journal_entries je where je.reference_type = 'expense' and je.reference_id = expenses.id)
  loop
    perform post_expense_to_gl() from expenses where id = v_expense.id;
    v_count := v_count + 1;
  end loop;

  -- Post all payments
  for v_payment in
    select p.* from payments p
    join sales s on s.id = p.sale_id
    where s.business_id = p_business_id
      and not exists (select 1 from journal_entries je where je.reference_type = 'payment' and je.reference_id = p.id)
  loop
    perform post_payment_to_gl() from payments where id = v_payment.id;
    v_count := v_count + 1;
  end loop;

  return 'Posted ' || v_count || ' entries to GL';
end;
$$ language plpgsql;

-- =====================================================================
-- END OF MIGRATION v11
-- =====================================================================
