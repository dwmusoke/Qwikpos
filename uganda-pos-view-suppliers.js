// =====================================================================
// QWICKPOS — SUPPLIERS VIEW (v2)
// Supplier management with ledger, PO history, payments
// =====================================================================
import {
  supabase,
  STATE,
  $,
  qsa,
  escapeHtml,
  toast,
  openModal,
  closeModal,
  fmtMoney,
  refreshSuppliers,
  fmtDate,
  emptyStateHtml,
} from "./uganda-pos-core.js";
import { logAuditAction } from "./uganda-pos-view-audit.js";

let supTab = "list";

export async function renderSuppliers(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Suppliers</h2><p class="sub">${STATE.suppliers.length} suppliers · ${STATE.suppliers.reduce((a, s) => a + Number(s.balance || 0), 0) > 0 ? "Outstanding: " + fmtMoney(STATE.suppliers.reduce((a, s) => a + Number(s.balance || 0), 0)) : "All clear"}</p></div>
    </div>

    <div class="admin-tabs" id="sup-tabs">
      <button class="admin-tab ${supTab === "list" ? "active" : ""}" data-tab="list">All Suppliers</button>
      <button class="admin-tab ${supTab === "ledger" ? "active" : ""}" data-tab="ledger">Payment Ledger</button>
      <button class="admin-tab ${supTab === "purchase" ? "active" : ""}" data-tab="purchase">Purchase Orders</button>
    </div>

    <div id="sup-tab-content"></div>
  `;

  qsa(".admin-tab", root).forEach((tab) => {
    tab.addEventListener("click", () => {
      supTab = tab.dataset.tab;
      qsa(".admin-tab", root).forEach((t) =>
        t.classList.toggle("active", t.dataset.tab === supTab),
      );
      renderSupTab();
    });
  });

  function renderSupTab() {
    const el = $("sup-tab-content");
    if (supTab === "list") renderSupListTab(el);
    else if (supTab === "ledger") renderLedgerTab(el);
    else if (supTab === "purchase") renderPOTab(el);
  }

  renderSupTab();
}

// ---------------------------------------------------------------------
// SUPPLIER LIST TAB
// ---------------------------------------------------------------------
function renderSupListTab(el) {
  el.innerHTML = `
    <div class="flex gap" style="margin-bottom:14px">
      <button class="btn btn-primary" id="add-supplier-btn">+ Add Supplier</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th>TIN</th><th>Balance Owed</th><th>POs</th><th></th></tr></thead>
        <tbody id="sup-table-body"></tbody>
      </table>
    </div>
  `;
  renderSupTable();
  $("add-supplier-btn")?.addEventListener("click", () => openSupplierModal());
}

async function renderSupTable() {
  const tbody = $("sup-table-body");
  if (!tbody) return;

  // Get PO counts per supplier
  const { data: poCounts } = await supabase
    .from("purchase_orders")
    .select("supplier_id, id")
    .eq("business_id", STATE.business.id);
  const poMap = {};
  (poCounts || []).forEach((po) => {
    poMap[po.supplier_id] = (poMap[po.supplier_id] || 0) + 1;
  });

  if (!STATE.suppliers.length) {
    tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml("🚚", "No Suppliers Yet", "Add your first supplier to start tracking purchase orders and supplier payments.", "+ Add Supplier", () => { document.querySelector('[data-route="suppliers"]')?.click(); setTimeout(() => openSupplierModal(), 100); })}</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.suppliers
    .map(
      (s) => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--brand-light);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--brand);">${escapeHtml((s.name || "?")[0])}</div>
          <div><b style="font-size:13px;">${escapeHtml(s.name)}</b><br><span style="font-size:11px;color:var(--text-muted);">${escapeHtml(s.contact_person || "—")}</span></div>
        </div>
      </td>
      <td style="font-size:12px;">${escapeHtml(s.phone || "—")}</td>
      <td style="font-size:12px;">${escapeHtml(s.email || "—")}</td>
      <td style="font-size:12px;">${escapeHtml(s.address || "—")}</td>
      <td><span class="badge ${Number(s.balance) > 0 ? "badge-yellow" : "badge-green"}">${fmtMoney(s.balance || 0)}</span></td>
      <td>${poMap[s.id] || 0}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" data-edit="${s.id}" title="Edit">✏️</button>
          <button class="btn btn-outline btn-sm" data-pay="${s.id}" title="Record Payment">💰</button>
          <button class="btn btn-sm btn-primary" data-view-sup="${s.id}" title="View">👁️</button>
          <button class="btn btn-outline btn-sm" data-share-sup="${s.id}" title="Share">📋</button>
          <button class="btn btn-outline btn-sm" data-delete-sup="${s.id}" title="Delete" style="color:var(--danger);">🗑️</button>
        </div>
      </td>
    </tr>`,
    )
    .join("");

  qsa("[data-edit]", tbody).forEach((b) =>
    b.addEventListener("click", () => openSupplierModal(b.dataset.edit)),
  );
  qsa("[data-pay]", tbody).forEach((b) =>
    b.addEventListener("click", () => openPaymentModal(b.dataset.pay)),
  );
  qsa("[data-view-sup]", tbody).forEach((b) =>
    b.addEventListener("click", () => openSupplierDetail(b.dataset.viewSup)),
  );
  qsa("[data-share-sup]", tbody).forEach((b) => b.addEventListener("click", () => {
    const s = STATE.suppliers.find((x) => x.id === b.dataset.shareSup);
    if (!s) return;
    const info = `Supplier: ${s.name}\nContact: ${s.contact_person || "—"}\nPhone: ${s.phone || "—"}\nEmail: ${s.email || "—"}\nTIN: ${s.tin || "—"}\nAddress: ${s.address || "—"}\nBalance: ${fmtMoney(s.balance || 0)}`;
    navigator.clipboard?.writeText(info).then(() => toast("Supplier info copied", "success"));
  }));
  qsa("[data-delete-sup]", tbody).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this supplier? This cannot be undone.")) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", b.dataset.deleteSup);
    if (error) { toast("Delete failed: " + error.message, "error"); return; }
    toast("Supplier deleted", "success");
    await refreshSuppliers();
    renderTable();
  }));
}

