// =====================================================================
// QWICKPOS — SELL (POS / CHECKOUT) VIEW
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
  uid,
  toBase,
  fromBase,
  fmtMoneyRaw,
  currencyMeta,
  refreshProducts,
  stockFor,
  queueOfflineSale,
  buildEfrisPayload,
  hasFeature,
  createNotification,
  lowStockProducts,
} from "./uganda-pos-core.js";
import { logAuditAction } from "./uganda-pos-view-audit.js";
import { getReceiptTemplate } from "./uganda-pos-view-templates.js";

let posSaleCurrency = "UGX";
let posDiscountInput = 0;
let posSearchTerm = "";
let posActiveCategory = "all";
let posMode = "sale"; // 'sale' | 'quotation'
let posBranchId = null; // null = default branch
let posDelivery = false;
let posDeliveryAddress = "";
let posDeliveryLocation = "";
let posDeliveryCost = 0;
let posContactPhone = "";
let posContactEmail = "";

function taxRateFor(code) {
  const t = STATE.taxCategories.find((t) => t.code === code);
  return t ? Number(t.rate) : 0;
}

function cartLines() {
  return STATE.cart.map((item) => {
    const unitPrice = fromBase(item.unitPriceBase, posSaleCurrency);
    const lineGross =
      Math.round((item.qty * unitPrice + Number.EPSILON) * 100) / 100;
    return { ...item, unitPrice, lineGross };
  });
}

function cartTotals() {
  const lines = cartLines();
  const subtotal = lines.reduce((a, l) => a + l.lineGross, 0);

  // Calculate coupon discount
  let couponDiscount = 0;
  if (STATE.cartCouponCode) {
    const coupon = STATE.coupons.find(
      (c) => c.code.toUpperCase() === STATE.cartCouponCode.toUpperCase(),
    );
    if (coupon) {
      if (coupon.discount_type === "percentage") {
        couponDiscount = Math.round((subtotal * coupon.discount_value / 100 + Number.EPSILON) * 100) / 100;
      } else {
        couponDiscount = Math.min(coupon.discount_value, subtotal);
      }
    }
  }
  STATE.cartCouponDiscount = couponDiscount;

  const manualDiscount = Math.min(posDiscountInput || 0, subtotal - couponDiscount);
  const totalDiscount = couponDiscount + manualDiscount;
  const ratio = subtotal > 0 ? totalDiscount / subtotal : 0;
  let vatTotal = 0;
  const lineDetails = lines.map((l) => {
    const netLine = l.lineGross * (1 - ratio);
    const rate = taxRateFor(l.taxCode);
    const vatAmount =
      Math.round(((netLine * rate) / (100 + rate) + Number.EPSILON) * 100) /
      100;
    vatTotal += vatAmount;
    return { ...l, netLine, vatAmount, vatRate: rate };
  });
  const grandTotal =
    Math.round((subtotal - totalDiscount + Number.EPSILON) * 100) / 100;
  const finalTotal = Math.round((grandTotal + posDeliveryCost + Number.EPSILON) * 100) / 100;
  return { lines: lineDetails, subtotal, couponDiscount, manualDiscount, totalDiscount, vatTotal, grandTotal, finalTotal };
}

