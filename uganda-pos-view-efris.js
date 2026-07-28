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
        <td>${statusBadge(inv.status)}</td>
        <td>${fmtDate(inv.created_at)}</td>
        <td class="flex gap">
          <button class="btn btn-secondary btn-sm" data-view="${inv.id}">Payload</button>
          ${["pending", "queued", "failed"].includes(inv.status) ? `<button class="btn btn-primary btn-sm" data-submit="${inv.id}">Submit</button>` : ""}
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
      b.addEventListener("click", () => submitInvoice(b.dataset.submit)),
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
    </div>
    <button class="btn btn-secondary btn-block" data-close-modal style="margin-top:10px;">Close</button>
  `,
    { large: true },
  );

  const printBtn = document.querySelector("[data-print-payload]");
  printBtn?.addEventListener("click", () => printEfrisReceipt(invoice));

  const whatsappBtn = document.querySelector("[data-whatsapp-payload]");
  whatsappBtn?.addEventListener("click", () => shareEfrisReceiptWhatsApp(invoice));
}

async function printEfrisReceipt(invoice) {
  const sale = invoice.sales || {};
  const business = STATE.business;
  const customerName = invoice.customer_name || "Walk-in Customer";
  const customerTin = invoice.customer_tin || "";
  const items = sale.sale_items || [];
  const currency = invoice.currency_code || business.base_currency || "UGX";

  const formatMoney = (amt) => fmtMoneyRaw(Number(amt || 0), currency);

  const linesHtml = items
    .map(
      (it) => `
    <tr>
      <td>${escapeHtml(it.product_name || it.name)}</td>
      <td class="text-right">${it.quantity || it.qty}</td>
      <td class="text-right">${formatMoney(it.unit_price || it.price)}</td>
      <td class="text-right font-bold">${formatMoney(it.line_total || it.total)}</td>
    </tr>
  `,
    )
    .join("");

  const efrisHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>EFRIS Receipt - ${escapeHtml(invoice.fiscal_invoice_number)}</title>
      <style>
        @media print { @page { width: 80mm; margin: 2mm; } body { margin: 0; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: monospace; font-size: 12px; color: #333; display: flex; justify-content: center; padding: 10px; }
        .receipt { width: 300px; padding: 12px; }
        .center { text-align: center; }
        hr { border: none; border-top: 1px dashed #333; margin: 8px 0; }
        .qr-wrap { text-align: center; margin: 8px 0; }
        .qr-wrap img { width: 100px; height: 100px; image-rendering: pixelated; }
        .title { font-weight: bold; font-size: 14px; text-align: center; color: #0f6b4a; }
        .label { font-size: 11px; color: #999; }
        .value { font-size: 11px; font-weight: bold; }
        table { width: 100%; font-size: 11px; }
        td { padding: 2px 0; }
        .total-row { font-weight: bold; font-size: 13px; color: #0f6b4a; border-top: 1px solid #0f6b4a; padding-top: 6px; margin-top: 6px; }
      </style>
    </head>
    <body>
    <div class="receipt">
      ${business.logo_url ? `<div class="center"><img src="${escapeHtml(business.logo_url)}" style="max-height:50px;" /></div>` : ""}
      <div class="center" style="font-weight:bold; font-size:14px; color:#0f6b4a;">${escapeHtml(business.name || "Business")}</div>
      ${business.tin ? `<div class="center" style="font-size:11px;">TIN: ${escapeHtml(business.tin)}</div>` : ""}
      ${business.address ? `<div class="center" style="font-size:11px;">${escapeHtml(business.address)}</div>` : ""}
      <hr />
      <div class="title">FISCAL RECEIPT (EFRIS)</div>
      <div style="font-size:11px;">FDN: ${escapeHtml(invoice.fiscal_invoice_number)}</div>
      ${invoice.antifake_code ? `<div style="font-size:11px;">Anti-fake: ${escapeHtml(invoice.antifake_code)}</div>` : ""}
      ${invoice.qr_code ? `<div class="qr-wrap"><img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(invoice.qr_code)}" alt="EFRIS QR" /></div>` : ""}
      <hr />
      <div style="font-size:11px;">Sale: ${escapeHtml(sale.sale_number || "—")}</div>
      <div style="font-size:11px;">Date: ${new Date(invoice.created_at).toLocaleString("en-UG")}</div>
      <div style="font-size:11px;">Customer: ${escapeHtml(customerName)}${customerTin ? ` (TIN: ${escapeHtml(customerTin)})` : ""}</div>
      <hr />
      <table>
        <thead>
          <tr style="border-bottom:1px solid #333;"><th style="text-align:left;">Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr>
        </thead>
        <tbody>
          ${linesHtml}
        </tbody>
      </table>
      <hr />
      <table style="width:100%; font-size:11px;">
        <tr><td>Subtotal</td><td style="text-align:right;">${formatMoney(invoice.gross_amount - invoice.vat_amount)}</td></tr>
        <tr><td>VAT (18%)</td><td style="text-align:right;">${formatMoney(invoice.vat_amount)}</td></tr>
        <tr class="total-row"><td>TOTAL</td><td style="text-align:right;">${formatMoney(invoice.gross_amount)}</td></tr>
      </table>
      <hr />
      <div class="center" style="font-size:10px; color:#999;">Verified via URA EFRIS</div>
      <div class="center" style="font-size:10px; color:#999;">Thank you for your business!</div>
    </div>
    </body>
    </html>
  `;

  const w = window.open("", "_blank");
  if (!w) { toast("Popup blocked. Allow popups to print.", "error", 4000); return; }
  w.document.write(efrisHtml);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); w.close(); };
}

async function submitInvoice(invoiceId) {
  if (STATE.business.efris_live_enabled) return submitInvoiceLive(invoiceId);
  return submitInvoiceSimulated(invoiceId);
}

// ---- LIVE: real submission via the appropriate edge function ----
async function submitInvoiceLive(invoiceId) {
  // Route to Direct S2S or middleware-based submission
  if (STATE.business.efris_provider === 'direct_s2s') {
    return submitInvoiceS2S(invoiceId);
  }
  return submitInvoiceMiddleware(invoiceId);
}

// ---- DIRECT S2S: submit via efris-s2s edge function (no middleware) ----
async function submitInvoiceS2S(invoiceId) {
  toast("Submitting directly to URA (S2S)…", "default", 2500);
  const { data, error } = await supabase.functions.invoke(
    "efris-s2s",
    { body: { action: "fiscalise_invoice", payload: { efris_invoice_id: invoiceId } } },
  );

  if (error || !data?.success) {
    if (data?.retryScheduled) {
      toast(
        `EFRIS rejected — retry ${data.retriesLeft ? `${data.retriesLeft} left` : "scheduled"}: ${data.error}`,
        "default",
        6000,
      );
    } else {
      toast(
        "EFRIS S2S submission failed: " +
          (data?.error || error?.message || "unknown error"),
        "error",
        8000,
      );
    }
  } else {
    toast(
      `EFRIS invoice accepted ✅ FDN: ${data.invoiceNo || ""}`,
      "success",
      6000,
    );
  }
  document.querySelector('[data-route="efris"]')?.click();
}

// ---- MIDDLEWARE: submit via efris-submit-invoice edge function (EFRIS Simplified / WEAF) ----
async function submitInvoiceMiddleware(invoiceId) {
  toast("Submitting to EFRIS…", "default", 2500);
  const { data, error } = await supabase.functions.invoke(
    "efris-submit-invoice",
    { body: { efrisInvoiceId: invoiceId } },
  );

  if (error || !data?.success) {
    if (data?.retryScheduled) {
      toast(
        `EFRIS rejected — retry ${data.retriesLeft ? `${data.retriesLeft} left` : "scheduled"}: ${data.error}`,
        "default",
        6000,
      );
    } else {
      toast(
        "EFRIS submission failed: " +
          (data?.error || error?.message || "unknown error"),
        "error",
        8000,
      );
    }
  } else {
    toast(
      `EFRIS invoice accepted ✅ FDN: ${data.invoiceNo || ""}`,
      "success",
      6000,
    );
  }
  document.querySelector('[data-route="efris"]')?.click();
}

// ---- SANDBOX: local simulation, no data leaves the browser ----
async function submitInvoiceSimulated(invoiceId) {
  toast("Simulating EFRIS submission…", "default", 1500);
  await supabase
    .from("efris_invoices")
    .update({ status: "queued" })
    .eq("id", invoiceId);

  setTimeout(async () => {
    const success = Math.random() > 0.08; // simulate occasional rejection
    const update = success
      ? {
          status: "accepted",
          antifake_code:
            "AF" + Math.random().toString(36).slice(2, 10).toUpperCase(),
          qr_code:
            "EFRIS-QR-" + Math.random().toString(36).slice(2, 14).toUpperCase(),
          submitted_at: new Date().toISOString(),
          error_message: null,
        }
      : {
          status: "rejected",
          error_message: "Simulated: verify buyer TIN and retry.",
          submitted_at: new Date().toISOString(),
        };

    await supabase.from("efris_invoices").update(update).eq("id", invoiceId);
    await supabase
      .from("efris_queue")
      .update({
        status: success ? "done" : "failed",
        last_error: update.error_message,
      })
      .eq("efris_invoice_id", invoiceId);

    toast(
      success
        ? "EFRIS invoice accepted ✅ (simulated)"
        : "EFRIS invoice rejected — see details",
      success ? "success" : "error",
    );
    document.querySelector('[data-route="efris"]')?.click();
  }, 1200);
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
