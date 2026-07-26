// =====================================================================
// QWICKPOS — SUPERADMIN: SANDBOX API MANAGEMENT
// Manage vendor API keys, view usage analytics, monitor sandbox invoices
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
} from "./uganda-pos-core.js";

let _tab = "keys";

export async function renderSandboxAdmin(root) {
  root.innerHTML = `<div class="empty-state">Loading sandbox data…</div>`;

  const [keysRes, invoicesRes, usageRes, bizRes] = await Promise.all([
    supabase.from("sandbox_api_keys").select("*, business:businesses(name)").order("created_at", { ascending: false }),
    supabase.from("sandbox_invoices").select("id, tin, fiscal_invoice_number, status, gross_amount, vat_amount, currency_code, created_at, api_key:sandbox_api_keys(label, business:businesses(name))").order("created_at", { ascending: false }).limit(200),
    supabase.from("sandbox_usage").select("id, endpoint, status, response_time_ms, created_at, api_key:sandbox_api_keys(label)").order("created_at", { ascending: false }).limit(500),
    supabase.from("businesses").select("id, name"),
  ]);

  const keys = keysRes.data || [];
  const invoices = invoicesRes.data || [];
  const usage = usageRes.data || [];
  const businesses = bizRes.data || [];

  const bizMap = {};
  businesses.forEach((b) => { bizMap[b.id] = b.name; });

  const totalInvoices = invoices.length;
  const acceptedInvoices = invoices.filter((i) => i.status === "accepted").length;
  const totalRequests = usage.length;
  const avgResponseTime = usage.length ? Math.round(usage.reduce((a, u) => a + (u.response_time_ms || 0), 0) / usage.length) : 0;

  root.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1>Sandbox API — Admin</h1>
        <p>Manage EFRIS Sandbox API keys and monitor usage</p>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="label">API Keys</div><div class="value">${keys.length}</div><div class="delta">${keys.filter((k) => k.is_active).length} active</div></div>
      <div class="kpi-card"><div class="label">Total Invoices</div><div class="value">${totalInvoices}</div><div class="delta">${acceptedInvoices} accepted</div></div>
      <div class="kpi-card"><div class="label">Total Requests</div><div class="value">${totalRequests}</div></div>
      <div class="kpi-card"><div class="label">Avg Response</div><div class="value">${avgResponseTime}ms</div></div>
    </div>

    <div class="category-chips" style="margin-bottom:14px;">
      <button class="chip ${_tab === "keys" ? "active" : ""}" data-sbx-tab="keys">API Keys</button>
      <button class="chip ${_tab === "invoices" ? "active" : ""}" data-sbx-tab="invoices">Invoices</button>
      <button class="chip ${_tab === "usage" ? "active" : ""}" data-sbx-tab="usage">Usage Logs</button>
    </div>

    <div id="sandbox-admin-content"></div>
  `;

  const renderTab = () => {
    const el = $("sandbox-admin-content");
    if (_tab === "keys") renderKeysTab(el, { keys, businesses, bizMap });
    else if (_tab === "invoices") renderInvoicesTab(el, { invoices });
    else if (_tab === "usage") renderUsageTab(el, { usage });
  };

  renderTab();

  qsa("[data-sbx-tab]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      _tab = btn.dataset.sbxTab;
      qsa("[data-sbx-tab]", root).forEach((b) => b.classList.toggle("active", b.dataset.sbxTab === _tab));
      renderTab();
    }),
  );
}

function renderKeysTab(el, { keys, businesses, bizMap }) {
  el.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>All API Keys</span>
        <button class="btn btn-primary btn-sm" id="sbx-gen-key">+ Generate API Key</button>
      </div>
      ${keys.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Vendor</th><th>Label</th><th>API Key</th><th>Tier</th><th>Rate Limit</th><th>Last Used</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${keys.map((k) => `
              <tr>
                <td>${escapeHtml(k.business?.name || bizMap[k.business_id] || "—")}</td>
                <td>${escapeHtml(k.label || "—")}</td>
                <td><code style="font-size:11px;">${escapeHtml(k.api_key_prefix || "—")}</code></td>
                <td><span class="badge ${k.tier === "pro" ? "badge-green" : k.tier === "starter" ? "badge-blue" : "badge-gray"}">${k.tier}</span></td>
                <td>${k.rate_limit}/hr</td>
                <td>${k.last_used_at ? fmtDate(k.last_used_at) : "Never"}</td>
                <td><span class="badge ${k.is_active ? "badge-green" : "badge-red"}">${k.is_active ? "Active" : "Inactive"}</span></td>
                <td>
                  <button class="btn btn-ghost btn-sm" data-toggle-key="${k.id}">${k.is_active ? "Disable" : "Enable"}</button>
                  <button class="btn btn-ghost btn-sm" data-change-tier="${k.id}" data-current-tier="${k.tier}">Tier</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>` : '<div class="empty-state">No API keys issued yet. Click "Generate API Key" to create one.</div>'}
      </div>`;

  $("sbx-gen-key")?.addEventListener("click", () => {
    openModal(`
      <div class="modal-title-row"><h3>Generate Sandbox API Key</h3></div>
      <div class="field">
        <label>Vendor / Business</label>
        <select id="sbx-key-biz">${(businesses || []).map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Label (optional)</label>
        <input id="sbx-key-label" placeholder="e.g. Prod Test, Dev Staging" />
      </div>
      <div class="field">
        <label>Tier</label>
        <select id="sbx-key-tier">
          <option value="free">Free (100 req/hr, 100 invoices/day)</option>
          <option value="starter">Starter (500 req/hr, 5K invoices/day)</option>
          <option value="pro">Pro (2K req/hr, 50K invoices/day)</option>
        </select>
      </div>
      <div class="flex gap" style="margin-top:14px">
        <button class="btn btn-secondary btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="sbx-key-save">Generate</button>
      </div>
    `, {
      onMount: async () => {
        $("sbx-key-save")?.addEventListener("click", async () => {
          const bizId = $("sbx-key-biz").value;
          const label = $("sbx-key-label").value.trim() || "Sandbox Key";
          const tier = $("sbx-key-tier").value;
          if (!bizId) { toast("Select a vendor", "error"); return; }

          const limits = { free: { rate_limit: 100, daily_limit: 100 }, starter: { rate_limit: 500, daily_limit: 5000 }, pro: { rate_limit: 2000, daily_limit: 50000 } };

          const { data: plainKey, error } = await supabase.rpc("create_sandbox_api_key", {
            p_business_id: bizId,
            p_label: label,
          });
          if (error) { toast("Error: " + error.message, "error"); return; }

          // Upgrade tier if not free
          if (tier !== "free" && plainKey) {
            const { data: rows } = await supabase.from("sandbox_api_keys").select("id").eq("business_id", bizId).order("created_at", { ascending: false }).limit(1);
            if (rows?.length) {
              await supabase.from("sandbox_api_keys").update({ tier, ...limits[tier] }).eq("id", rows[0].id);
            }
          }

          openModal(`
            <div class="modal-title-row"><h3>API Key Generated</h3></div>
            <p style="margin-bottom:10px;font-size:13px;">Copy this key now — it <b>will not be shown again</b>.</p>
            <div style="background:var(--surface-2);padding:12px;border-radius:8px;font-family:monospace;font-size:13px;word-break:break-all;user-select:all;">${escapeHtml(plainKey || "")}</div>
            <div class="flex gap" style="margin-top:14px">
              <button class="btn btn-primary btn-block" data-close-modal>Done</button>
            </div>
          `);

          renderSandboxAdmin(el.closest("[data-route]") || $("view-root"));
        });
      },
    });
  });

  qsa("[data-toggle-key]", el).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const key = keys.find((k) => k.id === btn.dataset.toggleKey);
      if (!key) return;
      await supabase.from("sandbox_api_keys").update({ is_active: !key.is_active }).eq("id", key.id);
      toast(`API key ${key.is_active ? "disabled" : "enabled"}`, "success");
      renderSandboxAdmin(el.closest("[data-route]") || $("view-root"));
    }),
  );

  qsa("[data-change-tier]", el).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const key = keys.find((k) => k.id === btn.dataset.changeTier);
      if (!key) return;
      const tiers = ["free", "starter", "pro"];
      const limits = { free: { rate_limit: 100, daily_limit: 100 }, starter: { rate_limit: 500, daily_limit: 5000 }, pro: { rate_limit: 2000, daily_limit: 50000 } };
      const currentIdx = tiers.indexOf(key.tier);
      const nextTier = tiers[(currentIdx + 1) % tiers.length];
      await supabase.from("sandbox_api_keys").update({ tier: nextTier, ...limits[nextTier] }).eq("id", key.id);
      toast(`Tier changed to ${nextTier}`, "success");
      renderSandboxAdmin(el.closest("[data-route]") || $("view-root"));
    }),
  );
}

