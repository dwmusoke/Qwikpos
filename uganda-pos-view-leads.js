// =====================================================================
// QWICKPOS — LEAD MANAGEMENT (CRM) VIEW
// Sales pipeline, lead tracking, follow-ups
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
  fmtMoney,
  sanitizeCsvValue,
} from "./uganda-pos-core.js";
import { logAuditAction } from "./uganda-pos-view-audit.js";

let activeTab = "pipeline";
let leadsCache = [];

const STATUS_COLS = [
  { key: "new", label: "🆕 New", color: "#3b82f6" },
  { key: "contacted", label: "📞 Contacted", color: "#8b5cf6" },
  { key: "qualified", label: "✅ Qualified", color: "#f59e0b" },
  { key: "proposal", label: "📋 Proposal", color: "#f97316" },
  { key: "negotiation", label: "🤝 Negotiation", color: "#ef4444" },
  { key: "won", label: "🎉 Won", color: "#10b981" },
  { key: "lost", label: "❌ Lost", color: "#6b7280" },
];

const PRIORITY_BADGES = {
  low: "badge-gray",
  medium: "badge-blue",
  high: "badge-yellow",
  urgent: "badge-red",
};
const SOURCE_ICONS = {
  website: "🌐",
  referral: "👥",
  walk_in: "🚶",
  social_media: "📱",
  cold_call: "📞",
  other: "📌",
};

export async function renderLeads(root) {
  root.innerHTML = `<div class="empty-state">Loading leads…</div>`;

  const { data: leads } = await supabase
    .from("leads")
    .select("*, assigned_to_user:app_users(full_name)")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  leadsCache = leads || [];

  root.innerHTML = `
    <div class="view-header">
      <div><h2 data-i18n="nav.leads">Lead Management</h2><p class="sub">${leadsCache.length} leads in pipeline</p></div>
      <div class="flex gap">
        <button class="btn btn-outline btn-sm" id="leads-export-csv">📤 Export</button>
        <button class="btn btn-primary btn-sm" id="leads-add">➕ New Lead</button>
      </div>
    </div>
    <div class="notif-filters" id="leads-tabs">
      ${[
        ["pipeline", "📊 Pipeline"],
        ["list", "📋 List View"],
        ["by-source", "🔍 By Source"],
        ["followups", "📅 Follow-ups"],
      ]
        .map(
          ([k, l]) =>
            `<button class="chip ${activeTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`,
        )
        .join("")}
    </div>
    <div id="leads-body"></div>
  `;

  root.querySelectorAll("#leads-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root
        .querySelectorAll("#leads-tabs .chip")
        .forEach((c) => c.classList.toggle("active", c === btn));
      renderLeadsTab();
    });
  });

  $("leads-add")?.addEventListener("click", () => showLeadModal(null));
  $("leads-export-csv")?.addEventListener("click", exportLeadsCsv);
  renderLeadsTab();
}

function renderLeadsTab() {
  const body = $("leads-body");
  if (!body) return;
  if (activeTab === "pipeline") renderPipeline(body);
  else if (activeTab === "list") renderLeadList(body);
  else if (activeTab === "by-source") renderBySource(body);
  else if (activeTab === "followups") renderFollowups(body);
}

function renderPipeline(body) {
  const pipelineValue = leadsCache
    .filter((l) => !["won", "lost"].includes(l.status))
    .reduce((a, l) => a + Number(l.value || 0), 0);
  const wonValue = leadsCache
    .filter((l) => l.status === "won")
    .reduce((a, l) => a + Number(l.value || 0), 0);
  const winRate =
    leadsCache.length > 0
      ? (
          (leadsCache.filter((l) => l.status === "won").length /
            leadsCache.length) *
          100
        ).toFixed(1)
      : 0;

  body.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi-card"><div class="label">Pipeline Value</div><div class="value">${fmtMoney(pipelineValue)}</div></div>
      <div class="kpi-card"><div class="label">Won Value</div><div class="value" style="color:var(--brand);">${fmtMoney(wonValue)}</div></div>
      <div class="kpi-card"><div class="label">Win Rate</div><div class="value">${winRate}%</div></div>
      <div class="kpi-card"><div class="label">Total Leads</div><div class="value">${leadsCache.length}</div></div>
    </div>
    <div style="display:flex; gap:12px; overflow-x:auto; padding-bottom:12px;">
      ${STATUS_COLS.map((col) => {
        const colLeads = leadsCache.filter((l) => l.status === col.key);
        const colValue = colLeads.reduce((a, l) => a + Number(l.value || 0), 0);
        return `
          <div style="min-width:220px; flex:1; background:var(--bg); border-radius:var(--radius); padding:12px;">
            <div style="font-weight:700; font-size:13px; margin-bottom:8px; display:flex; justify-content:space-between;">
              <span>${col.label}</span>
              <span class="badge badge-gray">${colLeads.length} · ${fmtMoney(colValue)}</span>
            </div>
            ${colLeads
              .map(
                (l) => `
              <div class="card" style="padding:10px; margin-bottom:8px; cursor:pointer; border-left:3px solid ${col.color};" data-lead-detail="${l.id}">
                <div style="font-weight:600; font-size:13px;">${escapeHtml(l.name)}</div>
                <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(l.company || l.phone || "")}</div>
                <div style="display:flex; justify-content:space-between; margin-top:6px;">
                  <span class="badge ${PRIORITY_BADGES[l.priority] || "badge-gray"}">${l.priority}</span>
                  <span style="font-size:12px; font-weight:600;">${fmtMoney(l.value || 0)}</span>
                </div>
              </div>
            `,
              )
              .join("")}
          </div>
        `;
      }).join("")}
    </div>
  `;

  body.querySelectorAll("[data-lead-detail]").forEach((el) => {
    el.addEventListener("click", () => {
      const lead = leadsCache.find((l) => l.id === el.dataset.leadDetail);
      if (lead) showLeadDetail(lead);
    });
  });
}

