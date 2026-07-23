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

let posSaleCurrency = STATE.displayCurrency;
let posDiscountInput = 0;
let posSearchTerm = "";
let posActiveCategory = "all";
let posMode = "sale"; // 'sale' | 'quotation'

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
  const discountTotal = Math.min(posDiscountInput || 0, subtotal);
  const ratio = subtotal > 0 ? discountTotal / subtotal : 0;
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
    Math.round((subtotal - discountTotal + Number.EPSILON) * 100) / 100;
  return { lines: lineDetails, subtotal, discountTotal, vatTotal, grandTotal };
}

export async function renderPOS(root) {
  posSaleCurrency = hasFeature("multi_currency")
    ? STATE.displayCurrency
    : STATE.business.base_currency;
  root.innerHTML = `
    <div class="pos-layout">
      <div class="pos-catalog">
        <div class="pos-search-row">
          <input id="pos-search" placeholder="Search product, SKU or scan barcode…" autocomplete="off" />
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
          <button class="btn btn-ghost btn-sm" id="pos-clear-cart">Clear</button>
        </div>

        <div class="pos-mode-toggle" id="pos-mode-toggle" style="display:flex; gap:6px; padding:0 16px 10px;">
          <button class="chip ${posMode === "sale" ? "active" : ""}" data-mode="sale" style="flex:1;">🧾 Sale</button>
          <button class="chip ${posMode === "quotation" ? "active" : ""}" data-mode="quotation" style="flex:1;">📄 Quotation</button>
        </div>

        <div style="padding:10px 16px 0;">
          <div class="field" style="margin-bottom:8px;">
            <label>Customer</label>
            <select id="pos-customer-select">
              <option value="">Walk-in Customer</option>
              ${STATE.customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.phone ? " — " + escapeHtml(c.phone) : ""}</option>`).join("")}
            </select>
          </div>
          <div class="currency-select-row">
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

  $("pos-search").addEventListener("input", (e) => {
    posSearchTerm = e.target.value.toLowerCase();
    renderProductGrid();
  });
  $("pos-scan-btn").addEventListener("click", () => $("pos-search").focus());
  qsa("#pos-categories .chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      posActiveCategory = chip.dataset.cat;
      qsa("#pos-categories .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderProductGrid();
    }),
  );
  $("pos-clear-cart").addEventListener("click", () => {
    STATE.cart = [];
    renderCart();
  });
  $("pos-currency-select").addEventListener("change", (e) => {
    posSaleCurrency = e.target.value;
    renderCart();
  });
  $("pos-customer-select").addEventListener("change", (e) => {
    STATE.cartCustomerId = e.target.value || null;
  });
  qsa("#pos-mode-toggle .chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      posMode = chip.dataset.mode;
      renderPOS(root);
    }),
  );
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
      return `
      <button class="product-card" data-id="${p.id}">
        ${p.image_url ? `<div class="product-card-img"><img src="${escapeHtml(p.image_url)}" alt="" /></div>` : `<div class="product-emoji">${escapeHtml(categoryIcon(p.category_id))}</div>`}
        <div class="pname">${escapeHtml(p.name)}</div>
        <div class="pprice">${fmtMoneyRaw(fromBase(p.selling_price, posSaleCurrency), posSaleCurrency)}</div>
        <div class="pstock ${low ? "low" : ""}">${stock} ${escapeHtml(p.unit || "pc")} in stock</div>
      </button>`;
    })
    .join("");

  qsa(".product-card", grid).forEach((card) =>
    card.addEventListener("click", () => addToCart(card.dataset.id)),
  );
}

function categoryIcon(categoryId) {
  const cat = STATE.categories.find((c) => c.id === categoryId);
  return cat?.icon || "🏷️";
}

function addToCart(productId) {
  const product = STATE.products.find((p) => p.id === productId);
  if (!product) return;
  const stock = stockFor(productId);
  const existing = STATE.cart.find((i) => i.productId === productId);
  if (existing) {
    if (stock !== undefined && existing.qty + 1 > stock && stock > 0) {
      toast(`Only ${stock} ${product.unit || "pc"} left in stock`, "error");
    }
    existing.qty += 1;
  } else {
    STATE.cart.push({
      productId,
      name: product.name,
      qty: 1,
      unitPriceBase: Number(product.selling_price),
      taxCode: product.tax_category_code || "STD",
      discount: 0,
    });
  }
  renderCart();
}

