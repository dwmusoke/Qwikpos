import { supabase, STATE, $, qsa, escapeHtml, toast, openModal, closeModal, fmtMoney, fmtDate } from "./uganda-pos-core.js";
import { logAuditAction } from "./uganda-pos-view-audit.js";

let activeTab = "coupons";

export async function renderCoupons(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Coupons &amp; Gift Cards</h2><p class="sub">Manage discounts, promotional codes, and gift cards</p></div>
      <button class="btn btn-primary" id="coupon-add-btn">+ Create New</button>
    </div>
    <div class="notif-filters" id="coupon-tabs">
      <button class="chip ${activeTab === "coupons" ? "active" : ""}" data-tab="coupons">🎟️ Coupons</button>
      <button class="chip ${activeTab === "giftcards" ? "active" : ""}" data-tab="giftcards">🎁 Gift Cards</button>
    </div>
    <div id="coupon-body"></div>
  `;

  $("coupon-add-btn").addEventListener("click", () => openCouponModal());
  qsa("#coupon-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      qsa("#coupon-tabs .chip").forEach((c) => c.classList.toggle("active", c === btn));
      renderTab();
    });
  });
  await renderTab();
}

async function renderTab() {
  const body = $("coupon-body");
  if (activeTab === "coupons") await renderCouponsTab(body);
  else await renderGiftCardsTab(body);
}

async function renderCouponsTab(body) {
  const { data: coupons } = await supabase
    .from("coupons")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  if (!coupons || coupons.length === 0) {
    body.innerHTML = `<div class="empty-state"><span class="big-icon">🎟️</span>No coupons yet. Create your first discount code.</div>`;
    return;
  }

  body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;">${coupons.map(renderCouponCard).join("")}</div>`;

  qsa("[data-coupon-id]").forEach((el) => {
    el.querySelector(".btn-danger")?.addEventListener("click", async () => {
      if (!confirm("Delete this coupon?")) return;
      await supabase.from("coupons").delete().eq("id", el.dataset.couponId);
      toast("Coupon deleted", "success");
      await renderTab();
    });
  });
}

function renderCouponCard(c) {
  const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
  const isUsedUp = c.max_uses && c.uses_count >= c.max_uses;
  const statusClass = isExpired ? "expired" : isUsedUp ? "used" : "";
  const statusText = isExpired ? "Expired" : isUsedUp ? "Fully used" : c.is_active ? "Active" : "Inactive";
  const discountText = c.discount_type === "percentage" ? `${c.discount_value}% off` : `${fmtMoney(c.discount_value)}`;
  return `
    <div class="coupon-card ${statusClass}" data-coupon-id="${c.id}">
      <div class="coupon-icon">🎟️</div>
      <div class="coupon-info">
        <div class="coupon-code">${escapeHtml(c.code)}</div>
        <div class="coupon-desc">${escapeHtml(c.description || discountText)}</div>
        <div class="coupon-status">
          <span class="badge ${isExpired ? "badge-red" : c.is_active ? "badge-green" : "badge-gray"}">${statusText}</span>
          ${c.max_uses ? `<span class="text-muted" style="margin-left:8px;">${c.uses_count || 0}/${c.max_uses} uses</span>` : ""}
          ${c.expires_at ? `<span class="text-muted" style="margin-left:8px;">Expires ${fmtDate(c.expires_at)}</span>` : ""}
        </div>
      </div>
      <div style="text-align:right;">
        <div class="coupon-value">${discountText}</div>
        <button class="btn btn-sm btn-danger" style="margin-top:8px;">Delete</button>
      </div>
    </div>
  `;
}

async function renderGiftCardsTab(body) {
  const { data: cards } = await supabase
    .from("gift_cards")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  if (!cards || cards.length === 0) {
    body.innerHTML = `<div class="empty-state"><span class="big-icon">🎁</span>No gift cards yet. Create your first gift card.</div>`;
    return;
  }

  body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;">${cards.map(renderGiftCardCard).join("")}</div>`;

  qsa("[data-card-id]").forEach((el) => {
    el.querySelector(".btn-danger")?.addEventListener("click", async () => {
      if (!confirm("Delete this gift card?")) return;
      await supabase.from("gift_cards").delete().eq("id", el.dataset.cardId);
      toast("Gift card deleted", "success");
      await renderTab();
    });
  });
}

