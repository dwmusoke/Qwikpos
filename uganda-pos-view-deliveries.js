// =====================================================================
// QWICKPOS — DELIVERY MANAGEMENT VIEW
// Track order deliveries, delivery persons, status updates
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
  fmtDate,
  sanitizeCsvValue,
} from "./uganda-pos-core.js";
import { logAuditAction } from "./uganda-pos-view-audit.js";

let activeTab = "list";
let deliveryPersons = [];

const STATUS_ICONS = {
  pending: "⏳",
  assigned: "👤",
  in_transit: "🚚",
  delivered: "✅",
  failed: "❌",
  returned: "↩️",
};
const STATUS_BADGES = {
  pending: "badge-yellow",
  assigned: "badge-blue",
  in_transit: "badge-purple",
  delivered: "badge-green",
  failed: "badge-red",
  returned: "badge-gray",
};

export async function renderDeliveries(root) {
  root.innerHTML = `<div class="empty-state">Loading deliveries…</div>`;

  const [{ data: deliveries }, { data: persons }] = await Promise.all([
    supabase
      .from("deliveries")
      .select("*, assigned_person:delivery_persons!assigned_to_id(full_name, phone)")
      .eq("business_id", STATE.business.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("delivery_persons")
      .select("*")
      .eq("business_id", STATE.business.id)
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const allDeliveries = deliveries || [];
  deliveryPersons = persons || [];

  root.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1 data-i18n="nav.deliveries">Delivery Management</h1>
        <p>${allDeliveries.length} deliveries</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="del-add">➕ New Delivery</button>
      </div>
    </div>
    <div class="notif-filters" id="del-tabs">
      ${[
        ["list", "📋 All"],
        ["pending", "⏳ Pending"],
        ["in_transit", "🚚 In Transit"],
        ["delivered", "✅ Delivered"],
        ["persons", "👤 Delivery Persons"],
      ]
        .map(
          ([k, l]) =>
            `<button class="chip ${activeTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`,
        )
        .join("")}
    </div>
    <div id="del-body"></div>
  `;

  root.querySelectorAll("#del-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root
        .querySelectorAll("#del-tabs .chip")
        .forEach((c) => c.classList.toggle("active", c === btn));
      renderDelTab(allDeliveries);
    });
  });

  $("del-add")?.addEventListener("click", () =>
    showDeliveryModal(null, allDeliveries),
  );
  renderDelTab(allDeliveries);
}

function renderDelTab(deliveries) {
  const body = $("del-body");
  if (!body) return;

  if (activeTab === "persons") {
    renderPersonsTab(body);
    return;
  }

  let filtered = deliveries;
  if (activeTab === "pending")
    filtered = deliveries.filter(
      (d) => d.status === "pending" || d.status === "assigned",
    );
  else if (activeTab === "in_transit")
    filtered = deliveries.filter((d) => d.status === "in_transit");
  else if (activeTab === "delivered")
    filtered = deliveries.filter((d) => d.status === "delivered");

  const stats = {
    pending: deliveries.filter((d) => d.status === "pending").length,
    in_transit: deliveries.filter((d) => d.status === "in_transit").length,
    delivered: deliveries.filter((d) => d.status === "delivered").length,
    failed: deliveries.filter((d) => d.status === "failed").length,
  };

  body.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi-card"><div class="label">Pending</div><div class="value" style="color:var(--warning);">${stats.pending}</div></div>
      <div class="kpi-card"><div class="label">In Transit</div><div class="value" style="color:#8b5cf6;">${stats.in_transit}</div></div>
      <div class="kpi-card"><div class="label">Delivered</div><div class="value" style="color:var(--brand);">${stats.delivered}</div></div>
      <div class="kpi-card"><div class="label">Failed</div><div class="value" style="color:var(--danger);">${stats.failed}</div></div>
    </div>
    <div class="card">
      ${
        filtered.length
          ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Delivery #</th><th>Status</th><th>Customer</th><th>Address</th><th>Assigned To</th><th>Est. Delivery</th><th>Actions</th></tr></thead>
          <tbody>
            ${filtered
              .map(
                (d) => `
              <tr>
                <td><b>${escapeHtml(d.delivery_number)}</b></td>
                <td><span class="badge ${STATUS_BADGES[d.status] || "badge-gray"}">${STATUS_ICONS[d.status] || ""} ${d.status}</span></td>
                <td>${escapeHtml(d.customer_id || "—")}</td>
                <td style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(d.delivery_address || "—")}</td>
                <td>${escapeHtml(d.assigned_person?.full_name || d.assigned_to || "—")}</td>
                <td>${d.estimated_delivery ? fmtDate(d.estimated_delivery) : "—"}</td>
                <td>
                  <button class="btn btn-secondary btn-xs" data-view-del="${d.id}">View</button>
                  ${d.status !== "delivered" && d.status !== "returned" ? `<button class="btn btn-primary btn-xs" data-update-del="${d.id}">Update</button>` : ""}
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table></div>
      `
          : '<div class="empty-state">No deliveries found.</div>'
      }
    </div>
  `;

  body.querySelectorAll("[data-view-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = deliveries.find((x) => x.id === btn.dataset.viewDel);
      if (d) showDeliveryDetail(d);
    });
  });
  body.querySelectorAll("[data-update-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = deliveries.find((x) => x.id === btn.dataset.updateDel);
      if (d) showUpdateStatusModal(d);
    });
  });
}

