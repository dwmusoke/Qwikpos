// =====================================================================
// EFRIS S2S LIVE / SANDBOX TEST — run from a terminal (Node 18+)
//
// Sequentially exercises the real URA protocol through the efris-s2s
// edge function:
//     T101  server_time      → URA connectivity
//     T104  get_aes_key      → RSA/AES key exchange (the activation gate)
//     T115  system_dictionary→ prints URA dictionaries (informational)
//     T121  get_exchange_rate→ prints USD rate (informational)
//     T119  query_taxpayer   → buyer TIN validation (B2B, informational)
//     T137  check_taxpayer_type→ exempt/deemed taxpayer check (informational)
//     T123  commodity_categories→ URA commodity categories (informational)
//     T126  all_exchange_rates→ prints all URA rates (informational)
//     T130  upload_goods     → register a test product
//     T109  submit_invoice   → fiscalise a real test invoice
//
// Stops at the first hard failure and prints URA's returnCode/message.
//
// Usage:
//     node docs/efris-s2s-live-test.mjs
//
// Required env:
//     EFRIS_KEY            connector API key (qwk_...) OR a user JWT
//     SELLER_TIN           your 10-digit TIN
//     SELLER_NAME          registered business name
//     SELLER_MOBILE        e.g. +256700000000
//     SELLER_EMAIL         valid email
//     DEVICE_NO            your registered URA device number
//
// Optional env:
//     EFRIS_URL            default https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-s2s
//     CREDENTIAL_ID        omit to use the business's active credential
//     SELLER_ADDRESS       default "Kampala"
//     GOODS_CODE           default "TEST-001"
//     GOODS_NAME           default "Test Product"
//
// TIP: currency/unit/commodity codes below come from the T115/T123
// dictionaries URA returns. Run the test once, read the dictionary
// output, and adjust the constants if URA rejects them.
// =====================================================================

const EFRIS_URL = process.env.EFRIS_URL || "https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-s2s";
const EFRIS_KEY = process.env.EFRIS_KEY || "";
const CREDENTIAL_ID = process.env.CREDENTIAL_ID || null;

const SELLER = {
  tin: process.env.SELLER_TIN || "",
  legalName: process.env.SELLER_NAME || "",
  address: process.env.SELLER_ADDRESS || "Kampala",
  mobilePhone: process.env.SELLER_MOBILE || "",
  emailAddress: process.env.SELLER_EMAIL || "",
};
const DEVICE_NO = process.env.DEVICE_NO || "";
const GOODS_CODE = process.env.GOODS_CODE || "TEST-001";
const GOODS_NAME = process.env.GOODS_NAME || "Test Product";

// ──────────────────────────────────────────────────────────────────────

let failures = 0;

function line(s = "") { console.log(s); }
function pass(step) { line(`  ✅ PASS  ${step}`); }
function info(step) { line(`  ℹ️  INFO  ${step}`); }
function fail(step, detail) {
  failures++;
  line(`  ❌ FAIL  ${step}`);
  if (detail) line(`           ${String(detail).slice(0, 2000)}`);
}