function openSupplierModal(supplierId) {
  const editing = !!supplierId;
  const s = editing ? STATE.suppliers.find((x) => x.id === supplierId) : {};
  openModal(
    `
    <div class="modal-title-row"><h3>${editing ? "Edit" : "Add"} Supplier</h3></div>
    <div class="field"><label>Supplier / Company Name *</label><input id="sf-name" value="${escapeHtml(s.name || "")}" /></div>
    <div class="field-row">
      <div class="field"><label>Contact Person</label><input id="sf-contact" value="${escapeHtml(s.contact_person || "")}" /></div>
      <div class="field"><label>Phone</label><input id="sf-phone" value="${escapeHtml(s.phone || "")}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Email</label><input id="sf-email" value="${escapeHtml(s.email || "")}" /></div>
      <div class="field"><label>TIN</label><input id="sf-tin" value="${escapeHtml(s.tin || "")}" /></div>
    </div>
    <div class="field"><label>Address</label><input id="sf-address" value="${escapeHtml(s.address || "")}" /></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-supplier-btn">${editing ? "Save Changes" : "Add Supplier"}</button>
    </div>
  `,
    {
      onMount: () => {
        $("save-supplier-btn").addEventListener("click", async () => {
          const name = $("sf-name").value.trim();
          if (!name) {
            toast("Supplier name is required", "error");
            return;
          }
          const record = {
            business_id: STATE.business.id,
            name,
            contact_person: $("sf-contact").value.trim() || null,
            phone: $("sf-phone").value.trim() || null,
            email: $("sf-email").value.trim() || null,
            tin: $("sf-tin").value.trim() || null,
            address: $("sf-address").value.trim() || null,
          };
          const query = editing
            ? supabase.from("suppliers").update(record).eq("id", supplierId)
            : supabase.from("suppliers").insert(record);
          const { error } = await query;
          if (error) {
            toast("Save failed: " + error.message, "error");
            return;
          }
          toast(editing ? "Supplier updated" : "Supplier added", "success");
          logAuditAction({
            action: editing ? "update" : "create",
            entityType: "supplier",
            entityId: editing ? supplierId : null,
            entityName: record.name,
            newValue: record,
          });
          closeModal();
          await refreshSuppliers();
          renderSupTable();
        });
      },
    },
  );
}