// ── DELIVERY PERSONS TAB ──────────────────────────────────────────────
function renderPersonsTab(body) {
  body.innerHTML = `
    <div class="page-header" style="margin-bottom:16px;">
      <div class="page-header-info">
        <h2>Delivery Persons</h2>
        <p>${deliveryPersons.length} active riders/drivers</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="dp-add">➕ Add Person</button>
      </div>
    </div>
    <div class="card">
      ${
        deliveryPersons.length
          ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${deliveryPersons
              .map(
                (p) => `
              <tr>
                <td><b>${escapeHtml(p.full_name)}</b></td>
                <td>${escapeHtml(p.phone || "—")}</td>
                <td><span class="badge badge-gray">${p.vehicle_type || "motorcycle"}</span></td>
                <td><span class="badge ${p.is_active ? "badge-green" : "badge-red"}">${p.is_active ? "Active" : "Inactive"}</span></td>
                <td>
                  <button class="btn btn-secondary btn-xs" data-edit-person="${p.id}">Edit</button>
                  <button class="btn btn-ghost btn-xs" data-toggle-person="${p.id}">${p.is_active ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table></div>
      `
          : '<div class="empty-state">No delivery persons yet. Add your first rider/driver.</div>'
      }
    </div>
  `;

  $("dp-add")?.addEventListener("click", () => showPersonModal(null));

  body.querySelectorAll("[data-edit-person]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = deliveryPersons.find((x) => x.id === btn.dataset.editPerson);
      if (p) showPersonModal(p);
    });
  });

  body.querySelectorAll("[data-toggle-person]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const p = deliveryPersons.find((x) => x.id === btn.dataset.togglePerson);
      if (!p) return;
      await supabase
        .from("delivery_persons")
        .update({ is_active: !p.is_active, updated_at: new Date().toISOString() })
        .eq("id", p.id);
      toast(`Person ${p.is_active ? "deactivated" : "activated"}`, "success");
      renderDeliveries($("del-body")?.parentElement);
    });
  });
}

function showPersonModal(existing) {
  const isEdit = !!existing;
  openModal(
    `
    <h3>${isEdit ? "Edit" : "Add"} Delivery Person</h3>
    <div class="field"><label>Full Name *</label><input id="dp-name" value="${escapeHtml(existing?.full_name || "")}" placeholder="e.g. John Doe" /></div>
    <div class="field-row">
      <div class="field"><label>Phone</label><input id="dp-phone" value="${escapeHtml(existing?.phone || "")}" placeholder="0700000000" /></div>
      <div class="field">
        <label>Vehicle Type</label>
        <select id="dp-vehicle">
          ${["motorcycle", "car", "van", "bicycle", "on_foot"]
            .map(
              (v) =>
                `<option value="${v}" ${existing?.vehicle_type === v ? "selected" : ""}>${v}</option>`,
            )
            .join("")}
        </select>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="dp-save">${isEdit ? "Update" : "Add"} Person</button>
    <button class="btn btn-secondary btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `,
    { large: true },
  );

  $("dp-save")?.addEventListener("click", async () => {
    const name = $("dp-name")?.value.trim();
    if (!name) {
      toast("Name is required", "error");
      return;
    }
    const payload = {
      full_name: name,
      phone: $("dp-phone")?.value.trim() || null,
      vehicle_type: $("dp-vehicle")?.value,
      business_id: STATE.business.id,
    };
    if (isEdit) {
      await supabase.from("delivery_persons").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      const { error } = await supabase.from("delivery_persons").insert(payload);
      if (error) {
        if (error.code === "23505") toast("Person already exists", "error");
        else toast("Error: " + error.message, "error");
        return;
      }
    }
    toast(`Person ${isEdit ? "updated" : "added"}`, "success");
    closeModal();
    renderDeliveries(document.querySelector("#view-root"));
  });
}

