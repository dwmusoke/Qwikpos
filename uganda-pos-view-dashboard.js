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

  const baseCurrency = STATE.business?.base_currency || "UGX";
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const [
    { data: sales },
    { data: efrisRows },
    { data: customers },
    { data: branchSales },
    { data: expiringBatches },
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("*, sale_items(*), payments(*)")
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
    supabase
      .from("stock_batches")
      .select("*, product:products(name, unit), branch:branches(name)")
      .eq("business_id", STATE.business.id)
      .gt("quantity", 0)
      .not("expiry_date", "is", null)
      .lte("expiry_date", new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
      .order("expiry_date", { ascending: true })
      .limit(20),
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
  const expiryAlerts = (expiringBatches || []).length;
  const inventoryValue = STATE.products.reduce(
    (a, p) => a + Number(p.selling_price || 0) * (STATE.stockByProduct[p.id] || 0),
    0,
  );
  const skuCount = STATE.products.length;
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

  // --- Professional SVG Line Chart ---
  const chartW = 560;
  const chartH = 220;
  const padLeft = 62;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 36;
  const plotW = chartW - padLeft - padRight;
  const plotH = chartH - padTop - padBottom;
  const brandColor = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#0f6b4a";

  const maxVal = Math.max(...dailySales7.map((d) => d.value), 1);
  // Round max up to nice number for Y-axis
  const niceMax = (() => {
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
    const normalized = maxVal / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return Math.ceil(normalized) * magnitude;
  })();

  const points = dailySales7.map((d, i) => {
    const x = padLeft + (i / Math.max(dailySales7.length - 1, 1)) * plotW;
    const y = padTop + (1 - d.value / niceMax) * plotH;
    return { x, y, ...d };
  });

  // Y-axis grid lines and labels (5 lines)
  const yLines = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
    const y = padTop + (1 - pct) * plotH;
    const val = Math.round(niceMax * pct);
    return { y, label: val >= 1000 ? `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k` : String(val) };
  });

  // Smooth bezier curve using cubic bezier approximation
  function smoothPath(pts) {
    if (pts.length < 2) return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const tension = 0.3;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;
      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }

  const linePath = smoothPath(points);
  const areaPath = linePath + ` L${points[points.length - 1].x.toFixed(1)},${padTop + plotH} L${points[0].x.toFixed(1)},${padTop + plotH} Z`;

  const chartUid = "sc" + Math.random().toString(36).slice(2, 8);

  const lineChartSvg = `
    <svg viewBox="0 0 ${chartW} ${chartH}" class="line-chart-wrap professional-chart" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="grad-${chartUid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${brandColor}" stop-opacity="0.25" />
          <stop offset="100%" stop-color="${brandColor}" stop-opacity="0.02" />
        </linearGradient>
        <filter id="glow-${chartUid}">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="${brandColor}" flood-opacity="0.3" />
        </filter>
      </defs>

      <!-- Grid lines -->
      ${yLines.map((l) => `<line x1="${padLeft}" y1="${l.y.toFixed(1)}" x2="${chartW - padRight}" y2="${l.y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.07" stroke-width="1" />`).join("")}

      <!-- Y-axis labels -->
      ${yLines.map((l) => `<text x="${padLeft - 8}" y="${(l.y + 3.5).toFixed(1)}" text-anchor="end" class="chart-y-label">${l.label}</text>`).join("")}

      <!-- X-axis baseline -->
      <line x1="${padLeft}" y1="${padTop + plotH}" x2="${chartW - padRight}" y2="${padTop + plotH}" stroke="currentColor" stroke-opacity="0.1" stroke-width="1" />

      <!-- Area fill -->
      <path d="${areaPath}" fill="url(#grad-${chartUid})" />

      <!-- Line -->
      <path d="${linePath}" stroke="${brandColor}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-${chartUid})" />

      <!-- Data points + hover zones -->
      ${points.map((p, i) => {
        const tooltipText = fmtMoney(p.value, baseCurrency);
        const tw = Math.max(tooltipText.length * 5.5 + 16, 72);
        return `
        <g class="chart-point-group">
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="16" fill="transparent" class="chart-hover-zone" />
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${brandColor}" stroke="#fff" stroke-width="2" class="chart-dot" />
          <g class="chart-tooltip" style="pointer-events:none;">
            <rect x="${p.x - tw / 2}" y="${p.y - 32}" width="${tw}" height="22" rx="6" fill="var(--surface-2,#1e293b)" stroke="currentColor" stroke-opacity="0.1" stroke-width="1" />
            <text x="${p.x.toFixed(1)}" y="${p.y - 17}" text-anchor="middle" class="chart-tooltip-text">${tooltipText}</text>
          </g>
          <text x="${p.x.toFixed(1)}" y="${padTop + plotH + 18}" text-anchor="middle" class="chart-x-label">${p.label}</text>
        </g>`;
      }).join("")}
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
                <td>${fmtMoney(r.total, baseCurrency)}</td>
                <td>${r.count}</td>
                <td>${fmtMoney(r.vat, baseCurrency)}</td>
                <td><span class="badge badge-green">${r.paid}</span></td>
                <td><span class="badge badge-yellow">${r.credit}</span></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table></div>
      </div>`;
  }

  // Payment totals for business health
  const totalAmount = allSales.reduce((a, s) => a + Number(s.grand_total_base || 0), 0);
  const paidAmount = allSales.reduce((a, s) => {
    const pay = (s.payments || []).reduce((p, q) => p + Number(q.amount_base || 0), 0);
    return a + pay;
  }, 0);
  const collectionPct = totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 100) : 0;

  // --- Render ---
  const totalAlerts = lowStock.length + expiryAlerts + (outstandingBalance > 0 ? 1 : 0);
  root.innerHTML = `
    <!-- Executive KPIs -->
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">Executive Summary</h2></div>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-icon" style="background:#eef7ff;">🧾</div><div class="kpi-content"><div class="label">Today's Sales</div><div class="value">${fmtMoney(todayTotal, baseCurrency)}</div><div class="delta ${todayTrend !== null ? (Number(todayTrend) >= 0 ? "up" : "down") : ""}">${todayTrend !== null ? `${Number(todayTrend) >= 0 ? "↑" : "↓"} ${Math.abs(Number(todayTrend))}% vs yesterday` : "First sale today"}</div></div></div>
        <div class="kpi-card"><div class="kpi-icon" style="background:#eefaf0;">📅</div><div class="kpi-content"><div class="label">Monthly Sales</div><div class="value">${fmtMoney(monthTotal, baseCurrency)}</div><div class="delta">${monthSales.length} transactions</div></div></div>
        <div class="kpi-card"><div class="kpi-icon" style="background:#f3f0ff;">📦</div><div class="kpi-content"><div class="label">Inventory Value</div><div class="value">${fmtMoney(inventoryValue, baseCurrency)}</div><div class="delta">${skuCount} SKUs</div></div></div>
        <div class="kpi-card"><div class="kpi-icon" style="background:#fff7ed;">👥</div><div class="kpi-content"><div class="label">Receivables</div><div class="value">${fmtMoney(outstandingBalance, baseCurrency)}</div><div class="delta">${(customers || []).length} customers</div></div></div>
        <div class="kpi-card"><div class="kpi-icon" style="background:#fff1f2;">⚠️</div><div class="kpi-content"><div class="label">Alerts</div><div class="value" style="color:${totalAlerts > 0 ? "var(--danger)" : "var(--text)"}">${totalAlerts}</div><div class="delta">${lowStock.length} low stock · ${expiryAlerts} expiring</div></div></div>
        <div class="kpi-card"><div class="kpi-icon" style="background:#f0fdf4;">✅</div><div class="kpi-content"><div class="label">Business Health</div><div class="value">${allSales.length > 0 ? "Healthy" : "No Data"}</div><div class="delta">${fmtMoney(paidAmount, baseCurrency)} / ${fmtMoney(totalAmount, baseCurrency)} · ${collectionPct}% collected</div></div></div>
      </div>
    </div>

    <!-- Sales Trends -->
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">Sales Trends</h2><span class="dash-section-sub">7-day overview</span></div>
      <div class="dash-grid dash-grid-2">
        <div class="card card-chart"><div class="card-title">Daily Sales</div><div class="line-chart-wrap">${lineChartSvg}</div></div>
        <div class="card"><div class="card-title">Payment Breakdown</div><div class="donut-wrap">${donutSvg}<div class="donut-legend"><div class="donut-legend-item"><div class="donut-legend-dot" style="background:#16a34a;"></div><span class="donut-legend-label">Paid</span><span class="donut-legend-value">${paidCount}</span></div><div class="donut-legend-item"><div class="donut-legend-dot" style="background:#f59e0b;"></div><span class="donut-legend-label">Credit</span><span class="donut-legend-value">${creditCount}</span></div>${otherCount > 0 ? `<div class="donut-legend-item"><div class="donut-legend-dot" style="background:#9ca3af;"></div><span class="donut-legend-label">Other</span><span class="donut-legend-value">${otherCount}</span></div>` : ""}</div></div></div>
      </div>
    </div>

    <!-- Sales Summary -->
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">Sales Summary</h2></div>
      <div class="dash-grid dash-grid-2">
        <div class="card"><div class="card-title">Period Comparison</div><div class="summary-compare"><div class="sc-row"><span>Today</span><b>${fmtMoney(todayTotal, baseCurrency)}</b></div><div class="sc-row"><span>This Month</span><b>${fmtMoney(monthTotal, baseCurrency)}</b></div><div class="sc-row"><span>This Year</span><b>${fmtMoney(yearTotal, baseCurrency)}</b></div>${todayTrend !== null ? `<div class="sc-row sc-divider"><span>Yesterday vs Today</span><span class="${Number(todayTrend) >= 0 ? "text-success" : "text-danger"}">${Number(todayTrend) >= 0 ? "↑" : "↓"} ${Math.abs(Number(todayTrend))}%</span></div>` : ""}</div></div>
        <div class="card"><div class="card-title">Recent Transactions</div>${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Time</th><th>Total</th><th>Status</th></tr></thead><tbody>${recent.map(s => `<tr><td>${escapeHtml(s.sale_number)}</td><td>${fmtDate(s.created_at)}</td><td>${fmtMoney(s.grand_total_base, baseCurrency)}</td><td><span class="badge ${s.payment_status === "paid" ? "badge-green" : s.payment_status === "credit" ? "badge-yellow" : "badge-gray"}">${s.payment_status}</span></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state">No sales yet — head to <b>Sell (POS)</b> to record your first one.</div>'}</div>
      </div>
    </div>

    <!-- Products & Compliance -->
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">Products & Compliance</h2></div>
      <div class="dash-grid dash-grid-2">
        <div class="card"><div class="card-title">Top 5 Products (90 days)</div>${topProducts.length ? topProducts.map(([name, qty]) => `<div class="summary-row"><span>${escapeHtml(name)}</span><span><b>${qty}</b> sold</span></div>`).join("") : '<div class="empty-state">No sales data yet.</div>'}</div>
        <div class="card"><div class="card-title">EFRIS Pipeline</div><div class="efris-pipeline">${["pending","queued","accepted","rejected","failed"].map(s => { const labels = {pending:"Pending",queued:"Queued",accepted:"Accepted",rejected:"Rejected",failed:"Failed"}; return `<div class="efris-row"><span class="efris-label">${labels[s]}</span><span class="efris-count badge badge-gray">${efrisCounts[s] || 0}</span></div>`; }).join("")}</div>${Object.values(efrisCounts).reduce((a, v) => a + v, 0) === 0 ? '<div class="empty-state" style="margin-top:8px;">No EFRIS activity yet.</div>' : ""}</div>
      </div>
    </div>

    ${branchComparison}

    <!-- Tax & Inventory -->
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">Tax & Inventory Health</h2></div>
      <div class="dash-grid dash-grid-2">
        <div class="card"><div class="card-title">Tax Summary</div><div class="summary-compare"><div class="sc-row"><span>VAT (Month)</span><b>${fmtMoney(monthVat, baseCurrency)}</b></div><div class="sc-row"><span>VAT (YTD)</span><b>${fmtMoney(monthVat, baseCurrency)}</b></div><div class="sc-row"><span>VAT Rate</span><b>${STATE.taxCategories.find(t => t.code === "VAT")?.rate || 18}%</b></div></div></div>
        <div class="card"><div class="card-title">Inventory Health</div><div class="summary-compare"><div class="sc-row"><span>Low Stock Items</span><b style="color:${lowStock.length > 0 ? "var(--warning)" : "var(--success)"}">${lowStock.length}</b></div><div class="sc-row"><span>Expiring (≤30d)</span><b style="color:${expiryAlerts > 0 ? "var(--warning)" : "var(--success)"}">${expiryAlerts}</b></div><div class="sc-row"><span>Total SKUs</span><b>${STATE.products.length}</b></div></div></div>
      </div>
    </div>

    <!-- Alerts -->
    ${(() => {
      const exp = STATE.products.filter(p => p.expiry_date && (new Date(p.expiry_date) - new Date()) / (1000*60*60*24) <= 30 && new Date(p.expiry_date) > new Date());
      const expd = STATE.products.filter(p => p.expiry_date && new Date(p.expiry_date) < new Date());
      const ba = expiringBatches || [];
      if (lowStock.length === 0 && exp.length === 0 && expd.length === 0 && ba.length === 0) return "";
      const expiryHtml = (d) => { const dt = new Date(d); return dt.toLocaleDateString("en", {month:"short",day:"numeric",year:"numeric"}); };
      return `
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">⚠️ Alerts</h2><span class="dash-section-sub">${lowStock.length + exp.length + expd.length + ba.length} items</span></div>
      ${lowStock.length ? `<div class="card card-alert"><div class="card-title">Low Stock</div><div class="table-wrap"><table><thead><tr><th>Product</th><th>In Stock</th><th>Reorder Level</th></tr></thead><tbody>${lowStock.slice(0,10).map(p => `<tr><td>${escapeHtml(p.name)}</td><td style="color:var(--danger);font-weight:700;">${STATE.stockByProduct[p.id]||0}</td><td>${p.reorder_level}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${exp.length || expd.length ? `<div class="card card-alert"><div class="card-title">Expiry Alerts</div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Expiry</th><th>Qty</th><th>Status</th></tr></thead><tbody>${expd.slice(0,5).map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${expiryHtml(p.expiry_date)}</td><td>${STATE.stockByProduct[p.id]||0}</td><td><span class="badge badge-red">EXPIRED</span></td></tr>`).join("")}${exp.slice(0,5).map(p => { const days = Math.ceil((new Date(p.expiry_date)-new Date())/(1000*60*60*24)); return `<tr><td>${escapeHtml(p.name)}</td><td>${expiryHtml(p.expiry_date)}</td><td>${STATE.stockByProduct[p.id]||0}</td><td><span class="badge badge-yellow">${days}d left</span></td></tr>`; }).join("")}</tbody></table></div></div>` : ""}
    </div>`;
    })()}
  `;
}