async function call(action, payload = {}) {
  const body = { action, payload };
  if (CREDENTIAL_ID) body.credential_id = CREDENTIAL_ID;
  const res = await fetch(EFRIS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${EFRIS_KEY}`,
    },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); } catch { data = { raw: await res.text() }; }
  return { status: res.status, data };
}

function describe(d) {
  const rc = d?.returnCode;
  const rm = d?.returnMessage || d?.error;
  if (rc || rm) return `returnCode=${rc} returnMessage=${rm}`;
  return JSON.stringify(d);
}

function requireEnv() {
  const missing = [];
  if (!EFRIS_KEY) missing.push("EFRIS_KEY");
  if (!SELLER.tin) missing.push("SELLER_TIN");
  if (!SELLER.legalName) missing.push("SELLER_NAME");
  if (!SELLER.mobilePhone) missing.push("SELLER_MOBILE");
  if (!SELLER.emailAddress) missing.push("SELLER_EMAIL");
  if (!DEVICE_NO) missing.push("DEVICE_NO");
  if (missing.length) {
    line(`❌ Missing required env: ${missing.join(", ")}`);
    line(`   Example (PowerShell): $env:EFRIS_KEY="qwk_..."; $env:SELLER_TIN="..."; $env:SELLER_NAME="..."; $env:SELLER_MOBILE="+256..."; $env:SELLER_EMAIL="..."; $env:DEVICE_NO="..."`);
    process.exit(1);
  }
}

// ── T101: server time ────────────────────────────────────────────────
async function testServerTime() {
  line("═══ T101  Server Time ═══");
  const { status, data } = await call("server_time");
  if (data?.success) { pass("T101 connectivity OK"); }
  else { fail("T101 server_time", describe(data)); return false; }
  return true;
}

// ── T104: get AES key (the activation gate) ──────────────────────────
async function testGetAesKey() {
  line("═══ T104  Get AES Key ═══");
  const { status, data } = await call("get_aes_key");
  if (data?.aes_key_fetched) { pass(`T104 AES key OK (${data.key_length})`); }
  else {
    fail("T104 get_aes_key", describe(data) || `HTTP ${status}`);
    line("      If you see 'Taxpayer does not exist', the device number + thumbprint");
    line("      is not yet registered/approved on efris.ura.go.ug (Appendix 6).");
    return false;
  }
  return true;
}

// ── T115: system dictionary (informational) ──────────────────────────
async function testDictionary() {
  line("═══ T115  System Dictionary (informational) ═══");
  const { status, data } = await call("system_dictionary");
  if (data?.success) {
    const content = data.data?.content || {};
    const keys = Object.keys(content).filter((k) => Array.isArray(content[k]));
    const counts = keys.map((k) => `${k}:${content[k].length}`).join("  ");
    info(`dictionaries available → ${counts || JSON.stringify(content).slice(0, 200)}`);
    // Show a few currency + unit entries to confirm codes
    const cur = content.currencyList || content.currencies || [];
    const uom = content.unitList || content.units || content.measurementUnits || [];
    if (cur.length) info(`sample currencies → ${cur.slice(0, 3).map((c) => JSON.stringify(c)).join("  ")}`);
    if (uom.length) info(`sample units → ${uom.slice(0, 3).map((c) => JSON.stringify(c)).join("  ")}`);
  } else {
    info(`T115 not required to continue (${describe(data) || `HTTP ${status}`})`);
  }
  return true; // informational only
}

// ── T121: exchange rate (informational) ──────────────────────────────
async function testExchangeRate() {
  line("═══ T121  Exchange Rate (informational) ═══");
  const { status, data } = await call("get_exchange_rate", { currency: "USD" });
  if (data?.success) { info(`USD rate = ${data.rate} (on ${data.date})`); }
  else { info(`T121 skipped (${describe(data) || `HTTP ${status}`})`); }
  return true;
}

// ── T126: all exchange rates (informational) ─────────────────────────
async function testAllExchangeRates() {
  line("═══ T126  All Exchange Rates (informational) ═══");
  const { status, data } = await call("all_exchange_rates");
  if (data?.success) {
    const content = data.data?.content || {};
    const list = content.rates || content.exchangeRateList || content.exchangeRates || [];
    info(`exchange rates → ${Array.isArray(list) ? list.length : "?"} entries`);
    if (Array.isArray(list) && list.length) info(`sample → ${JSON.stringify(list.slice(0, 3))}`);
  } else { info(`T126 skipped (${describe(data) || `HTTP ${status}`})`); }
  return true;
}

// ── T119: query taxpayer (informational, B2B) ────────────────────────
async function testQueryTaxpayer() {
  line("═══ T119  Query Taxpayer (informational) ═══");
  const { status, data } = await call("query_taxpayer", { taxpayerTin: SELLER.tin });
  if (data?.success) {
    const content = data.data?.content || {};
    const name = content.buyerName || content.legalName || content.taxpayerName || "";
    info(`taxpayer ${SELLER.tin} → ${name || "found"}`);
  } else { info(`T119 skipped (${describe(data) || `HTTP ${status}`})`); }
  return true;
}

// ── T137: check exempt/deemed taxpayer (informational) ───────────────
async function testCheckTaxpayerType() {
  line("═══ T137  Check Exempt/Deemed Taxpayer (informational) ═══");
  const { status, data } = await call("check_taxpayer_type", { taxpayerTin: SELLER.tin });
  if (data?.success) {
    const content = data.data?.content || {};
    const exempt = content.exemptFlag ?? content.isExempt ?? content.exempt;
    info(`taxpayer ${SELLER.tin} → exempt=${exempt ?? "unknown"} ${JSON.stringify(content).slice(0, 200)}`);
  } else { info(`T137 skipped (${describe(data) || `HTTP ${status}`})`); }
  return true;
}

// ── T123: commodity categories (informational) ───────────────────────
async function testCommodityCategories() {
  line("═══ T123  Commodity Categories (informational) ═══");
  const { status, data } = await call("commodity_categories", { pageNo: 1, pageSize: 5 });
  if (data?.success) {
    const content = data.data?.content || {};
    const list = content.commodityCategoryList || content.categoryList || content.list || [];
    info(`commodity categories → ${Array.isArray(list) ? list.length : "?"} entries`);
    if (Array.isArray(list) && list.length) info(`sample → ${JSON.stringify(list.slice(0, 2))}`);
  } else { info(`T123 skipped (${describe(data) || `HTTP ${status}`})`); }
  return true;
}

// ── T130: register goods ─────────────────────────────────────────────
async function testUploadGoods() {
  line("═══ T130  Upload Goods ═══");
  const goods = [{
    operationType: "101",
    goodsName: GOODS_NAME,
    goodsCode: GOODS_CODE,
    measureUnit: "101",          // from T115 (adjust if rejected)
    unitPrice: "10000",
    currency: "UGX",             // URA may expect a numeric code from T115
    commodityCategoryId: "100000000", // from T115/T123 dictionary
    haveExciseTax: "102",
    havePieceUnit: "102",
    haveCustomsUnit: "102",
    stockPrewarning: "0",
  }];
  const { status, data } = await call("upload_goods", { goods });
  if (data?.success) { pass("T130 goods registered"); }
  else { fail("T130 upload_goods", describe(data) || `HTTP ${status}`); return false; }
  return true;
}

// ── T109: submit a test invoice (URA direct format) ──────────────────
function buildInvoice() {
  const gross = "11800.00";
  const tax = "1800.00";
  const net = "10000.00";
  return {
    sellerDetails: {
      tin: SELLER.tin,
      legalName: SELLER.legalName,
      businessName: SELLER.legalName,
      address: SELLER.address,
      mobilePhone: SELLER.mobilePhone,
      emailAddress: SELLER.emailAddress,
      placeOfBusiness: SELLER.address,
      referenceNo: `TEST-INV-${Date.now()}`,
      isCheckReferenceNo: "0",
    },
    basicInformation: {
      deviceNo: DEVICE_NO,
      issuedDate: new Date().toISOString().slice(0, 19).replace("T", " "),
      operator: "Test Cashier",
      currency: "UGX",
      invoiceType: "1",
      invoiceKind: "1",
      dataSource: "103",
      invoiceIndustryCode: "101",
    },
    buyerDetails: {
      buyerTin: SELLER.tin,
      buyerLegalName: "Test Customer",
      buyerType: "0",
      buyerSector: "Private",
    },
    goodsDetails: [{
      item: GOODS_NAME,
      itemCode: GOODS_CODE,
      qty: "1",
      unitOfMeasure: "101",         // from T115
      unitPrice: net,
      total: net,
      taxRate: "0.18",
      tax,
      goodsCategoryId: "100000000", // from T115/T123
      vatApplicableFlag: "1",
      discountFlag: "2",
      deemedFlag: "2",
      exciseFlag: "2",
    }],
    taxDetails: [{
      taxCategoryCode: "01",
      netAmount: net,
      taxRate: "0.18",
      taxAmount: tax,
      grossAmount: gross,
      taxRateName: "Standard",
    }],
    summary: {
      netAmount: net,
      taxAmount: tax,
      grossAmount: gross,
      itemCount: 1,
      modeCode: "1",
      remarks: "EFRIS integration test",
    },
    payWay: [{
      paymentMode: "102",          // cash
      paymentAmount: gross,
      orderNumber: "a",
    }],
  };
}

async function testSubmitInvoice() {
  line("═══ T109  Submit Invoice ═══");
  const invoice = buildInvoice();
  const { status, data } = await call("submit_invoice", invoice);
  if (data?.success) {
    const content = data.data?.content || data.data;
    const bi = content.basicInformation || {};
    pass(`T109 invoice fiscalised → invoiceNo=${bi.invoiceNo} antifake=${bi.antifakeCode}`);
    if (content.summary?.qrCode) info("QR code returned (printable on receipt)");
  } else {
    fail("T109 submit_invoice", describe(data) || `HTTP ${status}`);
    return false;
  }
  return true;
}

// ── Runner ───────────────────────────────────────────────────────────
async function main() {
  requireEnv();
  line("");
  line("🚀 EFRIS S2S test — " + EFRIS_URL);
  line(`   TIN: ${SELLER.tin} | Device: ${DEVICE_NO}`);
  line("");

  if (!(await testServerTime())) { summary(); process.exit(1); }
  if (!(await testGetAesKey())) { summary(); process.exit(1); }
  await testDictionary();
  await testExchangeRate();
  await testAllExchangeRates();
  await testQueryTaxpayer();
  await testCheckTaxpayerType();
  await testCommodityCategories();
  if (!(await testUploadGoods())) { summary(); process.exit(1); }
  if (!(await testSubmitInvoice())) { summary(); process.exit(1); }

  line("");
  line("🎉 All hard checks passed — S2S integration is working.");
  summary();
}

function summary() {
  line("");
  line("────────────────────────────────────────────");
  line(failures === 0 ? "RESULT: ALL CHECKS PASSED" : `RESULT: ${failures} CHECK(S) FAILED`);
  line("────────────────────────────────────────────");
}

await main();
