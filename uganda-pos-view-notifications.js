// =====================================================================
// QWICKPOS — NOTIFICATIONS VIEW
// Full notification inbox with filtering, read/unread, and actions
// =====================================================================
import {
  supabase,
  STATE,
  $,
  qsa,
  escapeHtml,
  toast,
  loadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createNotification,
  snoozeNotification,
  fmtDate,
  fmtMoney,
} from "./uganda-pos-core.js";

let _notifFilter = "all";
let _notifPrefs = {};

function loadNotifPrefs() {
  try {
    _notifPrefs = JSON.parse(localStorage.getItem("qwikpos_notif_prefs") || "{}");
  } catch { _notifPrefs = {}; }
  return _notifPrefs;
}

function prefEnabled(type) {
  if (_notifPrefs[type] === undefined) return true;
  return _notifPrefs[type];
}

function isSnoozed(n) {
  if (!n.snooze_until) return false;
  return new Date(n.snooze_until) > new Date();
}

export async function renderNotifications(root) {
  loadNotifPrefs();
  await loadNotifications();

  root.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1>Notifications</h1>
        <p>${STATE.unreadCount} unread of ${STATE.notifications.length} total</p>
      </div>
    <div class="page-header-actions">
      <div class="flex gap">
        <button class="btn btn-secondary" id="notif-mark-all-btn">✓ Mark all read</button>
        <button class="btn btn-secondary" id="notif-clear-btn">🗑️ Clear all</button>
        <button class="btn btn-primary btn-sm" id="notif-ai-summary-btn">✨ AI Summary</button>
      </div>
    </div>
    <div id="notif-ai-summary" style="display:none;margin:12px 0;padding:14px;background:var(--bg-muted);border-radius:8px;border:1px solid var(--border);">
      <div style="font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px">
        <span>🤖 AI Daily Digest</span>
        <span id="notif-ai-source" style="font-size:11px;opacity:0.7;background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:10px;">—</span>
      </div>
      <div id="notif-ai-text" style="white-space:pre-wrap;"></div>
    </div>
    </div>

    <div class="notif-filters" id="notif-filters">
      <button class="chip ${_notifFilter === "all" ? "active" : ""}" data-filter="all">All</button>
      <button class="chip ${_notifFilter === "unread" ? "active" : ""}" data-filter="unread">Unread</button>
      <button class="chip ${_notifFilter === "sale" ? "active" : ""}" data-filter="sale">Sales</button>
      <button class="chip ${_notifFilter === "stock" ? "active" : ""}" data-filter="stock">Stock</button>
      <button class="chip ${_notifFilter === "chat" ? "active" : ""}" data-filter="chat">Chat</button>
      <button class="chip ${_notifFilter === "subscription" ? "active" : ""}" data-filter="subscription">Billing</button>
    </div>

    <div class="card" id="notif-card">
      <div id="notif-full-list"></div>
    </div>
  `;

  renderNotifList();

  qsa("[data-filter]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      _notifFilter = btn.dataset.filter;
      qsa("[data-filter]", root).forEach((b) =>
        b.classList.toggle("active", b.dataset.filter === _notifFilter),
      );
      renderNotifList();
    });
  });

  $("notif-mark-all-btn")?.addEventListener("click", async () => {
    await markAllNotificationsRead();
    renderNotifList();
    toast("All marked as read", "success");
  });

  $("notif-clear-btn")?.addEventListener("click", async () => {
    if (!confirm("Clear all notifications?")) return;
    await supabase
      .from("notifications")
      .delete()
      .eq("business_id", STATE.business.id);
    STATE.notifications = [];
    STATE.unreadCount = 0;
    renderNotifList();
    toast("Notifications cleared", "success");
  });

  // ── AI summary ────────────────────────────────────────────────────
  $("notif-ai-summary-btn")?.addEventListener("click", async () => {
    const box = $("notif-ai-summary");
    const src = $("notif-ai-source");
    const txt = $("notif-ai-text");
    if (box.style.display === "block") {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    src.textContent = "Generating…";
    txt.textContent = "";
    const unread = STATE.notifications.filter((n) => !n.is_read);
    const target = unread.length ? unread : STATE.notifications.slice(0, 20);
    try {
      const { error, data } = await supabase.functions.invoke("ai-notifications", {
        body: { action: "summarize", notifications: target, period: "today" },
      });
      if (error) throw new Error(error.message || String(error));
      txt.textContent = data?.summary || "No summary available.";
      src.textContent = data?.source || "—";
    } catch (e) {
      txt.textContent = "AI summary unavailable — configure AI_API_KEY secret or try again later.";
      src.textContent = "offline";
      console.error("AI summary failed:", e);
    }
  });
}

function renderNotifList() {
  const el = $("notif-full-list");
  if (!el) return;

  let list = [...STATE.notifications]
    .filter((n) => !isSnoozed(n))
    .filter((n) => prefEnabled(n.type));

  if (_notifFilter === "unread") list = list.filter((n) => !n.is_read);
  else if (_notifFilter !== "all")
    list = list.filter((n) => n.type === _notifFilter);

  if (!list.length) {
    const msg = list.length === 0 && STATE.notifications.length > 0
      ? "All notifications are snoozed or filtered out. Check Preferences."
      : "No notifications";
    el.innerHTML = `<div class="empty-state" style="padding:48px"><div class="big-icon">🔔</div>${msg}${_notifFilter !== "all" ? " in this category" : ""}</div>`;
    return;
  }

  const iconMap = {
    sale: "🧾",
    stock: "📦",
    subscription: "💳",
    chat: "💬",
    error: "❌",
    warning: "⚠️",
    success: "✅",
    info: "ℹ️",
  };

  const priorityMap = { high: "🔴", medium: "🟡", low: "🟢" };

  el.innerHTML = list
    .map(
      (n) => {
        const buttons = (n.action_buttons || [])
          .map(
            (b) => `<button class="btn btn-sm btn-secondary" data-notif-action-btn="${n.id}:${b.action || b.label}" style="margin-top:6px">${escapeHtml(b.label || b.action || "Action")}</button>`,
          )
          .join("");
        const snoozeOpts = [60, 480, 1440].map(
          (m) => `<button class="btn btn-xs btn-secondary" data-notif-snooze="${n.id}:${m}" style="margin-top:4px">Snooze ${m === 1440 ? "24h" : m === 480 ? "8h" : "1h"}</button>`,
        ).join(" ");
        return `
    <div class="notif-full-item ${n.is_read ? "" : "unread"}" data-notif-id="${n.id}" data-route="${n.route || ""}">
      <div class="notif-full-icon">${iconMap[n.type] || "ℹ️"}</div>
      <div class="notif-full-body">
        <div class="notif-full-title" style="display:flex;align-items:center;gap:8px">
          ${escapeHtml(n.title)}
          <span class="badge badge-${n.ai_priority === "high" ? "red" : n.ai_priority === "medium" ? "yellow" : "gray"}" style="font-size:10px;padding:2px 6px;margin-left:auto">${priorityMap[n.ai_priority] || "🟢"} ${n.ai_priority || "low"}</span>
        </div>
        ${n.body ? `<div class="notif-full-text">${escapeHtml(n.body)}</div>` : ""}
        <div class="notif-full-time">${fmtDate(n.created_at)}</div>
        ${buttons ? `<div style="margin-top:8px">${buttons}</div>` : ""}
        <div style="margin-top:6px">${snoozeOpts}</div>
      </div>
      ${n.route ? `<button class="btn btn-sm btn-secondary" data-notif-action="${n.id}" data-notif-route="${n.route}">View</button>` : ""}
      ${!n.is_read ? `<div class="unread-dot"></div>` : ""}
    </div>
  `,
      },
    )
    .join("");

  el.querySelectorAll(".notif-full-item").forEach((item) => {
    item.addEventListener("click", async (e) => {
      if (e.target.closest("[data-notif-action]")) return;
      if (e.target.closest("[data-notif-action-btn]")) return;
      if (e.target.closest("[data-notif-snooze]")) return;
      const id = item.dataset.notifId;
      await markNotificationRead(id);
      item.classList.remove("unread");
      const dot = item.querySelector(".unread-dot");
      if (dot) dot.remove();
    });
  });

  el.querySelectorAll("[data-notif-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await markNotificationRead(btn.dataset.notifAction);
      document
        .querySelector('[data-route="' + btn.dataset.notifRoute + '"]')
        ?.click();
    });
  });

  el.querySelectorAll("[data-notif-action-btn]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const [id, action] = btn.dataset.notifActionBtn.split(":");
      await markNotificationRead(id);
      toast(`Action "${escapeHtml(action)}" triggered`, "success");
    });
  });

  el.querySelectorAll("[data-notif-snooze]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const [id, minutes] = btn.dataset.notifSnooze.split(":");
      await snoozeNotification(id, parseInt(minutes, 10));
      renderNotifList();
      toast("Notification snoozed", "success");
    });
  });
}
