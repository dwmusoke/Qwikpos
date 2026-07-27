// =====================================================================
// EFRIS S2S TEST SCRIPT — Run in browser console at qwikpos.com/app
//
// Tests the S2S edge function against URA sandbox.
// Prerequisites:
//   1. You're logged in
//   2. You have at least one credential in Settings → Direct URA S2S
// =====================================================================

const SUPABASE_URL = "https://ixntllvgntshbfocwuur.supabase.co";

async function testEfrisS2S(action, payload = {}, credentialId = null) {
  const body = { action, payload };
  if (credentialId) body.credential_id = credentialId;

  console.log(`\n🔧 Testing: ${action}`, payload ? JSON.stringify(payload, null, 2) : "");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/efris-s2s`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4bnRsbHZnbnRzaGJmb2N3dXVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MTczMjUsImV4cCI6MjEwMDI5MzMyNX0.-UnMGcxju5wgSol35U9dP8sI4e9qSiAosFGfgeprSaM"
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log(`📡 Response (${res.status}):`, JSON.stringify(data, null, 2));
  return data;
}

// ── Test 1: Check connectivity (T101) ──
async function testServerTime(credentialId) {
  return testEfrisS2S("server_time", {}, credentialId);
}

// ── Test 2: Fetch AES key (T104) ──
async function testGetAesKey(credentialId) {
  return testEfrisS2S("get_aes_key", {}, credentialId);
}

// ── Test 3: Submit test invoice (T109) ──
async function testSubmitInvoice(credentialId) {
  const testInvoice = {
    invoice: {
      sellerDetails: {
        tin: "1000000000",  // Replace with your test TIN
        legalName: "TEST BUSINESS",
        mobilePhone: "+256700000000",
      },
      basicInformation: {
        deviceNo: "1",
        currency: "101",  // UGX
        invoiceType: "111",  // Normal invoice
        invoiceNumber: "TEST-INV-" + Date.now(),
        dateOfSupply: new Date().toISOString().slice(0, 10),
        operatorName: "Test Cashier",
        operatorMobile: "+256700000000",
        customerTin: "1000000000",
        customerName: "Test Customer",
        customerMobile: "+256700000000",
      },
      goodsDetails: [
        {
          item: 1,
          goodsName: "Test Product",
          goodsCode: "TEST-001",
          qty: 1,
          unitPrice: 10000,
          discount: 0,
          taxabilityType: "1",
          taxCategoryCode: "1",
          taxRate: 18,
        }
      ],
      taxDetails: [
        { taxCategoryCode: "1", taxRate: 18, taxAmount: 1800 }
      ],
      summary: {
        grossAmount: 10000,
        netAmount: 10000,
        taxAmount: 1800,
        discountAmount: 0,
        totalAmount: 11800,
      },
    },
  };

  return testEfrisS2S("submit_invoice", testInvoice, credentialId);
}

// ── Test 4: Register test product (T130) ──
async function testUploadGoods(credentialId) {
  const goods = [{
    operationType: "101",
    goodsName: "Test Product",
    goodsCode: "TEST-001",
    measureUnit: "101",
    unitPrice: "10000",
    currency: "101",
    commodityCategoryId: "049",  // General goods
    haveExciseTax: "102",
    havePieceUnit: "102",
    haveCustomsUnit: "102",
    stockPrewarning: "0",
  }];

  return testEfrisS2S("upload_goods", { goods }, credentialId);
}

// ── Run all tests sequentially ──
async function runAllTests(credentialId) {
  console.log("🚀 Starting EFRIS S2S Integration Tests...\n");

  console.log("═══ TEST 1: Server Time (T101) ═══");
  const t1 = await testServerTime(credentialId);
  if (!t1.success) { console.error("❌ T101 failed. Check credentials and connectivity."); return; }
  console.log("✅ T101 passed!\n");

  console.log("═══ TEST 2: Get AES Key (T104) ═══");
  const t2 = await testGetAesKey(credentialId);
  if (!t2.success) { console.error("❌ T104 failed. TIN/device may be invalid for sandbox."); return; }
  console.log("✅ T104 passed!\n");

  console.log("═══ TEST 3: Upload Goods (T130) ═══");
  const t3 = await testUploadGoods(credentialId);
  if (!t3.success) { console.error("❌ T130 failed:", t3.error); return; }
  console.log("✅ T130 passed!\n");

  console.log("═══ TEST 4: Submit Invoice (T109) ═══");
  const t4 = await testSubmitInvoice(credentialId);
  if (!t4.success) { console.error("❌ T109 failed:", t4.error); return; }
  console.log("✅ T109 passed!\n");

  console.log("🎉 All tests passed! Your S2S integration is working.");
}

// ── How to use ──
// 1. Log into qwikpos.com/app
// 2. Open browser console (F12)
// 3. Paste this entire script
// 4. Get your credential ID from Settings → Direct URA S2S (or check browser Network tab)
// 5. Run: runAllTests("YOUR_CREDENTIAL_ID")
//
// Quick individual tests:
//   testServerTime()      — T101 (no credentials needed for connectivity)
//   testGetAesKey("ID")   — T104 (needs valid sandbox credentials)
//   testUploadGoods("ID") — T130 (needs valid sandbox credentials)
//   testSubmitInvoice("ID") — T109 (needs valid sandbox credentials)

console.log("📋 EFRIS S2S Test Script loaded.");
console.log("Run: testServerTime() to check connectivity");
console.log("Run: runAllTests(\"credential_id\") to run all tests");