function renderCart() {
  const itemsEl = $("pos-cart-items");
  const summaryEl = $("pos-cart-summary");
  if (!itemsEl || !summaryEl) return;

  const { lines, subtotal, discountTotal, vatTotal, grandTotal } = cartTotals();

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
          <button data-action="dec">−</button>
          <span>${l.qty}</span>
          <button data-action="inc">+</button>
        </div>
        <div class="line-total">${fmtMoneyRaw(l.lineGross, posSaleCurrency)}</div>
        <button class="btn-ghost" data-action="remove" title="Remove" style="border:none;background:none;cursor:pointer;">✕</button>
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
      row
        .querySelector('[data-action="remove"]')
        .addEventListener("click", () => {
          removeFromCart(id);
        });
    });
  }

  const isQuote = posMode === "quotation";
  const defaultExpiry = new Date(Date.now() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  summaryEl.innerHTML = `
    <div class="field" style="margin-bottom:8px;">
      <label>Discount (${posSaleCurrency})</label>
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
    <div class="summary-row"><span>Discount</span><span>− ${fmtMoneyRaw(discountTotal, posSaleCurrency)}</span></div>
    <div class="summary-row"><span>VAT (incl.)</span><span>${fmtMoneyRaw(vatTotal, posSaleCurrency)}</span></div>
    <div class="summary-row total"><span>Total</span><span>${fmtMoneyRaw(grandTotal, posSaleCurrency)}</span></div>
    <button class="btn btn-primary btn-block" id="pos-checkout-btn" style="margin-top:10px;" ${!lines.length ? "disabled" : ""}>
      ${isQuote ? `Save Quotation — ${fmtMoneyRaw(grandTotal, posSaleCurrency)}` : `Charge ${fmtMoneyRaw(grandTotal, posSaleCurrency)}`}
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
  item.qty += delta;
  if (item.qty <= 0)
    STATE.cart = STATE.cart.filter((i) => i.productId !== productId);
  renderCart();
}

function removeFromCart(productId) {
  STATE.cart = STATE.cart.filter((i) => i.productId !== productId);
  renderCart();
}

// ---------------------------------------------------------------------
// CHECKOUT / PAYMENT MODAL
// ---------------------------------------------------------------------
function openCheckoutModal() {
  const { grandTotal } = cartTotals();
  const paymentRows = [{ id: uid(), method: "cash", amount: grandTotal }];

  const renderRows = () =>
    paymentRows
      .map(
        (r) => `
    <div class="field-row" data-payrow="${r.id}" style="align-items:end; margin-bottom:6px;">
      <div class="field" style="margin-bottom:0;">
        <label>Method</label>
        <select data-field="method">
          <option value="cash" ${r.method === "cash" ? "selected" : ""}>Cash</option>
          <option value="mobile_money" ${r.method === "mobile_money" ? "selected" : ""}>Mobile Money</option>
          <option value="bank" ${r.method === "bank" ? "selected" : ""}>Bank Transfer</option>
          <option value="card" ${r.method === "card" ? "selected" : ""}>Card</option>
          <option value="credit" ${r.method === "credit" ? "selected" : ""}>Credit (on account)</option>
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
    <div class="modal-title-row"><h3>Complete Sale</h3></div>
    <div class="summary-row total" style="margin-bottom:14px;"><span>Amount Due</span><span>${fmtMoneyRaw(grandTotal, posSaleCurrency)}</span></div>
    <div id="pay-rows">${renderRows()}</div>
    <button class="btn btn-outline btn-sm" id="add-pay-row" type="button" style="margin-bottom:14px;">+ Split Payment</button>
    <div class="summary-row" id="pay-balance-row"></div>
    <div class="flex gap" style="margin-top:16px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="confirm-checkout-btn">Confirm &amp; Print Receipt</button>
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
            Math.round((grandTotal - paid + Number.EPSILON) * 100) / 100;
          $("pay-balance-row").innerHTML =
            `<span>${balance > 0 ? "Balance Due" : "Change"}</span><span style="color:${balance > 0 ? "var(--danger)" : "var(--brand)"}">${fmtMoneyRaw(Math.abs(balance), posSaleCurrency)}</span>`;
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
          $("confirm-checkout-btn").textContent = "Processing…";
          try {
            const sale = await finalizeSale(payments);
            closeModal();
            STATE.cart = [];
            posDiscountInput = 0;
            renderCart();
            renderProductGrid();
            showReceipt(sale);
          } catch (err) {
            console.error(err);
            toast("Could not complete sale: " + err.message, "error", 5000);
            $("confirm-checkout-btn").disabled = false;
            $("confirm-checkout-btn").textContent = "Confirm & Print Receipt";
          }
        });
      },
    },
  );
}

