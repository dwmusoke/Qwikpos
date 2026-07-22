// =====================================================================
// QWICKPOS — SUPERADMIN CONSOLE
// Only reachable by app_users.role = 'superadmin' (see uganda-pos-app.js
// route guard). Lets you see every vendor business, their subscription,
// manually override plan/status (e.g. for a bank-transfer payment made
// outside Flutterwave), edit plan pricing/features, and audit payments.
// =====================================================================
import { supabase, $, qsa, escapeHtml, toast, openModal, closeModal, fmtDate } from './uganda-pos-core.js';

export async function renderAdmin(root) {
  root.innerHTML = `<div class="empty-state">Loading platform data…</div>`;

  const [{ data: businesses }, { data: subs }, { data: users }, { data: plans }, { data: payments }] = await Promise.all([
    supabase.from('businesses').select('*').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('*, plans(name, code, price_ugx)'),
    supabase.from('app_users').select('id, business_id, full_name, role, is_active'),
    supabase.from('plans').select('*').order('sort_order'),
    supabase.from('subscription_payments').select('*, plans(name)').order('created_at', { ascending: false }).limit(30),
  ]);

  const subByBusiness = {};
  (subs || []).forEach((s) => { subByBusiness[s.business_id] = s; });
  const usersByBusiness = {};
  (users || []).forEach((u) => { (usersByBusiness[u.business_id] ||= []).push(u); });
  const businessById = {};
  (businesses || []).forEach((b) => { businessById[b.id] = b; });

  const now = new Date();
  const activeCount = (subs || []).filter((s) => isActive(s, now)).length;
  const trialCount = (subs || []).filter((s) => s.status === 'trialing' && isActive(s, now)).length;
  const mrr = (subs || []).filter((s) => s.status === 'active' && isActive(s, now)).reduce((a, s) => a + Number(s.plans?.price_ugx || 0), 0);

  root.innerHTML = `
    <div class="view-header"><div><h2>Platform Admin</h2><p class="sub">All vendor businesses on Qwickpos</p></div></div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="label">Vendors</div><div class="value">${(businesses || []).length}</div></div>
      <div class="kpi-card"><div class="label">On Trial</div><div class="value">${trialCount}</div></div>
      <div class="kpi-card"><div class="label">Active Paid</div><div class="value">${activeCount - trialCount >= 0 ? activeCount - trialCount : activeCount}</div></div>
      <div class="kpi-card"><div class="label">Est. MRR</div><div class="value">UGX ${mrr.toLocaleString('en-UG')}</div></div>
    </div>

    <div class="card">
      <div class="card-title">Vendors</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Business</th><th>Owner</th><th>Plan</th><th>Status</th><th>Renews / Trial Ends</th><th>Users</th><th></th></tr></thead>
          <tbody id="admin-vendors-body"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Plans</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Plan</th><th>Price (UGX/mo)</th><th>Active</th><th></th></tr></thead>
          <tbody>
            ${(plans || []).map((p) => `
              <tr>
                <td><b>${escapeHtml(p.name)}</b> <span class="text-muted">(${escapeHtml(p.code)})</span></td>
                <td><input type="number" step="1000" data-plan-price="${p.id}" value="${p.price_ugx}" style="width:120px; padding:6px 8px; border-radius:6px; border:1px solid var(--border); background:var(--surface); color:var(--text);" /></td>
                <td><input type="checkbox" data-plan-active="${p.id}" ${p.is_active ? 'checked' : ''} /></td>
                <td><button class="btn btn-outline btn-sm" data-save-plan="${p.id}">Save</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Recent Payments (all vendors)</div>
      <div class="table-wrap" style="max-height:340px; overflow-y:auto;">
        <table>
          <thead><tr><th>Date</th><th>Business</th><th>Plan</th><th>Amount</th><th>Status</th><th>Ref</th></tr></thead>
          <tbody>
            ${(payments || []).length ? payments.map((p) => `
              <tr>
                <td>${fmtDate(p.created_at)}</td>
                <td>${escapeHtml(businessById[p.business_id]?.name || '—')}</td>
                <td>${escapeHtml(p.plans?.name || '—')}</td>
                <td>${Number(p.amount).toLocaleString('en-UG')} ${escapeHtml(p.currency)}</td>
                <td><span class="badge ${p.status === 'successful' ? 'badge-green' : p.status === 'failed' ? 'badge-red' : 'badge-gray'}">${escapeHtml(p.status)}</span></td>
                <td style="font-family:monospace; font-size:11px;">${escapeHtml(p.flw_tx_ref)}</td>
              </tr>`).join('') : '<tr><td colspan="6"><div class="empty-state">No payments recorded yet.</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderVendorRows();

  qsa('[data-save-plan]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.savePlan;
    const price = parseFloat(qsa(`[data-plan-price="${id}"]`)[0].value);
    const active = qsa(`[data-plan-active="${id}"]`)[0].checked;
    const { error } = await supabase.from('plans').update({ price_ugx: price, is_active: active }).eq('id', id);
    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    toast('Plan updated', 'success');
  }));

  function renderVendorRows() {
    const tbody = $('admin-vendors-body');
    if (!(businesses || []).length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No vendors yet.</div></td></tr>`; return; }

    tbody.innerHTML = businesses.map((b) => {
      const sub = subByBusiness[b.id];
      const owner = (usersByBusiness[b.id] || []).find((u) => u.role === 'admin') || (usersByBusiness[b.id] || [])[0];
      const dateField = sub?.status === 'trialing' ? sub?.trial_ends_at : sub?.current_period_end;
      return `
        <tr>
          <td><b>${escapeHtml(b.name)}</b><br/><span class="text-muted" style="font-size:11px;">${escapeHtml(b.tin || 'no TIN')}</span></td>
          <td>${escapeHtml(owner?.full_name || '—')}</td>
          <td>${escapeHtml(sub?.plans?.name || '—')}</td>
          <td>${vendorStatusBadge(sub, now)}</td>
          <td>${dateField ? new Date(dateField).toLocaleDateString('en-UG') : '—'}</td>
          <td>${(usersByBusiness[b.id] || []).length}</td>
          <td><button class="btn btn-outline btn-sm" data-manage="${b.id}">Manage</button></td>
        </tr>`;
    }).join('');

    qsa('[data-manage]', tbody).forEach((btn) => btn.addEventListener('click', () => openManageModal(businessById[btn.dataset.manage], subByBusiness[btn.dataset.manage], plans)));
  }
}

function isActive(sub, now) {
  if (!sub) return false;
  if (sub.status === 'trialing') return !sub.trial_ends_at || new Date(sub.trial_ends_at) > now;
  if (sub.status === 'active') return !sub.current_period_end || new Date(sub.current_period_end) > now;
  return false;
}

function vendorStatusBadge(sub, now) {
  if (!sub) return '<span class="badge badge-gray">none</span>';
  const active = isActive(sub, now);
  if (sub.status === 'trialing') return `<span class="badge ${active ? 'badge-blue' : 'badge-red'}">${active ? 'trial' : 'trial ended'}</span>`;
  if (sub.status === 'active') return `<span class="badge ${active ? 'badge-green' : 'badge-red'}">${active ? 'active' : 'lapsed'}</span>`;
  const map = { past_due: 'badge-yellow', cancelled: 'badge-red', expired: 'badge-red' };
  return `<span class="badge ${map[sub.status] || 'badge-gray'}">${escapeHtml(sub.status)}</span>`;
}

function openManageModal(business, sub, plans) {
  openModal(`
    <div class="modal-title-row"><h3>Manage — ${escapeHtml(business.name)}</h3></div>
    <p class="help-text">Use this for support cases — e.g. a vendor paid by bank transfer outside Flutterwave and needs
      manual activation. Normal payments activate automatically via Flutterwave.</p>
    <div class="field-row">
      <div class="field"><label>Plan</label>
        <select id="mg-plan">${(plans || []).map((p) => `<option value="${p.id}" ${sub?.plan_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Status</label>
        <select id="mg-status">
          ${['trialing', 'active', 'past_due', 'cancelled', 'expired'].map((s) => `<option value="${s}" ${sub?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field"><label>Period / Trial End Date</label><input type="date" id="mg-date" value="${(sub?.current_period_end || sub?.trial_ends_at || '').slice(0, 10)}" /></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="mg-save-btn">Save</button>
    </div>
  `, {
    onMount: () => {
      $('mg-save-btn').addEventListener('click', async () => {
        const planId = $('mg-plan').value;
        const status = $('mg-status').value;
        const dateVal = $('mg-date').value ? new Date($('mg-date').value).toISOString() : null;

        const record = {
          business_id: business.id,
          plan_id: planId,
          status,
          trial_ends_at: status === 'trialing' ? dateVal : sub?.trial_ends_at || null,
          current_period_end: status === 'active' ? dateVal : sub?.current_period_end || null,
          current_period_start: sub?.current_period_start || new Date().toISOString(),
        };
        const { error } = await supabase.from('subscriptions').upsert(record, { onConflict: 'business_id' });
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('Subscription updated', 'success');
        closeModal();
        document.querySelector('[data-route="admin"]')?.click();
      });
    },
  });
}
