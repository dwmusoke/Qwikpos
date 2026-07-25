// =====================================================================
// QWICKPOS — BUSINESS INTELLIGENCE VIEW
// Comprehensive analytics: executive dashboard, sales, profitability,
// inventory, customers, suppliers, tax, operations, AI insights
// =====================================================================
import {
  supabase,
  STATE,
  $,
  escapeHtml,
  fmtMoney,
  fmtDate,
  stockFor,
  lowStockProducts,
  hasFeature,
} from "./uganda-pos-core.js";

let biTab = "executive";
const baseCurrency = () => STATE.business?.base_currency || "UGX";
const num = (v) => Number(v || 0);
const pct = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) : "0.0";
const fmtN = (n) => n?.toLocaleString?.() ?? "0";

// =====================================================================
// DATA LAYER — single query pipeline, cached per render
// =====================================================================
let DATA = null;

async function fetchAllData() {
  if (DATA) return DATA;
  const bid = STATE.business.id;
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const now = new Date();

  const [
    salesRes, productsRes, customersRes, suppliersRes, categoriesRes,
    branchesRes, stockRes, movementsRes, efrisRes, expensesRes,
    purchaseOrdersRes, batchRes, taxCatRes,
  ] = await Promise.all([
    supabase.from("sales").select("*, sale_items(*)").eq("business_id", bid).gte("created_at", since90).order("created_at", { ascending: false }),
    supabase.from("products").select("*").eq("business_id", bid).eq("is_active", true),
    supabase.from("customers").select("*").eq("business_id", bid),
    supabase.from("suppliers").select("*").eq("business_id", bid),
    supabase.from("categories").select("*").eq("business_id", bid),
    supabase.from("branches").select("*").eq("business_id", bid),
    supabase.from("product_stock").select("*").eq("business_id", bid).or(`branch_id.eq.${STATE.branch?.id || ""}`),
    supabase.from("stock_movements").select("*, product:products(name, cost_price)").eq("business_id", bid).gte("created_at", since90).order("created_at", { ascending: false }),
    supabase.from("efris_invoices").select("*").eq("business_id", bid),
    supabase.from("expenses").select("*").eq("business_id", bid).gte("expense_date", since90.slice(0, 10)),
    supabase.from("purchase_orders").select("*, items:purchase_order_items(*)").eq("business_id", bid).gte("created_at", since90),
    supabase.from("stock_batches").select("*, product:products(name)").eq("business_id", bid).gt("quantity", 0),
    supabase.from("tax_categories").select("*"),
  ]);

  const allSales = (salesRes.data || []).filter(s => s.status !== "voided" && s.sale_type !== "quotation");
  const today = now.toDateString();
  const todaySales = allSales.filter(s => new Date(s.created_at).toDateString() === today);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const monthSales = allSales.filter(s => new Date(s.created_at) >= monthStart);
  const yearSales = allSales.filter(s => new Date(s.created_at) >= new Date(now.getFullYear(), 0, 1));

  // Build stock map
  const stockMap = {};
  (stockRes.data || []).forEach(s => { stockMap[s.product_id] = num(s.quantity); });

  // 90-day product sales tally
  const prodSales = {};
  allSales.forEach(s => (s.sale_items || []).forEach(it => {
    if (!prodSales[it.product_id]) prodSales[it.product_id] = { qty: 0, revenue: 0, cost: 0, name: it.product_name };
    prodSales[it.product_id].qty += num(it.quantity);
    prodSales[it.product_id].revenue += num(it.line_total || num(it.quantity) * num(it.unit_price));
    prodSales[it.product_id].cost += num(it.quantity) * num(it.cost_price || 0);
  }));

  // Category sales
  const catSales = {};
  const products = productsRes.data || [];
  products.forEach(p => {
    if (prodSales[p.id]) {
      const catId = p.category_id || "uncategorized";
      if (!catSales[catId]) catSales[catId] = { qty: 0, revenue: 0, cost: 0 };
      catSales[catId].qty += prodSales[p.id].qty;
      catSales[catId].revenue += prodSales[p.id].revenue;
      catSales[catId].cost += prodSales[p.id].cost;
    }
  });

  // Branch sales
  const branchSales = {};
  allSales.forEach(s => {
    const bid2 = s.branch_id || "unknown";
    if (!branchSales[bid2]) branchSales[bid2] = { count: 0, revenue: 0, vat: 0 };
    branchSales[bid2].count++;
    branchSales[bid2].revenue += num(s.grand_total_base);
    branchSales[bid2].vat += num(s.vat_total);
  });

  // Cashier sales
  const cashierSales = {};
  allSales.forEach(s => {
    const cid = s.created_by || s.cashier_id || "unknown";
    if (!cashierSales[cid]) cashierSales[cid] = { count: 0, revenue: 0 };
    cashierSales[cid].count++;
    cashierSales[cid].revenue += num(s.grand_total_base);
  });

  // Payment method breakdown
  const payMethods = {};
  allSales.forEach(s => {
    const pm = s.payment_method || "unknown";
    if (!payMethods[pm]) payMethods[pm] = { count: 0, total: 0 };
    payMethods[pm].count++;
    payMethods[pm].total += num(s.grand_total_base);
  });

  // Customer sales
  const custSales = {};
  allSales.forEach(s => {
    const cid = s.customer_id || "walk-in";
    if (!custSales[cid]) custSales[cid] = { count: 0, total: 0, first: s.created_at, last: s.created_at };
    custSales[cid].count++;
    custSales[cid].total += num(s.grand_total_base);
    if (s.created_at < custSales[cid].first) custSales[cid].first = s.created_at;
    if (s.created_at > custSales[cid].last) custSales[cid].last = s.created_at;
  });

  // Daily sales for 30 days
  const dailySales = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const ds = d.toDateString();
    const dayTxns = allSales.filter(s => new Date(s.created_at).toDateString() === ds);
    dailySales.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en", { month: "short", day: "numeric" }),
      count: dayTxns.length,
      revenue: dayTxns.reduce((a, s) => a + num(s.grand_total_base), 0),
    });
  }

  // Expenses
  const expenses = expensesRes.data || [];
  const totalExpenses = expenses.reduce((a, e) => a + num(e.amount_base || e.amount), 0);
  const expenseByCategory = {};
  expenses.forEach(e => {
    const cat = e.category || "Other";
    expenseByCategory[cat] = (expenseByCategory[cat] || 0) + num(e.amount_base || e.amount);
  });

  // POs
  const pos = purchaseOrdersRes.data || [];
  const totalPOValue = pos.reduce((a, po) => a + num(po.total_cost), 0);
  const pendingPOs = pos.filter(po => po.status === "pending" || po.status === "submitted");
  const receivedPOs = pos.filter(po => po.status === "received");

  // EFRIS
  const efris = efrisRes.data || [];
  const efrisAccepted = efris.filter(e => e.status === "accepted").length;
  const efrisRejected = efris.filter(e => e.status === "rejected").length;
  const efrisPending = efris.filter(e => e.status === "pending" || e.status === "queued").length;

  // Inventory
  const totalStockValue = products.reduce((a, p) => a + num(p.cost_price) * (stockMap[p.id] || 0), 0);
  const totalRetailValue = products.reduce((a, p) => a + num(p.selling_price) * (stockMap[p.id] || 0), 0);
  const outOfStock = products.filter(p => (stockMap[p.id] || 0) <= 0);
  const lowStock = lowStockProducts();

  // Batches
  const batches = batchRes.data || [];
  const expiredBatches = batches.filter(b => b.expiry_date && new Date(b.expiry_date) < now);
  const expiringSoon = batches.filter(b => {
    if (!b.expiry_date) return false;
    const d = new Date(b.expiry_date);
    return d >= now && d <= new Date(now.getTime() + 30 * 86400000);
  });

  // Totals
  const totalRevenue90 = allSales.reduce((a, s) => a + num(s.grand_total_base), 0);
  const totalRevenueMonth = monthSales.reduce((a, s) => a + num(s.grand_total_base), 0);
  const totalVat90 = allSales.reduce((a, s) => a + num(s.vat_total), 0);
  const totalCOGS = Object.values(prodSales).reduce((a, p) => a + p.cost, 0);
  const grossProfit = totalRevenue90 - totalCOGS;
  const outstandingAR = (customersRes.data || []).reduce((a, c) => a + num(c.balance), 0);
  const outstandingAP = (suppliersRes.data || []).reduce((a, s) => a + num(s.balance), 0);
  const avgOrderValue = allSales.length > 0 ? totalRevenue90 / allSales.length : 0;

  // Previous month for comparison
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const prevMonthSales = allSales.filter(s => {
    const d = new Date(s.created_at);
    return d >= prevMonthStart && d <= prevMonthEnd;
  });
  const prevMonthRevenue = prevMonthSales.reduce((a, s) => a + num(s.grand_total_base), 0);
  const revenueGrowth = prevMonthRevenue > 0 ? ((totalRevenueMonth - prevMonthRevenue) / prevMonthRevenue * 100) : 0;

  DATA = {
    allSales, todaySales, monthSales, yearSales,
    products, customers: customersRes.data || [], suppliers: suppliersRes.data || [],
    categories: categoriesRes.data || [], branches: branchesRes.data || [],
    stockMap, movements: movementsRes.data || [],
    prodSales, catSales, branchSales, cashierSales, payMethods,
    custSales, dailySales, expenses, expenseByCategory,
    pos, pendingPOs, receivedPOs, totalPOValue,
    efris, efrisAccepted, efrisRejected, efrisPending,
    batches, expiredBatches, expiringSoon,
    totalRevenue90, totalRevenueMonth, totalVat90, totalCOGS, grossProfit,
    outstandingAR, outstandingAP, avgOrderValue,
    totalStockValue, totalRetailValue, outOfStock, lowStock,
    totalExpenses, prevMonthRevenue, revenueGrowth,
    taxCategories: taxCatRes.data || [],
  };
  return DATA;
}

