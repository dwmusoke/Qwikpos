// =====================================================================
// QWICKPOS — PURCHASES MODULE
// Purchase Orders, New PO, Purchase Requests, Purchase Returns
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
  fmtDate,
  sanitizeCsvValue,
  refreshProducts,
  stockFor,
} from "./uganda-pos-core.js";

let activeTab = "list";

export async function renderPurchasesModule(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2 data-i18n="nav.purchases">Purchases</h2><p class="sub">Manage purchase orders, requests & returns</p></div>
    </div>
    <div class="notif-filters" id="purchases-tabs">
      ${[
        ["list", "📋 Purchase List"],
        ["new", "➕ New Purchase Order"],
        ["requests", "📝 Purchase Requests"],
        ["returns", "🔄 Purchase Returns"],
      ]
        .map(
          ([k, l]) =>
            `<button class="chip ${activeTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`,
        )
        .join("")}
    </div>
    <div id="purchases-body"></div>
  `;

  root.querySelectorAll("#purchases-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root
        .querySelectorAll("#purchases-tabs .chip")
        .forEach((c) => c.classList.toggle("active", c === btn));
      renderTab();
    });
  });

  await renderTab();

  async function renderTab() {
    const body = $("purchases-body");
    if (activeTab === "list") await renderPOListTab(body);
    else if (activeTab === "new") {
      activeTab = "list";
      await renderPOListTab(body);
      openNewPOModal();
    } else if (activeTab === "requests") await renderRequestsTab(body);
    else if (activeTab === "returns") await renderPUReturnsTab(body);
  }
}

// ── PURCHASE ORDER LIST TAB ──────────────────────────────────────────
async function renderPOListTab(body) {
  body.innerHTML = `<div class="empty-state">Loading…</div>`;

  const { data: pos } = await supabase
    .from("purchase_orders")
    .select(
      "*, supplier:suppliers(name), items:purchase_order_items(*, product:products(name, unit))",
    )
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  const poList = pos || [];
  const statusColors = {
    draft: "badge-gray",
    ordered: "badge-blue",
    received: "badge-green",
    cancelled: "badge-red",
  };

  body.innerHTML = `
    <div class="card">
      <div class="field-row" style="align-items:end;">
        <div class="field" style="flex:2;"><label>Search</label><input id="po-search" placeholder="Search by PO number…" /></div>
        <div class="field"><label>Status</label>
          <select id="po-status-filter">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="ordered">Ordered</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button class="btn btn-primary" id="po-new-btn">+ New Purchase Order</button>
      </div>
    </div>
    <div id="po-list-body"></div>
  `;

  renderPORows();

  $("po-search").addEventListener("input", () => renderPORows());
  $("po-status-filter").addEventListener("change", () => renderPORows());
  $("po-new-btn").addEventListener("click", () => openNewPOModal());

  function renderPORows() {
    const search = ($("po-search")?.value || "").toLowerCase();
    const statusFilter = $("po-status-filter")?.value || "";
    let list = poList;
    if (search)
      list = list.filter((po) => po.po_number.toLowerCase().includes(search));
    if (statusFilter) list = list.filter((po) => po.status === statusFilter);

    if (!list.length) {
      $("po-list-body").innerHTML =
        `<div class="card"><div class="empty-state">No purchase orders found.</div></div>`;
      return;
    }

    $("po-list-body").innerHTML = list
      .map((po) => {
        const total = (po.items || []).reduce(
          (a, it) => a + Number(it.unit_cost) * Number(it.quantity),
          0,
        );
        return `
        <div class="card" style="margin-bottom:12px">
          <div class="flex between" style="margin-bottom:8px">
            <div>
              <b>${escapeHtml(po.po_number)}</b>
              <span class="badge ${statusColors[po.status] || "badge-gray"}" style="margin-left:8px">${po.status}</span>
            </div>
            <div class="flex gap">
              ${po.status === "draft" ? `<button class="btn btn-sm btn-outline" data-view-po="${po.id}">View</button><button class="btn btn-sm btn-primary" data-receive-po="${po.id}">Receive</button>` : ""}
              ${po.status === "ordered" ? `<button class="btn btn-sm btn-outline" data-view-po="${po.id}">View</button><button class="btn btn-sm btn-primary" data-receive-po="${po.id}">Receive</button>` : ""}
              ${po.status === "received" ? `<button class="btn btn-sm btn-outline" data-view-po="${po.id}">View</button><button class="btn btn-sm btn-outline" data-return-po="${po.id}">Return</button>` : ""}
              ${po.status === "draft" ? `<button class="btn btn-sm btn-danger" data-cancel-po="${po.id}">Cancel</button>` : ""}
            </div>
          </div>
          <div style="font-size:13px;margin-bottom:6px">Supplier: <b>${escapeHtml(po.supplier?.name || "—")}</b> · Created: ${fmtDate(po.created_at)}${po.expected_date ? " · Expected: " + escapeHtml(po.expected_date) : ""}</div>
          <table style="font-size:12px">
            <thead><tr><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
            <tbody>
              ${(po.items || [])
                .map(
                  (it) => `
                <tr>
                  <td>${escapeHtml(it.product?.name || "—")}</td>
                  <td>${it.quantity} ${escapeHtml(it.product?.unit || "pc")}</td>
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
      .join("");

    qsa("[data-view-po]", $("po-list-body")).forEach((btn) =>
      btn.addEventListener("click", () =>
        viewPODetail(btn.dataset.viewPo, poList),
      ),
    );
    qsa("[data-receive-po]", $("po-list-body")).forEach((btn) => {
      btn.addEventListener("click", () =>
        receivePO(btn.dataset.receivePo, poList),
      );
    });
    qsa("[data-cancel-po]", $("po-list-body")).forEach((btn) => {
      btn.addEventListener("click", () => cancelPO(btn.dataset.cancelPo));
    });
    qsa("[data-return-po]", $("po-list-body")).forEach((btn) => {
      btn.addEventListener("click", () =>
        initiatePUReturn(btn.dataset.returnPo, poList),
      );
    });
  }
}

// ── VIEW PO DETAIL ───────────────────────────────────────────────────
async function viewPODetail(poId, poList) {
  const po = poList.find((p) => p.id === poId);
  if (!po) return;

  const statusColors = {
    draft: "badge-gray",
    ordered: "badge-blue",
    received: "badge-green",
    cancelled: "badge-red",
  };
  const total = (po.items || []).reduce(
    (a, it) => a + Number(it.unit_cost) * Number(it.quantity),
    0,
  );

  // Check if any items have been returned
  const { data: returns } = await supabase
    .from("purchase_return_items")
    .select("*, return:purchase_returns!inner(status, business_id)")
    .eq("po_item_id", po.items?.map((it) => it.id) || [])
    .eq("return.business_id", STATE.business.id)
    .in("return.status", ["approved", "completed"]);

  const returnedByItem = {};
  (returns || []).forEach((r) => {
    returnedByItem[r.po_item_id] =
      (returnedByItem[r.po_item_id] || 0) + Number(r.quantity);
  });

  openModal(
    `
    <div class="modal-title-row"><h3>Purchase Order — ${escapeHtml(po.po_number)}</h3>
      <span class="badge ${statusColors[po.status] || "badge-gray"}">${po.status}</span>
    </div>
    <div class="field-row" style="margin-bottom:16px;font-size:13px;">
      <div><b>Supplier:</b> ${escapeHtml(po.supplier?.name || "—")}</div>
      <div><b>Created:</b> ${fmtDate(po.created_at)}</div>
      ${po.expected_date ? `<div><b>Expected:</b> ${escapeHtml(po.expected_date)}</div>` : ""}
    </div>
    <div class="table-wrap" style="max-height:300px;overflow-y:auto;">
      <table style="font-size:12px">
        <thead><tr><th>Product</th><th>Qty Ordered</th><th>Returned</th><th>Unit Cost</th><th>Total</th></tr></thead>
        <tbody>
          ${(po.items || [])
            .map((it) => {
              const ret = returnedByItem[it.id] || 0;
              return `<tr>
              <td>${escapeHtml(it.product?.name || "—")}</td>
              <td>${it.quantity} ${escapeHtml(it.product?.unit || "pc")}</td>
              <td>${ret > 0 ? `<span class="badge badge-yellow">${ret}</span>` : "—"}</td>
              <td>${fmtMoney(it.unit_cost)}</td>
              <td>${fmtMoney(it.unit_cost * it.quantity)}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
        <tfoot>
          <tr style="font-weight:700;border-top:2px solid var(--text)"><td colspan="4">Total</td><td>${fmtMoney(total)}</td></tr>
        </tfoot>
      </table>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Close</button>
      ${po.status === "received" ? `<button class="btn btn-primary btn-block" data-return-po="${po.id}">Initiate Return</button>` : ""}
    </div>
  `,
    {
      large: true,
      onMount: () => {
        qsa("[data-return-po]", $("active-modal-overlay")).forEach((btn) => {
          btn.addEventListener("click", () => {
            closeModal();
            initiatePUReturn(btn.dataset.returnPo, poList);
          });
        });
      },
    },
  );
}

// ── RECEIVE PO ───────────────────────────────────────────────────────
async function receivePO(poId, poList) {
  const po = poList.find((p) => p.id === poId);
  if (!po || !po.items?.length) return;

  if (!confirm(`Receive all items for ${po.po_number}? This will add stock.`))
    return;

  for (const it of po.items) {
    const { data: stock } = await supabase
      .from("product_stock")
      .select("quantity")
      .eq("product_id", it.product_id)
      .eq("branch_id", STATE.branch?.id)
      .maybeSingle();
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

  await supabase
    .from("purchase_orders")
    .update({ status: "received" })
    .eq("id", poId);
  toast("PO received — stock updated", "success");
  await refreshProducts();
  renderPOListTab($("purchases-body"));
}

// ── CANCEL PO ────────────────────────────────────────────────────────
async function cancelPO(poId) {
  if (!confirm("Cancel this purchase order?")) return;
  await supabase
    .from("purchase_orders")
    .update({ status: "cancelled" })
    .eq("id", poId);
  toast("PO cancelled", "success");
  renderPOListTab($("purchases-body"));
}

// ── NEW PURCHASE ORDER MODAL ─────────────────────────────────────────
async function openNewPOModal() {
  openModal(
    `
    <div class="modal-title-row"><h3>New Purchase Order</h3></div>
    <div class="field"><label>Supplier *</label>
      <select id="po-supplier">
        <option value="">Select supplier…</option>
        ${STATE.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Expected Delivery Date</label><input type="date" id="po-date" /></div>
    <div class="field"><label>Notes</label><input id="po-notes" placeholder="Optional notes…" /></div>
    <div style="margin-bottom:8px;"><b>Line Items</b></div>
    <div id="po-items" style="margin-bottom:8px;"></div>
    <div class="flex between" style="margin-bottom:12px;">
      <button class="btn btn-sm btn-outline" id="po-add-item">+ Add Item</button>
      <div id="po-total" style="font-weight:700;font-size:14px;"></div>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="po-save">Create Purchase Order</button>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        let items = [];

        function renderItems() {
          const total = items.reduce(
            (a, it) => a + (it.qty || 0) * (it.cost || 0),
            0,
          );
          $("po-total").textContent = `Total: ${fmtMoney(total)}`;

          $("po-items").innerHTML = items
            .map(
              (it, idx) => `
          <div class="field-row" style="margin-bottom:8px;align-items:end;">
            <div class="field" style="flex:3;">
              <select data-po-product="${idx}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
                <option value="">Select product…</option>
                ${STATE.products.map((p) => `<option value="${p.id}" ${it.productId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field" style="flex:1;">
              <input type="number" step="0.01" min="0" data-po-qty="${idx}" placeholder="Qty" value="${it.qty || ""}" style="width:80px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
            </div>
            <div class="field" style="flex:1;">
              <input type="number" step="0.01" min="0" data-po-cost="${idx}" placeholder="Unit cost" value="${it.cost || ""}" style="width:100px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
            </div>
            <div style="font-size:12px;min-width:90px;text-align:right;">${fmtMoney((it.qty || 0) * (it.cost || 0))}</div>
            <button class="btn btn-sm btn-danger" data-po-remove="${idx}">&times;</button>
          </div>
        `,
            )
            .join("");

          qsa("[data-po-product]", $("po-items")).forEach((sel, i) => {
            sel.addEventListener("change", () => {
              items[i].productId = sel.value;
              renderItems();
            });
          });
          qsa("[data-po-qty]", $("po-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].qty = parseFloat(inp.value) || 0;
              renderItems();
            });
          });
          qsa("[data-po-cost]", $("po-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].cost = parseFloat(inp.value) || 0;
              renderItems();
            });
          });
          qsa("[data-po-remove]", $("po-items")).forEach((btn, i) => {
            btn.addEventListener("click", () => {
              items.splice(i, 1);
              renderItems();
            });
          });
        }

        $("po-add-item").addEventListener("click", () => {
          items.push({ productId: "", qty: 1, cost: 0 });
          renderItems();
        });

        renderItems();

        $("po-save").addEventListener("click", async () => {
          const supplierId = $("po-supplier").value;
          if (!supplierId) {
            toast("Select a supplier", "error");
            return;
          }
          const validItems = items.filter((it) => it.productId && it.qty > 0);
          if (!validItems.length) {
            toast("Add at least one valid item", "error");
            return;
          }

          const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
          const { data: po, error: poErr } = await supabase
            .from("purchase_orders")
            .insert({
              business_id: STATE.business.id,
              branch_id: STATE.branch?.id || null,
              supplier_id: supplierId,
              po_number: poNumber,
              status: "draft",
              expected_date: $("po-date").value || null,
              created_by: STATE.appUser.id,
            })
            .select()
            .single();

          if (poErr) {
            toast("Failed: " + poErr.message, "error");
            return;
          }

          for (const it of validItems) {
            await supabase.from("purchase_order_items").insert({
              po_id: po.id,
              product_id: it.productId,
              quantity: it.qty,
              unit_cost: it.cost,
            });
          }

          const total = validItems.reduce((a, it) => a + it.qty * it.cost, 0);
          const sup = STATE.suppliers.find((s) => s.id === supplierId);
          await supabase
            .from("suppliers")
            .update({ balance: Number(sup?.balance || 0) + total })
            .eq("id", supplierId);

          toast("Purchase order created", "success");
          closeModal();
          renderPOListTab($("purchases-body"));
        });
      },
    },
  );
}

