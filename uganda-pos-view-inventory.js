// =====================================================================
// QWICKPOS — INVENTORY VIEW (v2)
// Full inventory management: products, stock, transfers, imports, counts
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
  fmtMoney,
  fmtDate,
  refreshProducts,
  stockFor,
  hasFeature,
} from "./uganda-pos-core.js";

const JSBARCODE_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js";

let invSearch = "";
let invTab = "products";

export async function renderInventory(root) {
  root.innerHTML = `
    <div class="view-header">
      <div>
        <h2>Inventory</h2>
        <p class="sub">${STATE.products.length} products · ${STATE.categories.length} categories · ${STATE.branches.length} branches</p>
      </div>
    </div>

    <div class="admin-tabs" id="inv-tabs">
      <button class="admin-tab ${invTab === "products" ? "active" : ""}" data-tab="products">Products</button>
      <button class="admin-tab ${invTab === "transfers" ? "active" : ""}" data-tab="transfers">Transfers</button>
      <button class="admin-tab ${invTab === "stockcount" ? "active" : ""}" data-tab="stockcount">Stock Count</button>
      <button class="admin-tab ${invTab === "movements" ? "active" : ""}" data-tab="movements">History</button>
      <button class="admin-tab ${invTab === "purchase" ? "active" : ""}" data-tab="purchase">Purchase Orders</button>
      <button class="admin-tab ${invTab === "production" ? "active" : ""}" data-tab="production">Production</button>
      <button class="admin-tab ${invTab === "valuation" ? "active" : ""}" data-tab="valuation">Valuation</button>
    </div>

    <div id="inv-tab-content"></div>
  `;

  qsa(".admin-tab", root).forEach((tab) => {
    tab.addEventListener("click", () => {
      invTab = tab.dataset.tab;
      qsa(".admin-tab", root).forEach((t) =>
        t.classList.toggle("active", t.dataset.tab === invTab),
      );
      renderInvTab();
    });
  });

  function renderInvTab() {
    const el = $("inv-tab-content");
    if (invTab === "products") renderProductsTab(el);
    else if (invTab === "transfers") renderTransfersTab(el);
    else if (invTab === "stockcount") renderStockCountTab(el);
    else if (invTab === "movements") renderMovementsTab(el);
    else if (invTab === "purchase") renderPurchaseTab(el);
    else if (invTab === "production") renderProductionTab(el);
    else if (invTab === "valuation") renderValuationTab(el);
  }

  renderInvTab();
}

// ---------------------------------------------------------------------
// PRODUCTS TAB
// ---------------------------------------------------------------------
function renderProductsTab(el) {
  el.innerHTML = `
    <div class="flex gap" style="margin-bottom:14px;flex-wrap:wrap">
      <div class="pos-search-row" style="flex:1;min-width:200px;max-width:380px">
        <input id="inv-search" placeholder="Search products, SKU or scan barcode…" />
      </div>
      <button class="btn btn-outline" id="manage-categories-btn">🏷️ Categories</button>
      <button class="btn btn-outline" id="import-products-btn">📥 Import CSV</button>
      <button class="btn btn-outline" id="bulk-labels-btn">🏷️ Print Labels</button>
      <button class="btn btn-outline" id="scan-camera-btn" title="Scan barcode with camera">📷 Scan</button>
      <button class="btn btn-primary" id="add-product-btn">+ Add Product</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Product</th><th>Category</th><th>Cost</th><th>Price</th><th>Stock</th><th>Tax</th>${STATE.business.efris_live_enabled ? "<th>EFRIS</th>" : ""}<th></th></tr>
        </thead>
        <tbody id="inv-table-body"></tbody>
      </table>
    </div>
  `;

  renderProductTable();
  $("inv-search")?.addEventListener("input", (e) => {
    invSearch = e.target.value.toLowerCase();
    renderProductTable();
  });
  $("add-product-btn")?.addEventListener("click", () => openProductModal());
  $("manage-categories-btn")?.addEventListener("click", () =>
    openCategoriesModal(),
  );
  $("bulk-labels-btn")?.addEventListener("click", () => openBulkLabelsModal());
  $("import-products-btn")?.addEventListener("click", () => openImportModal());
  $("scan-camera-btn")?.addEventListener("click", () => openCameraScanner());
}

function renderProductTable() {
  const tbody = $("inv-table-body");
  if (!tbody) return;
  let list = STATE.products;
  if (invSearch) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(invSearch) ||
        (p.sku || "").toLowerCase().includes(invSearch) ||
        (p.barcode || "").toLowerCase().includes(invSearch),
    );
  }

  if (!list.length) {
    const colSpan = STATE.business.efris_live_enabled ? 9 : 8;
    tbody.innerHTML = `<tr><td colspan="${colSpan}"><div class="empty-state">No products yet. Click "Add Product" or "Import CSV" to get started.</div></td></tr>`;
    return;
  }

  const efrisOn = STATE.business.efris_live_enabled;

  tbody.innerHTML = list
    .map((p) => {
      const cat = STATE.categories.find((c) => c.id === p.category_id);
      const stock = stockFor(p.id);
      const low = stock <= Number(p.reorder_level || 0);
      return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            ${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="" style="width:36px;height:36px;border-radius:6px;object-fit:cover" />` : `<div style="width:36px;height:36px;border-radius:6px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:16px">📦</div>`}
            <div><b>${escapeHtml(p.name)}</b><br/><span class="text-muted" style="font-size:11.5px;">SKU: ${escapeHtml(p.sku || "—")} · Barcode: ${escapeHtml(p.barcode || "—")}</span></div>
          </div>
        </td>
        <td>${escapeHtml(cat?.name || "—")}</td>
        <td>${fmtMoney(p.cost_price)}</td>
        <td>${fmtMoney(p.selling_price)}</td>
        <td><span class="badge ${low ? "badge-red" : "badge-green"}">${stock} ${escapeHtml(p.unit || "pc")}</span></td>
        <td><span class="badge badge-blue">${escapeHtml(p.tax_category_code || "STD")}</span></td>
        ${efrisOn ? `<td>${p.efris_registered_at ? '<span class="badge badge-green">registered</span>' : `<button class="btn btn-outline btn-sm" data-efris-register="${p.id}">Register</button>`}</td>` : ""}
        <td class="flex gap">
          <button class="btn btn-outline btn-sm" data-edit="${p.id}">Edit</button>
          <button class="btn btn-outline btn-sm" data-stock="${p.id}">Stock</button>
          <button class="btn btn-outline btn-sm" data-label="${p.id}">Label</button>
        </td>
      </tr>`;
    })
    .join("");

  qsa("[data-edit]", tbody).forEach((b) =>
    b.addEventListener("click", () => openProductModal(b.dataset.edit)),
  );
  qsa("[data-stock]", tbody).forEach((b) =>
    b.addEventListener("click", () => openStockModal(b.dataset.stock)),
  );
  qsa("[data-label]", tbody).forEach((b) =>
    b.addEventListener("click", () => printBarcodeLabels([b.dataset.label])),
  );
  qsa("[data-efris-register]", tbody).forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "Registering…";
      const { data, error } = await supabase.functions.invoke(
        "efris-register-product",
        { body: { productId: b.dataset.efrisRegister } },
      );
      if (error || !data?.success) {
        toast(
          "EFRIS registration failed: " +
            (data?.error || error?.message || "unknown error"),
          "error",
          6000,
        );
        b.disabled = false;
        b.textContent = "Register";
        return;
      }
      toast("Product registered with EFRIS", "success");
      await refreshProducts();
      renderProductTable();
    }),
  );
}