// ── DELIVERY MODAL (with person dropdown) ──────────────────────────────
function showDeliveryModal(existing, deliveries) {
  const isEdit = !!existing;
  openModal(
    `
    <h3>${isEdit ? "Edit" : "New"} Delivery</h3>
    <div class="field-row">
      <div class="field">
        <label>Related Sale</label>
        <input id="del-sale" value="${escapeHtml(existing?.sale_id || "")}" placeholder="Sale ID (optional)" />
      </div>
      <div class="field">
        <label>Priority</label>
        <select id="del-priority">
          <option value="normal" ${existing?.priority === "normal" ? "selected" : ""}>Normal</option>
          <option value="express" ${existing?.priority === "express" ? "selected" : ""}>Express</option>
          <option value="scheduled" ${existing?.priority === "scheduled" ? "selected" : ""}>Scheduled</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Customer</label><input id="del-customer" value="${escapeHtml(existing?.customer_id || "")}" /></div>
    <div class="field"><label>Delivery Address *</label><textarea id="del-address" rows="2">${escapeHtml(existing?.delivery_address || "")}</textarea></div>
    <div class="field-row">
      <div class="field">
        <label>Assigned To</label>
        <select id="del-assigned-id">
          <option value="">— Not assigned —</option>
          ${deliveryPersons
            .map(
              (p) =>
                `<option value="${p.id}" ${existing?.assigned_to_id === p.id ? "selected" : ""}>${escapeHtml(p.full_name)} ${p.phone ? `(${p.phone})` : ""}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="field"><label>Est. Delivery</label><input id="del-eta" type="datetime-local" value="${existing?.estimated_delivery ? new Date(existing.estimated_delivery).toISOString().slice(0, 16) : ""}" /></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="del-notes" rows="2">${escapeHtml(existing?.delivery_notes || "")}</textarea></div>
    <button class="btn btn-primary btn-block" id="del-save">${isEdit ? "Update" : "Create"} Delivery</button>
    <button class="btn btn-secondary btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `,
    { large: true },
  );

  $("del-save")?.addEventListener("click", async () => {
    const address = $("del-address")?.value.trim();
    if (!address) {
      toast("Delivery address is required", "error");
      return;
    }

    const { data: numData } = await supabase.rpc("next_delivery_number", {
      p_business_id: STATE.business.id,
    });

    const assignedId = $("del-assigned-id")?.value || null;
    const assignedPerson = deliveryPersons.find((p) => p.id === assignedId);

    const payload = {
      delivery_number: numData || "DEL-00001",
      sale_id: $("del-sale")?.value.trim() || null,
      customer_id: $("del-customer")?.value.trim() || null,
      delivery_address: address,
      assigned_to: assignedPerson?.full_name || null,
      assigned_to_id: assignedId,
      priority: $("del-priority")?.value,
      estimated_delivery: $("del-eta")?.value || null,
      delivery_notes: $("del-notes")?.value.trim(),
      business_id: STATE.business.id,
      branch_id: STATE.branch?.id,
      status: assignedId ? "assigned" : "pending",
    };

    if (isEdit) {
      await supabase.from("deliveries").update(payload).eq("id", existing.id);
      logAuditAction({
        action: "update",
        entityType: "delivery",
        entityId: existing.id,
        entityName: payload.delivery_number,
        newValue: payload,
      });
    } else {
      const { data, error } = await supabase
        .from("deliveries")
        .insert(payload)
        .select()
        .single();
      if (error) {
        toast("Error: " + error.message, "error");
        return;
      }
      logAuditAction({
        action: "create",
        entityType: "delivery",
        entityId: data?.id,
        entityName: payload.delivery_number,
        newValue: payload,
      });
    }
    toast(`Delivery ${isEdit ? "updated" : "created"}`, "success");
    closeModal();
    renderDeliveries(document.querySelector("#view-root"));
  });
}