function openPaymentModal(supplierId) {
  const s = STATE.suppliers.find((x) => x.id === supplierId);
  openModal(
    `
    <div class="modal-title-row"><h3>Record Payment — ${escapeHtml(s.name)}</h3></div>
    <p class="help-text">Current balance owed: <b>${fmtMoney(s.balance || 0)}</b></p>
    <div class="field-row">
      <div class="field"><label>Amount (${STATE.business.base_currency})</label><input type="number" step="0.01" id="pf-amount" /></div>
      <div class="field"><label>Method</label>
        <select id="pf-method"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank Transfer</option></select>
      </div>
    </div>
    <div class="field"><label>Reference</label><input id="pf-ref" placeholder="Optional" /></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-payment-btn">Record Payment</button>
    </div>
  `,
    {
      onMount: () => {
        $("save-payment-btn").addEventListener("click", async () => {
          const amount = parseFloat($("pf-amount").value);
          if (!amount || amount <= 0) {
            toast("Enter a valid amount", "error");
            return;
          }
          await supabase.from("supplier_payments").insert({
            supplier_id: supplierId,
            amount,
            currency_code: STATE.business.base_currency,
            method: $("pf-method").value,
            reference: $("pf-ref").value || null,
          });
          await supabase
            .from("suppliers")
            .update({ balance: Math.max(0, Number(s.balance || 0) - amount) })
            .eq("id", supplierId);
          toast("Payment recorded", "success");
          closeModal();
          await refreshSuppliers();
          renderSupTable();
        });
      },
    },
  );
}

