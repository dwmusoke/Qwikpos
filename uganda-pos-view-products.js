// =====================================================================
// QWICKPOS — PRODUCTS MODULE
// List, Add New, Categories, Tax, Units, Brands, Variants, Print Labels
// =====================================================================
import {
  supabase, STATE, $, qsa, escapeHtml, toast, openModal, closeModal,
  fmtMoney, refreshProducts, stockFor, sanitizeCsvValue,
  makePaginationState, paginationHtml, wirePagination,
  emptyStateHtml,
} from './uganda-pos-core.js';
import { logAuditAction } from './uganda-pos-view-audit.js';

let activeTab = 'list';

export async function renderProductsModule(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2 data-i18n="prod.list">Products</h2><p class="sub">${STATE.products.length} products · ${STATE.categories.length} categories</p></div>
    </div>
    <div class="notif-filters" id="products-tabs">
      ${[
        ['list', '📋 Product List'],
        ['add', '➕ Add New'],
        ['categories', '🏷️ Categories'],
        ['tax', '🏛️ Tax Types'],
        ['units', '📏 Units'],
        ['brands', '⭐ Brands'],
        ['variants', '🔀 Variants'],
        ['labels', '🖨️ Print Labels'],
      ].map(([k, l]) => `<button class="chip ${activeTab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <div id="products-body"></div>
  `;

  root.querySelectorAll('#products-tabs .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      root.querySelectorAll('#products-tabs .chip').forEach((c) => c.classList.toggle('active', c === btn));
      renderTab();
    });
  });

  await renderTab();

  async function renderTab() {
    const body = $('products-body');
    if (activeTab === 'list') await renderProductListTab(body);
    else if (activeTab === 'add') { activeTab = 'list'; await renderProductListTab(body); openProductModal(); }
    else if (activeTab === 'categories') await renderCategoriesTab(body);
    else if (activeTab === 'tax') await renderTaxTab(body);
    else if (activeTab === 'units') await renderUnitsTab(body);
    else if (activeTab === 'brands') await renderBrandsTab(body);
    else if (activeTab === 'variants') await renderVariantsTab(body);
    else if (activeTab === 'labels') await renderLabelsTab(body);
  }
}