function showUpdateStatusModal(delivery) {
  const nextStatuses = {
    pending: ["assigned", "cancelled"],
    assigned: ["in_transit", "pending"],
    in_transit: ["delivered", "failed"],
    failed: ["in_transit", "returned"],
  };
  const options = nextStatuses[delivery.status] || [];

  openModal(`
    <h3>Update Delivery Status</h3>
    <p>Current: <span class="badge ${STATUS_BADGES[delivery.status]}">${STATUS_ICONS[delivery.status]} ${delivery.status}</span></p>
    <div class="field">
      <label>New Status</label>
      <select id="del-new-status">
        ${options.map((s) => `<option value="${s}">${STATUS_ICONS[s] || ""} ${s}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Notes</label><textarea id="del-status-notes" rows="2"></textarea></div>
    <button class="btn btn-primary btn-block" id="del-status-save">Update Status</button>
    <button class="btn btn-secondary btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("del-status-save")?.addEventListener("click", async () => {
    const newStatus = $("del-new-status")?.value;
    if (!newStatus) return;
    const notes = $("del-status-notes")?.value.trim();

    const updatePayload = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === "delivered") {
      updatePayload.actual_delivery = new Date().toISOString();
    }

    await supabase.from("deliveries").update(updatePayload).eq("id", delivery.id);
    await supabase.from("delivery_status_log").insert({
      delivery_id: delivery.id,
      status: newStatus,
      notes,
      changed_by: STATE.appUser.full_name,
    });
    logAuditAction({
      action: "status_change",
      entityType: "delivery",
      entityId: delivery.id,
      entityName: delivery.delivery_number,
      oldValue: { status: delivery.status },
      newValue: { status: newStatus, notes },
    });
    toast("Status updated", "success");
    closeModal();
    renderDeliveries(document.querySelector("#view-root"));
  });
}

async function showDeliveryDetail(delivery) {
  const [{ data: log }, { data: items }] = await Promise.all([
    supabase
      .from("delivery_status_log")
      .select("*")
      .eq("delivery_id", delivery.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("delivery_items")
      .select("*")
      .eq("delivery_id", delivery.id),
  ]);

  const assignedName = delivery.assigned_person?.full_name || delivery.assigned_to || "—";

  openModal(
    `
    <h3>Delivery ${escapeHtml(delivery.delivery_number)}</h3>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0;">
      <div><b>Status:</b> <span class="badge ${STATUS_BADGES[delivery.status]}">${STATUS_ICONS[delivery.status]} ${delivery.status}</span></div>
      <div><b>Priority:</b> ${escapeHtml(delivery.priority || "normal")}</div>
      <div><b>Assigned To:</b> ${escapeHtml(assignedName)}</div>
      <div><b>Est. Delivery:</b> ${delivery.estimated_delivery ? fmtDate(delivery.estimated_delivery) : "—"}</div>
      ${delivery.actual_delivery ? `<div><b>Delivered At:</b> ${fmtDate(delivery.actual_delivery)}</div>` : ""}
    </div>
    <div style="margin-bottom:12px;"><b>Address:</b> ${escapeHtml(delivery.delivery_address || "—")}</div>
    ${delivery.delivery_notes ? `<div style="margin-bottom:12px;"><b>Notes:</b> ${escapeHtml(delivery.delivery_notes)}</div>` : ""}

    ${items && items.length ? `
    <b>Items:</b>
    <div class="table-wrap" style="margin-bottom:12px;"><table>
      <thead><tr><th>Product</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody>${items.map((it) => `<tr><td>${escapeHtml(it.product_name)}</td><td>${it.quantity}</td><td>${Number(it.unit_price).toLocaleString()}</td></tr>`).join("")}</tbody>
    </table></div>
    ` : ""}

    <b>Status History:</b>
    ${
      (log || []).length
        ? (log || [])
            .map(
              (l) => `
      <div style="padding:6px 0; border-bottom:1px solid var(--border); display:flex; justify-content:space-between;">
        <span><span class="badge badge-gray">${l.status}</span> ${escapeHtml(l.notes || "")}</span>
        <span style="font-size:11px; color:var(--text-muted);">${fmtDate(l.created_at)} by ${escapeHtml(l.changed_by || "")}</span>
      </div>
    `,
            )
            .join("")
        : '<div class="empty-state">No status history.</div>'
    }

    <button class="btn btn-secondary btn-block" data-close-modal style="margin-top:16px;">Close</button>
  `,
    { large: true },
  );
}