function invalidateData() { DATA = null; }

// =====================================================================
// MAIN RENDER
// =====================================================================
export async function renderBI(root) {
  invalidateData();
  root.innerHTML = `<div class="empty-state">Loading business intelligence…</div>`;
  const d = await fetchAllData();

  root.innerHTML = `
    <div class="view-header">
      <div>
        <h2>📊 Business Intelligence</h2>
        <p class="sub">${STATE.business.name} · ${baseCurrency()} · Last 90 days</p>
      </div>
      <button class="btn btn-outline" id="bi-refresh">🔄 Refresh</button>
    </div>
    <div class="admin-tabs" id="bi-tabs">
      ${["executive","sales","profitability","inventory","customers","suppliers","financial","tax","operations","insights","forecasting"].map(t =>
        `<button class="admin-tab ${biTab===t?"active":""}" data-bitab="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`
      ).join("")}
    </div>
    <div id="bi-content"></div>
  `;

  root.querySelectorAll("[data-bitab]").forEach(btn => {
    btn.addEventListener("click", () => {
      biTab = btn.dataset.bitab;
      root.querySelectorAll("[data-bitab]").forEach(b => b.classList.toggle("active", b.dataset.bitab === biTab));
      renderBITab();
    });
  });
  $("bi-refresh")?.addEventListener("click", () => { invalidateData(); renderBI(root); });
  renderBITab();
}

function renderBITab() {
  const el = $("bi-content");
  if (!el) return;
  const d = DATA;
  switch (biTab) {
    case "executive": renderExecutive(el, d); break;
    case "sales": renderSales(el, d); break;
    case "profitability": renderProfitability(el, d); break;
    case "inventory": renderInventory(el, d); break;
    case "customers": renderCustomers(el, d); break;
    case "suppliers": renderSuppliers(el, d); break;
    case "financial": renderFinancial(el, d); break;
    case "tax": renderTax(el, d); break;
    case "operations": renderOperations(el, d); break;
    case "insights": renderInsights(el, d); break;
    case "forecasting": renderForecasting(el, d); break;
  }
}

// =====================================================================
// HELPER: KPI card
// =====================================================================
function kpi(icon, label, value, opts = {}) {
  const { color, sub, trend, badge } = opts;
  const style = color ? `style="color:${color}"` : "";
  const trendHtml = trend != null
    ? `<span class="badge ${trend >= 0 ? "badge-green" : "badge-red"}" style="font-size:10px;margin-left:6px">${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(1)}%</span>`
    : "";
  const badgeHtml = badge ? `<span class="badge ${badge.cls || "badge-blue"}" style="font-size:10px;margin-left:6px">${badge.text}</span>` : "";
  return `
    <div class="kpi-card">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-content">
        <div class="label">${label}</div>
        <div class="value" ${style}>${value}${trendHtml}${badgeHtml}</div>
        ${sub ? `<div class="delta">${sub}</div>` : ""}
      </div>
    </div>`;
}

function badge(text, cls = "badge-blue") {
  return `<span class="badge ${cls}">${text}</span>`;
}

function statusBadge(val, map) {
  return map[val] || badge(val);
}

function miniBar(items, maxVal) {
  if (!items.length) return "";
  const mx = maxVal || Math.max(...items.map(i => i.value));
  return `<div style="display:flex;gap:2px;align-items:flex-end;height:32px;margin:6px 0">${items.map(i => {
    const h = mx > 0 ? Math.max(2, (i.value / mx) * 28) : 2;
    return `<div style="flex:1;height:${h}px;background:${i.color || "var(--brand)"};border-radius:2px" title="${i.label}: ${fmtN(i.value)}"></div>`;
  }).join("")}</div>`;
}

// =====================================================================
// 1. EXECUTIVE DASHBOARD
// =====================================================================
function renderExecutive(el, d) {
  const gm = num(d.totalRevenue90) > 0 ? ((d.grossProfit / d.totalRevenue90) * 100).toFixed(1) : "0.0";
  const activeCust = d.customers.filter(c => {
    const cs = d.custSales[c.id];
    return cs && new Date(cs.last) >= new Date(Date.now() - 30 * 86400000);
  }).length;

  const netProfit = d.totalRevenue90 - d.totalCOGS - d.totalExpenses;
  const nm = num(d.totalRevenue90) > 0 ? ((netProfit / d.totalRevenue90) * 100).toFixed(1) : "0.0";

  // Health Score (0-100)
  let score = 0;
  if (d.allSales.length > 0) score += Math.min(20, d.allSales.length / 2);
  if (num(gm) > 30) score += 20; else if (num(gm) > 15) score += 10;
  if (d.revenueGrowth > 0) score += Math.min(15, d.revenueGrowth);
  if (d.lowStock.length === 0) score += 10; else score += Math.max(0, 10 - d.lowStock.length);
  if (d.outOfStock.length === 0) score += 10;
  if (d.customers.length > 10) score += 5;
  if (activeCust > 0) score += 5;
  if (d.pendingPOs.length > 0) score += 5;
  if (d.efrisRejected === 0) score += 5;
  score = Math.min(100, Math.round(score));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  const gradeColor = score >= 80 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--danger)";

  el.innerHTML = `
    <div style="margin-bottom:20px">
      <div class="card" style="background:linear-gradient(135deg, var(--brand-light), var(--surface));border:1px solid var(--brand);padding:24px">
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
          <div style="text-align:center;min-width:100px">
            <div style="font-size:42px;font-weight:800;color:${gradeColor}">${score}</div>
            <div style="font-size:12px;color:var(--text-muted)">Health Score</div>
            <div style="font-size:18px;font-weight:700;color:${gradeColor}">${grade}</div>
          </div>
          <div style="flex:1;min-width:200px">
            <div style="font-size:14px;font-weight:600;margin-bottom:8px">Business Health Summary</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${score >= 80 ? badge("Healthy", "badge-green") : score >= 60 ? badge("Needs Attention", "badge-yellow") : badge("Critical", "badge-red")}
              ${d.revenueGrowth > 0 ? badge(`Revenue +${d.revenueGrowth.toFixed(1)}%`, "badge-green") : badge(`Revenue ${d.revenueGrowth.toFixed(1)}%`, "badge-red")}
              ${num(gm) > 30 ? badge(`GM ${gm}%`, "badge-green") : num(gm) > 15 ? badge(`GM ${gm}%`, "badge-yellow") : badge(`GM ${gm}%`, "badge-red")}
              ${d.lowStock.length > 0 ? badge(`${d.lowStock.length} Low Stock`, "badge-yellow") : badge("Stock OK", "badge-green")}
              ${d.outOfStock.length > 0 ? badge(`${d.outOfStock.length} Out of Stock`, "badge-red") : badge("All in Stock", "badge-green")}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
      ${kpi("💰", "Total Revenue (90d)", fmtMoney(d.totalRevenue90, baseCurrency()), { trend: d.revenueGrowth, sub: `${fmtN(d.allSales.length)} transactions` })}
      ${kpi("📈", "This Month", fmtMoney(d.totalRevenueMonth, baseCurrency()), { sub: `${fmtN(d.monthSales.length)} sales` })}
      ${kpi("💵", "Gross Profit", fmtMoney(d.grossProfit, baseCurrency()), { color: d.grossProfit >= 0 ? "var(--success)" : "var(--danger)", sub: `Margin: ${gm}%` })}
      ${kpi("🏦", "Net Profit", fmtMoney(netProfit, baseCurrency()), { color: netProfit >= 0 ? "var(--success)" : "var(--danger)", sub: `Margin: ${nm}%` })}
      ${kpi("🛒", "Avg Order Value", fmtMoney(d.avgOrderValue, baseCurrency()), { sub: `${fmtN(d.allSales.length)} orders` })}
      ${kpi("📦", "Inventory Value", fmtMoney(d.totalStockValue, baseCurrency()), { sub: `${fmtN(d.products.length)} products · ${fmtN(d.outOfStock.length)} OOS` })}
      ${kpi("👥", "Customers", fmtN(d.customers.length), { sub: `${activeCust} active (30d)` })}
      ${kpi("🏢", "Suppliers", fmtN(d.suppliers.length), { sub: `${fmtN(d.pos.length)} POs` })}
      ${kpi("📋", "Purchase Orders", fmtN(d.pos.length), { sub: `${d.pendingPOs.length} pending · ${fmtMoney(d.totalPOValue, baseCurrency())}` })}
      ${kpi("💳", "Receivables", fmtMoney(d.outstandingAR, baseCurrency()), { color: d.outstandingAR > 0 ? "var(--warning)" : "var(--success)" })}
      ${kpi("📄", "Payables", fmtMoney(d.outstandingAP, baseCurrency()), { color: d.outstandingAP > 0 ? "var(--warning)" : "var(--success)" })}
      ${kpi("🏛️", "VAT Collected (90d)", fmtMoney(d.totalVat90, baseCurrency()), { sub: `${d.efrisAccepted} EFRIS accepted` })}
      ${kpi("⚠️", "Low Stock", fmtN(d.lowStock.length), { color: d.lowStock.length > 0 ? "var(--danger)" : "var(--success)", sub: `${d.outOfStock.length} out of stock` })}
      ${kpi("📅", "Expiring Batches", fmtN(d.expiringSoon.length), { color: d.expiringSoon.length > 0 ? "var(--warning)" : "var(--success)", sub: `${d.expiredBatches.length} expired` })}
      ${kpi("💳", "Total Expenses", fmtMoney(d.totalExpenses, baseCurrency()), { sub: `${Object.keys(d.expenseByCategory).length} categories` })}
      ${kpi("📊", "EFRIS", `${d.efrisAccepted}/${d.efris.length}`, { badge: { text: d.efrisRejected > 0 ? `${d.efrisRejected} rejected` : "All OK", cls: d.efrisRejected > 0 ? "badge-red" : "badge-green" } })}
    </div>

    <div style="margin-top:20px">
      <div class="card-title">📅 30-Day Revenue Trend</div>
      ${renderSparkline(d.dailySales.map(ds => ({ value: ds.revenue, label: ds.label })))}
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-title">Top Products (90d)</div>
        ${renderMiniTable(
          Object.entries(d.prodSales).sort((a,b) => b[1].revenue - a[1].revenue).slice(0,5).map(([id, p]) => [
            p.name, fmtMoney(p.revenue, baseCurrency()), `${fmtN(p.qty)} units`
          ]),
          ["Product", "Revenue", "Qty"]
        )}
      </div>
      <div class="card">
        <div class="card-title">Top Customers (90d)</div>
        ${renderMiniTable(
          Object.entries(d.custSales).sort((a,b) => b[1].total - a[1].total).slice(0,5).map(([id, c]) => {
            const cust = d.customers.find(x => x.id === id);
            return [cust?.name || "Walk-in", fmtMoney(c.total, baseCurrency()), `${c.count} orders`];
          }),
          ["Customer", "Spent", "Orders"]
        )}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">⚠️ Alerts & Recommendations</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${d.lowStock.length > 0 ? `<div style="padding:10px;background:var(--danger-light);border-radius:8px;border-left:3px solid var(--danger)"><b>Low Stock:</b> ${d.lowStock.slice(0,3).map(p => `${p.name} (${stockFor(p.id)} left)`).join(", ")}${d.lowStock.length > 3 ? ` +${d.lowStock.length-3} more` : ""}</div>` : ""}
        ${d.expiredBatches.length > 0 ? `<div style="padding:10px;background:var(--danger-light);border-radius:8px;border-left:3px solid var(--danger)"><b>Expired Batches:</b> ${d.expiredBatches.length} batch(es) past expiry — write off or return</div>` : ""}
        ${d.expiringSoon.length > 0 ? `<div style="padding:10px;background:var(--warning-light);border-radius:8px;border-left:3px solid var(--warning)"><b>Expiring Soon:</b> ${d.expiringSoon.length} batch(es) expire within 30 days — prioritize selling</div>` : ""}
        ${d.outstandingAR > 0 ? `<div style="padding:10px;background:var(--info-light);border-radius:8px;border-left:3px solid var(--info)"><b>Receivables:</b> ${fmtMoney(d.outstandingAR, baseCurrency())} outstanding — follow up with customers</div>` : ""}
        ${d.revenueGrowth < -10 ? `<div style="padding:10px;background:var(--danger-light);border-radius:8px;border-left:3px solid var(--danger)"><b>Revenue Declining:</b> ${d.revenueGrowth.toFixed(1)}% vs last month — review pricing and marketing</div>` : ""}
        ${num(gm) < 15 ? `<div style="padding:10px;background:var(--warning-light);border-radius:8px;border-left:3px solid var(--warning)"><b>Low Margin:</b> Gross margin at ${gm}% — review pricing or reduce COGS</div>` : ""}
        ${d.lowStock.length === 0 && d.expiredBatches.length === 0 && d.outstandingAR === 0 ? `<div style="padding:10px;background:var(--success-light);border-radius:8px;border-left:3px solid var(--success)"><b>All Good:</b> No critical alerts detected</div>` : ""}
      </div>
    </div>
  `;
}

// =====================================================================
// HELPER: render mini table
// =====================================================================
function renderMiniTable(rows, headers) {
  if (!rows.length) return `<div class="empty-state" style="padding:16px">No data</div>`;
  return `
    <div class="table-wrap" style="max-height:240px">
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function renderSparkline(items) {
  if (!items.length) return "";
  const mx = Math.max(...items.map(i => i.value), 1);
  const width = 100;
  const points = items.map((it, i) => `${(i / (items.length - 1)) * width},${100 - (it.value / mx) * 80}`).join(" ");
  const areaPoints = `0,100 ${points} ${width},100`;
  return `
    <div style="overflow-x:auto">
      <svg viewBox="0 0 ${width} 100" style="width:100%;height:80px" preserveAspectRatio="none">
        <polygon points="${areaPoints}" fill="var(--brand-light)" />
        <polyline points="${points}" fill="none" stroke="var(--brand)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);padding:0 4px">
        <span>${items[0]?.label || ""}</span>
        <span>${items[items.length-1]?.label || ""}</span>
      </div>
    </div>`;
}

