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
    <div class="view-header">
      <div>
        <h2>EFRIS — URA E-Invoicing</h2>
        <p class="sub">Mode: <span class="badge ${STATE.business.efris_live_enabled ? "badge-green" : "badge-yellow"}">${STATE.business.efris_live_enabled ? "LIVE" : "SANDBOX"}</span>
          &nbsp;·&nbsp; TIN: ${escapeHtml(STATE.business.tin || "not set")}
          &nbsp;·&nbsp; Device No: ${escapeHtml(STATE.business.efris_device_no || "not registered")}</p>
      </div>
      <button class="btn btn-outline" id="export-efris-btn">Export CSV</button>
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
        <td><b>${escapeHtml(inv.fiscal_invoice_number)}</b></td>
        <td>${escapeHtml(inv.sales?.sale_number || "—")}</td>
        <td>${escapeHtml(inv.customer_name || "Walk-in")}</td>
        <td>${fmtMoneyRaw(Number(inv.gross_amount || 0), inv.currency_code)}</td>
        <td>${fmtMoneyRaw(Number(inv.vat_amount || 0), inv.currency_code)}</td>
        <td>${statusBadge(inv.status)}</td>
        <td>${fmtDate(inv.created_at)}</td>
        <td class="flex gap">
          <button class="btn btn-outline btn-sm" data-view="${inv.id}">Payload</button>
          ${["pending", "queued", "failed"].includes(inv.status) ? `<button class="btn btn-primary btn-sm" data-submit="${inv.id}">Submit</button>` : ""}
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
    ${invoice.error_message ? `<p class="help-text" style="color:var(--danger);">Error: ${escapeHtml(invoice.error_message)}</p>` : ""}
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:10px;">Close</button>
  `,
    { large: true },
  );
}

async function submitInvoice(invoiceId) {
  if (STATE.business.efris_live_enabled) return submitInvoiceLive(invoiceId);
  return submitInvoiceSimulated(invoiceId);
}

// ---- LIVE: real submission via the efris-submit-invoice edge function ----
async function submitInvoiceLive(invoiceId) {
  toast("Submitting to EFRIS…", "default", 2500);
  const { data, error } = await supabase.functions.invoke(
    "efris-submit-invoice",
    { body: { efrisInvoiceId: invoiceId } },
  );

  if (error || !data?.success) {
    toast(
      "EFRIS submission failed: " +
        (data?.error || error?.message || "unknown error"),
      "error",
      8000,
    );
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
