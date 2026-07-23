// =====================================================================
// QWICKPOS — DOCUMENT TEMPLATE CUSTOMIZER
// Receipt, Invoice, Quotation template settings with live preview
// =====================================================================
import {
  STATE,
  $,
  escapeHtml,
  toast,
  openModal,
  closeModal,
  fmtMoneyRaw,
} from "./uganda-pos-core.js";

const STORAGE_KEY = "ugpos_doc_template";

const DEFAULTS = {
  logoUrl: "",
  primaryColor: "#0f6b4a",
  secondaryColor: "#333333",
  fontSize: "13",
  showLogo: true,
  showBusinessName: true,
  showAddress: true,
  showTin: true,
  showPhone: true,
  showEmail: true,
  showServerName: true,
  showDate: true,
  showInvoiceNumber: true,
  showTaxBreakdown: true,
  showDiscount: true,
  showFooter: true,
  footerText: "Thank you for your business!",
  headerText: "",
  invoiceTitle: "RECEIPT",
  paperWidth: "80", // 58mm or 80mm thermal
};

function loadTemplate() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveTemplate(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getReceiptTemplate() {
  return loadTemplate();
}

export function initTemplateSettings() {
  // Patch receiptHtml to use template settings
}

export async function renderTemplateSettings(root) {
  const tpl = loadTemplate();

  root.innerHTML = `
    <div class="view-header">
      <div><h2>Document Templates</h2><p class="sub">Customize receipts, invoices, and quotations</p></div>
    </div>
    <div class="grid-2" style="gap:24px;">
      <div class="card">
        <div class="card-title">🎨 Template Settings</div>

        <div class="field">
          <label>Business Logo URL</label>
          <input id="tpl-logo" value="${escapeHtml(tpl.logoUrl)}" placeholder="https://..." />
        </div>

        <div class="field-row">
          <div class="field">
            <label>Primary Color</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="color" id="tpl-primary" value="${tpl.primaryColor}" style="width:40px; height:36px; padding:2px; cursor:pointer;" />
              <input id="tpl-primary-hex" value="${tpl.primaryColor}" style="flex:1;" />
            </div>
          </div>
          <div class="field">
            <label>Text Color</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="color" id="tpl-secondary" value="${tpl.secondaryColor}" style="width:40px; height:36px; padding:2px; cursor:pointer;" />
              <input id="tpl-secondary-hex" value="${tpl.secondaryColor}" style="flex:1;" />
            </div>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Font Size</label>
            <select id="tpl-fontsize">
              ${["11", "12", "13", "14", "15"].map((s) => `<option value="${s}" ${tpl.fontSize === s ? "selected" : ""}>${s}px</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Paper Width</label>
            <select id="tpl-paper">
              <option value="58" ${tpl.paperWidth === "58" ? "selected" : ""}>58mm (narrow)</option>
              <option value="80" ${tpl.paperWidth === "80" ? "selected" : ""}>80mm (standard)</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Invoice Title</label>
          <input id="tpl-title" value="${escapeHtml(tpl.invoiceTitle)}" placeholder="RECEIPT / INVOICE / QUOTATION" />
        </div>

        <div class="field">
          <label>Header Text (above business name)</label>
          <input id="tpl-header" value="${escapeHtml(tpl.headerText)}" placeholder="Optional header" />
        </div>

        <div class="field">
          <label>Footer Text</label>
          <textarea id="tpl-footer" rows="2">${escapeHtml(tpl.footerText)}</textarea>
        </div>

        <div class="card-title" style="margin-top:16px;">Visible Fields</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
          ${[
            ["showLogo", "🖼️ Logo"],
            ["showBusinessName", "🏢 Business Name"],
            ["showAddress", "📍 Address"],
            ["showTin", "🏛️ TIN"],
            ["showPhone", "📞 Phone"],
            ["showEmail", "📧 Email"],
            ["showServerName", "👤 Served By"],
            ["showDate", "📅 Date"],
            ["showInvoiceNumber", "🔢 Invoice #"],
            ["showTaxBreakdown", "💰 Tax Breakdown"],
            ["showDiscount", "🏷️ Discount"],
            ["showFooter", "📝 Footer"],
          ]
            .map(
              ([key, label]) => `
            <label style="display:flex; align-items:center; gap:6px; padding:6px 8px; border:1px solid var(--border); border-radius:6px; cursor:pointer; font-size:13px;">
              <input type="checkbox" id="tpl-${key}" ${tpl[key] ? "checked" : ""} style="accent-color:var(--brand);" />
              ${label}
            </label>
          `,
            )
            .join("")}
        </div>

        <button class="btn btn-primary btn-block" id="tpl-save" style="margin-top:16px;">💾 Save Template</button>
        <button class="btn btn-outline btn-block" id="tpl-reset" style="margin-top:8px;">↩️ Reset to Default</button>
      </div>

      <div class="card" style="position:sticky; top:20px;">
        <div class="card-title">👁️ Live Preview</div>
        <div id="tpl-preview" style="background:#f5f5f5; padding:16px; border-radius:8px; display:flex; justify-content:center;">
          ${renderPreview(tpl)}
        </div>
        <div class="flex gap" style="margin-top:12px;">
          <button class="btn btn-outline btn-sm" id="tpl-test-print">🖨️ Test Print</button>
          <button class="btn btn-outline btn-sm" id="tpl-test-pdf">📄 Export HTML</button>
        </div>
      </div>
    </div>
  `;

  // Color sync
  const syncColors = () => {
    $("tpl-primary-hex").value = $("tpl-primary").value;
    $("tpl-secondary-hex").value = $("tpl-secondary").value;
    updatePreview();
  };
  $("tpl-primary").addEventListener("input", syncColors);
  $("tpl-secondary").addEventListener("input", syncColors);
  $("tpl-primary-hex").addEventListener("input", (e) => {
    $("tpl-primary").value = e.target.value;
    updatePreview();
  });
  $("tpl-secondary-hex").addEventListener("input", (e) => {
    $("tpl-secondary").value = e.target.value;
    updatePreview();
  });

  // Live update on any change
  [
    "tpl-fontsize",
    "tpl-paper",
    "tpl-title",
    "tpl-header",
    "tpl-footer",
    "tpl-logo",
  ].forEach((id) => {
    $(id)?.addEventListener("input", updatePreview);
  });
  document.querySelectorAll('[id^="tpl-show"]').forEach((el) => {
    el.addEventListener("change", updatePreview);
  });

  // Save
  $("tpl-save").addEventListener("click", () => {
    const settings = collectSettings();
    saveTemplate(settings);
    toast("Template saved", "success");
  });

  // Reset
  $("tpl-reset").addEventListener("click", () => {
    if (confirm("Reset template to defaults?")) {
      saveTemplate({ ...DEFAULTS });
      renderTemplateSettings(root);
    }
  });

  // Test print
  $("tpl-test-print").addEventListener("click", () => {
    const settings = collectSettings();
    const html = generateReceiptHtml(
      settings,
      {
        sale_number: "TEST-00001",
        created_at: new Date().toISOString(),
        currency_code: STATE.business?.base_currency || "UGX",
      },
      [
        {
          name: "Sample Product A",
          qty: 2,
          unitPrice: 15000,
          lineGross: 30000,
          taxCode: "STD",
        },
        {
          name: "Sample Product B",
          qty: 1,
          unitPrice: 8500,
          lineGross: 8500,
          taxCode: "STD",
        },
      ],
      { subtotal: 38500, discountTotal: 0, vatTotal: 5586, grandTotal: 38500 },
    );

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  });

  // Export HTML
  $("tpl-test-pdf").addEventListener("click", () => {
    const settings = collectSettings();
    const html = generateReceiptHtml(
      settings,
      {
        sale_number: "EXPORT-00001",
        created_at: new Date().toISOString(),
        currency_code: STATE.business?.base_currency || "UGX",
      },
      [
        {
          name: "Sample Product",
          qty: 1,
          unitPrice: 10000,
          lineGross: 10000,
          taxCode: "STD",
        },
      ],
      { subtotal: 10000, discountTotal: 0, vatTotal: 1449, grandTotal: 10000 },
    );

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "receipt-template.html";
    a.click();
    URL.revokeObjectURL(url);
    toast("Template HTML exported", "success");
  });

  function updatePreview() {
    const settings = collectSettings();
    const preview = $("tpl-preview");
    if (preview) preview.innerHTML = renderPreview(settings);
  }

  function collectSettings() {
    return {
      logoUrl: $("tpl-logo")?.value.trim() || "",
      primaryColor: $("tpl-primary")?.value || "#0f6b4a",
      secondaryColor: $("tpl-secondary")?.value || "#333333",
      fontSize: $("tpl-fontsize")?.value || "13",
      paperWidth: $("tpl-paper")?.value || "80",
      invoiceTitle: $("tpl-title")?.value || "RECEIPT",
      headerText: $("tpl-header")?.value || "",
      footerText: $("tpl-footer")?.value || "Thank you for your business!",
      showLogo: $("tpl-showLogo")?.checked ?? true,
      showBusinessName: $("tpl-showBusinessName")?.checked ?? true,
      showAddress: $("tpl-showAddress")?.checked ?? true,
      showTin: $("tpl-showTin")?.checked ?? true,
      showPhone: $("tpl-showPhone")?.checked ?? true,
      showEmail: $("tpl-showEmail")?.checked ?? true,
      showServerName: $("tpl-showServerName")?.checked ?? true,
      showDate: $("tpl-showDate")?.checked ?? true,
      showInvoiceNumber: $("tpl-showInvoiceNumber")?.checked ?? true,
      showTaxBreakdown: $("tpl-showTaxBreakdown")?.checked ?? true,
      showDiscount: $("tpl-showDiscount")?.checked ?? true,
      showFooter: $("tpl-showFooter")?.checked ?? true,
    };
  }
}

function renderPreview(tpl) {
  const b = STATE.business || {};
  const width = tpl.paperWidth === "58" ? "220px" : "300px";
  return `
    <div style="width:${width}; background:white; padding:12px; font-family:monospace; font-size:${tpl.fontSize}px; color:${tpl.secondaryColor}; border:1px solid #ddd; border-radius:4px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      ${tpl.showLogo && tpl.logoUrl ? `<div style="text-align:center; margin-bottom:8px;"><img src="${escapeHtml(tpl.logoUrl)}" style="max-height:40px; max-width:100%;" /></div>` : ""}
      ${tpl.headerText ? `<div style="text-align:center; font-size:10px; color:#999;">${escapeHtml(tpl.headerText)}</div>` : ""}
      ${tpl.showBusinessName ? `<div style="text-align:center; font-weight:bold; font-size:${parseInt(tpl.fontSize) + 3}px; color:${tpl.primaryColor};">${escapeHtml(b.name || "Business Name")}</div>` : ""}
      ${tpl.showAddress && b.address ? `<div style="text-align:center; font-size:11px;">${escapeHtml(b.address)}</div>` : ""}
      ${tpl.showTin ? `<div style="text-align:center; font-size:11px;">TIN: ${escapeHtml(b.tin || "N/A")}</div>` : ""}
      ${tpl.showPhone && b.phone ? `<div style="text-align:center; font-size:11px;">${escapeHtml(b.phone)}</div>` : ""}
      ${tpl.showEmail && b.email ? `<div style="text-align:center; font-size:11px;">${escapeHtml(b.email)}</div>` : ""}
      <hr style="border:none; border-top:1px dashed ${tpl.primaryColor}; margin:8px 0;" />
      <div style="text-align:center; font-weight:bold; color:${tpl.primaryColor};">${escapeHtml(tpl.invoiceTitle)}</div>
      ${tpl.showInvoiceNumber ? `<div style="font-size:11px;">No: INV-00001</div>` : ""}
      ${tpl.showDate ? `<div style="font-size:11px;">Date: ${new Date().toLocaleString("en-UG")}</div>` : ""}
      ${tpl.showServerName ? `<div style="font-size:11px;">Served by: Cashier</div>` : ""}
      <hr style="border:none; border-top:1px dashed ${tpl.primaryColor}; margin:8px 0;" />
      <div style="font-size:11px;">
        <div style="display:flex; justify-content:space-between;"><span>Sample Product A</span></div>
        <div style="display:flex; justify-content:space-between; font-size:10px; color:#999;"><span>2 × UGX 15,000</span><span>UGX 30,000</span></div>
        <div style="display:flex; justify-content:space-between; margin-top:4px;"><span>Sample Product B</span></div>
        <div style="display:flex; justify-content:space-between; font-size:10px; color:#999;"><span>1 × UGX 8,500</span><span>UGX 8,500</span></div>
      </div>
      <hr style="border:none; border-top:1px dashed ${tpl.primaryColor}; margin:8px 0;" />
      <div style="font-size:11px;">
        <div style="display:flex; justify-content:space-between; color:#999;"><span>Subtotal</span><span>UGX 38,500</span></div>
        ${tpl.showDiscount ? `<div style="display:flex; justify-content:space-between; color:#999;"><span>Discount</span><span>- UGX 0</span></div>` : ""}
        ${tpl.showTaxBreakdown ? `<div style="display:flex; justify-content:space-between; color:#999;"><span>VAT (incl.)</span><span>UGX 5,586</span></div>` : ""}
        <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:${parseInt(tpl.fontSize) + 2}px; color:${tpl.primaryColor}; border-top:1px solid ${tpl.primaryColor}; padding-top:6px; margin-top:6px;">
          <span>TOTAL</span><span>UGX 38,500</span>
        </div>
      </div>
      <hr style="border:none; border-top:1px dashed ${tpl.primaryColor}; margin:8px 0;" />
      ${tpl.showFooter ? `<div style="text-align:center; font-size:11px;">${escapeHtml(tpl.footerText)}</div>` : ""}
    </div>
  `;
}

function generateReceiptHtml(settings, sale, lines, totals) {
  const b = STATE.business || {};
  const w = settings.paperWidth === "58" ? "220px" : "300px";
  return `<!DOCTYPE html>
<html><head><title>${escapeHtml(settings.invoiceTitle)} — ${escapeHtml(sale.sale_number)}</title>
<style>
  @media print { @page { width: ${settings.paperWidth}mm; margin: 2mm; } body { margin: 0; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; font-size: ${settings.fontSize}px; color: ${settings.secondaryColor}; display: flex; justify-content: center; padding: 10px; }
  .receipt { width: ${w}; padding: 12px; }
  .center { text-align: center; }
  hr { border: none; border-top: 1px dashed ${settings.primaryColor}; margin: 8px 0; }
  table { width: 100%; font-size: ${settings.fontSize}px; }
  td { padding: 2px 0; }
  .total-row { font-weight: bold; font-size: ${parseInt(settings.fontSize) + 2}px; color: ${settings.primaryColor}; border-top: 1px solid ${settings.primaryColor}; padding-top: 6px; margin-top: 6px; }
</style></head>
<body>
<div class="receipt">
  ${settings.showLogo && settings.logoUrl ? `<div class="center"><img src="${escapeHtml(settings.logoUrl)}" style="max-height:50px; max-width:100%;" /></div>` : ""}
  ${settings.headerText ? `<div class="center" style="font-size:10px; color:#999;">${escapeHtml(settings.headerText)}</div>` : ""}
  ${settings.showBusinessName ? `<div class="center" style="font-weight:bold; font-size:${parseInt(settings.fontSize) + 4}px; color:${settings.primaryColor};">${escapeHtml(b.name || "")}</div>` : ""}
  ${settings.showAddress && b.address ? `<div class="center">${escapeHtml(b.address)}</div>` : ""}
  ${settings.showTin ? `<div class="center">TIN: ${escapeHtml(b.tin || "N/A")}</div>` : ""}
  ${settings.showPhone && b.phone ? `<div class="center">${escapeHtml(b.phone)}</div>` : ""}
  ${settings.showEmail && b.email ? `<div class="center">${escapeHtml(b.email)}</div>` : ""}
  <hr />
  <div class="center" style="font-weight:bold; color:${settings.primaryColor};">${escapeHtml(settings.invoiceTitle)}</div>
  ${settings.showInvoiceNumber ? `<div>No: ${escapeHtml(sale.sale_number)}</div>` : ""}
  ${settings.showDate ? `<div>Date: ${new Date(sale.created_at || Date.now()).toLocaleString("en-UG")}</div>` : ""}
  ${settings.showServerName ? `<div>Served by: ${escapeHtml(STATE.appUser?.full_name || "Cashier")}</div>` : ""}
  <hr />
  <table>
    ${lines
      .map(
        (l) => `
      <tr><td colspan="2">${escapeHtml(l.name)}</td></tr>
      <tr><td>${l.qty} × ${fmtMoneyRaw(l.unitPrice, sale.currency_code)}</td><td style="text-align:right;">${fmtMoneyRaw(l.lineGross, sale.currency_code)}</td></tr>
    `,
      )
      .join("")}
  </table>
  <hr />
  <table>
    <tr><td>Subtotal</td><td style="text-align:right;">${fmtMoneyRaw(totals.subtotal, sale.currency_code)}</td></tr>
    ${settings.showDiscount ? `<tr><td>Discount</td><td style="text-align:right;">- ${fmtMoneyRaw(totals.discountTotal, sale.currency_code)}</td></tr>` : ""}
    ${settings.showTaxBreakdown ? `<tr><td>VAT (incl.)</td><td style="text-align:right;">${fmtMoneyRaw(totals.vatTotal, sale.currency_code)}</td></tr>` : ""}
    <tr class="total-row"><td>TOTAL</td><td style="text-align:right;">${fmtMoneyRaw(totals.grandTotal, sale.currency_code)}</td></tr>
  </table>
  <hr />
  ${settings.showFooter ? `<div class="center">${escapeHtml(settings.footerText)}</div>` : ""}
</div>
</body></html>`;
}