// =====================================================================
// 2. SALES ANALYTICS
// =====================================================================
function renderSales(el, d) {
  const catMap = {};
  d.categories.forEach(c => catMap[c.id] = c.name);

  // Sales by category
  const catRows = Object.entries(d.catSales)
    .map(([id, s]) => [catMap[id] || "Uncategorized", fmtMoney(s.revenue, baseCurrency()), `${fmtN(s.qty)} units`, `${pct(s.revenue, d.totalRevenue90)}%`])
    .sort((a, b) => b[1]?.localeCompare?.(a[1]) || 0);

  // Sales by branch
  const branchMap = {};
  d.branches.forEach(b => branchMap[b.id] = b.name);
  const branchRows = Object.entries(d.branchSales)
    .map(([id, s]) => [branchMap[id] || id, fmtN(s.count), fmtMoney(s.revenue, baseCurrency()), fmtMoney(s.vat, baseCurrency())]);

  // Payment methods
  const payRows = Object.entries(d.payMethods)
    .map(([m, s]) => [m, fmtN(s.count), fmtMoney(s.total, baseCurrency()), `${pct(s.total, d.totalRevenue90)}%`])
    .sort((a, b) => b[2]?.localeCompare?.(a[2]) || 0);

  // Top/Bottom products
  const prodEntries = Object.entries(d.prodSales).sort((a, b) => b[1].revenue - a[1].revenue);
  const top5 = prodEntries.slice(0, 5);
  const bottom5 = prodEntries.slice(-5).reverse();

  // Discount analysis
  let totalDiscount = 0;
  d.allSales.forEach(s => (s.sale_items || []).forEach(it => {
    const orig = num(it.quantity) * num(it.unit_price);
    const actual = num(it.line_total || orig);
    if (orig > actual) totalDiscount += orig - actual;
  }));

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpi("💰", "Total Revenue (90d)", fmtMoney(d.totalRevenue90, baseCurrency()), { trend: d.revenueGrowth })}
      ${kpi("🧾", "Transactions", fmtN(d.allSales.length), { sub: `${fmtN(d.todaySales.length)} today` })}
      ${kpi("🛒", "Avg Order", fmtMoney(d.avgOrderValue, baseCurrency()))}
      ${kpi("📦", "Units Sold", fmtN(Object.values(d.prodSales).reduce((a, p) => a + p.qty, 0)))}
      ${kpi("💸", "Discounts", fmtMoney(totalDiscount, baseCurrency()))}
      ${kpi("🏛️", "VAT (90d)", fmtMoney(d.totalVat90, baseCurrency()))}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">📅 Daily Revenue (30 Days)</div>
      ${renderSparkline(d.dailySales.map(ds => ({ value: ds.revenue, label: ds.label })))}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">🏆 Top Products by Revenue</div>
        ${renderMiniTable(top5.map(([_, p]) => [p.name, fmtMoney(p.revenue, baseCurrency()), `${fmtN(p.qty)} units`]), ["Product", "Revenue", "Qty"])}
      </div>
      <div class="card">
        <div class="card-title">📉 Lowest Products by Revenue</div>
        ${renderMiniTable(bottom5.map(([_, p]) => [p.name, fmtMoney(p.revenue, baseCurrency()), `${fmtN(p.qty)} units`]), ["Product", "Revenue", "Qty"])}
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-title">🏷️ Sales by Category</div>
        ${renderMiniTable(catRows, ["Category", "Revenue", "Qty", "% of Total"])}
      </div>
      <div class="card">
        <div class="card-title">💳 Sales by Payment Method</div>
        ${renderMiniTable(payRows, ["Method", "Count", "Total", "%"])}
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-title">🏢 Sales by Branch</div>
        ${renderMiniTable(branchRows, ["Branch", "Sales", "Revenue", "VAT"])}
      </div>
      <div class="card">
        <div class="card-title">👤 Top Customers</div>
        ${renderMiniTable(
          Object.entries(d.custSales).sort((a,b) => b[1].total - a[1].total).slice(0,8).map(([id, c]) => {
            const cust = d.customers.find(x => x.id === id);
            return [cust?.name || "Walk-in", fmtMoney(c.total, baseCurrency()), `${c.count} orders`];
          }),
          ["Customer", "Spent", "Orders"]
        )}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">🏆 Top Invoices (90d)</div>
      ${renderMiniTable(
        d.allSales.sort((a,b) => num(b.grand_total_base) - num(a.grand_total_base)).slice(0,10).map(s => [
          s.invoice_number || s.sale_number || s.id?.slice(0,8) || "—",
          fmtMoney(s.grand_total_base, baseCurrency()),
          s.payment_status || "—",
          fmtDate(s.created_at),
        ]),
        ["Invoice", "Total", "Status", "Date"]
      )}
    </div>
  `;
}

// =====================================================================
// 3. PROFITABILITY REPORT
// =====================================================================
function renderProfitability(el, d) {
  const netProfit = d.totalRevenue90 - d.totalCOGS - d.totalExpenses;
  const gm = d.totalRevenue90 > 0 ? (d.grossProfit / d.totalRevenue90 * 100).toFixed(1) : "0.0";
  const nm = d.totalRevenue90 > 0 ? (netProfit / d.totalRevenue90 * 100).toFixed(1) : "0.0";

  // Profit per product
  const prodProfit = Object.entries(d.prodSales).map(([id, p]) => ({
    name: p.name, revenue: p.revenue, cost: p.cost,
    profit: p.revenue - p.cost,
    margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100) : 0,
  })).sort((a, b) => b.profit - a.profit);

  const catMap = {};
  d.categories.forEach(c => catMap[c.id] = c.name);

  // Profit per category
  const catProfit = Object.entries(d.catSales).map(([id, s]) => ({
    name: catMap[id] || "Uncategorized",
    revenue: s.revenue, cost: s.cost, profit: s.revenue - s.cost,
    margin: s.revenue > 0 ? ((s.revenue - s.cost) / s.revenue * 100) : 0,
  })).sort((a, b) => b.profit - a.profit);

  // Low margin products (below 15%)
  const lowMargin = prodProfit.filter(p => p.revenue > 0 && p.margin < 15);

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpi("💰", "Revenue (90d)", fmtMoney(d.totalRevenue90, baseCurrency()))}
      ${kpi("📦", "COGS", fmtMoney(d.totalCOGS, baseCurrency()))}
      ${kpi("📈", "Gross Profit", fmtMoney(d.grossProfit, baseCurrency()), { color: d.grossProfit >= 0 ? "var(--success)" : "var(--danger)", sub: `Margin: ${gm}%` })}
      ${kpi("💳", "Expenses", fmtMoney(d.totalExpenses, baseCurrency()))}
      ${kpi("🏦", "Net Profit", fmtMoney(netProfit, baseCurrency()), { color: netProfit >= 0 ? "var(--success)" : "var(--danger)", sub: `Margin: ${nm}%` })}
    </div>

    ${lowMargin.length > 0 ? `
    <div class="card" style="margin-bottom:16px;border-left:3px solid var(--danger)">
      <div class="card-title">⚠️ Low Margin Products (below 15%)</div>
      <p class="help-text" style="margin-bottom:8px">These products have dangerously low margins. Consider repricing or discontinuing.</p>
      ${renderMiniTable(lowMargin.map(p => [
        p.name, fmtMoney(p.revenue, baseCurrency()), fmtMoney(p.cost, baseCurrency()),
        `${p.margin.toFixed(1)}%`, badge(p.margin < 0 ? "LOSING" : "LOW", p.margin < 0 ? "badge-red" : "badge-yellow")
      ]), ["Product", "Revenue", "Cost", "Margin", "Status"])}
    </div>` : ""}

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🏆 Most Profitable Products</div>
      ${renderMiniTable(prodProfit.slice(0,10).map(p => [
        p.name, fmtMoney(p.revenue, baseCurrency()), fmtMoney(p.cost, baseCurrency()),
        fmtMoney(p.profit, baseCurrency()), `${p.margin.toFixed(1)}%`
      ]), ["Product", "Revenue", "Cost", "Profit", "Margin"])}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">📉 Least Profitable Products</div>
      ${renderMiniTable(prodProfit.slice(-10).reverse().map(p => [
        p.name, fmtMoney(p.revenue, baseCurrency()), fmtMoney(p.cost, baseCurrency()),
        fmtMoney(p.profit, baseCurrency()), `${p.margin.toFixed(1)}%`
      ]), ["Product", "Revenue", "Cost", "Profit", "Margin"])}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">📊 Profit by Category</div>
      ${renderMiniTable(catProfit.map(c => [
        c.name, fmtMoney(c.revenue, baseCurrency()), fmtMoney(c.cost, baseCurrency()),
        fmtMoney(c.profit, baseCurrency()), `${c.margin.toFixed(1)}%`
      ]), ["Category", "Revenue", "COGS", "Profit", "Margin"])}
    </div>

    <div class="card">
      <div class="card-title">💳 Expense Breakdown</div>
      ${renderMiniTable(
        Object.entries(d.expenseByCategory).sort((a,b) => b[1] - a[1]).map(([cat, amt]) => [
          cat, fmtMoney(amt, baseCurrency()), `${pct(amt, d.totalExpenses)}%`
        ]),
        ["Category", "Amount", "% of Total"]
      )}
    </div>
  `;
}

