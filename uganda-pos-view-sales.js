// =====================================================================
// QWICKPOS — SALES MODULE
// List, Add New (POS), Sales Return
// =====================================================================
import {
  supabase, STATE, $, qsa, escapeHtml, toast, openModal, closeModal,
  fmtMoney, fmtDate, sanitizeCsvValue, refreshProducts, stockFor,
  makePaginationState, paginationHtml, wirePagination,
  printHtml, receiptHtml,
} from './uganda-pos-core.js';

let activeTab = 'list';

export async function renderSalesModule(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2 data-i18n="nav.sales">Sales</h2><p class="sub">Manage sales transactions and returns</p></div>
    </div>
    <div class="notif-filters" id="sales-tabs">
      ${[
        ['list', '📋 Sales List'],
        ['add', '➕ Add New Sale'],
        ['returns', '↩️ Sales Returns'],
      ].map(([k, l]) => `<button class="chip ${activeTab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <div id="sales-body"></div>
  `;

  root.querySelectorAll('#sales-tabs .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      root.querySelectorAll('#sales-tabs .chip').forEach((c) => c.classList.toggle('active', c === btn));
      renderTab();
    });
  });

  await renderTab();

  async function renderTab() {
    const body = $('sales-body');
    if (activeTab === 'list') await renderSalesListTab(body);
    else if (activeTab === 'add') { window.location.hash = '#pos'; activeTab = 'list'; renderTab(); }
    else if (activeTab === 'returns') await renderReturnsTab(body);
  }
}

