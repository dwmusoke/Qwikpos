import { supabase, STATE, $, qsa, escapeHtml, toast, openModal, closeModal, fmtMoney, fmtDate } from "./uganda-pos-core.js";
import { logAuditAction } from "./uganda-pos-view-audit.js";

let orderFilter = "all";

export async function renderOrders(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Orders</h2><p class="sub">Manage customer orders and fulfillments</p></div>
      <button class="btn btn-primary" id="order-add-btn">+ New Order</button>
    </div>
    <div class="notif-filters" id="order-filters">
      ${["all", "pending", "processing", "completed", "cancelled"].map((f) =>
        `<button class="chip ${orderFilter === f ? "active" : ""}" data-filter="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</button>`
      ).join("")}
    </div>
    <div class="card">
      <div class="table-wrap" style="max-height:600px;overflow-y:auto;">
        <table>
          <thead><tr><th>Order #</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody id="orders-tbody"><tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  $("order-add-btn").addEventListener("click", () => openOrderModal());
  qsa("#order-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      orderFilter = btn.dataset.filter;
      qsa("#order-filters .chip").forEach((c) => c.classList.toggle("active", c === btn));
      loadOrders();
    });
  });
  await loadOrders();
}

async function loadOrders() {
  const tbody = $("orders-tbody");
  let query = supabase.from("orders").select("*, customers(name)").eq("business_id", STATE.business.id).order("created_at", { ascending: false });
  if (orderFilter !== "all") query = query.eq("status", orderFilter);
  const { data: orders } = await query;

  if (!orders || orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">No orders found</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map((o) => `
    <tr data-order-id="${o.id}">
      <td style="font-weight:700;font-family:var(--font-mono);">${escapeHtml(o.order_number || o.id.slice(0, 8))}</td>
      <td>${escapeHtml(o.customers?.name || "Walk-in")}</td>
      <td>${o.items_count || "—"}</td>
      <td style="font-weight:700;">${fmtMoney(o.total_base || 0)}</td>
      <td><span class="order-status-badge order-status-${o.status}">${o.status}</span></td>
      <td style="font-size:12px;color:var(--text-muted);">${fmtDate(o.created_at)}</td>
      <td>
        <button class="btn btn-sm btn-outline" data-action="view" data-id="${o.id}">View</button>
      </td>
    </tr>
  `).join("");

  qsa("[data-action=\"view\"]").forEach((btn) => {
    btn.addEventListener("click", () => viewOrder(orders.find((o) => o.id === btn.dataset.id)));
  });
}

function openOrderModal() {
  const customers = STATE.customers;
  const products = STATE.products;
  openModal(`
    <div class="modal-title-row"><h3>New Order</h3><button class="btn btn-ghost" data-close-modal>&times;</button></div>
    <form id="order-modal-form">
      <div class="field">
        <label>Customer</label>
        <select id="om-customer">
          <option value="">Walk-in Customer</option>
          ${customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Product</label>
        <select id="om-product">
          ${products.map((p) => `<option value="${p.id}" data-price="${p.price_base || 0}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label>Quantity</label><input id="om-qty" type="number" min="1" value="1" /></div>
        <div class="field"><label>Status</label><select id="om-status"><option value="pending">Pending</option><option value="processing">Processing</option><option value="completed">Completed</option></select></div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Create Order</button>
    </form>
  `);

  $("order-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const customer = $("om-customer").value;
    const product = $("om-product");
    const qty = parseInt($("om-qty").value) || 1;
    const status = $("om-status").value;
    const price = parseFloat(product.selectedOptions[0].dataset.price) || 0;
    const total = price * qty;

    const orderNum = `ORD-${Date.now().toString().slice(-6)}`;
    const { error } = await supabase.from("orders").insert({
      business_id: STATE.business.id,
      customer_id: customer || null,
      order_number: orderNum,
      status,
      total_base: total,
      items_count: qty,
      created_by: STATE.appUser.id,
    });
    if (error) { toast(error.message, "error"); return; }
    toast("Order created", "success");
    closeModal();
    await loadOrders();
  });
}

function viewOrder(order) {
  openModal(`
    <div class="modal-title-row"><h3>Order ${escapeHtml(order.order_number || order.id.slice(0, 8))}</h3><button class="btn btn-ghost" data-close-modal>&times;</button></div>
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
        <span class="text-muted">Customer</span><span>${escapeHtml(order.customers?.name || "Walk-in")}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
        <span class="text-muted">Status</span><span><span class="order-status-badge order-status-${order.status}">${order.status}</span></span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
        <span class="text-muted">Items</span><span>${order.items_count || "—"}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
        <span class="text-muted">Total</span><span style="font-weight:700;">${fmtMoney(order.total_base || 0)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;">
        <span class="text-muted">Date</span><span style="font-size:13px;">${fmtDate(order.created_at)}</span>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-outline" data-action="processing" data-id="${order.id}">Mark Processing</button>
      <button class="btn btn-primary" data-action="completed" data-id="${order.id}">Mark Completed</button>
      <button class="btn btn-danger" data-action="cancelled" data-id="${order.id}">Cancel</button>
    </div>
  `);

  qsa("[data-action]").forEach((btn) => {
    if (btn.dataset.closeModal !== undefined) return;
    btn.addEventListener("click", async () => {
      const { error } = await supabase.from("orders").update({ status: btn.dataset.action }).eq("id", btn.dataset.id);
      if (error) { toast(error.message, "error"); return; }
      toast("Order updated", "success");
      closeModal();
      await loadOrders();
    });
  });
}