// =====================================================================
// 4. INVENTORY ANALYTICS
// =====================================================================
function renderInventory(el, d) {
  // Dead stock: products with no sales in 90 days but stock > 0
  const deadStock = d.products.filter(p => {
    const ps = d.prodSales[p.id];
    return (!ps || ps.qty === 0) && (d.stockMap[p.id] || 0) > 0;
  });

  // Fast/Slow moving
  const prodEntries = Object.entries(d.prodSales).sort((a,b) => b[1].qty - a[1].qty);
  const fastMoving = prodEntries.slice(0, 10);
  const slowMoving = prodEntries.filter(([_, p]) => p.qty > 0 && p.qty <= 5).slice(0, 10);

  // Inventory turnover = COGS / avg inventory
  const avgInventory = d.totalStockValue; // simplified
  const turnover = avgInventory > 0 ? (d.totalCOGS / avgInventory).toFixed(1) : "0.0";
  const daysOfInventory = turnover > 0 ? (365 / parseFloat(turnover)).toFixed(0) : "N/A";

  // Variance (from movements)
  const adjustments = d.movements.filter(m => m.type === "adjustment");
  const totalVariance = adjustments.reduce((a, m) => a + Math.abs(num(m.quantity)), 0);

  // Reserved = on order (pending POs)
  const reservedStock = d.pendingPOs.reduce((a, po) => {
    return a + (po.items || []).reduce((a2, it) => a2 + num(it.quantity_ordered || it.quantity), 0);
  }, 0);

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpi("📦", "Products", fmtN(d.products.length), { sub: `${d.outOfStock.length} out of stock` })}
      ${kpi("📊", "Stock Value (Cost)", fmtMoney(d.totalStockValue, baseCurrency()))}
      ${kpi("💰", "Stock Value (Retail)", fmtMoney(d.totalRetailValue, baseCurrency()))}
      ${kpi("🔄", "Turnover", `${turnover}x`, { sub: `${daysOfInventory} days of stock` })}
      ${kpi("⚠️", "Low Stock", fmtN(d.lowStock.length), { color: d.lowStock.length > 0 ? "var(--danger)" : "var(--success)" })}
      ${kpi("🚫", "Out of Stock", fmtN(d.outOfStock.length), { color: d.outOfStock.length > 0 ? "var(--danger)" : "var(--success)" })}
      ${kpi("💀", "Dead Stock", fmtN(deadStock.length), { color: deadStock.length > 0 ? "var(--warning)" : "var(--success)", sub: "No sales in 90d" })}
      ${kpi("📋", "Incoming", fmtN(reservedStock), { sub: `${d.pendingPOs.length} pending POs` })}
      ${kpi("🔄", "Adjustments", fmtN(adjustments.length), { sub: `${fmtN(totalVariance)} units total` })}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">🚀 Fast Moving (Top 10)</div>
        ${renderMiniTable(fastMoving.map(([_, p]) => [p.name, `${fmtN(p.qty)} units`, fmtMoney(p.revenue, baseCurrency())]), ["Product", "Qty Sold", "Revenue"])}
      </div>
      <div class="card">
        <div class="card-title">🐌 Slow Moving</div>
        ${renderMiniTable(slowMoving.map(([_, p]) => [p.name, `${fmtN(p.qty)} units`, fmtMoney(p.revenue, baseCurrency())]), ["Product", "Qty Sold", "Revenue"])}
      </div>
    </div>

    ${deadStock.length > 0 ? `
    <div class="card" style="margin-top:16px;border-left:3px solid var(--warning)">
      <div class="card-title">💀 Dead Stock (No Sales in 90 Days)</div>
      <p class="help-text" style="margin-bottom:8px">These products have stock but zero sales. Consider discounts, promotions, or discontinuing.</p>
      ${renderMiniTable(deadStock.slice(0,15).map(p => [
        p.name, `${fmtN(d.stockMap[p.id] || 0)} ${p.unit || "pc"}`,
        fmtMoney(p.cost_price, baseCurrency()), fmtMoney(p.selling_price, baseCurrency()),
        badge("DEAD", "badge-red")
      ]), ["Product", "Stock", "Cost", "Price", "Status"])}
    </div>` : ""}

    ${d.lowStock.length > 0 ? `
    <div class="card" style="margin-top:16px;border-left:3px solid var(--danger)">
      <div class="card-title">⚠️ Low Stock — Reorder Suggestions</div>
      ${renderMiniTable(d.lowStock.map(p => [
        p.name, `${fmtN(d.stockMap[p.id] || 0)} / ${p.reorder_level}`,
        badge("REORDER", "badge-red")
      ]), ["Product", "Stock / Reorder Level", "Action"])}
    </div>` : ""}

    <div class="card" style="margin-top:16px">
      <div class="card-title">📋 Full Inventory Valuation</div>
      ${renderMiniTable(
        d.products.filter(p => (d.stockMap[p.id] || 0) > 0).map(p => [
          p.name, `${fmtN(d.stockMap[p.id])} ${p.unit || "pc"}`,
          fmtMoney(p.cost_price, baseCurrency()),
          fmtMoney(p.selling_price, baseCurrency()),
          fmtMoney(num(p.cost_price) * (d.stockMap[p.id] || 0), baseCurrency()),
          fmtMoney(num(p.selling_price) * (d.stockMap[p.id] || 0), baseCurrency()),
        ]).sort((a,b) => b[4]?.localeCompare?.(a[4]) || 0),
        ["Product", "Stock", "Cost", "Price", "Cost Value", "Retail Value"]
      )}
    </div>
  `;
}

// =====================================================================
// 5. CUSTOMER ANALYTICS
// =====================================================================
function renderCustomers(el, d) {
  // LTV calculation
  const custData = d.customers.map(c => {
    const cs = d.custSales[c.id] || { count: 0, total: 0, first: null, last: null };
    const daysSinceFirst = cs.first ? Math.max(1, (Date.now() - new Date(cs.first).getTime()) / 86400000) : 1;
    const daysSinceLast = cs.last ? (Date.now() - new Date(cs.last).getTime()) / 86400000 : 999;
    const ltv = cs.total;
    const frequency = cs.count;
    const avgBasket = cs.count > 0 ? cs.total / cs.count : 0;
    return { ...c, ...cs, ltv, frequency, avgBasket, daysSinceFirst, daysSinceLast, daysSinceLast: Math.round(daysSinceLast) };
  }).sort((a, b) => b.ltv - a.ltv);

  // Segments
  const totalSpent = custData.reduce((a, c) => a + c.total, 0);
  const pareto80 = [];
  let cumulative = 0;
  for (const c of custData) {
    cumulative += c.total;
    pareto80.push(c);
    if (cumulative >= totalSpent * 0.8) break;
  }
  const vip = custData.filter(c => c.ltv > 0).slice(0, Math.max(1, Math.ceil(custData.filter(c => c.ltv > 0).length * 0.2)));
  const inactive = custData.filter(c => c.daysSinceLast > 60);
  const creditCustomers = custData.filter(c => num(c.balance) > 0);
  const totalAR = creditCustomers.reduce((a, c) => a + num(c.balance), 0);

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpi("👥", "Total Customers", fmtN(d.customers.length))}
      ${kpi("🌟", "VIP Customers", fmtN(vip.length), { sub: "Top 20% by spend" })}
      ${kpi("🔄", "Repeat Rate", d.customers.length > 0 ? `${pct(custData.filter(c => c.count > 1).length, d.customers.length))}%` : "N/A"}
      ${kpi("💤", "Inactive (60d+)", fmtN(inactive.length), { color: inactive.length > 0 ? "var(--warning)" : "var(--success)" })}
      ${kpi("💳", "Credit Customers", fmtN(creditCustomers.length), { sub: fmtMoney(totalAR, baseCurrency()) + " outstanding" })}
      ${kpi("🛒", "Avg Basket", fmtMoney(d.avgOrderValue, baseCurrency()))}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🏆 Customer Lifetime Value (Pareto 80/20)</div>
      <p class="help-text" style="margin-bottom:8px">Top ${pareto80.length} customers generate 80% of revenue (${fmtMoney(cumulative, baseCurrency())} of ${fmtMoney(totalSpent, baseCurrency())})</p>
      ${renderMiniTable(custData.slice(0,15).map((c, i) => [
        `${i < pareto80.length ? "⭐" : ""} ${c.name || "Walk-in"}`,
        fmtMoney(c.ltv, baseCurrency()),
        `${c.count} orders`,
        fmtMoney(c.avgBasket, baseCurrency()),
        `${c.daysSinceLast}d ago`,
        i < vip.length ? badge("VIP", "badge-green") : i < pareto80.length ? badge("80%", "badge-blue") : ""
      ]), ["Customer", "LTV", "Orders", "Avg Basket", "Last Order", "Segment"])}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">💤 Inactive Customers (No Order in 60+ Days)</div>
        ${inactive.length ? renderMiniTable(inactive.slice(0,10).map(c => [
          c.name || "—", fmtMoney(c.ltv, baseCurrency()), `${c.daysSinceLast}d ago`
        ]), ["Customer", "LTV", "Last Order"]) : '<div class="empty-state" style="padding:16px">No inactive customers</div>'}
      </div>
      <div class="card">
        <div class="card-title">💳 Credit Customers (Outstanding Balance)</div>
        ${creditCustomers.length ? renderMiniTable(creditCustomers.sort((a,b) => num(b.balance) - num(a.balance)).slice(0,10).map(c => [
          c.name || "—", fmtMoney(c.balance, baseCurrency()), fmtMoney(c.credit_limit, baseCurrency())
        ]), ["Customer", "Balance", "Credit Limit"]) : '<div class="empty-state" style="padding:16px">No credit customers</div>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">📊 Customer Segmentation</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
        <div style="flex:1;min-width:140px;padding:12px;background:var(--brand-light);border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:var(--brand)">${vip.length}</div>
          <div style="font-size:12px;color:var(--text-muted)">VIP (Top 20%)</div>
        </div>
        <div style="flex:1;min-width:140px;padding:12px;background:var(--info-light);border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:var(--info)">${custData.filter(c => c.count > 1 && !vip.includes(c)).length}</div>
          <div style="font-size:12px;color:var(--text-muted)">Regular</div>
        </div>
        <div style="flex:1;min-width:140px;padding:12px;background:var(--warning-light);border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:var(--warning)">${inactive.length}</div>
          <div style="font-size:12px;color:var(--text-muted)">Inactive</div>
        </div>
        <div style="flex:1;min-width:140px;padding:12px;background:var(--surface-2);border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:700">${d.customers.filter(c => !d.custSales[c.id]).length}</div>
          <div style="font-size:12px;color:var(--text-muted)">Never Purchased</div>
        </div>
      </div>
    </div>
  `;
}