// ── PURCHASE REQUESTS TAB ────────────────────────────────────────────
async function renderRequestsTab(body) {
  body.innerHTML = `<div class="empty-state">Loading…</div>`;

  const { data: requests } = await supabase
    .from("purchase_requests")
    .select("*, items:purchase_request_items(*, product:products(name, unit))")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  const reqList = requests || [];
  const statusColors = {
    draft: "badge-gray",
    submitted: "badge-blue",
    approved: "badge-green",
    rejected: "badge-red",
    converted: "badge-purple",
  };

  body.innerHTML = `
    <div class="card">
      <div class="field-row" style="align-items:end;">
        <div class="field" style="flex:2;"><label>Search</label><input id="pr-search" placeholder="Search by request number…" /></div>
        <div class="field"><label>Status</label>
          <select id="pr-status-filter">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="converted">Converted</option>
          </select>
        </div>
        <button class="btn btn-primary" id="pr-new-btn">+ New Purchase Request</button>
      </div>
    </div>
    <div id="pr-list-body"></div>
  `;

  renderReqRows();

  $("pr-search").addEventListener("input", () => renderReqRows());
  $("pr-status-filter").addEventListener("change", () => renderReqRows());
  $("pr-new-btn").addEventListener("click", () => openNewRequestModal());

  function renderReqRows() {
    const search = ($("pr-search")?.value || "").toLowerCase();
    const statusFilter = $("pr-status-filter")?.value || "";
    let list = reqList;
    if (search)
      list = list.filter((r) =>
        (r.request_number || "").toLowerCase().includes(search),
      );
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);

    if (!list.length) {
      $("pr-list-body").innerHTML =
        `<div class="card"><div class="empty-state">No purchase requests found.</div></div>`;
      return;
    }

    $("pr-list-body").innerHTML = list
      .map((req) => {
        const total = (req.items || []).reduce(
          (a, it) =>
            a + Number(it.estimated_cost || 0) * Number(it.quantity || 0),
          0,
        );
        return `
        <div class="card" style="margin-bottom:12px">
          <div class="flex between" style="margin-bottom:8px">
            <div>
              <b>${escapeHtml(req.request_number || "—")}</b>
              <span class="badge ${statusColors[req.status] || "badge-gray"}" style="margin-left:8px">${req.status}</span>
            </div>
            <div class="flex gap">
              ${req.status === "draft" ? `<button class="btn btn-sm btn-primary" data-submit-req="${req.id}">Submit</button><button class="btn btn-sm btn-danger" data-del-req="${req.id}">Delete</button>` : ""}
              ${req.status === "submitted" ? `<button class="btn btn-sm btn-outline" data-approve-req="${req.id}">Approve</button><button class="btn btn-sm btn-danger" data-reject-req="${req.id}">Reject</button>` : ""}
              ${req.status === "approved" ? `<button class="btn btn-sm btn-primary" data-convert-req="${req.id}">Convert to PO</button>` : ""}
            </div>
          </div>
          <div style="font-size:13px;margin-bottom:6px;">${fmtDate(req.created_at)}${req.notes ? ` · ${escapeHtml(req.notes)}` : ""}</div>
          <table style="font-size:12px">
            <thead><tr><th>Product</th><th>Qty</th><th>Est. Cost</th><th>Total</th></tr></thead>
            <tbody>
              ${(req.items || [])
                .map(
                  (it) => `
                <tr>
                  <td>${escapeHtml(it.product?.name || "—")}</td>
                  <td>${it.quantity} ${escapeHtml(it.product?.unit || "pc")}</td>
                  <td>${fmtMoney(it.estimated_cost || 0)}</td>
                  <td>${fmtMoney((it.estimated_cost || 0) * (it.quantity || 0))}</td>
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
      .join("");

    qsa("[data-submit-req]", $("pr-list-body")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        await supabase
          .from("purchase_requests")
          .update({ status: "submitted" })
          .eq("id", btn.dataset.submitReq);
        toast("Request submitted", "success");
        renderRequestsTab(body);
      });
    });
    qsa("[data-approve-req]", $("pr-list-body")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        await supabase
          .from("purchase_requests")
          .update({
            status: "approved",
            approved_by: STATE.appUser.id,
            approved_at: new Date().toISOString(),
          })
          .eq("id", btn.dataset.approveReq);
        toast("Request approved", "success");
        renderRequestsTab(body);
      });
    });
    qsa("[data-reject-req]", $("pr-list-body")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Reject this purchase request?")) return;
        await supabase
          .from("purchase_requests")
          .update({ status: "rejected" })
          .eq("id", btn.dataset.rejectReq);
        toast("Request rejected", "success");
        renderRequestsTab(body);
      });
    });
    qsa("[data-convert-req]", $("pr-list-body")).forEach((btn) => {
      btn.addEventListener("click", () =>
        convertRequestToPO(btn.dataset.convertReq, reqList),
      );
    });
    qsa("[data-del-req]", $("pr-list-body")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this draft request?")) return;
        await supabase
          .from("purchase_request_items")
          .delete()
          .eq("request_id", btn.dataset.delReq);
        await supabase
          .from("purchase_requests")
          .delete()
          .eq("id", btn.dataset.delReq);
        toast("Request deleted", "success");
        renderRequestsTab(body);
      });
    });
  }
}

