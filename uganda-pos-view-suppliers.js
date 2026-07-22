// =====================================================================
// QWICKPOS — SUPPLIERS VIEW
// =====================================================================
import {
  supabase, STATE, $, qsa, escapeHtml, toast, openModal, closeModal,
  fmtMoney, refreshSuppliers, fmtDate,
} from './uganda-pos-core.js';

export async function renderSuppliers(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Suppliers</h2><p class="sub">${STATE.suppliers.length} suppliers on file</p></div>
      <button class="btn btn-primary" id="add-supplier-btn">+ Add Supplier</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>TIN</th><th>Balance Owed</th><th></th></tr></thead>
        <tbody id="sup-table-body"></tbody>
      </table>
    </div>
  `;
  renderTable();
  $('add-supplier-btn').addEventListener('click', () => openSupplierModal());
}

function renderTable() {
  const tbody = $('sup-table-body');
  if (!STATE.suppliers.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No suppliers yet.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.suppliers.map((s) => `
    <tr>
      <td><b>${escapeHtml(s.name)}</b></td>
      <td>${escapeHtml(s.contact_person || '—')}</td>
      <td>${escapeHtml(s.phone || '—')}</td>
      <td>${escapeHtml(s.tin || '—')}</td>
      <td><span class="badge ${Number(s.balance) > 0 ? 'badge-yellow' : 'badge-green'}">${fmtMoney(s.balance || 0)}</span></td>
      <td class="flex gap">
        <button class="btn btn-outline btn-sm" data-edit="${s.id}">Edit</button>
        <button class="btn btn-outline btn-sm" data-pay="${s.id}">Record Payment</button>
      </td>
    </tr>`).join('');

  qsa('[data-edit]', tbody).forEach((b) => b.addEventListener('click', () => openSupplierModal(b.dataset.edit)));
  qsa('[data-pay]', tbody).forEach((b) => b.addEventListener('click', () => openPaymentModal(b.dataset.pay)));
}

function openSupplierModal(supplierId) {
  const editing = !!supplierId;
  const s = editing ? STATE.suppliers.find((x) => x.id === supplierId) : {};
  openModal(`
    <div class="modal-title-row"><h3>${editing ? 'Edit' : 'Add'} Supplier</h3></div>
    <div class="field"><label>Supplier / Company Name *</label><input id="sf-name" value="${escapeHtml(s.name || '')}" /></div>
    <div class="field-row">
      <div class="field"><label>Contact Person</label><input id="sf-contact" value="${escapeHtml(s.contact_person || '')}" /></div>
      <div class="field"><label>Phone</label><input id="sf-phone" value="${escapeHtml(s.phone || '')}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Email</label><input id="sf-email" value="${escapeHtml(s.email || '')}" /></div>
      <div class="field"><label>TIN</label><input id="sf-tin" value="${escapeHtml(s.tin || '')}" /></div>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-supplier-btn">${editing ? 'Save Changes' : 'Add Supplier'}</button>
    </div>
  `, {
    onMount: () => {
      $('save-supplier-btn').addEventListener('click', async () => {
        const name = $('sf-name').value.trim();
        if (!name) { toast('Supplier name is required', 'error'); return; }
        const record = {
          business_id: STATE.business.id, name,
          contact_person: $('sf-contact').value.trim() || null,
          phone: $('sf-phone').value.trim() || null,
          email: $('sf-email').value.trim() || null,
          tin: $('sf-tin').value.trim() || null,
        };
        const query = editing
          ? supabase.from('suppliers').update(record).eq('id', supplierId)
          : supabase.from('suppliers').insert(record);
        const { error } = await query;
        if (error) { toast('Save failed: ' + error.message, 'error'); return; }
        toast(editing ? 'Supplier updated' : 'Supplier added', 'success');
        closeModal();
        await refreshSuppliers();
        renderTable();
      });
    },
  });
}

function openPaymentModal(supplierId) {
  const s = STATE.suppliers.find((x) => x.id === supplierId);
  openModal(`
    <div class="modal-title-row"><h3>Record Payment — ${escapeHtml(s.name)}</h3></div>
    <p class="help-text">Current balance owed: <b>${fmtMoney(s.balance || 0)}</b></p>
    <div class="field-row">
      <div class="field"><label>Amount (UGX)</label><input type="number" step="0.01" id="pf-amount" /></div>
      <div class="field"><label>Method</label>
        <select id="pf-method"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank Transfer</option></select>
      </div>
    </div>
    <div class="field"><label>Reference</label><input id="pf-ref" placeholder="Optional" /></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-payment-btn">Record Payment</button>
    </div>
  `, {
    onMount: () => {
      $('save-payment-btn').addEventListener('click', async () => {
        const amount = parseFloat($('pf-amount').value);
        if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }

        await supabase.from('supplier_payments').insert({
          supplier_id: supplierId, amount, currency_code: STATE.business.base_currency,
          method: $('pf-method').value, reference: $('pf-ref').value || null,
        });
        await supabase.from('suppliers').update({ balance: Math.max(0, Number(s.balance || 0) - amount) }).eq('id', supplierId);

        toast('Payment recorded', 'success');
        closeModal();
        await refreshSuppliers();
        renderTable();
      });
    },
  });
}