// =====================================================================
// 6. SUPPLIER ANALYTICS
// =====================================================================
function renderSuppliers(el, d) {
  // Supplier spend from POs
  const supplierSpend = {};
  d.pos.forEach(po => {
    const sid = po.supplier_id || "unknown";
    if (!supplierSpend[sid]) supplierSpend[sid] = { count: 0, total: 0, pending: 0 };
    supplierSpend[sid].count++;
    supplierSpend[sid].total += num(po.total_cost);
    if (po.status === "pending" || po.status === "submitted") supplierSpend[sid].pending += num(po.total_cost);
  });

  const supRows = d.suppliers.map(s => ({
    ...s,
    spend: supplierSpend[s.id]?.total || 0,
    poCount: supplierSpend[s.id]?.count || 0,
    pending: supplierSpend[s.id]?.pending || 0,
  })).sort((a, b) => b.spend - a.spend);

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpi("🏢", "Suppliers", fmtN(d.suppliers.length))}
      ${kpi("💰", "Total Spend (90d)", fmtMoney(supRows.reduce((a, s) => a + s.spend, 0), baseCurrency()))}
      ${kpi("📋", "Purchase Orders", fmtN(d.pos.length), { sub: `${d.pendingPOs.length} pending` })}
      ${kpi("💳", "Outstanding Payables", fmtMoney(d.outstandingAP, baseCurrency()), { color: d.outstandingAP > 0 ? "var(--warning)" : "var(--success)" })}
    </div>

    <div class="card">
      <div class="card-title">🏆 Supplier Performance</div>
      ${renderMiniTable(supRows.map(s => [
        s.name || "—", fmtMoney(s.spend, baseCurrency()), `${s.poCount} POs`,
        fmtMoney(s.pending, baseCurrency()), fmtMoney(num(s.balance), baseCurrency())
      ]), ["Supplier", "Total Spend", "POs", "Pending Value", "Balance"])}
    </div>
  `;
}

// =====================================================================
// 7. FINANCIAL STATEMENTS
// =====================================================================
function renderFinancial(el, d) {
  const netProfit = d.totalRevenue90 - d.totalCOGS - d.totalExpenses;
  const gm = d.totalRevenue90 > 0 ? (d.grossProfit / d.totalRevenue90 * 100).toFixed(1) : "0.0";
  const nm = d.totalRevenue90 > 0 ? (netProfit / d.totalRevenue90 * 100).toFixed(1) : "0.0";

  // Cash collected (from sales)
  const cashCollected = d.allSales.filter(s => s.payment_status === "paid" || s.payment_method !== "credit")
    .reduce((a, s) => a + num(s.grand_total_base), 0);

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">📊 Income Statement (90 Days)</div>
      <div style="padding:16px">
        <table style="width:100%">
          <tr><td style="font-weight:600">Revenue</td><td style="text-align:right">${fmtMoney(d.totalRevenue90, baseCurrency())}</td></tr>
          <tr><td style="padding-left:20px">Cost of Goods Sold</td><td style="text-align:right;color:var(--danger)">(${fmtMoney(d.totalCOGS, baseCurrency())})</td></tr>
          <tr style="border-top:2px solid var(--border)"><td style="font-weight:700">Gross Profit</td><td style="text-align:right;font-weight:700;color:${d.grossProfit>=0?"var(--success)":"var(--danger)"}">${fmtMoney(d.grossProfit, baseCurrency())} (${gm}%)</td></tr>
          <tr><td style="padding-left:20px">Operating Expenses</td><td style="text-align:right;color:var(--danger)">(${fmtMoney(d.totalExpenses, baseCurrency())})</td></tr>
          <tr style="border-top:2px solid var(--border)"><td style="font-weight:700">Net Profit</td><td style="text-align:right;font-weight:700;color:${netProfit>=0?"var(--success)":"var(--danger)"}">${fmtMoney(netProfit, baseCurrency())} (${nm}%)</td></tr>
        </table>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">💳 Expense Breakdown</div>
        ${renderMiniTable(
          Object.entries(d.expenseByCategory).sort((a,b) => b[1] - a[1]).map(([cat, amt]) => [
            cat, fmtMoney(amt, baseCurrency()), `${pct(amt, d.totalExpenses)}%`
          ]),
          ["Category", "Amount", "%"]
        )}
      </div>
      <div class="card">
        <div class="card-title">💰 Revenue Breakdown</div>
        ${renderMiniTable(
          Object.entries(d.payMethods).map(([m, s]) => [m, fmtMoney(s.total, baseCurrency()), `${pct(s.total, d.totalRevenue90)}%`]),
          ["Method", "Amount", "%"]
        )}
      </div>
    </div>

    <div class="kpi-grid" style="margin-top:16px">
      ${kpi("💵", "Cash Collected", fmtMoney(cashCollected, baseCurrency()))}
      ${kpi("🏛️", "VAT Collected", fmtMoney(d.totalVat90, baseCurrency()))}
      ${kpi("💳", "Outstanding AR", fmtMoney(d.outstandingAR, baseCurrency()))}
      ${kpi("📄", "Outstanding AP", fmtMoney(d.outstandingAP, baseCurrency()))}
    </div>
  `;
}

