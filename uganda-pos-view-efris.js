// =====================================================================
// QWICKPOS — EFRIS (URA E-INVOICING) VIEW
//
// Every completed sale stages a fiscal invoice in the exact shape URA's
// EFRIS API expects (see uganda-pos-core.js -> buildEfrisPayload).
// Submitting it goes one of two ways depending on Settings:
//   - Live EFRIS enabled: calls the efris-submit-invoice edge function,
//     which fiscalises the invoice for real via your connected provider
//     (e.g. EFRIS Simplified) and stores URA's actual FDN/QR/anti-fake code.
//   - Otherwise: a local simulation, useful for demos/training before you
//     connect a provider.
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
  fmtMoneyRaw,
  fmtDate,
  sanitizeCsvValue,
} from "./uganda-pos-core.js";

let efrisFilter = "all";

export async function renderEfris(root) {
  root.innerHTML = `<div class="empty-state">Loading EFRIS queue…</div>`;

  const { data } = await supabase
    .from("efris_invoices")
    .select("*, sales(sale_number)")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const invoices = data || [];

  const counts = { all: invoices.length };
  invoices.forEach((i) => {
    counts[i.status] = (counts[i.status] || 0) + 1;
  });

  root.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1>EFRIS — URA E-Invoicing</h1>
        <p>Mode: <span class="badge ${STATE.business.efris_live_enabled ? "badge-green" : "badge-yellow"}">${STATE.business.efris_live_enabled ? "LIVE" : "SANDBOX"}</span>
          &nbsp;·&nbsp; Provider: <b>${STATE.business.efris_provider === 'direct_s2s' ? 'Direct URA S2S' : STATE.business.efris_provider === 'weaf' ? 'WEAF' : 'EFRIS Simplified'}</b>
          &nbsp;·&nbsp; TIN: ${escapeHtml(STATE.business.tin || "not set")}
          &nbsp;·&nbsp; Device No: ${escapeHtml(STATE.business.efris_device_no || "not registered")}</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary" id="export-efris-btn">Export CSV</button>
      </div>
    </div>

    ${
      !STATE.business.efris_live_enabled
        ? `
    <div class="card" style="border-color:var(--warning); background:var(--warning-light); margin-bottom:16px;">
      <b>Sandbox mode.</b> Fiscal invoices are generated in EFRIS-ready structure and simulated on submit — nothing
      reaches URA yet. Connect a provider (e.g. EFRIS Simplified) and switch on Live mode in
      Settings → EFRIS to submit for real.
    </div>`
        : ""
    }

    ${
      STATE.business.efris_live_enabled && !STATE.business.efris_device_no
        ? `
    <div class="card" style="border-color:var(--danger); background:rgba(248,113,113,0.05); margin-bottom:16px;">
      <b>⚠️ Device number not set.</b> Your submissions will fall back to <code>${escapeHtml(STATE.business.tin || 'YOUR_TIN')}_01</code> which may not be a valid URA-issued device number. Add your registered device number in <b>Settings → EFRIS</b> before submitting real invoices.
    </div>`
        : ""
    }

    <div class="category-chips" style="margin-bottom:14px;">
      ${["all", "pending", "queued", "accepted", "rejected", "failed"]
        .map(
          (s) => `
        <button class="chip ${efrisFilter === s ? "active" : ""}" data-filter="${s}">${s[0].toUpperCase() + s.slice(1)} ${counts[s] ? `(${counts[s]})` : ""}</button>
      `,
        )
        .join("")}
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Fiscal No.</th><th>Sale</th><th>Customer</th><th>Amount</th><th>VAT</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody id="efris-table-body"></tbody>
      </table>
    </div>
  `;

  const renderRows = () => {
    const list =
      efrisFilter === "all"
        ? invoices
        : invoices.filter((i) => i.status === efrisFilter);
    const tbody = $("efris-table-body");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No EFRIS invoices in this filter.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map(
        (inv) => `
      <tr>
        <td><b>${escapeHtml(inv.fiscal_invoice_number)}</b>
          ${inv.invoice_type === '2' ? '<span class="badge badge-blue" style="font-size:9px;margin-left:4px;">CN</span>' : inv.invoice_type === '3' ? '<span class="badge badge-yellow" style="font-size:9px;margin-left:4px;">DN</span>' : ''}
        </td>
        <td>${escapeHtml(inv.sales?.sale_number || "—")}</td>
        <td>${escapeHtml(inv.customer_name || "Walk-in")}</td>
        <td>${fmtMoneyRaw(Number(inv.gross_amount || 0), inv.currency_code)}</td>
        <td>${fmtMoneyRaw(Number(inv.vat_amount || 0), inv.currency_code)}</td>
        <td>${statusBadge(inv.status)}${inv.response_json?.cancelled ? ' <span class="badge badge-gray" style="font-size:9px;">CANCELLED</span>' : ""}</td>
        <td>${fmtDate(inv.created_at)}</td>
        <td class="flex gap">
          <button class="btn btn-secondary btn-sm" data-view="${inv.id}">Payload</button>
          ${["pending", "queued", "failed"].includes(inv.status) ? `<button class="btn btn-primary btn-sm" data-submit="${inv.id}">Submit</button>` : ""}
          ${inv.invoice_type === "2" && inv.status === "accepted" && !inv.response_json?.cancelled ? `<button class="btn btn-secondary btn-sm" data-cancel-cn="${inv.id}">Cancel Credit Note</button>` : ""}
          ${inv.status === "accepted" ? `<button class="btn btn-secondary btn-sm" data-print="${inv.id}">🖨️ Print EFRIS</button>` : ""}
        </td>
      </tr>`,
      )
      .join("");

    qsa("[data-view]", tbody).forEach((b) =>
      b.addEventListener("click", () =>
        viewPayload(invoices.find((i) => i.id === b.dataset.view)),
      ),
    );
    qsa("[data-submit]", tbody).forEach((b) =>
      b.addEventListener("click", () => submitInvoice(b.dataset.submit, root)),
    );
    qsa("[data-cancel-cn]", tbody).forEach((b) =>
      b.addEventListener("click", () => cancelCreditNote(b.dataset.cancelCn, root)),
    );
    qsa("[data-print]", tbody).forEach((b) =>
      b.addEventListener("click", () => printEfrisReceipt(invoices.find((i) => i.id === b.dataset.print))),
    );
  };

  renderRows();
  qsa(".chip", root).forEach((chip) =>
    chip.addEventListener("click", () => {
      efrisFilter = chip.dataset.filter;
      renderEfris(root);
    }),
  );
  $("export-efris-btn").addEventListener("click", () => exportCsv(invoices));
}

async function submitInvoice(invoiceId, rootEl) {
  try {
    const { data: invoice, error: fetchErr } = await supabase
      .from("efris_invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!invoice) { toast("Invoice not found", "error"); return; }
    if (!["pending", "queued", "failed"].includes(invoice.status)) {
      toast(`Invoice is already ${invoice.status}`, "error"); return;
    }

    if (!STATE.business.efris_live_enabled) {
      const mockFdn = `SFDN-${Date.now()}`;
      const mockAntiFake = `AF${Date.now().toString(36).toUpperCase()}`;
      const mockQr = `efris://verify?fdn=${mockFdn}&tin=${STATE.business.tin || ""}`;

      const { error: updateErr } = await supabase
        .from("efris_invoices")
        .update({
          status: "accepted",
          fiscal_invoice_number: invoice.fiscal_invoice_number || mockFdn,
          antifake_code: mockAntiFake,
          qr_code: mockQr,
          response_json: { simulated: true, message: "Sandbox simulation — not a real URA submission" },
          submitted_at: new Date().toISOString(),
        })
        .eq("id", invoiceId);

      if (updateErr) throw new Error(updateErr.message);

      toast("Invoice simulated as accepted (sandbox mode)", "success");
      renderEfris(rootEl);
    } else {
      const isS2S = STATE.business.efris_provider === "direct_s2s";
      const fnName = isS2S ? "efris-s2s" : "efris-submit-invoice";
      const body = isS2S
        ? { action: "fiscalise_invoice", payload: { efris_invoice_id: invoiceId } }
        : { efrisInvoiceId: invoiceId };

      const { data, error } = await supabase.functions.invoke(fnName, { body });

      if (error) throw new Error(error.message || "Edge function error");
      if (!data?.success) throw new Error(data?.error || "Submission failed");

      toast("Invoice submitted to URA successfully!", "success");
      renderEfris(rootEl);
    }
  } catch (e) {
    console.error("submitInvoice error:", e);
    toast("Submission failed: " + e.message, "error", 5000);
  }
}

