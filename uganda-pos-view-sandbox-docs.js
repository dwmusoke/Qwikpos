// =====================================================================
// QWICKPOS — EFRIS SANDBOX API DOCUMENTATION (public-facing)
// Clean API reference for third-party POS/ERP/accounting vendors
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
  fmtDate,
} from "./uganda-pos-core.js";

export async function renderSandboxDocs(root) {
  const activeTab = { current: "getting-started" };

  root.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1>EFRIS Sandbox API</h1>
        <p>Test your URA EFRIS integration without a live account</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="sandbox-get-key-btn">Get API Key</button>
      </div>
    </div>

    <div class="category-chips" style="margin-bottom:16px;">
      <button class="chip active" data-doc-tab="getting-started">Getting Started</button>
      <button class="chip" data-doc-tab="auth">Authentication</button>
      <button class="chip" data-doc-tab="register">Register Product</button>
      <button class="chip" data-doc-tab="invoice">Fiscal Invoice</button>
      <button class="chip" data-doc-tab="query">Query Invoices</button>
      <button class="chip" data-doc-tab="errors">Error Codes</button>
      <button class="chip" data-doc-tab="limits">Rate Limits</button>
      <button class="chip" data-doc-tab="try-it">Try It</button>
    </div>

    <div id="sandbox-docs-content"></div>
  `;

  const renderContent = () => {
    const el = $("sandbox-docs-content");
    const tab = activeTab.current;

    const sections = {
      "getting-started": renderGettingStarted,
      auth: renderAuth,
      register: renderRegister,
      invoice: renderInvoice,
      query: renderQuery,
      errors: renderErrors,
      limits: renderLimits,
      "try-it": renderTryIt,
    };

    (sections[tab] || sections["getting-started"])(el);
  };

  renderContent();

  qsa("[data-doc-tab]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      activeTab.current = btn.dataset.docTab;
      qsa("[data-doc-tab]", root).forEach((b) => b.classList.toggle("active", b.dataset.docTab === activeTab.current));
      renderContent();
    }),
  );

  $("sandbox-get-key-btn")?.addEventListener("click", () => {
    if (!STATE.business) {
      toast("Log in to get an API key", "default", 3000);
      return;
    }
    openGetKeyModal();
  });
}

function renderGettingStarted(el) {
  el.innerHTML = `
    <div class="card" style="max-width:800px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Getting Started</h2>
      <p style="color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        The EFRIS Sandbox API is a mock implementation of the URA EFRIS Simplified middleware.
        It lets you test your POS, ERP, or accounting system's EFRIS integration without needing
        a real URA account or device number.
      </p>

      <h3 style="font-size:15px;margin:20px 0 8px;">Quick Start</h3>
      <ol style="padding-left:20px;color:var(--text-muted);line-height:2;">
        <li>Get an API key from the Sandbox section in your dashboard</li>
        <li>Set your base URL to the sandbox endpoint</li>
        <li>Add the <code>Authorization: Bearer</code> header</li>
        <li>Send the same payloads you'd send to EFRIS Simplified</li>
        <li>Get realistic URA-like responses (FDN numbers, anti-fake codes, QR)</li>
      </ol>

      <h3 style="font-size:15px;margin:20px 0 8px;">Base URL</h3>
      <div style="background:var(--surface-2);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:13px;margin-bottom:16px;">
        https://<your-project>.supabase.co/functions/v1/efris-sandbox-api
      </div>

      <h3 style="font-size:15px;margin:20px 0 8px;">Example cURL</h3>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;overflow-x:auto;line-height:1.6;"><code>curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/efris-sandbox-api/1012345678/generate-fiscal-invoice" \\
  -H "Authorization: Bearer sbx_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "invoice": {
      "sellerDetails": {
        "tin": "1012345678",
        "legalName": "My Shop Ltd"
      },
      "basicInformation": {
        "invoiceNo": "",
        "antifakeCode": "",
        "deviceNo": "1012345678_01",
        "issuedDate": "2025-01-15 10:30:00",
        "operator": "Cashier",
        "currency": "UGX",
        "invoiceType": "1",
        "invoiceKind": "1",
        "dataSource": "103"
      },
      "buyerDetails": { "buyerType": "1", "buyerLegalName": "Walk-in" },
      "goodsDetails": [{
        "item": "Paracetamol",
        "qty": "2",
        "unitPrice": "5000",
        "total": "10000",
        "taxRate": "0.18",
        "tax": "1800",
        "orderNumber": "0",
        "discountFlag": "2", "deemedFlag": "2", "exciseFlag": "2"
      }],
      "taxDetails": [{
        "taxCategoryCode": "01",
        "netAmount": "8200.00",
        "taxRate": "0.18",
        "taxAmount": "1800.00",
        "grossAmount": "10000.00"
      }],
      "summary": {
        "netAmount": "8200.00",
        "taxAmount": "1800.00",
        "grossAmount": "10000.00",
        "itemCount": "1",
        "modeCode": "1",
        "remarks": "Thank you"
      },
      "payWay": [{ "paymentMode": "102", "paymentAmount": "10000", "orderNumber": "a" }]
    }
  }'</code></pre>
    </div>`;
}

function renderAuth(el) {
  el.innerHTML = `
    <div class="card" style="max-width:800px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Authentication</h2>
      <p style="color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        All requests require a Bearer token in the Authorization header. Your API key starts with <code>sbx_</code>.
      </p>

      <h3 style="font-size:15px;margin:20px 0 8px;">Header</h3>
      <div style="background:var(--surface-2);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:13px;">
        Authorization: Bearer sbx_your_api_key_here
      </div>

      <h3 style="font-size:15px;margin:20px 0 8px;">Response on invalid key</h3>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;">{
  "response": "ERROR",
  "message": "Invalid or inactive API key"
}</pre>
      <p style="color:var(--text-muted);font-size:13px;margin-top:8px;">HTTP Status: 401</p>

      <h3 style="font-size:15px;margin:20px 0 8px;">Getting Your Key</h3>
      <ol style="padding-left:20px;color:var(--text-muted);line-height:2;">
        <li>Log in to your dashboard</li>
        <li>Go to <b>Settings → Sandbox API</b></li>
        <li>Click <b>"Generate API Key"</b></li>
        <li>Copy the key (shown once — store it securely)</li>
      </ol>
    </div>`;
}

function renderRegister(el) {
  el.innerHTML = `
    <div class="card" style="max-width:800px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Register Product (Good/Service)</h2>
      <p style="color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        Register a product in URA's goods registry before it can appear on a fiscal invoice.
        Mirrors <code>POST /{TIN}/register-good-or-service</code> from EFRIS Simplified.
      </p>

      <h3 style="font-size:15px;margin:20px 0 8px;">Endpoint</h3>
      <div style="background:var(--surface-2);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:13px;margin-bottom:16px;">
        <span style="color:var(--success);font-weight:600;">POST</span> /{TIN}/register-good-or-service
      </div>

      <h3 style="font-size:15px;margin:20px 0 8px;">Request Body</h3>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;overflow-x:auto;">{
  "goods": [{
    "operationType": "101",        // "101" = new, "102" = update
    "goodsName": "Product Name",
    "goodsCode": "SKU-001",        // unique identifier
    "measureUnit": "101",          // "101" = Pieces
    "unitPrice": "5000",
    "currency": "101",             // "101" = UGX
    "commodityCategoryId": "REQUIRED",
    "haveExciseTax": "102",
    "havePieceUnit": "102",
    "haveCustomsUnit": "102",
    "stockPrewarning": "10"
  }]
}</pre>

      <h3 style="font-size:15px;margin:20px 0 8px;">Success Response</h3>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;">{
  "response": "OK",
  "message": "Product registered successfully"
}</pre>

      <h3 style="font-size:15px;margin:20px 0 8px;">Required Fields</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:2px solid var(--border);text-align:left;">
          <th style="padding:8px;">Field</th><th style="padding:8px;">Type</th><th style="padding:8px;">Description</th>
        </tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">goodsName</td><td>string</td><td>Product name</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">goodsCode</td><td>string</td><td>SKU, barcode, or product ID</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">commodityCategoryId</td><td>string</td><td>EFRIS commodity category (required)</td></tr>
          <tr><td style="padding:8px;font-family:monospace;">operationType</td><td>string</td><td>"101" for new, "102" for update</td></tr>
        </tbody>
      </table>
    </div>`;
}

function renderInvoice(el) {
  el.innerHTML = `
    <div class="card" style="max-width:800px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Generate Fiscal Invoice</h2>
      <p style="color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        Fiscalise an invoice and get a URA-like response with FDN number, anti-fake code, and QR code.
        Mirrors <code>POST /{TIN}/generate-fiscal-invoice</code> from EFRIS Simplified.
      </p>

      <h3 style="font-size:15px;margin:20px 0 8px;">Endpoint</h3>
      <div style="background:var(--surface-2);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:13px;margin-bottom:16px;">
        <span style="color:var(--success);font-weight:600;">POST</span> /{TIN}/generate-fiscal-invoice
      </div>

      <h3 style="font-size:15px;margin:20px 0 8px;">Request Body</h3>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;overflow-x:auto;max-height:400px;overflow-y:auto;">{
  "invoice": {
    "sellerDetails": {
      "tin": "1012345678",
      "legalName": "My Shop Ltd",
      "businessName": "My Shop",
      "emailAddress": "shop@example.com",
      "referenceNo": "INV-000042",
      "isCheckReferenceNo": "0"
    },
    "basicInformation": {
      "invoiceNo": "",
      "antifakeCode": "",
      "deviceNo": "1012345678_01",
      "issuedDate": "2025-01-15 10:30:00",
      "operator": "Cashier",
      "currency": "UGX",
      "invoiceType": "1",     // 1=standard, 2=credit note, 3=debit note
      "invoiceKind": "1",
      "dataSource": "103"
    },
    "buyerDetails": {
      "buyerType": "1",       // "0"=has TIN, "1"=walk-in
      "buyerLegalName": "Walk-in Customer"
    },
    "goodsDetails": [
      {
        "item": "Product Name",
        "itemCode": "SKU-001",
        "qty": "2",
        "unitOfMeasure": "101",
        "unitPrice": "5000",
        "total": "10000",
        "taxRate": "0.18",
        "tax": "1800",
        "orderNumber": "0",
        "discountFlag": "2",
        "deemedFlag": "2",
        "exciseFlag": "2",
        "goodsCategoryId": "1"
      }
    ],
    "taxDetails": [
      {
        "taxCategoryCode": "01",  // 01=VAT, 02=Zero, 03=Exempt, 04=Deemed
        "netAmount": "8200.00",
        "taxRate": "0.18",
        "taxAmount": "1800.00",
        "grossAmount": "10000.00"
      }
    ],
    "summary": {
      "netAmount": "8200.00",
      "taxAmount": "1800.00",
      "grossAmount": "10000.00",
      "itemCount": "1",
      "modeCode": "1",
      "remarks": "Thank you for your business"
    },
    "payWay": [
      { "paymentMode": "102", "paymentAmount": "10000", "orderNumber": "a" }
    ]
  }
}</pre>

      <h3 style="font-size:15px;margin:20px 0 8px;">Success Response</h3>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;">{
  "response": "OK",
  "data": {
    "basicInformation": {
      "invoiceNo": "SFDN-000482",
      "antifakeCode": "SAF3K9xPm2wQ",
      "invoiceId": "a1b2c3d4-e5f6-..."
    },
    "summary": {
      "qrCode": "data:text/plain;base64,..."
    }
  }
}</pre>

      <h3 style="font-size:15px;margin:20px 0 8px;">Tax Category Codes</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:2px solid var(--border);text-align:left;">
          <th style="padding:8px;">Code</th><th style="padding:8px;">Category</th><th style="padding:8px;">Rate</th>
        </tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">01</td><td>VAT / Standard</td><td>18%</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">02</td><td>Zero Rated</td><td>0%</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">03</td><td>Exempt</td><td>-</td></tr>
          <tr><td style="padding:8px;font-family:monospace;">04</td><td>Deemed</td><td>18%</td></tr>
        </tbody>
      </table>

      <h3 style="font-size:15px;margin:20px 0 8px;">Payment Mode Codes</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:2px solid var(--border);text-align:left;">
          <th style="padding:8px;">Code</th><th style="padding:8px;">Method</th>
        </tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">101</td><td>Credit</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">102</td><td>Cash</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">105</td><td>Mobile Money</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">106</td><td>Card</td></tr>
          <tr><td style="padding:8px;font-family:monospace;">107</td><td>Bank Transfer</td></tr>
        </tbody>
      </table>
    </div>`;
}

function renderQuery(el) {
  el.innerHTML = `
    <div class="card" style="max-width:800px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Query Invoices</h2>
      <p style="color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        List or retrieve sandbox invoices generated through your API key.
      </p>

      <h3 style="font-size:15px;margin:20px 0 8px;">List Invoices</h3>
      <div style="background:var(--surface-2);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:13px;margin-bottom:12px;">
        <span style="color:var(--success);font-weight:600;">GET</span> /{TIN}/invoices?limit=50&offset=0&status=accepted
      </div>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;">{
  "invoices": [
    {
      "id": "uuid",
      "tin": "1012345678",
      "fiscal_invoice_number": "SFDN-000482",
      "invoice_type": "1",
      "status": "accepted",
      "gross_amount": 10000,
      "vat_amount": 1800,
      "currency_code": "UGX",
      "created_at": "2025-01-15T10:30:00Z"
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}</pre>

      <h3 style="font-size:15px;margin:20px 0 8px;">Get Single Invoice</h3>
      <div style="background:var(--surface-2);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:13px;margin-bottom:12px;">
        <span style="color:var(--success);font-weight:600;">GET</span> /{TIN}/invoices/{id}
      </div>
      <p style="color:var(--text-muted);font-size:13px;">Returns the full invoice including the original payload and response.</p>
    </div>`;
}

function renderErrors(el) {
  el.innerHTML = `
    <div class="card" style="max-width:800px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Error Codes</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:2px solid var(--border);text-align:left;">
          <th style="padding:8px;">HTTP</th><th style="padding:8px;">Response</th><th style="padding:8px;">Meaning</th>
        </tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">200</td><td style="padding:8px;font-family:monospace;">response: "OK"</td><td>Success</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">200</td><td style="padding:8px;font-family:monospace;">response: "ERROR"</td><td>Simulated rejection (5% chance)</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">400</td><td style="padding:8px;font-family:monospace;">response: "ERROR"</td><td>Invalid payload (missing fields, bad data)</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">401</td><td style="padding:8px;font-family:monospace;">response: "ERROR"</td><td>Missing or invalid API key</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-family:monospace;">404</td><td style="padding:8px;font-family:monospace;">response: "ERROR"</td><td>Unknown endpoint or invoice not found</td></tr>
          <tr><td style="padding:8px;font-family:monospace;">429</td><td style="padding:8px;font-family:monospace;">response: "ERROR"</td><td>Rate limit exceeded — upgrade tier</td></tr>
        </tbody>
      </table>

      <h3 style="font-size:15px;margin:20px 0 8px;">Common Validation Errors</h3>
      <ul style="padding-left:20px;color:var(--text-muted);line-height:2;font-size:13px;">
        <li><code>Missing sellerDetails.tin</code> — TIN is required</li>
        <li><code>Missing basicInformation.deviceNo</code> — device number is required</li>
        <li><code>goodsDetails must be a non-empty array</code> — at least one item needed</li>
        <li><code>goodsDetails[0].qty must be > 0</code> — quantity must be positive</li>
        <li><code>summary.grossAmount must be > 0</code> — total must be positive</li>
        <li><code>goods must be a non-empty array</code> — register at least one product</li>
      </ul>
    </div>`;
}

function renderLimits(el) {
  el.innerHTML = `
    <div class="card" style="max-width:800px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Rate Limits</h2>
      <p style="color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        Limits are enforced per API key. Upgrade your tier for higher limits.
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:2px solid var(--border);text-align:left;">
          <th style="padding:8px;">Tier</th><th style="padding:8px;">Requests / Hour</th><th style="padding:8px;">Invoices / Day</th><th style="padding:8px;">Price</th>
        </tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;"><span class="badge badge-gray">Free</span></td><td style="padding:8px;">100</td><td style="padding:8px;">100</td><td style="padding:8px;">Free</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;"><span class="badge badge-blue">Starter</span></td><td style="padding:8px;">500</td><td style="padding:8px;">5,000</td><td style="padding:8px;">50,000 UGX/mo</td></tr>
          <tr><td style="padding:8px;"><span class="badge badge-green">Pro</span></td><td style="padding:8px;">2,000</td><td style="padding:8px;">50,000</td><td style="padding:8px;">150,000 UGX/mo</td></tr>
        </tbody>
      </table>

      <h3 style="font-size:15px;margin:20px 0 8px;">Rate Limit Response</h3>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;">{
  "response": "ERROR",
  "message": "Rate limit exceeded (100 req/hr). Upgrade your tier for higher limits."
}</pre>
      <p style="color:var(--text-muted);font-size:13px;margin-top:8px;">HTTP Status: 429</p>
    </div>`;
}

function renderTryIt(el) {
  el.innerHTML = `
    <div class="card" style="max-width:800px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Try It</h2>
      <p style="color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        Test the sandbox API directly from here. Enter your API key and TIN to send a test invoice.
      </p>

      <div class="field">
        <label>API Key</label>
        <input id="try-api-key" placeholder="sbx_..." style="width:100%;font-family:monospace;" />
      </div>
      <div class="field">
        <label>Business TIN</label>
        <input id="try-tin" placeholder="1012345678" value="1012345678" style="width:100%;" />
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button class="btn btn-primary" id="try-send">Send Test Invoice</button>
        <button class="btn btn-secondary" id="try-health">Health Check</button>
      </div>
      <div id="try-result" style="display:none;">
        <h3 style="font-size:14px;margin:0 0 8px;">Response</h3>
        <pre id="try-result-pre" style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12px;max-height:300px;overflow:auto;"></pre>
      </div>
    </div>`;

  $("try-send")?.addEventListener("click", async () => {
    const key = $("try-api-key")?.value?.trim();
    const tin = $("try-tin")?.value?.trim();
    if (!key || !tin) { toast("Enter API key and TIN", "error"); return; }

    const baseUrl = `${window.location.origin}/functions/v1/efris-sandbox-api`;
    try {
      const res = await fetch(`${baseUrl}/${tin}/generate-fiscal-invoice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice: {
            sellerDetails: { tin, legalName: "Test Business", businessName: "Test" },
            basicInformation: { invoiceNo: "", antifakeCode: "", deviceNo: `${tin}_01`, issuedDate: new Date().toISOString().replace("T", " ").slice(0, 19), operator: "Test", currency: "UGX", invoiceType: "1", invoiceKind: "1", dataSource: "103" },
            buyerDetails: { buyerType: "1", buyerLegalName: "Walk-in" },
            goodsDetails: [{ item: "Test Product", itemCode: "TEST-001", qty: "1", unitOfMeasure: "101", unitPrice: "10000", total: "10000", taxRate: "0.18", tax: "1800", orderNumber: "0", discountFlag: "2", deemedFlag: "2", exciseFlag: "2", goodsCategoryId: "1" }],
            taxDetails: [{ taxCategoryCode: "01", netAmount: "8200.00", taxRate: "0.18", taxAmount: "1800.00", grossAmount: "10000.00" }],
            summary: { netAmount: "8200.00", taxAmount: "1800.00", grossAmount: "10000.00", itemCount: "1", modeCode: "1", remarks: "Test" },
            payWay: [{ paymentMode: "102", paymentAmount: "10000", orderNumber: "a" }],
          },
        }),
      });
      const data = await res.json();
      $("try-result").style.display = "block";
      $("try-result-pre").textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      $("try-result").style.display = "block";
      $("try-result-pre").textContent = `Error: ${e.message}`;
    }
  });

  $("try-health")?.addEventListener("click", async () => {
    const key = $("try-api-key")?.value?.trim();
    if (!key) { toast("Enter API key", "error"); return; }
    const baseUrl = `${window.location.origin}/functions/v1/efris-sandbox-api`;
    try {
      const res = await fetch(`${baseUrl}/`, { headers: { Authorization: `Bearer ${key}` } });
      const data = await res.json();
      $("try-result").style.display = "block";
      $("try-result-pre").textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      $("try-result").style.display = "block";
      $("try-result-pre").textContent = `Error: ${e.message}`;
    }
  });
}

