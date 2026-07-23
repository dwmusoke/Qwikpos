// =====================================================================
// QWICKPOS — AUDIT LOGS VIEW
// Track every important action across the system
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

let activeTab = "logs";

const ACTION_ICONS = {
  create: "➕",
  update: "✏️",
  delete: "🗑️",
  void: "❌",
  approve: "✅",
  login: "🔑",
  logout: "🚪",
  export: "📤",
  import: "📥",
  receive: "📦",
  payment: "💰",
  refund: "↩️",
  transfer: "🔄",
  stock_count: "📋",
};

const ENTITY_ICONS = {
  sale: "🧾",
  product: "📦",
  customer: "👥",
  supplier: "🚚",
  purchase: "🛒",
  stock_transfer: "🔄",
  settings: "⚙️",
  user: "👤",
  category: "🏷️",
  brand: "⭐",
  delivery: "🚚",
  lead: "💼",
  employee: "👤",
};

export async function renderAuditLogs(root) {
  root.innerHTML = `<div class="empty-state">Loading audit logs…</div>`;

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: logs, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("business_id", STATE.business.id)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    root.innerHTML = `<div class="empty-state">Failed to load audit logs. The audit_logs table may not exist yet — run uganda-pos-schema-v6.sql in Supabase.</div>`;
    return;
  }

  const allLogs = logs || [];

  root.innerHTML = `
    <div class="view-header">
      <div><h2>Audit Logs</h2><p class="sub">${allLogs.length} actions in the last 30 days</p></div>
      <div class="flex gap">
        <button class="btn btn-outline btn-sm" id="audit-export-csv">📤 Export CSV</button>
      </div>
    </div>
    <div class="notif-filters" id="audit-tabs">
      ${[
        ["logs", "📋 All Logs"],
        ["by-user", "👤 By User"],
        ["by-entity", "📦 By Entity"],
      ]
        .map(
          ([k, l]) =>
            `<button class="chip ${activeTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`,
        )
        .join("")}
    </div>
    <div id="audit-body"></div>
  `;

  root.querySelectorAll("#audit-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root
        .querySelectorAll("#audit-tabs .chip")
        .forEach((c) => c.classList.toggle("active", c === btn));
      renderAuditTab(allLogs);
    });
  });

  $("audit-export-csv")?.addEventListener("click", () =>
    exportAuditCsv(allLogs),
  );
  renderAuditTab(allLogs);
}

function renderAuditTab(logs) {
  const body = $("audit-body");
  if (!body) return;
  if (activeTab === "logs") renderLogList(logs, body);
  else if (activeTab === "by-user") renderByUser(logs, body);
  else if (activeTab === "by-entity") renderByEntity(logs, body);
}

function renderLogList(logs, body) {
  if (!logs.length) {
    body.innerHTML = `<div class="card"><div class="empty-state">No audit logs found.</div></div>`;
    return;
  }
  body.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th>
        </tr></thead>
        <tbody>
          ${logs
            .map(
              (l) => `
            <tr>
              <td style="white-space:nowrap;">${fmtDate(l.created_at)}</td>
              <td><b>${escapeHtml(l.user_name)}</b><br><span class="text-muted" style="font-size:11px;">${escapeHtml(l.user_role || "")}</span></td>
              <td><span class="badge badge-${actionBadge(l.action)}">${ACTION_ICONS[l.action] || "📌"} ${escapeHtml(l.action)}</span></td>
              <td>${ENTITY_ICONS[l.entity_type] || "📌"} ${escapeHtml(l.entity_type)}<br><span class="text-muted" style="font-size:11px;">${escapeHtml(l.entity_name || l.entity_id?.slice(0, 8) || "")}</span></td>
              <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${l.old_value || l.new_value ? `<button class="btn btn-outline btn-xs" data-log-detail="${l.id}">View</button>` : "—"}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>
  `;

  body.querySelectorAll("[data-log-detail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const log = logs.find((l) => l.id === btn.dataset.logDetail);
      if (log) showLogDetail(log);
    });
  });
}

function renderByUser(logs, body) {
  const userMap = {};
  logs.forEach((l) => {
    const key = l.user_name || "Unknown";
    if (!userMap[key])
      userMap[key] = { name: key, role: l.user_role, count: 0, actions: {} };
    userMap[key].count++;
    userMap[key].actions[l.action] = (userMap[key].actions[l.action] || 0) + 1;
  });
  const users = Object.values(userMap).sort((a, b) => b.count - a.count);

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Role</th><th>Total Actions</th><th>Breakdown</th></tr></thead>
        <tbody>
          ${users
            .map(
              (u) => `
            <tr>
              <td><b>${escapeHtml(u.name)}</b></td>
              <td>${escapeHtml(u.role || "")}</td>
              <td><b>${u.count}</b></td>
              <td>${Object.entries(u.actions)
                .map(
                  ([a, c]) =>
                    `<span class="badge badge-gray" style="margin:2px;">${ACTION_ICONS[a] || ""} ${a}: ${c}</span>`,
                )
                .join("")}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>
  `;
}

function renderByEntity(logs, body) {
  const entityMap = {};
  logs.forEach((l) => {
    const key = l.entity_type || "other";
    if (!entityMap[key]) entityMap[key] = { type: key, count: 0, actions: {} };
    entityMap[key].count++;
    entityMap[key].actions[l.action] =
      (entityMap[key].actions[l.action] || 0) + 1;
  });
  const entities = Object.values(entityMap).sort((a, b) => b.count - a.count);

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Entity Type</th><th>Total Actions</th><th>Breakdown</th></tr></thead>
        <tbody>
          ${entities
            .map(
              (e) => `
            <tr>
              <td>${ENTITY_ICONS[e.type] || "📌"} <b>${escapeHtml(e.type)}</b></td>
              <td><b>${e.count}</b></td>
              <td>${Object.entries(e.actions)
                .map(
                  ([a, c]) =>
                    `<span class="badge badge-gray" style="margin:2px;">${a}: ${c}</span>`,
                )
                .join("")}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>
  `;
}

function showLogDetail(log) {
  const oldStr = log.old_value
    ? typeof log.old_value === "string"
      ? log.old_value
      : JSON.stringify(log.old_value, null, 2)
    : "—";
  const newStr = log.new_value
    ? typeof log.new_value === "string"
      ? log.new_value
      : JSON.stringify(log.new_value, null, 2)
    : "—";
  const metaStr = log.metadata
    ? typeof log.metadata === "string"
      ? log.metadata
      : JSON.stringify(log.metadata, null, 2)
    : "—";

  openModal(
    `
    <h3>Audit Log Detail</h3>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:12px;">
      <div><b>User:</b> ${escapeHtml(log.user_name)} (${escapeHtml(log.user_role || "")})</div>
      <div><b>Action:</b> ${ACTION_ICONS[log.action] || ""} ${escapeHtml(log.action)}</div>
      <div><b>Entity:</b> ${ENTITY_ICONS[log.entity_type] || ""} ${escapeHtml(log.entity_type)}</div>
      <div><b>Entity Name:</b> ${escapeHtml(log.entity_name || log.entity_id || "")}</div>
      <div><b>Time:</b> ${fmtDate(log.created_at)}</div>
      <div><b>IP:</b> ${escapeHtml(log.ip_address || "—")}</div>
    </div>
    <div style="margin-top:16px;">
      <b>Old Value:</b>
      <pre style="background:var(--bg); padding:10px; border-radius:6px; font-size:12px; overflow-x:auto; max-height:200px;">${escapeHtml(oldStr)}</pre>
    </div>
    <div style="margin-top:12px;">
      <b>New Value:</b>
      <pre style="background:var(--bg); padding:10px; border-radius:6px; font-size:12px; overflow-x:auto; max-height:200px;">${escapeHtml(newStr)}</pre>
    </div>
    <div style="margin-top:12px;">
      <b>Metadata:</b>
      <pre style="background:var(--bg); padding:10px; border-radius:6px; font-size:12px; overflow-x:auto; max-height:200px;">${escapeHtml(metaStr)}</pre>
    </div>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:16px;">Close</button>
  `,
    { large: true },
  );
}

function actionBadge(action) {
  const map = {
    create: "green",
    update: "blue",
    delete: "red",
    void: "red",
    approve: "green",
    login: "gray",
    logout: "gray",
  };
  return map[action] || "gray";
}

function exportAuditCsv(logs) {
  const header = [
    "Time",
    "User",
    "Role",
    "Action",
    "Entity Type",
    "Entity Name",
    "Entity ID",
    "IP",
  ];
  const rows = logs.map((l) => [
    l.created_at,
    l.user_name,
    l.user_role,
    l.action,
    l.entity_type,
    l.entity_name,
    l.entity_id,
    l.ip_address,
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map(sanitizeCsvValue).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Audit logs exported", "success");
}

// ---------------------------------------------------------------------
// AUDIT LOG HELPER — call from other modules to log actions
// ---------------------------------------------------------------------
export async function logAuditAction({
  action,
  entityType,
  entityId = null,
  entityName = null,
  oldValue = null,
  newValue = null,
  metadata = null,
}) {
  if (!STATE.business || !STATE.appUser) return;
  try {
    await supabase.rpc("insert_audit_log", {
      p_business_id: STATE.business.id,
      p_branch_id: STATE.branch?.id || null,
      p_user_id: STATE.appUser.id,
      p_user_name: STATE.appUser.full_name || "Unknown",
      p_user_role: STATE.appUser.role,
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_entity_name: entityName,
      p_old_value: oldValue ? JSON.stringify(oldValue) : null,
      p_new_value: newValue ? JSON.stringify(newValue) : null,
      p_metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (e) {
    console.warn("Audit log failed:", e);
  }
}
