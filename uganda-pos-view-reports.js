// =====================================================================
// QWICKPOS — REPORTS VIEW (Sales, Purchases, Tax, Expenses)
// =====================================================================
import {
  supabase,
  STATE,
  $,
  escapeHtml,
  fmtMoney,
  fmtDate,
  sanitizeCsvValue,
} from "./uganda-pos-core.js";

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function rangeFormHtml(id, range) {
  return `
    <div class="field-row" style="align-items:end;">
      <div class="field"><label>From</label><input type="date" id="${id}-from" value="${range.from}" /></div>
      <div class="field"><label>To</label><input type="date" id="${id}-to" value="${range.to}" /></div>
      <button class="btn btn-primary" id="${id}-run">Run Report</button>
      <button class="btn btn-outline" id="${id}-export">Export CSV</button>
    </div>`;
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

export async function renderReports(root) {
  const range = defaultRange();
  let activeTab = "sales";

  root.innerHTML = `
    <div class="view-header">
      <div><h2>Reports</h2><p class="sub">Sales, purchases, tax and expense insights</p></div>
    </div>
    <div class="notif-filters" id="report-tabs">
      <button class="chip active" data-tab="sales">Sales Analysis</button>
      <button class="chip" data-tab="purchases">Purchase Analysis</button>
      <button class="chip" data-tab="tax">Tax (VAT) Report</button>
      <button class="chip" data-tab="expenses">Expense Report</button>
    </div>
    <div id="report-content"></div>
  `;

  root.querySelectorAll("#report-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root
        .querySelectorAll("#report-tabs .chip")
        .forEach((c) => c.classList.toggle("active", c === btn));
      renderTab();
    });
  });

  await renderTab();

  async function renderTab() {
    const content = $("report-content");
    const r = defaultRange();
    if (activeTab === "sales") await renderSalesTab(content, r);
    else if (activeTab === "purchases") await renderPurchasesTab(content, r);
    else if (activeTab === "tax") await renderTaxTab(content, r);
    else if (activeTab === "expenses") await renderExpensesTab(content, r);
  }
}

