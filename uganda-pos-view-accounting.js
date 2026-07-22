// =====================================================================
// QWICKPOS — ACCOUNTING VIEW (Expenses + simplified statements)
//
// IMPORTANT: the P&L / Balance Sheet / Cash Flow shown here are MANAGERIAL
// approximations built from the data this POS already has (sales, payments,
// expenses, current stock, current cost prices). They are NOT statutory
// financial statements — there's no full double-entry ledger, no accruals,
// no fixed-asset register, and cost of goods sold uses TODAY's cost price
// rather than the historical cost at time of sale. Every screen says so.
// Hand this to your accountant as a starting point, not a filed report.
// =====================================================================
import {
  supabase, STATE, $, qsa, escapeHtml, toast, hasRole,
  fmtMoney, fmtMoneyRaw, stockFor,
} from './uganda-pos-core.js';

let acctTab = 'expenses';

export async function renderAccounting(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Accounting</h2><p class="sub">Expenses, and simplified managerial statements — not a substitute for statutory accounts.</p></div>
    </div>
    <div class="category-chips" style="margin-bottom:16px;">
      ${[
        ['expenses', '💸 Expenses'],
        ['pnl', '📈 Profit &amp; Loss'],
        ['balance', '⚖️ Balance Sheet'],
        ['cashflow', '💵 Cash Flow'],
      ].map(([key, label]) => `<button class="chip ${acctTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}
    </div>
    <div id="acct-body"></div>
  `;

  qsa('.chip', root).forEach((chip) => chip.addEventListener('click', () => { acctTab = chip.dataset.tab; renderAccounting(root); }));

  const body = $('acct-body');
  if (acctTab === 'expenses') await renderExpensesTab(body);
  else if (acctTab === 'pnl') await renderPnlTab(body);
  else if (acctTab === 'balance') await renderBalanceSheetTab(body);
  else await renderCashFlowTab(body);
}

function monthRange() {
  const from = new Date(); from.setDate(1);
  const to = new Date();
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// =====================================================================
// EXPENSES
// =====================================================================
async function renderExpensesTab(body) {
  body.innerHTML = `<div class="empty-state">Loading expenses…</div>`;
  const { data } = await supabase.from('expenses').select('*').eq('business_id', STATE.business.id)
    .order('expense_date', { ascending: false }).limit(200);
  const expenses = data || [];
  const total = expenses.reduce((a, e) => a + Number(e.amount_base || 0), 0);

  body.innerHTML = `
    <div class="card">
      <div class="card-title">Record an Expense</div>
      <div class="field-row">
        <div class="field"><label>Category</label>
          <select id="ex-category">
            <option>Rent</option><option>Utilities</option><option>Salaries</option>
            <option>Transport</option><option>Airtime/Data</option><option>Supplies</option>
            <option>Repairs &amp; Maintenance</option><option>Marketing</option><option>Other</option>
          </select>
        </div>
        <div class="field"><label>Date</label><input type="date" id="ex-date" value="${new Date().toISOString().slice(0, 10)}" /></div>
      </div>
      <div class="field"><label>Description</label><input id="ex-desc" placeholder="e.g. Shop rent — July" /></div>
      <div class="field-row">
        <div class="field"><label>Amount</label><input type="number" step="0.01" min="0" id="ex-amount" placeholder="0.00" /></div>
        <div class="field"><label>Currency</label>
          <select id="ex-currency">${STATE.currencies.map((c) => `<option value="${c.code}" ${c.is_base ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Payment Method</label>
          <select id="ex-method">
            <option value="cash">Cash</option><option value="mobile_money">Mobile Money</option>
            <option value="bank">Bank</option><option value="card">Card</option><option value="credit">Credit</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" id="add-expense-btn">+ Add Expense</button>
    </div>

    <div class="card">
      <div class="card-title">Recent Expenses <span class="text-muted" style="font-weight:400;">— total ${fmtMoney(total)}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Amount</th><th></th></tr></thead>
          <tbody id="expenses-table-body">
            ${!expenses.length ? `<tr><td colspan="6"><div class="empty-state">No expenses recorded yet.</div></td></tr>` : expenses.map((e) => `
              <tr>
                <td>${escapeHtml(e.expense_date)}</td>
                <td>${escapeHtml(e.category)}</td>
                <td>${escapeHtml(e.description || '—')}</td>
                <td>${escapeHtml((e.payment_method || 'cash').replace('_', ' '))}</td>
                <td>${fmtMoneyRaw(Number(e.amount), e.currency_code)}</td>
                <td><button class="btn btn-ghost btn-sm" data-del="${e.id}">Delete</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  $('add-expense-btn').addEventListener('click', async () => {
    const category = $('ex-category').value;
    const description = $('ex-desc').value.trim();
    const amount = parseFloat($('ex-amount').value);
    const currency = $('ex-currency').value;
    const method = $('ex-method').value;
    const date = $('ex-date').value;
    if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }

    const rate = STATE.rates[currency] ?? 1;
    const amountBase = Math.round((amount * rate + Number.EPSILON) * 100) / 100;

    const { error } = await supabase.from('expenses').insert({
      business_id: STATE.business.id, branch_id: STATE.branch?.id,
      category, description: description || null, amount, currency_code: currency,
      amount_base: amountBase, payment_method: method, expense_date: date,
      created_by: STATE.appUser.id,
    });
    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    toast('Expense recorded', 'success');
    renderExpensesTab(body);
  });

  qsa('[data-del]', body).forEach((btn) => btn.addEventListener('click', async () => {
    if (!hasRole('admin', 'manager', 'accountant')) { toast('You do not have permission to delete expenses', 'error'); return; }
    if (!confirm('Delete this expense?')) return;
    await supabase.from('expenses').delete().eq('id', btn.dataset.del);
    renderExpensesTab(body);
  }));
}

// =====================================================================
// PROFIT & LOSS
// =====================================================================
async function renderPnlTab(body) {
  const { from, to } = monthRange();
  body.innerHTML = rangeFormHtml('pnl', from, to);
  await runPnl(body, from, to);
  $('acct-run-btn').addEventListener('click', () => runPnl(body, $('acct-from').value, $('acct-to').value));
}

async function runPnl(body, from, to) {
  const out = $('acct-report-output');
  out.innerHTML = `<div class="empty-state">Crunching numbers…</div>`;

  const [{ data: sales }, { data: expenses }] = await Promise.all([
    supabase.from('sales').select('*, sale_items(*)').eq('business_id', STATE.business.id)
      .neq('sale_type', 'quotation').neq('status', 'voided')
      .gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`),
    supabase.from('expenses').select('*').eq('business_id', STATE.business.id)
      .gte('expense_date', from).lte('expense_date', to),
  ]);

  const salesRows = sales || [];
  const grossRevenue = salesRows.reduce((a, s) => a + Number(s.grand_total_base || 0), 0);
  const vatCollected = salesRows.reduce((a, s) => a + Number(s.vat_total || 0) * Number(s.exchange_rate || 1), 0);
  const netRevenue = grossRevenue - vatCollected;

  const costByProduct = Object.fromEntries(STATE.products.map((p) => [p.id, Number(p.cost_price || 0)]));
  let cogs = 0;
  salesRows.forEach((s) => (s.sale_items || []).forEach((it) => { cogs += Number(it.quantity || 0) * (costByProduct[it.product_id] || 0); }));

  const grossProfit = netRevenue - cogs;

  const expenseRows = expenses || [];
  const expenseByCategory = {};
  expenseRows.forEach((e) => { expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + Number(e.amount_base || 0); });
  const totalExpenses = expenseRows.reduce((a, e) => a + Number(e.amount_base || 0), 0);

  const netProfit = grossProfit - totalExpenses;

  out.innerHTML = `
    ${nonStatutoryNote()}
    <div class="card">
      <div class="card-title">Profit &amp; Loss — ${escapeHtml(from)} to ${escapeHtml(to)}</div>
      <table class="stmt-table">
        <tr><td>Gross Sales Revenue (VAT-inclusive)</td><td class="num">${fmtMoney(grossRevenue)}</td></tr>
        <tr><td>Less: VAT Collected (not revenue)</td><td class="num">(${fmtMoney(vatCollected)})</td></tr>
        <tr class="subtotal"><td><b>Net Sales Revenue</b></td><td class="num"><b>${fmtMoney(netRevenue)}</b></td></tr>
        <tr><td>Less: Cost of Goods Sold <span class="text-muted">(at today's cost price)</span></td><td class="num">(${fmtMoney(cogs)})</td></tr>
        <tr class="subtotal"><td><b>Gross Profit</b></td><td class="num"><b>${fmtMoney(grossProfit)}</b></td></tr>
        ${Object.entries(expenseByCategory).map(([cat, amt]) => `<tr><td>Less: ${escapeHtml(cat)}</td><td class="num">(${fmtMoney(amt)})</td></tr>`).join('')}
        <tr><td><b>Total Operating Expenses</b></td><td class="num">(${fmtMoney(totalExpenses)})</td></tr>
        <tr class="total"><td><b>Net Profit ${netProfit >= 0 ? '' : '(Loss)'}</b></td><td class="num"><b>${fmtMoney(netProfit)}</b></td></tr>
      </table>
    </div>
  `;
}

// =====================================================================
// BALANCE SHEET (point-in-time snapshot, "as of" today)
// =====================================================================
async function renderBalanceSheetTab(body) {
  body.innerHTML = `<div class="empty-state">Loading balance sheet…</div>`;

  const [{ data: allPayments }, { data: allExpenses }, { data: allSupplierPayments }, { data: receivedPOItems }] = await Promise.all([
    supabase.from('payments').select('amount_base, sales!inner(business_id)').eq('sales.business_id', STATE.business.id),
    supabase.from('expenses').select('amount_base').eq('business_id', STATE.business.id),
    supabase.from('supplier_payments').select('amount, currency_code, suppliers!inner(business_id)').eq('suppliers.business_id', STATE.business.id),
    supabase.from('purchase_order_items').select('quantity, unit_cost, purchase_orders!inner(business_id, status)').eq('purchase_orders.business_id', STATE.business.id).eq('purchase_orders.status', 'received'),
  ]);

  const cashIn = (allPayments || []).reduce((a, p) => a + Number(p.amount_base || 0), 0);
  const cashOutExpenses = (allExpenses || []).reduce((a, e) => a + Number(e.amount_base || 0), 0);
  // supplier_payments doesn't store amount_base — approximate at 1:1 if no rate available (most POs are in base currency).
  const cashOutSuppliers = (allSupplierPayments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
  const estimatedCash = cashIn - cashOutExpenses - cashOutSuppliers;

  const inventoryValue = STATE.products.reduce((a, p) => a + stockFor(p.id) * Number(p.cost_price || 0), 0);
  const accountsReceivable = STATE.customers.reduce((a, c) => a + Math.max(0, Number(c.balance || 0)), 0);

  const accountsPayableGross = (receivedPOItems || []).reduce((a, it) => a + Number(it.quantity || 0) * Number(it.unit_cost || 0), 0);
  const accountsPayable = Math.max(0, accountsPayableGross - cashOutSuppliers);

  const totalAssets = Math.max(0, estimatedCash) + inventoryValue + accountsReceivable;
  const totalLiabilities = accountsPayable;
  const equity = totalAssets - totalLiabilities;

  body.innerHTML = `
    ${nonStatutoryNote()}
    <div class="card">
      <div class="card-title">Balance Sheet — as of ${escapeHtml(new Date().toISOString().slice(0, 10))}</div>
      <table class="stmt-table">
        <tr><td colspan="2"><b>Assets</b></td></tr>
        <tr><td>Cash &amp; Mobile Money <span class="text-muted">(estimated from payments received less expenses/supplier payouts)</span></td><td class="num">${fmtMoney(Math.max(0, estimatedCash))}</td></tr>
        <tr><td>Inventory on Hand <span class="text-muted">(at cost)</span></td><td class="num">${fmtMoney(inventoryValue)}</td></tr>
        <tr><td>Accounts Receivable <span class="text-muted">(customer credit balances)</span></td><td class="num">${fmtMoney(accountsReceivable)}</td></tr>
        <tr class="subtotal"><td><b>Total Assets</b></td><td class="num"><b>${fmtMoney(totalAssets)}</b></td></tr>
        <tr><td colspan="2" style="padding-top:14px;"><b>Liabilities</b></td></tr>
        <tr><td>Accounts Payable <span class="text-muted">(received stock not yet paid to suppliers)</span></td><td class="num">${fmtMoney(accountsPayable)}</td></tr>
        <tr class="subtotal"><td><b>Total Liabilities</b></td><td class="num"><b>${fmtMoney(totalLiabilities)}</b></td></tr>
        <tr class="total" style="margin-top:10px;"><td><b>Owner's Equity <span class="text-muted" style="font-weight:400;">(Assets − Liabilities)</span></b></td><td class="num"><b>${fmtMoney(equity)}</b></td></tr>
      </table>
    </div>
  `;
}

// =====================================================================
// CASH FLOW (date range)
// =====================================================================
async function renderCashFlowTab(body) {
  const { from, to } = monthRange();
  body.innerHTML = rangeFormHtml('cashflow', from, to);
  await runCashFlow(body, from, to);
  $('acct-run-btn').addEventListener('click', () => runCashFlow(body, $('acct-from').value, $('acct-to').value));
}

async function runCashFlow(body, from, to) {
  const out = $('acct-report-output');
  out.innerHTML = `<div class="empty-state">Crunching numbers…</div>`;

  const [{ data: payments }, { data: expenses }, { data: supplierPayments }] = await Promise.all([
    supabase.from('payments').select('amount_base, method, sales!inner(business_id)').eq('sales.business_id', STATE.business.id)
      .gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`),
    supabase.from('expenses').select('amount_base, method:payment_method').eq('business_id', STATE.business.id)
      .gte('expense_date', from).lte('expense_date', to),
    supabase.from('supplier_payments').select('amount, suppliers!inner(business_id)').eq('suppliers.business_id', STATE.business.id)
      .gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`),
  ]);

  const inByMethod = {};
  (payments || []).forEach((p) => { inByMethod[p.method] = (inByMethod[p.method] || 0) + Number(p.amount_base || 0); });
  const totalIn = Object.values(inByMethod).reduce((a, v) => a + v, 0);

  const outByMethod = {};
  (expenses || []).forEach((e) => { outByMethod[e.method] = (outByMethod[e.method] || 0) + Number(e.amount_base || 0); });
  const totalExpenseOut = Object.values(outByMethod).reduce((a, v) => a + v, 0);
  const totalSupplierOut = (supplierPayments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
  const totalOut = totalExpenseOut + totalSupplierOut;

  const net = totalIn - totalOut;

  out.innerHTML = `
    ${nonStatutoryNote()}
    <div class="card">
      <div class="card-title">Cash Flow — ${escapeHtml(from)} to ${escapeHtml(to)}</div>
      <table class="stmt-table">
        <tr><td colspan="2"><b>Cash In (from sales payments)</b></td></tr>
        ${Object.entries(inByMethod).map(([m, amt]) => `<tr><td>${escapeHtml(m.replace('_', ' '))}</td><td class="num">${fmtMoney(amt)}</td></tr>`).join('') || '<tr><td class="text-muted">No payments in range</td><td></td></tr>'}
        <tr class="subtotal"><td><b>Total Cash In</b></td><td class="num"><b>${fmtMoney(totalIn)}</b></td></tr>
        <tr><td colspan="2" style="padding-top:14px;"><b>Cash Out</b></td></tr>
        ${Object.entries(outByMethod).map(([m, amt]) => `<tr><td>Expenses — ${escapeHtml(m.replace('_', ' '))}</td><td class="num">(${fmtMoney(amt)})</td></tr>`).join('')}
        <tr><td>Supplier Payments</td><td class="num">(${fmtMoney(totalSupplierOut)})</td></tr>
        <tr class="subtotal"><td><b>Total Cash Out</b></td><td class="num"><b>(${fmtMoney(totalOut)})</b></td></tr>
        <tr class="total"><td><b>Net Cash Flow</b></td><td class="num"><b>${fmtMoney(net)}</b></td></tr>
      </table>
    </div>
  `;
}

// =====================================================================
// SHARED UI HELPERS
// =====================================================================
function rangeFormHtml(reportKey, from, to) {
  return `
    <div class="card">
      <div class="field-row" style="align-items:end;">
        <div class="field"><label>From</label><input type="date" id="acct-from" value="${from}" /></div>
        <div class="field"><label>To</label><input type="date" id="acct-to" value="${to}" /></div>
        <button class="btn btn-primary" id="acct-run-btn">Run Report</button>
      </div>
    </div>
    <div id="acct-report-output"></div>
  `;
}

function nonStatutoryNote() {
  return `
    <div class="card" style="border-color:var(--warning); background:var(--warning-light); margin-bottom:16px;">
      <b>Managerial estimate, not a statutory statement.</b> Built from your sales, payments, expenses and current
      stock/cost data — there's no full double-entry ledger behind it. Share it with your accountant as a starting
      point before filing anything with URA.
    </div>`;
}
