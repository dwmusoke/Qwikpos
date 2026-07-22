// =====================================================================
// QWICKPOS — QUOTATIONS VIEW
//
// A quotation is a `sales` row with sale_type='quotation' — created from
// the POS "Quotation" mode toggle (see uganda-pos-view-pos.js). It never
// touches stock or EFRIS. "Convert to Sale" creates a brand new, normal
// sale_type='retail' sale from the same line items (so stock deduction
// and EFRIS staging both fire exactly like any other checkout), then
// links the original quotation to it via converted_sale_id.
// =====================================================================
import {
  supabase, STATE, $, qsa, escapeHtml, toast, openModal, closeModal, uid, fmtMoneyRaw,
} from './uganda-pos-core.js';
import { submitSaleToSupabase, printableModal } from './uganda-pos-view-pos.js';

let quoteFilter = 'open';

export async function renderQuotations(root) {
  root.innerHTML = `<div class="empty-state">Loading quotations…</div>`;

  const { data } = await supabase
    .from('sales')
    .select('*, customers(name, phone)')
    .eq('business_id', STATE.business.id)
    .eq('sale_type', 'quotation')
    .order('created_at', { ascending: false })
    .limit(300);
  const quotations = data || [];

  // Resolve the sale_number of whatever a quotation was converted into.
  const convertedIds = [...new Set(quotations.map((q) => q.converted_sale_id).filter(Boolean))];
  let convertedMap = {};
  if (convertedIds.length) {
    const { data: convertedSales } = await supabase.from('sales').select('id, sale_number').in('id', convertedIds);
    convertedMap = Object.fromEntries((convertedSales || []).map((s) => [s.id, s.sale_number]));
  }

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (q) => q.status === 'completed' && q.quote_expires_at && q.quote_expires_at < today;
  const bucket = (q) => {
    if (q.status === 'converted') return 'converted';
    if (q.status === 'voided') return 'voided';
    if (q.status === 'expired' || isOverdue(q)) return 'expired';
    return 'open';
  };
  const counts = { all: quotations.length, open: 0, converted: 0, expired: 0, voided: 0 };
  quotations.forEach((q) => { counts[bucket(q)] = (counts[bucket(q)] || 0) + 1; });

  root.innerHTML = `
    <div class="view-header">
      <div>
        <h2>Quotations</h2>
        <p class="sub">Price quotes that haven't been paid or fiscalised yet. Convert one to a sale once the customer confirms.</p>
      </div>
      <button class="btn btn-primary" id="new-quote-btn">+ New Quotation</button>
    </div>

    <div class="category-chips" style="margin-bottom:14px;">
      ${['all', 'open', 'converted', 'expired', 'voided'].map((s) => `
        <button class="chip ${quoteFilter === s ? 'active' : ''}" data-filter="${s}">${s[0].toUpperCase() + s.slice(1)} ${counts[s] ? `(${counts[s]})` : ''}</button>
      `).join('')}
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Quote No.</th><th>Customer</th><th>Amount</th><th>Valid Until</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody id="quotes-table-body"></tbody>
      </table>
    </div>
  `;

  const renderRows = () => {
    const list = quoteFilter === 'all' ? quotations : quotations.filter((q) => bucket(q) === quoteFilter);
    const tbody = $('quotes-table-body');
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No quotations in this filter.</div></td></tr>`; return; }

    tbody.innerHTML = list.map((q) => {
      const b = bucket(q);
      return `
      <tr>
        <td><b>${escapeHtml(q.sale_number)}</b></td>
        <td>${escapeHtml(q.customers?.name || 'Walk-in')}</td>
        <td>${fmtMoneyRaw(Number(q.grand_total || 0), q.currency_code)}</td>
        <td>${q.quote_expires_at ? escapeHtml(q.quote_expires_at) : '—'}</td>
        <td>${statusBadge(b, convertedMap[q.converted_sale_id])}</td>
        <td>${new Date(q.created_at).toLocaleDateString('en-UG')}</td>
        <td class="flex gap">
          <button class="btn btn-outline btn-sm" data-print="${q.id}">Print</button>
          ${b === 'open' ? `<button class="btn btn-primary btn-sm" data-convert="${q.id}">Convert to Sale</button>` : ''}
          ${b === 'open' ? `<button class="btn btn-ghost btn-sm" data-void="${q.id}">Void</button>` : ''}
        </td>
      </tr>`;
    }).join('');

    qsa('[data-print]', tbody).forEach((b) => b.addEventListener('click', () => printQuotation(b.dataset.print)));
    qsa('[data-convert]', tbody).forEach((b) => b.addEventListener('click', () => openConvertModal(quotations.find((q) => q.id === b.dataset.convert))));
    qsa('[data-void]', tbody).forEach((b) => b.addEventListener('click', () => voidQuotation(b.dataset.void, root)));
  };

  renderRows();
  qsa('.chip', root).forEach((chip) => chip.addEventListener('click', () => {
    quoteFilter = chip.dataset.filter;
    renderQuotations(root);
  }));
  $('new-quote-btn').addEventListener('click', () => { document.querySelector('[data-route="pos"]')?.click(); });
}

function statusBadge(bucket, convertedToSaleNo) {
  const map = {
    open: '<span class="badge badge-blue">Open</span>',
    converted: `<span class="badge badge-green">Converted${convertedToSaleNo ? ` → ${escapeHtml(convertedToSaleNo)}` : ''}</span>`,
    expired: '<span class="badge badge-yellow">Expired</span>',
    voided: '<span class="badge badge-gray">Voided</span>',
  };
  return map[bucket] || map.open;
}

async function printQuotation(quotationId) {
  const { data: quotation } = await supabase.from('sales').select('*, sale_items(*)').eq('id', quotationId).single();
  if (!quotation) { toast('Could not load quotation', 'error'); return; }
  printableModal({ ...quotation, items: quotation.sale_items }, {
    docLabel: 'QUOTATION',
    footNote: quotation.quote_expires_at ? `Valid until ${quotation.quote_expires_at}` : '',
  });
}

async function voidQuotation(quotationId, root) {
  if (!confirm('Void this quotation? This cannot be undone.')) return;
  const { error } = await supabase.from('sales').update({ status: 'voided' }).eq('id', quotationId);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast('Quotation voided', 'default');
  renderQuotations(root);
}

// ---------------------------------------------------------------------
// CONVERT TO SALE — collects payment, then runs the exact same
// submitSaleToSupabase() pipeline used at POS checkout (stock deduction +
// EFRIS staging included), using the quotation's own snapshotted items.
// ---------------------------------------------------------------------
async function openConvertModal(quotationSummary) {
  const { data: quotation } = await supabase.from('sales').select('*, sale_items(*)').eq('id', quotationSummary.id).single();
  if (!quotation) { toast('Could not load quotation', 'error'); return; }

  const grandTotal = Number(quotation.grand_total || 0);
  const currency = quotation.currency_code;
  const paymentRows = [{ id: uid(), method: 'cash', amount: grandTotal }];

  const renderRows = () => paymentRows.map((r) => `
    <div class="field-row" data-payrow="${r.id}" style="align-items:end; margin-bottom:6px;">
      <div class="field" style="margin-bottom:0;">
        <label>Method</label>
        <select data-field="method">
          <option value="cash" ${r.method === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="mobile_money" ${r.method === 'mobile_money' ? 'selected' : ''}>Mobile Money</option>
          <option value="bank" ${r.method === 'bank' ? 'selected' : ''}>Bank Transfer</option>
          <option value="card" ${r.method === 'card' ? 'selected' : ''}>Card</option>
          <option value="credit" ${r.method === 'credit' ? 'selected' : ''}>Credit (on account)</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Amount (${currency})</label>
        <input type="number" step="0.01" data-field="amount" value="${r.amount}" />
      </div>
    </div>
  `).join('');

  openModal(`
    <div class="modal-title-row"><h3>Convert ${escapeHtml(quotation.sale_number)} to Sale</h3></div>
    <div class="summary-row total" style="margin-bottom:14px;"><span>Amount Due</span><span>${fmtMoneyRaw(grandTotal, currency)}</span></div>
    <div id="pay-rows">${renderRows()}</div>
    <button class="btn btn-outline btn-sm" id="add-pay-row" type="button" style="margin-bottom:14px;">+ Split Payment</button>
    <div class="summary-row" id="pay-balance-row"></div>
    <div class="flex gap" style="margin-top:16px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="confirm-convert-btn">Confirm &amp; Complete Sale</button>
    </div>
  `, {
    onMount: (modalRoot) => {
      const updateBalance = () => {
        const rows = qsa('[data-payrow]', modalRoot);
        let paid = 0;
        rows.forEach((r) => { paid += parseFloat(r.querySelector('[data-field="amount"]').value) || 0; });
        const balance = Math.round((grandTotal - paid + Number.EPSILON) * 100) / 100;
        $('pay-balance-row').innerHTML = `<span>${balance > 0 ? 'Balance Due' : 'Change'}</span><span style="color:${balance > 0 ? 'var(--danger)' : 'var(--brand)'}">${fmtMoneyRaw(Math.abs(balance), currency)}</span>`;
      };
      updateBalance();
      modalRoot.addEventListener('input', updateBalance);

      $('add-pay-row').addEventListener('click', () => {
        paymentRows.push({ id: uid(), method: 'cash', amount: 0 });
        $('pay-rows').innerHTML = renderRows();
        updateBalance();
      });

      $('confirm-convert-btn').addEventListener('click', async () => {
        const rows = qsa('[data-payrow]', modalRoot);
        const payments = rows.map((r) => ({
          method: r.querySelector('[data-field="method"]').value,
          amount: parseFloat(r.querySelector('[data-field="amount"]').value) || 0,
        })).filter((p) => p.amount > 0);
        if (!payments.length) { toast('Enter at least one payment amount', 'error'); return; }

        $('confirm-convert-btn').disabled = true;
        $('confirm-convert-btn').textContent = 'Processing…';
        try {
          const totalPaid = payments.reduce((a, p) => a + p.amount, 0);
          const paymentStatus = payments.some((p) => p.method === 'credit')
            ? (totalPaid >= grandTotal ? 'paid' : 'credit')
            : (totalPaid >= grandTotal ? 'paid' : 'partial');

          const items = (quotation.sale_items || []).map((it) => ({
            product_id: it.product_id, product_name: it.product_name, quantity: it.quantity,
            unit_price: it.unit_price, discount: it.discount, tax_category_code: it.tax_category_code,
            vat_rate: it.vat_rate, vat_amount: it.vat_amount, line_total: it.line_total,
          }));

          const payload = {
            currency_code: currency,
            exchange_rate: quotation.exchange_rate,
            subtotal: quotation.subtotal,
            discount_total: quotation.discount_total,
            vat_total: quotation.vat_total,
            grand_total: quotation.grand_total,
            grand_total_base: quotation.grand_total_base,
            customer_id: quotation.customer_id,
            payment_status: paymentStatus,
            items,
            // amount_base uses the quotation's own locked-in exchange rate,
            // not today's live rate, so the converted sale stays consistent
            // with the price the customer was originally quoted.
            payments: payments.map((p) => ({
              method: p.method, currency_code: currency,
              amount: p.amount, amount_base: Math.round((p.amount * quotation.exchange_rate + Number.EPSILON) * 100) / 100,
            })),
          };

          const newSale = await submitSaleToSupabase(payload);
          await supabase.from('sales').update({ status: 'converted', converted_sale_id: newSale.id }).eq('id', quotation.id);

          closeModal();
          toast(`Converted to sale ${newSale.sale_number}`, 'success');
          const root = $('view-root');
          if (root) renderQuotations(root);
          printableModal({ ...newSale, items }, { docLabel: 'TAX INVOICE', footNote: 'EFRIS fiscal invoice staged — see EFRIS tab' });
        } catch (err) {
          console.error(err);
          toast('Could not complete sale: ' + err.message, 'error', 5000);
          $('confirm-convert-btn').disabled = false;
          $('confirm-convert-btn').textContent = 'Confirm & Complete Sale';
        }
      });
    },
  });
}