// ---------------------------------------------------------------------
// ADD / EDIT PRODUCT
// ---------------------------------------------------------------------
function openProductModal(productId) {
  const editing = !!productId;
  const p = editing ? STATE.products.find((x) => x.id === productId) : {};

  openModal(
    `
    <div class="modal-title-row"><h3>${editing ? "Edit" : "Add"} Product</h3></div>
    <div class="field"><label>Product Name *</label><input id="pf-name" value="${escapeHtml(p.name || "")}" /></div>
    <div class="field-row">
      <div class="field"><label>SKU</label><input id="pf-sku" value="${escapeHtml(p.sku || "")}" /></div>
      <div class="field"><label>Barcode</label><input id="pf-barcode" value="${escapeHtml(p.barcode || "")}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Category</label>
        <select id="pf-category"><option value="">—</option>${STATE.categories.map((c) => `<option value="${c.id}" ${p.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Unit</label><input id="pf-unit" value="${escapeHtml(p.unit || "pc")}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Cost Price (${STATE.business.base_currency})</label><input type="number" step="0.01" id="pf-cost" value="${p.cost_price ?? 0}" /></div>
      <div class="field"><label>Selling Price (${STATE.business.base_currency}) *</label><input type="number" step="0.01" id="pf-price" value="${p.selling_price ?? 0}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Wholesale Price</label><input type="number" step="0.01" id="pf-wholesale" value="${p.wholesale_price ?? ""}" /></div>
      <div class="field"><label>Reorder Level</label><input type="number" step="1" id="pf-reorder" value="${p.reorder_level ?? 5}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>VAT / Tax Category</label>
        <select id="pf-tax">${STATE.taxCategories.map((t) => `<option value="${t.code}" ${p.tax_category_code === t.code ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Expiry Date</label><input type="date" id="pf-expiry" value="${p.expiry_date || ""}" /></div>
    </div>
    <div class="field"><label>Initial Stock (this branch)</label><input type="number" step="1" id="pf-stock" value="${editing ? "" : "0"}" ${editing ? "disabled" : ""} placeholder="${editing ? "Use Stock button to adjust" : "0"}" /></div>
    <div class="field">
      <label>Product Image</label>
      <div class="product-image-upload" id="pf-image-wrap">
        <div class="product-image-preview" id="pf-image-preview">
          ${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="Product" />` : `<span class="product-image-placeholder">📷<br>Click to upload</span>`}
        </div>
        <input type="file" id="pf-image-file" accept="image/*" style="display:none" />
        <p class="help-text">JPG, PNG or WebP. Max 2MB. Recommended: 400×400px</p>
      </div>
    </div>
    ${
      STATE.business.efris_live_enabled
        ? `
    <div class="field-row">
      <div class="field"><label>EFRIS Commodity Category ID</label><input id="pf-efris-cat" value="${escapeHtml(p.efris_commodity_category_id || "")}" placeholder="e.g. 22011000" /></div>
      <div class="field"><label>EFRIS Measure Unit</label><input id="pf-efris-unit" value="${escapeHtml(p.efris_measure_unit || "101")}" placeholder="101 = Pieces" /></div>
    </div>`
        : ""
    }
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-product-btn">${editing ? "Save Changes" : "Add Product"}</button>
    </div>
  `,
    {
      onMount: () => {
        // Image upload preview
        let pendingImageFile = null;
        const preview = $("pf-image-preview");
        const fileInput = $("pf-image-file");

        preview?.addEventListener("click", () => fileInput?.click());
        fileInput?.addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            toast("Image must be under 2MB", "error");
            return;
          }
          pendingImageFile = file;
          const reader = new FileReader();
          reader.onload = (ev) => {
            preview.innerHTML = `<img src="${ev.target.result}" alt="Preview" />`;
          };
          reader.readAsDataURL(file);
        });

        $("save-product-btn").addEventListener("click", async () => {
          const name = $("pf-name").value.trim();
          const price = parseFloat($("pf-price").value);
          if (!name || isNaN(price)) {
            toast("Product name and selling price are required", "error");
            return;
          }

          const record = {
            business_id: STATE.business.id,
            name,
            sku: $("pf-sku").value.trim() || null,
            barcode: $("pf-barcode").value.trim() || null,
            category_id: $("pf-category").value || null,
            unit: $("pf-unit").value.trim() || "pc",
            cost_price: parseFloat($("pf-cost").value) || 0,
            selling_price: price,
            wholesale_price: $("pf-wholesale").value
              ? parseFloat($("pf-wholesale").value)
              : null,
            reorder_level: parseFloat($("pf-reorder").value) || 0,
            tax_category_code: $("pf-tax").value,
            expiry_date: $("pf-expiry").value || null,
          };

          if (STATE.business.efris_live_enabled) {
            record.efris_commodity_category_id =
              $("pf-efris-cat").value.trim() || null;
            record.efris_measure_unit =
              $("pf-efris-unit").value.trim() || "101";
            if (
              editing &&
              $("pf-efris-cat").value.trim() !==
                (p.efris_commodity_category_id || "")
            )
              record.efris_registered_at = null;
          }

          const query = editing
            ? supabase.from("products").update(record).eq("id", productId)
            : supabase.from("products").insert(record);
          const { data: saved, error } = await query.select().single();
          if (error) {
            toast("Save failed: " + error.message, "error");
            return;
          }

          // Upload image if selected
          if (pendingImageFile && saved) {
            const ext = pendingImageFile.name.split(".").pop() || "jpg";
            const path = `${STATE.business.id}/${saved.id}.${ext}`;
            const { error: uploadErr } = await supabase.storage
              .from("product-images")
              .upload(path, pendingImageFile, { upsert: true });
            if (!uploadErr) {
              const { data: urlData } = supabase.storage
                .from("product-images")
                .getPublicUrl(path);
              await supabase
                .from("products")
                .update({ image_url: urlData.publicUrl })
                .eq("id", saved.id);
            }
          }

          // Set initial stock for new products
          if (!editing && STATE.branch) {
            const initStock = parseFloat($("pf-stock").value) || 0;
            if (initStock > 0) {
              await supabase.from("product_stock").upsert(
                {
                  product_id: saved.id,
                  branch_id: STATE.branch.id,
                  quantity: initStock,
                },
                { onConflict: "product_id,branch_id" },
              );
              await supabase.from("stock_movements").insert({
                business_id: STATE.business.id,
                branch_id: STATE.branch.id,
                product_id: saved.id,
                type: "in",
                quantity: initStock,
                notes: "Initial stock",
                created_by: STATE.appUser.id,
              });
            }
          }

          toast(editing ? "Product updated" : "Product added", "success");
          closeModal();
          await refreshProducts();
          renderProductTable();
        });
      },
    },
  );
}

// ---------------------------------------------------------------------
// STOCK IN / OUT / ADJUSTMENT
// ---------------------------------------------------------------------
function openStockModal(productId) {
  const p = STATE.products.find((x) => x.id === productId);
  const currentStock = stockFor(productId);

  openModal(
    `
    <div class="modal-title-row"><h3>Adjust Stock — ${escapeHtml(p.name)}</h3></div>
    <p class="help-text">Current stock at ${escapeHtml(STATE.branch?.name || "this branch")}: <b>${currentStock} ${escapeHtml(p.unit || "pc")}</b></p>
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
  `,
    {
      onMount: () => {
        $("save-stock-btn").addEventListener("click", async () => {
          const type = $("sm-type").value;
          const qty = parseFloat($("sm-qty").value);
          if (isNaN(qty) || qty < 0) {
            toast("Enter a valid quantity", "error");
            return;
          }

          let delta = 0;
          if (type === "in" || type === "return") delta = qty;
          else if (type === "out" || type === "damaged") delta = -qty;
          else if (type === "adjustment") delta = qty - currentStock;

          const newQty = currentStock + delta;

          const { error: stockErr } = await supabase
            .from("product_stock")
            .upsert(
              {
                product_id: productId,
                branch_id: STATE.branch.id,
                quantity: newQty,
              },
              { onConflict: "product_id,branch_id" },
            );
          if (stockErr) {
            toast("Stock update failed: " + stockErr.message, "error");
            return;
          }

          await supabase.from("stock_movements").insert({
            business_id: STATE.business.id,
            branch_id: STATE.branch.id,
            product_id: productId,
            type,
            quantity: type === "adjustment" ? delta : qty,
            notes: $("sm-notes").value || null,
            created_by: STATE.appUser.id,
          });

          toast("Stock updated", "success");
          closeModal();
          await refreshProducts();
          renderProductTable();
        });
      },
    },
  );
}

// ---------------------------------------------------------------------
// CSV IMPORT
// ---------------------------------------------------------------------
function openImportModal() {
  openModal(
    `
    <div class="modal-title-row"><h3>Import Products from CSV</h3></div>
    <p class="help-text" style="margin-bottom:12px">Upload a CSV file with columns: <b>name</b> (required), <b>sku</b>, <b>barcode</b>, <b>category</b>, <b>unit</b>, <b>cost_price</b>, <b>selling_price</b> (required), <b>wholesale_price</b>, <b>reorder_level</b>, <b>tax_category</b>, <b>stock</b> (initial quantity at this branch).</p>
    <div class="field">
      <label>CSV File</label>
      <input type="file" id="csv-file" accept=".csv,.tsv,.txt" />
    </div>
    <div id="csv-preview" style="max-height:240px;overflow-y:auto;margin-top:10px"></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="csv-import-btn" disabled>Import</button>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        let parsedRows = [];
        $("csv-file").addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const text = ev.target.result;
            parsedRows = parseCSV(text);
            if (!parsedRows.length) {
              toast("No data found in CSV", "error");
              return;
            }
            const preview = parsedRows
              .slice(0, 5)
              .map(
                (r) =>
                  `<tr><td>${escapeHtml(r.name || "")}</td><td>${escapeHtml(r.sku || "")}</td><td>${escapeHtml(r.barcode || "")}</td><td>${r.selling_price || ""}</td><td>${r.stock || 0}</td></tr>`,
              )
              .join("");
            $("csv-preview").innerHTML = `
              <p class="help-text">${parsedRows.length} rows found. Preview:</p>
              <table style="font-size:12px"><thead><tr><th>Name</th><th>SKU</th><th>Barcode</th><th>Price</th><th>Stock</th></tr></thead><tbody>${preview}</tbody></table>
            `;
            $("csv-import-btn").disabled = false;
          };
          reader.readAsText(file);
        });

        $("csv-import-btn").addEventListener("click", async () => {
          if (!parsedRows.length) return;
          const btn = $("csv-import-btn");
          btn.disabled = true;
          btn.textContent = `Importing… 0/${parsedRows.length}`;

          let imported = 0;
          let failed = 0;

          for (const row of parsedRows) {
            if (!row.name || !row.selling_price) {
              failed++;
              continue;
            }

            const catId = row.category
              ? STATE.categories.find(
                  (c) => c.name.toLowerCase() === row.category.toLowerCase(),
                )?.id || null
              : null;

            const { data: product, error } = await supabase
              .from("products")
              .insert({
                business_id: STATE.business.id,
                name: row.name.trim(),
                sku: row.sku || null,
                barcode: row.barcode || null,
                category_id: catId,
                unit: row.unit || "pc",
                cost_price: parseFloat(row.cost_price) || 0,
                selling_price: parseFloat(row.selling_price) || 0,
                wholesale_price: row.wholesale_price
                  ? parseFloat(row.wholesale_price)
                  : null,
                reorder_level: parseFloat(row.reorder_level) || 5,
                tax_category_code: row.tax_category || "STD",
              })
              .select()
              .single();

            if (error) {
              failed++;
              continue;
            }

            // Set initial stock
            const stockQty = parseFloat(row.stock) || 0;
            if (stockQty > 0 && STATE.branch) {
              await supabase.from("product_stock").upsert(
                {
                  product_id: product.id,
                  branch_id: STATE.branch.id,
                  quantity: stockQty,
                },
                { onConflict: "product_id,branch_id" },
              );
              await supabase.from("stock_movements").insert({
                business_id: STATE.business.id,
                branch_id: STATE.branch.id,
                product_id: product.id,
                type: "in",
                quantity: stockQty,
                notes: "CSV import",
                created_by: STATE.appUser.id,
              });
            }

            imported++;
            btn.textContent = `Importing… ${imported}/${parsedRows.length}`;
          }

          toast(
            `Imported ${imported} products (${failed} failed)`,
            imported > 0 ? "success" : "error",
          );
          closeModal();
          await refreshProducts();
          renderProductTable();
        });
      },
    },
  );
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] || "";
    });
    return row;
  });
}