async function finalizeSale(payments) {
  const { lines, subtotal, discountTotal, vatTotal, grandTotal } = cartTotals();
  const exchangeRate = STATE.rates[posSaleCurrency] ?? 1;
  const grandTotalBase = toBase(grandTotal, posSaleCurrency);
  const totalPaid = payments.reduce((a, p) => a + p.amount, 0);
  const paymentStatus = payments.some((p) => p.method === "credit")
    ? totalPaid >= grandTotal
      ? "paid"
      : "credit"
    : totalPaid >= grandTotal
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

  const payload = {
    currency_code: posSaleCurrency,
    exchange_rate: exchangeRate,
    subtotal,
    discount_total: discountTotal,
    vat_total: vatTotal,
    grand_total: grandTotal,
    grand_total_base: grandTotalBase,
    customer_id: STATE.cartCustomerId || null,
    payment_status: paymentStatus,
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
      branch_id: STATE.branch?.id,
      sale_number: saleNumber,
      customer_id: payload.customer_id,
      cashier_id: STATE.appUser.id,
      currency_code: payload.currency_code,
      exchange_rate: payload.exchange_rate,
      subtotal: payload.subtotal,
      discount_total: payload.discount_total,
      vat_total: payload.vat_total,
      grand_total: payload.grand_total,
      grand_total_base: payload.grand_total_base,
      payment_status: payload.payment_status,
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
  const { lines, subtotal, discountTotal, vatTotal, grandTotal } = cartTotals();
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
    discount_total: discountTotal,
    vat_total: vatTotal,
    grand_total: grandTotal,
    grand_total_base: grandTotalBase,
    customer_id: STATE.cartCustomerId || null,
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
      branch_id: STATE.branch?.id,
      sale_number: saleNumber,
      customer_id: payload.customer_id,
      cashier_id: STATE.appUser.id,
      currency_code: payload.currency_code,
      exchange_rate: payload.exchange_rate,
      subtotal: payload.subtotal,
      discount_total: payload.discount_total,
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
  return `
    <div class="receipt" id="receipt-print-area">
      <div class="center"><b>${escapeHtml(business.name)}</b></div>
      <div class="center">${escapeHtml(business.address || "")}</div>
      <div class="center">TIN: ${escapeHtml(business.tin || "N/A")}</div>
      <hr/>
      <div class="center"><b>${escapeHtml(docLabel)}</b></div>
      <div>No: ${escapeHtml(sale.sale_number)}</div>
      <div>Date: ${new Date(sale.created_at || Date.now()).toLocaleString("en-UG")}</div>
      <div>Served by: ${escapeHtml(STATE.appUser.full_name)}</div>
      <hr/>
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
      <hr/>
      <table>
        <tr><td>Subtotal</td><td style="text-align:right;">${fmtMoneyRaw(subtotal, sale.currency_code)}</td></tr>
        <tr><td>Discount</td><td style="text-align:right;">- ${fmtMoneyRaw(discountTotal, sale.currency_code)}</td></tr>
        <tr><td>VAT (incl.)</td><td style="text-align:right;">${fmtMoneyRaw(vatTotal, sale.currency_code)}</td></tr>
        <tr><td><b>TOTAL</b></td><td style="text-align:right;"><b>${fmtMoneyRaw(grandTotal, sale.currency_code)}</b></td></tr>
      </table>
      <hr/>
      ${footNote ? `<div class="center">${escapeHtml(footNote)}</div>` : ""}
      <div class="center">Thank you for your business!</div>
    </div>`;
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