function renderLeadList(body) {
  if (!leadsCache.length) {
    body.innerHTML = `<div class="card"><div class="empty-state">No leads yet.</div></div>`;
    return;
  }
  body.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Company</th><th>Source</th><th>Status</th><th>Priority</th><th>Value</th><th>Actions</th></tr></thead>
        <tbody>
          ${leadsCache
            .map(
              (l) => `
            <tr>
              <td><b>${escapeHtml(l.name)}</b><br><span class="text-muted" style="font-size:11px;">${escapeHtml(l.email || l.phone || "")}</span></td>
              <td>${escapeHtml(l.company || "—")}</td>
              <td>${SOURCE_ICONS[l.source] || "📌"} ${escapeHtml(l.source || "—")}</td>
              <td><span class="badge badge-${l.status === "won" ? "green" : l.status === "lost" ? "gray" : "blue"}">${l.status}</span></td>
              <td><span class="badge ${PRIORITY_BADGES[l.priority] || "badge-gray"}">${l.priority}</span></td>
              <td>${fmtMoney(l.value || 0)}</td>
              <td>
                <button class="btn btn-outline btn-xs" data-edit-lead="${l.id}">Edit</button>
                <button class="btn btn-outline btn-xs" data-view-lead="${l.id}">View</button>
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>
  `;

  body.querySelectorAll("[data-edit-lead]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lead = leadsCache.find((l) => l.id === btn.dataset.editLead);
      if (lead) showLeadModal(lead);
    });
  });
  body.querySelectorAll("[data-view-lead]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lead = leadsCache.find((l) => l.id === btn.dataset.viewLead);
      if (lead) showLeadDetail(lead);
    });
  });
}