export async function renderPOS(root) {
  posSaleCurrency = hasFeature("multi_currency")
    ? STATE.displayCurrency
    : STATE.business.base_currency;
  if (!posBranchId && STATE.branch) posBranchId = STATE.branch.id;
  root.innerHTML = `
    <div class="pos-layout">
      <div class="pos-catalog">
        <div class="pos-search-row">
          <input id="pos-search" data-i18n-placeholder="pos.search" placeholder="Search product, SKU or scan barcode…" autocomplete="off" />
          <button class="btn btn-outline" id="pos-scan-btn" title="Focus for barcode scanner">📷</button>
        </div>
        <div class="category-chips" id="pos-categories">
          <button class="chip active" data-cat="all">All</button>
          ${STATE.categories.map((c) => `<button class="chip" data-cat="${c.id}">${escapeHtml(c.icon || "")} ${escapeHtml(c.name)}</button>`).join("")}
        </div>
        <div class="product-grid" id="pos-product-grid"></div>
      </div>

      <div class="cart-panel">
        <div class="cart-header">
          <b>${posMode === "quotation" ? "New Quotation" : "Current Sale"}</b>
          <button class="btn btn-ghost btn-sm" id="pos-clear-cart" data-i18n="pos.clear">Clear</button>
        </div>

        <div class="pos-mode-toggle" id="pos-mode-toggle" style="display:flex; gap:6px; padding:0 16px 10px;">
          <button class="chip ${posMode === "sale" ? "active" : ""}" data-mode="sale" style="flex:1;">🧾 Sale</button>
          <button class="chip ${posMode === "quotation" ? "active" : ""}" data-mode="quotation" style="flex:1;">📄 Quotation</button>
        </div>

        <div style="padding:0 16px; display:flex; flex-direction:column; gap:8px;">
          <div class="field" style="margin-bottom:0;">
            <label>🏪 Store / Branch</label>
            <select id="pos-branch-select">
              ${STATE.branches.map((b) => `<option value="${b.id}" ${b.id === posBranchId ? "selected" : ""}>${escapeHtml(b.name)}${b.is_main ? " (Main)" : ""}</option>`).join("")}
            </select>
          </div>

          <div class="field" style="margin-bottom:0; position:relative;">
            <label>👤 Customer</label>
            <div style="display:flex;gap:6px;">
              <input type="text" id="pos-customer-input" placeholder="Search or type new name…" autocomplete="off" value="${(STATE.customers.find(c => c.id === STATE.cartCustomerId)?.name) || ""}" style="flex:1;" />
              <button class="btn btn-outline btn-sm" id="pos-customer-add-btn" title="Add new customer" style="padding:0 10px;">+ New</button>
            </div>
            <div id="pos-customer-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);max-height:160px;overflow-y:auto;z-index:100;box-shadow:var(--shadow-md);"></div>
          </div>

          <div class="field" style="margin-bottom:0;">
            <label>📞 Contact</label>
            <div style="display:flex;gap:6px;">
              <input type="tel" id="pos-contact-phone" placeholder="Phone" autocomplete="off" value="${posContactPhone}" style="flex:1;" />
              <input type="email" id="pos-contact-email" placeholder="Email (optional)" autocomplete="off" value="${posContactEmail}" style="flex:1;" />
            </div>
          </div>

          <div class="field" style="margin-bottom:0;">
            <label>🎟️ Coupon Code</label>
            <div style="display:flex;gap:6px;">
              <input type="text" id="pos-coupon-input" placeholder="Enter coupon code" autocomplete="off" value="${STATE.cartCouponCode || ""}" style="flex:1;text-transform:uppercase;" />
              <button class="btn btn-outline btn-sm" id="pos-coupon-apply-btn" style="padding:0 10px;">Apply</button>
            </div>
            <div id="pos-coupon-msg" style="font-size:12px;margin-top:4px;"></div>
          </div>

          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed var(--border);border-bottom:1px dashed var(--border);margin:2px 0;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin:0;">
              <input type="checkbox" id="pos-delivery-toggle" ${posDelivery ? "checked" : ""} style="width:18px;height:18px;" />
              <span>🚚 Delivery Required</span>
            </label>
          </div>

          <div id="pos-delivery-fields" style="display:${posDelivery ? "flex" : "none"};flex-direction:column;gap:6px;padding-top:4px;">
            <div class="field" style="margin-bottom:0;">
              <label>📍 Delivery Address</label>
              <input type="text" id="pos-delivery-address" placeholder="Street address, area…" autocomplete="off" value="${posDeliveryAddress}" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label>🗺️ Location / Landmark</label>
              <input type="text" id="pos-delivery-location" placeholder="Nearby landmark, GPS coords…" autocomplete="off" value="${posDeliveryLocation}" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label>Delivery Fee (${posSaleCurrency})</label>
              <input type="number" min="0" step="0.01" id="pos-delivery-cost" value="${posDeliveryCost || ""}" placeholder="0.00" />
            </div>
          </div>

          <div class="field" style="margin-bottom:0;">
            <label>💵 Currency</label>
            <select id="pos-currency-select" ${hasFeature("multi_currency") ? "" : 'disabled title="Upgrade to Growth or Pro for multi-currency sales"'}>
              ${(hasFeature("multi_currency")
                ? STATE.currencies
                : STATE.currencies.filter(
                    (c) => c.code === STATE.business.base_currency,
                  )
              )
                .map(
                  (c) =>
                    `<option value="${c.code}" ${c.code === posSaleCurrency ? "selected" : ""}>${c.code} — ${escapeHtml(c.name)}</option>`,
                )
                .join("")}
            </select>
          </div>
        </div>

        <div class="cart-items" id="pos-cart-items"></div>

        <div class="cart-summary" id="pos-cart-summary"></div>
      </div>
    </div>
  `;

  renderProductGrid();
  renderCart();

  // Mobile cart toggle
  const cartPanel = root.querySelector(".cart-panel");
  const cartHeader = root.querySelector(".cart-header");
  if (cartPanel && cartHeader && window.innerWidth <= 980) {
    cartHeader.addEventListener("click", () => {
      cartPanel.classList.toggle("cart-open");
    });
    root.addEventListener("click", (e) => {
      if (window.innerWidth <= 980 && e.target.closest(".product-card")) {
        cartPanel.classList.remove("cart-open");
      }
    });
  }

  // Search
  $("pos-search").addEventListener("input", (e) => {
    posSearchTerm = e.target.value.toLowerCase();
    renderProductGrid();
  });
  // Scanner
  $("pos-scan-btn").addEventListener("click", () => {
    if ("BarcodeDetector" in window) { openCameraScanner(); return; }
    $("pos-search").focus();
  });
  // Categories
  qsa("#pos-categories .chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      posActiveCategory = chip.dataset.cat;
      qsa("#pos-categories .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderProductGrid();
    }),
  );
  // Clear cart
  $("pos-clear-cart").addEventListener("click", () => {
    STATE.cart = [];
    STATE.cartCouponCode = null;
    STATE.cartCouponDiscount = 0;
    posDiscountInput = 0;
    renderCart();
    renderProductGrid();
  });
  // Currency
  $("pos-currency-select").addEventListener("change", (e) => {
    posSaleCurrency = e.target.value;
    renderCart();
  });
  // Branch
  $("pos-branch-select").addEventListener("change", (e) => {
    posBranchId = e.target.value;
    toast(`Switched to ${STATE.branches.find(b => b.id === posBranchId)?.name || "branch"}`, "default", 2000);
  });
  // Mode toggle
  qsa("#pos-mode-toggle .chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      posMode = chip.dataset.mode;
      renderPOS(root);
    }),
  );

  // --- Customer search/add ---
  setupCustomerSearch();

  // --- Coupon ---
  setupCouponInput();

  // --- Delivery toggle ---
  const deliveryToggle = $("pos-delivery-toggle");
  const deliveryFields = $("pos-delivery-fields");
  deliveryToggle?.addEventListener("change", () => {
    posDelivery = deliveryToggle.checked;
    deliveryFields.style.display = posDelivery ? "flex" : "none";
    renderCart();
  });

  // --- Delivery cost ---
  $("pos-delivery-cost")?.addEventListener("input", (e) => {
    posDeliveryCost = parseFloat(e.target.value) || 0;
    renderCart();
  });

  // --- Contact fields ---
  $("pos-contact-phone")?.addEventListener("input", (e) => {
    posContactPhone = e.target.value;
  });
  $("pos-contact-email")?.addEventListener("input", (e) => {
    posContactEmail = e.target.value;
  });

  // --- Delivery address ---
  $("pos-delivery-address")?.addEventListener("input", (e) => {
    posDeliveryAddress = e.target.value;
  });
  $("pos-delivery-location")?.addEventListener("input", (e) => {
    posDeliveryLocation = e.target.value;
  });
}