function renderGiftCardCard(c) {
  const balance = Number(c.balance || 0);
  const initial = Number(c.initial_amount || 0);
  const isUsed = balance <= 0;
  const statusClass = isUsed ? "used" : "";
  return `
    <div class="coupon-card ${statusClass}" data-card-id="${c.id}">
      <div class="coupon-icon">🎁</div>
      <div class="coupon-info">
        <div class="coupon-code">${escapeHtml(c.code)}</div>
        <div class="coupon-desc">${escapeHtml(c.recipient_name || "Gift Card")} · ${escapeHtml(c.recipient_email || "")}</div>
        <div class="coupon-status">
          <span class="badge ${isUsed ? "badge-gray" : "badge-green"}">${isUsed ? "Used" : "Active"}</span>
          <span class="text-muted" style="margin-left:8px;">Balance: ${fmtMoney(balance)}</span>
          <span class="text-muted" style="margin-left:8px;">Initial: ${fmtMoney(initial)}</span>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="coupon-value">${fmtMoney(balance)}</div>
        <button class="btn btn-sm btn-danger" style="margin-top:8px;">Delete</button>
      </div>
    </div>
  `;
}

function openCouponModal(isGiftCard = false) {
  const typeOptions = isGiftCard
    ? ""
    : `<div class="field"><label>Discount Type</label><select id="cm-type"><option value="percentage">Percentage (%)</option><option value="fixed">Fixed Amount</option></select></div>`;

  openModal(`
    <div class="modal-title-row"><h3>${isGiftCard ? "New Gift Card" : "New Coupon"}</h3><button class="btn btn-ghost" data-close-modal>&times;</button></div>
    <form id="coupon-modal-form">
      <div class="field"><label>Code</label><input id="cm-code" required placeholder="${isGiftCard ? "GC-XXXX-XXXX" : "SAVE10"}" style="font-family:var(--font-mono);text-transform:uppercase;" /></div>
      ${isGiftCard ? `
        <div class="field-row">
          <div class="field"><label>Recipient Name</label><input id="cm-recipient" placeholder="John Doe" /></div>
          <div class="field"><label>Recipient Email</label><input id="cm-email" type="email" placeholder="john@example.com" /></div>
        </div>
        <div class="field"><label>Initial Amount (base currency)</label><input id="cm-amount" type="number" step="0.01" required placeholder="50000" /></div>
      ` : `
        ${typeOptions}
        <div class="field"><label>Discount Value</label><input id="cm-value" type="number" step="0.01" required placeholder="10" /></div>
        <div class="field"><label>Description (optional)</label><input id="cm-desc" placeholder="10% off summer sale" /></div>
        <div class="field-row">
          <div class="field"><label>Max Uses (0 = unlimited)</label><input id="cm-maxuses" type="number" value="0" /></div>
          <div class="field"><label>Expires At (optional)</label><input id="cm-expires" type="date" /></div>
        </div>
      `}
      <button class="btn btn-primary btn-block" type="submit">Create</button>
    </form>
  `);

  $("coupon-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("cm-code").value.trim().toUpperCase();
    if (!code) return;

    if (isGiftCard) {
      const amount = parseFloat($("cm-amount").value);
      const { error } = await supabase.from("gift_cards").insert({
        business_id: STATE.business.id,
        code,
        recipient_name: $("cm-recipient").value.trim() || null,
        recipient_email: $("cm-email").value.trim() || null,
        initial_amount: amount,
        balance: amount,
        is_active: true,
      });
      if (error) { toast(error.message, "error"); return; }
      toast("Gift card created", "success");
    } else {
      const { error } = await supabase.from("coupons").insert({
        business_id: STATE.business.id,
        code,
        discount_type: $("cm-type").value,
        discount_value: parseFloat($("cm-value").value),
        description: $("cm-desc").value.trim() || null,
        max_uses: parseInt($("cm-maxuses").value) || 0,
        expires_at: $("cm-expires").value ? new Date($("cm-expires").value).toISOString() : null,
        is_active: true,
        uses_count: 0,
      });
      if (error) { toast(error.message, "error"); return; }
      toast("Coupon created", "success");
    }
    closeModal();
    await renderTab();
  });
}
