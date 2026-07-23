// =====================================================================
// QWICKPOS — ACCOUNTING VIEW
// Expenses, General Ledger, Journal Entries, Trial Balance,
// P&L, Balance Sheet, Cash Flow
// =====================================================================
import {
  supabase,
  STATE,
  $,
  qsa,
  escapeHtml,
  toast,
  hasRole,
  fmtMoney,
  fmtMoneyRaw,
  stockFor,
  sanitizeCsvValue,
} from "./uganda-pos-core.js";

let acctTab = "ledger";

const PERIODS = [
  ["today", "Today"],
  ["week", "This Week"],
  ["month", "This Month"],
  ["quarter", "This Quarter"],
  ["year", "This Year"],
  ["custom", "Custom"],
];

function periodRange(key) {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from;
  if (key === "today") from = to;
  else if (key === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    from = d.toISOString().slice(0, 10);
  } else if (key === "month") {
    const d = new Date(now);
    d.setDate(1);
    from = d.toISOString().slice(0, 10);
  } else if (key === "quarter") {
    const d = new Date(now);
    d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
    from = d.toISOString().slice(0, 10);
  } else if (key === "year") {
    from = `${now.getFullYear()}-01-01`;
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    from = d.toISOString().slice(0, 10);
  }
  return { from, to };
}