// ---------------------------------------------------------------------
// CAMERA BARCODE SCANNER
// ---------------------------------------------------------------------
function openCameraScanner() {
  openModal(
    `
    <div class="modal-title-row"><h3>Scan Barcode</h3></div>
    <div id="scanner-area" style="width:100%;height:300px;background:#000;border-radius:8px;overflow:hidden;position:relative">
      <video id="scanner-video" style="width:100%;height:100%;object-fit:cover" autoplay playsinline></video>
      <div style="position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#fff;padding:6px 16px;border-radius:999px;font-size:12px">Point camera at barcode</div>
    </div>
    <p class="help-text" style="margin-top:10px;text-align:center">Or type barcode manually:</p>
    <div class="field" style="margin-top:6px"><input id="manual-barcode" placeholder="Type barcode and press Enter" autofocus /></div>
    <div id="scan-result" style="margin-top:10px;text-align:center;font-weight:600"></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Close</button>
    </div>
  `,
    {
      large: true,
      onMount: (root) => {
        let stream = null;
        const video = $("scanner-video");
        const resultEl = $("scan-result");

        // Start camera
        navigator.mediaDevices
          ?.getUserMedia({ video: { facingMode: "environment" } })
          .then((s) => {
            stream = s;
            video.srcObject = stream;
          })
          .catch(() => {
            resultEl.textContent =
              "Camera not available — use manual entry below";
          });

        // Try to use BarcodeDetector API if available
        if ("BarcodeDetector" in window) {
          const detector = new BarcodeDetector({
            formats: [
              "ean_13",
              "ean_8",
              "code_128",
              "code_39",
              "upc_a",
              "upc_e",
            ],
          });
          const scan = async () => {
            if (!stream || !video.videoWidth) {
              requestAnimationFrame(scan);
              return;
            }
            try {
              const barcodes = await detector.detect(video);
              if (barcodes.length) {
                handleBarcode(barcodes[0].rawValue);
                return;
              }
            } catch (_) {}
            requestAnimationFrame(scan);
          };
          video.addEventListener("playing", () => requestAnimationFrame(scan));
        }

        function handleBarcode(code) {
          const product = STATE.products.find(
            (p) =>
              p.barcode === code ||
              p.sku === code ||
              p.name.toLowerCase() === code.toLowerCase(),
          );
          if (product) {
            resultEl.innerHTML = `✅ Found: <b>${escapeHtml(product.name)}</b> — ${fmtMoney(product.selling_price)}`;
            // Add to cart
            const { STATE: S } = window;
            if (typeof window._addToCart === "function") {
              window._addToCart(product.id);
            }
          } else {
            resultEl.innerHTML = `❌ No product found for: <b>${escapeHtml(code)}</b>`;
          }
        }

        // Manual entry
        $("manual-barcode")?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleBarcode(e.target.value.trim());
            e.target.value = "";
          }
        });

        // Cleanup on close
        const observer = new MutationObserver(() => {
          if (!$("scanner-area")) {
            stream?.getTracks().forEach((t) => t.stop());
            observer.disconnect();
          }
        });
        observer.observe(root, { childList: true, subtree: true });
      },
    },
  );
}

// ---------------------------------------------------------------------
// STOCK TRANSFERS TAB
// ---------------------------------------------------------------------
function renderTransfersTab(el) {
  el.innerHTML = `
    <div class="flex gap" style="margin-bottom:14px">
      <button class="btn btn-primary" id="new-transfer-btn">+ New Transfer</button>
    </div>
    <div id="transfers-list"></div>
  `;
  $("new-transfer-btn")?.addEventListener("click", () => openTransferModal());
  loadTransfersList();
}

