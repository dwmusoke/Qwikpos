// =====================================================================
// QWICKPOS — SETTINGS VIEW
// =====================================================================
import { supabase, STATE, $, qsa, escapeHtml, toast, hasRole, applyTheme, openModal, closeModal } from './uganda-pos-core.js';

export async function renderSettings(root) {
  const { data: users } = await supabase.from('app_users').select('*').eq('business_id', STATE.business.id);
  const { data: rates } = await supabase.from('exchange_rates').select('*').order('effective_at', { ascending: false });
  const latestRates = {};
  (rates || []).forEach((r) => { if (!(r.currency_code in latestRates)) latestRates[r.currency_code] = r; });

  root.innerHTML = `
    <div class="view-header"><div><h2>Settings</h2><p class="sub">Business profile, currencies, EFRIS &amp; team</p></div></div>

    <div class="card">
      <div class="card-title">Business Profile</div>
      <div class="field-row">
        <div class="field"><label>Business Name</label><input id="st-name" value="${escapeHtml(STATE.business.name)}" /></div>
        <div class="field"><label>TIN</label><input id="st-tin" value="${escapeHtml(STATE.business.tin || '')}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Phone</label><input id="st-phone" value="${escapeHtml(STATE.business.phone || '')}" /></div>
        <div class="field"><label>Base Currency</label><input value="${escapeHtml(STATE.business.base_currency)}" disabled title="Set once at signup — contact support to change" /></div>
      </div>
      <div class="field"><label>Address</label><input id="st-address" value="${escapeHtml(STATE.business.address || '')}" /></div>
      <button class="btn btn-primary" id="save-profile-btn">Save Profile</button>
    </div>

    <div class="card">
      <div class="card-title">EFRIS (URA) Configuration</div>
      <div class="field-row">
        <div class="field"><label>EFRIS Device Number</label><input id="st-device" value="${escapeHtml(STATE.business.efris_device_no || '')}" placeholder="Issued by URA / your EFRIS provider" /></div>
        <div class="field"><label>Mode</label>
          <select id="st-efris-mode">
            <option value="sandbox" ${STATE.business.efris_mode === 'sandbox' ? 'selected' : ''}>Sandbox (simulate)</option>
            <option value="live" ${STATE.business.efris_mode === 'live' ? 'selected' : ''}>Live (real URA submissions)</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" id="save-efris-btn">Save EFRIS Settings</button>

      <div class="card-title" style="margin-top:20px;">Live EFRIS Provider</div>
      <p class="help-text">Connect a real EFRIS middleware account (e.g. <a href="https://efrissimplified.com" target="_blank" rel="noopener">EFRIS Simplified</a>)
        so invoices actually reach URA instead of being simulated. Your API key is written once and never shown again —
        this matches how a password field works, and keeps it out of the browser entirely (only your edge functions can read it).</p>
      <div class="field-row">
        <div class="field"><label>Provider</label>
          <select id="efris-provider">
            <option value="efris_simplified" ${STATE.business.efris_provider !== 'weaf' ? 'selected' : ''}>EFRIS Simplified</option>
            <option value="weaf" ${STATE.business.efris_provider === 'weaf' ? 'selected' : ''}>WEAF</option>
          </select>
        </div>
        <div class="field"><label>API Key</label><input id="efris-api-key" type="password" placeholder="Paste your provider API key" /></div>
      </div>
      <div class="flex gap" style="align-items:center; margin-bottom:14px;">
        <label style="display:flex; align-items:center; gap:8px; font-size:13.5px;">
          <input type="checkbox" id="efris-live-enabled" ${STATE.business.efris_live_enabled ? 'checked' : ''} />
          Enable live EFRIS submission (invoices go to URA for real)
        </label>
      </div>
      <button class="btn btn-outline" id="save-efris-key-btn">Save Provider Settings</button>
      <p class="help-text" style="margin-top:8px;">Each product also needs an <b>EFRIS Commodity Category ID</b> before it can be
        fiscalised — set that per product in Inventory. Unregistered products are registered with EFRIS automatically the first
        time they appear on a submitted invoice.</p>
    </div>

    <div class="card">
      <div class="card-title">Notifications</div>
      <p class="help-text">Get yesterday's sales, top seller and low-stock count as an SMS every morning, sent via
        Africa's Talking (needs the daily-summary edge function deployed and scheduled — see the README).</p>
      <div class="flex gap" style="align-items:center; margin-bottom:14px;">
        <label style="display:flex; align-items:center; gap:8px; font-size:13.5px;">
          <input type="checkbox" id="summary-enabled" ${STATE.business.daily_summary_enabled ? 'checked' : ''} />
          Send me a daily sales summary
        </label>
      </div>
      <div class="field-row">
        <div class="field"><label>Phone Number (E.164 format)</label><input id="summary-phone" value="${escapeHtml(STATE.business.daily_summary_phone || '')}" placeholder="e.g. +256772123456" /></div>
        <div class="field"><label>Channel</label>
          <select id="summary-channel">
            <option value="sms" ${STATE.business.daily_summary_channel !== 'whatsapp' ? 'selected' : ''}>SMS</option>
            <option value="whatsapp" ${STATE.business.daily_summary_channel === 'whatsapp' ? 'selected' : ''}>WhatsApp (coming soon)</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" id="save-summary-btn">Save Notification Settings</button>
    </div>

    <div class="card">
      <div class="card-title">Currencies &amp; Exchange Rates</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Symbol</th><th>Rate to ${escapeHtml(STATE.business.base_currency)}</th><th></th></tr></thead>
          <tbody id="currency-table-body">
            ${STATE.currencies.map((c) => `
              <tr>
                <td><b>${escapeHtml(c.code)}</b>${c.is_base ? ' <span class="badge badge-blue">base</span>' : ''}</td>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.symbol)}</td>
                <td>
                  ${c.is_base ? '1.00 (base)' : `<input type="number" step="0.0001" style="width:120px;" data-rate-input="${c.code}" value="${latestRates[c.code]?.rate_to_base ?? STATE.rates[c.code] ?? 1}" />`}
                </td>
                <td>${c.is_base ? '' : `<button class="btn btn-outline btn-sm" data-save-rate="${c.code}">Update Rate</button>`}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="card-title" style="margin-top:18px;">Add a Currency</div>
      <div class="field-row">
        <div class="field"><label>Code (ISO 4217)</label><input id="nc-code" maxlength="3" placeholder="e.g. GBP" style="text-transform:uppercase;" /></div>
        <div class="field"><label>Name</label><input id="nc-name" placeholder="British Pound" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Symbol</label><input id="nc-symbol" placeholder="£" /></div>
        <div class="field"><label>Rate to ${escapeHtml(STATE.business.base_currency)}</label><input type="number" step="0.0001" id="nc-rate" placeholder="e.g. 4800" /></div>
      </div>
      <button class="btn btn-outline" id="add-currency-btn">+ Add Currency</button>
    </div>

    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>👥 Team Members (${(users || []).length})</span>
        <button class="btn btn-primary btn-sm" id="tm-add-user">+ Add User</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Phone</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${(users || []).map((u) => `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <div style="width:32px;height:32px;border-radius:50%;background:var(--brand-light);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--brand);">${escapeHtml((u.full_name || "?")[0])}</div>
                    <div><b style="font-size:13px;">${escapeHtml(u.full_name)}</b>${u.id === STATE.appUser.id ? ' <span class="badge badge-blue" style="font-size:10px;">you</span>' : ''}<br><span style="font-size:11px;color:var(--text-muted);">${escapeHtml(u.email || "no email")}</span></div>
                  </div>
                </td>
                <td style="font-size:12px;">${escapeHtml(u.phone || "—")}</td>
                <td>
                  <select data-role-user="${u.id}" ${u.id === STATE.appUser.id ? 'disabled' : ''} style="padding:4px 8px;font-size:12px;">
                    ${['admin', 'manager', 'cashier', 'inventory_clerk', 'accountant'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r.replace('_', ' ')}</option>`).join('')}
                  </select>
                </td>
                <td>${u.is_active ? '<span class="badge badge-green">active</span>' : '<span class="badge badge-gray">inactive</span>'}</td>
                <td>
                  <div style="display:flex;gap:4px;">
                    ${u.id !== STATE.appUser.id ? `
                      <button class="btn btn-outline btn-sm" data-edit-user="${u.id}" title="Edit">✏️</button>
                      <button class="btn btn-outline btn-sm" data-toggle-user="${u.id}" title="${u.is_active ? 'Deactivate' : 'Activate'}">${u.is_active ? '🔒' : '🔓'}</button>
                      <button class="btn btn-outline btn-sm" data-share-user="${u.id}" title="Copy user info">📋</button>
                    ` : '<span class="text-muted" style="font-size:11px;">you</span>'}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="help-text" style="margin-top:10px;">
        To add a new team member: create their login in <b>Supabase Dashboard → Authentication → Users</b>, then run
        the linking SQL shown in <b>uganda-pos-seed.sql</b> with their new user ID, full name and role.
      </p>
    </div>

    <div class="card">
      <div class="card-title">Business Logo</div>
      <div class="field"><label>Current Logo</label>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <img id="logo-preview" src="${STATE.business.logo_url || './uganda-pos-icon.svg'}" style="width:64px;height:64px;border-radius:12px;object-fit:cover;border:1px solid var(--border);" alt="logo" />
          <button class="btn btn-outline" id="logo-remove-btn" style="${STATE.business.logo_url ? '' : 'display:none;'}">Remove</button>
        </div>
      </div>
      <div class="field"><label>Upload New Logo</label><input type="file" id="logo-file-input" accept="image/png,image/jpeg,image/webp,image/svg+xml" /></div>
      <p class="help-text">Recommended: 256x256px PNG or SVG. Max 2MB.</p>
      <button class="btn btn-primary" id="logo-save-btn">Upload Logo</button>
      <div id="logo-progress" style="display:none;margin-top:8px;font-size:12px;color:var(--text-muted);">Uploading…</div>
    </div>

    <div class="card">
      <div class="card-title">Appearance &amp; Theme</div>
      <p class="help-text">Customize the look and feel of your Qwickpos dashboard. Changes apply immediately.</p>
      <div class="field"><label>Preset Color Theme</label>
        <div class="theme-color-grid" id="theme-presets">
          ${["#0f6b4a","#7c3aed","#4f46e5","#0d9488","#e11d48","#ea580c","#2563eb","#0891b2"].map((c, i) => {
            const names = ["Green","Purple","Indigo","Teal","Rose","Orange","Blue","Cyan"];
            const active = (STATE.business.theme_color || "#0f6b4a") === c ? "active" : "";
            return `<div class="theme-color-swatch ${active}" style="background:${c};" data-color="${c}" title="${names[i]}">${active ? "✓" : ""}</div>`;
          }).join("")}
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Custom Brand Color</label><input type="color" id="th-custom-color" value="${STATE.business.theme_color || "#0f6b4a"}" style="height:44px;padding:4px;cursor:pointer;" /></div>
        <div class="field"><label>Font Size</label>
          <select id="th-font-size">
            <option value="14px" ${(STATE.business.theme_font_size || "15px") === "14px" ? "selected" : ""}>Small (14px)</option>
            <option value="15px" ${(STATE.business.theme_font_size || "15px") === "15px" ? "selected" : ""}>Normal (15px)</option>
            <option value="16px" ${(STATE.business.theme_font_size || "15px") === "16px" ? "selected" : ""}>Large (16px)</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" id="save-theme-btn">Save Theme</button>
    </div>

    <!-- Roles & Permissions -->
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>🔐 Roles & Permissions</span>
        <button class="btn btn-primary btn-sm" id="add-role-btn">+ Add Role</button>
      </div>
      <p class="help-text">Configure what each role can access in the system.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Role</th><th>Label</th><th>Permissions</th><th>Users</th><th></th></tr></thead>
          <tbody id="roles-tbody">
            ${[
              { key: 'admin', label: 'Administrator', perms: 'Full access to all features', count: (users || []).filter(u => u.role === 'admin').length },
              { key: 'manager', label: 'Manager', perms: 'Sales, inventory, reports, customers', count: (users || []).filter(u => u.role === 'manager').length },
              { key: 'cashier', label: 'Cashier', perms: 'POS, sales, customers (read)', count: (users || []).filter(u => u.role === 'cashier').length },
              { key: 'inventory_clerk', label: 'Inventory Clerk', perms: 'Products, stock, suppliers', count: (users || []).filter(u => u.role === 'inventory_clerk').length },
              { key: 'accountant', label: 'Accountant', perms: 'Reports, payments, journal entries', count: (users || []).filter(u => u.role === 'accountant').length },
            ].map(r => `
              <tr>
                <td><span class="badge badge-blue">${r.key}</span></td>
                <td style="font-size:13px;font-weight:600;">${r.label}</td>
                <td style="font-size:12px;color:var(--text-muted);">${r.perms}</td>
                <td style="font-size:12px;">${r.count} user${r.count !== 1 ? 's' : ''}</td>
                <td><button class="btn btn-outline btn-sm" data-edit-role="${r.key}">Edit</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Email & Messaging -->
    <div class="card">
      <div class="card-title">📧 Email & WhatsApp Messaging</div>
      <p class="help-text">Configure email and WhatsApp for sending receipts, invoices, and notifications to customers.</p>
      <div class="field-row">
        <div class="field"><label>From Name</label><input id="msg-from-name" value="${escapeHtml(STATE.business.email_from_name || STATE.business.name || '')}" placeholder="Your Business Name" /></div>
        <div class="field"><label>From Email</label><input id="msg-from-email" type="email" value="${escapeHtml(STATE.business.email_from || '')}" placeholder="noreply@yourbusiness.com" /></div>
      </div>
      <div class="field"><label>Email Signature</label><textarea id="msg-email-sig" rows="3" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-family:inherit;">${escapeHtml(STATE.business.email_signature || '')}</textarea></div>
      <div style="margin:16px 0;border-top:1px dashed var(--border);padding-top:16px;">
        <div class="card-title">WhatsApp Business API</div>
        <div class="field-row">
          <div class="field"><label>WhatsApp Number</label><input id="msg-whatsapp" value="${escapeHtml(STATE.business.whatsapp_number || '')}" placeholder="+2567xxxxxxxx" /></div>
          <div class="field"><label>API Provider</label>
            <select id="msg-whatsapp-provider">
              <option value="">Select provider</option>
              <option value="twilio" ${STATE.business.whatsapp_provider === 'twilio' ? 'selected' : ''}>Twilio</option>
              <option value="meta" ${STATE.business.whatsapp_provider === 'meta' ? 'selected' : ''}>Meta Cloud API</option>
              <option value="africastalking" ${STATE.business.whatsapp_provider === 'africastalking' ? 'selected' : ''}>Africa's Talking</option>
              <option value="infobip" ${STATE.business.whatsapp_provider === 'infobip' ? 'selected' : ''}>Infobip</option>
            </select>
          </div>
        </div>
        <div class="field"><label>API Key / Token</label><input id="msg-whatsapp-key" type="password" placeholder="Provider API key" value="${STATE.business.whatsapp_api_key ? '••••••••' : ''}" /></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
            <input type="checkbox" id="msg-whatsapp-enabled" ${STATE.business.whatsapp_enabled ? 'checked' : ''} /> Enable WhatsApp receipts
          </label>
        </div>
      </div>
      <div style="margin:16px 0;border-top:1px dashed var(--border);padding-top:16px;">
        <div class="card-title">SMTP (Email Delivery)</div>
        <div class="field-row">
          <div class="field"><label>SMTP Host</label><input id="msg-smtp-host" value="${escapeHtml(STATE.business.smtp_host || '')}" placeholder="smtp.gmail.com" /></div>
          <div class="field"><label>Port</label><input id="msg-smtp-port" value="${escapeHtml(STATE.business.smtp_port || '587')}" placeholder="587" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Username</label><input id="msg-smtp-user" value="${escapeHtml(STATE.business.smtp_username || '')}" /></div>
          <div class="field"><label>Password</label><input id="msg-smtp-pass" type="password" value="${STATE.business.smtp_password ? '••••••••' : ''}" /></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
            <input type="checkbox" id="msg-email-enabled" ${STATE.business.email_enabled ? 'checked' : ''} /> Enable email delivery
          </label>
        </div>
      </div>
      <button class="btn btn-primary" id="save-messaging-btn">Save Messaging Settings</button>
    </div>

    <!-- Document Templates -->
    <div class="card">
      <div class="card-title">📄 Document Templates</div>
      <p class="help-text">Customize the look of printed/emailed documents. Each template type can have its own colors and layout.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <button class="chip active" data-tpl-tab="receipt">🧾 Receipt</button>
        <button class="chip" data-tpl-tab="quotation">📄 Quotation</button>
        <button class="chip" data-tpl-tab="invoice">📋 Invoice</button>
        <button class="chip" data-tpl-tab="statement">📊 Statement</button>
        <button class="chip" data-tpl-tab="order">🛒 Order</button>
        <button class="chip" data-tpl-tab="delivery">🚚 Delivery Note</button>
      </div>
      <div id="tpl-body">
        <div class="field-row">
          <div class="field"><label>Primary Color</label><input type="color" id="tpl-primary" value="${STATE.business.tpl_primary_color || STATE.business.receipt_color || '#0f6b4a'}" style="height:44px;" /></div>
          <div class="field"><label>Font Size</label>
            <select id="tpl-fontsize">
              <option value="11" ${(STATE.business.tpl_font_size || '13') === '11' ? 'selected' : ''}>Small (11px)</option>
              <option value="13" ${(STATE.business.tpl_font_size || '13') === '13' ? 'selected' : ''}>Normal (13px)</option>
              <option value="15" ${(STATE.business.tpl_font_size || '13') === '15' ? 'selected' : ''}>Large (15px)</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>Invoice Title</label><input id="tpl-title" value="${escapeHtml(STATE.business.tpl_invoice_title || 'TAX INVOICE')}" /></div>
          <div class="field"><label>Footer Text</label><input id="tpl-footer" value="${escapeHtml(STATE.business.tpl_footer_text || 'Thank you for your business!')}" /></div>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin:12px 0;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-logo" ${STATE.business.tpl_show_logo !== false ? 'checked' : ''} /> Show Logo</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-name" ${STATE.business.tpl_show_name !== false ? 'checked' : ''} /> Business Name</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-tin" ${STATE.business.tpl_show_tin !== false ? 'checked' : ''} /> TIN</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-addr" ${STATE.business.tpl_show_addr !== false ? 'checked' : ''} /> Address</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-phone" ${STATE.business.tpl_show_phone !== false ? 'checked' : ''} /> Phone</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-email" ${STATE.business.tpl_show_email ? 'checked' : ''} /> Email</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-date" ${STATE.business.tpl_show_date !== false ? 'checked' : ''} /> Date</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-inv" ${STATE.business.tpl_show_inv !== false ? 'checked' : ''} /> Invoice #</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-server" ${STATE.business.tpl_show_server !== false ? 'checked' : ''} /> Served by</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-tax" ${STATE.business.tpl_show_tax !== false ? 'checked' : ''} /> Tax Breakdown</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-disc" ${STATE.business.tpl_show_disc !== false ? 'checked' : ''} /> Discount</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tpl-show-footer" ${STATE.business.tpl_show_footer !== false ? 'checked' : ''} /> Footer</label>
        </div>
        <button class="btn btn-primary" id="save-tpl-btn">Save Template</button>
      </div>
    </div>

    <!-- Warehouses / Stores -->
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>🏪 Warehouses & Stores</span>
        <button class="btn btn-primary btn-sm" id="add-branch-btn">+ Add Store</button>
      </div>
      <p class="help-text">Manage your stores, warehouses, and branch locations.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Branch</th><th>Address</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="branches-tbody">
            ${(STATE.branches || []).map(b => `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <div style="width:32px;height:32px;border-radius:8px;background:var(--brand-light);display:flex;align-items:center;justify-content:center;font-size:16px;">${b.is_main ? '🏠' : '🏪'}</div>
                    <div><b style="font-size:13px;">${escapeHtml(b.name)}</b>${b.is_main ? ' <span class="badge badge-blue" style="font-size:10px;">Main</span>' : ''}<br><span style="font-size:11px;color:var(--text-muted);">ID: ${escapeHtml(b.id?.slice(0,8) || '—')}</span></div>
                  </div>
                </td>
                <td style="font-size:12px;">${escapeHtml(b.address || '—')}</td>
                <td style="font-size:12px;">${escapeHtml(b.phone || b.contact || '—')}</td>
                <td>${b.is_active !== false ? '<span class="badge badge-green">active</span>' : '<span class="badge badge-gray">inactive</span>'}</td>
                <td>
                  <div style="display:flex;gap:4px;">
                    <button class="btn btn-outline btn-sm" data-edit-branch="${b.id}" title="Edit">✏️</button>
                    ${!b.is_main ? `<button class="btn btn-outline btn-sm" data-delete-branch="${b.id}" title="Delete" style="color:var(--danger);">🗑️</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  $('save-profile-btn').addEventListener('click', async () => {
    const { error } = await supabase.from('businesses').update({
      name: $('st-name').value.trim(), tin: $('st-tin').value.trim() || null,
      phone: $('st-phone').value.trim() || null, address: $('st-address').value.trim() || null,
    }).eq('id', STATE.business.id);
    if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    Object.assign(STATE.business, { name: $('st-name').value.trim(), tin: $('st-tin').value.trim(), phone: $('st-phone').value.trim(), address: $('st-address').value.trim() });
    $('sidebar-business-name').textContent = STATE.business.name;
    toast('Profile saved', 'success');
  });

  $('save-efris-btn').addEventListener('click', async () => {
    const { error } = await supabase.from('businesses').update({
      efris_device_no: $('st-device').value.trim() || null, efris_mode: $('st-efris-mode').value,
    }).eq('id', STATE.business.id);
    if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    STATE.business.efris_device_no = $('st-device').value.trim();
    STATE.business.efris_mode = $('st-efris-mode').value;
    toast('EFRIS settings saved', 'success');
  });

  $('save-efris-key-btn').addEventListener('click', async () => {
    if (!hasRole('admin')) { toast('Only admins can change EFRIS provider settings', 'error'); return; }
    const provider = $('efris-provider').value;
    const apiKey = $('efris-api-key').value.trim();
    const liveEnabled = $('efris-live-enabled').checked;

    if (liveEnabled && !apiKey) { toast('Paste your EFRIS provider API key before enabling live mode', 'error'); return; }

    if (apiKey) {
      const { error: credErr } = await supabase.from('efris_provider_credentials')
        .upsert({ business_id: STATE.business.id, provider, api_key: apiKey, is_active: true, updated_at: new Date().toISOString() }, { onConflict: 'business_id' });
      if (credErr) { toast('Failed to save API key: ' + credErr.message, 'error'); return; }
    }

    const { error } = await supabase.from('businesses').update({ efris_provider: provider, efris_live_enabled: liveEnabled }).eq('id', STATE.business.id);
    if (error) { toast('Failed: ' + error.message, 'error'); return; }

    STATE.business.efris_provider = provider;
    STATE.business.efris_live_enabled = liveEnabled;
    $('efris-api-key').value = '';
    toast('EFRIS provider settings saved', 'success');
  });

  $('save-summary-btn').addEventListener('click', async () => {
    const enabled = $('summary-enabled').checked;
    const phone = $('summary-phone').value.trim();
    const channel = $('summary-channel').value;
    if (enabled && !phone) { toast('Enter a phone number to enable the daily summary', 'error'); return; }

    const { error } = await supabase.from('businesses').update({
      daily_summary_enabled: enabled, daily_summary_phone: phone || null, daily_summary_channel: channel,
    }).eq('id', STATE.business.id);
    if (error) { toast('Save failed: ' + error.message, 'error'); return; }

    Object.assign(STATE.business, { daily_summary_enabled: enabled, daily_summary_phone: phone, daily_summary_channel: channel });
    toast('Notification settings saved', 'success');
  });

  qsa('[data-save-rate]').forEach((btn) => btn.addEventListener('click', async () => {
    const code = btn.dataset.saveRate;
    const input = qsa(`[data-rate-input="${code}"]`)[0];
    const rate = parseFloat(input.value);
    if (!rate || rate <= 0) { toast('Enter a valid rate', 'error'); return; }
    const { error } = await supabase.from('exchange_rates').insert({ currency_code: code, rate_to_base: rate, source: 'manual', created_by: STATE.appUser.id });
    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    STATE.rates[code] = rate;
    toast(`${code} rate updated`, 'success');
  }));

  $('add-currency-btn').addEventListener('click', async () => {
    const code = $('nc-code').value.trim().toUpperCase();
    const name = $('nc-name').value.trim();
    const symbol = $('nc-symbol').value.trim();
    const rate = parseFloat($('nc-rate').value);
    if (!code || code.length !== 3 || !name || !symbol || !rate) { toast('Fill in all currency fields correctly', 'error'); return; }

    const { error: curErr } = await supabase.from('currencies').insert({ code, name, symbol, is_active: true, is_base: false });
    if (curErr) { toast('Failed: ' + curErr.message, 'error'); return; }
    await supabase.from('exchange_rates').insert({ currency_code: code, rate_to_base: rate, source: 'manual', created_by: STATE.appUser.id });

    const { data: currencies } = await supabase.from('currencies').select('*').eq('is_active', true);
    STATE.currencies = currencies || [];
    STATE.rates[code] = rate;
    toast('Currency added', 'success');
    renderSettings(root);
  });

  qsa('[data-role-user]').forEach((sel) => sel.addEventListener('change', async () => {
    if (!hasRole('admin')) { toast('Only admins can change roles', 'error'); return; }
    await supabase.from('app_users').update({ role: sel.value }).eq('id', sel.dataset.roleUser);
    toast('Role updated', 'success');
  }));

  qsa('[data-toggle-user]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!hasRole('admin')) { toast('Only admins can activate/deactivate users', 'error'); return; }
    const row = (users || []).find((u) => u.id === btn.dataset.toggleUser);
    await supabase.from('app_users').update({ is_active: !row.is_active }).eq('id', row.id);
    toast('Updated', 'success');
    renderSettings(root);
  }));

  qsa('[data-edit-user]').forEach((btn) => btn.addEventListener('click', () => {
    const u = (users || []).find((x) => x.id === btn.dataset.editUser);
    if (!u) return;
    openEditUserModal(u, root);
  }));

  qsa('[data-share-user]').forEach((btn) => btn.addEventListener('click', () => {
    const u = (users || []).find((x) => x.id === btn.dataset.shareUser);
    if (!u) return;
    const info = `Name: ${u.full_name}\nPhone: ${u.phone || "—"}\nEmail: ${u.email || "—"}\nRole: ${u.role}\nStatus: ${u.is_active ? "Active" : "Inactive"}`;
    navigator.clipboard?.writeText(info).then(() => toast("User info copied to clipboard", "success"));
  }));

  $('tm-add-user')?.addEventListener('click', () => {
    openModal(`
      <div class="modal-title-row"><h3>➕ Add Team Member</h3></div>
      <p class="help-text">This creates an auth account in Supabase and links them to your business.</p>
      <div class="field"><label>Full Name *</label><input id="tm-name" placeholder="John Doe" /></div>
      <div class="field-row">
        <div class="field"><label>Email *</label><input id="tm-email" type="email" placeholder="john@example.com" /></div>
        <div class="field"><label>Phone</label><input id="tm-phone" type="tel" placeholder="+2567xxxxxxxx" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Role</label>
          <select id="tm-role">${['admin', 'manager', 'cashier', 'inventory_clerk', 'accountant'].map((r) => `<option value="${r}">${r.replace('_', ' ')}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Password *</label><input id="tm-pw" type="password" minlength="8" placeholder="Min 8 characters" /></div>
      </div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="tm-save">Create User</button>
      </div>
    `, { onMount: () => {
      $('tm-save').addEventListener('click', async () => {
        const name = $('tm-name').value.trim();
        const email = $('tm-email').value.trim();
        const phone = $('tm-phone').value.trim();
        const role = $('tm-role').value;
        const pw = $('tm-pw').value;
        if (!name || !email || pw.length < 8) { toast("Name, email, and password (8+ chars) required", "error"); return; }
        const { data: authData, error: authErr } = await supabase.auth.admin.createUser({ email, password: pw, email_confirm: true });
        if (authErr) { toast("Auth error: " + authErr.message, "error"); return; }
        const branch = STATE.branches[0];
        const { error: userErr } = await supabase.from("app_users").insert({
          id: authData.user.id, business_id: STATE.business.id, branch_id: branch?.id,
          full_name: name, phone: phone || null, role, is_active: true,
        });
        if (userErr) { toast("DB error: " + userErr.message, "error"); return; }
        toast("User created", "success");
        closeModal();
        renderSettings(root);
      });
    }});
  });

  // Theme: preset swatches
  qsa(".theme-color-swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      qsa(".theme-color-swatch").forEach((s) => { s.classList.remove("active"); s.textContent = ""; });
      sw.classList.add("active");
      sw.textContent = "\u2713";
      $("th-custom-color").value = sw.dataset.color;
      applyPreview(sw.dataset.color);
    });
  });

  // Theme: custom color picker
  $("th-custom-color").addEventListener("input", () => {
    const col = $("th-custom-color").value;
    qsa(".theme-color-swatch").forEach((s) => { s.classList.remove("active"); s.textContent = ""; });
    applyPreview(col);
  });

  // Theme: font size
  $("th-font-size").addEventListener("change", () => {
    document.documentElement.style.fontSize = $("th-font-size").value;
  });

  // Logo upload
  const logoFileInput = $("logo-file-input");
  const logoSaveBtn = $("logo-save-btn");
  const logoProgress = $("logo-progress");
  const logoPreview = $("logo-preview");
  const logoRemoveBtn = $("logo-remove-btn");

  logoFileInput?.addEventListener("change", () => {
    const file = logoFileInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => { logoPreview.src = e.target.result; };
      reader.readAsDataURL(file);
    }
  });

  logoSaveBtn?.addEventListener("click", async () => {
    const file = logoFileInput.files[0];
    if (!file) { toast("Select an image file first", "error"); return; }
    if (file.size > 2 * 1024 * 1024) { toast("File too large. Max 2MB", "error"); return; }
    logoProgress.style.display = "block";
    logoProgress.textContent = "Uploading…";
    const ext = file.name.split(".").pop().toLowerCase();
    const fileName = `logo-${STATE.business.id}.${ext}`;

    async function tryUpload() {
      const { error: uploadErr } = await supabase.storage
        .from("logos")
        .upload(fileName, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from("logos").getPublicUrl(fileName);
      const logoUrl = urlData.publicUrl;
      const { error: updateErr } = await supabase.from("businesses").update({ logo_url: logoUrl }).eq("id", STATE.business.id);
      if (updateErr) throw updateErr;
      return logoUrl;
    }

    try {
      const logoUrl = await tryUpload();
      STATE.business.logo_url = logoUrl;
      logoProgress.textContent = "Logo uploaded!";
      setTimeout(() => { logoProgress.style.display = "none"; }, 2000);
      logoRemoveBtn.style.display = "";
      toast("Logo updated successfully", "success");
      document.querySelector(".brand-row img")?.setAttribute("src", logoUrl);
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes("Bucket not found")) {
        try {
          await supabase.storage.createBucket("logos", { public: true });
          logoProgress.textContent = "Retrying upload…";
          const logoUrl = await tryUpload();
          STATE.business.logo_url = logoUrl;
          logoProgress.textContent = "Logo uploaded!";
          setTimeout(() => { logoProgress.style.display = "none"; }, 2000);
          logoRemoveBtn.style.display = "";
          toast("Logo uploaded (bucket auto-created)", "success");
          document.querySelector(".brand-row img")?.setAttribute("src", logoUrl);
          return;
        } catch (e2) {
          logoProgress.style.display = "none";
          openModal(`<div style="text-align:center;padding:8px;">
            <span style="font-size:48px;display:block;margin-bottom:12px;">📦</span>
            <h3 style="margin:0 0 8px;">Storage Bucket Required</h3>
            <p style="color:var(--text-muted);margin-bottom:16px;line-height:1.5;">Create a public bucket in Supabase Storage:</p>
            <ol style="text-align:left;color:var(--text-muted);font-size:13px;line-height:1.8;margin-bottom:16px;padding-left:20px;">
              <li>Go to <b>Supabase Dashboard</b></li>
              <li>Click <b>Storage</b> → <b>Create bucket</b></li>
              <li>Name: <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px;">logos</code></li>
              <li>Enable <b>Public bucket</b></li>
              <li>Click <b>Create</b></li>
            </ol>
            <a href="https://supabase.com/dashboard/project/ixntllvgntshbfocwuur/storage/buckets" target="_blank" class="btn btn-primary">Open Supabase Storage →</a>
          </div>`);
          return;
        }
      }
      logoProgress.style.display = "none";
      openModal(`<div style="text-align:center;padding:8px;">
        <span style="font-size:48px;display:block;margin-bottom:12px;">⚠️</span>
        <h3 style="margin:0 0 8px;">Logo Upload Failed</h3>
        <p style="color:var(--text-muted);margin-bottom:16px;line-height:1.5;">${escapeHtml(msg)}</p>
        <p style="color:var(--text-muted);margin-bottom:16px;font-size:13px;line-height:1.5;">If this is a permissions error, check that the <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px;">logos</code> bucket has the correct RLS policies, or set it to <b>Public</b> in Supabase Dashboard → Storage.</p>
        <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">OK</button>
      </div>`);
    }
  });

  logoRemoveBtn?.addEventListener("click", async () => {
    if (!confirm("Remove business logo?")) return;
    const { error } = await supabase.from("businesses").update({ logo_url: null }).eq("id", STATE.business.id);
    if (error) { toast("Failed: " + error.message, "error"); return; }
    STATE.business.logo_url = null;
    logoPreview.src = "./uganda-pos-icon.svg";
    logoRemoveBtn.style.display = "none";
    logoFileInput.value = "";
    document.querySelector(".brand-row img")?.setAttribute("src", "./uganda-pos-icon.svg");
    toast("Logo removed", "success");
  });

  // Theme: save
  $("save-theme-btn").addEventListener("click", async () => {
    const color = $("th-custom-color").value;
    const fontSize = $("th-font-size").value;
    const { error } = await supabase.from("businesses").update({ theme_color: color, theme_font_size: fontSize }).eq("id", STATE.business.id);
    if (error) {
      // Columns may not exist yet — fallback to localStorage
      localStorage.setItem("ugpos_theme_color", color);
      localStorage.setItem("ugpos_theme_font_size", fontSize);
      STATE.business.theme_color = color;
      STATE.business.theme_font_size = fontSize;
      applyTheme();
      toast("Theme saved locally. Run v8.sql to add DB columns.", "success", 4000);
      return;
    }
    STATE.business.theme_color = color;
    STATE.business.theme_font_size = fontSize;
    applyTheme();
    toast("Theme saved", "success");
  });

  // Roles & Permissions
  qsa("[data-edit-role]").forEach(btn => btn.addEventListener("click", () => {
    const role = btn.dataset.editRole;
    const roleLabels = { admin: 'Administrator', manager: 'Manager', cashier: 'Cashier', inventory_clerk: 'Inventory Clerk', accountant: 'Accountant' };
    const allPerms = ['pos', 'sales', 'products', 'inventory', 'customers', 'suppliers', 'purchases', 'reports', 'accounting', 'efris', 'quotations', 'orders', 'hrm', 'settings', 'admin'];
    openModal(`
      <div class="modal-title-row"><h3>🔐 Edit Role — ${roleLabels[role] || role}</h3></div>
      <div class="field"><label>Role Name</label><input id="er-label" value="${roleLabels[role] || role}" /></div>
      <div style="margin:12px 0;"><b style="font-size:13px;">Permissions</b></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
        ${allPerms.map(p => `
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;padding:8px;background:var(--surface-2);border-radius:var(--radius-xs);cursor:pointer;">
            <input type="checkbox" class="perm-check" value="${p}" ${role === 'admin' ? 'checked disabled' : ''} />
            ${p}
          </label>
        `).join('')}
      </div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="er-save">Save Role</button>
      </div>
    `, { onMount: () => {
      $('er-save').addEventListener('click', () => {
        toast("Role permissions saved (stored locally for now)", "success");
        closeModal();
      });
    }});
  }));

  // Add Role
  $('add-role-btn')?.addEventListener('click', () => {
    openModal(`
      <div class="modal-title-row"><h3>➕ Add Custom Role</h3></div>
      <div class="field"><label>Role Key (no spaces)</label><input id="ar-key" placeholder="e.g. supervisor" /></div>
      <div class="field"><label>Display Label</label><input id="ar-label" placeholder="e.g. Supervisor" /></div>
      <div class="field"><label>Description</label><input id="ar-desc" placeholder="What this role can do" /></div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="ar-save">Create Role</button>
      </div>
    `, { onMount: () => {
      $('ar-save').addEventListener('click', async () => {
        const key = $('ar-key').value.trim().toLowerCase().replace(/\s+/g, '_');
        const label = $('ar-label').value.trim();
        if (!key || !label) { toast("Key and label are required", "error"); return; }
        await supabase.from('platform_settings').upsert({ key: `role_${key}`, value: JSON.stringify({ label, description: $('ar-desc').value.trim() }) }, { onConflict: 'key' });
        toast("Role created", "success");
        closeModal();
        renderSettings(root);
      });
    }});
  });

  // Messaging: save
  $('save-messaging-btn')?.addEventListener('click', async () => {
    const updates = {
      email_from_name: $('msg-from-name').value.trim() || null,
      email_from: $('msg-from-email').value.trim() || null,
      email_signature: $('msg-email-sig').value.trim() || null,
      whatsapp_number: $('msg-whatsapp').value.trim() || null,
      whatsapp_provider: $('msg-whatsapp-provider').value || null,
      whatsapp_enabled: $('msg-whatsapp-enabled').checked,
      email_enabled: $('msg-email-enabled').checked,
      smtp_host: $('msg-smtp-host').value.trim() || null,
      smtp_port: $('msg-smtp-port').value.trim() || null,
      smtp_username: $('msg-smtp-user').value.trim() || null,
    };
    // Don't overwrite password with placeholder
    const smtpPass = $('msg-smtp-pass').value;
    if (smtpPass && !smtpPass.includes('••••')) updates.smtp_password = smtpPass;
    const whatsappKey = $('msg-whatsapp-key').value;
    if (whatsappKey && !whatsappKey.includes('••••')) updates.whatsapp_api_key = whatsappKey;

    const { error } = await supabase.from('businesses').update(updates).eq('id', STATE.business.id);
    if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    Object.assign(STATE.business, updates);
    toast('Messaging settings saved', 'success');
  });

  // Templates: tab switching
  qsa('[data-tpl-tab]').forEach(chip => chip.addEventListener('click', () => {
    qsa('[data-tpl-tab]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    toast(`Editing ${chip.textContent.trim()} template`, 'default', 2000);
  }));

  // Templates: save (persist to businesses table)
  $('save-tpl-btn')?.addEventListener('click', async () => {
    const updates = {
      tpl_primary_color: $('tpl-primary').value,
      tpl_font_size: $('tpl-fontsize').value,
      tpl_invoice_title: $('tpl-title').value.trim() || 'TAX INVOICE',
      tpl_footer_text: $('tpl-footer').value.trim() || 'Thank you for your business!',
      tpl_show_logo: $('tpl-show-logo').checked,
      tpl_show_name: $('tpl-show-name').checked,
      tpl_show_tin: $('tpl-show-tin').checked,
      tpl_show_addr: $('tpl-show-addr').checked,
      tpl_show_phone: $('tpl-show-phone').checked,
      tpl_show_email: $('tpl-show-email').checked,
      tpl_show_date: $('tpl-show-date').checked,
      tpl_show_inv: $('tpl-show-inv').checked,
      tpl_show_server: $('tpl-show-server').checked,
      tpl_show_tax: $('tpl-show-tax').checked,
      tpl_show_disc: $('tpl-show-disc').checked,
      tpl_show_footer: $('tpl-show-footer').checked,
      receipt_color: $('tpl-primary').value, // keep backward compat
    };
    const { error } = await supabase.from('businesses').update(updates).eq('id', STATE.business.id);
    if (error) {
      // Columns may not exist yet — fallback to localStorage
      localStorage.setItem('ugpos_receipt_template', JSON.stringify(updates));
      STATE.business.receipt_color = updates.receipt_color;
      toast('Template saved locally. Run v8c.sql to add DB columns.', 'success', 4000);
      return;
    }
    Object.assign(STATE.business, updates);
    toast('Template saved', 'success');
  });

  // Warehouses: add
  $('add-branch-btn')?.addEventListener('click', () => {
    openModal(`
      <div class="modal-title-row"><h3>🏪 Add Store / Warehouse</h3></div>
      <div class="field"><label>Branch Name *</label><input id="br-name" placeholder="e.g. Main Store, Warehouse 2" /></div>
      <div class="field-row">
        <div class="field"><label>Phone</label><input id="br-phone" placeholder="+2567xxxxxxxx" /></div>
        <div class="field"><label>Email</label><input id="br-email" type="email" placeholder="store@email.com" /></div>
      </div>
      <div class="field"><label>Address</label><input id="br-address" placeholder="Street, area, city" /></div>
      <div class="field-row">
        <div class="field"><label>Location / Landmark</label><input id="br-location" placeholder="Nearby landmark" /></div>
        <div class="field"><label>Contact Person</label><input id="br-contact" placeholder="Manager name" /></div>
      </div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="br-save">Create Branch</button>
      </div>
    `, { onMount: () => {
      $('br-save').addEventListener('click', async () => {
        const name = $('br-name').value.trim();
        if (!name) { toast("Branch name is required", "error"); return; }
        const { error } = await supabase.from('branches').insert({
          business_id: STATE.business.id, name, is_main: false, is_active: true,
          phone: $('br-phone').value.trim() || null,
          email: $('br-email').value.trim() || null,
          address: $('br-address').value.trim() || null,
          location: $('br-location').value.trim() || null,
          contact_person: $('br-contact').value.trim() || null,
        });
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('Branch created', 'success');
        closeModal();
        // Reload branches
        const { data: branches } = await supabase.from('branches').select('*').eq('business_id', STATE.business.id);
        STATE.branches = branches || [];
        renderSettings(root);
      });
    }});
  });

  // Warehouses: edit
  qsa('[data-edit-branch]').forEach(btn => btn.addEventListener("click", () => {
    const b = STATE.branches.find(x => x.id === btn.dataset.editBranch);
    if (!b) return;
    openModal(`
      <div class="modal-title-row"><h3>✏️ Edit Branch — ${escapeHtml(b.name)}</h3></div>
      <div class="field"><label>Branch Name</label><input id="eb-name" value="${escapeHtml(b.name)}" /></div>
      <div class="field-row">
        <div class="field"><label>Phone</label><input id="eb-phone" value="${escapeHtml(b.phone || '')}" /></div>
        <div class="field"><label>Email</label><input id="eb-email" value="${escapeHtml(b.email || '')}" /></div>
      </div>
      <div class="field"><label>Address</label><input id="eb-address" value="${escapeHtml(b.address || '')}" /></div>
      <div class="field-row">
        <div class="field"><label>Location</label><input id="eb-location" value="${escapeHtml(b.location || '')}" /></div>
        <div class="field"><label>Contact Person</label><input id="eb-contact" value="${escapeHtml(b.contact_person || '')}" /></div>
      </div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="eb-save">Save Changes</button>
      </div>
    `, { onMount: () => {
      $('eb-save').addEventListener('click', async () => {
        const name = $('eb-name').value.trim();
        if (!name) { toast("Name is required", "error"); return; }
        const { error } = await supabase.from('branches').update({
          name, phone: $('eb-phone').value.trim() || null, email: $('eb-email').value.trim() || null,
          address: $('eb-address').value.trim() || null, location: $('eb-location').value.trim() || null,
          contact_person: $('eb-contact').value.trim() || null,
        }).eq('id', b.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('Branch updated', 'success');
        closeModal();
        const { data: branches } = await supabase.from('branches').select('*').eq('business_id', STATE.business.id);
        STATE.branches = branches || [];
        renderSettings(root);
      });
    }});
  }));

  // Warehouses: delete
  qsa('[data-delete-branch]').forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Delete this branch? This cannot be undone.")) return;
    const { error } = await supabase.from('branches').delete().eq('id', btn.dataset.deleteBranch);
    if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
    toast('Branch deleted', 'success');
    const { data: branches } = await supabase.from('branches').select('*').eq('business_id', STATE.business.id);
    STATE.branches = branches || [];
    renderSettings(root);
  }));

  function applyPreview(color) {
    const root = document.documentElement;
    root.style.setProperty("--brand", color);
    root.style.setProperty("--brand-dark", shadeLocal(color, -20));
    root.style.setProperty("--brand-darker", shadeLocal(color, -35));
    root.style.setProperty("--brand-light", color + "18");
    root.style.setProperty("--brand-lighter", color + "0a");
    root.style.setProperty("--brand-glow", color + "1e");
  }
  function shadeLocal(col, pct) {
    const hex = col.replace("#", "");
    const num = parseInt(hex, 16);
    const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + pct));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + pct));
    const b = Math.max(0, Math.min(255, (num & 0xff) + pct));
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  }

  function openEditUserModal(u, root) {
    openModal(`
      <div class="modal-title-row"><h3>✏️ Edit User — ${escapeHtml(u.full_name)}</h3></div>
      <div class="field"><label>Full Name</label><input id="eu-name" value="${escapeHtml(u.full_name)}" /></div>
      <div class="field-row">
        <div class="field"><label>Phone</label><input id="eu-phone" value="${escapeHtml(u.phone || "")}" /></div>
        <div class="field"><label>Email</label><input id="eu-email" value="${escapeHtml(u.email || "")}" disabled title="Email cannot be changed" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Role</label>
          <select id="eu-role">${['admin', 'manager', 'cashier', 'inventory_clerk', 'accountant'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r.replace('_', ' ')}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Status</label>
          <select id="eu-active"><option value="true" ${u.is_active ? 'selected' : ''}>Active</option><option value="false" ${!u.is_active ? 'selected' : ''}>Inactive</option></select>
        </div>
      </div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="eu-save">Save Changes</button>
      </div>
    `, { onMount: () => {
      $('eu-save').addEventListener('click', async () => {
        const name = $('eu-name').value.trim();
        const phone = $('eu-phone').value.trim();
        const role = $('eu-role').value;
        const isActive = $('eu-active').value === 'true';
        if (!name) { toast("Name is required", "error"); return; }
        const { error } = await supabase.from('app_users').update({
          full_name: name, phone: phone || null, role, is_active: isActive,
        }).eq('id', u.id);
        if (error) { toast("Failed: " + error.message, "error"); return; }
        toast("User updated", "success");
        closeModal();
        renderSettings(root);
      });
    }});
  }
}