// ── SALES LIST ───────────────────────────────────────────────────────
async function renderSalesListTab(body) {
  const from = new Date(); from.setDate(from.getDate() - 30);
  body.innerHTML = `
    <div class="card">
      <div class="field-row" style="align-items:end;">
        <div class="field"><label>From</label><input type="date" id="sl-from" value="${from.toISOString().slice(0, 10)}" /></div>
        <div class="field"><label>To</label><input type="date" id="sl-to" value="${new Date().toISOString().slice(0, 10)}" /></div>
        <div class="field"><label>Status</label><select id="sl-status"><option value="">All</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="credit">Credit</option><option value="unpaid">Unpaid</option></select></div>
        <button class="btn btn-primary" id="sl-run">Run</button>
        <button class="btn btn-outline" id="sl-export">Export CSV</button>
      </div>
    </div>
    <div id="sl-output"><div class="empty-state">Loading…</div></div>`;

  let lastSales = [];
  const sState = makePaginationState(25);
  $('sl-run').addEventListener('click', () => { sState.page = 0; load(); });
  $('sl-export').addEventListener('click', () => exportSales());
  await load();

  async function load() {
    const from = $('sl-from').value;
    const to = $('sl-to').value;
    const status = $('sl-status').value;
    const out = $('sl-output');
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    let query = supabase.from('sales').select('*, sale_items(*), payments(*), cashier:app_users!cashier_id(full_name), customer:customers(name)')
      .eq('business_id', STATE.business.id)
      .neq('status', 'voided').neq('sale_type', 'quotation')
      .gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('payment_status', status);

    const { data: sales } = await query;
    lastSales = sales || [];

    sState.total = lastSales.length;
    sState.hasMore = (sState.page + 1) * sState.pageSize < lastSales.length;
    const pageSales = lastSales.slice(sState.page * sState.pageSize, (sState.page + 1) * sState.pageSize);

    const total = lastSales.reduce((a, s) => a + Number(s.grand_total_base || 0), 0);
    const vat = lastSales.reduce((a, s) => a + Number(s.vat_total || 0) * Number(s.exchange_rate || 1), 0);
    const paid = lastSales.filter((s) => s.payment_status === 'paid').length;
    const partial = lastSales.filter((s) => s.payment_status === 'partial').length;
    const credit = lastSales.filter((s) => s.payment_status === 'credit').length;

    out.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="label">Total Sales</div><div class="value">${fmtMoney(total)}</div><div class="delta">${lastSales.length} transactions</div></div>
        <div class="kpi-card"><div class="label">VAT Collected</div><div class="value">${fmtMoney(vat)}</div></div>
        <div class="kpi-card"><div class="label">Paid</div><div class="value">${paid}</div></div>
        <div class="kpi-card"><div class="label">Partial / Credit</div><div class="value">${partial + credit}</div><div class="delta">${partial} partial · ${credit} credit</div></div>
      </div>
      <div class="card">
        <div class="card-title">Sales (${lastSales.length})</div>
        <div class="table-wrap" style="max-height:500px;overflow-y:auto;">
          <table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Cashier</th><th>Items</th><th>Total</th><th>Paid</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${pageSales.map((s) => {
              const items = s.sale_items || [];
              return `<tr>
                <td><b>${escapeHtml(s.sale_number)}</b></td>
                <td>${fmtDate(s.created_at)}</td>
                <td>${escapeHtml(s.customer?.name || 'Walk-in')}</td>
                <td>${escapeHtml(s.cashier?.full_name || '—')}</td>
                <td>${items.length}</td>
                <td>${fmtMoney(s.grand_total_base)}</td>
                <td>${fmtMoney((s.payments || []).reduce((a, p) => a + Number(p.amount_base || 0), 0))}</td>
                <td><span class="badge ${s.payment_status === 'paid' ? 'badge-green' : s.payment_status === 'credit' ? 'badge-red' : 'badge-yellow'}">${s.payment_status}</span></td>
                <td class="flex gap">
                  <button class="btn btn-ghost btn-sm" data-view-sale="${s.id}">View</button>
                  <button class="btn btn-ghost btn-sm" data-return-sale="${s.id}" ${s.payment_status === 'credit' ? '' : ''}>Return</button>
                </td></tr>`;
            }).join('')}
            ${!lastSales.length ? '<tr><td colspan="9"><div class="empty-state">No sales in this range.</div></td></tr>' : ''}
          </tbody></table>
        </div>
        ${lastSales.length ? paginationHtml(sState) : ''}
      </div>`;

    qsa('[data-view-sale]', body).forEach((btn) => btn.addEventListener('click', () => viewSale(btn.dataset.viewSale)));
    qsa('[data-return-sale]', body).forEach((btn) => btn.addEventListener('click', () => initiateReturn(btn.dataset.returnSale)));
    if (lastSales.length) wirePagination(sState, load);
  }

  function exportSales() {
    const rows = lastSales.map((s) => [s.sale_number, s.created_at, s.customer?.name || 'Walk-in', s.cashier?.full_name || '', (s.payments || []).reduce((a, p) => a + Number(p.amount_base || 0), 0), s.grand_total_base, s.payment_status]);
    const csv = [['Invoice', 'Date', 'Customer', 'Cashier', 'Amount Paid', 'Total', 'Status'], ...rows]
      .map((r) => r.map((v) => `"${sanitizeCsvValue(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `sales-${$('sl-from').value}-to-${$('sl-to').value}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  async function viewSale(saleId) {
    const { data: sale } = await supabase.from('sales').select('*, sale_items(*), payments(*), cashier:app_users!cashier_id(full_name), customer:customers(name)').eq('id', saleId).single();
    if (!sale) { toast('Sale not found', 'error'); return; }

    openModal(`
      <div class="modal-title-row"><h3>Sale — ${escapeHtml(sale.sale_number)}</h3></div>
      <div class="summary-row"><span>Date</span><span>${fmtDate(sale.created_at)}</span></div>
      <div class="summary-row"><span>Customer</span><span>${escapeHtml(sale.customer?.name || 'Walk-in')}</span></div>
      <div class="summary-row"><span>Cashier</span><span>${escapeHtml(sale.cashier?.full_name || '—')}</span></div>
      <div class="summary-row"><span>Payment Status</span><span class="badge ${sale.payment_status === 'paid' ? 'badge-green' : 'badge-yellow'}">${sale.payment_status}</span></div>
      <div class="card-title" style="margin-top:12px;">Items</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${(sale.sale_items || []).map((it) => `<tr><td>${escapeHtml(it.product_name)}</td><td>${it.quantity}</td><td>${fmtMoney(it.unit_price)}</td><td>${fmtMoney(it.line_total)}</td></tr>`).join('')}
        </tbody></table></div>
      <div class="summary-row" style="font-weight:700;border-top:2px solid var(--border);padding-top:8px;margin-top:8px;"><span>Total</span><span>${fmtMoney(sale.grand_total_base)}</span></div>
      <div class="card-title" style="margin-top:12px;">Payments</div>
      ${(sale.payments || []).map((p) => `<div class="summary-row"><span style="text-transform:capitalize;">${escapeHtml(p.method)}</span><span>${fmtMoney(p.amount_base)}</span></div>`).join('')}
      <div class="flex gap" style="margin-top:14px;flex-wrap:wrap;">
        <button class="btn btn-outline" data-print-receipt="${sale.id}">🖨️ Print Receipt</button>
        <button class="btn btn-outline" data-download-csv="${sale.id}">📥 Download CSV</button>
        <button class="btn btn-outline" data-close-modal>Close</button>
      </div>
    `, {
      large: true,
      onMount: () => {
        const printBtn = document.querySelector("[data-print-receipt]");
        printBtn?.addEventListener("click", () => {
          const lines = (sale.sale_items || []).map((it) => ({ name: it.product_name, qty: it.quantity, price: it.unit_price, total: it.line_total }));
          const receipt = receiptHtml({
            business: STATE.business, customer: sale.customer, saleNumber: sale.sale_number,
            date: sale.created_at, items: lines, total: sale.grand_total_base,
            payments: sale.payments,
          });
          printHtml(receipt, `Receipt ${sale.sale_number}`);
        });
        const csvBtn = document.querySelector("[data-download-csv]");
        csvBtn?.addEventListener("click", () => {
          const rows = (sale.sale_items || []).map((it) => [it.product_name, it.quantity, it.unit_price, it.line_total]);
          const csv = [["Product", "Qty", "Unit Price", "Total"], ...rows]
            .map((r) => r.map((v) => `"${sanitizeCsvValue(v).replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = `sale-${sale.sale_number}.csv`; a.click();
          URL.revokeObjectURL(url);
        });
      },
    });
  }
}

// ── SALES RETURNS ────────────────────────────────────────────────────
async function renderReturnsTab(body) {
  body.innerHTML = `
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>Sales Returns</span>
        <button class="btn btn-primary btn-sm" id="new-return-btn">+ New Return</button>
      </div>
    </div>
    <div id="ret-output"><div class="empty-state">Loading…</div></div>`;

  $('new-return-btn').addEventListener('click', () => initiateReturn());
  await loadReturns();

  async function loadReturns() {
    const out = $('ret-output');
    const { data: returns } = await supabase.from('sales_returns').select('*, sale:sales(sale_number), items:sale_return_items(*, product:products(name))')
      .eq('business_id', STATE.business.id).order('created_at', { ascending: false });

    const retList = returns || [];
    out.innerHTML = retList.length ? `
      <div class="card"><div class="table-wrap" style="max-height:500px;overflow-y:auto;">
        <table><thead><tr><th>Return #</th><th>Date</th><th>Original Sale</th><th>Refund</th><th>Method</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${retList.map((r) => `<tr>
            <td><b>${escapeHtml(r.return_number || '—')}</b></td>
            <td>${fmtDate(r.created_at)}</td>
            <td>${escapeHtml(r.sale?.sale_number || '—')}</td>
            <td>${fmtMoney(r.refund_amount)}</td>
            <td style="text-transform:capitalize;">${escapeHtml((r.refund_method || 'cash').replace('_', ' '))}</td>
            <td><span class="badge ${r.status === 'completed' ? 'badge-green' : r.status === 'rejected' ? 'badge-red' : 'badge-yellow'}">${r.status}</span></td>
            <td>${r.status === 'pending' ? `<button class="btn btn-outline btn-sm" data-approve-ret="${r.id}">Approve</button>` : ''}</td>
          </tr>`).join('')}
        </tbody></table>
      </div></div>` : '<div class="card"><div class="empty-state">No sales returns yet.</div></div>';

    qsa('[data-approve-ret]', body).forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('Approve this return? Stock will be restored.')) return;
      const ret = retList.find((x) => x.id === btn.dataset.approveRet);
      // Restore stock for each item
      for (const item of (ret.items || [])) {
        if (item.product_id && STATE.branch) {
          const current = stockFor(item.product_id);
          await supabase.from('product_stock').upsert({ product_id: item.product_id, branch_id: STATE.branch.id, quantity: current + Number(item.quantity || 0) });
          STATE.stockByProduct[item.product_id] = current + Number(item.quantity || 0);
          await supabase.from('stock_movements').insert({ business_id: STATE.business.id, branch_id: STATE.branch.id, product_id: item.product_id, type: 'return', quantity: item.quantity, note: `Return ${ret.return_number}` });
        }
      }
      await supabase.from('sales_returns').update({ status: 'completed' }).eq('id', ret.id);
      toast('Return approved, stock restored', 'success');
      loadReturns();
    }));
  }
}

async function initiateReturn(saleId) {
  let sale = null;
  if (saleId) {
    const { data } = await supabase.from('sales').select('*, sale_items(*, product:products(name, id))').eq('id', saleId).single();
    sale = data;
  }

  openModal(`
    <div class="modal-title-row"><h3>Sales Return</h3></div>
    ${!sale
      ? `<div class="field"><label>Search Sale</label><input id="ret-search" placeholder="Type invoice number\u2026" /></div>
         <div id="ret-search-results"></div>`
      : `<div class="summary-row"><span>Original Sale</span><span><b>${escapeHtml(sale.sale_number)}</b></span></div>
         <div class="summary-row"><span>Total</span><span>${fmtMoney(sale.grand_total_base)}</span></div>
         <div class="card-title" style="margin-top:12px;">Select Items to Return</div>
         <div id="ret-items">
           ${(sale.sale_items || []).map((it, i) => `
             <div class="field-row" style="align-items:end; margin-bottom:8px;">
               <div class="field" style="flex:2;"><label>${escapeHtml(it.product_name)}</label></div>
               <div class="field" style="flex:1;"><label>Ordered: ${it.quantity}</label></div>
               <div class="field" style="flex:1;"><label>Return Qty</label><input type="number" min="0" max="${it.quantity}" value="0" data-ret-qty="${i}" data-ret-item="${it.id}" data-ret-pid="${it.product_id}" data-ret-price="${it.unit_price}" /></div>
             </div>`).join('')}
         </div>
         <div class="field"><label>Reason</label><input id="ret-reason" placeholder="Reason for return" /></div>
         <div class="field"><label>Refund Method</label><select id="ret-method"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank Transfer</option><option value="card">Card</option><option value="exchange">Exchange</option></select></div>
         <button class="btn btn-primary btn-block" id="ret-submit" style="margin-top:14px;">Submit Return</button>`}
    </div>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `, {
    large: !!sale,
    onMount: () => {
      if (!sale) {
        $('ret-search')?.addEventListener('input', async (e) => {
          const term = e.target.value.trim();
          if (term.length < 2) { $('ret-search-results').innerHTML = ''; return; }
          const { data } = await supabase.from('sales').select('id, sale_number, created_at, grand_total_base').eq('business_id', STATE.business.id).ilike('sale_number', `%${term}%`).limit(5);
          $('ret-search-results').innerHTML = (data || []).map((s) => `<div class="summary-row" style="cursor:pointer;" data-pick-sale="${s.id}"><span>${escapeHtml(s.sale_number)}</span><span>${fmtMoney(s.grand_total_base)}</span></div>`).join('');
          qsa('[data-pick-sale]', $('ret-search-results')).forEach((el) => el.addEventListener('click', () => { closeModal(); initiateReturn(el.dataset.pickSale); }));
        });
        return;
      }

      $('ret-submit')?.addEventListener('click', async () => {
        const items = [];
        let totalRefund = 0;
        qsa('[data-ret-qty]').forEach((inp) => {
          const qty = parseInt(inp.value) || 0;
          if (qty > 0) {
            const refund = qty * Number(inp.dataset.retPrice);
            totalRefund += refund;
            items.push({ sale_item_id: inp.dataset.retItem, product_id: inp.dataset.retPid, quantity: qty, unit_price: Number(inp.dataset.retPrice), refund_amount: refund });
          }
        });
        if (!items.length) { toast('Select at least one item to return', 'error'); return; }

        const { data: retNum } = await supabase.rpc('next_return_number');
        const { error } = await supabase.from('sales_returns').insert({
          business_id: STATE.business.id, branch_id: STATE.branch?.id,
          sale_id: sale.id, return_number: retNum || `RET-${Date.now()}`,
          reason: $('ret-reason').value.trim() || null,
          refund_amount: totalRefund, refund_method: $('ret-method').value,
          status: 'pending', created_by: STATE.appUser.id,
        });
        if (error) { toast('Failed: ' + error.message, 'error'); return; }

        // Insert return items
        const { data: ret } = await supabase.from('sales_returns').select('id').eq('return_number', retNum).single();
        if (ret) {
          const returnItems = items.map((it) => ({ ...it, return_id: ret.id }));
          await supabase.from('sale_return_items').insert(returnItems);
        }

        toast('Return submitted for approval', 'success');
        closeModal();
        renderTab();
      });
    }
  });
}