// ── PRODUCT LIST ─────────────────────────────────────────────────────
async function renderProductListTab(body) {
  body.innerHTML = `
    <div class="card">
      <div class="field-row" style="align-items:end;">
        <div class="field" style="flex:2;"><label>Search</label><input id="pl-search" placeholder="Search by name, SKU, barcode…" /></div>
        <div class="field"><label>Category</label><select id="pl-cat"><option value="">All</option>${STATE.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="pl-add-btn">+ Add Product</button>
        <button class="btn btn-outline" id="pl-import-btn">📥 Import CSV</button>
        <button class="btn btn-outline" id="pl-labels-btn">🖨️ Labels</button>
      </div>
    </div>
    <div class="card"><div class="table-wrap" style="max-height:600px;overflow-y:auto;">
      <table><thead><tr><th>Product</th><th>Category</th><th>Brand</th><th>Cost</th><th>Price</th><th>Stock</th><th>Tax</th><th></th></tr></thead>
      <tbody id="pl-tbody"></tbody></table>
    </div></div>`;

  let searchTerm = '';
  let catFilter = '';
  const pState = makePaginationState(25);
  renderRows();

  $('pl-search').addEventListener('input', (e) => { searchTerm = e.target.value.toLowerCase(); pState.page = 0; renderRows(); });
  $('pl-cat').addEventListener('change', (e) => { catFilter = e.target.value; pState.page = 0; renderRows(); });
  $('pl-add-btn').addEventListener('click', () => openProductModal());
  $('pl-import-btn')?.addEventListener('click', () => openImportModal());
  $('pl-labels-btn')?.addEventListener('click', () => { activeTab = 'labels'; renderTab(); });

  function renderRows() {
    let list = STATE.products.filter((p) => p.is_active !== false);
    if (searchTerm) list = list.filter((p) => p.name.toLowerCase().includes(searchTerm) || (p.sku || '').toLowerCase().includes(searchTerm) || (p.barcode || '').toLowerCase().includes(searchTerm));
    if (catFilter) list = list.filter((p) => p.category_id === catFilter);

    pState.total = list.length;
    pState.hasMore = (pState.page + 1) * pState.pageSize < list.length;
    const page = list.slice(pState.page * pState.pageSize, (pState.page + 1) * pState.pageSize);

    const tableWrap = document.querySelector('#pl-tbody').closest('.table-wrap');

    const tbody = $('pl-tbody');
    tbody.innerHTML = page.length ? page.map((p) => {
      const cat = STATE.categories.find((c) => c.id === p.category_id);
      const brand = (STATE._brands || []).find((b) => b.id === p.brand_id);
      const stock = stockFor(p.id);
      const low = stock <= Number(p.reorder_level || 0);
      const expired = p.expiry_date && new Date(p.expiry_date) < new Date();
      const expiring = p.expiry_date && (new Date(p.expiry_date) - new Date()) / 864e5 <= 30 && new Date(p.expiry_date) > new Date();
      return `<tr>
        <td><b>${escapeHtml(p.name)}</b>${expired ? ' <span class="badge badge-red" style="font-size:10px">EXP</span>' : expiring ? ' <span class="badge badge-yellow" style="font-size:10px">EXP SOON</span>' : ''}<br><span class="text-muted" style="font-size:11px">SKU: ${escapeHtml(p.sku || '—')} · Barcode: ${escapeHtml(p.barcode || '—')}</span></td>
        <td>${escapeHtml(cat?.name || '—')}</td>
        <td>${escapeHtml(brand?.name || '—')}</td>
        <td>${fmtMoney(p.cost_price)}</td>
        <td>${fmtMoney(p.selling_price)}</td>
        <td><span class="badge ${low ? 'badge-red' : 'badge-green'}">${stock} ${escapeHtml(p.unit || 'pc')}</span></td>
        <td><span class="badge badge-blue">${escapeHtml(p.tax_category_code || 'STD')}</span></td>
        <td class="flex gap">
          <button class="btn btn-outline btn-sm" data-edit="${p.id}">Edit</button>
          <button class="btn btn-outline btn-sm" data-stock="${p.id}">Stock</button>
          <button class="btn btn-outline btn-sm" data-label="${p.id}">Label</button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="8">${emptyStateHtml("🏷️", "No Products Yet", "Start by adding your first product, or import multiple at once from a CSV file.", "+ Add Product", () => openProductModal())}<div style="text-align:center;margin-bottom:14px;"><button class="btn btn-outline btn-sm" data-import-csv>📥 Import CSV</button></div></td></tr>`;

    qsa('[data-edit]', tbody).forEach((b) => b.addEventListener('click', () => openProductModal(b.dataset.edit)));
    qsa('[data-stock]', tbody).forEach((b) => b.addEventListener('click', () => openStockModal(b.dataset.stock)));
    qsa('[data-label]', tbody).forEach((b) => b.addEventListener('click', () => openSingleLabelModal(b.dataset.label)));
    qsa('[data-import-csv]', tbody).forEach((b) => b.addEventListener('click', () => openImportModal()));

    let pagBar = tableWrap.querySelector('.pagination-bar');
    if (!pagBar) { pagBar = document.createElement('div'); tableWrap.after(pagBar); }
    pagBar.outerHTML = paginationHtml(pState);
    wirePagination(pState, renderRows);
  }
}

// ── PRODUCT MODAL (Add/Edit) ────────────────────────────────────────
async function openProductModal(productId) {
  const editing = !!productId;
  const p = editing ? STATE.products.find((x) => x.id === productId) : {};

  const brands = await loadBrands();
  const units = await loadUnits();

  openModal(`
    <div class="modal-title-row"><h3>${editing ? 'Edit' : 'Add'} Product</h3></div>
    <div class="field-row">
      <div class="field" style="flex:2;"><label>Product Name *</label><input id="pf-name" value="${escapeHtml(p.name || '')}" /></div>
      <div class="field"><label>Brand</label><select id="pf-brand"><option value="">— None —</option>${brands.map((b) => `<option value="${b.id}" ${p.brand_id === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>SKU</label><input id="pf-sku" value="${escapeHtml(p.sku || '')}" /></div>
      <div class="field"><label>Barcode</label><div style="display:flex;gap:6px;"><input id="pf-barcode" value="${escapeHtml(p.barcode || '')}" style="flex:1;" /><button type="button" class="btn btn-outline btn-sm" id="pf-scan-btn" title="Scan barcode with camera">📷 Scan</button></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Category</label><select id="pf-category"><option value="">— None —</option>${STATE.categories.map((c) => `<option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Unit</label><select id="pf-unit"><option value="">— None —</option>${units.map((u) => `<option value="${u.abbreviation}" ${p.unit === u.abbreviation ? 'selected' : ''}>${escapeHtml(u.name)} (${escapeHtml(u.abbreviation)})</option>`).join('')}<option value="_custom">Custom…</option></select></div>
    </div>
    <div id="pf-unit-custom-wrap" class="field" style="display:none;"><label>Custom Unit</label><input id="pf-unit-custom" value="${escapeHtml(p.unit || 'pc')}" placeholder="e.g. box, kg, m" /></div>
    <div class="field-row">
      <div class="field"><label>Cost Price</label><input type="number" step="0.01" id="pf-cost" value="${p.cost_price ?? ''}" /></div>
      <div class="field"><label>Selling Price *</label><input type="number" step="0.01" id="pf-price" value="${p.selling_price ?? ''}" /></div>
      <div class="field"><label>Wholesale Price</label><input type="number" step="0.01" id="pf-wholesale" value="${p.wholesale_price ?? ''}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Reorder Level</label><input type="number" step="1" id="pf-reorder" value="${p.reorder_level ?? 5}" /></div>
      <div class="field"><label>Tax Category</label><select id="pf-tax">${STATE.taxCategories.map((t) => `<option value="${t.code}" ${p.tax_category_code === t.code ? 'selected' : ''}>${escapeHtml(t.code)} (${t.rate}%)</option>`).join('')}</select></div>
      <div class="field"><label>Expiry Date</label><input type="date" id="pf-expiry" value="${p.expiry_date || ''}" /></div>
    </div>
    <div class="field"><label>Initial Stock (this branch)</label><input type="number" step="1" id="pf-stock" value="${editing ? '' : '0'}" ${editing ? 'disabled' : ''} placeholder="${editing ? 'Use Stock button to adjust' : '0'}" /></div>
    <div class="field">
      <label>Product Image</label>
      <div class="product-image-upload" id="pf-image-wrap">
        <div class="product-image-preview" id="pf-image-preview">${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="Product" />` : `<span class="product-image-placeholder">📷<br>Click to upload</span>`}</div>
        <input type="file" id="pf-image-file" accept="image/*" style="display:none" />
        <p class="help-text">JPG, PNG or WebP. Max 2MB.</p>
      </div>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-product-btn">${editing ? 'Save Changes' : 'Add Product'}</button>
    </div>
  `, {
    onMount: () => {
      // Unit custom toggle
      const unitSel = $('pf-unit');
      const customWrap = $('pf-unit-custom-wrap');
      unitSel?.addEventListener('change', () => { customWrap.style.display = unitSel.value === '_custom' ? '' : 'none'; });

      // Barcode scanner
      $('pf-scan-btn')?.addEventListener('click', async () => {
        try {
          const { default: QrScanner } = await import('https://esm.sh/qr-scanner@1.4.2');
          const video = document.createElement('video');
          video.style.width = '100%';
          video.style.maxWidth = '480px';
          video.style.borderRadius = '12px';
          const scannerOverlay = document.createElement('div');
          scannerOverlay.className = 'modal-overlay';
          scannerOverlay.style.zIndex = '300';
          scannerOverlay.innerHTML = `<div class="modal" style="max-width:520px;text-align:center;"><div class="modal-title-row"><h3>📷 Scan Barcode</h3><button class="btn btn-ghost" id="scanner-close">&times;</button></div><p class="help-text" style="margin-bottom:12px;">Point your camera at a barcode or QR code.</p></div>`;
          const modalContent = scannerOverlay.querySelector('.modal');
          modalContent.appendChild(video);
          document.body.appendChild(scannerOverlay);
          const scanner = new QrScanner(video, (result) => {
            if (result?.data) {
              $('pf-barcode').value = result.data;
              toast('Barcode scanned: ' + result.data, 'success');
              scanner.stop();
              scannerOverlay.remove();
            }
          }, { onDecodeError: () => {} });
          await scanner.start();
          $('scanner-close')?.addEventListener('click', () => { scanner.stop(); scannerOverlay.remove(); });
          scannerOverlay.addEventListener('click', (e) => { if (e.target === scannerOverlay) { scanner.stop(); scannerOverlay.remove(); } });
        } catch (scanErr) {
          toast('Camera scanner not available. Please enter barcode manually.', 'error');
          console.error('Scanner error:', scanErr);
        }
      });

      // Image upload
      let pendingImageFile = null;
      const preview = $('pf-image-preview');
      const fileInput = $('pf-image-file');
      preview?.addEventListener('click', () => fileInput?.click());
      fileInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { toast('Image must be under 2MB', 'error'); return; }
        pendingImageFile = file;
        const reader = new FileReader();
        reader.onload = (ev) => { preview.innerHTML = `<img src="${ev.target.result}" alt="Preview" />`; };
        reader.readAsDataURL(file);
      });

      $('save-product-btn').addEventListener('click', async () => {
        const name = $('pf-name').value.trim();
        const price = parseFloat($('pf-price').value);
        if (!name || isNaN(price)) { toast('Product name and selling price are required', 'error'); return; }

        let unitVal = unitSel.value;
        if (unitVal === '_custom') unitVal = $('pf-unit-custom').value.trim() || 'pc';

        const record = {
          name, sku: $('pf-sku').value.trim() || null, barcode: $('pf-barcode').value.trim() || null,
          category_id: $('pf-category').value || null, brand_id: $('pf-brand').value || null,
          unit: unitVal || 'pc', cost_price: parseFloat($('pf-cost').value) || 0,
          selling_price: price, wholesale_price: parseFloat($('pf-wholesale').value) || null,
          tax_category_code: $('pf-tax').value || 'STD',
          reorder_level: parseFloat($('pf-reorder').value) || 0,
          expiry_date: $('pf-expiry').value || null,
        };

        let saved;
        if (editing) {
          const { error } = await supabase.from('products').update(record).eq('id', productId);
          if (error) { toast('Failed: ' + error.message, 'error'); return; }
          saved = { id: productId };
          logAuditAction({ action: 'update', entityType: 'product', entityId: productId, entityName: record.name, newValue: record });
        } else {
          record.business_id = STATE.business.id;
          const { data, error } = await supabase.from('products').insert(record).select().single();
          if (error) { toast('Failed: ' + error.message, 'error'); return; }
          saved = data;
          logAuditAction({ action: 'create', entityType: 'product', entityId: saved.id, entityName: record.name, newValue: record });
        }

        // Upload image
        if (pendingImageFile && saved) {
          const ext = pendingImageFile.name.split('.').pop() || 'jpg';
          const path = `${STATE.business.id}/${saved.id}.${ext}`;
          const { error: uploadErr } = await supabase.storage.from('product-images').upload(path, pendingImageFile, { upsert: true });
          if (uploadErr?.message?.includes("Bucket not found")) {
            toast("Run uganda-pos-schema-v8c.sql to create storage buckets, then try again.", "error", 6000);
          } else if (uploadErr) {
            toast("Image upload failed: " + uploadErr.message, "error");
          } else {
            const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
            await supabase.from('products').update({ image_url: urlData.publicUrl }).eq('id', saved.id);
          }
        }

        // Initial stock for new products
        if (!editing && STATE.branch) {
          const initStock = parseFloat($('pf-stock').value) || 0;
          if (initStock > 0 && saved?.id) {
            await supabase.rpc('upsert_product_stock', { p_product_id: saved.id, p_branch_id: STATE.branch.id, p_quantity: initStock });
            await supabase.rpc('insert_stock_movement', { p_business_id: STATE.business.id, p_branch_id: STATE.branch.id, p_product_id: saved.id, p_type: 'in', p_quantity: initStock, p_notes: 'Initial stock', p_created_by: STATE.appUser?.id });
          }
        }

        toast(editing ? 'Product updated' : 'Product added', 'success');
        closeModal();
        await refreshProducts();
        renderTab();
      });
    }
  });
}

// ── CATEGORIES TAB ───────────────────────────────────────────────────
async function renderCategoriesTab(body) {
  body.innerHTML = `<div class="empty-state">Loading…</div>`;
  const { data: categories } = await supabase.from('categories').select('*').eq('business_id', STATE.business.id).order('name');
  const cats = categories || [];

  body.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">All Categories (${cats.length})</div>
        <div class="table-wrap" style="max-height:400px;overflow-y:auto;">
          <table><thead><tr><th>Icon</th><th>Name</th><th>Products</th><th></th></tr></thead>
          <tbody>
            ${cats.map((c) => {
              const count = STATE.products.filter((p) => p.category_id === c.id).length;
              return `<tr>
                <td style="font-size:20px;">${escapeHtml(c.icon || '📦')}</td>
                <td><b>${escapeHtml(c.name)}</b></td>
                <td>${count}</td>
                <td class="flex gap">
                  <button class="btn btn-ghost btn-sm" data-edit-cat="${c.id}">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-del-cat="${c.id}" style="color:var(--danger);">Delete</button>
                </td></tr>`;
            }).join('')}
            ${!cats.length ? '<tr><td colspan="4"><div class="empty-state">No categories yet.</div></td></tr>' : ''}
          </tbody></table>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Add Category</div>
        <div class="field"><label>Icon (emoji)</label><input id="cat-icon" placeholder="📦" style="width:80px;" /></div>
        <div class="field"><label>Category Name</label><input id="cat-name" placeholder="e.g. Beverages" /></div>
        <button class="btn btn-primary" id="add-cat-btn">+ Add Category</button>
      </div>
    </div>`;

  $('add-cat-btn').addEventListener('click', async () => {
    const icon = $('cat-icon').value.trim() || '📦';
    const name = $('cat-name').value.trim();
    if (!name) { toast('Category name is required', 'error'); return; }
    const { error } = await supabase.from('categories').insert({ business_id: STATE.business.id, name, icon });
    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    toast('Category added', 'success');
    logAuditAction({ action: 'create', entityType: 'category', entityName: name, newValue: { name, icon } });
    STATE.categories = (await supabase.from('categories').select('*').eq('business_id', STATE.business.id)).data || [];
    renderTab();
  });

  qsa('[data-edit-cat]', body).forEach((btn) => btn.addEventListener('click', async () => {
    const c = cats.find((x) => x.id === btn.dataset.editCat);
    openModal(`
      <div class="modal-title-row"><h3>Edit Category</h3></div>
      <div class="field"><label>Icon</label><input id="ecat-icon" value="${escapeHtml(c.icon || '📦')}" style="width:80px;" /></div>
      <div class="field"><label>Name</label><input id="ecat-name" value="${escapeHtml(c.name)}" /></div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="ecat-save">Save</button>
      </div>
    `, { onMount: () => {
      $('ecat-save').addEventListener('click', async () => {
        const { error } = await supabase.from('categories').update({ icon: $('ecat-icon').value.trim(), name: $('ecat-name').value.trim() }).eq('id', c.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('Category updated', 'success');
        STATE.categories = (await supabase.from('categories').select('*').eq('business_id', STATE.business.id)).data || [];
        closeModal(); renderTab();
      });
    }});
  }));

  qsa('[data-del-cat]', body).forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this category? Products in it will become uncategorized.')) return;
    await supabase.from('categories').delete().eq('id', btn.dataset.delCat);
    STATE.categories = (await supabase.from('categories').select('*').eq('business_id', STATE.business.id)).data || [];
    renderTab();
  }));
}

// ── TAX TYPES TAB ────────────────────────────────────────────────────
async function renderTaxTab(body) {
  body.innerHTML = `<div class="empty-state">Loading…</div>`;
  const { data: taxes } = await supabase.from('tax_categories').select('*').order('code');
  const taxList = taxes || [];

  body.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Tax Categories (${taxList.length})</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Rate</th><th>Description</th><th></th></tr></thead>
          <tbody>
            ${taxList.map((t) => `<tr>
              <td><b>${escapeHtml(t.code)}</b></td>
              <td>${t.rate}%</td>
              <td>${escapeHtml(t.description || '—')}</td>
              <td><button class="btn btn-ghost btn-sm" data-edit-tax="${t.code}" ${['STD', 'ZERO', 'EXEMPT'].includes(t.code) ? 'disabled title="System type"' : ''}>Edit</button></td>
            </tr>`).join('')}
          </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">Add Tax Category</div>
        <div class="field"><label>Code</label><input id="tax-code" placeholder="e.g. REDUCED" style="text-transform:uppercase;" /></div>
        <div class="field"><label>Rate (%)</label><input type="number" step="0.01" id="tax-rate" value="0" /></div>
        <div class="field"><label>Description</label><input id="tax-desc" placeholder="e.g. Reduced rate" /></div>
        <button class="btn btn-primary" id="add-tax-btn">+ Add Tax Category</button>
      </div>
    </div>`;

  $('add-tax-btn').addEventListener('click', async () => {
    const code = $('tax-code').value.trim().toUpperCase();
    const rate = parseFloat($('tax-rate').value);
    if (!code || isNaN(rate)) { toast('Code and rate are required', 'error'); return; }
    const { error } = await supabase.from('tax_categories').insert({ code, rate, description: $('tax-desc').value.trim() || null });
    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    toast('Tax category added', 'success');
    STATE.taxCategories = (await supabase.from('tax_categories').select('*').order('code')).data || [];
    renderTab();
  });

  qsa('[data-edit-tax]', body).forEach((btn) => btn.addEventListener('click', async () => {
    const t = taxList.find((x) => x.code === btn.dataset.editTax);
    openModal(`
      <div class="modal-title-row"><h3>Edit Tax — ${escapeHtml(t.code)}</h3></div>
      <div class="field"><label>Rate (%)</label><input type="number" step="0.01" id="etax-rate" value="${t.rate}" /></div>
      <div class="field"><label>Description</label><input id="etax-desc" value="${escapeHtml(t.description || '')}" /></div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="etax-save">Save</button>
      </div>
    `, { onMount: () => {
      $('etax-save').addEventListener('click', async () => {
        const { error } = await supabase.from('tax_categories').update({ rate: parseFloat($('etax-rate').value), description: $('etax-desc').value.trim() }).eq('code', t.code);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('Tax category updated', 'success');
        STATE.taxCategories = (await supabase.from('tax_categories').select('*').order('code')).data || [];
        closeModal(); renderTab();
      });
    }});
  }));
}

// ── UNITS TAB ────────────────────────────────────────────────────────
async function renderUnitsTab(body) {
  const units = await loadUnits();
  body.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Units of Measure (${units.length})</div>
        <div class="table-wrap" style="max-height:400px;overflow-y:auto;">
          <table><thead><tr><th>Name</th><th>Abbreviation</th><th>Products</th><th></th></tr></thead>
          <tbody>
            ${units.map((u) => {
              const count = STATE.products.filter((p) => p.unit === u.abbreviation).length;
              return `<tr>
                <td><b>${escapeHtml(u.name)}</b></td>
                <td>${escapeHtml(u.abbreviation)}</td>
                <td>${count}</td>
                <td class="flex gap">
                  <button class="btn btn-ghost btn-sm" data-edit-unit="${u.id}">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-del-unit="${u.id}" style="color:var(--danger);">Delete</button>
                </td></tr>`;
            }).join('')}
          </tbody></table>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Add Unit</div>
        <div class="field"><label>Name</label><input id="unit-name" placeholder="e.g. Kilogram" /></div>
        <div class="field"><label>Abbreviation</label><input id="unit-abbr" placeholder="e.g. kg" style="width:80px;" /></div>
        <button class="btn btn-primary" id="add-unit-btn">+ Add Unit</button>
      </div>
    </div>`;

  $('add-unit-btn').addEventListener('click', async () => {
    const name = $('unit-name').value.trim();
    const abbr = $('unit-abbr').value.trim();
    if (!name || !abbr) { toast('Name and abbreviation are required', 'error'); return; }
    const { error } = await supabase.from('units').insert({ business_id: STATE.business.id, name, abbreviation: abbr });
    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    toast('Unit added', 'success');
    renderTab();
  });

  qsa('[data-edit-unit]', body).forEach((btn) => btn.addEventListener('click', async () => {
    const u = units.find((x) => x.id === btn.dataset.editUnit);
    openModal(`
      <div class="modal-title-row"><h3>Edit Unit</h3></div>
      <div class="field"><label>Name</label><input id="eunit-name" value="${escapeHtml(u.name)}" /></div>
      <div class="field"><label>Abbreviation</label><input id="eunit-abbr" value="${escapeHtml(u.abbreviation)}" /></div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="eunit-save">Save</button>
      </div>
    `, { onMount: () => {
      $('eunit-save').addEventListener('click', async () => {
        const { error } = await supabase.from('units').update({ name: $('eunit-name').value.trim(), abbreviation: $('eunit-abbr').value.trim() }).eq('id', u.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('Unit updated', 'success'); closeModal(); renderTab();
      });
    }});
  }));

  qsa('[data-del-unit]', body).forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this unit?')) return;
    await supabase.from('units').delete().eq('id', btn.dataset.delUnit);
    renderTab();
  }));
}

// ── BRANDS TAB ───────────────────────────────────────────────────────
async function renderBrandsTab(body) {
  const brands = await loadBrands();
  body.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Brands (${brands.length})</div>
        <div class="table-wrap" style="max-height:400px;overflow-y:auto;">
          <table><thead><tr><th>Name</th><th>Products</th><th></th></tr></thead>
          <tbody>
            ${brands.map((b) => {
              const count = STATE.products.filter((p) => p.brand_id === b.id).length;
              return `<tr>
                <td><b>${escapeHtml(b.name)}</b></td>
                <td>${count}</td>
                <td class="flex gap">
                  <button class="btn btn-ghost btn-sm" data-edit-brand="${b.id}">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-del-brand="${b.id}" style="color:var(--danger);">Delete</button>
                </td></tr>`;
            }).join('')}
            ${!brands.length ? '<tr><td colspan="3"><div class="empty-state">No brands yet.</div></td></tr>' : ''}
          </tbody></table>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Add Brand</div>
        <div class="field"><label>Brand Name</label><input id="brand-name" placeholder="e.g. Coca-Cola" /></div>
        <button class="btn btn-primary" id="add-brand-btn">+ Add Brand</button>
      </div>
    </div>`;

  $('add-brand-btn').addEventListener('click', async () => {
    const name = $('brand-name').value.trim();
    if (!name) { toast('Brand name is required', 'error'); return; }
    const { error } = await supabase.from('brands').insert({ business_id: STATE.business.id, name });
    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    toast('Brand added', 'success');
    logAuditAction({ action: 'create', entityType: 'brand', entityName: name, newValue: { name } });
    STATE._brands = (await supabase.from('brands').select('*').eq('business_id', STATE.business.id)).data || [];
    renderTab();
  });

  qsa('[data-edit-brand]', body).forEach((btn) => btn.addEventListener('click', async () => {
    const b = brands.find((x) => x.id === btn.dataset.editBrand);
    openModal(`
      <div class="modal-title-row"><h3>Edit Brand</h3></div>
      <div class="field"><label>Name</label><input id="ebrand-name" value="${escapeHtml(b.name)}" /></div>
      <div class="flex gap" style="margin-top:14px;">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="ebrand-save">Save</button>
      </div>
    `, { onMount: () => {
      $('ebrand-save').addEventListener('click', async () => {
        const { error } = await supabase.from('brands').update({ name: $('ebrand-name').value.trim() }).eq('id', b.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('Brand updated', 'success');
        STATE._brands = (await supabase.from('brands').select('*').eq('business_id', STATE.business.id)).data || [];
        closeModal(); renderTab();
      });
    }});
  }));

  qsa('[data-del-brand]', body).forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this brand?')) return;
    await supabase.from('brands').delete().eq('id', btn.dataset.delBrand);
    STATE._brands = (await supabase.from('brands').select('*').eq('business_id', STATE.business.id)).data || [];
    renderTab();
  }));
}

// ── VARIANTS TAB ─────────────────────────────────────────────────────
async function renderVariantsTab(body) {
  const { data: variants } = await supabase.from('product_variants').select('*, product:products(name)').eq('business_id', STATE.business.id).order('created_at', { ascending: false });
  const vList = variants || [];

  let stockMap = {};
  if (vList.length) {
    const ids = vList.filter(v => v.id).map(v => v.id);
    const { data: stockRows } = await supabase.from('variant_stock').select('variant_id, quantity').in('variant_id', ids).eq('branch_id', STATE.branch?.id);
    (stockRows || []).forEach(r => { stockMap[r.variant_id] = r.quantity || 0; });
  }

  body.innerHTML = `
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>Product Variants (${vList.length})</span>
        <button class="btn btn-primary btn-sm" id="add-variant-btn">+ Add Variant</button>
      </div>
      <div class="table-wrap" style="max-height:500px;overflow-y:auto;">
        <table><thead><tr><th>Product</th><th>Variant Name</th><th>SKU</th><th>Barcode</th><th>Cost</th><th>Price</th><th>Stock</th><th></th></tr></thead>
        <tbody>
          ${vList.length ? vList.map((v) => {
            const stock = stockMap[v.id] || 0;
            return `<tr>
              <td>${escapeHtml(v.product?.name || '—')}</td>
              <td><b>${escapeHtml(v.name)}</b></td>
              <td>${escapeHtml(v.sku || '—')}</td>
              <td>${escapeHtml(v.barcode || '—')}</td>
              <td>${fmtMoney(v.cost_price || 0)}</td>
              <td>${fmtMoney(v.selling_price || 0)}</td>
              <td>${stock}</td>
              <td class="flex gap">
                <button class="btn btn-ghost btn-sm" data-edit-variant="${v.id}">Edit</button>
                <button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-delete-variant="${v.id}">Del</button>
              </td>
            </tr>`;
          }).join("") : `<tr><td colspan="8" class="empty-state">No variants yet</td></tr>`}
        </tbody>
      </table>
    </div>`;

  $('add-variant-btn').addEventListener('click', () => openVariantModal());
  qsa('[data-edit-variant]', body).forEach((btn) => btn.addEventListener('click', () => openVariantModal(btn.dataset.editVariant)));
  qsa('[data-del-variant]', body).forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this variant?')) return;
    await supabase.from('product_variants').delete().eq('id', btn.dataset.delVariant);
    toast('Variant deleted', 'success'); renderTab();
  }));
}

async function openVariantModal(variantId) {
  const editing = !!variantId;
  let v = {};
  if (editing) {
    const { data } = await supabase.from('product_variants').select('*').eq('id', variantId).single();
    v = data || {};
  }

  openModal(`
    <div class="modal-title-row"><h3>${editing ? 'Edit' : 'Add'} Variant</h3></div>
    <div class="field"><label>Parent Product *</label><select id="vf-product"><option value="">— Select —</option>${STATE.products.map((p) => `<option value="${p.id}" ${v.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Variant Name *</label><input id="vf-name" value="${escapeHtml(v.name || '')}" placeholder="e.g. Red / Large / 500ml" /></div>
    <div class="field-row">
      <div class="field"><label>SKU</label><input id="vf-sku" value="${escapeHtml(v.sku || '')}" /></div>
      <div class="field"><label>Barcode</label><input id="vf-barcode" value="${escapeHtml(v.barcode || '')}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Cost Price</label><input type="number" step="0.01" id="vf-cost" value="${v.cost_price ?? ''}" /></div>
      <div class="field"><label>Selling Price</label><input type="number" step="0.01" id="vf-price" value="${v.selling_price ?? ''}" /></div>
    </div>
    <div class="field"><label>Attributes (JSON)</label><textarea id="vf-attrs" rows="3">${JSON.stringify(v.attributes || {}, null, 2)}</textarea></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="vf-save">${editing ? 'Save' : 'Add Variant'}</button>
    </div>
  `, { onMount: () => {
    $('vf-save').addEventListener('click', async () => {
      const product_id = $('vf-product').value;
      const name = $('vf-name').value.trim();
      if (!product_id || !name) { toast('Product and variant name are required', 'error'); return; }
      let attrs = {};
      try { attrs = JSON.parse($('vf-attrs').value || '{}'); } catch (_) { toast('Invalid JSON in attributes', 'error'); return; }

      const record = {
        product_id, business_id: STATE.business.id, name,
        sku: $('vf-sku').value.trim() || null, barcode: $('vf-barcode').value.trim() || null,
        cost_price: parseFloat($('vf-cost').value) || null,
        selling_price: parseFloat($('vf-price').value) || null,
        attributes: attrs,
      };

      if (editing) {
        const { error } = await supabase.from('product_variants').update(record).eq('id', variantId);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
      } else {
        const { error } = await supabase.from('product_variants').insert(record);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
      }
      toast(editing ? 'Variant updated' : 'Variant added', 'success');
      closeModal(); renderTab();
    });
  }});
}

// ── PRINT LABELS TAB ─────────────────────────────────────────────────
async function renderLabelsTab(body) {
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Print Barcode Labels</div>
      <p class="help-text" style="margin-bottom:12px;">Select products and set the number of labels to print for each.</p>
      <div class="field"><label>Search</label><input id="lbl-search" placeholder="Filter products…" /></div>
      <div class="table-wrap" style="max-height:400px;overflow-y:auto;">
        <table><thead><tr><th><input type="checkbox" id="lbl-select-all" /></th><th>Product</th><th>Price</th><th>Barcode</th><th>Labels</th></tr></thead>
        <tbody id="lbl-tbody"></tbody></table>
      </div>
      <button class="btn btn-primary" id="lbl-print-btn" style="margin-top:12px;">🖨️ Print Selected Labels</button>
    </div>`;

  const labelCounts = {};
  renderLabelRows('');

  $('lbl-search').addEventListener('input', (e) => renderLabelRows(e.target.value.toLowerCase()));
  $('lbl-select-all').addEventListener('change', (e) => {
    qsa('.lbl-check', body).forEach((cb) => { cb.checked = e.target.checked; });
  });
  $('lbl-print-btn').addEventListener('click', printSelectedLabels);

  function renderLabelRows(search) {
    let list = STATE.products.filter((p) => p.is_active !== false);
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search));
    const tbody = $('lbl-tbody');
    tbody.innerHTML = list.map((p) => `
      <tr>
        <td><input type="checkbox" class="lbl-check" data-pid="${p.id}" /></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${fmtMoney(p.selling_price)}</td>
        <td>${escapeHtml(p.barcode || p.sku || '—')}</td>
        <td><input type="number" min="0" value="${labelCounts[p.id] || 0}" data-lbl-count="${p.id}" style="width:60px;" /></td>
      </tr>`).join('');

    qsa('[data-lbl-count]', tbody).forEach((inp) => {
      inp.addEventListener('change', () => { labelCounts[inp.dataset.lblCount] = parseInt(inp.value) || 0; });
    });
  }

  function printSelectedLabels() {
    const items = [];
    qsa('.lbl-check:checked', body).forEach((cb) => {
      const p = STATE.products.find((x) => x.id === cb.dataset.pid);
      const count = labelCounts[p.id] || 1;
      if (p && count > 0) items.push({ name: p.name, barcode: p.barcode || p.sku || '', price: p.selling_price, count });
    });
    if (!items.length) { toast('Select products and set label counts', 'error'); return; }
    printBarcodeLabels(items);
  }
}

// ── STOCK MODAL ──────────────────────────────────────────────────────
function openStockModal(productId) {
  const p = STATE.products.find((x) => x.id === productId);
  const stock = stockFor(productId);
  openModal(`
    <div class="modal-title-row"><h3>Adjust Stock — ${escapeHtml(p.name)}</h3></div>
    <div class="summary-row"><span>Current Stock</span><span><b>${stock}</b> ${escapeHtml(p.unit || 'pc')}</span></div>
    <div class="field"><label>Adjustment Type</label>
      <select id="stk-type">
        <option value="in">Stock In (Add)</option>
        <option value="out">Stock Out (Remove)</option>
        <option value="adjustment">Set Exact Quantity</option>
        <option value="return">Customer Return</option>
        <option value="damaged">Damaged / Write Off</option>
      </select>
    </div>
    <div class="field"><label>Quantity</label><input type="number" step="1" min="0" id="stk-qty" value="0" /></div>
    <div class="field"><label>Note</label><input id="stk-note" placeholder="Reason for adjustment" /></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="stk-save">Save Adjustment</button>
    </div>
  `, { onMount: () => {
    $('stk-save').addEventListener('click', async () => {
      const type = $('stk-type').value;
      const qty = parseFloat($('stk-qty').value);
      const note = $('stk-note').value.trim();
      if (isNaN(qty) || qty < 0) { toast('Enter a valid quantity', 'error'); return; }

      let newQty = stock;
      if (type === 'in' || type === 'return') newQty = stock + qty;
      else if (type === 'out' || type === 'damaged') newQty = Math.max(0, stock - qty);
      else newQty = qty;

      if (!STATE.branch?.id) { toast('No branch selected. Ensure your account has a business.', 'error'); return; }
      const { error: upsertErr } = await supabase.rpc('upsert_product_stock', { p_product_id: productId, p_branch_id: STATE.branch.id, p_quantity: newQty });
      if (upsertErr) { toast('Stock error: ' + upsertErr.message, 'error'); return; }
      const { error: movErr } = await supabase.rpc('insert_stock_movement', { p_business_id: STATE.business.id, p_branch_id: STATE.branch.id, p_product_id: productId, p_type: type, p_quantity: qty, p_notes: note || null, p_created_by: STATE.appUser?.id });
      if (movErr) { toast('Movement error: ' + movErr.message, 'error'); return; }
      STATE.stockByProduct[productId] = newQty;
      toast('Stock updated', 'success'); closeModal(); renderTab();
    });
  }});
}

// ── SINGLE LABEL MODAL ──────────────────────────────────────────────
function openSingleLabelModal(productId) {
  const p = STATE.products.find((x) => x.id === productId);
  openModal(`
    <div class="modal-title-row"><h3>🏷️ Print Label — ${escapeHtml(p.name)}</h3></div>
    <div style="padding:8px 0;">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
        <span style="font-size:13px;color:var(--text-muted);">Barcode:</span>
        <code style="font-size:13px;background:var(--surface-2);padding:2px 8px;border-radius:4px;">${escapeHtml(p.barcode || p.sku || "—")}</code>
      </div>
      <div class="field-row">
        <div class="field" style="margin-bottom:0;">
          <label>Number of Labels</label>
          <input type="number" min="1" value="1" id="sl-count" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Label Size</label>
          <select id="sl-size">
            <option value="small">Small (50×30mm)</option>
            <option value="medium" selected>Medium (50×40mm)</option>
            <option value="large">Large (70×50mm)</option>
            <option value="xl">Extra Large (100×60mm)</option>
          </select>
        </div>
      </div>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="sl-print">🖨️ Print</button>
    </div>
  `, { onMount: () => {
    $('sl-print').addEventListener('click', () => {
      const count = parseInt($('sl-count').value) || 1;
      const size = $('sl-size').value || 'medium';
      printBarcodeLabels([{ productId: p.id, count }], size);
      closeModal();
    });
  }});
}

// ── IMPORT CSV MODAL ─────────────────────────────────────────────────
function openImportModal() {
  openModal(`
    <div class="modal-title-row"><h3>Import Products from CSV</h3></div>
    <p class="help-text" style="margin-bottom:12px;">Download the sample template to see the expected format, then upload your file.</p>
    <div class="flex gap" style="margin-bottom:14px;">
      <button class="btn btn-outline" id="download-sample-btn">📄 Download Sample CSV</button>
    </div>
    <div class="field"><label>CSV File</label><input type="file" id="import-file" accept=".csv" /></div>
    <button class="btn btn-primary btn-block" id="import-run" style="margin-top:14px;">Import</button>
  `, { onMount: () => {
    $('download-sample-btn').addEventListener('click', () => {
      const csv = 'name,sku,barcode,category,brand,unit,cost_price,selling_price,wholesale_price,reorder_level,tax_category,stock\n' +
        'Milk Fresh 1L,MILK-001,8901234567890,Dairy,FreshCo,pc,3500,5000,4500,10,STD,50\n' +
        'Bread White Loaf,BREAD-001,,Bakery,NiceBake,pc,2500,4000,3500,5,ZERO,30\n' +
        'Sugar 1kg,SUGAR-001,9876543210987,Grocery,BestBrand,kg,3000,4500,4000,8,STD,100\n' +
        'Cooking Oil 2L,OIL-001,,Grocery,SunOil,litre,7000,10000,9000,5,STD,40\n' +
        'Mineral Water 500ml,WATER-001,5678901234567,Beverages,AquaPure,bottle,500,1000,800,15,EXEMPT,200';
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'qwickpos-product-import-sample.csv'; a.click();
      URL.revokeObjectURL(url);
    });
    $('import-run').addEventListener('click', async () => {
      const file = $('import-file').files[0];
      if (!file) { toast('Select a CSV file', 'error'); return; }
      const text = await file.text();
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) { toast('CSV is empty', 'error'); return; }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const nameIdx = headers.indexOf('name');
      const priceIdx = headers.indexOf('selling_price');
      if (nameIdx < 0 || priceIdx < 0) { toast('CSV must have name and selling_price columns', 'error'); return; }

      let count = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const name = cols[nameIdx]?.trim();
        const price = parseFloat(cols[priceIdx]);
        if (!name || isNaN(price)) continue;

        let saved;
        if (editing) {
          const { data, error } = await supabase.rpc('upsert_product', {
            p_business_id: STATE.business.id,
            p_name: name, p_sku: $('pf-sku').value.trim() || null,
            p_barcode: $('pf-barcode').value.trim() || null,
            p_category_id: $('pf-category').value || null,
            p_brand_id: $('pf-brand').value || null,
            p_unit: unitVal || 'pc',
            p_cost_price: parseFloat($('pf-cost').value) || 0,
            p_selling_price: price,
            p_wholesale_price: parseFloat($('pf-wholesale').value) || null,
            p_tax_category_code: $('pf-tax').value || 'STD',
            p_reorder_level: parseFloat($('pf-reorder').value) || 0,
            p_id: productId,
          });
          if (error) { toast('Failed: ' + error.message, 'error'); return; }
          saved = { id: productId };
          logAuditAction({ action: 'update', entityType: 'product', entityId: productId, entityName: name, newValue: record });
        } else {
          const { data, error } = await supabase.rpc('upsert_product', {
            p_business_id: STATE.business.id,
            p_name, p_sku: $('pf-sku').value.trim() || null,
            p_barcode: $('pf-barcode').value.trim() || null,
            p_description: null,
            p_category_id: $('pf-category').value || null,
            p_supplier_id: null,
            p_unit: unitVal || 'pc',
            p_cost_price: parseFloat($('pf-cost').value) || 0,
            p_selling_price: price,
            p_wholesale_price: parseFloat($('pf-wholesale').value) || null,
            p_tax_category_code: $('pf-tax').value || 'STD',
            p_reorder_level: parseFloat($('pf-reorder').value) || 0,
            p_is_active: true,
            p_brand_id: $('pf-brand').value || null,
            p_id: null,
          });
          if (error) { toast('Failed: ' + error.message, 'error'); return; }
          saved = data;
          logAuditAction({ action: 'create', entityType: 'product', entityId: saved?.id, entityName: name, newValue: record });
        }
      toast(`Imported ${count} products`, 'success');
      await refreshProducts();
      closeModal(); renderTab();
    });
  }});
}

// ── HELPER: LOAD BRANDS ──────────────────────────────────────────────
async function loadBrands() {
  if (STATE._brands) return STATE._brands;
  const { data } = await supabase.from('brands').select('*').eq('business_id', STATE.business.id).order('name');
  STATE._brands = data || [];
  return STATE._brands;
}

// ── HELPER: LOAD UNITS ───────────────────────────────────────────────
async function loadUnits() {
  if (STATE._units) return STATE._units;
  const { data } = await supabase.from('units').select('*').eq('business_id', STATE.business.id).order('name');
  STATE._units = data || [];
  // If no units seeded yet, seed defaults
  if (!STATE._units.length) {
    await supabase.rpc('seed_default_units', { p_business_id: STATE.business.id });
    const { data: seeded } = await supabase.from('units').select('*').eq('business_id', STATE.business.id).order('name');
    STATE._units = seeded || [];
  }
  return STATE._units;
}

// ── BARCODE LABEL PRINTER ────────────────────────────────────────────
const JSBARCODE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js";

function printBarcodeLabels(items, size = "medium") {
  const normalized = items
    .map((it) => {
      if (typeof it === "string") return { productId: it, count: 1 };
      return it;
    })
    .filter((it) => (it.count || 0) > 0);
  if (!normalized.length) {
    toast("Nothing to print", "error");
    return;
  }

  const labels = [];
  normalized.forEach((it) => {
    const p = STATE.products.find((x) => x.id === (it.productId || it.id));
    if (!p) return;
    const code = String(p.barcode || p.sku || p.id)
      .replace(/[^A-Za-z0-9\-]/g, "")
      .slice(0, 40) || p.id;
    const count = it.count || 1;
    for (let i = 0; i < count; i++)
      labels.push({ id: `bc-${labels.length}`, product: p, code });
  });
  if (!labels.length) {
    toast("Could not find those products", "error");
    return;
  }

  const sizes = {
    small: { width: "50mm", height: "30mm", barcodeH: 30, fontSize: 9, nameSize: 8, priceSize: 10, bizSize: 7 },
    medium: { width: "50mm", height: "40mm", barcodeH: 40, fontSize: 10, nameSize: 10, priceSize: 12, bizSize: 8 },
    large: { width: "70mm", height: "50mm", barcodeH: 50, fontSize: 12, nameSize: 12, priceSize: 14, bizSize: 9 },
    xl: { width: "100mm", height: "60mm", barcodeH: 55, fontSize: 14, nameSize: 14, priceSize: 16, bizSize: 10 },
  };
  const s = sizes[size] || sizes.medium;

  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) {
    toast("Allow pop-ups to print labels", "error");
    return;
  }

  w.document.write(`<!DOCTYPE html><html><head><title>Barcode Labels — ${escapeHtml(STATE.business?.name || "")}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 12px; background: #fff; }
      .header { text-align: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #ddd; }
      .header h2 { margin: 0; font-size: 14px; color: #333; }
      .header p { margin: 4px 0 0; font-size: 11px; color: #888; }
      .sheet { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-start; }
      .label {
        width: ${s.width}; height: ${s.height}; border: 1px dashed #ccc; border-radius: 4px;
        padding: 3mm; text-align: center; display: inline-flex; flex-direction: column;
        justify-content: center; align-items: center; page-break-inside: avoid; background: #fff;
      }
      .label .biz { font-size: ${s.bizSize}pt; color: #666; margin-bottom: 1mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      .label .name { font-size: ${s.nameSize}pt; font-weight: 700; margin: 1mm 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      .label svg { width: 90%; height: auto; margin: 1mm 0; }
      .label .price { font-size: ${s.priceSize}pt; font-weight: 800; color: #222; margin-top: 1mm; }
      .label .sku { font-size: 7pt; color: #999; }
      @media print { body { padding: 0; } .header { display: none; } .label { border: 1px solid #000; } }
    </style></head><body>
    <div class="header">
      <h2>${escapeHtml(STATE.business?.name || "Barcode Labels")}</h2>
      <p>${labels.length} labels · ${new Date().toLocaleDateString()}</p>
    </div>
    <div class="sheet">
      ${labels.map((l) => `
        <div class="label">
          <div class="biz">${escapeHtml(STATE.business?.name || "")}</div>
          <div class="name">${escapeHtml(l.product.name)}</div>
          <svg id="${l.id}"></svg>
          <div class="price">${fmtMoney(l.product.selling_price)}</div>
          <div class="sku">${escapeHtml(l.code)}</div>
        </div>
      `).join("")}
    </div>
    <script src="${JSBARCODE_CDN}"><\/script>
    <script>
      try {
        document.querySelectorAll('svg').forEach(svg => {
          JsBarcode(svg, svg.id.replace('bc-', ''), { format: 'CODE128', height: ${s.barcodeH}, fontSize: ${s.fontSize}, margin: 2, displayValue: true, background: '#fff', lineColor: '#000' });
        });
      } catch(e) { console.warn(e); }
      setTimeout(() => window.print(), 500);
    <\/script>
  </body></html>`);
  w.document.close();
}