function statusBadge(status) {
  const map = {
    pending: "badge-gray",
    queued: "badge-blue",
    accepted: "badge-green",
    rejected: "badge-red",
    failed: "badge-red",
  };
  return `<span class="badge ${map[status] || "badge-gray"}">${escapeHtml(status)}</span>`;
}

// T114 reason codes — URA "refundReason" dictionary (required by URA when
// cancelling an approved credit/debit note).
const CANCEL_REASON_CODES = [
  { code: "101", label: "Return of products due to expiry or damage, etc." },
  { code: "102", label: "Cancellation of the purchase" },
  { code: "103", label: "Invoice amount wrongly stated due to miscalculation of price, tax, or discounts" },
  { code: "104", label: "Partial or complete waiver of the product sale after the invoice was issued" },
  { code: "105", label: "Others (please specify)" },
];

async function cancelCreditNote(invoiceId, rootEl) {
  const { data: invoice, error: invErr } = await supabase
    .from("efris_invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (invErr) { toast(invErr.message, "error"); return; }
  if (!invoice) { toast("Credit note not found", "error"); return; }
  if (invoice.invoice_type !== "2") { toast("Only credit notes can be cancelled this way", "error"); return; }
  if (invoice.status !== "accepted") { toast("Only approved credit notes can be cancelled", "error"); return; }
  if (invoice.response_json?.cancelled) { toast("This credit note has already been cancelled", "error"); return; }

  // The original invoice's URA invoice ID is required by T114 (oriInvoiceId).
  let originalInvoice = null;
  if (invoice.original_invoice_id) {
    const { data } = await supabase
      .from("efris_invoices")
      .select("ura_invoice_id, fiscal_invoice_number")
      .eq("id", invoice.original_invoice_id)
      .maybeSingle();
    originalInvoice = data;
  }

  openModal(
    `
    <div class="modal-title-row"><h3>Cancel Credit Note</h3></div>
    <p class="help-text">
      This sends a <b>T114 Cancel Credit Note</b> request to URA for approved credit note
      <b>${escapeHtml(invoice.fiscal_invoice_number)}</b>. The cancellation cannot be undone.
    </p>
    <div class="field">
      <label>Reason</label>
      <select id="cn-reason-code">${CANCEL_REASON_CODES.map((r) => `<option value="${r.code}">${r.code} — ${escapeHtml(r.label)}</option>`).join("")}</select>
    </div>
    <div class="field" id="cn-reason-field" style="display:none;">
      <label>Specify reason</label>
      <input type="text" id="cn-reason" placeholder="Describe the reason…" maxlength="1024" />
    </div>
    <div class="flex gap" style="margin-top:12px;">
      <button class="btn btn-danger" id="cn-confirm-btn" style="flex:1;">Confirm Cancellation</button>
      <button class="btn btn-secondary" data-close-modal>Back</button>
    </div>
  `,
    { large: true },
  );

  const reasonCodeSel = document.querySelector("#cn-reason-code");
  const reasonField = document.querySelector("#cn-reason-field");
  reasonCodeSel.addEventListener("change", () => {
    reasonField.style.display = reasonCodeSel.value === "105" ? "" : "none";
  });

  document.querySelector("#cn-confirm-btn").addEventListener("click", async () => {
    const reasonCode = reasonCodeSel.value;
    const reason = document.querySelector("#cn-reason")?.value?.trim() || "";
    if (reasonCode === "105" && !reason) {
      toast("Please specify a reason when code 105 (Others) is selected", "error");
      return;
    }

    const confirmBtn = document.querySelector("#cn-confirm-btn");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Cancelling…";
    try {
      let result;
      if (!STATE.business.efris_live_enabled) {
        // Sandbox simulation — no real URA call.
        result = { success: true, simulated: true, returnMessage: "SUCCESS" };
      } else if (STATE.business.efris_provider === "direct_s2s") {
        if (!originalInvoice?.ura_invoice_id) {
          throw new Error(
            "The original invoice has no URA invoice ID on record, so T114 cannot be sent. " +
            "Cancel it from the URA portal instead, or contact support.",
          );
        }
        const body = {
          action: "credit_note_cancel",
          payload: {
            oriInvoiceId: originalInvoice.ura_invoice_id,
            invoiceNo: invoice.fiscal_invoice_number,
            reasonCode,
            reason: reason || "",
            invoiceApplyCategoryCode: "104",
          },
        };
        const { data, error } = await supabase.functions.invoke("efris-s2s", { body });
        if (error) throw new Error(error.message || "Edge function error");
        if (!data?.success) throw new Error(data?.error || "URA rejected the cancellation");
        result = data;
      } else {
        throw new Error(
          "Credit note cancellation via T114 requires the Direct URA S2S provider. " +
          "Switch providers in Settings → EFRIS to use it.",
        );
      }

      const { error: updateErr } = await supabase
        .from("efris_invoices")
        .update({
          response_json: {
            ...(invoice.response_json || {}),
            cancelled: true,
            cancelled_at: new Date().toISOString(),
            cancel_reason_code: reasonCode,
            cancel_reason: reason || "",
            cancel_response: result.raw || result,
          },
        })
        .eq("id", invoiceId);
      if (updateErr) throw new Error(updateErr.message);

      closeModal();
      toast(
        result.simulated
          ? "Credit note cancellation simulated (sandbox mode)"
          : "Credit note cancelled with URA",
        "success",
      );
      renderEfris(rootEl);
    } catch (e) {
      console.error("cancelCreditNote error:", e);
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirm Cancellation";
      toast("Cancellation failed: " + e.message, "error", 6000);
    }
  });
}

function viewPayload(invoice) {
  openModal(
    `
    <div class="modal-title-row"><h3>EFRIS Payload — ${escapeHtml(invoice.fiscal_invoice_number)}</h3></div>
    <pre style="background:var(--surface-2); padding:14px; border-radius:8px; max-height:400px; overflow:auto; font-size:11.5px;">${escapeHtml(JSON.stringify(invoice.payload_json, null, 2))}</pre>
    ${invoice.antifake_code ? `<p class="help-text">Anti-fake code: <b>${escapeHtml(invoice.antifake_code)}</b></p>` : ""}
    ${invoice.qr_code ? `<p class="help-text">QR Code: <b>${escapeHtml(invoice.qr_code)}</b></p>` : ""}
    ${invoice.error_message ? `<p class="help-text" style="color:var(--danger);">Error: ${escapeHtml(invoice.error_message)}</p>` : ""}
    <div class="flex gap" style="margin-top:12px; flex-wrap:wrap;">
      ${invoice.status === "accepted" ? `<button class="btn btn-secondary" data-print-payload="${invoice.id}">🖨️ Print EFRIS Receipt</button>` : ""}
      ${invoice.status === "accepted" ? `<button class="btn btn-primary" data-whatsapp-payload="${invoice.id}">📱 Share via WhatsApp</button>` : ""}
      ${invoice.status === "accepted" ? `<button class="btn btn-secondary" data-email-payload="${invoice.id}">📧 Email Receipt</button>` : ""}
      ${invoice.status === "accepted" ? `<button class="btn btn-secondary" data-sms-payload="${invoice.id}">📱 SMS Receipt</button>` : ""}
      ${invoice.status === "accepted" ? `<button class="btn btn-secondary" data-pdf-payload="${invoice.id}">📄 Save as PDF</button>` : ""}
    </div>
    <button class="btn btn-secondary btn-block" data-close-modal style="margin-top:10px;">Close</button>
  `,
    { large: true },
  );

  const printBtn = document.querySelector("[data-print-payload]");
  printBtn?.addEventListener("click", () => printEfrisReceipt(invoice));

  const whatsappBtn = document.querySelector("[data-whatsapp-payload]");
  whatsappBtn?.addEventListener("click", () => shareEfrisReceiptWhatsApp(invoice));

  const emailBtn = document.querySelector("[data-email-payload]");
  emailBtn?.addEventListener("click", () => shareEfrisReceiptEmail(invoice));

  const smsBtn = document.querySelector("[data-sms-payload]");
  smsBtn?.addEventListener("click", () => shareEfrisReceiptSms(invoice));

  const pdfBtn = document.querySelector("[data-pdf-payload]");
  pdfBtn?.addEventListener("click", () => saveEfrisReceiptPdf(invoice));
}

function exportCsv(invoices) {
  const header = [
    "Fiscal Invoice No",
    "Sale No",
    "Customer",
    "TIN",
    "Currency",
    "Gross Amount",
    "VAT Amount",
    "Status",
    "Date",
  ];
  const rows = invoices.map((i) => [
    i.fiscal_invoice_number,
    i.sales?.sale_number || "",
    i.customer_name || "",
    i.customer_tin || "",
    i.currency_code,
    i.gross_amount,
    i.vat_amount,
    i.status,
    i.created_at,
  ]);
  const csv = [header, ...rows]
    .map((r) =>
      r.map((v) => `"${sanitizeCsvValue(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `efris-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function printEfrisReceipt(invoice) {
  if (!invoice || invoice.status !== "accepted") {
    toast("Only accepted invoices can be printed as EFRIS receipts", "error");
    return;
  }

  const qrData = invoice.qr_code || invoice.payload_json?.qrCode || "";
  const qrImageUrl = qrData
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrData)}`
    : "";

  const business = STATE.business;
  const sale = invoice.sales;
  const customer = {
    name: invoice.customer_name || "Walk-in Customer",
    tin: invoice.customer_tin || "",
    phone: "",
    email: "",
  };

  const html = `
    <!doctype html>
    <html>
    <head>
      <title>EFRIS Receipt — ${escapeHtml(invoice.fiscal_invoice_number)}</title>
      <style>
        @media print { @page { width: 80mm; margin: 2mm; } body { margin: 0; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: monospace; font-size: 12px; display: flex; justify-content: center; padding: 10px; }
        .receipt { width: 300px; padding: 12px; background: white; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .qr { display: block; margin: 8px auto; }
        hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; margin: 4px 0; }
        .label { color: #666; }
        .value { text-align: right; }
        .total { font-weight: bold; font-size: 14px; border-top: 1px solid #000; padding-top: 6px; margin-top: 6px; }
        .footer { text-align: center; font-size: 10px; margin-top: 8px; color: #666; }
      </style>
    </head>
    <body>
    <div class="receipt">
      ${business.logo_url ? `<div class="center"><img src="${escapeHtml(business.logo_url)}" style="max-height:40px;"></div>` : ""}
      <div class="center bold" style="font-size:14px; color:#0f6b4a;">${escapeHtml(business.name || "Qwickpos")}</div>
      ${business.address ? `<div class="center" style="font-size:10px;">${escapeHtml(business.address)}</div>` : ""}
      ${business.tin ? `<div class="center" style="font-size:10px;">TIN: ${escapeHtml(business.tin)}</div>` : ""}
      ${business.phone ? `<div class="center" style="font-size:10px;">${escapeHtml(business.phone)}</div>` : ""}
      <hr />
      <div class="center bold" style="color:#0f6b4a;">TAX INVOICE</div>
      <div class="center" style="font-size:11px;">EFRIS Fiscal Invoice</div>
      <hr />
      <div class="row"><span class="label">Fiscal No:</span><span class="value bold">${escapeHtml(invoice.fiscal_invoice_number)}</span></div>
      ${sale ? `<div class="row"><span class="label">Sale No:</span><span class="value">${escapeHtml(sale.sale_number)}</span></div>` : ""}
      <div class="row"><span class="label">Customer:</span><span class="value">${escapeHtml(customer.name)}</span></div>
      ${customer.tin ? `<div class="row"><span class="label">Customer TIN:</span><span class="value">${escapeHtml(customer.tin)}</span></div>` : ""}
      <div class="row"><span class="label">Date:</span><span class="value">${new Date(invoice.created_at).toLocaleString("en-UG")}</span></div>
      <div class="row"><span class="label">Operator:</span><span class="value">${escapeHtml(STATE.appUser?.full_name || "Cashier")}</span></div>
      <hr />
      ${qrImageUrl ? `<img src="${qrImageUrl}" alt="EFRIS QR" class="qr" style="width:100px;height:100px;">` : ""}
      ${invoice.antifake_code ? `<div class="center" style="font-size:10px;margin:4px 0;"><b>Anti-fake:</b> ${escapeHtml(invoice.antifake_code)}</div>` : ""}
      <hr />
      <div class="row total"><span>TOTAL</span><span>${escapeHtml(invoice.currency_code || "UGX")} ${Number(invoice.gross_amount || 0).toLocaleString()}</span></div>
      <div class="row"><span class="label">VAT Incl.</span><span class="value">${escapeHtml(invoice.currency_code || "UGX")} ${Number(invoice.vat_amount || 0).toLocaleString()}</span></div>
      <hr />
      <div class="footer">Verify at efris.ura.go.ug</div>
      <div class="footer">Powered by Qwickpos</div>
    </div>
    </body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function shareEfrisReceiptWhatsApp(invoice) {
  const business = STATE.business;
  const customerName = invoice.customer_name || "Walk-in Customer";
  const customerPhone = invoice.customer_phone || "";
  const currency = invoice.currency_code || business.base_currency || "UGX";
  const formatMoney = (amt) => `${currency} ${Number(amt || 0).toLocaleString()}`;

  const message = `
*${business.name || "Qwickpos"} — EFRIS Fiscal Receipt*
FDN: ${invoice.fiscal_invoice_number}
${invoice.antifake_code ? `Anti-fake: ${invoice.antifake_code}` : ""}
Date: ${new Date(invoice.created_at).toLocaleString("en-UG")}
Customer: ${customerName}
${invoice.customer_tin ? `Customer TIN: ${invoice.customer_tin}` : ""}
Sale: ${invoice.sales?.sale_number || "—"}
Operator: ${STATE.appUser?.full_name || "Cashier"}

Total: *${formatMoney(invoice.gross_amount)}*
VAT Incl: ${formatMoney(invoice.vat_amount)}

Verified via URA EFRIS
efris.ura.go.ug
Powered by Qwickpos
  `.trim();

  const encodedMsg = encodeURIComponent(message);

  if (customerPhone) {
    // Try to use customer's phone number
    const phone = customerPhone.replace(/[^0-9]/g, "");
    const url = `https://wa.me/${phone.startsWith("0") ? "256" + phone.slice(1) : phone}?text=${encodedMsg}`;
    window.open(url, "_blank");
  } else {
    // Open WhatsApp with pre-filled message (user selects contact)
    window.open(`https://wa.me/?text=${encodedMsg}`, "_blank");
  }

  toast("WhatsApp opened — select contact to send", "success");
}

async function shareEfrisReceiptEmail(invoice) {
  const customer = invoice.sales?.customer || {};
  const customerEmail = customer.email || invoice.customer_email || "";
  const message = buildEfrisReceiptText(invoice);

  if (customerEmail) {
    // Try the send-receipt edge function
    try {
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("./uganda-pos-core.js");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-receipt`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          sale_id: invoice.sale_id, 
          channel: "email",
          custom_message: message,
          to_email: customerEmail 
        }),
      });
      const result = await res.json();
      if (result.success) {
        toast("Email receipt sent!", "success");
        return;
      }
    } catch (e) {
      console.warn("Email via edge function failed, falling back to mailto:", e);
    }
  }

  // Fallback: open mailto link
  const subject = `EFRIS Receipt — ${invoice.fiscal_invoice_number}`;
  const mailtoUrl = `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  window.open(mailtoUrl, "_blank");
  toast("Email client opened" + (customerEmail ? ` to ${customerEmail}` : ""), "success");
}

async function shareEfrisReceiptSms(invoice) {
  const customerPhone = invoice.customer_phone || invoice.sales?.customer?.phone || "";
  const message = buildEfrisReceiptText(invoice);

  if (customerPhone) {
    // Try the send-receipt edge function
    try {
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("./uganda-pos-core.js");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-receipt`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          sale_id: invoice.sale_id, 
          channel: "sms",
          custom_message: message,
          to_phone: customerPhone 
        }),
      });
      const result = await res.json();
      if (result.success) {
        toast("SMS receipt sent!", "success");
        return;
      }
    } catch (e) {
      console.warn("SMS via edge function failed, falling back to sms:", e);
    }
  }

  // Fallback: open sms link
  const phone = customerPhone?.replace(/[^0-9]/g, "");
  const smsUrl = phone ? `sms:${phone}?body=${encodeURIComponent(message)}` : `sms:?body=${encodeURIComponent(message)}`;
  window.open(smsUrl, "_blank");
  toast("SMS app opened" + (customerPhone ? ` to ${customerPhone}` : ""), "success");
}

function buildEfrisReceiptText(invoice) {
  const business = STATE.business;
  const customerName = invoice.customer_name || "Walk-in Customer";
  const currency = invoice.currency_code || business.base_currency || "UGX";
  const formatMoney = (amt) => `${currency} ${Number(amt || 0).toLocaleString()}`;

  return `
${business.name || "Qwickpos"} — EFRIS Fiscal Receipt
FDN: ${invoice.fiscal_invoice_number}
${invoice.antifake_code ? `Anti-fake: ${invoice.antifake_code}` : ""}
Date: ${new Date(invoice.created_at).toLocaleString("en-UG")}
Customer: ${customerName}
${invoice.customer_tin ? `Customer TIN: ${invoice.customer_tin}` : ""}
Sale: ${invoice.sales?.sale_number || "—"}
Operator: ${STATE.appUser?.full_name || "Cashier"}

Total: ${formatMoney(invoice.gross_amount)}
VAT Incl: ${formatMoney(invoice.vat_amount)}

Verified via URA EFRIS: efris.ura.go.ug
Powered by Qwickpos
  `.trim();
}

async function saveEfrisReceiptPdf(invoice) {
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");

  const business = STATE.business;
  const sale = invoice.sales || {};
  const customerName = invoice.customer_name || "Walk-in Customer";
  const customerTin = invoice.customer_tin || "";
  const currency = invoice.currency_code || business.base_currency || "UGX";
  const formatMoney = (amt) => `${currency} ${Number(amt || 0).toLocaleString()}`;

  const doc = new jsPDF({ unit: "mm", format: [80, 297] });
  let y = 10;

  const addCenter = (text, size = 10, bold = false, color = "#000") => {
    doc.setFontSize(size);
    doc.setTextColor(color);
    doc.setFont(undefined, bold ? "bold" : "normal");
    doc.text(text, 40, y, { align: "center" });
    y += size * 0.5 + 1;
  };

  const addRow = (label, value, size = 9, bold = false) => {
    doc.setFontSize(size);
    doc.setTextColor("#666");
    doc.setFont(undefined, "normal");
    doc.text(label, 5, y);
    doc.setTextColor("#000");
    doc.setFont(undefined, bold ? "bold" : "normal");
    doc.text(value, 75, y, { align: "right" });
    y += 4.5;
  };

  if (business.logo_url) {
    try {
      doc.addImage(business.logo_url, "JPEG", 20, y, 40, 20);
      y += 22;
    } catch { }
  }

  addCenter(business.name || "Business", 14, true, "#0f6b4a");
  if (business.tin) addCenter(`TIN: ${business.tin}`, 8);
  if (business.address) addCenter(business.address, 8);
  addCenter("FISCAL RECEIPT (EFRIS)", 12, true, "#0f6b4a");
  addCenter(`FDN: ${invoice.fiscal_invoice_number}`, 9);
  if (invoice.antifake_code) addCenter(`Anti-fake: ${invoice.antifake_code}`, 8);
  if (invoice.qr_code) {
    try {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=40x40&data=${encodeURIComponent(invoice.qr_code)}`;
      doc.addImage(qrUrl, "PNG", 20, y, 40, 40);
      y += 42;
    } catch { }
  }
  addRow("Sale:", sale.sale_number || "—");
  addRow("Date:", new Date(invoice.created_at).toLocaleString("en-UG"));
  addRow("Customer:", customerName);
  if (customerTin) addRow("Customer TIN:", customerTin);
  addRow("Operator:", STATE.appUser?.full_name || "Cashier");

  doc.setDrawColor(0);
  doc.line(5, y, 75, y);
  y += 3;

  const items = sale.sale_items || [];
  items.forEach((it) => {
    const name = it.product_name || it.name || "";
    const qty = it.quantity || it.qty || 0;
    const price = formatMoney(it.unit_price || it.price || 0);
    const total = formatMoney(it.line_total || it.total || 0);
    doc.setFontSize(8);
    doc.text(name, 5, y);
    y += 3.5;
    doc.text(`${qty} x ${price}`, 5, y);
    doc.text(total, 75, y, { align: "right" });
    y += 4.5;
  });

  doc.line(5, y, 75, y);
  y += 3;
  addRow("Subtotal:", formatMoney(invoice.gross_amount - invoice.vat_amount));
  addRow("VAT (18%):", formatMoney(invoice.vat_amount));
  doc.setFontSize(11);
  doc.setTextColor("#0f6b4a");
  doc.setFont(undefined, "bold");
  doc.text("TOTAL", 5, y);
  doc.text(formatMoney(invoice.gross_amount), 75, y, { align: "right" });
  y += 6;

  doc.line(5, y, 75, y);
  y += 3;
  addCenter("Verified via URA EFRIS", 8);
  addCenter("efris.ura.go.ug", 8);
  addCenter("Powered by Qwickpos", 8);

  doc.save(`EFRIS-${invoice.fiscal_invoice_number}.pdf`);
  toast("PDF downloaded", "success");
}
