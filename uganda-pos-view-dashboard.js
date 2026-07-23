// =====================================================================
// QWICKPOS — DASHBOARD VIEW
// =====================================================================
import {
  supabase,
  STATE,
  $,
  fmtMoney,
  fmtDate,
  lowStockProducts,
  escapeHtml,
} from "./uganda-pos-core.js";

export async function renderDashboard(root) {
  root.innerHTML = `<div class="empty-state">Loading dashboard…</div>`;

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const [
    { data: sales },
    { data: efrisRows },
    { data: customers },
    { data: branchSales },
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("*, sale_items(*)")
      .eq("business_id", STATE.business.id)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("efris_invoices")
      .select("status")
      .eq("business_id", STATE.business.id),
    supabase
      .from("customers")
      .select("balance")
      .eq("business_id", STATE.business.id),
    STATE.branches.length > 1
      ? supabase
          .from("sales")
          .select(
            "branch_id, grand_total_base, vat_total, exchange_rate, status, sale_type, created_at, payment_status",
          )
          .eq("business_id", STATE.business.id)
          .gte(
            "created_at",
            new Date(new Date().getFullYear(), 0, 1).toISOString(),
          )
      : { data: [] },
  ]);

  const allSales = (sales || []).filter(
    (s) => s.status !== "voided" && s.sale_type !== "quotation",
  );
  const todayStr = new Date().toDateString();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const todaySales = allSales.filter(
    (s) => new Date(s.created_at).toDateString() === todayStr,
  );
  const monthSales = allSales.filter(
    (s) => new Date(s.created_at) >= monthStart,
  );
  const yearSales = allSales.filter((s) => new Date(s.created_at) >= yearStart);

  const sum = (arr, field) =>
    arr.reduce((a, s) => a + Number(s[field] || 0), 0);
  const sumConverted = (arr, field) =>
    arr.reduce(
      (a, s) => a + Number(s[field] || 0) * Number(s.exchange_rate || 1),
      0,
    );
  const todayTotal = sum(todaySales, "grand_total_base");
  const monthTotal = sum(monthSales, "grand_total_base");
  const yearTotal = sum(yearSales, "grand_total_base");
  const monthVat = sumConverted(monthSales, "vat_total");
  const yearVat = sumConverted(yearSales, "vat_total");

  const lowStock = lowStockProducts();
  const inventoryValue = STATE.products.reduce(
    (a, p) => a + Number(p.cost_price || 0) * (STATE.stockByProduct[p.id] || 0),
    0,
  );
  const outstandingBalance = (customers || []).reduce(
    (a, c) => a + Number(c.balance || 0),
    0,
  );

  const productTally = {};
  allSales.forEach((s) =>
    (s.sale_items || []).forEach((it) => {
      productTally[it.product_name] =
        (productTally[it.product_name] || 0) + Number(it.quantity);
    }),
  );
  const topProducts = Object.entries(productTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const efrisCounts = {
    pending: 0,
    queued: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
  };
  (efrisRows || []).forEach((r) => {
    efrisCounts[r.status] = (efrisCounts[r.status] || 0) + 1;
  });

  const recent = allSales.slice(0, 8);

  // Branch comparison (only if multi-branch)
  let branchComparison = "";
  if (STATE.branches.length > 1 && branchSales?.length) {
    const branchSalesFiltered = branchSales.filter(
      (s) => s.status !== "voided" && s.sale_type !== "quotation",
    );
    const branchMap = {};
    (STATE.branches || []).forEach((b) => {
      branchMap[b.id] = {
        name: b.name,
        total: 0,
        vat: 0,
        count: 0,
        paid: 0,
        credit: 0,
      };
    });
    branchSalesFiltered.forEach((s) => {
      const bm = branchMap[s.branch_id];
      if (!bm) return;
      bm.total += Number(s.grand_total_base || 0);
      bm.vat += Number(s.vat_total || 0) * Number(s.exchange_rate || 1);
      bm.count += 1;
      if (s.payment_status === "paid") bm.paid += 1;
      else if (s.payment_status === "credit") bm.credit += 1;
    });
    const rows = Object.values(branchMap).sort((a, b) => b.total - a.total);
    branchComparison = `
      <div class="card">
        <div class="card-title">Store/Branch Comparison (YTD)</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Branch</th><th>Sales</th><th>Transactions</th><th>VAT</th><th>Paid</th><th>Credit</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr>
                <td><b>${escapeHtml(r.name)}</b></td>
                <td>${fmtMoney(r.total)}</td>
                <td>${r.count}</td>
                <td>${fmtMoney(r.vat)}</td>
                <td><span class="badge badge-green">${r.paid}</span></td>
                <td><span class="badge badge-yellow">${r.credit}</span></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table></div>
      </div>`;
  }

  root.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="label">Today's Sales</div><div class="value">${fmtMoney(todayTotal)}</div><div class="delta up">${todaySales.length} transactions</div></div>
      <div class="kpi-card"><div class="label">This Month</div><div class="value">${fmtMoney(monthTotal)}</div><div class="delta up">${monthSales.length} transactions</div></div>
      <div class="kpi-card"><div class="label">This Year</div><div class="value">${fmtMoney(yearTotal)}</div><div class="delta up">${yearSales.length} transactions</div></div>
      <div class="kpi-card"><div class="label">VAT Collected (Month)</div><div class="value">${fmtMoney(monthVat)}</div><div class="delta">Standard rate 18%</div></div>
      <div class="kpi-card"><div class="label">Inventory Value</div><div class="value">${fmtMoney(inventoryValue)}</div><div class="delta">${STATE.products.length} SKUs</div></div>
      <div class="kpi-card"><div class="label">Low Stock Alerts</div><div class="value" style="color:${lowStock.length ? "var(--danger)" : "inherit"}">${lowStock.length}</div><div class="delta">at/below reorder level</div></div>
      <div class="kpi-card"><div class="label">Outstanding Balances</div><div class="value">${fmtMoney(outstandingBalance)}</div><div class="delta">across all customers</div></div>
      <div class="kpi-card"><div class="label">YTD VAT Collected</div><div class="value">${fmtMoney(yearVat)}</div><div class="delta">Jan — ${new Date().toLocaleString("default", { month: "short" })}</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Recent Transactions</div>
        ${
          recent.length
            ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Invoice</th><th>Time</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            ${recent
              .map(
                (s) => `
              <tr>
                <td>${escapeHtml(s.sale_number)}</td>
                <td>${fmtDate(s.created_at)}</td>
                <td>${fmtMoney(s.grand_total_base)}</td>
                <td><span class="badge ${s.payment_status === "paid" ? "badge-green" : s.payment_status === "credit" ? "badge-yellow" : "badge-gray"}">${s.payment_status}</span></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table></div>`
            : `<div class="empty-state">No sales yet — head to <b>Sell (POS)</b> to record your first one.</div>`
        }
      </div>

      <div class="card">
        <div class="card-title">Top Selling Products (90d)</div>
        ${
          topProducts.length
            ? topProducts
                .map(
                  ([name, qty]) => `
          <div class="summary-row"><span>${escapeHtml(name)}</span><span><b>${qty}</b> sold</span></div>
        `,
                )
                .join("")
            : `<div class="empty-state">No sales data yet.</div>`
        }

        <div class="card-title" style="margin-top:18px;">EFRIS Invoice Status</div>
        <div class="flex gap" style="flex-wrap:wrap;">
          <span class="badge badge-gray">Pending ${efrisCounts.pending}</span>
          <span class="badge badge-blue">Queued ${efrisCounts.queued}</span>
          <span class="badge badge-green">Accepted ${efrisCounts.accepted}</span>
          <span class="badge badge-red">Rejected ${efrisCounts.rejected}</span>
          <span class="badge badge-red">Failed ${efrisCounts.failed}</span>
        </div>
      </div>
    </div>

    ${branchComparison}

    ${
      lowStock.length
        ? `
    <div class="card">
      <div class="card-title">⚠️ Low Stock Alerts</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>In Stock</th><th>Reorder Level</th></tr></thead>
        <tbody>
          ${lowStock
            .slice(0, 10)
            .map(
              (p) => `
            <tr><td>${escapeHtml(p.name)}</td><td style="color:var(--danger); font-weight:700;">${STATE.stockByProduct[p.id] || 0}</td><td>${p.reorder_level}</td></tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>`
        : ""
    }
  `;
}
