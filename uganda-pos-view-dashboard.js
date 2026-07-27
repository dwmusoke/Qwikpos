// =====================================================================
// QWICKPOS — DASHBOARD VIEW (Professional Redesign)
// =====================================================================
import {
  supabase,
  STATE,
  $,
  qsa,
  fmtMoney,
  fmtDate,
  escapeHtml,
  toast,
  lowStockProducts,
} from "./uganda-pos-core.js";

// ── Chart config ──
const BRAND = "#3b82f6";
const BRAND_PREV = "#94a3b8";
const GREEN = "#22c55e";
const RED = "#ef4444";
const TARGET_COLOR = "#a78bfa";
const CHART_UID = () => "d" + Math.random().toString(36).slice(2, 8);

// ── Helpers ──
const sum = (arr, fn) => arr.reduce((a, s) => a + fn(s), 0);
const dayMs = 86400000;
const niceMax = (maxVal) => {
  if (maxVal <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const n = maxVal / mag;
  if (n <= 1) return mag;
  if (n <= 2) return 2 * mag;
  if (n <= 5) return 5 * mag;
  return Math.ceil(n) * mag;
};
const fmtCompact = (val, code) => {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
  return String(Math.round(val));
};

// ── Build daily data for any range ──
function buildDailyData(allSales, days, baseCurrency) {
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d); dEnd.setHours(23, 59, 59, 999);
    const daySales = allSales.filter(s => { const t = new Date(s.created_at); return t >= d && t <= dEnd; });
    const dayOrders = daySales.length;
    const dayRevenue = daySales.reduce((a, s) => a + Number(s.grand_total_base || 0), 0);
    const avgSale = dayOrders > 0 ? Math.round(dayRevenue / dayOrders) : 0;
    const label = days <= 7
      ? d.toLocaleDateString("en", { weekday: "short" })
      : days <= 31
        ? d.toLocaleDateString("en", { day: "numeric", month: "short" })
        : d.toLocaleDateString("en", { month: "short", day: "numeric" });
    data.push({ date: d, label, revenue: dayRevenue, orders: dayOrders, avgSale });
  }
  return data;
}

// ── Smooth bezier path ──
function smoothPath(pts) {
  if (pts.length < 2) return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    const t = 0.35;
    d += ` C${(p1.x + (p2.x - p0.x) * t).toFixed(1)},${(p1.y + (p2.y - p0.y) * t).toFixed(1)} ${(p2.x - (p3.x - p1.x) * t).toFixed(1)},${(p2.y - (p3.y - p1.y) * t).toFixed(1)} ${p2.x},${p2.y}`;
  }
  return d;
}