function downloadCsv(rows, header, filename) {
  const csv = [header, ...rows]
    .map((r) =>
      r.map((v) => `"${sanitizeCsvValue(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function renderAccounting(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Accounting</h2><p class="sub">General Ledger, Journal Entries, Trial Balance, and financial statements</p></div>
    </div>
    <div class="notif-filters" id="acct-tabs" style="margin-bottom:16px;">
      ${[
        ["ledger", "📒 General Ledger"],
        ["journal", "📓 Journal Entries"],
        ["trial", "⚖️ Trial Balance"],
        ["expenses", "💸 Expenses"],
        ["pnl", "📈 Profit &amp; Loss"],
        ["balance", "🏦 Balance Sheet"],
        ["cashflow", "💵 Cash Flow"],
      ]
        .map(
          ([key, label]) =>
            `<button class="chip ${acctTab === key ? "active" : ""}" data-tab="${key}">${label}</button>`,
        )
        .join("")}
    </div>
    <div id="acct-body"></div>
  `;

  qsa("#acct-tabs .chip", root).forEach((chip) =>
    chip.addEventListener("click", () => {
      acctTab = chip.dataset.tab;
      qsa("#acct-tabs .chip", root).forEach((c) =>
        c.classList.toggle("active", c === chip),
      );
      renderTab();
    }),
  );

  await renderTab();

  async function renderTab() {
    const body = $("acct-body");
    if (acctTab === "ledger") await renderLedgerTab(body);
    else if (acctTab === "journal") await renderJournalTab(body);
    else if (acctTab === "trial") await renderTrialBalanceTab(body);
    else if (acctTab === "expenses") await renderExpensesTab(body);
    else if (acctTab === "pnl") await renderPnlTab(body);
    else if (acctTab === "balance") await renderBalanceSheetTab(body);
    else if (acctTab === "cashflow") await renderCashFlowTab(body);
  }
}

function periodPickerHtml(key, id) {
  return `
    <div class="field-row" style="align-items:end; flex-wrap:wrap; gap:8px;">
      ${PERIODS.map(([k, label]) => `<button class="btn btn-sm ${k === key ? "btn-primary" : "btn-outline"}" data-period="${k}" data-for="${id}">${label}</button>`).join("")}
      <div class="field"><label>From</label><input type="date" id="${id}-from" value="${periodRange(key).from}" /></div>
      <div class="field"><label>To</label><input type="date" id="${id}-to" value="${periodRange(key).to}" /></div>
      <button class="btn btn-primary" id="${id}-run">Run</button>
      <button class="btn btn-outline" id="${id}-export">Export CSV</button>
    </div>`;
}

function wirePeriodButtons(rootId) {
  qsa(`[data-for="${rootId}"]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = periodRange(btn.dataset.period);
      $(`${rootId}-from`).value = r.from;
      $(`${rootId}-to`).value = r.to;
      qsa(`[data-for="${rootId}"]`).forEach(
        (b) =>
          (b.className =
            b === btn ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline"),
      );
    });
  });
}

function nonStatutoryNote() {
  return `<div class="card" style="border-color:var(--warning); background:var(--warning-light); margin-bottom:16px;">
    <b>Managerial estimate, not a statutory statement.</b> Share with your accountant as a starting point before filing with URA.</div>`;
}

// =====================================================================
// GENERAL LEDGER — aggregated from sales, expenses, POs
// =====================================================================
async function renderLedgerTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">General Ledger</div>
      ${periodPickerHtml("month", "gl")}
    </div>
    <div id="gl-output"><div class="empty-state">Loading…</div></div>`;

  wirePeriodButtons("gl");
  let allEntries = [];

  $("gl-run").addEventListener("click", () => load());
  $("gl-export").addEventListener("click", () => exportGl());
  await load();

  async function load() {
    const from = $("gl-from").value;
    const to = $("gl-to").value;
    const out = $("gl-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    const [
      { data: sales },
      { data: expenses },
      { data: payments },
      { data: supplierPayments },
    ] = await Promise.all([
      supabase
        .from("sales")
        .select("*, sale_items(*)")
        .eq("business_id", STATE.business.id)
        .neq("status", "voided")
        .neq("sale_type", "quotation")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      supabase
        .from("expenses")
        .select("*")
        .eq("business_id", STATE.business.id)
        .gte("expense_date", from)
        .lte("expense_date", to),
      supabase
        .from("payments")
        .select("*, sales!inner(business_id, sale_number)")
        .eq("sales.business_id", STATE.business.id)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      supabase
        .from("supplier_payments")
        .select("*, suppliers!inner(business_id)")
        .eq("suppliers.business_id", STATE.business.id)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
    ]);

    allEntries = [];

    // Sales → Revenue
    (sales || []).forEach((s) => {
      allEntries.push({
        date: s.created_at,
        ref: s.sale_number,
        account: "Sales Revenue",
        debit: 0,
        credit: Number(s.grand_total_base || 0),
        description: `Sale ${s.sale_number}`,
      });
      if (Number(s.vat_total || 0) > 0) {
        allEntries.push({
          date: s.created_at,
          ref: s.sale_number,
          account: "VAT Payable",
          debit: 0,
          credit: Number(s.vat_total || 0) * Number(s.exchange_rate || 1),
          description: `VAT on ${s.sale_number}`,
        });
      }
      if (Number(s.discount_total || 0) > 0) {
        allEntries.push({
          date: s.created_at,
          ref: s.sale_number,
          account: "Discounts Allowed",
          debit: Number(s.discount_total || 0) * Number(s.exchange_rate || 1),
          credit: 0,
          description: `Discount on ${s.sale_number}`,
        });
      }
    });

    // Payments → Cash
    (payments || []).forEach((p) => {
      allEntries.push({
        date: p.created_at,
        ref: p.sales?.sale_number || "—",
        account: "Cash & Bank",
        debit: Number(p.amount_base || 0),
        credit: 0,
        description: `Payment received (${p.method})`,
      });
    });

    // Expenses
    (expenses || []).forEach((e) => {
      allEntries.push({
        date: e.created_at,
        ref: "EXP",
        account: `Expense — ${e.category}`,
        debit: Number(e.amount_base || 0),
        credit: 0,
        description: e.description || e.category,
      });
      allEntries.push({
        date: e.created_at,
        ref: "EXP",
        account: "Cash & Bank",
        debit: 0,
        credit: Number(e.amount_base || 0),
        description: e.description || e.category,
      });
    });

    // Supplier payments
    (supplierPayments || []).forEach((sp) => {
      allEntries.push({
        date: sp.created_at,
        ref: "SUP",
        account: "Accounts Payable",
        debit: Number(sp.amount || 0),
        credit: 0,
        description: "Supplier payment",
      });
      allEntries.push({
        date: sp.created_at,
        ref: "SUP",
        account: "Cash & Bank",
        debit: 0,
        credit: Number(sp.amount || 0),
        description: "Supplier payment",
      });
    });

    allEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Running balance
    let balance = 0;
    allEntries.forEach((e) => {
      balance += e.debit - e.credit;
      e.balance = balance;
    });

    out.innerHTML = `
      <div class="card">
        <div class="card-title">Ledger Entries (${allEntries.length})</div>
        <div class="table-wrap" style="max-height:500px; overflow-y:auto;"><table>
          <thead><tr><th>Date</th><th>Ref</th><th>Account</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Description</th></tr></thead>
          <tbody>
            ${
              allEntries.length
                ? allEntries
                    .map(
                      (e) => `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td>${escapeHtml(e.ref)}</td>
                <td>${escapeHtml(e.account)}</td>
                <td class="num">${e.debit ? fmtMoney(e.debit) : ""}</td>
                <td class="num">${e.credit ? fmtMoney(e.credit) : ""}</td>
                <td class="num" style="font-weight:700;">${fmtMoney(e.balance)}</td>
                <td class="text-muted">${escapeHtml(e.description)}</td>
              </tr>`,
                    )
                    .join("")
                : '<tr><td colspan="7"><div class="empty-state">No entries in this range.</div></td></tr>'
            }
          </tbody></table></div>
      </div>`;
  }

  function exportGl() {
    downloadCsv(
      allEntries.map((e) => [
        e.date,
        e.ref,
        e.account,
        e.debit,
        e.credit,
        e.balance,
        e.description,
      ]),
      ["Date", "Ref", "Account", "Debit", "Credit", "Balance", "Description"],
      `general-ledger-${$("gl-from").value}-to-${$("gl-to").value}.csv`,
    );
  }
}

// =====================================================================
// JOURNAL ENTRIES
// =====================================================================
async function renderJournalTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Journal Entries</div>
      ${periodPickerHtml("month", "je")}
    </div>
    <div id="je-output"><div class="empty-state">Loading…</div></div>`;

  wirePeriodButtons("je");
  let entries = [];

  $("je-run").addEventListener("click", () => load());
  $("je-export").addEventListener("click", () => exportJe());
  await load();

  async function load() {
    const from = $("je-from").value;
    const to = $("je-to").value;
    const out = $("je-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    const [{ data: sales }, { data: expenses }, { data: supplierPayments }] =
      await Promise.all([
        supabase
          .from("sales")
          .select("*")
          .eq("business_id", STATE.business.id)
          .neq("status", "voided")
          .neq("sale_type", "quotation")
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`),
        supabase
          .from("expenses")
          .select("*")
          .eq("business_id", STATE.business.id)
          .gte("expense_date", from)
          .lte("expense_date", to),
        supabase
          .from("supplier_payments")
          .select("*, suppliers!inner(business_id)")
          .eq("suppliers.business_id", STATE.business.id)
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`),
      ]);

    entries = [];
    let jeNum = 1;

    // Each sale → Journal Entry
    (sales || []).forEach((s) => {
      const netAmount =
        Number(s.grand_total_base || 0) -
        Number(s.vat_total || 0) * Number(s.exchange_rate || 1);
      entries.push({
        date: s.created_at,
        je_number: `JE-${String(jeNum++).padStart(4, "0")}`,
        reference: s.sale_number,
        lines: [
          {
            account: "Cash & Bank",
            debit: Number(s.grand_total_base || 0),
            credit: 0,
          },
          { account: "Sales Revenue", debit: 0, credit: netAmount },
          ...(Number(s.vat_total || 0) > 0
            ? [
                {
                  account: "VAT Payable",
                  debit: 0,
                  credit:
                    Number(s.vat_total || 0) * Number(s.exchange_rate || 1),
                },
              ]
            : []),
        ],
        total: Number(s.grand_total_base || 0),
        description: `Sale ${s.sale_number}`,
      });
    });

    // Each expense → Journal Entry
    (expenses || []).forEach((e) => {
      entries.push({
        date: e.created_at,
        je_number: `JE-${String(jeNum++).padStart(4, "0")}`,
        reference: "EXP",
        lines: [
          {
            account: `Expense — ${e.category}`,
            debit: Number(e.amount_base || 0),
            credit: 0,
          },
          {
            account: "Cash & Bank",
            debit: 0,
            credit: Number(e.amount_base || 0),
          },
        ],
        total: Number(e.amount_base || 0),
        description: e.description || e.category,
      });
    });

    // Supplier payments → Journal Entry
    (supplierPayments || []).forEach((sp) => {
      entries.push({
        date: sp.created_at,
        je_number: `JE-${String(jeNum++).padStart(4, "0")}`,
        reference: "SUP",
        lines: [
          {
            account: "Accounts Payable",
            debit: Number(sp.amount || 0),
            credit: 0,
          },
          { account: "Cash & Bank", debit: 0, credit: Number(sp.amount || 0) },
        ],
        total: Number(sp.amount || 0),
        description: "Supplier payment",
      });
    });

    entries.sort((a, b) => new Date(a.date) - new Date(b.date));

    out.innerHTML = `
      <div class="card">
        <div class="card-title">Journal Entries (${entries.length})</div>
        <div class="table-wrap" style="max-height:500px; overflow-y:auto;"><table>
          <thead><tr><th>Date</th><th>JE #</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead>
          <tbody>
            ${
              entries.length
                ? entries
                    .map(
                      (je) => `
              <tr>
                <td>${fmtDate(je.date)}</td>
                <td><b>${escapeHtml(je.je_number)}</b></td>
                <td>${escapeHtml(je.reference)}</td>
                <td>${escapeHtml(je.description)}</td>
                <td class="num">${fmtMoney(je.total)}</td>
                <td class="num">${fmtMoney(je.total)}</td>
              </tr>
              ${je.lines
                .map(
                  (l) => `
                <tr style="background:var(--surface-2);">
                  <td></td><td></td>
                  <td style="padding-left:24px;">↳ ${escapeHtml(l.account)}</td>
                  <td></td>
                  <td class="num">${l.debit ? fmtMoney(l.debit) : ""}</td>
                  <td class="num">${l.credit ? fmtMoney(l.credit) : ""}</td>
                </tr>`,
                )
                .join("")}
            `,
                    )
                    .join("")
                : '<tr><td colspan="6"><div class="empty-state">No journal entries in this range.</div></td></tr>'
            }
          </tbody></table></div>
      </div>`;
  }

  function exportJe() {
    const rows = [];
    entries.forEach((je) => {
      je.lines.forEach((l) => {
        rows.push([
          je.date,
          je.je_number,
          je.reference,
          l.account,
          l.debit,
          l.credit,
          je.description,
        ]);
      });
    });
    downloadCsv(
      rows,
      [
        "Date",
        "JE #",
        "Reference",
        "Account",
        "Debit",
        "Credit",
        "Description",
      ],
      `journal-entries-${$("je-from").value}-to-${$("je-to").value}.csv`,
    );
  }
}

// =====================================================================
// TRIAL BALANCE
// =====================================================================
async function renderTrialBalanceTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Trial Balance</div>
      ${periodPickerHtml("month", "tb")}
    </div>
    <div id="tb-output"><div class="empty-state">Loading…</div></div>`;

  wirePeriodButtons("tb");

  $("tb-run").addEventListener("click", () => load());
  $("tb-export").addEventListener("click", () => exportTb());
  await load();

  async function load() {
    const from = $("tb-from").value;
    const to = $("tb-to").value;
    const out = $("tb-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    const [
      { data: sales },
      { data: expenses },
      { data: payments },
      { data: supplierPayments },
      { data: poItems },
    ] = await Promise.all([
      supabase
        .from("sales")
        .select("*")
        .eq("business_id", STATE.business.id)
        .neq("status", "voided")
        .neq("sale_type", "quotation")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      supabase
        .from("expenses")
        .select("*")
        .eq("business_id", STATE.business.id)
        .gte("expense_date", from)
        .lte("expense_date", to),
      supabase
        .from("payments")
        .select("amount_base, sales!inner(business_id)")
        .eq("sales.business_id", STATE.business.id)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      supabase
        .from("supplier_payments")
        .select("amount, suppliers!inner(business_id)")
        .eq("suppliers.business_id", STATE.business.id)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      supabase
        .from("purchase_order_items")
        .select(
          "quantity, unit_cost, purchase_orders!inner(business_id, status)",
        )
        .eq("purchase_orders.business_id", STATE.business.id)
        .eq("purchase_orders.status", "received"),
    ]);

    const accounts = {};

    function debit(account, amount) {
      if (!accounts[account]) accounts[account] = { debit: 0, credit: 0 };
      accounts[account].debit += amount;
    }
    function credit(account, amount) {
      if (!accounts[account]) accounts[account] = { debit: 0, credit: 0 };
      accounts[account].credit += amount;
    }

    // Sales
    (sales || []).forEach((s) => {
      const base = Number(s.grand_total_base || 0);
      const vat = Number(s.vat_total || 0) * Number(s.exchange_rate || 1);
      debit("Cash & Bank", base);
      credit("Sales Revenue", base - vat);
      if (vat > 0) credit("VAT Payable", vat);
    });

    // Payments
    (payments || []).forEach((p) => {
      debit("Cash & Bank", Number(p.amount_base || 0));
    });

    // Expenses
    (expenses || []).forEach((e) => {
      debit(`Expense — ${e.category}`, Number(e.amount_base || 0));
      credit("Cash & Bank", Number(e.amount_base || 0));
    });

    // Supplier payments
    (supplierPayments || []).forEach((sp) => {
      debit("Accounts Payable", Number(sp.amount || 0));
      credit("Cash & Bank", Number(sp.amount || 0));
    });

    // Inventory (asset)
    const inventoryValue = STATE.products.reduce(
      (a, p) => a + stockFor(p.id) * Number(p.cost_price || 0),
      0,
    );
    debit("Inventory", inventoryValue);

    // Accounts Receivable
    const ar = STATE.customers.reduce(
      (a, c) => a + Math.max(0, Number(c.balance || 0)),
      0,
    );
    debit("Accounts Receivable", ar);

    // Accounts Payable (from received POs)
    const apGross = (poItems || []).reduce(
      (a, it) => a + Number(it.quantity || 0) * Number(it.unit_cost || 0),
      0,
    );
    const apPaid = (supplierPayments || []).reduce(
      (a, sp) => a + Number(sp.amount || 0),
      0,
    );
    const ap = Math.max(0, apGross - apPaid);
    credit("Accounts Payable", ap);

    const rows = Object.entries(accounts)
      .map(([name, v]) => ({
        name,
        debit: v.debit,
        credit: v.credit,
        balance: v.debit - v.credit,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalDebit = rows.reduce((a, r) => a + r.debit, 0);
    const totalCredit = rows.reduce((a, r) => a + r.credit, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    window._tbRows = rows;

    out.innerHTML = `
      <div class="card" style="border-color:${isBalanced ? "var(--brand)" : "var(--danger)"}; background:${isBalanced ? "var(--brand-light)" : "var(--danger-light)"}; margin-bottom:16px;">
        <b>${isBalanced ? "✅ Trial Balance is balanced" : "⚠️ Trial Balance is OUT OF BALANCE — investigate."}</b>
      </div>
      <div class="card">
        <div class="card-title">Trial Balance — ${escapeHtml(from)} to ${escapeHtml(to)}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Account</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Balance</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr>
                <td>${escapeHtml(r.name)}</td>
                <td class="num">${r.debit ? fmtMoney(r.debit) : ""}</td>
                <td class="num">${r.credit ? fmtMoney(r.credit) : ""}</td>
                <td class="num" style="font-weight:700; color:${r.balance >= 0 ? "inherit" : "var(--danger)"};">${fmtMoney(r.balance)}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr style="font-weight:700; border-top:2px solid var(--border);">
              <td>TOTAL</td>
              <td class="num">${fmtMoney(totalDebit)}</td>
              <td class="num">${fmtMoney(totalCredit)}</td>
              <td class="num">${fmtMoney(totalDebit - totalCredit)}</td>
            </tr>
          </tfoot>
        </table></div>
      </div>`;
  }

  function exportTb() {
    const rows = window._tbRows || [];
    downloadCsv(
      rows.map((r) => [r.name, r.debit, r.credit, r.balance]),
      ["Account", "Debit", "Credit", "Balance"],
      `trial-balance-${$("tb-from").value}-to-${$("tb-to").value}.csv`,
    );
  }
}

// =====================================================================
// EXPENSES
// =====================================================================
async function renderExpensesTab(body) {
  body.innerHTML = `<div class="empty-state">Loading expenses…</div>`;
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("expense_date", { ascending: false })
    .limit(200);
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
          <select id="ex-currency">${STATE.currencies.map((c) => `<option value="${c.code}" ${c.is_base ? "selected" : ""}>${c.code}</option>`).join("")}</select>
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
          <tbody>
            ${
              !expenses.length
                ? `<tr><td colspan="6"><div class="empty-state">No expenses recorded yet.</div></td></tr>`
                : expenses
                    .map(
                      (e) => `
              <tr>
                <td>${escapeHtml(e.expense_date)}</td>
                <td>${escapeHtml(e.category)}</td>
                <td>${escapeHtml(e.description || "—")}</td>
                <td>${escapeHtml((e.payment_method || "cash").replace("_", " "))}</td>
                <td>${fmtMoneyRaw(Number(e.amount), e.currency_code)}</td>
                <td><button class="btn btn-ghost btn-sm" data-del="${e.id}">Delete</button></td>
              </tr>`,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $("add-expense-btn").addEventListener("click", async () => {
    const category = $("ex-category").value;
    const description = $("ex-desc").value.trim();
    const amount = parseFloat($("ex-amount").value);
    const currency = $("ex-currency").value;
    const method = $("ex-method").value;
    const date = $("ex-date").value;
    if (!amount || amount <= 0) {
      toast("Enter a valid amount", "error");
      return;
    }

    const rate = STATE.rates[currency] ?? 1;
    const amountBase = Math.round((amount * rate + Number.EPSILON) * 100) / 100;

    const { error } = await supabase.from("expenses").insert({
      business_id: STATE.business.id,
      branch_id: STATE.branch?.id,
      category,
      description: description || null,
      amount,
      currency_code: currency,
      amount_base: amountBase,
      payment_method: method,
      expense_date: date,
      created_by: STATE.appUser.id,
    });
    if (error) {
      toast("Failed: " + error.message, "error");
      return;
    }
    toast("Expense recorded", "success");
    renderExpensesTab(body);
  });

  qsa("[data-del]", body).forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!hasRole("admin", "manager", "accountant")) {
        toast("You do not have permission to delete expenses", "error");
        return;
      }
      if (!confirm("Delete this expense?")) return;
      await supabase.from("expenses").delete().eq("id", btn.dataset.del);
      renderExpensesTab(body);
    }),
  );
}

// =====================================================================
// PROFIT & LOSS
// =====================================================================
async function renderPnlTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Profit &amp; Loss</div>
      ${periodPickerHtml("month", "pnl")}
    </div>
    <div id="pnl-output"></div>`;

  wirePeriodButtons("pnl");
  await runPnl();
  $("pnl-run").addEventListener("click", runPnl);
  $("pnl-export").addEventListener("click", exportPnl);

  async function runPnl() {
    const from = $("pnl-from").value;
    const to = $("pnl-to").value;
    const out = $("pnl-output");
    out.innerHTML = `<div class="empty-state">Crunching numbers…</div>`;

    const [{ data: sales }, { data: expenses }] = await Promise.all([
      supabase
        .from("sales")
        .select("*, sale_items(*)")
        .eq("business_id", STATE.business.id)
        .neq("sale_type", "quotation")
        .neq("status", "voided")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      supabase
        .from("expenses")
        .select("*")
        .eq("business_id", STATE.business.id)
        .gte("expense_date", from)
        .lte("expense_date", to),
    ]);

    const salesRows = sales || [];
    const grossRevenue = salesRows.reduce(
      (a, s) => a + Number(s.grand_total_base || 0),
      0,
    );
    const vatCollected = salesRows.reduce(
      (a, s) => a + Number(s.vat_total || 0) * Number(s.exchange_rate || 1),
      0,
    );
    const netRevenue = grossRevenue - vatCollected;

    const costByProduct = Object.fromEntries(
      STATE.products.map((p) => [p.id, Number(p.cost_price || 0)]),
    );
    let cogs = 0;
    salesRows.forEach((s) =>
      (s.sale_items || []).forEach((it) => {
        cogs += Number(it.quantity || 0) * (costByProduct[it.product_id] || 0);
      }),
    );
    const grossProfit = netRevenue - cogs;

    const expenseRows = expenses || [];
    const expenseByCategory = {};
    expenseRows.forEach((e) => {
      expenseByCategory[e.category] =
        (expenseByCategory[e.category] || 0) + Number(e.amount_base || 0);
    });
    const totalExpenses = expenseRows.reduce(
      (a, e) => a + Number(e.amount_base || 0),
      0,
    );
    const netProfit = grossProfit - totalExpenses;

    window._pnlData = {
      grossRevenue,
      vatCollected,
      netRevenue,
      cogs,
      grossProfit,
      expenseByCategory,
      totalExpenses,
      netProfit,
    };

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
          ${Object.entries(expenseByCategory)
            .map(
              ([cat, amt]) =>
                `<tr><td>Less: ${escapeHtml(cat)}</td><td class="num">(${fmtMoney(amt)})</td></tr>`,
            )
            .join("")}
          <tr><td><b>Total Operating Expenses</b></td><td class="num">(${fmtMoney(totalExpenses)})</td></tr>
          <tr class="total"><td><b>Net Profit ${netProfit >= 0 ? "" : "(Loss)"}</b></td><td class="num"><b>${fmtMoney(netProfit)}</b></td></tr>
        </table>
      </div>`;
  }

  function exportPnl() {
    const d = window._pnlData || {};
    const rows = [
      ["Gross Sales Revenue", d.grossRevenue, ""],
      ["Less: VAT Collected", "", d.vatCollected],
      ["Net Sales Revenue", d.netRevenue, ""],
      ["Less: COGS", "", d.cogs],
      ["Gross Profit", d.grossProfit, ""],
      ...Object.entries(d.expenseByCategory || {}).map(([cat, amt]) => [
        `Less: ${cat}`,
        "",
        amt,
      ]),
      ["Total Expenses", "", d.totalExpenses],
      ["Net Profit", d.netProfit, ""],
    ];
    downloadCsv(
      rows,
      ["Line Item", "Amount", "Deduction"],
      `pnl-${$("pnl-from").value}-to-${$("pnl-to").value}.csv`,
    );
  }
}

// =====================================================================
// BALANCE SHEET
// =====================================================================
async function renderBalanceSheetTab(body) {
  body.innerHTML = `<div class="empty-state">Loading balance sheet…</div>`;

  const [
    { data: allPayments },
    { data: allExpenses },
    { data: allSupplierPayments },
    { data: receivedPOItems },
  ] = await Promise.all([
    supabase
      .from("payments")
      .select("amount_base, sales!inner(business_id)")
      .eq("sales.business_id", STATE.business.id),
    supabase
      .from("expenses")
      .select("amount_base")
      .eq("business_id", STATE.business.id),
    supabase
      .from("supplier_payments")
      .select("amount, currency_code, suppliers!inner(business_id)")
      .eq("suppliers.business_id", STATE.business.id),
    supabase
      .from("purchase_order_items")
      .select("quantity, unit_cost, purchase_orders!inner(business_id, status)")
      .eq("purchase_orders.business_id", STATE.business.id)
      .eq("purchase_orders.status", "received"),
  ]);

  const cashIn = (allPayments || []).reduce(
    (a, p) => a + Number(p.amount_base || 0),
    0,
  );
  const cashOutExpenses = (allExpenses || []).reduce(
    (a, e) => a + Number(e.amount_base || 0),
    0,
  );
  const cashOutSuppliers = (allSupplierPayments || []).reduce(
    (a, p) => a + Number(p.amount || 0),
    0,
  );
  const estimatedCash = cashIn - cashOutExpenses - cashOutSuppliers;

  const inventoryValue = STATE.products.reduce(
    (a, p) => a + stockFor(p.id) * Number(p.cost_price || 0),
    0,
  );
  const accountsReceivable = STATE.customers.reduce(
    (a, c) => a + Math.max(0, Number(c.balance || 0)),
    0,
  );

  const accountsPayableGross = (receivedPOItems || []).reduce(
    (a, it) => a + Number(it.quantity || 0) * Number(it.unit_cost || 0),
    0,
  );
  const accountsPayable = Math.max(0, accountsPayableGross - cashOutSuppliers);

  const totalAssets =
    Math.max(0, estimatedCash) + inventoryValue + accountsReceivable;
  const totalLiabilities = accountsPayable;
  const equity = totalAssets - totalLiabilities;

  window._bsData = {
    estimatedCash,
    inventoryValue,
    accountsReceivable,
    totalAssets,
    accountsPayable,
    totalLiabilities,
    equity,
  };

  body.innerHTML = `
    ${nonStatutoryNote()}
    <div class="card">
      <div class="card-title">Balance Sheet — as of ${escapeHtml(new Date().toISOString().slice(0, 10))}</div>
      <div style="margin-bottom:12px;"><button class="btn btn-outline btn-sm" id="bs-export">Export CSV</button></div>
      <table class="stmt-table">
        <tr><td colspan="2"><b>Assets</b></td></tr>
        <tr><td>Cash &amp; Mobile Money</td><td class="num">${fmtMoney(Math.max(0, estimatedCash))}</td></tr>
        <tr><td>Inventory on Hand <span class="text-muted">(at cost)</span></td><td class="num">${fmtMoney(inventoryValue)}</td></tr>
        <tr><td>Accounts Receivable <span class="text-muted">(customer credit balances)</span></td><td class="num">${fmtMoney(accountsReceivable)}</td></tr>
        <tr class="subtotal"><td><b>Total Assets</b></td><td class="num"><b>${fmtMoney(totalAssets)}</b></td></tr>
        <tr><td colspan="2" style="padding-top:14px;"><b>Liabilities</b></td></tr>
        <tr><td>Accounts Payable <span class="text-muted">(received stock not yet paid to suppliers)</span></td><td class="num">${fmtMoney(accountsPayable)}</td></tr>
        <tr class="subtotal"><td><b>Total Liabilities</b></td><td class="num"><b>${fmtMoney(totalLiabilities)}</b></td></tr>
        <tr class="total" style="margin-top:10px;"><td><b>Owner's Equity</b></td><td class="num"><b>${fmtMoney(equity)}</b></td></tr>
      </table>
    </div>`;

  $("bs-export")?.addEventListener("click", () => {
    downloadCsv(
      [
        ["Cash & Bank", Math.max(0, estimatedCash)],
        ["Inventory", inventoryValue],
        ["Accounts Receivable", accountsReceivable],
        ["Total Assets", totalAssets],
        ["Accounts Payable", accountsPayable],
        ["Total Liabilities", totalLiabilities],
        ["Owner's Equity", equity],
      ],
      ["Account", "Amount"],
      `balance-sheet-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  });
}

// =====================================================================
// CASH FLOW
// =====================================================================
async function renderCashFlowTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Cash Flow</div>
      ${periodPickerHtml("month", "cf")}
    </div>
    <div id="cf-output"></div>`;

  wirePeriodButtons("cf");
  await runCashFlow();
  $("cf-run").addEventListener("click", runCashFlow);
  $("cf-export").addEventListener("click", exportCf);

  async function runCashFlow() {
    const from = $("cf-from").value;
    const to = $("cf-to").value;
    const out = $("cf-output");
    out.innerHTML = `<div class="empty-state">Crunching numbers…</div>`;

    const [{ data: payments }, { data: expenses }, { data: supplierPayments }] =
      await Promise.all([
        supabase
          .from("payments")
          .select("amount_base, method, sales!inner(business_id)")
          .eq("sales.business_id", STATE.business.id)
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`),
        supabase
          .from("expenses")
          .select("amount_base, method:payment_method")
          .eq("business_id", STATE.business.id)
          .gte("expense_date", from)
          .lte("expense_date", to),
        supabase
          .from("supplier_payments")
          .select("amount, suppliers!inner(business_id)")
          .eq("suppliers.business_id", STATE.business.id)
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`),
      ]);

    const inByMethod = {};
    (payments || []).forEach((p) => {
      inByMethod[p.method] =
        (inByMethod[p.method] || 0) + Number(p.amount_base || 0);
    });
    const totalIn = Object.values(inByMethod).reduce((a, v) => a + v, 0);

    const outByMethod = {};
    (expenses || []).forEach((e) => {
      outByMethod[e.method] =
        (outByMethod[e.method] || 0) + Number(e.amount_base || 0);
    });
    const totalExpenseOut = Object.values(outByMethod).reduce(
      (a, v) => a + v,
      0,
    );
    const totalSupplierOut = (supplierPayments || []).reduce(
      (a, p) => a + Number(p.amount || 0),
      0,
    );
    const totalOut = totalExpenseOut + totalSupplierOut;
    const net = totalIn - totalOut;

    window._cfData = {
      inByMethod,
      totalIn,
      outByMethod,
      totalExpenseOut,
      totalSupplierOut,
      totalOut,
      net,
    };

    out.innerHTML = `
      ${nonStatutoryNote()}
      <div class="card">
        <div class="card-title">Cash Flow — ${escapeHtml(from)} to ${escapeHtml(to)}</div>
        <table class="stmt-table">
          <tr><td colspan="2"><b>Cash In (from sales payments)</b></td></tr>
          ${
            Object.entries(inByMethod)
              .map(
                ([m, amt]) =>
                  `<tr><td>${escapeHtml(m.replace("_", " "))}</td><td class="num">${fmtMoney(amt)}</td></tr>`,
              )
              .join("") ||
            '<tr><td class="text-muted">No payments in range</td><td></td></tr>'
          }
          <tr class="subtotal"><td><b>Total Cash In</b></td><td class="num"><b>${fmtMoney(totalIn)}</b></td></tr>
          <tr><td colspan="2" style="padding-top:14px;"><b>Cash Out</b></td></tr>
          ${Object.entries(outByMethod)
            .map(
              ([m, amt]) =>
                `<tr><td>Expenses — ${escapeHtml(m.replace("_", " "))}</td><td class="num">(${fmtMoney(amt)})</td></tr>`,
            )
            .join("")}
          <tr><td>Supplier Payments</td><td class="num">(${fmtMoney(totalSupplierOut)})</td></tr>
          <tr class="subtotal"><td><b>Total Cash Out</b></td><td class="num"><b>(${fmtMoney(totalOut)})</b></td></tr>
          <tr class="total"><td><b>Net Cash Flow</b></td><td class="num"><b>${fmtMoney(net)}</b></td></tr>
        </table>
      </div>`;
  }

  function exportCf() {
    const d = window._cfData || {};
    const rows = [];
    Object.entries(d.inByMethod || {}).forEach(([m, amt]) =>
      rows.push([`Cash In — ${m}`, amt, ""]),
    );
    rows.push(["Total Cash In", d.totalIn, ""]);
    Object.entries(d.outByMethod || {}).forEach(([m, amt]) =>
      rows.push([`Expense — ${m}`, "", amt]),
    );
    rows.push(["Supplier Payments", "", d.totalSupplierOut]);
    rows.push(["Total Cash Out", "", d.totalOut]);
    rows.push(["Net Cash Flow", d.net, ""]);
    downloadCsv(
      rows,
      ["Description", "Inflow", "Outflow"],
      `cashflow-${$("cf-from").value}-to-${$("cf-to").value}.csv`,
    );
  }
}
