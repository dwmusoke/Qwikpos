// =====================================================================
// QWICKPOS — DELIVERY MANAGEMENT VIEW
// Track order deliveries, status updates
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

  const { data: deliveries } = await supabase
    .from("deliveries")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const allDeliveries = deliveries || [];

  root.innerHTML = `
    <div class="view-header">
      <div><h2 data-i18n="nav.deliveries">Delivery Management</h2><p class="sub">${allDeliveries.length} deliveries</p></div>
      <button class="btn btn-primary btn-sm" id="del-add">➕ New Delivery</button>
    </div>
    <div class="notif-filters" id="del-tabs">
      ${[
        ["list", "📋 All"],
        ["pending", "⏳ Pending"],
        ["in_transit", "🚚 In Transit"],
        ["delivered", "✅ Delivered"],
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
                <td>${escapeHtml(d.assigned_to || "—")}</td>
                <td>${d.estimated_delivery ? fmtDate(d.estimated_delivery) : "—"}</td>
                <td>
                  <button class="btn btn-outline btn-xs" data-view-del="${d.id}">View</button>
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
      <div class="field"><label>Assigned To</label><input id="del-assigned" value="${escapeHtml(existing?.assigned_to || "")}" placeholder="Delivery person name" /></div>
      <div class="field"><label>Est. Delivery</label><input id="del-eta" type="datetime-local" value="${existing?.estimated_delivery ? new Date(existing.estimated_delivery).toISOString().slice(0, 16) : ""}" /></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="del-notes" rows="2">${escapeHtml(existing?.delivery_notes || "")}</textarea></div>
    <button class="btn btn-primary btn-block" id="del-save">${isEdit ? "Update" : "Create"} Delivery</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
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

    const payload = {
      delivery_number: numData || "DEL-00001",
      sale_id: $("del-sale")?.value.trim() || null,
      customer_id: $("del-customer")?.value.trim() || null,
      delivery_address: address,
      assigned_to: $("del-assigned")?.value.trim(),
      priority: $("del-priority")?.value,
      estimated_delivery: $("del-eta")?.value || null,
      delivery_notes: $("del-notes")?.value.trim(),
      business_id: STATE.business.id,
      branch_id: STATE.branch?.id,
      status: "pending",
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
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("del-status-save")?.addEventListener("click", async () => {
    const newStatus = $("del-new-status")?.value;
    if (!newStatus) return;
    const notes = $("del-status-notes")?.value.trim();

    await supabase
      .from("deliveries")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", delivery.id);
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
  });
}

async function showDeliveryDetail(delivery) {
  const { data: log } = await supabase
    .from("delivery_status_log")
    .select("*")
    .eq("delivery_id", delivery.id)
    .order("created_at", { ascending: false });

  openModal(
    `
    <h3>Delivery ${escapeHtml(delivery.delivery_number)}</h3>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0;">
      <div><b>Status:</b> <span class="badge ${STATUS_BADGES[delivery.status]}">${STATUS_ICONS[delivery.status]} ${delivery.status}</span></div>
      <div><b>Priority:</b> ${escapeHtml(delivery.priority || "normal")}</div>
      <div><b>Assigned To:</b> ${escapeHtml(delivery.assigned_to || "—")}</div>
      <div><b>Est. Delivery:</b> ${delivery.estimated_delivery ? fmtDate(delivery.estimated_delivery) : "—"}</div>
    </div>
    <div style="margin-bottom:12px;"><b>Address:</b> ${escapeHtml(delivery.delivery_address || "—")}</div>
    ${delivery.delivery_notes ? `<div style="margin-bottom:12px;"><b>Notes:</b> ${escapeHtml(delivery.delivery_notes)}</div>` : ""}

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

    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:16px;">Close</button>
  `,
    { large: true },
  );
}
