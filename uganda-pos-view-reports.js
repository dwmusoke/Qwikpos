// =====================================================================
// QWICKPOS — REPORTS VIEW
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

export async function renderReports(root) {
  const range = defaultRange();
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Reports</h2><p class="sub">Sales, VAT and inventory insights</p></div>
    </div>
    <div class="card">
      <div class="field-row" style="align-items:end;">
        <div class="field"><label>From</label><input type="date" id="rep-from" value="${range.from}" /></div>
        <div class="field"><label>To</label><input type="date" id="rep-to" value="${range.to}" /></div>
      </div>
      <div class="flex gap">
        <button class="btn btn-primary" id="run-report-btn">Run Report</button>
        <button class="btn btn-outline" id="export-sales-btn">Export CSV</button>
      </div>
    </div>
    <div id="report-output"></div>
  `;

  let lastSales = [];

  $("run-report-btn").addEventListener("click", () => runReport());
  $("export-sales-btn").addEventListener("click", () => exportReport());
  await runReport();

  async function runReport() {
    const from = $("rep-from").value;
    const to = $("rep-to").value;
    const output = $("report-output");
    output.innerHTML = `<div class="empty-state">Crunching numbers…</div>`;

    const { data: sales } = await supabase
      .from("sales")
      .select(
        "*, sale_items(*), payments(*), cashier:app_users!cashier_id(full_name)",
      )
      .eq("business_id", STATE.business.id)
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false });

    // Quotations aren't real sales (unpaid, no stock/EFRIS impact) — keep them out of every report figure.
    lastSales = (sales || []).filter(
      (s) => s.status !== "voided" && s.sale_type !== "quotation",
    );

    // vat_total / discount_total are stored per-sale in that sale's own currency —
    // multiply each by its own exchange_rate before summing across mixed-currency sales.
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

    output.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="label">Total Sales</div><div class="value">${fmtMoney(totalSales)}</div><div class="delta">${lastSales.length} transactions</div></div>
        <div class="kpi-card"><div class="label">VAT Collected</div><div class="value">${fmtMoney(totalVat)}</div></div>
        <div class="kpi-card"><div class="label">Total Discounts Given</div><div class="value">${fmtMoney(totalDiscount)}</div></div>
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
            <div class="summary-row"><span>${escapeHtml(name)} <span class="text-muted">(${d.qty})</span></span><span>${fmtMoney(d.revenue)}</span></div>
          `,
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
            <div class="summary-row"><span style="text-transform:capitalize;">${escapeHtml(m.replace("_", " "))}</span><span>${fmtMoney(amt)}</span></div>
          `,
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
        <div class="table-wrap">
          <table>
            <thead><tr><th>Rank</th><th>Cashier</th><th>Transactions</th><th>Items Sold</th><th>Total Sales</th><th>Avg. Sale</th></tr></thead>
            <tbody>
              ${cashierRanking
                .map(
                  (c, i) => `
                <tr>
                  <td>${medal[i] || `#${i + 1}`}</td>
                  <td><b>${escapeHtml(c.name)}</b></td>
                  <td>${c.txns}</td>
                  <td>${c.items}</td>
                  <td>${fmtMoney(c.revenue)}</td>
                  <td>${fmtMoney(c.txns ? c.revenue / c.txns : 0)}</td>
                </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>`
            : '<div class="empty-state">No sales in this range.</div>'
        }
      </div>

      <div class="card">
        <div class="card-title">Transactions (${lastSales.length})</div>
        <div class="table-wrap" style="max-height:360px; overflow-y:auto;">
          <table>
            <thead><tr><th>Invoice</th><th>Date</th><th>Currency</th><th>VAT</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              ${lastSales
                .map(
                  (s) => `
                <tr><td>${escapeHtml(s.sale_number)}</td><td>${fmtDate(s.created_at)}</td><td>${escapeHtml(s.currency_code)}</td>
                <td>${fmtMoney(Number(s.vat_total) * Number(s.exchange_rate || 1))}</td><td>${fmtMoney(s.grand_total_base)}</td>
                <td><span class="badge ${s.payment_status === "paid" ? "badge-green" : "badge-yellow"}">${escapeHtml(s.payment_status)}</span></td></tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function exportReport() {
    if (!lastSales.length) {
      $("run-report-btn").click();
      return;
    }
    const header = [
      "Invoice",
      "Date",
      "Currency",
      "Subtotal",
      "Discount",
      "VAT",
      "Total (base)",
      "Status",
    ];
    const rows = lastSales.map((s) => [
      s.sale_number,
      s.created_at,
      s.currency_code,
      s.subtotal,
      s.discount_total,
      s.vat_total,
      s.grand_total_base,
      s.payment_status,
    ]);
    const csv = [header, ...rows]
      .map((r) =>
        r.map((v) => `"${sanitizeCsvValue(v).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-report-${$("rep-from").value}-to-${$("rep-to").value}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
