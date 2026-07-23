// =====================================================================
// QWICKPOS — SETTINGS VIEW
// =====================================================================
import { supabase, STATE, $, qsa, escapeHtml, toast, hasRole, applyTheme } from './uganda-pos-core.js';

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
      <div class="card-title">Team Members</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Active</th><th></th></tr></thead>
          <tbody>
            ${(users || []).map((u) => `
              <tr>
                <td>${escapeHtml(u.full_name)}</td>
                <td>
                  <select data-role-user="${u.id}" ${u.id === STATE.appUser.id ? 'disabled' : ''}>
                    ${['admin', 'manager', 'cashier', 'inventory_clerk', 'accountant'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td>${u.is_active ? '<span class="badge badge-green">active</span>' : '<span class="badge badge-gray">inactive</span>'}</td>
                <td>${u.id === STATE.appUser.id ? '<span class="text-muted">you</span>' : `<button class="btn btn-outline btn-sm" data-toggle-user="${u.id}">${u.is_active ? 'Deactivate' : 'Activate'}</button>`}</td>
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

  // Theme: save
  $("save-theme-btn").addEventListener("click", async () => {
    const color = $("th-custom-color").value;
    const fontSize = $("th-font-size").value;
    const { error } = await supabase.from("businesses").update({ theme_color: color, theme_font_size: fontSize }).eq("id", STATE.business.id);
    if (error) { toast("Failed: " + error.message, "error"); return; }
    STATE.business.theme_color = color;
    STATE.business.theme_font_size = fontSize;
    applyTheme();
    toast("Theme saved", "success");
  });

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
}
