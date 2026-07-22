// =====================================================================
// QWICKPOS — BILLING VIEW
// Doubles as the paywall screen (shown instead of the dashboard once a
// trial/subscription has lapsed) and the normal Settings > Billing page.
// =====================================================================
import { supabase, STATE, $, qsa, escapeHtml, toast, fmtDate, loadSubscription, isSubscriptionActive, trialDaysLeft } from './uganda-pos-core.js';
import { payForPlan } from './uganda-pos-billing.js';

export async function renderBilling(root, { paywall = false } = {}) {
  root.innerHTML = `<div class="empty-state">Loading billing…</div>`;

  const [{ data: plans }, { data: payments }] = await Promise.all([
    supabase.from('plans').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('subscription_payments').select('*, plans(name)').eq('business_id', STATE.business.id).order('created_at', { ascending: false }).limit(20),
  ]);

  const sub = STATE.subscription;
  const active = isSubscriptionActive();
  const daysLeft = trialDaysLeft();

  root.innerHTML = `
    ${paywall ? `
      <div class="card" style="border-color:var(--danger); background:var(--danger-light); margin-bottom:18px;">
        <b>${sub?.status === 'trialing' ? 'Your free trial has ended.' : 'Your subscription is not active.'}</b>
        Choose a plan below and pay with Flutterwave (mobile money, card or bank) to keep using Qwickpos.
      </div>` : `
      <div class="view-header"><div><h2>Billing</h2><p class="sub">Plan, payments and trial status</p></div></div>
    `}

    <div class="card">
      <div class="card-title">Current Plan</div>
      <div class="flex between" style="flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:20px; font-weight:800;">${escapeHtml(STATE.plan?.name || 'No plan')}</div>
          <div class="text-muted" style="font-size:13px;">${subStatusText(sub, active, daysLeft)}</div>
        </div>
        ${statusBadge(sub, active)}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Plans</div>
      <div class="grid-3" id="billing-plans"></div>
    </div>

    <div class="card">
      <div class="card-title">Payment History</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>
            ${(payments || []).length ? payments.map((p) => `
              <tr>
                <td>${fmtDate(p.created_at)}</td>
                <td>${escapeHtml(p.plans?.name || '—')}</td>
                <td>${Number(p.amount).toLocaleString('en-UG')} ${escapeHtml(p.currency)}</td>
                <td style="font-family:monospace; font-size:11.5px;">${escapeHtml(p.flw_tx_ref)}</td>
                <td><span class="badge ${p.status === 'successful' ? 'badge-green' : p.status === 'failed' ? 'badge-red' : 'badge-gray'}">${escapeHtml(p.status)}</span></td>
              </tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">No payments yet.</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const plansGrid = $('billing-plans');
  plansGrid.innerHTML = (plans || []).map((p) => {
    const isCurrent = STATE.plan?.code === p.code && active;
    return `
      <div class="card" style="text-align:center; ${isCurrent ? 'border-color:var(--brand);' : ''}">
        <div class="card-title" style="justify-content:center;">${escapeHtml(p.name)} ${isCurrent ? '<span class="badge badge-green">current</span>' : ''}</div>
        <div style="font-size:22px; font-weight:800; margin:6px 0;">${Number(p.price_ugx).toLocaleString('en-UG')} <span style="font-size:12px; font-weight:500; color:var(--text-muted);">UGX/mo</span></div>
        <p class="help-text">${escapeHtml(p.description || '')}</p>
        <ul style="text-align:left; font-size:12.5px; color:var(--text-muted); padding-left:18px; margin:10px 0;">
          <li>${p.features?.max_branches >= 999 ? 'Unlimited' : p.features?.max_branches || 1} branch(es), up to ${p.features?.max_users || 1} users</li>
          <li>${p.features?.multi_currency ? '✅' : '—'} Multi-currency</li>
          <li>${p.features?.efris ? '✅' : '—'} EFRIS e-invoicing</li>
          <li>${p.features?.reports_export ? '✅' : '—'} Report exports</li>
        </ul>
        <button class="btn ${isCurrent ? 'btn-outline' : 'btn-primary'} btn-block" data-pay="${p.code}" ${isCurrent ? 'disabled' : ''}>
          ${isCurrent ? 'Current Plan' : (active ? 'Switch & Pay' : 'Subscribe & Pay')}
        </button>
      </div>`;
  }).join('');

  qsa('[data-pay]', plansGrid).forEach((btn) => btn.addEventListener('click', async () => {
    const plan = (plans || []).find((p) => p.code === btn.dataset.pay);
    if (!plan) return;
    btn.disabled = true;
    await payForPlan(plan, {
      onSuccess: async () => {
        await loadSubscription();
        window.location.hash = '';
        window.location.reload();
      },
      onClose: () => { btn.disabled = false; },
    });
  }));
}

function statusBadge(sub, active) {
  if (!sub) return '<span class="badge badge-gray">No subscription</span>';
  if (sub.status === 'trialing' && active) return '<span class="badge badge-blue">Trial</span>';
  if (sub.status === 'active' && active) return '<span class="badge badge-green">Active</span>';
  if (sub.status === 'past_due') return '<span class="badge badge-yellow">Past Due</span>';
  return '<span class="badge badge-red">Expired</span>';
}

function subStatusText(sub, active, daysLeft) {
  if (!sub) return 'No subscription on record — pick a plan below.';
  if (sub.status === 'trialing') {
    return active ? `Free trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Your free trial has ended.';
  }
  if (sub.status === 'active') {
    return active ? `Renews on ${new Date(sub.current_period_end).toLocaleDateString('en-UG')}` : 'Your last billing period has ended.';
  }
  if (sub.status === 'past_due') return 'Your last payment did not go through — please retry.';
  return 'Your subscription is not active.';
}