function renderProductGrid() {
  const grid = $("pos-product-grid");
  if (!grid) return;
  let list = STATE.products;
  if (posActiveCategory !== "all")
    list = list.filter((p) => p.category_id === posActiveCategory);
  if (posSearchTerm) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(posSearchTerm) ||
        (p.sku || "").toLowerCase().includes(posSearchTerm) ||
        (p.barcode || "").toLowerCase().includes(posSearchTerm),
    );
  }

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="big-icon">🔍</div>No products found. Add products in Inventory.</div>`;
    return;
  }

  grid.innerHTML = list
    .map((p) => {
      const stock = stockFor(p.id);
      const low = stock <= Number(p.reorder_level || 0);
      const cartItem = STATE.cart.find((i) => i.productId === p.id);
      const qtyInCart = cartItem ? cartItem.qty : 0;
      return `
      <button class="product-card" data-id="${p.id}">
        ${qtyInCart > 0 ? `<span class="qty-badge">${qtyInCart}</span>` : ""}
        ${p.image_url ? `<div class="product-card-img"><img src="${escapeHtml(p.image_url)}" alt="" /></div>` : `<div class="product-emoji">${escapeHtml(categoryIcon(p.category_id))}</div>`}
        <div class="pname">${escapeHtml(p.name)}</div>
        <div class="pprice">${fmtMoneyRaw(fromBase(p.selling_price, posSaleCurrency), posSaleCurrency)}</div>
        <div class="pstock ${low ? "low" : ""}">${stock} ${escapeHtml(p.unit || "pc")} in stock</div>
      </button>`;
    })
    .join("");

  qsa(".product-card", grid).forEach((card) =>
    card.addEventListener("click", () => openQtyPicker(card.dataset.id)),
  );
}

function categoryIcon(categoryId) {
  const cat = STATE.categories.find((c) => c.id === categoryId);
  return cat?.icon || "🏷️";
}

// ---------------------------------------------------------------------
// CUSTOMER SEARCH / ADD
// ---------------------------------------------------------------------
function setupCustomerSearch() {
  const input = $("pos-customer-input");
  const dropdown = $("pos-customer-dropdown");
  const addBtn = $("pos-customer-add-btn");
  if (!input || !dropdown) return;

  let debounce;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = input.value.toLowerCase().trim();
      if (q.length < 1) { dropdown.style.display = "none"; return; }
      const matches = STATE.customers.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone || "").includes(q),
      ).slice(0, 8);
      if (!matches.length && q.length >= 2) {
        dropdown.innerHTML = `<div style="padding:10px 12px;color:var(--text-muted);font-size:13px;">No matches — click <b>+ New</b> to add</div>`;
        dropdown.style.display = "block";
        return;
      }
      if (!matches.length) { dropdown.style.display = "none"; return; }
      dropdown.innerHTML = matches.map((c) => `
        <div class="pos-customer-opt" data-id="${c.id}" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;">
          <span>${escapeHtml(c.name)}</span>
          <span style="color:var(--text-muted);font-size:12px;">${escapeHtml(c.phone || "")}</span>
        </div>
      `).join("");
      dropdown.style.display = "block";
      qsa(".pos-customer-opt", dropdown).forEach((opt) =>
        opt.addEventListener("click", () => {
          STATE.cartCustomerId = opt.dataset.id;
          input.value = STATE.customers.find((c) => c.id === opt.dataset.id)?.name || "";
          dropdown.style.display = "none";
          renderCart();
        }),
      );
    }, 200);
  });

  input.addEventListener("focus", () => { if (input.value.trim()) input.dispatchEvent(new Event("input")); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#pos-customer-input") && !e.target.closest("#pos-customer-dropdown")) {
      dropdown.style.display = "none";
    }
  });

  // Add new customer inline
  addBtn?.addEventListener("click", () => openAddCustomerModal());
}

async function openAddCustomerModal() {
  openModal(`
    <div class="modal-title-row"><h3>👤 Add Customer</h3></div>
    <div class="field"><label>Full Name *</label><input id="ac-name" required placeholder="Customer name" /></div>
    <div class="field-row">
      <div class="field"><label>Phone</label><input id="ac-phone" type="tel" placeholder="+2567xxxxxxxx" /></div>
      <div class="field"><label>Email</label><input id="ac-email" type="email" placeholder="customer@email.com" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>TIN (for EFRIS B2B)</label><input id="ac-tin" placeholder="TIN number" /></div>
      <div class="field"><label>Credit Limit (${posSaleCurrency})</label><input type="number" step="0.01" id="ac-credit" value="0" /></div>
    </div>
    <div class="field"><label>Address</label><input id="ac-address" placeholder="Street, area, city" /></div>
    <div class="field"><label>Notes</label><input id="ac-notes" placeholder="Any notes about this customer" /></div>
    <div class="flex gap" style="margin-top:16px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="ac-save-btn">💾 Save Customer</button>
    </div>
  `, {
    onMount: () => {
      $("ac-save-btn").addEventListener("click", async () => {
        const name = $("ac-name").value.trim();
        if (!name) { toast("Name is required", "error"); return; }
        const { data, error } = await supabase.from("customers").insert({
          business_id: STATE.business.id,
          name,
          phone: $("ac-phone").value.trim() || null,
          email: $("ac-email").value.trim() || null,
          tin: $("ac-tin").value.trim() || null,
          credit_limit: parseFloat($("ac-credit").value) || 0,
          address: $("ac-address").value.trim() || null,
          notes: $("ac-notes").value.trim() || null,
        }).select().single();
        if (error) { toast("Failed: " + error.message, "error"); return; }
        STATE.customers.push(data);
        STATE.cartCustomerId = data.id;
        const input = $("pos-customer-input");
        if (input) input.value = data.name;
        closeModal();
        toast("Customer added", "success");
        renderCart();
      });
    },
  });
}

// ---------------------------------------------------------------------
// COUPON INPUT
// ---------------------------------------------------------------------
function setupCouponInput() {
  const applyBtn = $("pos-coupon-apply-btn");
  const msgEl = $("pos-coupon-msg");
  if (!applyBtn) return;

  applyBtn.addEventListener("click", () => {
    const code = ($("pos-coupon-input")?.value || "").trim().toUpperCase();
    if (!code) { toast("Enter a coupon code", "error"); return; }
    const coupon = STATE.coupons.find(
      (c) => c.code.toUpperCase() === code && c.is_active,
    );
    if (!coupon) {
      STATE.cartCouponCode = null;
      STATE.cartCouponDiscount = 0;
      if (msgEl) { msgEl.textContent = "❌ Invalid coupon code"; msgEl.style.color = "var(--danger)"; }
      renderCart();
      return;
    }
    // Check expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      STATE.cartCouponCode = null;
      STATE.cartCouponDiscount = 0;
      if (msgEl) { msgEl.textContent = "❌ Coupon has expired"; msgEl.style.color = "var(--danger)"; }
      renderCart();
      return;
    }
    // Check max uses
    if (coupon.max_uses && (coupon.uses_count || 0) >= coupon.max_uses) {
      STATE.cartCouponCode = null;
      STATE.cartCouponDiscount = 0;
      if (msgEl) { msgEl.textContent = "❌ Coupon fully used"; msgEl.style.color = "var(--danger)"; }
      renderCart();
      return;
    }
    STATE.cartCouponCode = coupon.code;
    const discountText = coupon.discount_type === "percentage"
      ? `${coupon.discount_value}% off`
      : `${fmtMoneyRaw(coupon.discount_value, posSaleCurrency)} off`;
    if (msgEl) { msgEl.textContent = `✅ Applied: ${discountText}`; msgEl.style.color = "var(--brand)"; }
    renderCart();
  });

  // Remove coupon on clear
  const input = $("pos-coupon-input");
  input?.addEventListener("input", () => {
    if (!input.value.trim()) {
      STATE.cartCouponCode = null;
      STATE.cartCouponDiscount = 0;
      if (msgEl) msgEl.textContent = "";
      renderCart();
    }
  });
}

function addToCart(productId, qty = 1) {
  const product = STATE.products.find((p) => p.id === productId);
  if (!product) return;
  const stock = stockFor(productId);
  const existing = STATE.cart.find((i) => i.productId === productId);
  if (existing) {
    const newQty = existing.qty + qty;
    if (stock !== undefined && newQty > stock && stock > 0) {
      toast(`Only ${stock} ${product.unit || "pc"} left in stock`, "error");
      existing.qty = stock;
    } else {
      existing.qty = newQty;
    }
  } else {
    const addQty = stock !== undefined && qty > stock && stock > 0 ? stock : qty;
    STATE.cart.push({
      productId,
      name: product.name,
      qty: addQty,
      unitPriceBase: Number(product.selling_price),
      taxCode: product.tax_category_code || "STD",
      discount: 0,
    });
  }
  renderCart();
  renderProductGrid();
}

function openQtyPicker(productId) {
  const product = STATE.products.find((p) => p.id === productId);
  if (!product) return;
  const stock = stockFor(productId);
  const existing = STATE.cart.find((i) => i.productId === productId);
  let currentQty = existing ? existing.qty : 1;
  const maxQty = stock !== undefined && stock > 0 ? stock : 999;
  const unitPrice = fromBase(product.selling_price, posSaleCurrency);

  const overlay = document.createElement("div");
  overlay.className = "qty-picker-overlay";
  overlay.innerHTML = `
    <div class="qty-picker">
      <h3>${escapeHtml(product.name)}</h3>
      <div class="qp-price">${fmtMoneyRaw(unitPrice, posSaleCurrency)} each · ${stock ?? "∞"} in stock</div>
      <div class="qp-stepper">
        <button data-act="dec">−</button>
        <span class="qp-qty" id="qp-qty-display">${currentQty}</span>
        <button data-act="inc">+</button>
      </div>
      <div class="qp-actions">
        <button class="btn btn-outline" data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="add">${existing ? "Update Cart" : "Add to Cart"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const display = overlay.querySelector("#qp-qty-display");

  function updateDisplay() {
    display.textContent = currentQty;
  }

  overlay.querySelector("[data-act='inc']").addEventListener("click", () => {
    if (currentQty < maxQty) { currentQty++; updateDisplay(); }
    else toast(`Max stock: ${maxQty}`, "default", 2000);
  });
  overlay.querySelector("[data-act='dec']").addEventListener("click", () => {
    if (currentQty > 1) { currentQty--; updateDisplay(); }
  });
  overlay.querySelector("[data-act='cancel']").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("[data-act='add']").addEventListener("click", () => {
    addToCart(productId, currentQty);
    overlay.remove();
  });
}

