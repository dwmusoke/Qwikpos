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
  fmtDate,
  fmtMoney,
} from "./uganda-pos-core.js";

let _notifFilter = "all";

export async function renderNotifications(root) {
  await loadNotifications();

  root.innerHTML = `
    <div class="view-header">
      <div>
        <h2>Notifications</h2>
        <p class="sub">${STATE.unreadCount} unread of ${STATE.notifications.length} total</p>
      </div>
      <div class="flex gap">
        <button class="btn btn-outline" id="notif-mark-all-btn">✓ Mark all read</button>
        <button class="btn btn-outline" id="notif-clear-btn">🗑️ Clear all</button>
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
}

function renderNotifList() {
  const el = $("notif-full-list");
  if (!el) return;

  let list = [...STATE.notifications];

  if (_notifFilter === "unread") list = list.filter((n) => !n.is_read);
  else if (_notifFilter !== "all")
    list = list.filter((n) => n.type === _notifFilter);

  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="padding:48px"><div class="big-icon">🔔</div>No notifications${_notifFilter !== "all" ? " in this category" : ""}</div>`;
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

  el.innerHTML = list
    .map(
      (n) => `
    <div class="notif-full-item ${n.is_read ? "" : "unread"}" data-notif-id="${n.id}" data-route="${n.route || ""}">
      <div class="notif-full-icon">${iconMap[n.type] || "ℹ️"}</div>
      <div class="notif-full-body">
        <div class="notif-full-title">${escapeHtml(n.title)}</div>
        ${n.body ? `<div class="notif-full-text">${escapeHtml(n.body)}</div>` : ""}
        <div class="notif-full-time">${fmtDate(n.created_at)}</div>
      </div>
      ${n.route ? `<button class="btn btn-sm btn-outline" data-notif-action="${n.id}" data-notif-route="${n.route}">View</button>` : ""}
      ${!n.is_read ? `<div class="unread-dot"></div>` : ""}
    </div>
  `,
    )
    .join("");

  el.querySelectorAll(".notif-full-item").forEach((item) => {
    item.addEventListener("click", async (e) => {
      if (e.target.closest("[data-notif-action]")) return;
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
}
