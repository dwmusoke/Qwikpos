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

  // Yesterday trend
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterday);
  yesterdayEnd.setHours(23, 59, 59, 999);
  const yesterdaySales = allSales.filter(
    (s) =>
      new Date(s.created_at) >= yesterday &&
      new Date(s.created_at) <= yesterdayEnd,
  );
  const yesterdayTotal = sum(yesterdaySales, "grand_total_base");
  const todayTrend =
    yesterdayTotal > 0
      ? (((todayTotal - yesterdayTotal) / yesterdayTotal) * 100).toFixed(1)
      : null;

  // 7-day daily sales
  const dailySales7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d);
    dEnd.setHours(23, 59, 59, 999);
    const dayTotal = allSales
      .filter(
        (s) => new Date(s.created_at) >= d && new Date(s.created_at) <= dEnd,
      )
      .reduce((a, s) => a + Number(s.grand_total_base || 0), 0);
    dailySales7.push({
      label: d.toLocaleDateString("en", { weekday: "short" }),
      value: dayTotal,
    });
  }

  // Payment status counts (for donut)
  const paidCount = allSales.filter((s) => s.payment_status === "paid").length;
  const creditCount = allSales.filter((s) => s.payment_status === "credit").length;
  const otherCount = allSales.length - paidCount - creditCount;

  // --- SVG Line Chart ---
  const chartW = 320;
  const chartH = 90;
  const padX = 32;
  const padY = 14;
  const maxVal = Math.max(...dailySales7.map((d) => d.value), 1);
  const points = dailySales7.map((d, i) => {
    const x = padX + (i / (dailySales7.length - 1)) * (chartW - padX - 10);
    const y = padY + (1 - d.value / maxVal) * (chartH - padY * 2);
    return { x, y, ...d };
  });
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaD =
    pathD +
    ` L${points[points.length - 1].x.toFixed(1)},${chartH - padY} L${points[0].x.toFixed(1)},${chartH - padY} Z`;
  const brandColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--brand")
    .trim() || "#0f6b4a";

  const lineChartSvg = `
    <svg viewBox="0 0 ${chartW} ${chartH}" class="line-chart-wrap" preserveAspectRatio="xMidYMid meet">
      <path d="${areaD}" fill="${brandColor}" class="lc-area" />
      <path d="${pathD}" stroke="${brandColor}" class="lc-line" />
      ${points
        .map(
          (p) =>
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" fill="${brandColor}" class="lc-dot" />`,
        )
        .join("")}
      ${points
        .map(
          (p) =>
            `<text x="${p.x.toFixed(1)}" y="${chartH - 2}" class="lc-label">${p.label}</text>`,
        )
        .join("")}
    </svg>`;

  // --- Donut Chart (SVG) ---
  const donutTotal = paidCount + creditCount + otherCount || 1;
  const donutR = 36;
  const donutStroke = 12;
  const circumference = 2 * Math.PI * donutR;
  function donutArc(count) {
    const pct = count / donutTotal;
    const dash = pct * circumference;
    const gap = circumference - dash;
    return `${dash.toFixed(2)} ${gap.toFixed(2)}`;
  }
  const donutPaidOffset = 0;
  const donutCreditOffset = -(paidCount / donutTotal) * circumference;
  const donutOtherOffset = -((paidCount + creditCount) / donutTotal) * circumference;

  const donutSvg = `
    <svg viewBox="0 0 100 100" class="donut-svg">
      <circle cx="50" cy="50" r="${donutR}" fill="none" stroke="#e5e7eb" stroke-width="${donutStroke}" />
      ${paidCount > 0 ? `<circle cx="50" cy="50" r="${donutR}" fill="none" stroke="#16a34a" stroke-width="${donutStroke}" stroke-dasharray="${donutArc(paidCount)}" stroke-dashoffset="0" transform="rotate(-90 50 50)" />` : ""}
      ${creditCount > 0 ? `<circle cx="50" cy="50" r="${donutR}" fill="none" stroke="#f59e0b" stroke-width="${donutStroke}" stroke-dasharray="${donutArc(creditCount)}" stroke-dashoffset="${-(paidCount / donutTotal) * circumference}" transform="rotate(-90 50 50)" />` : ""}
      ${otherCount > 0 ? `<circle cx="50" cy="50" r="${donutR}" fill="none" stroke="#9ca3af" stroke-width="${donutStroke}" stroke-dasharray="${donutArc(otherCount)}" stroke-dashoffset="${-((paidCount + creditCount) / donutTotal) * circumference}" transform="rotate(-90 50 50)" />` : ""}
      <text x="50" y="48" text-anchor="middle" font-size="14" font-weight="800" fill="currentColor">${allSales.length}</text>
      <text x="50" y="60" text-anchor="middle" font-size="7" fill="var(--text-muted)">sales</text>
    </svg>`;

  // Branch comparison
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
        <div class="card-title" data-i18n="dash.branch_comparison">Store/Branch Comparison (YTD)</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Branch</th><th>Sales</th><th>Txns</th><th>VAT</th><th>Paid</th><th>Credit</th></tr></thead>
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

  // --- Render ---
  root.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card kpi-accent-blue">
        <div class="kpi-icon">🧾</div>
        <div class="kpi-content">
          <div class="label">Today's Sales</div>
          <div class="value">${fmtMoney(todayTotal)}</div>
          <div class="delta ${todayTrend !== null ? (Number(todayTrend) >= 0 ? "up" : "down") : ""}">
            ${todayTrend !== null ? `${Number(todayTrend) >= 0 ? "↑" : "↓"} ${Math.abs(Number(todayTrend))}% vs yday` : "First sale today"}
          </div>
        </div>
      </div>
      <div class="kpi-card kpi-accent-green">
        <div class="kpi-icon">📅</div>
        <div class="kpi-content">
          <div class="label">This Month</div>
          <div class="value">${fmtMoney(monthTotal)}</div>
          <div class="delta up">${monthSales.length} txns</div>
        </div>
      </div>
      <div class="kpi-card kpi-accent-purple">
        <div class="kpi-icon">📊</div>
        <div class="kpi-content">
          <div class="label">This Year</div>
          <div class="value">${fmtMoney(yearTotal)}</div>
          <div class="delta up">${yearSales.length} txns</div>
        </div>
      </div>
      <div class="kpi-card kpi-accent-orange">
        <div class="kpi-icon">🏛️</div>
        <div class="kpi-content">
          <div class="label">VAT (Month)</div>
          <div class="value">${fmtMoney(monthVat)}</div>
        </div>
      </div>
      <div class="kpi-card kpi-accent-teal">
        <div class="kpi-icon">📦</div>
        <div class="kpi-content">
          <div class="label">Inventory</div>
          <div class="value">${fmtMoney(inventoryValue)}</div>
          <div class="delta">${STATE.products.length} SKUs</div>
        </div>
      </div>
      <div class="kpi-card ${lowStock.length ? "kpi-accent-red" : ""}">
        <div class="kpi-icon">⚠️</div>
        <div class="kpi-content">
          <div class="label">Low Stock</div>
          <div class="value" style="color:${lowStock.length ? "var(--danger)" : "inherit"}">${lowStock.length}</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon">👥</div>
        <div class="kpi-content">
          <div class="label">Outstanding</div>
          <div class="value">${fmtMoney(outstandingBalance)}</div>
        </div>
      </div>
      <div class="kpi-card kpi-accent-indigo">
        <div class="kpi-icon">🏛️</div>
        <div class="kpi-content">
          <div class="label">YTD VAT</div>
          <div class="value">${fmtMoney(monthVat)}</div>
        </div>
      </div>
    </div>

    <div class="dash-charts">
      <div class="card">
        <div class="card-title">Sales Trend (7d)</div>
        <div class="line-chart-wrap">${lineChartSvg}</div>
      </div>
      <div class="card">
        <div class="card-title">Payment Status</div>
        <div class="donut-wrap">
          ${donutSvg}
          <div class="donut-legend">
            <div class="donut-legend-item">
              <div class="donut-legend-dot" style="background:#16a34a;"></div>
              <span class="donut-legend-label">Paid</span>
              <span class="donut-legend-value">${paidCount}</span>
            </div>
            <div class="donut-legend-item">
              <div class="donut-legend-dot" style="background:#f59e0b;"></div>
              <span class="donut-legend-label">Credit</span>
              <span class="donut-legend-value">${creditCount}</span>
            </div>
            ${otherCount > 0 ? `
            <div class="donut-legend-item">
              <div class="donut-legend-dot" style="background:#9ca3af;"></div>
              <span class="donut-legend-label">Other</span>
              <span class="donut-legend-value">${otherCount}</span>
            </div>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Recent Transactions</div>
        ${
          recent.length
            ? `<div class="table-wrap"><table>
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
        <div class="card-title">Top Products (90d)</div>
        ${
          topProducts.length
            ? topProducts
                .map(
                  ([name, qty]) => `
          <div class="summary-row"><span>${escapeHtml(name)}</span><span><b>${qty}</b> sold</span></div>`,
                )
                .join("")
            : `<div class="empty-state">No sales data yet.</div>`
        }

        <div class="card-title" style="margin-top:14px;">EFRIS Status</div>
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
        <thead><tr><th>Product</th><th>In Stock</th><th>Reorder</th></tr></thead>
        <tbody>
          ${lowStock
            .slice(0, 10)
            .map(
              (p) => `
            <tr><td>${escapeHtml(p.name)}</td><td style="color:var(--danger);font-weight:700;">${STATE.stockByProduct[p.id] || 0}</td><td>${p.reorder_level}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>`
        : ""
    }

    ${(() => {
      const expiring = STATE.products.filter(
        (p) =>
          p.expiry_date &&
          (new Date(p.expiry_date) - new Date()) / (1000 * 60 * 60 * 24) <=
            30 &&
          new Date(p.expiry_date) > new Date(),
      );
      const expired = STATE.products.filter(
        (p) => p.expiry_date && new Date(p.expiry_date) < new Date(),
      );
      if (!expiring.length && !expired.length) return "";
      return `
    <div class="card">
      <div class="card-title">📅 Expiry Alerts</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Expiry</th><th>Status</th><th>Stock</th></tr></thead>
        <tbody>
          ${expired
            .slice(0, 5)
            .map(
              (p) =>
                `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.expiry_date)}</td><td><span class="badge badge-red">EXPIRED</span></td><td>${STATE.stockByProduct[p.id] || 0}</td></tr>`,
            )
            .join("")}
          ${expiring
            .slice(0, 5)
            .map((p) => {
              const days = Math.ceil(
                (new Date(p.expiry_date) - new Date()) / (1000 * 60 * 60 * 24),
              );
              return `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.expiry_date)}</td><td><span class="badge badge-yellow">${days}d left</span></td><td>${STATE.stockByProduct[p.id] || 0}</td></tr>`;
            })
            .join("")}
        </tbody>
      </table></div>
    </div>`;
    })()}
  `;
}
