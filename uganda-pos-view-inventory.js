// =====================================================================
// QWICKPOS — INVENTORY VIEW
// =====================================================================
import {
  supabase, STATE, $, qsa, escapeHtml, toast, openModal, closeModal,
  fmtMoney, refreshProducts, stockFor,
} from './uganda-pos-core.js';

const JSBARCODE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js';

let invSearch = '';

export async function renderInventory(root) {
  root.innerHTML = `
    <div class="view-header">
      <div>
        <h2>Inventory</h2>
        <p class="sub">${STATE.products.length} products · ${STATE.categories.length} categories</p>
      </div>
      <div class="flex gap">
        <button class="btn btn-outline" id="manage-categories-btn">Categories</button>
        <button class="btn btn-outline" id="bulk-labels-btn">🏷️ Print Labels</button>
        <button class="btn btn-primary" id="add-product-btn">+ Add Product</button>
      </div>
    </div>

    <div class="pos-search-row" style="max-width:380px; margin-bottom:14px;">
      <input id="inv-search" placeholder="Search products…" />
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Product</th><th>Category</th><th>Cost</th><th>Price</th><th>Stock</th><th>Tax</th>${STATE.business.efris_live_enabled ? '<th>EFRIS</th>' : ''}<th></th></tr>
        </thead>
        <tbody id="inv-table-body"></tbody>
      </table>
    </div>
  `;

  renderTable();
  $('inv-search').addEventListener('input', (e) => { invSearch = e.target.value.toLowerCase(); renderTable(); });
  $('add-product-btn').addEventListener('click', () => openProductModal());
  $('manage-categories-btn').addEventListener('click', () => openCategoriesModal());
  $('bulk-labels-btn').addEventListener('click', () => openBulkLabelsModal());
}