// ── NEW PURCHASE REQUEST MODAL ───────────────────────────────────────
async function openNewRequestModal() {
  openModal(
    `
    <div class="modal-title-row"><h3>New Purchase Request</h3></div>
    <div class="field"><label>Notes</label><input id="req-notes" placeholder="Reason or notes for this request…" /></div>
    <div style="margin-bottom:8px;"><b>Requested Items</b></div>
    <div id="req-items" style="margin-bottom:8px;"></div>
    <div class="flex between" style="margin-bottom:12px;">
      <button class="btn btn-sm btn-outline" id="req-add-item">+ Add Item</button>
      <div id="req-total" style="font-weight:700;font-size:14px;"></div>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="req-save">Create Request</button>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        let items = [];

        function renderItems() {
          const total = items.reduce(
            (a, it) => a + (it.qty || 0) * (it.cost || 0),
            0,
          );
          $("req-total").textContent = `Total: ${fmtMoney(total)}`;

          $("req-items").innerHTML = items
            .map(
              (it, idx) => `
          <div class="field-row" style="margin-bottom:8px;align-items:end;">
            <div class="field" style="flex:3;">
              <select data-req-product="${idx}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
                <option value="">Select product…</option>
                ${STATE.products.map((p) => `<option value="${p.id}" ${it.productId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field" style="flex:1;">
              <input type="number" step="0.01" min="0" data-req-qty="${idx}" placeholder="Qty" value="${it.qty || ""}" style="width:80px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
            </div>
            <div class="field" style="flex:1;">
              <input type="number" step="0.01" min="0" data-req-cost="${idx}" placeholder="Est. cost" value="${it.cost || ""}" style="width:100px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
            </div>
            <div style="font-size:12px;min-width:90px;text-align:right;">${fmtMoney((it.qty || 0) * (it.cost || 0))}</div>
            <button class="btn btn-sm btn-danger" data-req-remove="${idx}">&times;</button>
          </div>
        `,
            )
            .join("");

          qsa("[data-req-product]", $("req-items")).forEach((sel, i) => {
            sel.addEventListener("change", () => {
              items[i].productId = sel.value;
              renderItems();
            });
          });
          qsa("[data-req-qty]", $("req-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].qty = parseFloat(inp.value) || 0;
              renderItems();
            });
          });
          qsa("[data-req-cost]", $("req-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].cost = parseFloat(inp.value) || 0;
              renderItems();
            });
          });
          qsa("[data-req-remove]", $("req-items")).forEach((btn, i) => {
            btn.addEventListener("click", () => {
              items.splice(i, 1);
              renderItems();
            });
          });
        }

        $("req-add-item").addEventListener("click", () => {
          items.push({ productId: "", qty: 1, cost: 0 });
          renderItems();
        });

        renderItems();

        $("req-save").addEventListener("click", async () => {
          const validItems = items.filter((it) => it.productId && it.qty > 0);
          if (!validItems.length) {
            toast("Add at least one valid item", "error");
            return;
          }

          const reqNumber = `REQ-${Date.now().toString(36).toUpperCase()}`;
          const { data: req, error: reqErr } = await supabase
            .from("purchase_requests")
            .insert({
              business_id: STATE.business.id,
              branch_id: STATE.branch?.id || null,
              request_number: reqNumber,
              status: "draft",
              notes: $("req-notes").value.trim() || null,
              requested_by: STATE.appUser.id,
            })
            .select()
            .single();

          if (reqErr) {
            toast("Failed: " + reqErr.message, "error");
            return;
          }

          for (const it of validItems) {
            await supabase.from("purchase_request_items").insert({
              request_id: req.id,
              product_id: it.productId,
              quantity: it.qty,
              estimated_cost: it.cost,
            });
          }

          toast("Purchase request created", "success");
          closeModal();
          renderRequestsTab($("purchases-body"));
        });
      },
    },
  );
}