async function openGetKeyModal() {
  const { data: keys } = await supabase
    .from("sandbox_api_keys")
    .select("id, label, tier, api_key_prefix, is_active, created_at")
    .eq("business_id", STATE.business.id)
    .order("created_at", { ascending: false });

  const existingKeys = keys || [];

  openModal(`
    <div class="modal-title-row"><h3>Sandbox API Keys</h3></div>
    ${existingKeys.length ? `
      <div style="margin-bottom:16px;">
        ${existingKeys.map((k) => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;">${escapeHtml(k.label || "Unnamed Key")}</div>
              <div style="font-family:monospace;font-size:11px;color:var(--text-muted);">${escapeHtml(k.api_key_prefix)}</div>
              <div style="font-size:11px;color:var(--text-muted);">${k.tier} tier · ${k.is_active ? "Active" : "Inactive"}</div>
            </div>
          </div>
        `).join("")}
      </div>
    ` : '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px;">No API keys yet. Generate one below.</p>'}
    <div class="field">
      <label>Key Label</label>
      <input id="new-key-label" placeholder="e.g. My ERP Integration" style="width:100%;" />
    </div>
    <button class="btn btn-primary btn-block" id="generate-key-btn">Generate New API Key</button>
    <button class="btn btn-secondary btn-block" data-close-modal style="margin-top:8px;">Close</button>
  `, { large: true });

  $("generate-key-btn")?.addEventListener("click", async () => {
    const label = $("new-key-label")?.value?.trim() || "Unnamed";
    const { data, error } = await supabase.rpc("create_sandbox_api_key", {
      p_business_id: STATE.business.id,
      p_label: label,
    });
    if (error) { toast("Failed: " + error.message, "error"); return; }
    openModal(`
      <div class="modal-title-row"><h3>API Key Generated</h3></div>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px;">Copy this key now — it will not be shown again.</p>
      <div style="background:var(--surface-2);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:12px;word-break:break-all;margin-bottom:16px;">${escapeHtml(data)}</div>
      <button class="btn btn-primary btn-block" id="copy-new-key">Copy Key</button>
      <button class="btn btn-secondary btn-block" data-close-modal style="margin-top:8px;">Done</button>
    `);
    $("copy-new-key")?.addEventListener("click", () => {
      navigator.clipboard.writeText(data);
      toast("API key copied", "success", 2000);
    });
  });
}