// ── SALES ANALYSIS ───────────────────────────────────────────────────
async function renderSalesTab(output, range) {
  output.innerHTML = `
    <div class="card">${rangeFormHtml("sales", range)}</div>
    <div id="sales-output"><div class="empty-state">Crunching numbers…</div></div>`;

  let lastSales = [];

  $("sales-run").addEventListener("click", () => load());
  $("sales-export").addEventListener("click", () => {
    if (!lastSales.length) {
      load().then(exportSales);
      return;
    }
    exportSales();
  });
  await load();

  async function load() {
    const from = $("sales-from").value;
    const to = $("sales-to").value;
    const out = $("sales-output");
    out.innerHTML = `<div class="empty-state">Crunching numbers…</div>`;

    const { data: sales } = await supabase
      .from("sales")
      .select(
        "*, sale_items(*), payments(*), cashier:app_users!cashier_id(full_name)",
      )
      .eq("business_id", STATE.business.id)
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false });

    lastSales = (sales || []).filter(
      (s) => s.status !== "voided" && s.sale_type !== "quotation",
    );

    const totalSales = lastSales.reduce(
      (a, s) => a + Number(s.grand_total_base),
      0,
    );
    const totalVat = lastSales.reduce(
      (a, s) => a + Number(s.vat_total || 0) * Number(s.exchange_rate || 1),
      0,
    );
    const totalDiscount = lastSales.reduce(
      (a, s) =>
        a + Number(s.discount_total || 0) * Number(s.exchange_rate || 1),
      0,
    );

    const paymentTotals = {};
    lastSales.forEach((s) =>
      (s.payments || []).forEach((p) => {
        paymentTotals[p.method] =
          (paymentTotals[p.method] || 0) + Number(p.amount_base || 0);
      }),
    );

    const productTally = {};
    lastSales.forEach((s) =>
      (s.sale_items || []).forEach((it) => {
        if (!productTally[it.product_name])
          productTally[it.product_name] = { qty: 0, revenue: 0 };
        productTally[it.product_name].qty += Number(it.quantity);
        productTally[it.product_name].revenue +=
          Number(it.line_total) * Number(s.exchange_rate || 1);
      }),
    );
    const topProducts = Object.entries(productTally)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 8);

    const cashierTally = {};
    lastSales.forEach((s) => {
      const key = s.cashier_id || "unknown";
      if (!cashierTally[key])
        cashierTally[key] = {
          name: s.cashier?.full_name || "Unknown",
          txns: 0,
          revenue: 0,
          items: 0,
        };
      cashierTally[key].txns += 1;
      cashierTally[key].revenue += Number(s.grand_total_base || 0);
      cashierTally[key].items += (s.sale_items || []).reduce(
        (a, it) => a + Number(it.quantity || 0),
        0,
      );
    });
    const cashierRanking = Object.values(cashierTally).sort(
      (a, b) => b.revenue - a.revenue,
    );
    const medal = ["🥇", "🥈", "🥉"];

    out.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="label">Total Sales</div><div class="value">${fmtMoney(totalSales)}</div><div class="delta">${lastSales.length} transactions</div></div>
        <div class="kpi-card"><div class="label">VAT Collected</div><div class="value">${fmtMoney(totalVat)}</div></div>
        <div class="kpi-card"><div class="label">Discounts Given</div><div class="value">${fmtMoney(totalDiscount)}</div></div>
        <div class="kpi-card"><div class="label">Avg. Sale Value</div><div class="value">${fmtMoney(lastSales.length ? totalSales / lastSales.length : 0)}</div></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Top Products by Revenue</div>
          ${
            topProducts.length
              ? topProducts
                  .map(
                    ([name, d]) => `
            <div class="summary-row"><span>${escapeHtml(name)} <span class="text-muted">(${d.qty})</span></span><span>${fmtMoney(d.revenue)}</span></div>`,
                  )
                  .join("")
              : '<div class="empty-state">No sales in this range.</div>'
          }
        </div>
        <div class="card">
          <div class="card-title">Payments by Method</div>
          ${
            Object.entries(paymentTotals).length
              ? Object.entries(paymentTotals)
                  .map(
                    ([m, amt]) => `
              <div class="summary-row"><span style="text-transform:capitalize;">${escapeHtml(m.replace("_", " "))}</span><span>${fmtMoney(amt)}</span></div>`,
                  )
                  .join("")
              : '<div class="empty-state">No payments in this range.</div>'
          }
        </div>
      </div>
      <div class="card">
        <div class="card-title">Cashier Performance</div>
        ${
          cashierRanking.length
            ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Rank</th><th>Cashier</th><th>Transactions</th><th>Items Sold</th><th>Total Sales</th><th>Avg. Sale</th></tr></thead>
          <tbody>
            ${cashierRanking
              .map(
                (c, i) => `
              <tr><td>${medal[i] || `#${i + 1}`}</td><td><b>${escapeHtml(c.name)}</b></td><td>${c.txns}</td><td>${c.items}</td><td>${fmtMoney(c.revenue)}</td><td>${fmtMoney(c.txns ? c.revenue / c.txns : 0)}</td></tr>`,
              )
              .join("")}
          </tbody></table></div>`
            : '<div class="empty-state">No sales in this range.</div>'
        }
      </div>
      <div class="card">
        <div class="card-title">Transactions (${lastSales.length})</div>
        <div class="table-wrap" style="max-height:360px; overflow-y:auto;"><table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Currency</th><th>VAT</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            ${lastSales
              .map(
                (s) => `
              <tr><td>${escapeHtml(s.sale_number)}</td><td>${fmtDate(s.created_at)}</td><td>${escapeHtml(s.currency_code)}</td>
              <td>${fmtMoney(Number(s.vat_total) * Number(s.exchange_rate || 1))}</td><td>${fmtMoney(s.grand_total_base)}</td>
              <td><span class="badge ${s.payment_status === "paid" ? "badge-green" : "badge-yellow"}">${escapeHtml(s.payment_status)}</span></td></tr>`,
              )
              .join("")}
          </tbody></table></div>
      </div>`;
  }

  function exportSales() {
    downloadCsv(
      lastSales.map((s) => [
        s.sale_number,
        s.created_at,
        s.currency_code,
        s.subtotal,
        s.discount_total,
        s.vat_total,
        s.grand_total_base,
        s.payment_status,
      ]),
      [
        "Invoice",
        "Date",
        "Currency",
        "Subtotal",
        "Discount",
        "VAT",
        "Total (base)",
        "Status",
      ],
      `sales-report-${$("sales-from").value}-to-${$("sales-to").value}.csv`,
    );
  }
}