// ── CONVERT REQUEST TO PO ────────────────────────────────────────────
async function convertRequestToPO(reqId, reqList) {
  const req = reqList.find((r) => r.id === reqId);
  if (!req || !req.items?.length) return;

  openModal(
    `
    <div class="modal-title-row"><h3>Convert to Purchase Order</h3></div>
    <p class="help-text" style="margin-bottom:12px;">Converting request <b>${escapeHtml(req.request_number || "")}</b> to a purchase order.</p>
    <div class="field"><label>Supplier *</label>
      <select id="conv-supplier">
        <option value="">Select supplier…</option>
        ${STATE.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Expected Delivery Date</label><input type="date" id="conv-date" /></div>
    <div style="margin-bottom:8px;"><b>Items</b></div>
    <div id="conv-items" style="margin-bottom:8px;"></div>
    <div style="font-weight:700;font-size:14px;text-align:right;margin-bottom:12px;" id="conv-total"></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="conv-save">Create PO</button>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        let items = req.items.map((it) => ({
          productId: it.product_id,
          qty: Number(it.quantity) || 0,
          cost: Number(it.estimated_cost) || 0,
        }));

        function renderConvItems() {
          const total = items.reduce((a, it) => a + it.qty * it.cost, 0);
          $("conv-total").textContent = `Total: ${fmtMoney(total)}`;
          $("conv-items").innerHTML = items
            .map(
              (it, idx) => `
          <div class="field-row" style="margin-bottom:8px;align-items:end;">
            <div class="field" style="flex:3;">
              <select data-conv-product="${idx}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
                <option value="">Select product…</option>
                ${STATE.products.map((p) => `<option value="${p.id}" ${it.productId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field" style="flex:1;">
              <input type="number" step="0.01" min="0" data-conv-qty="${idx}" placeholder="Qty" value="${it.qty || ""}" style="width:80px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
            </div>
            <div class="field" style="flex:1;">
              <input type="number" step="0.01" min="0" data-conv-cost="${idx}" placeholder="Unit cost" value="${it.cost || ""}" style="width:100px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
            </div>
            <div style="font-size:12px;min-width:90px;text-align:right;">${fmtMoney(it.qty * it.cost)}</div>
            <button class="btn btn-sm btn-danger" data-conv-remove="${idx}">&times;</button>
          </div>
        `,
            )
            .join("");

          qsa("[data-conv-product]", $("conv-items")).forEach((sel, i) => {
            sel.addEventListener("change", () => {
              items[i].productId = sel.value;
              renderConvItems();
            });
          });
          qsa("[data-conv-qty]", $("conv-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].qty = parseFloat(inp.value) || 0;
              renderConvItems();
            });
          });
          qsa("[data-conv-cost]", $("conv-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].cost = parseFloat(inp.value) || 0;
              renderConvItems();
            });
          });
          qsa("[data-conv-remove]", $("conv-items")).forEach((btn, i) => {
            btn.addEventListener("click", () => {
              items.splice(i, 1);
              renderConvItems();
            });
          });
        }

        renderConvItems();

        $("conv-save").addEventListener("click", async () => {
          const supplierId = $("conv-supplier").value;
          if (!supplierId) {
            toast("Select a supplier", "error");
            return;
          }
          const validItems = items.filter((it) => it.productId && it.qty > 0);
          if (!validItems.length) {
            toast("Add at least one valid item", "error");
            return;
          }

          const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
          const { data: po, error: poErr } = await supabase
            .from("purchase_orders")
            .insert({
              business_id: STATE.business.id,
              branch_id: STATE.branch?.id || null,
              supplier_id: supplierId,
              po_number: poNumber,
              status: "draft",
              expected_date: $("conv-date").value || null,
              created_by: STATE.appUser.id,
            })
            .select()
            .single();

          if (poErr) {
            toast("Failed: " + poErr.message, "error");
            return;
          }

          for (const it of validItems) {
            await supabase.from("purchase_order_items").insert({
              po_id: po.id,
              product_id: it.productId,
              quantity: it.qty,
              unit_cost: it.cost,
            });
          }

          const total = validItems.reduce((a, it) => a + it.qty * it.cost, 0);
          const sup = STATE.suppliers.find((s) => s.id === supplierId);
          await supabase
            .from("suppliers")
            .update({ balance: Number(sup?.balance || 0) + total })
            .eq("id", supplierId);

          await supabase
            .from("purchase_requests")
            .update({ status: "converted" })
            .eq("id", reqId);

          toast("Request converted to PO", "success");
          closeModal();
          renderRequestsTab($("purchases-body"));
        });
      },
    },
  );
}