function renderCart() {
  const itemsEl = $("pos-cart-items");
  const summaryEl = $("pos-cart-summary");
  if (!itemsEl || !summaryEl) return;

  const { lines, subtotal, couponDiscount, manualDiscount, totalDiscount, vatTotal, grandTotal, finalTotal } = cartTotals();

  if (!lines.length) {
    itemsEl.innerHTML = `<div class="empty-state"><div class="big-icon">🛒</div>Cart is empty — tap a product to add it.</div>`;
  } else {
    itemsEl.innerHTML = lines
      .map(
        (l) => `
      <div class="cart-row" data-id="${l.productId}">
        <div class="info">
          <div class="name">${escapeHtml(l.name)}</div>
          <div class="unit">${fmtMoneyRaw(l.unitPrice, posSaleCurrency)} each</div>
        </div>
        <div class="qty-stepper">
          <button data-action="dec" title="Decrease">−</button>
          <span class="qty-val" data-action="edit-qty" title="Tap to type quantity">${l.qty}</span>
          <button data-action="inc" title="Increase">+</button>
        </div>
        <div class="line-total">${fmtMoneyRaw(l.lineGross, posSaleCurrency)}</div>
        <button class="btn-ghost" data-action="remove" title="Remove" style="border:none;background:none;cursor:pointer;font-size:16px;padding:4px;">✕</button>
      </div>
    `,
      )
      .join("");

    qsa(".cart-row", itemsEl).forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('[data-action="inc"]').addEventListener("click", () => {
        changeQty(id, 1);
      });
      row.querySelector('[data-action="dec"]').addEventListener("click", () => {
        changeQty(id, -1);
      });
      row.querySelector('[data-action="remove"]').addEventListener("click", () => {
        removeFromCart(id);
      });
      // Tap qty number to type directly
      row.querySelector('[data-action="edit-qty"]').addEventListener("click", () => {
        const span = row.querySelector('[data-action="edit-qty"]');
        const item = STATE.cart.find((i) => i.productId === id);
        if (!item) return;
        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.className = "qty-input-inline";
        input.value = item.qty;
        span.replaceWith(input);
        input.focus();
        input.select();
        const finish = () => {
          const val = parseInt(input.value) || 1;
          item.qty = Math.max(1, val);
          renderCart();
          renderProductGrid();
        };
        input.addEventListener("blur", finish);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); finish(); }
          if (e.key === "Escape") { renderCart(); }
        });
      });
    });
  }

  const isQuote = posMode === "quotation";
  const defaultExpiry = new Date(Date.now() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  summaryEl.innerHTML = `
    <div class="field" style="margin-bottom:8px;">
      <label>Manual Discount (${posSaleCurrency})</label>
      <input type="number" min="0" step="0.01" id="pos-discount-input" value="${posDiscountInput || ""}" placeholder="0.00" />
    </div>
    ${
      isQuote
        ? `
    <div class="field" style="margin-bottom:8px;">
      <label>Valid Until</label>
      <input type="date" id="pos-quote-expiry" value="${defaultExpiry}" />
    </div>`
        : ""
    }
    <div class="summary-row"><span>Subtotal</span><span>${fmtMoneyRaw(subtotal, posSaleCurrency)}</span></div>
    ${couponDiscount > 0 ? `<div class="summary-row" style="color:var(--brand);"><span>🎟️ Coupon (${escapeHtml(STATE.cartCouponCode)})</span><span>− ${fmtMoneyRaw(couponDiscount, posSaleCurrency)}</span></div>` : ""}
    ${manualDiscount > 0 ? `<div class="summary-row"><span>Manual Discount</span><span>− ${fmtMoneyRaw(manualDiscount, posSaleCurrency)}</span></div>` : ""}
    ${totalDiscount > 0 ? `<div class="summary-row"><span>Total Discount</span><span>− ${fmtMoneyRaw(totalDiscount, posSaleCurrency)}</span></div>` : ""}
    <div class="summary-row"><span>Tax (incl.)</span><span>${fmtMoneyRaw(vatTotal, posSaleCurrency)}</span></div>
    ${posDeliveryCost > 0 ? `<div class="summary-row"><span>🚚 Delivery</span><span>+ ${fmtMoneyRaw(posDeliveryCost, posSaleCurrency)}</span></div>` : ""}
    <div class="summary-row total"><span>Total to Pay</span><span style="font-size:18px;">${fmtMoneyRaw(finalTotal, posSaleCurrency)}</span></div>
    <button class="btn btn-primary btn-block" id="pos-checkout-btn" style="margin-top:10px;font-size:15px;padding:14px;" ${!lines.length ? "disabled" : ""}>
      ${isQuote ? `📄 Save Quotation` : `💳 Pay ${fmtMoneyRaw(finalTotal, posSaleCurrency)}`}
    </button>
    ${!isQuote ? `<button class="btn btn-outline btn-block" id="pos-hold-btn" style="margin-top:8px;" ${!lines.length ? "disabled" : ""}>Hold Sale</button>` : ""}
  `;

  const discountInputEl = $("pos-discount-input");
  discountInputEl.addEventListener("input", (e) => {
    posDiscountInput = parseFloat(e.target.value) || 0;
    renderCart();
  });
  // preserve focus/cursor after re-render
  if (document.activeElement !== discountInputEl) {
    /* no-op */
  }

  const checkoutBtn = $("pos-checkout-btn");
  if (checkoutBtn)
    checkoutBtn.addEventListener("click", () => {
      isQuote ? saveQuotation() : openCheckoutModal();
    });
  const holdBtn = $("pos-hold-btn");
  if (holdBtn)
    holdBtn.addEventListener("click", () => {
      toast("Sale held. (Kept in this browser tab only.)", "default");
    });
}

function changeQty(productId, delta) {
  const item = STATE.cart.find((i) => i.productId === productId);
  if (!item) return;
  const stock = stockFor(productId);
  item.qty += delta;
  if (item.qty <= 0) {
    STATE.cart = STATE.cart.filter((i) => i.productId !== productId);
  } else if (stock !== undefined && item.qty > stock && stock > 0) {
    item.qty = stock;
    toast(`Max stock: ${stock}`, "default", 2000);
  }
  renderCart();
  renderProductGrid();
}

function removeFromCart(productId) {
  STATE.cart = STATE.cart.filter((i) => i.productId !== productId);
  renderCart();
  renderProductGrid();
}