// =====================================================================
// 7. TAX & EFRIS REPORT
// =====================================================================
function renderTax(el, d) {
  const taxBreakdown = {};
  d.allSales.forEach(s => (s.sale_items || []).forEach(it => {
    const code = it.tax_category_code || "VAT";
    if (!taxBreakdown[code]) taxBreakdown[code] = { qty: 0, net: 0, vat: 0 };
    const lineTotal = num(it.line_total || num(it.quantity) * num(it.unit_price));
    const vatAmt = num(it.vat_amount || 0);
    taxBreakdown[code].qty += num(it.quantity);
    taxBreakdown[code].net += lineTotal - vatAmt;
    taxBreakdown[code].vat += vatAmt;
  }));

  // Customer TIN coverage
  const custWithTIN = d.customers.filter(c => c.tin_number).length;
  const tinCoverage = d.customers.length > 0 ? (custWithTIN / d.customers.length * 100).toFixed(1) : "0.0";

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpi("🏛️", "VAT Collected (90d)", fmtMoney(d.totalVat90, baseCurrency()))}
      ${kpi("📋", "EFRIS Invoices", fmtN(d.efris.length), { sub: `${d.efrisAccepted} accepted` })}
      ${kpi("✅", "Accepted", fmtN(d.efrisAccepted), { color: "var(--success)" })}
      ${kpi("❌", "Rejected", fmtN(d.efrisRejected), { color: d.efrisRejected > 0 ? "var(--danger)" : "var(--success)" })}
      ${kpi("⏳", "Pending", fmtN(d.efrisPending))}
      ${kpi("💳", "TIN Coverage", `${tinCoverage}%`)}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🏛️ VAT Breakdown by Tax Category</div>
      ${renderMiniTable(
        Object.entries(taxBreakdown).map(([code, t]) => [
          code, fmtN(t.qty), fmtMoney(t.net, baseCurrency()), fmtMoney(t.vat, baseCurrency())
        ]),
        ["Tax Category", "Items", "Net Amount", "VAT"]
      )}
    </div>

    <div class="card">
      <div class="card-title">📋 EFRIS Invoice Status</div>
      ${renderMiniTable(
        d.efris.slice(0, 20).map(e => [
          e.invoice_number || e.id?.slice(0,8) || "—",
          fmtMoney(e.total_amount || e.grand_total, baseCurrency()),
          statusBadge(e.status, {
            accepted: badge("Accepted", "badge-green"),
            rejected: badge("Rejected", "badge-red"),
            pending: badge("Pending", "badge-yellow"),
            queued: badge("Queued", "badge-blue"),
          }),
          fmtDate(e.created_at),
        ]),
        ["Invoice", "Amount", "Status", "Date"]
      )}
    </div>

    ${d.efrisRejected > 0 ? `
    <div class="card" style="margin-top:16px;border-left:3px solid var(--danger)">
      <div class="card-title">⚠️ EFRIS Rejected Invoices</div>
      <p class="help-text">These invoices were rejected by URA. Check TIN validity and invoice data.</p>
      ${renderMiniTable(
        d.efris.filter(e => e.status === "rejected").map(e => [
          e.invoice_number || e.id?.slice(0,8) || "—",
          fmtMoney(e.total_amount || e.grand_total, baseCurrency()),
          e.error_message || "—",
          fmtDate(e.created_at),
        ]),
        ["Invoice", "Amount", "Error", "Date"]
      )}
    </div>` : ""}

    ${custWithTIN < d.customers.length ? `
    <div class="card" style="margin-top:16px;border-left:3px solid var(--warning)">
      <div class="card-title">⚠️ Missing Customer TINs</div>
      <p class="help-text">${d.customers.length - custWithTIN} customers are missing TIN numbers — required for EFRIS compliance.</p>
    </div>` : ""}
  `;
}

// =====================================================================
// 8. OPERATIONAL INSIGHTS
// =====================================================================
function renderOperations(el, d) {
  const issues = [];

  // Duplicate customers (by name or phone)
  const custByName = {};
  d.customers.forEach(c => {
    const key = (c.name || "").toLowerCase().trim();
    if (key) { if (!custByName[key]) custByName[key] = []; custByName[key].push(c); }
  });
  const dupCust = Object.values(custByName).filter(g => g.length > 1);
  if (dupCust.length) issues.push({ severity: "warning", title: "Duplicate Customers", detail: `${dupCust.length} groups of customers share the same name`, fix: "Merge duplicate records in Customers view" });

  // Duplicate products (by name)
  const prodByName = {};
  d.products.forEach(p => {
    const key = (p.name || "").toLowerCase().trim();
    if (key) { if (!prodByName[key]) prodByName[key] = []; prodByName[key].push(p); }
  });
  const dupProd = Object.values(prodByName).filter(g => g.length > 1);
  if (dupProd.length) issues.push({ severity: "warning", title: "Duplicate Products", detail: `${dupProd.length} groups of products share the same name`, fix: "Merge or rename duplicates in Inventory" });

  // Negative inventory
  const negStock = d.products.filter(p => (d.stockMap[p.id] || 0) < 0);
  if (negStock.length) issues.push({ severity: "critical", title: "Negative Inventory", detail: `${negStock.length} products have negative stock`, fix: "Run a stock count to correct" });

  // Price inconsistencies (cost > selling price)
  const badMargin = d.products.filter(p => num(p.cost_price) > num(p.selling_price) && num(p.selling_price) > 0);
  if (badMargin.length) issues.push({ severity: "critical", title: "Cost > Selling Price", detail: `${badMargin.length} products cost more than they sell for`, fix: "Review pricing immediately" });

  // Missing SKUs
  const noSKU = d.products.filter(p => !p.sku);
  if (noSKU.length) issues.push({ severity: "info", title: "Missing SKUs", detail: `${noSKU.length} products have no SKU`, fix: "Assign SKUs for barcode scanning" });

  // Products without category
  const noCat = d.products.filter(p => !p.category_id);
  if (noCat.length) issues.push({ severity: "info", title: "Uncategorized Products", detail: `${noCat.length} products have no category`, fix: "Assign categories for better reporting" });

  // Orphan stock movements (product deleted)
  // Check for missing stock movements after sales
  const salesWithItems = d.allSales.filter(s => s.sale_items?.length > 0);
  const missingMovements = salesWithItems.filter(s => {
    return !d.movements.some(m => m.reference === s.id?.toString() || m.type === "sale" && m.reference === s.id?.toString());
  });
  if (missingMovements.length > 0) issues.push({ severity: "warning", title: "Missing Stock Movements", detail: `${missingMovements.length} sales may lack corresponding stock movements`, fix: "Verify trigger trg_apply_sale_stock is active" });

  // Empty branches
  if (d.branches.length === 0) issues.push({ severity: "warning", title: "No Branches", detail: "No branches configured", fix: "Create at least one branch in Settings" });

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpi("🔍", "Issues Found", fmtN(issues.length), { color: issues.length > 0 ? "var(--warning)" : "var(--success)" })}
      ${kpi("🔴", "Critical", fmtN(issues.filter(i => i.severity === "critical").length), { color: issues.some(i => i.severity === "critical") ? "var(--danger)" : "var(--success)" })}
      ${kpi("🟡", "Warnings", fmtN(issues.filter(i => i.severity === "warning").length))}
      ${kpi("ℹ️", "Info", fmtN(issues.filter(i => i.severity === "info").length))}
    </div>

    <div class="card">
      <div class="card-title">🔍 Data Quality & Operations</div>
      ${issues.length ? `
        <div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">
          ${issues.map(i => `
            <div style="padding:12px;background:var(--surface-2);border-radius:8px;border-left:3px solid ${
              i.severity === "critical" ? "var(--danger)" : i.severity === "warning" ? "var(--warning)" : "var(--info)"
            }">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <div>
                  <b>${i.severity === "critical" ? "🔴" : i.severity === "warning" ? "🟡" : "ℹ️"} ${i.title}</b>
                  <div style="font-size:13px;color:var(--text-muted);margin-top:2px">${i.detail}</div>
                </div>
                <div style="font-size:12px;color:var(--brand);font-weight:500">${i.fix}</div>
              </div>
            </div>
          `).join("")}
        </div>
      ` : '<div class="empty-state" style="padding:24px">✅ No issues detected — data looks healthy!</div>'}
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-title">📊 Data Summary</div>
        <div style="display:flex;flex-direction:column;gap:6px;padding:8px 0">
          <div style="display:flex;justify-content:space-between"><span>Products</span><b>${fmtN(d.products.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Customers</span><b>${fmtN(d.customers.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Suppliers</span><b>${fmtN(d.suppliers.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Categories</span><b>${fmtN(d.categories.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Branches</span><b>${fmtN(d.branches.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Sales (90d)</span><b>${fmtN(d.allSales.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Stock Movements</span><b>${fmtN(d.movements.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Expenses</span><b>${fmtN(d.expenses.length)}</b></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🔗 Relationships</div>
        <div style="display:flex;flex-direction:column;gap:6px;padding:8px 0">
          <div style="display:flex;justify-content:space-between"><span>Products with Category</span><b>${fmtN(d.products.filter(p => p.category_id).length)}/${fmtN(d.products.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Products with Supplier</span><b>${fmtN(d.products.filter(p => p.supplier_id).length)}/${fmtN(d.products.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Products with SKU</span><b>${fmtN(d.products.filter(p => p.sku).length)}/${fmtN(d.products.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Customers with TIN</span><b>${fmtN(d.customers.filter(c => c.tin_number).length)}/${fmtN(d.customers.length)}</b></div>
          <div style="display:flex;justify-content:space-between"><span>Sales with Customer</span><b>${fmtN(d.allSales.filter(s => s.customer_id).length)}/${fmtN(d.allSales.length)}</b></div>
        </div>
      </div>
    </div>
  `;
}