function renderInvoicesTab(el, { invoices }) {
  if (!invoices.length) {
    el.innerHTML = '<div class="card"><div class="empty-state">No sandbox invoices generated yet.</div></div>';
    return;
  }

  el.innerHTML = `
    <div class="card">
      <div class="card-title">Recent Sandbox Invoices (${invoices.length})</div>
      <div class="table-wrap" style="max-height:500px;overflow-y:auto;">
        <table>
          <thead><tr><th>Fiscal No.</th><th>Vendor</th><th>TIN</th><th>Amount</th><th>VAT</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            ${invoices.map((inv) => `
              <tr>
                <td><b>${escapeHtml(inv.fiscal_invoice_number)}</b></td>
                <td>${escapeHtml(inv.api_key?.business?.name || inv.api_key?.label || "—")}</td>
                <td><code>${escapeHtml(inv.tin)}</code></td>
                <td>${inv.currency_code} ${Number(inv.gross_amount).toLocaleString()}</td>
                <td>${Number(inv.vat_amount).toLocaleString()}</td>
                <td><span class="badge ${inv.status === "accepted" ? "badge-green" : "badge-red"}">${inv.status}</span></td>
                <td>${fmtDate(inv.created_at)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderUsageTab(el, { usage }) {
  if (!usage.length) {
    el.innerHTML = '<div class="card"><div class="empty-state">No usage logs yet.</div></div>';
    return;
  }

  // Group by endpoint
  const byEndpoint = {};
  usage.forEach((u) => {
    if (!byEndpoint[u.endpoint]) byEndpoint[u.endpoint] = { total: 0, accepted: 0, rejected: 0, errors: 0 };
    byEndpoint[u.endpoint].total++;
    if (u.status === "accepted") byEndpoint[u.endpoint].accepted++;
    else if (u.status === "rejected") byEndpoint[u.endpoint].rejected++;
    else byEndpoint[u.endpoint].errors++;
  });

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">Usage by Endpoint</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
        ${Object.entries(byEndpoint).map(([ep, stats]) => `
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${escapeHtml(ep)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${stats.total} total · ${stats.accepted} ok · ${stats.rejected} rejected</div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Recent Requests</div>
      <div class="table-wrap" style="max-height:400px;overflow-y:auto;">
        <table>
          <thead><tr><th>Time</th><th>Endpoint</th><th>Vendor</th><th>Status</th><th>Response</th></tr></thead>
          <tbody>
            ${usage.slice(0, 100).map((u) => `
              <tr>
                <td style="font-size:12px;">${fmtDate(u.created_at)}</td>
                <td><code style="font-size:11px;">${escapeHtml(u.endpoint)}</code></td>
                <td>${escapeHtml(u.api_key?.label || "—")}</td>
                <td><span class="badge ${u.status === "accepted" ? "badge-green" : u.status === "rejected" ? "badge-red" : "badge-yellow"}">${u.status}</span></td>
                <td style="font-size:12px;">${u.response_time_ms || "—"}ms</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}