// ── Build the main chart SVG ──
function buildTrendChart(currentData, prevData, metric, target, baseCurrency, uid) {
  const W = 680, H = 260;
  const PL = 58, PR = 16, PT = 20, PB = 36;
  const plotW = W - PL - PR, plotH = H - PT - PB;

  const curVals = currentData.map(d => d[metric]);
  const prevVals = prevData.map(d => d[metric]);
  const allVals = [...curVals, ...prevVals, target || 0];
  const maxV = niceMax(Math.max(...allVals, 1));

  const yLines = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    y: PT + (1 - pct) * plotH,
    label: metric === "orders" ? String(Math.round(maxV * pct)) : fmtCompact(maxV * pct, baseCurrency),
  }));

  const barCount = currentData.length;
  const gapRatio = 0.35;
  const totalGap = plotW * gapRatio;
  const barW = Math.max((plotW - totalGap) / barCount, 4);
  const gap = barCount > 1 ? totalGap / (barCount - 1) : 0;

  // Current bars
  const bars = currentData.map((d, i) => {
    const x = PL + i * (barW + gap);
    const h = (d[metric] / maxV) * plotH;
    const y = PT + plotH - h;
    return { x, y, w: barW, h, val: d[metric], label: d.label, orders: d.orders, avgSale: d.avgSale, date: d.date };
  });

  // Previous period line
  const prevPts = prevData.map((d, i) => ({
    x: PL + i * (barW + gap) + barW / 2,
    y: PT + (1 - d[metric] / maxV) * plotH,
  }));
  const prevLine = smoothPath(prevPts);

  // Current period smooth line
  const curPts = bars.map(b => ({ x: b.x + b.w / 2, y: b.y }));
  const curLine = smoothPath(curPts);

  // Target line
  const targetY = target > 0 ? PT + (1 - target / maxV) * plotH : null;

  // Find peak/low
  const peakIdx = curVals.indexOf(Math.max(...curVals));
  const lowIdx = curVals.indexOf(Math.min(...curVals.filter(v => v > 0), Infinity));

  // Tooltip width
  const tooltipText = metric === "orders" ? `${bars[0]?.val || 0} orders` : fmtMoney(bars[0]?.val || 0, baseCurrency);
  const tw = Math.max(tooltipText.length * 6 + 24, 90);

  return `
    <svg viewBox="0 0 ${W} ${H}" class="trend-chart" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="bar-grad-${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${BRAND}" stop-opacity="1" />
          <stop offset="100%" stop-color="${BRAND}" stop-opacity="0.7" />
        </linearGradient>
        <linearGradient id="area-grad-${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.15" />
          <stop offset="100%" stop-color="${BRAND}" stop-opacity="0.01" />
        </linearGradient>
        <filter id="bar-shadow-${uid}"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${BRAND}" flood-opacity="0.15" /></filter>
      </defs>

      <!-- Grid -->
      ${yLines.map(l => `<line x1="${PL}" y1="${l.y.toFixed(1)}" x2="${W - PR}" y2="${l.y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.06" />`).join("")}
      ${yLines.map(l => `<text x="${PL - 8}" y="${(l.y + 3.5).toFixed(1)}" text-anchor="end" class="chart-y-label">${l.label}</text>`).join("")}
      <line x1="${PL}" y1="${PT + plotH}" x2="${W - PR}" y2="${PT + plotH}" stroke="currentColor" stroke-opacity="0.1" />

      <!-- Target line -->
      ${targetY !== null ? `
        <line x1="${PL}" y1="${targetY.toFixed(1)}" x2="${W - PR}" y2="${targetY.toFixed(1)}" stroke="${TARGET_COLOR}" stroke-width="1.5" stroke-dasharray="6 4" />
        <text x="${W - PR}" y="${(targetY - 5).toFixed(1)}" text-anchor="end" fill="${TARGET_COLOR}" font-size="9" font-weight="600">Target ${fmtCompact(target, baseCurrency)}</text>
      ` : ""}

      <!-- Previous period line (gray dashed) -->
      ${prevPts.length > 1 ? `<path d="${prevLine}" stroke="${BRAND_PREV}" stroke-width="2" fill="none" stroke-dasharray="5 4" stroke-linecap="round" />` : ""}
      ${prevPts.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${BRAND_PREV}" opacity="0.6" />`).join("")}

      <!-- Bars -->
      ${bars.map((b, i) => `
        <g class="chart-bar-group">
          <rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${Math.max(b.h, 0).toFixed(1)}" rx="4" fill="url(#bar-grad-${uid})" filter="url(#bar-shadow-${uid})" class="chart-bar" />
          <!-- Peak/Low badges -->
          ${i === peakIdx && b.val > 0 ? `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="${GREEN}">🏆</text>` : ""}
          ${i === lowIdx && i !== peakIdx && b.val > 0 ? `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="${RED}">⚠</text>` : ""}
        </g>
      `).join("")}

      <!-- Current period smooth line -->
      ${curPts.length > 1 ? `<path d="${curLine}" stroke="${BRAND}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />` : ""}

      <!-- Hover zones + tooltips -->
      ${bars.map((b, i) => {
        const valStr = metric === "orders" ? `${b.val} orders` : fmtMoney(b.val, baseCurrency);
        const avgStr = metric === "revenue" ? `Avg: ${fmtMoney(b.avgSale, baseCurrency)}` : "";
        const tooltipW = Math.max(valStr.length * 6.5 + 20, 80);
        return `
        <g class="chart-point-group" data-trend-idx="${i}">
          <rect x="${b.x - 4}" y="${PT}" width="${b.w + 8}" height="${plotH}" fill="transparent" class="chart-hover-zone" />
          <g class="chart-tooltip" style="pointer-events:none;">
            <rect x="${Math.max(b.x + b.w / 2 - tooltipW / 2, PL)}" y="${b.y - (metric === "revenue" && avgStr ? 46 : 34)}" width="${tooltipW}" height="${metric === "revenue" && avgStr ? 40 : 26}" rx="6" fill="var(--surface-2,#1e293b)" stroke="currentColor" stroke-opacity="0.1" />
            <text x="${b.x + b.w / 2}" y="${b.y - (metric === "revenue" && avgStr ? 30 : 17)}" text-anchor="middle" class="chart-tooltip-text">${valStr}</text>
            ${avgStr ? `<text x="${b.x + b.w / 2}" y="${b.y - 12}" text-anchor="middle" class="chart-tooltip-sub">${avgStr}</text>` : ""}
          </g>
          <text x="${(b.x + b.w / 2).toFixed(1)}" y="${PT + plotH + 16}" text-anchor="middle" class="chart-x-label">${b.label}</text>
        </g>`;
      }).join("")}
    </svg>`;
}

// ── Horizontal bar chart for top products ──
function buildProductBars(topProducts, maxQty) {
  return topProducts.map(([name, qty], i) => {
    const pct = maxQty > 0 ? (qty / maxQty) * 100 : 0;
    const colors = [BRAND, "#8b5cf6", "#06b6d4", "#f59e0b", "#ef4444"];
    return `<div class="hp-row">
      <span class="hp-label">${escapeHtml(name.length > 20 ? name.slice(0, 18) + "…" : name)}</span>
      <div class="hp-bar-track"><div class="hp-bar-fill" style="width:${pct.toFixed(1)}%;background:${colors[i % 5]};"></div></div>
      <span class="hp-value">${qty}</span>
    </div>`;
  }).join("");
}

// ── Quick Insights ──
function generateInsights(allSales, currentData, prevData, topProducts, lowStock, baseCurrency) {
  const insights = [];
  const curTotal = sum(currentData, d => d.revenue);
  const prevTotal = sum(prevData, d => d.revenue);
  const curOrders = sum(currentData, d => d.orders);
  const prevOrders = sum(prevData, d => d.orders);

  if (prevTotal > 0) {
    const pctChange = ((curTotal - prevTotal) / prevTotal * 100).toFixed(0);
    if (curTotal > prevTotal) insights.push({ icon: "📈", text: `Revenue is up <b>${pctChange}%</b> vs the previous period.` });
    else if (curTotal < prevTotal) insights.push({ icon: "📉", text: `Revenue is down <b>${Math.abs(pctChange)}%</b> vs the previous period.` });
  }
  if (currentData.length) {
    const best = currentData.reduce((a, d) => d.revenue > a.revenue ? d : a, currentData[0]);
    insights.push({ icon: "🏆", text: `<b>${best.label}</b> had the highest revenue at ${fmtMoney(best.revenue, baseCurrency)}.` });
  }
  if (topProducts.length >= 2) {
    const growth = topProducts[0][1];
    insights.push({ icon: "🔥", text: `<b>${escapeHtml(topProducts[0][0])}</b> is the top seller with ${growth} units.` });
  }
  if (lowStock.length > 0) {
    insights.push({ icon: "⚠️", text: `<b>${lowStock.length} product${lowStock.length > 1 ? "s" : ""}</b> are running low on stock.` });
  }
  if (curOrders > 0) {
    const avgOrder = Math.round(curTotal / curOrders);
    insights.push({ icon: "💡", text: `Average order value: <b>${fmtMoney(avgOrder, baseCurrency)}</b> across ${curOrders} orders.` });
  }
  return insights;
}

export async function renderDashboard(root) {
  root.innerHTML = `<div class="empty-state">Loading dashboard…</div>`;

  const baseCurrency = STATE.business?.base_currency || "UGX";
  const since = new Date(); since.setDate(since.getDate() - 90);

  const [
    { data: sales },
    { data: efrisRows },
    { data: customers },
    { data: branchSales },
    { data: expiringBatches },
  ] = await Promise.all([
    supabase.from("sales").select("*, sale_items(*), payments(*)").eq("business_id", STATE.business.id).gte("created_at", since.toISOString()).order("created_at", { ascending: false }),
    supabase.from("efris_invoices").select("status").eq("business_id", STATE.business.id),
    supabase.from("customers").select("balance").eq("business_id", STATE.business.id),
    STATE.branches.length > 1
      ? supabase.from("sales").select("branch_id, grand_total_base, vat_total, exchange_rate, status, sale_type, created_at, payment_status").eq("business_id", STATE.business.id).gte("created_at", new Date(new Date().getFullYear(), 0, 1).toISOString())
      : { data: [] },
    supabase.from("stock_batches").select("*, product:products(name, unit), branch:branches(name)").eq("business_id", STATE.business.id).gt("quantity", 0).not("expiry_date", "is", null).lte("expiry_date", new Date(Date.now() + 30 * dayMs).toISOString().slice(0, 10)).order("expiry_date", { ascending: true }).limit(20),
  ]);

  const allSales = (sales || []).filter(s => s.status !== "voided" && s.sale_type !== "quotation");
  const todayStr = new Date().toDateString();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const todaySales = allSales.filter(s => new Date(s.created_at).toDateString() === todayStr);
  const monthSales = allSales.filter(s => new Date(s.created_at) >= monthStart);
  const yearSales = allSales.filter(s => new Date(s.created_at) >= yearStart);

  const todayTotal = sum(todaySales, s => Number(s.grand_total_base || 0));
  const monthTotal = sum(monthSales, s => Number(s.grand_total_base || 0));
  const yearTotal = sum(yearSales, s => Number(s.grand_total_base || 0));
  const monthVat = sum(monthSales, s => Number(s.vat_total || 0) * Number(s.exchange_rate || 1));

  const lowStock = lowStockProducts();
  const expiryAlerts = (expiringBatches || []).length;
  const inventoryValue = STATE.products.reduce((a, p) => a + Number(p.selling_price || 0) * (STATE.stockByProduct[p.id] || 0), 0);
  const skuCount = STATE.products.length;
  const outstandingBalance = (customers || []).reduce((a, c) => a + Number(c.balance || 0), 0);

  const productTally = {};
  allSales.forEach(s => (s.sale_items || []).forEach(it => { productTally[it.product_name] = (productTally[it.product_name] || 0) + Number(it.quantity); }));
  const topProducts = Object.entries(productTally).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxProductQty = topProducts.length ? topProducts[0][1] : 1;

  const efrisCounts = { pending: 0, queued: 0, accepted: 0, rejected: 0, failed: 0 };
  (efrisRows || []).forEach(r => { efrisCounts[r.status] = (efrisCounts[r.status] || 0) + 1; });

  const recent = allSales.slice(0, 8);

  // Yesterday trend
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterday); yesterdayEnd.setHours(23, 59, 59, 999);
  const yesterdaySales = allSales.filter(s => { const t = new Date(s.created_at); return t >= yesterday && t <= yesterdayEnd; });
  const yesterdayTotal = sum(yesterdaySales, s => Number(s.grand_total_base || 0));
  const todayTrend = yesterdayTotal > 0 ? (((todayTotal - yesterdayTotal) / yesterdayTotal) * 100).toFixed(1) : null;

  // Payment status
  const paidCount = allSales.filter(s => s.payment_status === "paid").length;
  const creditCount = allSales.filter(s => s.payment_status === "credit").length;
  const otherCount = allSales.length - paidCount - creditCount;

  // Collection totals
  const totalAmount = sum(allSales, s => Number(s.grand_total_base || 0));
  const paidAmount = allSales.reduce((a, s) => a + (s.payments || []).reduce((p, q) => p + Number(q.amount_base || 0), 0), 0);
  const collectionPct = totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 100) : 0;

  // Pre-compute data for each period (used by filters)
  const periodData = {
    today: buildDailyData(allSales, 1, baseCurrency),
    "7d": buildDailyData(allSales, 7, baseCurrency),
    "30d": buildDailyData(allSales, 30, baseCurrency),
    "90d": buildDailyData(allSales, 90, baseCurrency),
    year: buildDailyData(allSales, 365, baseCurrency),
  };
  const periodPrevData = {
    today: buildDailyData(allSales, 1, baseCurrency),
    "7d": (() => { const d = new Date(); d.setDate(d.getDate() - 14); const s = new Date(d); s.setDate(s.getDate() - 6); const arr = []; for (let i = 6; i >= 0; i--) { const dd = new Date(s); dd.setDate(dd.getDate() + i); dd.setHours(0,0,0,0); const de = new Date(dd); de.setHours(23,59,59,999); arr.push({ date: dd, label: dd.toLocaleDateString("en",{weekday:"short"}), revenue: allSales.filter(s2 => { const t = new Date(s2.created_at); return t >= dd && t <= de; }).reduce((a,s2) => a + Number(s2.grand_total_base||0), 0), orders: allSales.filter(s2 => { const t = new Date(s2.created_at); return t >= dd && t <= de; }).length, avgSale: 0 }); } arr.forEach(d2 => { d2.avgSale = d2.orders > 0 ? Math.round(d2.revenue / d2.orders) : 0; }); return arr; })(),
    "30d": (() => { const s = new Date(); s.setDate(s.getDate() - 60); const arr = []; for (let i = 29; i >= 0; i--) { const dd = new Date(s); dd.setDate(dd.getDate() + i); dd.setHours(0,0,0,0); const de = new Date(dd); de.setHours(23,59,59,999); const ds = allSales.filter(s2 => { const t = new Date(s2.created_at); return t >= dd && t <= de; }); arr.push({ date: dd, label: dd.toLocaleDateString("en",{day:"numeric",month:"short"}), revenue: ds.reduce((a,s2) => a + Number(s2.grand_total_base||0), 0), orders: ds.length, avgSale: 0 }); } arr.forEach(d2 => { d2.avgSale = d2.orders > 0 ? Math.round(d2.revenue / d2.orders) : 0; }); return arr; })(),
    "90d": (() => { const s = new Date(); s.setDate(s.getDate() - 180); const weeks = []; for (let i = 11; i >= 0; i--) { const ws = new Date(s); ws.setDate(ws.getDate() + i * 14); const we = new Date(ws); we.setDate(we.getDate() + 13); const ds = allSales.filter(s2 => { const t = new Date(s2.created_at); return t >= ws && t <= we; }); weeks.push({ date: ws, label: ws.toLocaleDateString("en",{month:"short",day:"numeric"}), revenue: ds.reduce((a,s2) => a + Number(s2.grand_total_base||0), 0), orders: ds.length, avgSale: 0 }); } weeks.forEach(d2 => { d2.avgSale = d2.orders > 0 ? Math.round(d2.revenue / d2.orders) : 0; }); return weeks; })(),
    year: (() => { const months = []; for (let i = 11; i >= 0; i--) { const ms2 = new Date(); ms2.setMonth(ms2.getMonth() - i, 1); ms2.setHours(0,0,0,0); const me = new Date(ms2); me.setMonth(me.getMonth() + 1, 0); me.setHours(23,59,59,999); const ds = allSales.filter(s2 => { const t = new Date(s2.created_at); return t >= ms2 && t <= me; }); months.push({ date: ms2, label: ms2.toLocaleDateString("en",{month:"short"}), revenue: ds.reduce((a,s2) => a + Number(s2.grand_total_base||0), 0), orders: ds.length, avgSale: 0 }); } months.forEach(d2 => { d2.avgSale = d2.orders > 0 ? Math.round(d2.revenue / d2.orders) : 0; }); return months; })(),
  };

  // Insights
  const insights = generateInsights(allSales, periodData["7d"], periodPrevData["7d"], topProducts, lowStock, baseCurrency);

  // Donut
  const donutTotal = paidCount + creditCount + otherCount || 1;
  const donutR = 36, donutStroke = 12;
  const circumference = 2 * Math.PI * donutR;
  function donutArc(count) { const pct = count / donutTotal; return `${(pct * circumference).toFixed(2)} ${((1 - pct) * circumference).toFixed(2)}`; }

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
    const branchSalesFiltered = branchSales.filter(s => s.status !== "voided" && s.sale_type !== "quotation");
    const branchMap = {};
    (STATE.branches || []).forEach(b => { branchMap[b.id] = { name: b.name, total: 0, vat: 0, count: 0, paid: 0, credit: 0 }; });
    branchSalesFiltered.forEach(s => { const bm = branchMap[s.branch_id]; if (!bm) return; bm.total += Number(s.grand_total_base || 0); bm.vat += Number(s.vat_total || 0) * Number(s.exchange_rate || 1); bm.count++; if (s.payment_status === "paid") bm.paid++; else if (s.payment_status === "credit") bm.credit++; });
    const rows = Object.values(branchMap).sort((a, b) => b.total - a.total);
    branchComparison = `<div class="dash-section"><div class="dash-section-header"><h2 class="dash-section-title">Store/Branch Comparison (YTD)</h2></div><div class="card"><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Sales</th><th>Txns</th><th>VAT</th><th>Paid</th><th>Credit</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${escapeHtml(r.name)}</b></td><td>${fmtMoney(r.total, baseCurrency)}</td><td>${r.count}</td><td>${fmtMoney(r.vat, baseCurrency)}</td><td><span class="badge badge-green">${r.paid}</span></td><td><span class="badge badge-yellow">${r.credit}</span></td></tr>`).join("")}</tbody></table></div></div></div>`;
  }

  // ── Default chart: 7-day ──
  const defaultChart = buildTrendChart(periodData["7d"], periodPrevData["7d"], "revenue", null, baseCurrency, CHART_UID());

  // ── Render ──
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

    <!-- ═══════ SALES TRENDS (Professional) ═══════ -->
    <div class="dash-section" id="trends-section">
      <div class="dash-section-header">
        <h2 class="dash-section-title">Sales Trends</h2>
        <div class="trend-filters" id="trend-filters">
          <button class="tf-btn" data-period="today">Today</button>
          <button class="tf-btn active" data-period="7d">7 Days</button>
          <button class="tf-btn" data-period="30d">30 Days</button>
          <button class="tf-btn" data-period="90d">3 Months</button>
          <button class="tf-btn" data-period="year">Year</button>
        </div>
      </div>

      <!-- Trend KPI cards -->
      <div class="trend-kpis" id="trend-kpis">
        <div class="tkpi-card"><div class="tkpi-label">Revenue</div><div class="tkpi-value" id="tkpi-revenue">${fmtMoney(sum(periodData["7d"], d => d.revenue), baseCurrency)}</div><div class="tkpi-delta" id="tkpi-revenue-delta"></div></div>
        <div class="tkpi-card"><div class="tkpi-label">Avg Order</div><div class="tkpi-value" id="tkpi-avg">${fmtMoney(sum(periodData["7d"], d => d.orders) > 0 ? Math.round(sum(periodData["7d"], d => d.revenue) / sum(periodData["7d"], d => d.orders)) : 0, baseCurrency)}</div><div class="tkpi-sub" id="tkpi-avg-sub">per transaction</div></div>
        <div class="tkpi-card"><div class="tkpi-label">Orders</div><div class="tkpi-value" id="tkpi-orders">${sum(periodData["7d"], d => d.orders)}</div><div class="tkpi-sub">${periodData["7d"].length} days</div></div>
        <div class="tkpi-card"><div class="tkpi-label">Best Day</div><div class="tkpi-value" id="tkpi-best" style="font-size:15px;">${periodData["7d"].reduce((a, d) => d.revenue > a.revenue ? d : a, periodData["7d"][0] || { label: "—" }).label}</div><div class="tkpi-sub" id="tkpi-best-sub">${fmtMoney(periodData["7d"].reduce((a, d) => d.revenue > a.revenue ? d : a, periodData["7d"][0] || { revenue: 0 }).revenue, baseCurrency)}</div></div>
      </div>

      <!-- Chart + Donut grid -->
      <div class="dash-grid dash-grid-trend">
        <div class="card card-chart">
          <div class="chart-legend" id="chart-legend">
            <span class="cl-item"><span class="cl-dot" style="background:${BRAND};"></span>Current</span>
            <span class="cl-item"><span class="cl-dot" style="background:${BRAND_PREV};"></span>Previous</span>
          </div>
          <div id="trend-chart-container">${defaultChart}</div>
        </div>
        <div class="card">
          <div class="card-title">Payment Breakdown</div>
          <div class="donut-wrap">
            ${donutSvg}
            <div class="donut-legend">
              <div class="donut-legend-item"><div class="donut-legend-dot" style="background:#16a34a;"></div><span class="donut-legend-label">Paid</span><span class="donut-legend-value">${paidCount}</span></div>
              <div class="donut-legend-item"><div class="donut-legend-dot" style="background:#f59e0b;"></div><span class="donut-legend-label">Credit</span><span class="donut-legend-value">${creditCount}</span></div>
              ${otherCount > 0 ? `<div class="donut-legend-item"><div class="donut-legend-dot" style="background:#9ca3af;"></div><span class="donut-legend-label">Other</span><span class="donut-legend-value">${otherCount}</span></div>` : ""}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════ TOP PRODUCTS + RECENT SALES ═══════ -->
    <div class="dash-section">
      <div class="dash-grid dash-grid-2">
        <div class="card">
          <div class="card-title">Top Products (90 days)</div>
          ${topProducts.length ? buildProductBars(topProducts, maxProductQty) : '<div class="empty-state">No sales data yet.</div>'}
        </div>
        <div class="card">
          <div class="card-title">Recent Sales</div>
          ${recent.length ? `<div class="table-wrap"><table class="recent-table"><thead><tr><th>Invoice</th><th>Amount</th><th>Status</th></tr></thead><tbody>${recent.map(s => `<tr><td><div class="rt-invoice">${escapeHtml(s.sale_number)}</div><div class="rt-time">${fmtDate(s.created_at)}</div></td><td>${fmtMoney(s.grand_total_base, baseCurrency)}</td><td><span class="badge ${s.payment_status === "paid" ? "badge-green" : s.payment_status === "credit" ? "badge-yellow" : "badge-gray"}">${s.payment_status}</span></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state">No sales yet.</div>'}
        </div>
      </div>
    </div>

    <!-- ═══════ QUICK INSIGHTS ═══════ -->
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">💡 Quick Insights</h2></div>
      <div class="insights-grid">
        ${insights.map(ins => `<div class="insight-card"><span class="insight-icon">${ins.icon}</span><span class="insight-text">${ins.text}</span></div>`).join("")}
        ${insights.length === 0 ? '<div class="empty-state">Start making sales to see insights.</div>' : ""}
      </div>
    </div>

    <!-- Products & Compliance -->
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">Products & Compliance</h2></div>
      <div class="dash-grid dash-grid-2">
        <div class="card"><div class="card-title">EFRIS Pipeline</div><div class="efris-pipeline">${["pending","queued","accepted","rejected","failed"].map(s => { const labels = {pending:"Pending",queued:"Queued",accepted:"Accepted",rejected:"Rejected",failed:"Failed"}; return `<div class="efris-row"><span class="efris-label">${labels[s]}</span><span class="efris-count badge badge-gray">${efrisCounts[s] || 0}</span></div>`; }).join("")}</div>${Object.values(efrisCounts).reduce((a, v) => a + v, 0) === 0 ? '<div class="empty-state" style="margin-top:8px;">No EFRIS activity yet.</div>' : ""}</div>
        <div class="card"><div class="card-title">Period Comparison</div><div class="summary-compare"><div class="sc-row"><span>Today</span><b>${fmtMoney(todayTotal, baseCurrency)}</b></div><div class="sc-row"><span>This Month</span><b>${fmtMoney(monthTotal, baseCurrency)}</b></div><div class="sc-row"><span>This Year</span><b>${fmtMoney(yearTotal, baseCurrency)}</b></div>${todayTrend !== null ? `<div class="sc-row sc-divider"><span>Yesterday vs Today</span><span class="${Number(todayTrend) >= 0 ? "text-success" : "text-danger"}">${Number(todayTrend) >= 0 ? "↑" : "↓"} ${Math.abs(Number(todayTrend))}%</span></div>` : ""}</div></div>
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
      const exp = STATE.products.filter(p => p.expiry_date && (new Date(p.expiry_date) - new Date()) / dayMs <= 30 && new Date(p.expiry_date) > new Date());
      const expd = STATE.products.filter(p => p.expiry_date && new Date(p.expiry_date) < new Date());
      const ba = expiringBatches || [];
      if (lowStock.length === 0 && exp.length === 0 && expd.length === 0 && ba.length === 0) return "";
      const expiryHtml = d => new Date(d).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
      return `
    <div class="dash-section">
      <div class="dash-section-header"><h2 class="dash-section-title">⚠️ Alerts</h2><span class="dash-section-sub">${lowStock.length + exp.length + expd.length + ba.length} items</span></div>
      ${lowStock.length ? `<div class="card card-alert"><div class="card-title">Low Stock</div><div class="table-wrap"><table><thead><tr><th>Product</th><th>In Stock</th><th>Reorder Level</th></tr></thead><tbody>${lowStock.slice(0,10).map(p => `<tr><td>${escapeHtml(p.name)}</td><td style="color:var(--danger);font-weight:700;">${STATE.stockByProduct[p.id]||0}</td><td>${p.reorder_level}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${exp.length || expd.length ? `<div class="card card-alert"><div class="card-title">Expiry Alerts</div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Expiry</th><th>Qty</th><th>Status</th></tr></thead><tbody>${expd.slice(0,5).map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${expiryHtml(p.expiry_date)}</td><td>${STATE.stockByProduct[p.id]||0}</td><td><span class="badge badge-red">EXPIRED</span></td></tr>`).join("")}${exp.slice(0,5).map(p => { const days = Math.ceil((new Date(p.expiry_date)-new Date())/dayMs); return `<tr><td>${escapeHtml(p.name)}</td><td>${expiryHtml(p.expiry_date)}</td><td>${STATE.stockByProduct[p.id]||0}</td><td><span class="badge badge-yellow">${days}d left</span></td></tr>`; }).join("")}</tbody></table></div></div>` : ""}
    </div>`;
    })()}
  `;

  // ── Time filter interactivity ──
  let currentPeriod = "7d";

  qsa(".tf-btn", root).forEach(btn => {
    btn.addEventListener("click", () => {
      currentPeriod = btn.dataset.period;
      qsa(".tf-btn", root).forEach(b => b.classList.toggle("active", b.dataset.period === currentPeriod));

      const cur = periodData[currentPeriod];
      const prev = periodPrevData[currentPeriod];
      const chart = buildTrendChart(cur, prev, "revenue", null, baseCurrency, CHART_UID());
      $("trend-chart-container").innerHTML = chart;

      // Update KPIs
      const curRevenue = sum(cur, d => d.revenue);
      const prevRevenue = sum(prev, d => d.revenue);
      const curOrders = sum(cur, d => d.orders);
      const avgOrder = curOrders > 0 ? Math.round(curRevenue / curOrders) : 0;
      const best = cur.reduce((a, d) => d.revenue > a.revenue ? d : a, cur[0] || { label: "—", revenue: 0 });

      $("tkpi-revenue").textContent = fmtMoney(curRevenue, baseCurrency);
      if (prevRevenue > 0) {
        const pct = ((curRevenue - prevRevenue) / prevRevenue * 100).toFixed(0);
        $("tkpi-revenue-delta").textContent = `${curRevenue >= prevRevenue ? "↑" : "↓"} ${Math.abs(pct)}% from previous`;
        $("tkpi-revenue-delta").className = `tkpi-delta ${curRevenue >= prevRevenue ? "up" : "down"}`;
      } else {
        $("tkpi-revenue-delta").textContent = "";
      }
      $("tkpi-avg").textContent = fmtMoney(avgOrder, baseCurrency);
      $("tkpi-orders").textContent = curOrders;
      $("tkpi-best").textContent = best.label;
      $("tkpi-best-sub").textContent = fmtMoney(best.revenue, baseCurrency);
    });
  });
}