// ---------------------------------------------------------------------
// CHECKOUT / PAYMENT MODAL
// ---------------------------------------------------------------------
function openCheckoutModal() {
  const { finalTotal } = cartTotals();
  const paymentRows = [{ id: uid(), method: "cash", amount: finalTotal }];
  const customer = STATE.customers.find((c) => c.id === STATE.cartCustomerId);
  const branch = STATE.branches.find((b) => b.id === posBranchId);

  const renderRows = () =>
    paymentRows
      .map(
        (r) => `
    <div class="field-row" data-payrow="${r.id}" style="align-items:end; margin-bottom:6px;">
      <div class="field" style="margin-bottom:0;">
        <label>Method</label>
        <select data-field="method">
          <option value="cash" ${r.method === "cash" ? "selected" : ""}>💵 Cash</option>
          <option value="mobile_money" ${r.method === "mobile_money" ? "selected" : ""}>📱 Mobile Money</option>
          <option value="bank" ${r.method === "bank" ? "selected" : ""}>🏦 Bank Transfer</option>
          <option value="card" ${r.method === "card" ? "selected" : ""}>💳 Card</option>
          <option value="credit" ${r.method === "credit" ? "selected" : ""}>📝 Credit (on account)</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Amount (${posSaleCurrency})</label>
        <input type="number" step="0.01" data-field="amount" value="${r.amount}" />
      </div>
    </div>
  `,
      )
      .join("");

  openModal(
    `
    <div class="modal-title-row"><h3>🧾 Complete Order</h3></div>
    <div class="summary-row total" style="margin-bottom:14px;"><span>Amount Due</span><span>${fmtMoneyRaw(finalTotal, posSaleCurrency)}</span></div>

    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;padding:12px;background:var(--surface-2);border-radius:var(--radius-sm);">
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:var(--text-muted);">Customer</span>
        <span style="font-weight:600;">${customer ? escapeHtml(customer.name) : "Walk-in"}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:var(--text-muted);">Store</span>
        <span style="font-weight:600;">${branch ? escapeHtml(branch.name) : "—"}</span>
      </div>
      ${posContactPhone ? `<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text-muted);">Phone</span><span>${escapeHtml(posContactPhone)}</span></div>` : ""}
      ${posDelivery ? `
        <div style="border-top:1px dashed var(--border);padding-top:8px;margin-top:4px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:4px;">🚚 Delivery</div>
          <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(posDeliveryAddress || "No address")}${posDeliveryLocation ? " — " + escapeHtml(posDeliveryLocation) : ""}</div>
          ${posDeliveryCost > 0 ? `<div style="font-size:12px;color:var(--brand);margin-top:4px;">Fee: +${fmtMoneyRaw(posDeliveryCost, posSaleCurrency)}</div>` : ""}
        </div>
      ` : ""}
    </div>

    <div style="margin-bottom:14px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Payment Method</div>
      <div id="pay-rows">${renderRows()}</div>
      <button class="btn btn-outline btn-sm" id="add-pay-row" type="button" style="margin-top:8px;">+ Split Payment</button>
      <div class="summary-row" id="pay-balance-row" style="margin-top:8px;"></div>
    </div>

    <div class="flex gap" style="margin-top:16px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="confirm-checkout-btn">✓ Confirm &amp; Create Order</button>
    </div>
  `,
    {
      onMount: (modalRoot) => {
        const updateBalance = () => {
          const rows = qsa("[data-payrow]", modalRoot);
          let paid = 0;
          rows.forEach((r) => {
            paid +=
              parseFloat(r.querySelector('[data-field="amount"]').value) || 0;
          });
          const balance =
            Math.round((finalTotal - paid + Number.EPSILON) * 100) / 100;
          $("pay-balance-row").innerHTML =
            `<span>${balance > 0 ? "Balance Due" : "Change"}</span><span style="color:${balance > 0 ? "var(--danger)" : "var(--brand)"};font-weight:700;">${fmtMoneyRaw(Math.abs(balance), posSaleCurrency)}</span>`;
        };
        updateBalance();

        modalRoot.addEventListener("input", updateBalance);

        $("add-pay-row").addEventListener("click", () => {
          paymentRows.push({ id: uid(), method: "cash", amount: 0 });
          $("pay-rows").innerHTML = renderRows();
          updateBalance();
        });

        $("confirm-checkout-btn").addEventListener("click", async () => {
          const rows = qsa("[data-payrow]", modalRoot);
          const payments = rows
            .map((r) => ({
              method: r.querySelector('[data-field="method"]').value,
              amount:
                parseFloat(r.querySelector('[data-field="amount"]').value) || 0,
            }))
            .filter((p) => p.amount > 0);

          if (!payments.length) {
            toast("Enter at least one payment amount", "error");
            return;
          }

          $("confirm-checkout-btn").disabled = true;
          $("confirm-checkout-btn").textContent = "Creating Order…";
          try {
            const sale = await finalizeSale(payments);
            closeModal();
            STATE.cart = [];
            posDiscountInput = 0;
            posDelivery = false;
            posDeliveryAddress = "";
            posDeliveryLocation = "";
            posDeliveryCost = 0;
            posContactPhone = "";
            posContactEmail = "";
            STATE.cartCouponCode = null;
            STATE.cartCouponDiscount = 0;
            renderCart();
            renderProductGrid();
            showOrderSuccess(sale);
          } catch (err) {
            console.error(err);
            toast("Could not complete sale: " + err.message, "error", 5000);
            $("confirm-checkout-btn").disabled = false;
            $("confirm-checkout-btn").textContent = "✓ Confirm & Create Order";
          }
        });
      },
    },
  );
}

async function finalizeSale(payments) {
  const { lines, subtotal, totalDiscount, vatTotal, grandTotal, finalTotal } = cartTotals();
  const exchangeRate = STATE.rates[posSaleCurrency] ?? 1;
  const finalTotalBase = toBase(finalTotal, posSaleCurrency);
  const totalPaid = payments.reduce((a, p) => a + p.amount, 0);
  const paymentStatus = payments.some((p) => p.method === "credit")
    ? totalPaid >= finalTotal
      ? "paid"
      : "credit"
    : totalPaid >= finalTotal
      ? "paid"
      : "partial";

  const items = lines.map((l) => ({
    product_id: l.productId,
    product_name: l.name,
    quantity: l.qty,
    unit_price: l.unitPrice,
    discount:
      Math.round((l.lineGross - l.netLine + Number.EPSILON) * 100) / 100,
    tax_category_code: l.taxCode,
    vat_rate: l.vatRate,
    vat_amount: l.vatAmount,
    line_total: l.netLine,
  }));

  const orderNotes = [];
  if (posDelivery) orderNotes.push(`DELIVERY: ${posDeliveryAddress}${posDeliveryLocation ? " — " + posDeliveryLocation : ""}`);
  if (posContactPhone) orderNotes.push(`Phone: ${posContactPhone}`);
  if (posContactEmail) orderNotes.push(`Email: ${posContactEmail}`);
  if (posDeliveryCost > 0) orderNotes.push(`Delivery fee: ${posDeliveryCost}`);

  const payload = {
    currency_code: posSaleCurrency,
    exchange_rate: exchangeRate,
    subtotal,
    discount_total: totalDiscount,
    coupon_code: STATE.cartCouponCode || null,
    vat_total: vatTotal,
    delivery_cost: posDeliveryCost,
    grand_total: grandTotal,
    final_total: finalTotal,
    grand_total_base: toBase(grandTotal, posSaleCurrency),
    final_total_base: finalTotalBase,
    customer_id: STATE.cartCustomerId || null,
    branch_id: posBranchId || STATE.branch?.id,
    payment_status: paymentStatus,
    delivery: posDelivery,
    delivery_address: posDelivery ? posDeliveryAddress : null,
    delivery_location: posDelivery ? posDeliveryLocation : null,
    contact_phone: posContactPhone || null,
    contact_email: posContactEmail || null,
    notes: orderNotes.join(" | ") || null,
    items,
    payments: payments.map((p) => ({
      method: p.method,
      currency_code: posSaleCurrency,
      amount: p.amount,
      amount_base: toBase(p.amount, posSaleCurrency),
    })),
  };

  if (!navigator.onLine) {
    queueOfflineSale(payload);
    toast(
      "You are offline — sale saved and will sync automatically.",
      "default",
      5000,
    );
    return { offline: true, ...payload, sale_number: "OFFLINE-" + Date.now() };
  }

  const savedSale = await submitSaleToSupabase(payload);
  return { ...savedSale, items: payload.items };
}

export async function submitSaleToSupabase(payload) {
  const { data: saleNumberData } = await supabase.rpc("next_sale_number");
  const saleNumber = saleNumberData || `INV-${Date.now()}`;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      business_id: STATE.business.id,
      branch_id: payload.branch_id || STATE.branch?.id,
      sale_number: saleNumber,
      customer_id: payload.customer_id,
      cashier_id: STATE.appUser.id,
      currency_code: payload.currency_code,
      exchange_rate: payload.exchange_rate,
      subtotal: payload.subtotal,
      discount_total: payload.discount_total,
      coupon_code: payload.coupon_code || null,
      vat_total: payload.vat_total,
      delivery_cost: payload.delivery_cost || 0,
      grand_total: payload.final_total || payload.grand_total,
      grand_total_base: payload.final_total_base || payload.grand_total_base,
      payment_status: payload.payment_status,
      delivery: payload.delivery || false,
      delivery_address: payload.delivery_address || null,
      delivery_location: payload.delivery_location || null,
      contact_phone: payload.contact_phone || null,
      contact_email: payload.contact_email || null,
      notes: payload.notes || null,
    })
    .select()
    .single();
  if (saleErr) throw saleErr;

  const { error: itemsErr } = await supabase
    .from("sale_items")
    .insert(payload.items.map((it) => ({ ...it, sale_id: sale.id })));
  if (itemsErr) throw itemsErr;

  const { error: paymentsErr } = await supabase.from("payments").insert(
    payload.payments.map((p) => ({
      ...p,
      sale_id: sale.id,
      received_by: STATE.appUser.id,
    })),
  );
  if (paymentsErr) throw paymentsErr;

  // Audit log
  logAuditAction({
    action: "create",
    entityType: "sale",
    entityId: sale.id,
    entityName: saleNumber,
    newValue: {
      grand_total: payload.grand_total,
      payment_status: payload.payment_status,
      items: payload.items.length,
    },
  });

  // ---- EFRIS: stage a fiscal invoice for this sale. The invoice is only
  // submitted to URA when you press "Submit" on the EFRIS tab (or
  // automatically once you enable live mode) — see uganda-pos-view-efris.js ----
  try {
    const { data: fiscalNoData } = await supabase.rpc(
      "next_fiscal_invoice_number",
    );
    const fiscalNumber = fiscalNoData || `FDN-${Date.now()}`;
    const customer = STATE.customers.find((c) => c.id === payload.customer_id);
    const efrisPayload = buildEfrisPayload({
      sale: { ...sale, ...payload },
      items: payload.items,
      business: STATE.business,
      customer,
      payments: payload.payments,
      operator: STATE.appUser?.full_name,
    });

    const { data: efrisInvoice } = await supabase
      .from("efris_invoices")
      .insert({
        business_id: STATE.business.id,
        sale_id: sale.id,
        fiscal_invoice_number: fiscalNumber,
        supplier_tin: STATE.business.tin,
        customer_tin: customer?.tin || null,
        customer_name: customer?.name || "Walk-in Customer",
        currency_code: payload.currency_code,
        gross_amount: payload.grand_total,
        vat_amount: payload.vat_total,
        status: "pending",
        payload_json: efrisPayload,
      })
      .select()
      .single();

    if (efrisInvoice) {
      await supabase
        .from("efris_queue")
        .insert({ efris_invoice_id: efrisInvoice.id, status: "pending" });
    }
  } catch (e) {
    console.warn("EFRIS staging failed (sale still recorded):", e);
  }

  await refreshProducts();
  // In-app notification: sale completed
  createNotification({
    title: "Sale completed",
    body: `${sale.sale_number} — ${fmtMoneyRaw(payload.grand_total, payload.currency_code)}`,
    type: "sale",
  }).catch(() => {});
  // Check for low stock after sale
  try {
    const low = lowStockProducts();
    if (low.length > 0) {
      createNotification({
        title: "Low stock alert",
        body: `${low.length} product(s) are at or below reorder level`,
        type: "stock",
        route: "inventory",
      }).catch(() => {});
    }
  } catch (_) {}
  return sale;
}

// ---------------------------------------------------------------------
// QUOTATIONS — "Quotation" mode skips payment + EFRIS entirely. Items are
// still snapshotted into sale_items (sale_type='quotation'), so the row
// carries everything needed to later print it or convert it into a real
// sale (see uganda-pos-view-quotations.js). The stock trigger already
// no-ops for sale_type='quotation' (see uganda-pos-schema-v2.sql).
// ---------------------------------------------------------------------
async function saveQuotation() {
  const { lines, subtotal, totalDiscount, vatTotal, grandTotal } = cartTotals();
  const exchangeRate = STATE.rates[posSaleCurrency] ?? 1;
  const grandTotalBase = toBase(grandTotal, posSaleCurrency);
  const expiry = $("pos-quote-expiry")?.value || null;

  const items = lines.map((l) => ({
    product_id: l.productId,
    product_name: l.name,
    quantity: l.qty,
    unit_price: l.unitPrice,
    discount:
      Math.round((l.lineGross - l.netLine + Number.EPSILON) * 100) / 100,
    tax_category_code: l.taxCode,
    vat_rate: l.vatRate,
    vat_amount: l.vatAmount,
    line_total: l.netLine,
  }));

  const payload = {
    currency_code: posSaleCurrency,
    exchange_rate: exchangeRate,
    subtotal,
    discount_total: totalDiscount,
    coupon_code: STATE.cartCouponCode || null,
    vat_total: vatTotal,
    grand_total: grandTotal,
    grand_total_base: grandTotalBase,
    customer_id: STATE.cartCustomerId || null,
    branch_id: posBranchId || STATE.branch?.id,
    quote_expires_at: expiry,
    items,
  };

  const btn = $("pos-checkout-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }

  try {
    const sale = await submitQuotationToSupabase(payload);
    STATE.cart = [];
    posDiscountInput = 0;
    posMode = "sale";
    const root = $("view-root");
    if (root) renderPOS(root);
    toast(
      `Quotation ${sale.sale_number} saved — find it in the Quotations tab`,
      "success",
      5000,
    );
    printableModal(
      { ...sale, items: payload.items },
      {
        docLabel: "QUOTATION",
        footNote: expiry ? `Valid until ${expiry}` : "",
      },
    );
  } catch (err) {
    console.error(err);
    toast("Could not save quotation: " + err.message, "error", 5000);
    if (btn) {
      btn.disabled = false;
      btn.textContent = `Save Quotation — ${fmtMoneyRaw(grandTotal, posSaleCurrency)}`;
    }
  }
}

export async function submitQuotationToSupabase(payload) {
  const { data: saleNumberData } = await supabase.rpc("next_sale_number");
  const saleNumber = saleNumberData || `QUO-${Date.now()}`;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      business_id: STATE.business.id,
      branch_id: payload.branch_id || STATE.branch?.id,
      sale_number: saleNumber,
      customer_id: payload.customer_id,
      cashier_id: STATE.appUser.id,
      currency_code: payload.currency_code,
      exchange_rate: payload.exchange_rate,
      subtotal: payload.subtotal,
      discount_total: payload.discount_total,
      coupon_code: payload.coupon_code || null,
      vat_total: payload.vat_total,
      grand_total: payload.grand_total,
      grand_total_base: payload.grand_total_base,
      payment_status: "unpaid",
      sale_type: "quotation",
      quote_expires_at: payload.quote_expires_at || null,
    })
    .select()
    .single();
  if (saleErr) throw saleErr;

  const { error: itemsErr } = await supabase
    .from("sale_items")
    .insert(payload.items.map((it) => ({ ...it, sale_id: sale.id })));
  if (itemsErr) throw itemsErr;

  // No payments row and no EFRIS staging — a quotation is neither paid nor fiscalised yet.
  return sale;
}

// ---------------------------------------------------------------------
// RECEIPT / QUOTATION PRINTABLE DOCUMENT
// ---------------------------------------------------------------------
function showReceipt(sale) {
  printableModal(sale, {
    docLabel: "TAX INVOICE",
    footNote: "EFRIS fiscal invoice staged — see EFRIS tab",
  });
}

function showOrderSuccess(sale) {
  const saleNum = sale.sale_number || sale.id?.slice(0, 8) || "—";
  const total = fmtMoneyRaw(sale.grand_total || 0, sale.currency_code || posSaleCurrency);
  const isDelivery = sale.delivery || posDelivery;
  const statusColor = sale.payment_status === "paid" ? "var(--brand)" : sale.payment_status === "credit" ? "var(--warning)" : "var(--text-muted)";

  openModal(
    `
    <div style="text-align:center;padding:8px 0;">
      <div style="font-size:56px;margin-bottom:8px;">✅</div>
      <h3 style="margin:0 0 4px;">Order Created!</h3>
      <div style="color:var(--text-muted);font-size:14px;margin-bottom:16px;">
        ${escapeHtml(saleNum)} · ${total}
        <span style="color:${statusColor};font-weight:600;margin-left:6px;">(${sale.payment_status || "paid"})</span>
      </div>
      ${isDelivery ? `<div style="background:var(--brand-light);color:var(--brand);padding:8px 12px;border-radius:var(--radius-xs);font-size:13px;margin-bottom:16px;">🚚 Delivery scheduled</div>` : ""}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <button class="btn btn-primary" id="order-cta-view" style="display:flex;align-items:center;justify-content:center;gap:6px;">👁️ View Order</button>
      <button class="btn btn-outline" id="order-cta-print" style="display:flex;align-items:center;justify-content:center;gap:6px;">🖨️ Print Receipt</button>
      <button class="btn btn-outline" id="order-cta-edit" style="display:flex;align-items:center;justify-content:center;gap:6px;">✏️ Edit Order</button>
      <button class="btn btn-outline" id="order-cta-return" style="display:flex;align-items:center;justify-content:center;gap:6px;">🔄 Add Return</button>
      <button class="btn btn-outline" id="order-cta-sms" style="display:flex;align-items:center;justify-content:center;gap:6px;">📱 Send SMS</button>
      <button class="btn btn-danger" id="order-cta-delete" style="display:flex;align-items:center;justify-content:center;gap:6px;">🗑️ Delete</button>
    </div>
    <div style="margin-top:12px;">
      <button class="btn btn-ghost btn-block" data-close-modal>Done</button>
    </div>
  `,
    {
      onMount: () => {
        $("order-cta-view")?.addEventListener("click", () => {
          closeModal();
          if (typeof navigateTo === "function") navigateTo("sales");
          else window.location.hash = "#/sales";
        });
        $("order-cta-print")?.addEventListener("click", () => {
          printableModal({ ...sale, items: sale.items || [] }, {
            docLabel: sale.payment_status === "paid" ? "TAX INVOICE" : "RECEIPT",
            footNote: isDelivery ? "Delivery order" : "",
          });
        });
        $("order-cta-edit")?.addEventListener("click", () => {
          closeModal();
          toast("Edit from the Sales tab", "default", 3000);
          if (typeof navigateTo === "function") navigateTo("sales");
          else window.location.hash = "#/sales";
        });
        $("order-cta-return")?.addEventListener("click", () => {
          closeModal();
          toast("Go to Sales → select this order → Add Return", "default", 4000);
          if (typeof navigateTo === "function") navigateTo("sales");
          else window.location.hash = "#/sales";
        });
        $("order-cta-sms")?.addEventListener("click", async () => {
          const btn = $("order-cta-sms");
          btn.disabled = true;
          btn.textContent = "Sending…";
          try {
            const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("./uganda-pos-core.js");
            const res = await fetch(`${SUPABASE_URL}/functions/v1/send-receipt`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ sale_id: sale.id, channel: "sms" }),
            });
            const result = await res.json();
            toast(result.success ? "SMS receipt sent" : (result.note || result.error || "SMS failed"), result.success ? "success" : "default", 4000);
          } catch (e) {
            toast("SMS failed: " + e.message, "error");
          }
          btn.disabled = false;
          btn.textContent = "📱 Send SMS";
        });
        $("order-cta-delete")?.addEventListener("click", async () => {
          if (!confirm("Delete this order? This cannot be undone.")) return;
          try {
            await supabase.from("sale_items").delete().eq("sale_id", sale.id);
            await supabase.from("payments").delete().eq("sale_id", sale.id);
            await supabase.from("sales").delete().eq("id", sale.id);
            toast("Order deleted", "success");
            closeModal();
          } catch (e) {
            toast("Delete failed: " + e.message, "error");
          }
        });
      },
    },
  );
}

// Shared by receipts (view-pos.js) and quotations (view-quotations.js) so
// both print from one consistent layout.
export function printableModal(sale, opts = {}) {
  const { docLabel = "RECEIPT", footNote = "" } = opts;
  const showSendSms = docLabel !== "QUOTATION" && sale.customer_id;
  openModal(
    `
    <div class="modal-title-row"><h3>${escapeHtml(docLabel === "QUOTATION" ? "Quotation" : "Receipt")}</h3></div>
    ${receiptHtml(sale, opts)}
    <div class="flex gap" style="margin-top:16px;">
      <button class="btn btn-outline btn-block" data-close-modal>Close</button>
      ${showSendSms ? `<button class="btn btn-outline" id="send-sms-btn" title="Send receipt via SMS">📱 SMS</button>` : ""}
      <button class="btn btn-primary btn-block" id="print-receipt-btn">Print</button>
    </div>
  `,
    {
      onMount: () => {
        $("print-receipt-btn").addEventListener("click", () =>
          printHtml(
            $("receipt-print-area").outerHTML,
            docLabel === "QUOTATION" ? "Quotation" : "Receipt",
          ),
        );
        if (showSendSms) {
          $("send-sms-btn")?.addEventListener("click", async () => {
            const btn = $("send-sms-btn");
            btn.disabled = true;
            btn.textContent = "Sending…";
            try {
              const { SUPABASE_URL, SUPABASE_ANON_KEY } =
                await import("./uganda-pos-core.js");
              const res = await fetch(
                `${SUPABASE_URL}/functions/v1/send-receipt`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ sale_id: sale.id, channel: "sms" }),
                },
              );
              const result = await res.json();
              if (result.success) {
                toast("SMS receipt sent to customer", "success");
              } else {
                toast(
                  result.note || result.error || "SMS failed",
                  "default",
                  4000,
                );
              }
            } catch (e) {
              toast("SMS failed: " + e.message, "error");
            }
            btn.disabled = false;
            btn.textContent = "📱 SMS";
          });
        }
      },
    },
  );
}

export function receiptHtml(sale, opts = {}) {
  const { docLabel = "RECEIPT", footNote = "" } = opts;
  const { lines, subtotal, discountTotal, vatTotal, grandTotal } =
    cartTotalsSnapshot(sale);
  const business = STATE.business;
  const tpl = getReceiptTemplate();
  const color = tpl.primaryColor || "#0f6b4a";
  const textColor = tpl.secondaryColor || "#333333";
  const fontSize = tpl.fontSize || "13";
  return `
    <div class="receipt" id="receipt-print-area" style="font-size:${fontSize}px; color:${textColor};">
      ${tpl.showLogo && tpl.logoUrl ? `<div class="center"><img src="${escapeHtml(tpl.logoUrl)}" style="max-height:50px; max-width:100%;" /></div>` : ""}
      ${tpl.headerText ? `<div class="center" style="font-size:10px; color:#999;">${escapeHtml(tpl.headerText)}</div>` : ""}
      ${tpl.showBusinessName ? `<div class="center"><b style="color:${color}; font-size:${parseInt(fontSize) + 3}px;">${escapeHtml(business.name)}</b></div>` : ""}
      ${tpl.showAddress ? `<div class="center">${escapeHtml(business.address || "")}</div>` : ""}
      ${tpl.showTin ? `<div class="center">TIN: ${escapeHtml(business.tin || "N/A")}</div>` : ""}
      ${tpl.showPhone && business.phone ? `<div class="center">${escapeHtml(business.phone)}</div>` : ""}
      ${tpl.showEmail && business.email ? `<div class="center">${escapeHtml(business.email)}</div>` : ""}
      <hr style="border-color:${color};"/>
      <div class="center"><b style="color:${color};">${escapeHtml(docLabel || tpl.invoiceTitle)}</b></div>
      ${tpl.showInvoiceNumber ? `<div>No: ${escapeHtml(sale.sale_number)}</div>` : ""}
      ${tpl.showDate ? `<div>Date: ${new Date(sale.created_at || Date.now()).toLocaleString("en-UG")}</div>` : ""}
      ${tpl.showServerName ? `<div>Served by: ${escapeHtml(STATE.appUser.full_name)}</div>` : ""}
      <hr style="border-color:${color};"/>
      <table>
        ${lines
          .map(
            (l) => `
          <tr><td colspan="2">${escapeHtml(l.name)}</td></tr>
          <tr><td>${l.qty} x ${fmtMoneyRaw(l.unitPrice, sale.currency_code)}</td><td style="text-align:right;">${fmtMoneyRaw(l.lineGross, sale.currency_code)}</td></tr>
        `,
          )
          .join("")}
      </table>
      <hr style="border-color:${color};"/>
      <table>
        <tr><td>Subtotal</td><td style="text-align:right;">${fmtMoneyRaw(subtotal, sale.currency_code)}</td></tr>
        ${tpl.showDiscount ? `<tr><td>Discount</td><td style="text-align:right;">- ${fmtMoneyRaw(discountTotal, sale.currency_code)}</td></tr>` : ""}
        ${tpl.showTaxBreakdown ? `<tr><td>VAT (incl.)</td><td style="text-align:right;">${fmtMoneyRaw(vatTotal, sale.currency_code)}</td></tr>` : ""}
        <tr><td><b>TOTAL</b></td><td style="text-align:right;"><b style="color:${color};">${fmtMoneyRaw(grandTotal, sale.currency_code)}</b></td></tr>
      </table>
      <hr style="border-color:${color};"/>
      ${tpl.showFooter ? `<div class="center">${escapeHtml(footNote || tpl.footerText)}</div>` : ""}
    </div>`;
}

// Camera barcode scanner using native BarcodeDetector API
async function openCameraScanner() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch (e) {
    toast("Camera access denied or unavailable", "error");
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "barcode-scanner-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <video id="scanner-video" autoplay playsinline style="max-width:90%;max-height:70vh;border-radius:12px;border:2px solid #0f6b4a;"></video>
    <div style="color:white;margin-top:16px;font-size:14px;">Point camera at barcode…</div>
    <button id="scanner-close" style="margin-top:12px;padding:8px 24px;border:none;border-radius:8px;background:#d64545;color:white;font-size:14px;cursor:pointer;">Cancel</button>
  `;
  document.body.appendChild(overlay);

  const video = document.getElementById("scanner-video");
  video.srcObject = stream;
  await video.play();

  const detector = new BarcodeDetector({
    formats: [
      "ean_13",
      "ean_8",
      "upc_a",
      "upc_e",
      "code_128",
      "code_39",
      "qr_code",
      "codabar",
      "itf",
    ],
  });
  let scanning = true;

  async function scan() {
    if (!scanning) return;
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        const value = barcodes[0].rawValue;
        scanning = false;
        closeScanner();
        // Auto-add matched product to cart or search
        const searchEl = $("pos-search");
        if (searchEl) {
          searchEl.value = value;
          searchEl.dispatchEvent(new Event("input"));
        }
        // If exactly one product matches its barcode, add it directly
        const matched = STATE.products.filter(
          (p) => p.barcode === value && (STATE.stockByProduct[p.id] || 0) > 0,
        );
        if (matched.length === 1) {
          addToCart(matched[0].id);
          toast(`Added: ${matched[0].name}`, "success", 2000);
        }
        return;
      }
    } catch (_) {}
    requestAnimationFrame(scan);
  }
  scan();

  function closeScanner() {
    scanning = false;
    stream.getTracks().forEach((t) => t.stop());
    overlay.remove();
  }
  document
    .getElementById("scanner-close")
    ?.addEventListener("click", closeScanner);
}

export function printHtml(innerHtml, title = "Document") {
  const w = window.open("", "_blank", "width=380,height=600");
  w.document.write(
    `<html><head><title>${title}</title></head><body>${innerHtml}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}

function cartTotalsSnapshot(sale) {
  // Rebuild a display-friendly snapshot from the sale payload (works for both online + offline sales)
  const items = sale.items || sale.sale_items || [];
  const lines = items.map((it) => ({
    name: it.product_name,
    qty: it.quantity,
    unitPrice: it.unit_price,
    lineGross: it.line_total,
  }));
  return {
    lines,
    subtotal: sale.subtotal,
    discountTotal: sale.discount_total,
    vatTotal: sale.vat_total,
    grandTotal: sale.grand_total,
  };
}