// =====================================================================
// 9. AI INSIGHTS
// =====================================================================
function renderInsights(el, d) {
  const insights = [];
  const netProfit = d.totalRevenue90 - d.totalCOGS - d.totalExpenses;
  const gm = d.totalRevenue90 > 0 ? (d.grossProfit / d.totalRevenue90 * 100) : 0;

  // Revenue driver
  const topProd = Object.entries(d.prodSales).sort((a,b) => b[1].revenue - a[1].revenue)[0];
  if (topProd) insights.push({ icon: "💰", title: "Revenue Driver", body: `"${topProd[1].name}" is your top seller with ${fmtMoney(topProd[1].revenue, baseCurrency())} in revenue (${fmtN(topProd[1].qty)} units). Consider bundling or upselling related products.`, impact: "high" });

  // Discontinue candidates
  const deadStock = d.products.filter(p => (!d.prodSales[p.id] || d.prodSales[p.id].qty === 0) && (d.stockMap[p.id] || 0) > 0);
  if (deadStock.length) insights.push({ icon: "📦", title: "Discontinue Candidates", body: `${deadStock.length} products have stock but zero sales in 90 days. Consider running a clearance sale or discontinuing. Potential stock recovery: ${fmtMoney(deadStock.reduce((a,p) => a + num(p.cost_price) * (d.stockMap[p.id]||0), 0), baseCurrency())}.`, impact: "high" });

  // Loyalty rewards
  const vip = d.customers.filter(c => { const cs = d.custSales[c.id]; return cs && cs.count >= 3; }).sort((a,b) => (d.custSales[b.id]?.total||0) - (d.custSales[a.id]?.total||0)).slice(0,5);
  if (vip.length) insights.push({ icon: "🌟", title: "Loyalty Rewards", body: `Your top ${vip.length} repeat customers (${vip.map(c => c.name).join(", ")}) deserve recognition. Consider a loyalty program or exclusive discounts.`, impact: "medium" });

  // Reorder
  if (d.lowStock.length) insights.push({ icon: "🔄", title: "Reorder Urgently", body: `${d.lowStock.length} products are below reorder level. Top priority: ${d.lowStock.slice(0,3).map(p => `${p.name} (${stockFor(p.id)} left)`).join(", ")}.`, impact: "high" });

  // Money being lost
  const lossProducts = Object.values(d.prodSales).filter(p => p.revenue > 0 && p.revenue < p.cost);
  if (lossProducts.length) insights.push({ icon: "💸", title: "Money Being Lost", body: `${lossProducts.length} products are selling below cost: ${lossProducts.slice(0,3).map(p => p.name).join(", ")}. Total loss: ${fmtMoney(lossProducts.reduce((a,p) => a + p.cost - p.revenue, 0), baseCurrency())}.`, impact: "critical" });

  // Low margin
  const lowMargin = Object.values(d.prodSales).filter(p => p.revenue > 0 && (p.revenue - p.cost) / p.revenue < 0.15 && p.revenue > p.cost);
  if (lowMargin.length) insights.push({ icon: "⚠️", title: "Low Margin Products", body: `${lowMargin.length} products have margins below 15%. Consider increasing prices or reducing costs.`, impact: "medium" });

  // Opportunities
  if (d.customers.length > 0) {
    const neverPurchased = d.customers.filter(c => !d.custSales[c.id]);
    if (neverPurchased.length > 0) insights.push({ icon: "🎯", title: "Growth Opportunity", body: `${neverPurchased.length} customers have never made a purchase. Send a welcome offer or promotion to activate them.`, impact: "medium" });
  }

  // Cash flow risk
  if (d.outstandingAR > d.totalRevenueMonth * 0.5) insights.push({ icon: "💳", title: "Cash Flow Risk", body: `Outstanding receivables (${fmtMoney(d.outstandingAR, baseCurrency())}) exceed 50% of monthly revenue. Follow up on overdue payments.`, impact: "high" });

  // Expiry waste risk
  if (d.expiredBatches.length > 0) insights.push({ icon: "📅", title: "Expiry Waste Risk", body: `${d.expiredBatches.length} batches are expired with ${d.expiredBatches.reduce((a,b) => a + num(b.quantity), 0)} units. Write off or return immediately.`, impact: "high" });

  // Priority ordering
  const impactOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  insights.sort((a, b) => (impactOrder[a.impact] || 3) - (impactOrder[b.impact] || 3));

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;background:linear-gradient(135deg, var(--brand-light), var(--surface));border:1px solid var(--brand)">
      <div class="card-title">🤖 AI Business Insights</div>
      <p class="help-text">Actionable recommendations prioritized by business impact</p>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px">
      ${insights.map((ins, i) => `
        <div class="card" style="border-left:3px solid ${
          ins.impact === "critical" ? "var(--danger)" : ins.impact === "high" ? "var(--warning)" : "var(--info)"
        }">
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="font-size:24px;flex-shrink:0">${ins.icon}</div>
            <div style="flex:1">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <b>${ins.title}</b>
                ${badge(ins.impact.toUpperCase(), ins.impact === "critical" ? "badge-red" : ins.impact === "high" ? "badge-yellow" : "badge-blue")}
              </div>
              <div style="font-size:13px;color:var(--text-muted);margin-top:4px;line-height:1.5">${ins.body}</div>
            </div>
          </div>
        </div>
      `).join("")}
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">📋 Executive Summary</div>
      <div style="padding:12px;line-height:1.8">
        <p><b>What is driving revenue?</b> ${topProd ? `"${topProd[1].name}" leads with ${fmtMoney(topProd[1].revenue, baseCurrency())}.` : "No significant product data yet."}</p>
        <p><b>What should be discontinued?</b> ${deadStock.length ? `${deadStock.length} products with zero sales.` : "All products are generating sales."}</p>
        <p><b>Which customers deserve rewards?</b> ${vip.length ? `${vip.map(c=>c.name).join(", ")} with ${vip.length}+ repeat orders.` : "No repeat customers yet."}</p>
        <p><b>What needs reordering?</b> ${d.lowStock.length ? `${d.lowStock.length} products below reorder level.` : "Stock levels are healthy."}</p>
        <p><b>Where is money being lost?</b> ${lossProducts.length ? `${lossProducts.length} products selling below cost.` : "No loss-making products."}</p>
        <p><b>Cash flow risk?</b> ${d.outstandingAR > 0 ? `${fmtMoney(d.outstandingAR, baseCurrency())} in receivables.` : "No outstanding receivables."}</p>
      </div>
    </div>
  `;
}

// =====================================================================
// 10. FORECASTING
// =====================================================================
function renderForecasting(el, d) {
  // Simple linear regression on daily sales
  const daily = d.dailySales.filter(ds => ds.revenue > 0);
  let nextWeekRevenue = 0, nextMonthRevenue = 0;
  let confidence = "low";

  if (daily.length >= 7) {
    const n = daily.length;
    const sumX = daily.reduce((a, _, i) => a + i, 0);
    const sumY = daily.reduce((a, ds) => a + ds.revenue, 0);
    const sumXY = daily.reduce((a, ds, i) => a + i * ds.revenue, 0);
    const sumX2 = daily.reduce((a, _, i) => a + i * i, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
    const intercept = (sumY - slope * sumX) / n;
    const avgDaily = sumY / n;

    nextWeekRevenue = Math.max(0, avgDaily * 7 + slope * 21); // extrapolate
    nextMonthRevenue = Math.max(0, avgDaily * 30 + slope * 45);
    confidence = n >= 20 ? "medium" : "low";
  }

  // Stock depletion forecast
  const avgDailySales = daily.length > 0 ? daily.reduce((a, ds) => a + ds.count, 0) / daily.length : 0;
  const depletionDays = avgDailySales > 0 ? Math.round(Object.values(d.prodSales).reduce((a, p) => a + p.qty, 0) / daily.length / avgDailySales) : "N/A";

  // Products likely to stock out (below 2x daily average)
  const dailyProdSales = {};
  d.allSales.forEach(s => (s.sale_items || []).forEach(it => {
    dailyProdSales[it.product_id] = (dailyProdSales[it.product_id] || 0) + num(it.quantity);
  }));
  const avgDailyPerProduct = {};
  Object.entries(dailyProdSales).forEach(([pid, qty]) => {
    avgDailyPerProduct[pid] = qty / Math.max(1, daily.length);
  });

  const stockOutRisk = d.products.filter(p => {
    const dailyRate = avgDailyPerProduct[p.id] || 0;
    const stock = d.stockMap[p.id] || 0;
    return dailyRate > 0 && stock <= dailyRate * 7; // less than 7 days of stock
  }).map(p => ({
    ...p,
    dailyRate: avgDailyPerProduct[p.id] || 0,
    daysLeft: (d.stockMap[p.id] || 0) / (avgDailyPerProduct[p.id] || 1),
  })).sort((a, b) => a.daysLeft - b.daysLeft);

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpi("📈", "Next Week Forecast", fmtMoney(nextWeekRevenue, baseCurrency()), { sub: `Confidence: ${confidence}` })}
      ${kpi("📊", "Next Month Forecast", fmtMoney(nextMonthRevenue, baseCurrency()), { sub: `Confidence: ${confidence}` })}
      ${kpi("🔄", "Stock Depletion", `${depletionDays} days`, { sub: "At current rate" })}
      ${kpi("⚠️", "Stockout Risk", fmtN(stockOutRisk.length), { color: stockOutRisk.length > 0 ? "var(--danger)" : "var(--success)" })}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">📈 Revenue Forecast (30-Day Trend + Projection)</div>
      ${renderSparkline([
        ...d.dailySales.map(ds => ({ value: ds.revenue, label: ds.label })),
        ...Array.from({length: 7}, (_, i) => ({
          value: Math.max(0, (d.dailySales[d.dailySales.length-1]?.revenue || 0) + (i+1) * (d.revenueGrowth / 30) * (d.dailySales[d.dailySales.length-1]?.revenue || 0) / 100),
          label: `+${i+1}d`
        }))
      ])}
      <p class="help-text" style="margin-top:8px">Assumptions: Linear trend based on ${daily.length} days of data. Confidence: ${confidence}. Actual results may vary.</p>
    </div>

    ${stockOutRisk.length ? `
    <div class="card" style="margin-top:16px;border-left:3px solid var(--danger)">
      <div class="card-title">⚠️ Products Likely to Stock Out (Within 7 Days)</div>
      ${renderMiniTable(stockOutRisk.slice(0,10).map(p => [
        p.name,
        `${fmtN(d.stockMap[p.id] || 0)} ${p.unit || "pc"}`,
        `${p.dailyRate.toFixed(1)}/day`,
        `${p.daysLeft.toFixed(0)} days`,
        badge(p.daysLeft <= 3 ? "CRITICAL" : "SOON", p.daysLeft <= 3 ? "badge-red" : "badge-yellow"),
      ]), ["Product", "Current Stock", "Daily Rate", "Days Left", "Status"])}
    </div>` : ""}

    <div class="card" style="margin-top:16px">
      <div class="card-title">📋 Forecast Assumptions</div>
      <div style="padding:8px;font-size:13px;color:var(--text-muted);line-height:1.6">
        <ul style="margin:0;padding-left:20px">
          <li>Revenue forecast uses linear regression on ${daily.length} days of sales data</li>
          <li>Stock depletion assumes constant average daily sales rate</li>
          <li>Confidence level: ${confidence} (${daily.length} data points)</li>
          <li>Forecasts do not account for seasonality, promotions, or external factors</li>
          <li>For higher accuracy, maintain consistent daily sales records</li>
        </ul>
      </div>
    </div>
  `;
}