// ── PURCHASE RETURNS TAB ─────────────────────────────────────────────
async function renderPUReturnsTab(body) {
  body.innerHTML = `<div class="empty-state">Loading…</div>`;

  const { data: returns } = await supabase
    .from("purchase_returns")
    .select(
      "*, supplier:suppliers(name), po:purchase_orders(po_number), items:purchase_return_items(*, product:products(name, unit))",
    )
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  const retList = returns || [];
  const statusColors = {
    pending: "badge-yellow",
    approved: "badge-blue",
    completed: "badge-green",
    rejected: "badge-red",
  };

  body.innerHTML = `
    <div class="card">
      <div class="field-row" style="align-items:end;">
        <div class="field" style="flex:2;"><label>Search</label><input id="pret-search" placeholder="Search by return number…" /></div>
        <div class="field"><label>Status</label>
          <select id="pret-status-filter">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <button class="btn btn-primary" id="pret-init-btn">+ New Return</button>
      </div>
    </div>
    <div id="pret-list-body"></div>
  `;

  renderReturnRows();

  $("pret-search").addEventListener("input", () => renderReturnRows());
  $("pret-status-filter").addEventListener("change", () => renderReturnRows());
  $("pret-init-btn").addEventListener("click", () => openReturnSelectPOModal());

  function renderReturnRows() {
    const search = ($("pret-search")?.value || "").toLowerCase();
    const statusFilter = $("pret-status-filter")?.value || "";
    let list = retList;
    if (search)
      list = list.filter((r) =>
        (r.return_number || "").toLowerCase().includes(search),
      );
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);

    if (!list.length) {
      $("pret-list-body").innerHTML =
        `<div class="card"><div class="empty-state">No purchase returns found.</div></div>`;
      return;
    }

    $("pret-list-body").innerHTML = list
      .map(
        (ret) => `
      <div class="card" style="margin-bottom:12px">
        <div class="flex between" style="margin-bottom:8px">
          <div>
            <b>${escapeHtml(ret.return_number || "—")}</b>
            <span class="badge ${statusColors[ret.status] || "badge-gray"}" style="margin-left:8px">${ret.status}</span>
          </div>
          <div class="flex gap">
            ${ret.status === "pending" ? `<button class="btn btn-sm btn-outline" data-approve-ret="${ret.id}">Approve</button><button class="btn btn-sm btn-danger" data-reject-ret="${ret.id}">Reject</button>` : ""}
            ${ret.status === "approved" ? `<button class="btn btn-sm btn-primary" data-complete-ret="${ret.id}">Complete</button>` : ""}
          </div>
        </div>
        <div style="font-size:13px;margin-bottom:6px;">
          Supplier: <b>${escapeHtml(ret.supplier?.name || "—")}</b> · PO: ${escapeHtml(ret.po?.po_number || "—")} · ${fmtDate(ret.created_at)}
        </div>
        ${ret.reason ? `<div style="font-size:12px;margin-bottom:6px;color:var(--text-muted);">Reason: ${escapeHtml(ret.reason)}</div>` : ""}
        <table style="font-size:12px">
          <thead><tr><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Refund</th></tr></thead>
          <tbody>
            ${(ret.items || [])
              .map(
                (it) => `
              <tr>
                <td>${escapeHtml(it.product?.name || "—")}</td>
                <td>${it.quantity} ${escapeHtml(it.product?.unit || "pc")}</td>
                <td>${fmtMoney(it.unit_cost)}</td>
                <td>${fmtMoney(it.refund_amount || 0)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr style="font-weight:700;border-top:2px solid var(--text)"><td colspan="3">Total Refund</td><td>${fmtMoney(ret.refund_amount || 0)}</td></tr>
          </tfoot>
        </table>
      </div>
    `,
      )
      .join("");

    qsa("[data-approve-ret]", $("pret-list-body")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        await supabase
          .from("purchase_returns")
          .update({ status: "approved" })
          .eq("id", btn.dataset.approveRet);
        toast("Return approved", "success");
        renderPUReturnsTab(body);
      });
    });
    qsa("[data-reject-ret]", $("pret-list-body")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Reject this return?")) return;
        await supabase
          .from("purchase_returns")
          .update({ status: "rejected" })
          .eq("id", btn.dataset.rejectRet);
        toast("Return rejected", "success");
        renderPUReturnsTab(body);
      });
    });
    qsa("[data-complete-ret]", $("pret-list-body")).forEach((btn) => {
      btn.addEventListener("click", () =>
        completePUReturn(btn.dataset.completeRet, retList),
      );
    });
  }
}

// ── INITIATE PURCHASE RETURN ─────────────────────────────────────────
async function initiatePUReturn(poId, poList) {
  const po = poId ? poList.find((p) => p.id === poId) : null;

  if (poId && !po) {
    toast("Purchase order not found", "error");
    return;
  }

  // If no PO passed, show PO selector
  if (!po) {
    openReturnSelectPOModal();
    return;
  }

  openReturnItemModal(po);
}

async function openReturnSelectPOModal() {
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select(
      "*, supplier:suppliers(name), items:purchase_order_items(*, product:products(name, unit))",
    )
    .eq("business_id", STATE.business.id)
    .in("status", ["received", "ordered"])
    .order("created_at", { ascending: false });

  const poList = pos || [];
  if (!poList.length) {
    toast("No received/ordered POs available for return", "error");
    return;
  }

  openModal(
    `
    <div class="modal-title-row"><h3>Select Purchase Order</h3></div>
    <p class="help-text" style="margin-bottom:12px;">Choose a PO to return items from.</p>
    <div class="field"><label>Purchase Order *</label>
      <select id="ret-po-select">
        <option value="">Select PO…</option>
        ${poList
          .map((po) => {
            const total = (po.items || []).reduce(
              (a, it) => a + Number(it.unit_cost) * Number(it.quantity),
              0,
            );
            return `<option value="${po.id}">${escapeHtml(po.po_number)} — ${escapeHtml(po.supplier?.name || "—")} — ${fmtMoney(total)}</option>`;
          })
          .join("")}
      </select>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="ret-po-go">Continue</button>
    </div>
  `,
    {
      onMount: () => {
        $("ret-po-go").addEventListener("click", () => {
          const selectedId = $("ret-po-select").value;
          if (!selectedId) {
            toast("Select a purchase order", "error");
            return;
          }
          const selectedPO = poList.find((p) => p.id === selectedId);
          closeModal();
          openReturnItemModal(selectedPO);
        });
      },
    },
  );
}

async function openReturnItemModal(po) {
  openModal(
    `
    <div class="modal-title-row"><h3>Return Items — ${escapeHtml(po.po_number)}</h3></div>
    <p class="help-text" style="margin-bottom:12px;">Supplier: <b>${escapeHtml(po.supplier?.name || "—")}</b>. Select items and quantities to return.</p>
    <div class="field"><label>Reason for Return</label><input id="ret-reason" placeholder="e.g. Damaged, wrong item, excess…" /></div>
    <div id="ret-items" style="margin-bottom:12px;"></div>
    <div style="font-weight:700;font-size:14px;text-align:right;margin-bottom:12px;" id="ret-total">Refund Total: UGX 0</div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="ret-save">Submit Return</button>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        let retItems = (po.items || []).map((it) => ({
          poItemId: it.id,
          productId: it.product_id,
          productName: it.product?.name || "—",
          unit: it.product?.unit || "pc",
          maxQty: Number(it.quantity) || 0,
          unitCost: Number(it.unit_cost) || 0,
          returnQty: 0,
        }));

        function renderRetItems() {
          const total = retItems.reduce(
            (a, it) => a + it.returnQty * it.unitCost,
            0,
          );
          $("ret-total").textContent = `Refund Total: ${fmtMoney(total)}`;

          $("ret-items").innerHTML = retItems
            .map(
              (it, idx) => `
          <div class="field-row" style="margin-bottom:8px;align-items:end;">
            <div class="field" style="flex:3;">
              <label style="font-size:12px;">${escapeHtml(it.productName)} <span class="text-muted">(ordered: ${it.maxQty})</span></label>
            </div>
            <div class="field" style="flex:1;">
              <label style="font-size:12px;">Return Qty</label>
              <input type="number" step="0.01" min="0" max="${it.maxQty}" data-ret-qty="${idx}" value="${it.returnQty}" style="width:80px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
            </div>
            <div style="font-size:12px;min-width:90px;text-align:right;padding-top:18px;">${fmtMoney(it.returnQty * it.unitCost)}</div>
          </div>
        `,
            )
            .join("");

          qsa("[data-ret-qty]", $("ret-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              let val = parseFloat(inp.value) || 0;
              if (val > retItems[i].maxQty) val = retItems[i].maxQty;
              if (val < 0) val = 0;
              retItems[i].returnQty = val;
              renderRetItems();
            });
          });
        }

        renderRetItems();

        $("ret-save").addEventListener("click", async () => {
          const reason = $("ret-reason").value.trim();
          const validItems = retItems.filter((it) => it.returnQty > 0);
          if (!validItems.length) {
            toast("Select at least one item to return", "error");
            return;
          }

          const totalRefund = validItems.reduce(
            (a, it) => a + it.returnQty * it.unitCost,
            0,
          );

          // Generate return number
          const { data: rnData } = await supabase.rpc(
            "next_purchase_return_number",
          );
          const returnNumber =
            rnData || `PR-${Date.now().toString(36).toUpperCase()}`;

          const { data: ret, error: retErr } = await supabase
            .from("purchase_returns")
            .insert({
              business_id: STATE.business.id,
              branch_id: STATE.branch?.id || null,
              purchase_order_id: po.id,
              supplier_id: po.supplier_id,
              return_number: returnNumber,
              reason: reason || null,
              refund_amount: totalRefund,
              status: "pending",
              created_by: STATE.appUser.id,
            })
            .select()
            .single();

          if (retErr) {
            toast("Failed: " + retErr.message, "error");
            return;
          }

          for (const it of validItems) {
            await supabase.from("purchase_return_items").insert({
              return_id: ret.id,
              po_item_id: it.poItemId,
              product_id: it.productId,
              quantity: it.returnQty,
              unit_cost: it.unitCost,
              refund_amount: it.returnQty * it.unitCost,
            });
          }

          // Deduct stock for returned items
          for (const it of validItems) {
            const { data: stock } = await supabase
              .from("product_stock")
              .select("quantity")
              .eq("product_id", it.productId)
              .eq("branch_id", STATE.branch?.id)
              .maybeSingle();
            const current = Number(stock?.quantity || 0);
            const newQty = Math.max(0, current - it.returnQty);
            await supabase.from("product_stock").upsert(
              {
                product_id: it.productId,
                branch_id: STATE.branch.id,
                quantity: newQty,
              },
              { onConflict: "product_id,branch_id" },
            );
            await supabase.from("stock_movements").insert({
              business_id: STATE.business.id,
              branch_id: STATE.branch.id,
              product_id: it.productId,
              type: "out",
              quantity: it.returnQty,
              notes: `Purchase return: ${returnNumber}`,
              created_by: STATE.appUser.id,
            });
          }

          // Update supplier balance (reduce by refund amount)
          const sup = STATE.suppliers.find((s) => s.id === po.supplier_id);
          if (sup) {
            await supabase
              .from("suppliers")
              .update({
                balance: Math.max(0, Number(sup.balance || 0) - totalRefund),
              })
              .eq("id", po.supplier_id);
          }

          toast(
            `Return created — ${fmtMoney(totalRefund)} refund pending`,
            "success",
          );
          closeModal();
          await refreshProducts();
          renderPUReturnsTab($("purchases-body"));
        });
      },
    },
  );
}

// ── COMPLETE PURCHASE RETURN (finalize refund) ───────────────────────
async function completePUReturn(retId, retList) {
  const ret = retList.find((r) => r.id === retId);
  if (!ret) return;

  if (
    !confirm(
      `Complete return ${ret.return_number}? This will finalize the refund of ${fmtMoney(ret.refund_amount || 0)}.`,
    )
  )
    return;

  await supabase
    .from("purchase_returns")
    .update({ status: "completed" })
    .eq("id", retId);
  toast("Return completed", "success");
  renderPUReturnsTab($("purchases-body"));
}