// ---------------------------------------------------------------------
// SUPPLIER DETAIL (inline view)
// ---------------------------------------------------------------------
async function openSupplierDetail(supplierId) {
  const s = STATE.suppliers.find((x) => x.id === supplierId);
  if (!s) return;

  const [{ data: payments }, { data: pos }] = await Promise.all([
    supabase
      .from("supplier_payments")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_orders")
      .select("*, items:purchase_order_items(*, product:products(name))")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false }),
  ]);

  openModal(
    `
    <div class="modal-title-row"><h3>${escapeHtml(s.name)}</h3><span class="text-muted">Supplier Detail</span></div>
    <div class="field-row" style="margin-bottom:16px">
      <div><b>Contact:</b> ${escapeHtml(s.contact_person || "—")}</div>
      <div><b>Phone:</b> ${escapeHtml(s.phone || "—")}</div>
      <div><b>Email:</b> ${escapeHtml(s.email || "—")}</div>
      <div><b>TIN:</b> ${escapeHtml(s.tin || "—")}</div>
      <div><b>Balance:</b> <span class="badge ${Number(s.balance) > 0 ? "badge-yellow" : "badge-green"}">${fmtMoney(s.balance || 0)}</span></div>
    </div>

    <h4 style="margin:0 0 8px">Payment History</h4>
    ${
      (payments || []).length
        ? `
      <div class="table-wrap" style="max-height:180px;overflow-y:auto;margin-bottom:16px">
        <table style="font-size:12px">
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>
            ${(payments || [])
              .map(
                (p) => `
              <tr>
                <td>${fmtDate(p.created_at)}</td>
                <td><b>${fmtMoney(p.amount)}</b></td>
                <td>${escapeHtml(p.method || "—")}</td>
                <td>${escapeHtml(p.reference || "—")}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `
        : '<p class="text-muted" style="margin-bottom:16px">No payments recorded.</p>'
    }

    <h4 style="margin:0 0 8px">Purchase Orders</h4>
    ${
      (pos || []).length
        ? (pos || [])
            .map(
              (po) => `
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
        <div class="flex between">
          <b>${escapeHtml(po.po_number)}</b>
          <span class="badge ${po.status === "received" ? "badge-green" : po.status === "cancelled" ? "badge-red" : "badge-blue"}">${po.status}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${fmtDate(po.created_at)}</div>
        ${(po.items || []).map((it) => `<div style="font-size:12px;margin-top:2px">${escapeHtml(it.product?.name || "—")} × ${it.quantity} @ ${fmtMoney(it.unit_cost)}</div>`).join("")}
      </div>
    `,
            )
            .join("")
        : '<p class="text-muted">No purchase orders.</p>'
    }
  `,
    { large: true },
  );
}

// ---------------------------------------------------------------------
// PAYMENT LEDGER TAB
// ---------------------------------------------------------------------
async function renderLedgerTab(el) {
  const { data: payments } = await supabase
    .from("supplier_payments")
    .select("*, supplier:suppliers(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  el.innerHTML = `
    <div class="card">
      <div class="card-title">All Supplier Payments</div>
      <div class="table-wrap" style="max-height:500px;overflow-y:auto">
        <table>
          <thead><tr><th>Date</th><th>Supplier</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>
            ${
              (payments || [])
                .map(
                  (p) => `
              <tr>
                <td>${fmtDate(p.created_at)}</td>
                <td><b>${escapeHtml(p.supplier?.name || "—")}</b></td>
                <td><b>${fmtMoney(p.amount)}</b></td>
                <td><span class="badge badge-blue">${escapeHtml(p.method || "—")}</span></td>
                <td>${escapeHtml(p.reference || "—")}</td>
              </tr>
            `,
                )
                .join("") ||
              '<tr><td colspan="5"><div class="empty-state">No payments recorded.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// PURCHASE ORDERS TAB
// ---------------------------------------------------------------------
async function renderPOTab(el) {
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select(
      "*, supplier:suppliers(name), items:purchase_order_items(*, product:products(name))",
    )
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  el.innerHTML = `
    <div class="flex gap" style="margin-bottom:14px">
      <button class="btn btn-primary" id="sup-new-po-btn">+ New Purchase Order</button>
    </div>
    ${(pos || []).length ? "" : '<div class="card"><div class="empty-state">No purchase orders yet.</div></div>'}
    ${(pos || [])
      .map((po) => {
        const total = (po.items || []).reduce(
          (a, it) => a + Number(it.unit_cost) * Number(it.quantity),
          0,
        );
        const statusColors = {
          draft: "badge-gray",
          ordered: "badge-blue",
          received: "badge-green",
          cancelled: "badge-red",
        };
        return `
        <div class="card" style="margin-bottom:12px">
          <div class="flex between" style="margin-bottom:8px">
            <div>
              <b>${escapeHtml(po.po_number)}</b>
              <span class="badge ${statusColors[po.status] || "badge-gray"}" style="margin-left:8px">${po.status}</span>
            </div>
            <div class="flex gap">
              ${po.status === "draft" ? `<button class="btn btn-sm btn-outline" data-receive-po="${po.id}">Mark Received</button>` : ""}
              ${po.status === "ordered" ? `<button class="btn btn-sm btn-primary" data-receive-po="${po.id}">Mark Received</button>` : ""}
            </div>
          </div>
          <div style="font-size:13px;margin-bottom:6px">Supplier: <b>${escapeHtml(po.supplier?.name || "—")}</b> · ${fmtDate(po.created_at)}</div>
          <table style="font-size:12px">
            <thead><tr><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
            <tbody>
              ${(po.items || [])
                .map(
                  (it) => `
                <tr>
                  <td>${escapeHtml(it.product?.name || "—")}</td>
                  <td>${it.quantity}</td>
                  <td>${fmtMoney(it.unit_cost)}</td>
                  <td>${fmtMoney(it.unit_cost * it.quantity)}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
            <tfoot>
              <tr style="font-weight:700;border-top:2px solid var(--text)"><td colspan="3">Total</td><td>${fmtMoney(total)}</td></tr>
            </tfoot>
          </table>
        </div>
      `;
      })
      .join("")}
  `;

  $("sup-new-po-btn")?.addEventListener("click", () => openPOModal());
  qsa("[data-receive-po]", el).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const poId = btn.dataset.receivePo;
      const po = (pos || []).find((p) => p.id === poId);

      // Add stock for received items
      if (po?.items) {
        for (const it of po.items) {
          const { data: stock } = await supabase
            .from("product_stock")
            .select("quantity")
            .eq("product_id", it.product_id)
            .eq("branch_id", STATE.branch?.id)
            .single();
          const current = Number(stock?.quantity || 0);
          await supabase.from("product_stock").upsert(
            {
              product_id: it.product_id,
              branch_id: STATE.branch.id,
              quantity: current + Number(it.quantity),
            },
            { onConflict: "product_id,branch_id" },
          );
          await supabase.from("stock_movements").insert({
            business_id: STATE.business.id,
            branch_id: STATE.branch.id,
            product_id: it.product_id,
            type: "in",
            quantity: it.quantity,
            notes: `PO received: ${po.po_number}`,
            created_by: STATE.appUser.id,
          });
        }
      }

      await supabase
        .from("purchase_orders")
        .update({ status: "received" })
        .eq("id", poId);
      toast("PO received — stock updated", "success");
      await refreshProducts();
      renderPOTab(el);
    });
  });
}

function openPOModal() {
  openModal(
    `
    <div class="modal-title-row"><h3>New Purchase Order</h3></div>
    <div class="field"><label>Supplier *</label>
      <select id="pos-supplier"><option value="">Select supplier…</option>${STATE.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Expected Delivery Date</label><input type="date" id="pos-date" /></div>
    <div id="pos-items" style="margin-bottom:12px"></div>
    <button class="btn btn-sm btn-outline" id="pos-add-item">+ Add Item</button>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="pos-save">Create PO</button>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        let items = [];
        const renderItems = () => {
          $("pos-items").innerHTML = items
            .map(
              (it, idx) => `
          <div class="field-row" style="margin-bottom:8px">
            <div class="field"><select data-po-product="${idx}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
              <option value="">Product…</option>
              ${STATE.products.map((p) => `<option value="${p.id}" ${it.productId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
            </select></div>
            <div class="field"><input type="number" step="0.01" data-po-qty="${idx}" placeholder="Qty" value="${it.qty || ""}" style="width:80px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" /></div>
            <div class="field"><input type="number" step="0.01" data-po-cost="${idx}" placeholder="Unit cost" value="${it.cost || ""}" style="width:100px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" /></div>
            <button class="btn btn-sm btn-danger" data-po-remove="${idx}">&times;</button>
          </div>
        `,
            )
            .join("");
          qsa("[data-po-product]", $("pos-items")).forEach((sel, i) => {
            sel.addEventListener("change", () => {
              items[i].productId = sel.value;
            });
          });
          qsa("[data-po-qty]", $("pos-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].qty = parseFloat(inp.value) || 0;
            });
          });
          qsa("[data-po-cost]", $("pos-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].cost = parseFloat(inp.value) || 0;
            });
          });
          qsa("[data-po-remove]", $("pos-items")).forEach((btn, i) => {
            btn.addEventListener("click", () => {
              items.splice(i, 1);
              renderItems();
            });
          });
        };

        $("pos-add-item").addEventListener("click", () => {
          items.push({ productId: "", qty: 1, cost: 0 });
          renderItems();
        });

        $("pos-save").addEventListener("click", async () => {
          const supplierId = $("pos-supplier").value;
          if (!supplierId) {
            toast("Select a supplier", "error");
            return;
          }
          if (!items.length || !items.some((it) => it.productId)) {
            toast("Add at least one item", "error");
            return;
          }

          const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
          const { data: po, error: poErr } = await supabase
            .from("purchase_orders")
            .insert({
              business_id: STATE.business.id,
              supplier_id: supplierId,
              po_number: poNumber,
              status: "draft",
              expected_date: $("pos-date").value || null,
              created_by: STATE.appUser.id,
            })
            .select()
            .single();

          if (poErr) {
            toast("Failed: " + poErr.message, "error");
            return;
          }

          for (const it of items) {
            if (!it.productId) continue;
            await supabase.from("purchase_order_items").insert({
              po_id: po.id,
              product_id: it.productId,
              quantity: it.qty,
              unit_cost: it.cost,
            });
          }

          // Update supplier balance
          const total = items.reduce((a, it) => a + it.qty * it.cost, 0);
          const sup = STATE.suppliers.find((s) => s.id === supplierId);
          await supabase
            .from("suppliers")
            .update({ balance: Number(sup?.balance || 0) + total })
            .eq("id", supplierId);

          toast("Purchase order created", "success");
          closeModal();
          renderPOTab($("sup-tab-content"));
        });
      },
    },
  );
}