// ── PURCHASE ANALYSIS ────────────────────────────────────────────────
async function renderPurchasesTab(output, range) {
  output.innerHTML = `
    <div class="card">${rangeFormHtml("purchases", range)}</div>
    <div id="purchases-output"><div class="empty-state">Loading…</div></div>`;

  let lastPOs = [];

  $("purchases-run").addEventListener("click", () => load());
  $("purchases-export").addEventListener("click", () => {
    if (!lastPOs.length) {
      load().then(exportPurchases);
      return;
    }
    exportPurchases();
  });
  await load();

  async function load() {
    const from = $("purchases-from").value;
    const to = $("purchases-to").value;
    const out = $("purchases-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    const { data: poItems } = await supabase
      .from("purchase_order_items")
      .select(
        "*, purchase_order:purchase_orders!po_id(*, supplier:suppliers(name))",
      )
      .eq("purchase_orders.business_id", STATE.business.id)
      .gte("purchase_orders.created_at", `${from}T00:00:00`)
      .lte("purchase_orders.created_at", `${to}T23:59:59`);

    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("business_id", STATE.business.id);

    // Build PO list from items
    const poMap = {};
    (poItems || []).forEach((item) => {
      const po = item.purchase_order;
      if (!po) return;
      if (!poMap[po.id])
        poMap[po.id] = { ...po, items: [], totalCost: 0, totalQty: 0 };
      poMap[po.id].items.push(item);
      poMap[po.id].totalCost +=
        Number(item.quantity || 0) * Number(item.unit_cost || 0);
      poMap[po.id].totalQty += Number(item.quantity || 0);
    });
    lastPOs = Object.values(poMap).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    const totalPurchases = lastPOs.reduce((a, po) => a + po.totalCost, 0);
    const totalItems = lastPOs.reduce((a, po) => a + po.totalQty, 0);
    const receivedPOs = lastPOs.filter((po) => po.status === "received");
    const pendingPOs = lastPOs.filter(
      (po) => po.status === "pending" || po.status === "ordered",
    );

    const supplierTally = {};
    lastPOs.forEach((po) => {
      const sName = po.supplier?.name || "Unknown";
      if (!supplierTally[sName])
        supplierTally[sName] = { name: sName, orders: 0, total: 0 };
      supplierTally[sName].orders += 1;
      supplierTally[sName].total += po.totalCost;
    });
    const supplierRanking = Object.values(supplierTally).sort(
      (a, b) => b.total - a.total,
    );

    out.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="label">Total Purchases</div><div class="value">${fmtMoney(totalPurchases)}</div><div class="delta">${lastPOs.length} purchase orders</div></div>
        <div class="kpi-card"><div class="label">Items Ordered</div><div class="value">${totalItems.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="label">Received</div><div class="value">${receivedPOs.length}</div><div class="delta badge badge-green">completed</div></div>
        <div class="kpi-card"><div class="label">Pending</div><div class="value">${pendingPOs.length}</div><div class="delta badge badge-yellow">awaiting delivery</div></div>
      </div>
      <div class="card">
        <div class="card-title">Purchases by Supplier</div>
        ${
          supplierRanking.length
            ? supplierRanking
                .map(
                  (s) => `
          <div class="summary-row"><span>${escapeHtml(s.name)} <span class="text-muted">(${s.orders} orders)</span></span><span>${fmtMoney(s.total)}</span></div>`,
                )
                .join("")
            : '<div class="empty-state">No purchase orders in this range.</div>'
        }
      </div>
      <div class="card">
        <div class="card-title">Purchase Orders (${lastPOs.length})</div>
        <div class="table-wrap" style="max-height:360px; overflow-y:auto;"><table>
          <thead><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Items</th><th>Total Cost</th><th>Status</th></tr></thead>
          <tbody>
            ${lastPOs
              .map(
                (po) => `
              <tr>
                <td>${escapeHtml(po.po_number || "—")}</td>
                <td>${fmtDate(po.created_at)}</td>
                <td>${escapeHtml(po.supplier?.name || "—")}</td>
                <td>${po.totalQty}</td>
                <td>${fmtMoney(po.totalCost)}</td>
                <td><span class="badge ${po.status === "received" ? "badge-green" : po.status === "cancelled" ? "badge-red" : "badge-yellow"}">${escapeHtml(po.status)}</span></td>
              </tr>`,
              )
              .join("")}
          </tbody></table></div>
      </div>`;
  }

  function exportPurchases() {
    downloadCsv(
      lastPOs.map((po) => [
        po.po_number,
        po.created_at,
        po.supplier?.name || "",
        po.totalQty,
        po.totalCost,
        po.status,
      ]),
      ["PO #", "Date", "Supplier", "Items", "Total Cost", "Status"],
      `purchase-report-${$("purchases-from").value}-to-${$("purchases-to").value}.csv`,
    );
  }
}

// ── TAX (VAT) REPORT ─────────────────────────────────────────────────
async function renderTaxTab(output, range) {
  output.innerHTML = `
    <div class="card">${rangeFormHtml("tax", range)}</div>
    <div id="tax-output"><div class="empty-state">Loading…</div></div>`;

  $("tax-run").addEventListener("click", () => load());
  $("tax-export").addEventListener("click", () => {
    load().then(() => {
      const rows = window._taxExportRows || [];
      downloadCsv(
        rows,
        ["Category", "Net Amount", "VAT Amount", "Gross Amount"],
        `tax-report-${$("tax-from").value}-to-${$("tax-to").value}.csv`,
      );
    });
  });
  await load();

  async function load() {
    const from = $("tax-from").value;
    const to = $("tax-to").value;
    const out = $("tax-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    const [{ data: sales }, { data: expenses }] = await Promise.all([
      supabase
        .from("sales")
        .select("*, sale_items(*)")
        .eq("business_id", STATE.business.id)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      supabase
        .from("expenses")
        .select("amount, currency, exchange_rate, category")
        .eq("business_id", STATE.business.id)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
    ]);

    const validSales = (sales || []).filter(
      (s) => s.status !== "voided" && s.sale_type !== "quotation",
    );

    // Group by tax category
    const taxGroups = {};
    validSales.forEach((s) =>
      (s.sale_items || []).forEach((it) => {
        const code = it.tax_category_code || "STD";
        if (!taxGroups[code]) taxGroups[code] = { net: 0, vat: 0, gross: 0 };
        const rate =
          STATE.taxCategories.find((t) => t.code === code)?.rate || 0;
        const lineGross =
          Number(it.line_total || 0) * Number(s.exchange_rate || 1);
        const lineVat = rate > 0 ? (lineGross * rate) / (100 + rate) : 0;
        taxGroups[code].gross += lineGross;
        taxGroups[code].vat += lineVat;
        taxGroups[code].net += lineGross - lineVat;
      }),
    );

    const totalVatSales = Object.values(taxGroups).reduce(
      (a, g) => a + g.vat,
      0,
    );
    const totalNetSales = Object.values(taxGroups).reduce(
      (a, g) => a + g.net,
      0,
    );
    const totalGrossSales = Object.values(taxGroups).reduce(
      (a, g) => a + g.gross,
      0,
    );

    // Input VAT from expenses (if applicable — expenses with VAT)
    const totalExpenses = (expenses || []).reduce(
      (a, e) => a + Number(e.amount || 0) * Number(e.exchange_rate || 1),
      0,
    );

    const exportRows = Object.entries(taxGroups).map(([code, g]) => [
      code,
      g.net.toFixed(2),
      g.vat.toFixed(2),
      g.gross.toFixed(2),
    ]);
    window._taxExportRows = exportRows;

    out.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="label">Output VAT (Sales)</div><div class="value">${fmtMoney(totalVatSales)}</div><div class="delta">collected from customers</div></div>
        <div class="kpi-card"><div class="label">Net Sales (excl. VAT)</div><div class="value">${fmtMoney(totalNetSales)}</div></div>
        <div class="kpi-card"><div class="label">Gross Sales (incl. VAT)</div><div class="value">${fmtMoney(totalGrossSales)}</div></div>
        <div class="kpi-card"><div class="label">Total Expenses</div><div class="value">${fmtMoney(totalExpenses)}</div><div class="delta">input side</div></div>
      </div>
      <div class="card">
        <div class="card-title">VAT by Tax Category</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Category</th><th>Rate</th><th>Net Amount</th><th>VAT Amount</th><th>Gross Amount</th></tr></thead>
          <tbody>
            ${Object.entries(taxGroups)
              .map(([code, g]) => {
                const rate =
                  STATE.taxCategories.find((t) => t.code === code)?.rate || 0;
                return `<tr>
                <td><b>${escapeHtml(code)}</b></td>
                <td>${rate}%</td>
                <td>${fmtMoney(g.net)}</td>
                <td>${fmtMoney(g.vat)}</td>
                <td>${fmtMoney(g.gross)}</td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-title">Summary</div>
        <div class="summary-row"><span>Total Output VAT (collected)</span><span><b>${fmtMoney(totalVatSales)}</b></span></div>
        <div class="summary-row"><span>Total Expenses (input side)</span><span>${fmtMoney(totalExpenses)}</span></div>
        <div class="summary-row" style="font-weight:700; border-top: 2px solid var(--border); padding-top:12px; margin-top:8px;">
          <span>Net VAT Position</span><span>${fmtMoney(totalVatSales)}</span></div>
        <p class="help-text" style="margin-top:12px;">⚠️ This is an estimate. Consult your tax advisor for the official URA VAT return. Input VAT on business expenses should be claimed separately.</p>
      </div>`;
  }
}

// ── EXPENSE REPORT ──────────────────────────────────────────────────
async function renderExpensesTab(output, range) {
  output.innerHTML = `
    <div class="card">${rangeFormHtml("expenses", range)}</div>
    <div id="expenses-output"><div class="empty-state">Loading…</div></div>`;

  let lastExpenses = [];

  $("expenses-run").addEventListener("click", () => load());
  $("expenses-export").addEventListener("click", () => {
    if (!lastExpenses.length) {
      load().then(exportExpenses);
      return;
    }
    exportExpenses();
  });
  await load();

  async function load() {
    const from = $("expenses-from").value;
    const to = $("expenses-to").value;
    const out = $("expenses-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    const { data: expenses } = await supabase
      .from("expenses")
      .select("*")
      .eq("business_id", STATE.business.id)
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false });

    lastExpenses = expenses || [];
    const totalExpenses = lastExpenses.reduce(
      (a, e) => a + Number(e.amount || 0) * Number(e.exchange_rate || 1),
      0,
    );

    const categoryTotals = {};
    lastExpenses.forEach((e) => {
      const cat = e.category || "Other";
      categoryTotals[cat] =
        (categoryTotals[cat] || 0) +
        Number(e.amount || 0) * Number(e.exchange_rate || 1);
    });
    const catRanking = Object.entries(categoryTotals).sort(
      (a, b) => b[1] - a[1],
    );
    const topCat = catRanking[0];

    const methodTotals = {};
    lastExpenses.forEach((e) => {
      const m = e.payment_method || "cash";
      methodTotals[m] =
        (methodTotals[m] || 0) +
        Number(e.amount || 0) * Number(e.exchange_rate || 1);
    });

    out.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="label">Total Expenses</div><div class="value">${fmtMoney(totalExpenses)}</div><div class="delta">${lastExpenses.length} entries</div></div>
        <div class="kpi-card"><div class="label">Avg. Expense</div><div class="value">${fmtMoney(lastExpenses.length ? totalExpenses / lastExpenses.length : 0)}</div></div>
        <div class="kpi-card"><div class="label">Top Category</div><div class="value">${topCat ? fmtMoney(topCat[1]) : "—"}</div><div class="delta">${topCat ? topCat[0] : "—"}</div></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Expenses by Category</div>
          ${
            catRanking.length
              ? catRanking
                  .map(
                    ([cat, amt]) => `
            <div class="summary-row"><span>${escapeHtml(cat)}</span><span>${fmtMoney(amt)} <span class="text-muted">(${((amt / totalExpenses) * 100).toFixed(1)}%)</span></span></div>`,
                  )
                  .join("")
              : '<div class="empty-state">No expenses in this range.</div>'
          }
        </div>
        <div class="card">
          <div class="card-title">Expenses by Payment Method</div>
          ${
            Object.entries(methodTotals).length
              ? Object.entries(methodTotals)
                  .map(
                    ([m, amt]) => `
              <div class="summary-row"><span style="text-transform:capitalize;">${escapeHtml(m)}</span><span>${fmtMoney(amt)}</span></div>`,
                  )
                  .join("")
              : '<div class="empty-state">No expenses in this range.</div>'
          }
        </div>
      </div>
      <div class="card">
        <div class="card-title">Expense Details (${lastExpenses.length})</div>
        <div class="table-wrap" style="max-height:360px; overflow-y:auto;"><table>
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Amount</th></tr></thead>
          <tbody>
            ${lastExpenses
              .map(
                (e) => `
              <tr>
                <td>${fmtDate(e.created_at)}</td>
                <td><span class="badge badge-gray">${escapeHtml(e.category || "—")}</span></td>
                <td>${escapeHtml(e.description || "—")}</td>
                <td style="text-transform:capitalize;">${escapeHtml(e.payment_method || "cash")}</td>
                <td>${fmtMoney(Number(e.amount || 0) * Number(e.exchange_rate || 1))}</td>
              </tr>`,
              )
              .join("")}
          </tbody></table></div>
      </div>`;
  }

  function exportExpenses() {
    downloadCsv(
      lastExpenses.map((e) => [
        e.created_at,
        e.category,
        e.description,
        e.payment_method,
        e.amount,
        e.currency,
      ]),
      ["Date", "Category", "Description", "Method", "Amount", "Currency"],
      `expense-report-${$("expenses-from").value}-to-${$("expenses-to").value}.csv`,
    );
  }
}
