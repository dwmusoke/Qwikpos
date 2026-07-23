// =====================================================================
// QWICKPOS — NOTIFICATIONS CENTER (Email/SMS)
// Templates, sending, and history
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

let activeTab = "templates";

export async function renderNotificationsCenter(root) {
  root.innerHTML = `<div class="empty-state">Loading notifications…</div>`;

  const [{ data: templates }, { data: log }] = await Promise.all([
    supabase
      .from("notification_templates")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("name"),
    supabase
      .from("notification_log")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const allTemplates = templates || [];
  const allLog = log || [];

  root.innerHTML = `
    <div class="view-header">
      <div><h2>Notifications Center</h2><p class="sub">${allTemplates.length} templates · ${allLog.length} sent</p></div>
      <button class="btn btn-primary btn-sm" id="nc-add-template">➕ New Template</button>
    </div>
    <div class="notif-filters" id="nc-tabs">
      ${[
        ["templates", "📧 Templates"],
        ["log", "📋 Send Log"],
        ["send", "✉️ Send Now"],
      ]
        .map(
          ([k, l]) =>
            `<button class="chip ${activeTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`,
        )
        .join("")}
    </div>
    <div id="nc-body"></div>
  `;

  root.querySelectorAll("#nc-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root
        .querySelectorAll("#nc-tabs .chip")
        .forEach((c) => c.classList.toggle("active", c === btn));
      renderNcTab(allTemplates, allLog);
    });
  });

  $("nc-add-template")?.addEventListener("click", () =>
    showTemplateModal(null, allTemplates),
  );
  renderNcTab(allTemplates, allLog);
}

function renderNcTab(templates, log) {
  const body = $("nc-body");
  if (!body) return;
  if (activeTab === "templates") renderTemplates(templates, body);
  else if (activeTab === "log") renderSendLog(log, body);
  else if (activeTab === "send") renderSendNow(templates, body);
}

function renderTemplates(templates, body) {
  if (!templates.length) {
    body.innerHTML = `<div class="card"><div class="empty-state">No notification templates yet. Create one to get started.</div></div>`;
    return;
  }
  body.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Channel</th><th>Subject</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${templates
            .map(
              (t) => `
            <tr>
              <td><b>${escapeHtml(t.name)}</b></td>
              <td><span class="badge badge-${t.channel === "email" ? "blue" : t.channel === "sms" ? "green" : "purple"}">${t.channel}</span></td>
              <td>${escapeHtml(t.subject || "—")}</td>
              <td><span class="badge badge-${t.is_active ? "green" : "gray"}">${t.is_active ? "Active" : "Disabled"}</span></td>
              <td>
                <button class="btn btn-outline btn-xs" data-edit-template="${t.id}">Edit</button>
                <button class="btn btn-outline btn-xs" data-delete-template="${t.id}" style="color:var(--danger);">Delete</button>
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>
  `;

  body.querySelectorAll("[data-edit-template]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = templates.find((x) => x.id === btn.dataset.editTemplate);
      if (t) showTemplateModal(t, templates);
    });
  });
  body.querySelectorAll("[data-delete-template]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this template?")) return;
      const t = templates.find((x) => x.id === btn.dataset.deleteTemplate);
      await supabase
        .from("notification_templates")
        .delete()
        .eq("id", btn.dataset.deleteTemplate);
      logAuditAction({
        action: "delete",
        entityType: "notification_template",
        entityId: btn.dataset.deleteTemplate,
        entityName: t?.name || "Template",
      });
      toast("Template deleted", "success");
      renderNcTab(
        templates.filter((t) => t.id !== btn.dataset.deleteTemplate),
        body,
      );
    });
  });
}

function renderSendLog(log, body) {
  if (!log.length) {
    body.innerHTML = `<div class="card"><div class="empty-state">No notifications sent yet.</div></div>`;
    return;
  }
  body.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Channel</th><th>Recipient</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>
          ${log
            .map(
              (l) => `
            <tr>
              <td style="white-space:nowrap;">${fmtDate(l.created_at)}</td>
              <td><span class="badge badge-${l.channel === "email" ? "blue" : "green"}">${l.channel}</span></td>
              <td>${escapeHtml(l.recipient)}</td>
              <td>${escapeHtml(l.subject || "—")}</td>
              <td><span class="badge badge-${l.status === "sent" ? "green" : "red"}">${l.status}</span></td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>
    </div>
  `;
}

function renderSendNow(templates, body) {
  body.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:16px;">Send Notification</h3>
      <div class="field">
        <label>Template</label>
        <select id="nc-send-template">
          <option value="">— Select template —</option>
          ${templates
            .filter((t) => t.is_active)
            .map(
              (t) =>
                `<option value="${t.id}">${escapeHtml(t.name)} (${t.channel})</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="field">
        <label>Recipient (email or phone)</label>
        <input id="nc-send-recipient" placeholder="user@example.com or +2567xxxxxxxx" />
      </div>
      <div class="field">
        <label>Subject (email only)</label>
        <input id="nc-send-subject" />
      </div>
      <div class="field">
        <label>Message Body</label>
        <textarea id="nc-send-body" rows="6" placeholder="Type your message…"></textarea>
      </div>
      <button class="btn btn-primary" id="nc-send-btn">✉️ Send</button>
    </div>
  `;

  $("nc-send-template")?.addEventListener("change", (e) => {
    const t = templates.find((x) => x.id === e.target.value);
    if (t) {
      if (t.subject) $("nc-send-subject").value = t.subject;
      if (t.body_template) $("nc-send-body").value = t.body_template;
    }
  });

  $("nc-send-btn")?.addEventListener("click", async () => {
    const recipient = $("nc-send-recipient")?.value.trim();
    const subject = $("nc-send-subject")?.value.trim();
    const bodyText = $("nc-send-body")?.value.trim();
    const template = templates.find(
      (t) => t.id === $("nc-send-template")?.value,
    );

    if (!recipient || !bodyText) {
      toast("Recipient and message body are required", "error");
      return;
    }

    const channel =
      template?.channel || (recipient.includes("@") ? "email" : "sms");

    const { error } = await supabase.from("notification_log").insert({
      business_id: STATE.business.id,
      template_name: template?.name || "manual",
      channel,
      recipient,
      subject,
      body: bodyText,
      status: "sent",
    });

    if (error) {
      toast("Failed to log notification: " + error.message, "error");
    } else {
      logAuditAction({
        action: "send",
        entityType: "notification",
        entityName: `${channel} to ${recipient}`,
        newValue: {
          channel,
          recipient,
          subject,
          template_name: template?.name || "manual",
        },
      });
      toast("Notification sent (logged)", "success");
      $("nc-send-recipient").value = "";
      $("nc-send-body").value = "";
    }
  });
}

function showTemplateModal(existing, templates) {
  const isEdit = !!existing;
  openModal(
    `
    <h3>${isEdit ? "Edit" : "New"} Notification Template</h3>
    <div class="field">
      <label>Template Name</label>
      <input id="tmpl-name" value="${escapeHtml(existing?.name || "")}" placeholder="e.g. receipt, low_stock, payment_reminder" />
    </div>
    <div class="field-row">
      <div class="field">
        <label>Channel</label>
        <select id="tmpl-channel">
          <option value="email" ${existing?.channel === "email" ? "selected" : ""}>Email</option>
          <option value="sms" ${existing?.channel === "sms" ? "selected" : ""}>SMS</option>
          <option value="both" ${existing?.channel === "both" ? "selected" : ""}>Both</option>
        </select>
      </div>
      <div class="field">
        <label>Active</label>
        <select id="tmpl-active">
          <option value="true" ${existing?.is_active !== false ? "selected" : ""}>Yes</option>
          <option value="false" ${existing?.is_active === false ? "selected" : ""}>No</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>Subject (email)</label>
      <input id="tmpl-subject" value="${escapeHtml(existing?.subject || "")}" />
    </div>
    <div class="field">
      <label>Body Template</label>
      <textarea id="tmpl-body" rows="6">${escapeHtml(existing?.body_template || "")}</textarea>
      <p class="help-text">Use {{customer_name}}, {{amount}}, {{invoice_number}}, etc. as placeholders.</p>
    </div>
    <button class="btn btn-primary btn-block" id="tmpl-save">${isEdit ? "Update" : "Create"} Template</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `,
    { large: true },
  );

  $("tmpl-save")?.addEventListener("click", async () => {
    const name = $("tmpl-name")?.value.trim();
    const channel = $("tmpl-channel")?.value;
    const subject = $("tmpl-subject")?.value.trim();
    const body_template = $("tmpl-body")?.value.trim();
    const is_active = $("tmpl-active")?.value === "true";

    if (!name || !body_template) {
      toast("Name and body are required", "error");
      return;
    }

    const payload = {
      name,
      channel,
      subject,
      body_template,
      is_active,
      business_id: STATE.business.id,
    };

    if (isEdit) {
      await supabase
        .from("notification_templates")
        .update(payload)
        .eq("id", existing.id);
      logAuditAction({
        action: "update",
        entityType: "notification_template",
        entityId: existing.id,
        entityName: name,
        newValue: payload,
      });
    } else {
      const { data, error } = await supabase
        .from("notification_templates")
        .insert(payload)
        .select()
        .single();
      logAuditAction({
        action: "create",
        entityType: "notification_template",
        entityId: data?.id,
        entityName: name,
        newValue: payload,
      });
    }
    toast(`Template ${isEdit ? "updated" : "created"}`, "success");
    closeModal();
  });
}