async function loadTransfersList() {
  const listEl = $("transfers-list");
  if (!listEl) return;

  const { data: movements } = await supabase
    .from("stock_movements")
    .select(
      "*, product:products(name, sku), from_branch:branches!stock_movements_branch_id_fkey(name)",
    )
    .eq("business_id", STATE.business.id)
    .eq("type", "transfer")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!movements?.length) {
    listEl.innerHTML = `<div class="card"><div class="empty-state">No stock transfers yet. Click "New Transfer" to move stock between branches.</div></div>`;
    return;
  }

  listEl.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Product</th><th>From Branch</th><th>Quantity</th><th>Notes</th><th>By</th></tr></thead>
          <tbody>
            ${movements
              .map(
                (m) => `
              <tr>
                <td>${fmtDate(m.created_at)}</td>
                <td>${escapeHtml(m.product?.name || "—")} <span class="text-muted" style="font-size:11px">(${escapeHtml(m.product?.sku || "")})</span></td>
                <td>${escapeHtml(m.from_branch?.name || STATE.branch?.name || "—")}</td>
                <td><span class="badge badge-blue">${m.quantity > 0 ? "+" : ""}${m.quantity}</span></td>
                <td>${escapeHtml(m.notes || "—")}</td>
                <td>${escapeHtml(m.created_by || "—")}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openTransferModal() {
  if (STATE.branches.length < 2) {
    toast("You need at least 2 branches to make transfers", "default");
    return;
  }

  openModal(
    `
    <div class="modal-title-row"><h3>Transfer Stock Between Branches</h3></div>
    <div class="field"><label>Product</label>
      <select id="tf-product"><option value="">Select product…</option>${STATE.products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (SKU: ${escapeHtml(p.sku || "—")}) — Stock: ${stockFor(p.id)}</option>`).join("")}</select>
    </div>
    <div class="field-row">
      <div class="field"><label>From Branch</label>
        <select id="tf-from">${STATE.branches.map((b) => `<option value="${b.id}" ${b.id === STATE.branch?.id ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>To Branch</label>
        <select id="tf-to">${STATE.branches.map((b) => `<option value="${b.id}" ${b.id !== STATE.branch?.id ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}</select>
      </div>
    </div>
    <div class="field"><label>Quantity to Transfer</label><input type="number" step="0.01" id="tf-qty" min="1" value="1" /></div>
    <div class="field"><label>Notes</label><input id="tf-notes" placeholder="e.g. Restock from warehouse" /></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="tf-save">Transfer</button>
    </div>
  `,
    {
      onMount: () => {
        $("tf-save").addEventListener("click", async () => {
          const productId = $("tf-product").value;
          const fromId = $("tf-from").value;
          const toId = $("tf-to").value;
          const qty = parseFloat($("tf-qty").value);
          const notes = $("tf-notes").value.trim();

          if (!productId) {
            toast("Select a product", "error");
            return;
          }
          if (fromId === toId) {
            toast("Source and destination must be different", "error");
            return;
          }
          if (isNaN(qty) || qty <= 0) {
            toast("Enter a valid quantity", "error");
            return;
          }

          const fromStock = await supabase
            .from("product_stock")
            .select("quantity")
            .eq("product_id", productId)
            .eq("branch_id", fromId)
            .single();
          const available = Number(fromStock.data?.quantity || 0);
          if (qty > available) {
            toast(`Insufficient stock. Available: ${available}`, "error");
            return;
          }

          // Deduct from source
          await supabase.from("product_stock").upsert(
            {
              product_id: productId,
              branch_id: fromId,
              quantity: available - qty,
            },
            { onConflict: "product_id,branch_id" },
          );

          // Add to destination
          const { data: destStock } = await supabase
            .from("product_stock")
            .select("quantity")
            .eq("product_id", productId)
            .eq("branch_id", toId)
            .single();
          const destQty = Number(destStock?.quantity || 0);
          await supabase.from("product_stock").upsert(
            {
              product_id: productId,
              branch_id: toId,
              quantity: destQty + qty,
            },
            { onConflict: "product_id,branch_id" },
          );

          // Record movement
          await supabase.from("stock_movements").insert({
            business_id: STATE.business.id,
            branch_id: fromId,
            product_id: productId,
            type: "transfer",
            quantity: -qty,
            notes: `Transfer to ${STATE.branches.find((b) => b.id === toId)?.name || "branch"}${notes ? ": " + notes : ""}`,
            created_by: STATE.appUser.id,
          });
          await supabase.from("stock_movements").insert({
            business_id: STATE.business.id,
            branch_id: toId,
            product_id: productId,
            type: "transfer",
            quantity: qty,
            notes: `Transfer from ${STATE.branches.find((b) => b.id === fromId)?.name || "branch"}${notes ? ": " + notes : ""}`,
            created_by: STATE.appUser.id,
          });

          toast("Stock transferred", "success");
          closeModal();
          await refreshProducts();
          loadTransfersList();
        });
      },
    },
  );
}

// ---------------------------------------------------------------------
// STOCK COUNT / VARIANCE TAB
// ---------------------------------------------------------------------
function renderStockCountTab(el) {
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Stock Count at ${escapeHtml(STATE.branch?.name || "Current Branch")}</div>
      <p class="help-text" style="margin-bottom:12px">Enter the physically counted quantity for each product. The system will show the variance (difference) between recorded and counted stock.</p>
      <div class="table-wrap" style="max-height:500px;overflow-y:auto">
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th>System Stock</th><th>Counted</th><th>Variance</th></tr></thead>
          <tbody id="count-body"></tbody>
        </table>
      </div>
      <div class="flex gap" style="margin-top:14px;justify-content:flex-end">
        <button class="btn btn-outline" id="count-export-btn">📥 Export Variance</button>
        <button class="btn btn-primary" id="count-save-btn">Save Adjustments</button>
      </div>
    </div>
  `;

  const countData = {};
  const tbody = $("count-body");
  tbody.innerHTML = STATE.products
    .map((p) => {
      const sys = stockFor(p.id);
      countData[p.id] = { system: sys, counted: sys };
      return `
      <tr>
        <td><b>${escapeHtml(p.name)}</b></td>
        <td>${escapeHtml(p.sku || "—")}</td>
        <td>${sys}</td>
        <td><input type="number" step="0.01" data-count="${p.id}" value="${sys}" style="width:80px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" /></td>
        <td class="variance-cell" data-var="${p.id}">0</td>
      </tr>
    `;
    })
    .join("");

  // Live variance calculation
  qsa("[data-count]", tbody).forEach((inp) => {
    inp.addEventListener("input", () => {
      const pid = inp.dataset.count;
      const sys = countData[pid].system;
      const counted = parseFloat(inp.value) || 0;
      const variance = counted - sys;
      countData[pid].counted = counted;
      const varCell = $(`[data-var="${pid}"]`);
      if (varCell) {
        varCell.textContent = variance > 0 ? `+${variance}` : variance;
        varCell.className = `variance-cell badge ${variance === 0 ? "badge-green" : variance > 0 ? "badge-blue" : "badge-red"}`;
      }
    });
  });

  // Export variance
  $("count-export-btn")?.addEventListener("click", () => {
    const rows = [["Product", "SKU", "System Stock", "Counted", "Variance"]];
    STATE.products.forEach((p) => {
      const sys = countData[p.id].system;
      const counted = countData[p.id].counted;
      rows.push([p.name, p.sku || "", sys, counted, counted - sys]);
    });
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-count-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  // Save adjustments
  $("count-save-btn")?.addEventListener("click", async () => {
    let adjusted = 0;
    for (const p of STATE.products) {
      const sys = countData[p.id].system;
      const counted = countData[p.id].counted;
      if (counted === sys) continue;

      const delta = counted - sys;
      await supabase.from("product_stock").upsert(
        {
          product_id: p.id,
          branch_id: STATE.branch.id,
          quantity: counted,
        },
        { onConflict: "product_id,branch_id" },
      );

      await supabase.from("stock_movements").insert({
        business_id: STATE.business.id,
        branch_id: STATE.branch.id,
        product_id: p.id,
        type: "adjustment",
        quantity: delta,
        notes: `Stock count: ${sys} → ${counted}`,
        created_by: STATE.appUser.id,
      });
      adjusted++;
    }
    toast(
      `Adjusted ${adjusted} products`,
      adjusted > 0 ? "success" : "default",
    );
    await refreshProducts();
    renderStockCountTab(el);
  });
}

// ---------------------------------------------------------------------
// MOVEMENTS HISTORY TAB
// ---------------------------------------------------------------------
function renderMovementsTab(el) {
  el.innerHTML = `
    <div class="flex gap" style="margin-bottom:14px;flex-wrap:wrap">
      <select id="mv-type" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
        <option value="">All Types</option>
        <option value="in">Stock In</option>
        <option value="out">Stock Out</option>
        <option value="sale">Sale</option>
        <option value="adjustment">Adjustment</option>
        <option value="transfer">Transfer</option>
        <option value="damaged">Damaged</option>
        <option value="return">Return</option>
      </select>
      <select id="mv-product" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
        <option value="">All Products</option>
        ${STATE.products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
      </select>
      <button class="btn btn-outline" id="mv-export-btn">📥 Export</button>
    </div>
    <div class="card">
      <div class="table-wrap" style="max-height:500px;overflow-y:auto">
        <table>
          <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Quantity</th><th>Branch</th><th>Notes</th></tr></thead>
          <tbody id="mv-body"></tbody>
        </table>
      </div>
    </div>
  `;

  loadMovements();
  $("mv-type")?.addEventListener("change", loadMovements);
  $("mv-product")?.addEventListener("change", loadMovements);
  $("mv-export-btn")?.addEventListener("click", exportMovements);
}

async function loadMovements() {
  const tbody = $("mv-body");
  if (!tbody) return;

  let query = supabase
    .from("stock_movements")
    .select("*, product:products(name, sku), branch:branches(name)")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const typeFilter = $("mv-type")?.value;
  const productFilter = $("mv-product")?.value;
  if (typeFilter) query = query.eq("type", typeFilter);
  if (productFilter) query = query.eq("product_id", productFilter);

  const { data: movements } = await query;

  if (!movements?.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No movements found</div></td></tr>`;
    return;
  }

  const typeColors = {
    in: "badge-green",
    out: "badge-red",
    sale: "badge-blue",
    adjustment: "badge-yellow",
    transfer: "badge-blue",
    damaged: "badge-red",
    return: "badge-green",
  };

  tbody.innerHTML = movements
    .map(
      (m) => `
    <tr>
      <td>${fmtDate(m.created_at)}</td>
      <td>${escapeHtml(m.product?.name || "—")} <span class="text-muted" style="font-size:11px">(${escapeHtml(m.product?.sku || "")})</span></td>
      <td><span class="badge ${typeColors[m.type] || "badge-gray"}">${m.type}</span></td>
      <td>${m.quantity > 0 ? "+" : ""}${m.quantity}</td>
      <td>${escapeHtml(m.branch?.name || "—")}</td>
      <td>${escapeHtml(m.notes || "—")}</td>
    </tr>
  `,
    )
    .join("");
}

async function exportMovements() {
  let query = supabase
    .from("stock_movements")
    .select("*, product:products(name, sku), branch:branches(name)")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  const typeFilter = $("mv-type")?.value;
  const productFilter = $("mv-product")?.value;
  if (typeFilter) query = query.eq("type", typeFilter);
  if (productFilter) query = query.eq("product_id", productFilter);

  const { data: movements } = await query;
  const rows = [
    ["Date", "Product", "SKU", "Type", "Quantity", "Branch", "Notes"],
  ];
  (movements || []).forEach((m) => {
    rows.push([
      new Date(m.created_at).toISOString(),
      m.product?.name || "",
      m.product?.sku || "",
      m.type,
      m.quantity,
      m.branch?.name || "",
      m.notes || "",
    ]);
  });
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ---------------------------------------------------------------------
// PURCHASE ORDERS TAB
// ---------------------------------------------------------------------
function renderPurchaseTab(el) {
  el.innerHTML = `
    <div class="flex gap" style="margin-bottom:14px">
      <button class="btn btn-primary" id="new-po-btn">+ New Purchase Order</button>
    </div>
    <div id="po-list"></div>
  `;
  $("new-po-btn")?.addEventListener("click", () => openPOModal());
  loadPOList();
}

async function loadPOList() {
  const listEl = $("po-list");
  if (!listEl) return;

  const { data: pos } = await supabase
    .from("purchase_orders")
    .select(
      "*, supplier:suppliers(name), items:purchase_order_items(*, product:products(name))",
    )
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  if (!pos?.length) {
    listEl.innerHTML = `<div class="card"><div class="empty-state">No purchase orders yet.</div></div>`;
    return;
  }

  const statusColors = {
    draft: "badge-gray",
    ordered: "badge-blue",
    received: "badge-green",
    cancelled: "badge-red",
  };

  listEl.innerHTML = pos
    .map(
      (po) => `
    <div class="card" style="margin-bottom:12px">
      <div class="flex between" style="margin-bottom:8px">
        <div>
          <b>${escapeHtml(po.po_number)}</b>
          <span class="badge ${statusColors[po.status] || "badge-gray"}" style="margin-left:8px">${po.status}</span>
        </div>
        <span class="text-muted" style="font-size:12px">${fmtDate(po.created_at)}</span>
      </div>
      <div style="font-size:13px;margin-bottom:6px">Supplier: <b>${escapeHtml(po.supplier?.name || "—")}</b></div>
      <table style="font-size:12px">
        <thead><tr><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
        <tbody>
          ${(po.items || [])
            .map(
              (it) => `
            <tr>
              <td>${escapeHtml(it.product?.name || "—")}</td>
              <td>${it.quantity}</td>
              <td>${fmtMoney(it.unit_cost)}</td>
              <td>${fmtMoney(it.unit_cost * it.quantity)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      <div class="flex gap" style="margin-top:8px;justify-content:flex-end">
        ${po.status === "draft" ? `<button class="btn btn-sm btn-outline" data-receive-po="${po.id}">Mark Received</button>` : ""}
        ${po.status === "ordered" ? `<button class="btn btn-sm btn-primary" data-receive-po="${po.id}">Mark Received</button>` : ""}
      </div>
    </div>
  `,
    )
    .join("");

  qsa("[data-receive-po]", listEl).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ status: "received" })
        .eq("id", btn.dataset.receivePo);
      if (error) {
        toast("Failed: " + error.message, "error");
        return;
      }
      toast("Purchase order received", "success");
      loadPOList();
    });
  });
}

function openPOModal() {
  openModal(
    `
    <div class="modal-title-row"><h3>New Purchase Order</h3></div>
    <div class="field"><label>Supplier</label>
      <select id="po-supplier"><option value="">Select supplier…</option>${STATE.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Expected Delivery Date</label><input type="date" id="po-date" /></div>
    <div id="po-items" style="margin-bottom:12px"></div>
    <button class="btn btn-sm btn-outline" id="po-add-item">+ Add Item</button>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="po-save">Create PO</button>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        let items = [];
        const renderItems = () => {
          $("po-items").innerHTML = items
            .map(
              (it, idx) => `
            <div class="field-row" style="margin-bottom:8px">
              <div class="field"><select data-po-product="${idx}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
                <option value="">Product…</option>
                ${STATE.products.map((p) => `<option value="${p.id}" ${it.productId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
              </select></div>
              <div class="field"><input type="number" step="0.01" data-po-qty="${idx}" placeholder="Qty" value="${it.qty || ""}" style="width:80px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" /></div>
              <div class="field"><input type="number" step="0.01" data-po-cost="${idx}" placeholder="Unit cost" value="${it.cost || ""}" style="width:100px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" /></div>
              <button class="btn btn-sm btn-danger" data-po-remove="${idx}">&times;</button>
            </div>
          `,
            )
            .join("");
          qsa("[data-po-product]", $("po-items")).forEach((sel, i) => {
            sel.addEventListener("change", () => {
              items[i].productId = sel.value;
            });
          });
          qsa("[data-po-qty]", $("po-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].qty = parseFloat(inp.value) || 0;
            });
          });
          qsa("[data-po-cost]", $("po-items")).forEach((inp, i) => {
            inp.addEventListener("input", () => {
              items[i].cost = parseFloat(inp.value) || 0;
            });
          });
          qsa("[data-po-remove]", $("po-items")).forEach((btn, i) => {
            btn.addEventListener("click", () => {
              items.splice(i, 1);
              renderItems();
            });
          });
        };

        $("po-add-item").addEventListener("click", () => {
          items.push({ productId: "", qty: 1, cost: 0 });
          renderItems();
        });

        $("po-save").addEventListener("click", async () => {
          const supplierId = $("po-supplier").value;
          if (!supplierId) {
            toast("Select a supplier", "error");
            return;
          }
          if (!items.length || !items.some((it) => it.productId)) {
            toast("Add at least one item", "error");
            return;
          }

          const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
          const { data: po, error: poErr } = await supabase
            .from("purchase_orders")
            .insert({
              business_id: STATE.business.id,
              supplier_id: supplierId,
              po_number: poNumber,
              status: "draft",
              expected_date: $("po-date").value || null,
              created_by: STATE.appUser.id,
            })
            .select()
            .single();

          if (poErr) {
            toast("Failed: " + poErr.message, "error");
            return;
          }

          for (const it of items) {
            if (!it.productId) continue;
            await supabase.from("purchase_order_items").insert({
              po_id: po.id,
              product_id: it.productId,
              quantity: it.qty,
              unit_cost: it.cost,
            });
          }

          toast("Purchase order created", "success");
          closeModal();
          loadPOList();
        });
      },
    },
  );
}

// ---------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------
function openCategoriesModal() {
  openModal(
    `
    <div class="modal-title-row"><h3>Categories</h3></div>
    <div id="cat-list" style="max-height:260px; overflow-y:auto; margin-bottom:14px;">
      ${STATE.categories.map((c) => `<div class="summary-row"><span>${escapeHtml(c.icon || "🏷️")} ${escapeHtml(c.name)}</span></div>`).join("") || '<p class="text-muted">No categories yet.</p>'}
    </div>
    <div class="field-row">
      <div class="field"><label>Icon (emoji)</label><input id="cat-icon" placeholder="🏷️" maxlength="4" /></div>
      <div class="field"><label>Category Name</label><input id="cat-name" placeholder="e.g. Beverages" /></div>
    </div>
    <div class="flex gap">
      <button class="btn btn-outline btn-block" data-close-modal>Close</button>
      <button class="btn btn-primary btn-block" id="add-cat-btn">Add Category</button>
    </div>
  `,
    {
      onMount: () => {
        $("add-cat-btn").addEventListener("click", async () => {
          const name = $("cat-name").value.trim();
          if (!name) {
            toast("Enter a category name", "error");
            return;
          }
          const { error } = await supabase.from("categories").insert({
            business_id: STATE.business.id,
            name,
            icon: $("cat-icon").value.trim() || "🏷️",
          });
          if (error) {
            toast("Failed: " + error.message, "error");
            return;
          }
          const { data } = await supabase
            .from("categories")
            .select("*")
            .eq("business_id", STATE.business.id);
          STATE.categories = data || [];
          toast("Category added", "success");
          closeModal();
        });
      },
    },
  );
}

// ---------------------------------------------------------------------
// BARCODE LABELS
// ---------------------------------------------------------------------
function openBulkLabelsModal() {
  openModal(
    `
    <div class="modal-title-row"><h3>Print Barcode Labels</h3></div>
    <p class="help-text">Set how many copies to print for each product, then print the sheet. Products without a
      barcode print their SKU (or a system code) instead — add a real barcode in the product form for scannable labels.</p>
    <div style="max-height:360px; overflow-y:auto;">
      <table>
        <thead><tr><th>Product</th><th>Code</th><th style="width:90px;">Copies</th></tr></thead>
        <tbody>
          ${
            STATE.products
              .map(
                (p) => `
          <tr>
            <td>${escapeHtml(p.name)}</td>
            <td class="text-muted">${escapeHtml(p.barcode || p.sku || "—")}</td>
            <td><input type="number" min="0" step="1" value="0" data-copies="${p.id}" style="width:70px;" /></td>
          </tr>`,
              )
              .join("") ||
            '<tr><td colspan="3"><div class="empty-state">No products yet.</div></td></tr>'
          }
        </tbody>
      </table>
    </div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="print-labels-confirm-btn">Print Labels</button>
    </div>
  `,
    {
      large: true,
      onMount: (modalRoot) => {
        $("print-labels-confirm-btn").addEventListener("click", () => {
          const items = qsa("[data-copies]", modalRoot)
            .map((inp) => ({
              productId: inp.dataset.copies,
              copies: parseInt(inp.value, 10) || 0,
            }))
            .filter((it) => it.copies > 0);
          if (!items.length) {
            toast("Set at least one copy count above 0", "error");
            return;
          }
          closeModal();
          printBarcodeLabels(items);
        });
      },
    },
  );
}

function printBarcodeLabels(items) {
  const normalized = items
    .map((it) => (typeof it === "string" ? { productId: it, copies: 1 } : it))
    .filter((it) => it.copies > 0);
  if (!normalized.length) {
    toast("Nothing to print", "error");
    return;
  }

  const labels = [];
  normalized.forEach(({ productId, copies }) => {
    const p = STATE.products.find((x) => x.id === productId);
    if (!p) return;
    const code =
      String(p.barcode || p.sku || p.id)
        .replace(/[^A-Za-z0-9\-]/g, "")
        .slice(0, 40) || p.id;
    for (let i = 0; i < copies; i++)
      labels.push({ id: `bc-${labels.length}`, product: p, code });
  });
  if (!labels.length) {
    toast("Could not find those products", "error");
    return;
  }

  const win = window.open("", "_blank", "width=820,height=640");
  if (!win) {
    toast("Allow pop-ups for this site to print labels", "error");
    return;
  }

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
      ${labels
        .map(
          (l) => `
        <div class="label">
          <div class="biz">${escapeHtml(STATE.business.name)}</div>
          <div class="name">${escapeHtml(l.product.name)}</div>
          <svg id="${l.id}"></svg>
          <div class="price">${fmtMoney(l.product.selling_price)}</div>
        </div>
      `,
        )
        .join("")}
    </div>
  </body></html>`);
  win.document.close();

  const script = win.document.createElement("script");
  script.src = JSBARCODE_CDN;
  script.onload = () => {
    labels.forEach((l) => {
      try {
        win.JsBarcode(win.document.getElementById(l.id), l.code, {
          format: "CODE128",
          height: 40,
          fontSize: 11,
          margin: 2,
          displayValue: true,
        });
      } catch (e) {
        console.warn("Barcode render failed for", l.code, e);
      }
    });
    win.focus();
    win.print();
  };
  script.onerror = () => toast("Could not load the barcode library", "error");
  win.document.body.appendChild(script);
}

// ---------------------------------------------------------------------
// PRODUCTION TAB (BOM / Assemble / Disassemble)
// ---------------------------------------------------------------------
async function renderProductionTab(el) {
  const { data: boms } = await supabase
    .from("bom")
    .select(
      "*, finished:products!bom_finished_product_id_fkey(name, id), items:bom_items(*, component:products(name, id))",
    )
    .eq("business_id", STATE.business.id)
    .eq("is_active", true);

  el.innerHTML = `
    <div class="flex gap" style="margin-bottom:14px">
      <button class="btn btn-primary" id="new-bom-btn">+ New Recipe (BOM)</button>
    </div>
    ${(boms || []).length ? "" : `<div class="card"><div class="empty-state">No production recipes yet. Create a BOM to define how finished products are assembled from components.</div></div>`}
    <div id="bom-list">${(boms || [])
      .map(
        (bom) => `
      <div class="card" style="margin-bottom:12px">
        <div class="flex between" style="margin-bottom:8px">
          <div>
            <b>${escapeHtml(bom.name || bom.finished?.name || "Unnamed")}</b>
            <span class="text-muted" style="margin-left:8px;font-size:12px">→ ${escapeHtml(bom.finished?.name || "—")} (yield: ${bom.yield_qty})</span>
          </div>
          <div class="flex gap">
            <button class="btn btn-sm btn-primary" data-assemble="${bom.id}">⚙️ Assemble</button>
            <button class="btn btn-sm btn-outline" data-disassemble="${bom.id}">↩️ Disassemble</button>
            <button class="btn btn-sm btn-danger" data-del-bom="${bom.id}">&times;</button>
          </div>
        </div>
        <table style="font-size:12px">
          <thead><tr><th>Component</th><th>Qty per unit</th><th>Available Stock</th></tr></thead>
          <tbody>
            ${(bom.items || [])
              .map((it) => {
                const avail = stockFor(it.component_product_id);
                return `<tr>
                <td>${escapeHtml(it.component?.name || "—")}</td>
                <td>${it.quantity}</td>
                <td><span class="badge ${avail < it.quantity ? "badge-red" : "badge-green"}">${avail}</span></td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `,
      )
      .join("")}</div>
  `;

  $("new-bom-btn")?.addEventListener("click", () => openBOMModal());

  qsa("[data-assemble]", el).forEach((btn) =>
    btn.addEventListener("click", () => assembleProduct(btn.dataset.assemble)),
  );
  qsa("[data-disassemble]", el).forEach((btn) =>
    btn.addEventListener("click", () =>
      disassembleProduct(btn.dataset.disassemble),
    ),
  );
  qsa("[data-del-bom]", el).forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this recipe?")) return;
      await supabase.from("bom").delete().eq("id", btn.dataset.delBom);
      toast("Recipe deleted", "success");
      renderProductionTab(el);
    }),
  );
}

function openBOMModal() {
  openModal(
    `
    <div class="modal-title-row"><h3>New Production Recipe (BOM)</h3></div>
    <div class="field"><label>Recipe Name</label><input id="bom-name" placeholder="e.g. Gift Basket" /></div>
    <div class="field"><label>Finished Product *</label>
      <select id="bom-finished"><option value="">Select product…</option>${STATE.products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Yield Quantity</label><input type="number" step="0.01" id="bom-yield" value="1" min="0.01" /><p class="help-text">How many units of the finished product one build produces</p></div>
    <div style="margin:14px 0;font-weight:700">Components (ingredients)</div>
    <div id="bom-components"></div>
    <button class="btn btn-sm btn-outline" id="bom-add-comp">+ Add Component</button>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="bom-save">Save Recipe</button>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        let components = [];
        const renderComps = () => {
          $("bom-components").innerHTML = components
            .map(
              (c, i) => `
          <div class="field-row" style="margin-bottom:8px">
            <div class="field"><select data-comp-prod="${i}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
              <option value="">Component…</option>
              ${STATE.products.map((p) => `<option value="${p.id}" ${c.productId === p.id ? "selected" : ""}>${escapeHtml(p.name)} (stock: ${stockFor(p.id)})</option>`).join("")}
            </select></div>
            <div class="field"><input type="number" step="0.01" data-comp-qty="${i}" placeholder="Qty needed" value="${c.qty || 1}" style="width:100px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" /></div>
            <button class="btn btn-sm btn-danger" data-comp-remove="${i}">&times;</button>
          </div>
        `,
            )
            .join("");
          qsa("[data-comp-prod]", $("bom-components")).forEach((sel, i) =>
            sel.addEventListener("change", () => {
              components[i].productId = sel.value;
            }),
          );
          qsa("[data-comp-qty]", $("bom-components")).forEach((inp, i) =>
            inp.addEventListener("input", () => {
              components[i].qty = parseFloat(inp.value) || 0;
            }),
          );
          qsa("[data-comp-remove]", $("bom-components")).forEach((btn, i) =>
            btn.addEventListener("click", () => {
              components.splice(i, 1);
              renderComps();
            }),
          );
        };

        $("bom-add-comp").addEventListener("click", () => {
          components.push({ productId: "", qty: 1 });
          renderComps();
        });

        $("bom-save").addEventListener("click", async () => {
          const finishedId = $("bom-finished").value;
          if (!finishedId) {
            toast("Select a finished product", "error");
            return;
          }
          if (!components.length || !components.some((c) => c.productId)) {
            toast("Add at least one component", "error");
            return;
          }

          const { data: bom, error } = await supabase
            .from("bom")
            .insert({
              business_id: STATE.business.id,
              finished_product_id: finishedId,
              name: $("bom-name").value.trim() || null,
              yield_qty: parseFloat($("bom-yield").value) || 1,
            })
            .select()
            .single();

          if (error) {
            toast("Failed: " + error.message, "error");
            return;
          }

          for (const c of components) {
            if (!c.productId) continue;
            await supabase.from("bom_items").insert({
              bom_id: bom.id,
              component_product_id: c.productId,
              quantity: c.qty,
            });
          }

          toast("Recipe saved", "success");
          closeModal();
          renderProductionTab($("inv-tab-content"));
        });
      },
    },
  );
}

async function assembleProduct(bomId) {
  const qty = prompt("How many units to assemble?", "1");
  if (!qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0) return;
  const assembleQty = parseFloat(qty);

  const { data: bom } = await supabase
    .from("bom")
    .select("*, items:bom_items(*, component:products(name))")
    .eq("id", bomId)
    .single();

  if (!bom) {
    toast("Recipe not found", "error");
    return;
  }

  // Check component stock
  for (const item of bom.items) {
    const needed = item.quantity * assembleQty;
    const avail = stockFor(item.component_product_id);
    if (avail < needed) {
      toast(
        `Insufficient ${item.component?.name || "component"}: need ${needed}, have ${avail}`,
        "error",
      );
      return;
    }
  }

  // Deduct components
  for (const item of bom.items) {
    const needed = item.quantity * assembleQty;
    const { data: stock } = await supabase
      .from("product_stock")
      .select("quantity")
      .eq("product_id", item.component_product_id)
      .eq("branch_id", STATE.branch.id)
      .single();
    const current = Number(stock?.quantity || 0);

    await supabase.from("product_stock").upsert(
      {
        product_id: item.component_product_id,
        branch_id: STATE.branch.id,
        quantity: current - needed,
      },
      { onConflict: "product_id,branch_id" },
    );

    await supabase.from("stock_movements").insert({
      business_id: STATE.business.id,
      branch_id: STATE.branch.id,
      product_id: item.component_product_id,
      type: "out",
      quantity: needed,
      notes: `Production: assembled ${assembleQty}x ${bom.name || bom.finished_product_id}`,
      created_by: STATE.appUser.id,
    });
  }

  // Add finished product
  const finishedQty = assembleQty * (bom.yield_qty || 1);
  const { data: finStock } = await supabase
    .from("product_stock")
    .select("quantity")
    .eq("product_id", bom.finished_product_id)
    .eq("branch_id", STATE.branch.id)
    .single();

  await supabase.from("product_stock").upsert(
    {
      product_id: bom.finished_product_id,
      branch_id: STATE.branch.id,
      quantity: Number(finStock?.quantity || 0) + finishedQty,
    },
    { onConflict: "product_id,branch_id" },
  );

  await supabase.from("stock_movements").insert({
    business_id: STATE.business.id,
    branch_id: STATE.branch.id,
    product_id: bom.finished_product_id,
    type: "in",
    quantity: finishedQty,
    notes: `Production: assembled ${assembleQty}x from ${bom.name || "recipe"}`,
    created_by: STATE.appUser.id,
  });

  await supabase.from("production_logs").insert({
    business_id: STATE.business.id,
    branch_id: STATE.branch.id,
    bom_id: bom.id,
    finished_product_id: bom.finished_product_id,
    action: "assemble",
    quantity: assembleQty,
    notes: `Assembled ${assembleQty} units`,
    created_by: STATE.appUser.id,
  });

  toast(`Assembled ${finishedQty} units`, "success");
  await refreshProducts();
  renderProductionTab($("inv-tab-content"));
}

async function disassembleProduct(bomId) {
  const qty = prompt("How many units to disassemble?", "1");
  if (!qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0) return;
  const disassembleQty = parseFloat(qty);

  const { data: bom } = await supabase
    .from("bom")
    .select("*, items:bom_items(*, component:products(name))")
    .eq("id", bomId)
    .single();

  if (!bom) {
    toast("Recipe not found", "error");
    return;
  }

  // Check finished product stock
  const finishedStock = stockFor(bom.finished_product_id);
  if (finishedStock < disassembleQty) {
    toast(
      `Insufficient finished product: need ${disassembleQty}, have ${finishedStock}`,
      "error",
    );
    return;
  }

  // Deduct finished product
  await supabase.from("product_stock").upsert(
    {
      product_id: bom.finished_product_id,
      branch_id: STATE.branch.id,
      quantity: finishedStock - disassembleQty,
    },
    { onConflict: "product_id,branch_id" },
  );

  await supabase.from("stock_movements").insert({
    business_id: STATE.business.id,
    branch_id: STATE.branch.id,
    product_id: bom.finished_product_id,
    type: "out",
    quantity: disassembleQty,
    notes: `Disassembled ${disassembleQty}x ${bom.name || "recipe"}`,
    created_by: STATE.appUser.id,
  });

  // Return components
  for (const item of bom.items) {
    const returned = item.quantity * disassembleQty;
    const { data: stock } = await supabase
      .from("product_stock")
      .select("quantity")
      .eq("product_id", item.component_product_id)
      .eq("branch_id", STATE.branch.id)
      .single();

    await supabase.from("product_stock").upsert(
      {
        product_id: item.component_product_id,
        branch_id: STATE.branch.id,
        quantity: Number(stock?.quantity || 0) + returned,
      },
      { onConflict: "product_id,branch_id" },
    );

    await supabase.from("stock_movements").insert({
      business_id: STATE.business.id,
      branch_id: STATE.branch.id,
      product_id: item.component_product_id,
      type: "in",
      quantity: returned,
      notes: `Disassembled ${disassembleQty}x ${bom.name || "recipe"}`,
      created_by: STATE.appUser.id,
    });
  }

  await supabase.from("production_logs").insert({
    business_id: STATE.business.id,
    branch_id: STATE.branch.id,
    bom_id: bom.id,
    finished_product_id: bom.finished_product_id,
    action: "disassemble",
    quantity: disassembleQty,
    notes: `Disassembled ${disassembleQty} units`,
    created_by: STATE.appUser.id,
  });

  toast(
    `Disassembled ${disassembleQty} units — components returned`,
    "success",
  );
  await refreshProducts();
  renderProductionTab($("inv-tab-content"));
}

// ---------------------------------------------------------------------
// VALUATION TAB
// ---------------------------------------------------------------------
async function renderValuationTab(el) {
  // Calculate current inventory value
  let totalCostValue = 0;
  let totalRetailValue = 0;
  let totalItems = 0;

  const productValues = STATE.products
    .map((p) => {
      const qty = stockFor(p.id);
      const costVal = qty * Number(p.cost_price || 0);
      const retailVal = qty * Number(p.selling_price || 0);
      totalCostValue += costVal;
      totalRetailValue += retailVal;
      totalItems += qty;
      return { ...p, qty, costVal, retailVal };
    })
    .filter((p) => p.qty > 0)
    .sort((a, b) => b.costVal - a.costVal);

  // Category breakdown
  const catBreakdown = {};
  productValues.forEach((p) => {
    const catName =
      STATE.categories.find((c) => c.id === p.category_id)?.name ||
      "Uncategorized";
    if (!catBreakdown[catName])
      catBreakdown[catName] = { items: 0, costVal: 0, retailVal: 0 };
    catBreakdown[catName].items += p.qty;
    catBreakdown[catName].costVal += p.costVal;
    catBreakdown[catName].retailVal += p.retailVal;
  });

  const marginPct =
    totalRetailValue > 0
      ? (
          ((totalRetailValue - totalCostValue) / totalRetailValue) *
          100
        ).toFixed(1)
      : 0;

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="label">Total Items in Stock</div><div class="value">${totalItems.toLocaleString("en-UG")}</div></div>
      <div class="kpi-card"><div class="label">Cost Value (at cost price)</div><div class="value">${fmtMoney(totalCostValue)}</div></div>
      <div class="kpi-card"><div class="label">Retail Value (at selling price)</div><div class="value">${fmtMoney(totalRetailValue)}</div></div>
      <div class="kpi-card"><div class="label">Potential Margin</div><div class="value">${marginPct}%</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Value by Category</div>
        <div class="table-wrap" style="max-height:340px;overflow-y:auto">
          <table>
            <thead><tr><th>Category</th><th>Items</th><th>Cost Value</th><th>Retail Value</th></tr></thead>
            <tbody>
              ${
                Object.entries(catBreakdown)
                  .sort((a, b) => b[1].costVal - a[1].costVal)
                  .map(
                    ([cat, v]) => `
                <tr>
                  <td><b>${escapeHtml(cat)}</b></td>
                  <td>${v.items.toLocaleString("en-UG")}</td>
                  <td>${fmtMoney(v.costVal)}</td>
                  <td>${fmtMoney(v.retailVal)}</td>
                </tr>
              `,
                  )
                  .join("") ||
                '<tr><td colspan="4"><div class="empty-state">No stock</div></td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Top 20 Products by Cost Value</div>
        <div class="table-wrap" style="max-height:340px;overflow-y:auto">
          <table>
            <thead><tr><th>Product</th><th>Stock</th><th>Cost</th><th>Value</th></tr></thead>
            <tbody>
              ${
                productValues
                  .slice(0, 20)
                  .map(
                    (p) => `
                <tr>
                  <td><b>${escapeHtml(p.name)}</b><br/><span class="text-muted" style="font-size:11px">${escapeHtml(p.sku || "")}</span></td>
                  <td>${p.qty}</td>
                  <td>${fmtMoney(p.cost_price)}</td>
                  <td><b>${fmtMoney(p.costVal)}</b></td>
                </tr>
              `,
                  )
                  .join("") ||
                '<tr><td colspan="4"><div class="empty-state">No stock</div></td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">
        <span>Full Inventory Valuation</span>
        <button class="btn btn-sm btn-outline" id="val-export-btn">📥 Export CSV</button>
      </div>
      <div class="table-wrap" style="max-height:400px;overflow-y:auto">
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Cost Price</th><th>Selling Price</th><th>Cost Value</th><th>Retail Value</th><th>Margin</th></tr></thead>
          <tbody>
            ${
              productValues
                .map((p) => {
                  const margin =
                    p.retailVal > 0
                      ? (
                          ((p.retailVal - p.costVal) / p.retailVal) *
                          100
                        ).toFixed(1)
                      : 0;
                  const catName =
                    STATE.categories.find((c) => c.id === p.category_id)
                      ?.name || "—";
                  return `
                <tr>
                  <td>${escapeHtml(p.name)}</td>
                  <td>${escapeHtml(p.sku || "—")}</td>
                  <td>${escapeHtml(catName)}</td>
                  <td>${p.qty}</td>
                  <td>${fmtMoney(p.cost_price)}</td>
                  <td>${fmtMoney(p.selling_price)}</td>
                  <td>${fmtMoney(p.costVal)}</td>
                  <td>${fmtMoney(p.retailVal)}</td>
                  <td><span class="badge badge-green">${margin}%</span></td>
                </tr>`;
                })
                .join("") ||
              '<tr><td colspan="9"><div class="empty-state">No stock</div></td></tr>'
            }
          </tbody>
          <tfoot>
            <tr style="font-weight:700;border-top:2px solid var(--text)">
              <td colspan="3">Total</td>
              <td>${totalItems.toLocaleString("en-UG")}</td>
              <td></td><td></td>
              <td>${fmtMoney(totalCostValue)}</td>
              <td>${fmtMoney(totalRetailValue)}</td>
              <td><span class="badge badge-green">${marginPct}%</span></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  $("val-export-btn")?.addEventListener("click", () => {
    const rows = [
      [
        "Product",
        "SKU",
        "Category",
        "Stock",
        "Cost Price",
        "Selling Price",
        "Cost Value",
        "Retail Value",
        "Margin %",
      ],
    ];
    productValues.forEach((p) => {
      const margin =
        p.retailVal > 0
          ? (((p.retailVal - p.costVal) / p.retailVal) * 100).toFixed(1)
          : 0;
      const catName =
        STATE.categories.find((c) => c.id === p.category_id)?.name || "";
      rows.push([
        p.name,
        p.sku || "",
        catName,
        p.qty,
        p.cost_price,
        p.selling_price,
        p.costVal.toFixed(2),
        p.retailVal.toFixed(2),
        margin,
      ]);
    });
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `inventory-valuation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });
}