function renderTable() {
  const tbody = $('inv-table-body');
  if (!tbody) return;
  let list = STATE.products;
  if (invSearch) {
    list = list.filter((p) => p.name.toLowerCase().includes(invSearch) || (p.sku || '').toLowerCase().includes(invSearch) || (p.barcode || '').toLowerCase().includes(invSearch));
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No products yet. Click "Add Product" to get started.</div></td></tr>`;
    return;
  }

  const efrisOn = STATE.business.efris_live_enabled;

  tbody.innerHTML = list.map((p) => {
    const cat = STATE.categories.find((c) => c.id === p.category_id);
    const stock = stockFor(p.id);
    const low = stock <= Number(p.reorder_level || 0);
    return `
      <tr>
        <td><b>${escapeHtml(p.name)}</b><br/><span class="text-muted" style="font-size:11.5px;">${escapeHtml(p.sku || p.barcode || '—')}</span></td>
        <td>${escapeHtml(cat?.name || '—')}</td>
        <td>${fmtMoney(p.cost_price)}</td>
        <td>${fmtMoney(p.selling_price)}</td>
        <td><span class="badge ${low ? 'badge-red' : 'badge-green'}">${stock} ${escapeHtml(p.unit || 'pc')}</span></td>
        <td><span class="badge badge-blue">${escapeHtml(p.tax_category_code || 'STD')}</span></td>
        ${efrisOn ? `<td>${p.efris_registered_at ? '<span class="badge badge-green">registered</span>' : `<button class="btn btn-outline btn-sm" data-efris-register="${p.id}">Register</button>`}</td>` : ''}
        <td class="flex gap">
          <button class="btn btn-outline btn-sm" data-edit="${p.id}">Edit</button>
          <button class="btn btn-outline btn-sm" data-stock="${p.id}">Stock</button>
          <button class="btn btn-outline btn-sm" data-label="${p.id}">Label</button>
        </td>
      </tr>`;
  }).join('');

  qsa('[data-edit]', tbody).forEach((b) => b.addEventListener('click', () => openProductModal(b.dataset.edit)));
  qsa('[data-stock]', tbody).forEach((b) => b.addEventListener('click', () => openStockModal(b.dataset.stock)));
  qsa('[data-label]', tbody).forEach((b) => b.addEventListener('click', () => printBarcodeLabels([b.dataset.label])));
  qsa('[data-efris-register]', tbody).forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Registering…';
    const { data, error } = await supabase.functions.invoke('efris-register-product', { body: { productId: b.dataset.efrisRegister } });
    if (error || !data?.success) {
      toast('EFRIS registration failed: ' + (data?.error || error?.message || 'unknown error'), 'error', 6000);
      b.disabled = false; b.textContent = 'Register';
      return;
    }
    toast('Product registered with EFRIS', 'success');
    await refreshProducts();
    renderTable();
  }));
}

// ---------------------------------------------------------------------
// ADD / EDIT PRODUCT
// ---------------------------------------------------------------------
function openProductModal(productId) {
  const editing = !!productId;
  const p = editing ? STATE.products.find((x) => x.id === productId) : {};

  openModal(`
    <div class="modal-title-row"><h3>${editing ? 'Edit' : 'Add'} Product</h3></div>
    <div class="field"><label>Product Name *</label><input id="pf-name" value="${escapeHtml(p.name || '')}" /></div>
    <div class="field-row">
      <div class="field"><label>SKU</label><input id="pf-sku" value="${escapeHtml(p.sku || '')}" /></div>
      <div class="field"><label>Barcode</label><input id="pf-barcode" value="${escapeHtml(p.barcode || '')}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Category</label>
        <select id="pf-category"><option value="">—</option>${STATE.categories.map((c) => `<option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Unit</label><input id="pf-unit" value="${escapeHtml(p.unit || 'pc')}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Cost Price (UGX)</label><input type="number" step="0.01" id="pf-cost" value="${p.cost_price ?? 0}" /></div>
      <div class="field"><label>Selling Price (UGX) *</label><input type="number" step="0.01" id="pf-price" value="${p.selling_price ?? 0}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Wholesale Price (UGX)</label><input type="number" step="0.01" id="pf-wholesale" value="${p.wholesale_price ?? ''}" /></div>
      <div class="field"><label>Reorder Level</label><input type="number" step="1" id="pf-reorder" value="${p.reorder_level ?? 5}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>VAT / Tax Category</label>
        <select id="pf-tax">${STATE.taxCategories.map((t) => `<option value="${t.code}" ${p.tax_category_code === t.code ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Expiry Date</label><input type="date" id="pf-expiry" value="${p.expiry_date || ''}" /></div>
    </div>
    ${STATE.business.efris_live_enabled ? `
    <div class="field-row">
      <div class="field"><label>EFRIS Commodity Category ID</label><input id="pf-efris-cat" value="${escapeHtml(p.efris_commodity_category_id || '')}" placeholder="e.g. 22011000" /></div>
      <div class="field"><label>EFRIS Measure Unit</label><input id="pf-efris-unit" value="${escapeHtml(p.efris_measure_unit || '101')}" placeholder="101 = Pieces" /></div>
    </div>
    <p class="help-text">Required before this product can be fiscalised. Look up the correct commodity category via your
      EFRIS provider's dictionary — 101 (Pieces) covers most retail goods as a measure unit default.</p>
    ` : ''}
    <p class="help-text">Prices are stored in ${STATE.business.base_currency} and auto-converted for other currencies in the POS.</p>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-product-btn">${editing ? 'Save Changes' : 'Add Product'}</button>
    </div>
  `, {
    onMount: () => {
      $('save-product-btn').addEventListener('click', async () => {
        const name = $('pf-name').value.trim();
        const price = parseFloat($('pf-price').value);
        if (!name || isNaN(price)) { toast('Product name and selling price are required', 'error'); return; }

        const record = {
          business_id: STATE.business.id,
          name,
          sku: $('pf-sku').value.trim() || null,
          barcode: $('pf-barcode').value.trim() || null,
          category_id: $('pf-category').value || null,
          unit: $('pf-unit').value.trim() || 'pc',
          cost_price: parseFloat($('pf-cost').value) || 0,
          selling_price: price,
          wholesale_price: $('pf-wholesale').value ? parseFloat($('pf-wholesale').value) : null,
          reorder_level: parseFloat($('pf-reorder').value) || 0,
          tax_category_code: $('pf-tax').value,
          expiry_date: $('pf-expiry').value || null,
        };

        if (STATE.business.efris_live_enabled) {
          const newCatId = $('pf-efris-cat').value.trim() || null;
          record.efris_commodity_category_id = newCatId;
          record.efris_measure_unit = $('pf-efris-unit').value.trim() || '101';
          // Changing the commodity category invalidates any prior EFRIS registration.
          if (editing && newCatId !== (p.efris_commodity_category_id || null)) record.efris_registered_at = null;
        }

        const query = editing
          ? supabase.from('products').update(record).eq('id', productId)
          : supabase.from('products').insert(record);
        const { error } = await query;
        if (error) { toast('Save failed: ' + error.message, 'error'); return; }

        toast(editing ? 'Product updated' : 'Product added', 'success');
        closeModal();
        await refreshProducts();
        renderTable();
      });
    },
  });
}

// ---------------------------------------------------------------------
// STOCK IN / OUT / ADJUSTMENT
// ---------------------------------------------------------------------
function openStockModal(productId) {
  const p = STATE.products.find((x) => x.id === productId);
  const currentStock = stockFor(productId);

  openModal(`
    <div class="modal-title-row"><h3>Adjust Stock — ${escapeHtml(p.name)}</h3></div>
    <p class="help-text">Current stock: <b>${currentStock} ${escapeHtml(p.unit || 'pc')}</b></p>
    <div class="field">
      <label>Movement Type</label>
      <select id="sm-type">
        <option value="in">Stock In (received)</option>
        <option value="out">Stock Out</option>
        <option value="adjustment">Adjustment (set exact quantity)</option>
        <option value="damaged">Damaged / Written Off</option>
        <option value="return">Customer Return (add back)</option>
      </select>
    </div>
    <div class="field"><label>Quantity</label><input type="number" step="0.01" id="sm-qty" value="0" /></div>
    <div class="field"><label>Notes</label><input id="sm-notes" placeholder="Optional reference / reason" /></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-stock-btn">Save</button>
    </div>
  `, {
    onMount: () => {
      $('save-stock-btn').addEventListener('click', async () => {
        const type = $('sm-type').value;
        const qty = parseFloat($('sm-qty').value);
        if (isNaN(qty) || qty < 0) { toast('Enter a valid quantity', 'error'); return; }

        let delta = 0;
        if (type === 'in' || type === 'return') delta = qty;
        else if (type === 'out' || type === 'damaged') delta = -qty;
        else if (type === 'adjustment') delta = qty - currentStock;

        const newQty = currentStock + delta;

        const { error: stockErr } = await supabase.from('product_stock').upsert({
          product_id: productId, branch_id: STATE.branch.id, quantity: newQty,
        }, { onConflict: 'product_id,branch_id' });
        if (stockErr) { toast('Stock update failed: ' + stockErr.message, 'error'); return; }

        await supabase.from('stock_movements').insert({
          business_id: STATE.business.id, branch_id: STATE.branch.id, product_id: productId,
          type, quantity: type === 'adjustment' ? delta : qty, notes: $('sm-notes').value || null,
          created_by: STATE.appUser.id,
        });

        toast('Stock updated', 'success');
        closeModal();
        await refreshProducts();
        renderTable();
      });
    },
  });
}

// ---------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------
function openCategoriesModal() {
  openModal(`
    <div class="modal-title-row"><h3>Categories</h3></div>
    <div id="cat-list" style="max-height:260px; overflow-y:auto; margin-bottom:14px;">
      ${STATE.categories.map((c) => `<div class="summary-row"><span>${escapeHtml(c.icon || '🏷️')} ${escapeHtml(c.name)}</span></div>`).join('') || '<p class="text-muted">No categories yet.</p>'}
    </div>
    <div class="field-row">
      <div class="field"><label>Icon (emoji)</label><input id="cat-icon" placeholder="🏷️" maxlength="4" /></div>
      <div class="field"><label>Category Name</label><input id="cat-name" placeholder="e.g. Beverages" /></div>
    </div>
    <div class="flex gap">
      <button class="btn btn-outline btn-block" data-close-modal>Close</button>
      <button class="btn btn-primary btn-block" id="add-cat-btn">Add Category</button>
    </div>
  `, {
    onMount: () => {
      $('add-cat-btn').addEventListener('click', async () => {
        const name = $('cat-name').value.trim();
        if (!name) { toast('Enter a category name', 'error'); return; }
        const { error } = await supabase.from('categories').insert({
          business_id: STATE.business.id, name, icon: $('cat-icon').value.trim() || '🏷️',
        });
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        const { data } = await supabase.from('categories').select('*').eq('business_id', STATE.business.id);
        STATE.categories = data || [];
        toast('Category added', 'success');
        closeModal();
      });
    },
  });
}

// ---------------------------------------------------------------------
// BARCODE LABELS
// ---------------------------------------------------------------------
function openBulkLabelsModal() {
  openModal(`
    <div class="modal-title-row"><h3>Print Barcode Labels</h3></div>
    <p class="help-text">Set how many copies to print for each product, then print the sheet. Products without a
      barcode print their SKU (or a system code) instead — add a real barcode in the product form for scannable labels.</p>
    <div style="max-height:360px; overflow-y:auto;">
      <table>
        <thead><tr><th>Product</th><th>Code</th><th style="width:90px;">Copies</th></tr></thead>
        <tbody>
          ${STATE.products.map((p) => `
            <tr>
              <td>${escapeHtml(p.name)}</td>
              <td class="text-muted">${escapeHtml(p.barcode || p.sku || '—')}</td>
              <td><input type="number" min="0" step="1" value="0" data-copies="${p.id}" style="width:70px;" /></td>
            </tr>`).join('') || '<tr><td colspan="3"><div class="empty-state">No products yet.</div></td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="print-labels-confirm-btn">Print Labels</button>
    </div>
  `, {
    large: true,
    onMount: (modalRoot) => {
      $('print-labels-confirm-btn').addEventListener('click', () => {
        const items = qsa('[data-copies]', modalRoot)
          .map((inp) => ({ productId: inp.dataset.copies, copies: parseInt(inp.value, 10) || 0 }))
          .filter((it) => it.copies > 0);
        if (!items.length) { toast('Set at least one copy count above 0', 'error'); return; }
        closeModal();
        printBarcodeLabels(items);
      });
    },
  });
}

// Accepts either an array of product IDs (1 copy each, used by the per-row
// "Label" button) or an array of { productId, copies } (bulk modal above).
function printBarcodeLabels(items) {
  const normalized = items
    .map((it) => (typeof it === 'string' ? { productId: it, copies: 1 } : it))
    .filter((it) => it.copies > 0);
  if (!normalized.length) { toast('Nothing to print', 'error'); return; }

  const labels = [];
  normalized.forEach(({ productId, copies }) => {
    const p = STATE.products.find((x) => x.id === productId);
    if (!p) return;
    const code = String(p.barcode || p.sku || p.id).replace(/[^A-Za-z0-9\-]/g, '').slice(0, 40) || p.id;
    for (let i = 0; i < copies; i++) labels.push({ id: `bc-${labels.length}`, product: p, code });
  });
  if (!labels.length) { toast('Could not find those products', 'error'); return; }

  const win = window.open('', '_blank', 'width=820,height=640');
  if (!win) { toast('Allow pop-ups for this site to print labels', 'error'); return; }

  win.document.write(`<html><head><title>Barcode Labels</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 10px; }
      .label-sheet { display: flex; flex-wrap: wrap; gap: 6px; }
      .label { width: 190px; border: 1px dashed #999; border-radius: 4px; padding: 8px; text-align: center; box-sizing: border-box; }
      .label .biz { font-size: 9px; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .label .name { font-size: 11.5px; font-weight: 700; margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .label .price { font-size: 13px; font-weight: 800; margin-top: 2px; }
      svg { width: 100%; height: auto; }
      @media print { .label { border: none; } }
    </style>
  </head><body>
    <div class="label-sheet">
      ${labels.map((l) => `
        <div class="label">
          <div class="biz">${escapeHtml(STATE.business.name)}</div>
          <div class="name">${escapeHtml(l.product.name)}</div>
          <svg id="${l.id}"></svg>
          <div class="price">${fmtMoney(l.product.selling_price)}</div>
        </div>`).join('')}
    </div>
  </body></html>`);
  win.document.close();

  const script = win.document.createElement('script');
  script.src = JSBARCODE_CDN;
  script.onload = () => {
    labels.forEach((l) => {
      try {
        win.JsBarcode(win.document.getElementById(l.id), l.code, {
          format: 'CODE128', height: 40, fontSize: 11, margin: 2, displayValue: true,
        });
      } catch (e) { console.warn('Barcode render failed for', l.code, e); }
    });
    win.focus();
    win.print();
  };
  script.onerror = () => toast('Could not load the barcode library — check your internet connection', 'error');
  win.document.body.appendChild(script);
}