function renderBySource(body) {
  const sourceMap = {};
  leadsCache.forEach((l) => {
    const src = l.source || "other";
    if (!sourceMap[src])
      sourceMap[src] = { source: src, count: 0, value: 0, won: 0 };
    sourceMap[src].count++;
    sourceMap[src].value += Number(l.value || 0);
    if (l.status === "won") sourceMap[src].won++;
  });
  const sources = Object.values(sourceMap).sort((a, b) => b.count - a.count);

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Total Value</th><th>Conversion</th></tr></thead>
        <tbody>
          ${sources
            .map(
              (s) => `
            <tr>
              <td>${SOURCE_ICONS[s.source] || "📌"} <b>${escapeHtml(s.source)}</b></td>
              <td>${s.count}</td>
              <td>${s.won}</td>
              <td>${fmtMoney(s.value)}</td>
              <td>${s.count > 0 ? ((s.won / s.count) * 100).toFixed(1) : 0}%</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>
  `;
}

function renderFollowups(body) {
  const today = new Date();
  const upcoming = leadsCache
    .filter(
      (l) =>
        l.next_followup_at &&
        new Date(l.next_followup_at) >= today &&
        !["won", "lost"].includes(l.status),
    )
    .sort(
      (a, b) => new Date(a.next_followup_at) - new Date(b.next_followup_at),
    );

  const overdue = leadsCache
    .filter(
      (l) =>
        l.next_followup_at &&
        new Date(l.next_followup_at) < today &&
        !["won", "lost"].includes(l.status),
    )
    .sort(
      (a, b) => new Date(a.next_followup_at) - new Date(b.next_followup_at),
    );

  body.innerHTML = `
    ${
      overdue.length
        ? `
      <div class="card" style="border-left:3px solid var(--danger);">
        <div class="card-title" style="color:var(--danger);">⚠️ Overdue Follow-ups (${overdue.length})</div>
        ${overdue
          .map(
            (l) => `
          <div class="summary-row" style="cursor:pointer;" data-lead-detail="${l.id}">
            <span><b>${escapeHtml(l.name)}</b> — ${escapeHtml(l.company || l.phone || "")}</span>
            <span class="badge badge-red">${fmtDate(l.next_followup_at)}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `
        : ""
    }
    <div class="card">
      <div class="card-title">📅 Upcoming Follow-ups (${upcoming.length})</div>
      ${
        upcoming.length
          ? upcoming
              .map(
                (l) => `
        <div class="summary-row" style="cursor:pointer;" data-lead-detail="${l.id}">
          <span><b>${escapeHtml(l.name)}</b> — ${escapeHtml(l.company || l.phone || "")}</span>
          <span class="badge badge-blue">${fmtDate(l.next_followup_at)}</span>
        </div>
      `,
              )
              .join("")
          : '<div class="empty-state">No upcoming follow-ups.</div>'
      }
    </div>
  `;

  body.querySelectorAll("[data-lead-detail]").forEach((el) => {
    el.addEventListener("click", () => {
      const lead = leadsCache.find((l) => l.id === el.dataset.leadDetail);
      if (lead) showLeadDetail(lead);
    });
  });
}

function showLeadModal(existing) {
  const isEdit = !!existing;
  openModal(
    `
    <h3>${isEdit ? "Edit" : "New"} Lead</h3>
    <div class="field-row">
      <div class="field"><label>Name *</label><input id="lead-name" value="${escapeHtml(existing?.name || "")}" required /></div>
      <div class="field"><label>Company</label><input id="lead-company" value="${escapeHtml(existing?.company || "")}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Email</label><input id="lead-email" type="email" value="${escapeHtml(existing?.email || "")}" /></div>
      <div class="field"><label>Phone</label><input id="lead-phone" value="${escapeHtml(existing?.phone || "")}" /></div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Source</label>
        <select id="lead-source">
          ${[
            "website",
            "referral",
            "walk_in",
            "social_media",
            "cold_call",
            "other",
          ]
            .map(
              (s) =>
                `<option value="${s}" ${existing?.source === s ? "selected" : ""}>${s.replace("_", " ")}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="lead-status">
          ${STATUS_COLS.map((s) => `<option value="${s.key}" ${existing?.status === s.key ? "selected" : ""}>${s.label}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Priority</label>
        <select id="lead-priority">
          ${["low", "medium", "high", "urgent"].map((p) => `<option value="${p}" ${existing?.priority === p ? "selected" : ""}>${p}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Estimated Value</label><input id="lead-value" type="number" value="${existing?.value || 0}" /></div>
    </div>
    <div class="field"><label>Next Follow-up</label><input id="lead-followup" type="datetime-local" value="${existing?.next_followup_at ? new Date(existing.next_followup_at).toISOString().slice(0, 16) : ""}" /></div>
    <div class="field"><label>Notes</label><textarea id="lead-notes" rows="3">${escapeHtml(existing?.notes || "")}</textarea></div>
    <button class="btn btn-primary btn-block" id="lead-save">${isEdit ? "Update" : "Create"} Lead</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `,
    { large: true },
  );

  $("lead-save")?.addEventListener("click", async () => {
    const name = $("lead-name")?.value.trim();
    if (!name) {
      toast("Name is required", "error");
      return;
    }

    const payload = {
      name,
      company: $("lead-company")?.value.trim(),
      email: $("lead-email")?.value.trim(),
      phone: $("lead-phone")?.value.trim(),
      source: $("lead-source")?.value,
      status: $("lead-status")?.value,
      priority: $("lead-priority")?.value,
      value: Number($("lead-value")?.value || 0),
      next_followup_at: $("lead-followup")?.value || null,
      notes: $("lead-notes")?.value.trim(),
      business_id: STATE.business.id,
      branch_id: STATE.branch?.id,
    };

    if (isEdit) {
      const oldLead = leadsCache.find((l) => l.id === existing.id);
      await supabase.from("leads").update(payload).eq("id", existing.id);
      logAuditAction({
        action: "update",
        entityType: "lead",
        entityId: existing.id,
        entityName: name,
        oldValue: { status: oldLead?.status, priority: oldLead?.priority },
        newValue: payload,
      });
    } else {
      const { data, error } = await supabase
        .from("leads")
        .insert(payload)
        .select()
        .single();
      logAuditAction({
        action: "create",
        entityType: "lead",
        entityId: data?.id,
        entityName: name,
        newValue: payload,
      });
    }
    toast(`Lead ${isEdit ? "updated" : "created"}`, "success");
    closeModal();
  });
}

async function showLeadDetail(lead) {
  const { data: activities } = await supabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(50);

  openModal(
    `
    <div style="display:flex; justify-content:space-between; align-items:start;">
      <div>
        <h3>${escapeHtml(lead.name)}</h3>
        <p style="color:var(--text-muted); font-size:13px;">${escapeHtml(lead.company || "")} · ${escapeHtml(lead.email || lead.phone || "")}</p>
      </div>
      <div class="flex gap">
        <span class="badge ${PRIORITY_BADGES[lead.priority] || "badge-gray"}">${lead.priority}</span>
        <span class="badge badge-${lead.status === "won" ? "green" : lead.status === "lost" ? "gray" : "blue"}">${lead.status}</span>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin:16px 0;">
      <div><b>Value:</b> ${fmtMoney(lead.value || 0)}</div>
      <div><b>Source:</b> ${SOURCE_ICONS[lead.source] || "📌"} ${escapeHtml(lead.source || "—")}</div>
      <div><b>Follow-up:</b> ${lead.next_followup_at ? fmtDate(lead.next_followup_at) : "—"}</div>
    </div>
    ${lead.notes ? `<div style="margin-bottom:16px;"><b>Notes:</b><br>${escapeHtml(lead.notes)}</div>` : ""}

    <div style="margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <b>Activities</b>
        <button class="btn btn-outline btn-xs" id="lead-add-activity">➕ Add</button>
      </div>
      ${
        (activities || []).length
          ? (activities || [])
              .map(
                (a) => `
        <div style="padding:8px 0; border-bottom:1px solid var(--border);">
          <div style="display:flex; justify-content:space-between;">
            <span class="badge badge-gray">${a.activity_type}</span>
            <span style="font-size:11px; color:var(--text-muted);">${fmtDate(a.created_at)}</span>
          </div>
          <div style="font-size:13px; margin-top:4px;">${escapeHtml(a.description)}</div>
          <div style="font-size:11px; color:var(--text-muted);">by ${escapeHtml(a.user_name || "Unknown")}</div>
        </div>
      `,
              )
              .join("")
          : '<div class="empty-state">No activities yet.</div>'
      }
    </div>

    <div style="display:flex; gap:8px; margin-top:16px;">
      <button class="btn btn-outline btn-block" data-close-modal>Close</button>
      <button class="btn btn-primary btn-block" id="lead-edit-btn">Edit Lead</button>
    </div>
  `,
    { large: true },
  );

  $("lead-add-activity")?.addEventListener("click", () =>
    showActivityModal(lead),
  );
  $("lead-edit-btn")?.addEventListener("click", () => {
    closeModal();
    showLeadModal(lead);
  });
}

function showActivityModal(lead) {
  openModal(`
    <h3>Add Activity</h3>
    <div class="field">
      <label>Type</label>
      <select id="act-type">
        <option value="note">📝 Note</option>
        <option value="call">📞 Call</option>
        <option value="email">📧 Email</option>
        <option value="meeting">🤝 Meeting</option>
        <option value="status_change">🔄 Status Change</option>
        <option value="followup">📅 Follow-up</option>
      </select>
    </div>
    <div class="field"><label>Description *</label><textarea id="act-desc" rows="3"></textarea></div>
    <button class="btn btn-primary btn-block" id="act-save">Save Activity</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("act-save")?.addEventListener("click", async () => {
    const desc = $("act-desc")?.value.trim();
    if (!desc) {
      toast("Description is required", "error");
      return;
    }
    await supabase.from("lead_activities").insert({
      lead_id: lead.id,
      business_id: STATE.business.id,
      user_id: STATE.appUser.id,
      user_name: STATE.appUser.full_name,
      activity_type: $("act-type")?.value,
      description: desc,
    });
    logAuditAction({
      action: "create",
      entityType: "lead_activity",
      entityId: lead.id,
      entityName: `${lead.name} — ${$("act-type")?.value}`,
      newValue: { activity_type: $("act-type")?.value, description: desc },
    });
    toast("Activity added", "success");
    closeModal();
  });
}

function exportLeadsCsv() {
  const header = [
    "Name",
    "Email",
    "Phone",
    "Company",
    "Source",
    "Status",
    "Priority",
    "Value",
    "Follow-up",
    "Notes",
  ];
  const rows = leadsCache.map((l) => [
    l.name,
    l.email,
    l.phone,
    l.company,
    l.source,
    l.status,
    l.priority,
    l.value,
    l.next_followup_at,
    l.notes,
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map(sanitizeCsvValue).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Leads exported", "success");
}
