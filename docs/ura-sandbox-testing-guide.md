# URA EFRIS Sandbox Testing Guide

**Step-by-step guide to test your EFRIS integration against URA's sandbox before applying for approval.**

---

## Prerequisites

Before you begin, you need:

1. **URA Sandbox Test Credentials** — Apply at URA's office (Nakawa) or via the taxpayer portal for sandbox/test environment access. URA will provide:
   - Test TIN (e.g. `1012345678`)
   - Test username and password
   - Test device number
   - Test BRN (Business Registration Number)

2. **A Qwickpos account** with a business linked to your login

3. **At least one product** created in Qwickpos with an EFRIS Commodity Category ID set

---

## Step 1: Get URA Sandbox Credentials

### How to Apply

1. **Visit URA Nakawa** or call their EFRIS helpdesk: 0800 217 000
2. Request **EFRIS Sandbox/Test Environment Access** for integration testing
3. You'll receive:
   - **Test TIN** (different from your production TIN)
   - **Username** and **Password** for T103 login
   - **Device Number** (assigned by URA)
   - **BRN** (Business Registration Number)

4. **Important**: Tell URA you're building a POS system and need to test:
   - T101 (Server Time)
   - T103 (Login)
   - T104 (AES Key Exchange)
   - T109 (Invoice Upload)
   - T130 (Product Registration)
   - T106 (Invoice Query)

### What URA Will Ask You

- Company registration documents
- Your TIN
- Description of your software
- Expected volume of invoices
- Technical contact person

---

## Step 2: Set Up Test Credentials in Qwickpos

### Option A: Via Settings UI (Recommended)

1. Log in as **admin** of your business
2. Go to **Settings** → **EFRIS** section
3. Set **EFRIS Mode** to **Sandbox (simulate)**
4. Set **Provider** to **Direct URA S2S (no middleware)**
5. Click **Generate RSA Keys** in the Direct URA S2S Integration card
6. Enter your **sandbox credentials**:
   - TIN: `1012345678` (your test TIN)
   - Device Number: as provided by URA
   - BRN: as provided by URA
   - URA Username: as provided by URA
   - URA Password: as provided by URA
7. Click **Save**

### Option B: Via SQL (Manual)

Run this in the Supabase SQL Editor:

```sql
-- Replace values with your actual URA sandbox credentials
INSERT INTO efris_credentials (
  business_id,
  tin,
  device_number,
  brn,
  ura_username,
  ura_password,
  efris_mode,
  status,
  private_key_pem,
  public_key_pem
) VALUES (
  '<your_business_id>',     -- from businesses table
  '1012345678',             -- your test TIN
  'SFXQPOS-01',             -- device number from URA
  'UBS0000000001',          -- BRN from URA
  'testuser',               -- username from URA
  'testpass123',            -- password from URA
  'sandbox',                -- MUST be 'sandbox' for testing
  'active',
  '-----BEGIN PRIVATE KEY-----\n...(your RSA private key)...\n-----END PRIVATE KEY-----',
  '-----BEGIN PUBLIC KEY-----\n...(your RSA public key)...\n-----END PUBLIC KEY-----'
);
```

---

## Step 3: Generate RSA Keys

If you haven't generated RSA keys yet:

### Via Settings UI
1. Go to Settings → Direct URA S2S Integration
2. Click **Generate RSA Keys**
3. Keys are generated server-side using Web Crypto API
4. Private key is stored encrypted — never shown to you

### Via Edge Function (Manual Test)
```bash
curl -X POST https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-setup \
  -H "Authorization: Bearer <your_supabase_anon_key>" \
  -H "Content-Type: application/json" \
  -H "apikey: <your_supabase_anon_key>" \
  -d '{
    "action": "generate_keys",
    "business_id": "<your_business_id>",
    "tin": "1012345678",
    "device_number": "SFXQPOS-01",
    "brn": "UBS0000000001",
    "ura_username": "testuser",
    "ura_password": "testpass123"
  }'
```

---

## Step 4: Test Each Interface Code

### Test 4.1: T101 — Get Server Time

This verifies basic connectivity to URA.

**Via Edge Function:**
```bash
curl -X POST https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-s2s \
  -H "Authorization: Bearer <your_supabase_anon_key>" \
  -H "Content-Type: application/json" \
  -H "apikey: <your_supabase_anon_key>" \
  -d '{"action": "server_time"}'
```

**Expected Result:**
```json
{
  "success": true,
  "data": "2025-07-15 10:30:45"
}
```

**✅ Pass Criteria:** URA returns a timestamp. This confirms network connectivity and that the test environment is reachable.

---

### Test 4.2: T104 — Get AES Encryption Key

This tests the RSA key exchange. Your private key must decrypt the AES key that URA encrypts with your public key.

**Via Edge Function:**
```bash
curl -X POST https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-s2s \
  -H "Authorization: Bearer <your_supabase_anon_key>" \
  -H "Content-Type: application/json" \
  -H "apikey: <your_supabase_anon_key>" \
  -d '{"action": "get_aes_key"}'
```

**Expected Result:**
```json
{
  "success": true,
  "aes_key_fetched": true,
  "key_length": "128-bit"
}
```

**✅ Pass Criteria:** AES key is successfully fetched and decrypted. This proves your RSA key pair is correct and the crypto implementation works.

**❌ Common Failures:**
- `T104 failed: INVALID_TIN` — TIN doesn't match URA records
- `T104 failed: INVALID_CREDENTIALS` — Wrong username/password
- `Missing AES key in T104 response` — RSA key format issue
- `RSA decrypt failed` — Private key doesn't match public key registered with URA

---

### Test 4.3: T130 — Register a Product

Before submitting invoices, products must be registered with EFRIS.

**Via Edge Function:**
```bash
curl -X POST https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-s2s \
  -H "Authorization: Bearer <your_supabase_anon_key>" \
  -H "Content-Type: application/json" \
  -H "apikey: <your_supabase_anon_key>" \
  -d '{
    "action": "upload_goods",
    "payload": [
      {
        "operationType": "101",
        "goodsName": "Test Product - Soda 500ml",
        "goodsCode": "TEST-SODA-001",
        "measureUnit": "101",
        "unitPrice": "2000",
        "currency": "101",
        "commodityCategoryId": "22021000",
        "haveExciseTax": "102",
        "havePieceUnit": "102",
        "haveCustomsUnit": "102",
        "stockPrewarning": "10"
      }
    ]
  }'
```

**Expected Result:**
```json
{
  "success": true,
  "data": "...",
  "returnMessage": "SUCCESS"
}
```

**✅ Pass Criteria:** Product is registered. The `goodsCode` must be unique.

**❌ Common Failures:**
- `GOODS_ALREADY_EXISTS` — Product with this code already registered (normal)
- `INVALID_COMMODITY_CATEGORY` — Wrong category ID
- `T104 failed` — Run T104 first to get AES key

---

### Test 4.4: T109 — Submit a Test Invoice

This is the critical test — submitting a fiscal invoice to URA.

**Via POS (Recommended):**
1. Create a test sale in Qwickpos POS
2. Add the product you registered in Step 4.3
3. Complete the sale
4. The system should automatically submit to EFRIS
5. Check the EFRIS tab for the fiscal invoice number

**Via Edge Function (Manual):**
```bash
curl -X POST https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-s2s \
  -H "Authorization: Bearer <your_supabase_anon_key>" \
  -H "Content-Type: application/json" \
  -H "apikey: <your_supabase_anon_key>" \
  -d '{
    "action": "submit_invoice",
    "payload": {
      "invoice": {
        "sellerDetails": {
          "tin": "1012345678",
          "legalName": "Test Business Ltd",
          "businessName": "Test Business",
          "emailAddress": "test@example.com",
          "telephoneNo": "+256772000000"
        },
        "basicInformation": {
          "invoiceNo": "",
          "deviceNo": "SFXQPOS-01",
          "issuedDate": "2025-07-15 10:30:00",
          "operator": "admin",
          "currency": "UGX",
          "invoiceType": "1",
          "invoiceKind": "1",
          "dataSource": "103"
        },
        "buyerDetails": {
          "buyerType": "1",
          "buyerLegalName": "Walk-in Customer"
        },
        "goodsDetails": [
          {
            "item": "Test Product - Soda 500ml",
            "itemCode": "TEST-SODA-001",
            "quantity": "2",
            "unitPrice": "2000",
            "totalAmount": "4000",
            "taxRate": "0.18",
            "taxAmount": "720",
            "grossAmount": "4720",
            "commodityCategoryId": "22021000",
            "measurementUnit": "101"
          }
        ],
        "taxDetails": [
          {
            "taxCategoryCode": "01",
            "taxRate": "0.18",
            "grossAmount": "4720",
            "netAmount": "4000",
            "taxAmount": "720"
          }
        ],
        "summary": {
          "netAmount": "4000",
          "taxAmount": "720",
          "grossAmount": "4720",
          "itemCount": "1",
          "modeCode": "1",
          "remarks": "Test invoice for URA sandbox"
        },
        "payWay": [
          {
            "paymentMode": "102",
            "paymentAmount": "4720",
            "orderNumber": "a"
          }
        ]
      }
    }
  }'
```

**Expected Result:**
```json
{
  "success": true,
  "data": "...",
  "returnCode": "...",
  "returnMessage": "SUCCESS"
}
```

**✅ Pass Criteria:** Invoice is accepted and you receive a fiscal invoice number.

**❌ Common Failures:**
- `VERIFY_BUYER_TIN_AND_RETRY` — Buyer TIN issue (use empty for walk-in)
- `INVALID_INVOICE_DATA` — Check all required fields
- `GOODS_NOT_REGISTERED` — Register products first via T130
- `DUPLICATE_INVOICE` — Invoice number already used

---

### Test 4.5: T106 — Query Invoices

Verify that submitted invoices can be queried back.

**Via Edge Function:**
```bash
curl -X POST https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-s2s \
  -H "Authorization: Bearer <your_supabase_anon_key>" \
  -H "Content-Type: application/json" \
  -H "apikey: <your_supabase_anon_key>" \
  -d '{
    "action": "query_invoices",
    "payload": {
      "invoiceNo": "",
      "startDate": "2025-07-01",
      "endDate": "2025-07-31"
    }
  }'
```

**Expected Result:**
```json
{
  "success": true,
  "data": "..."
}
```

**✅ Pass Criteria:** Returns list of submitted invoices with their status.

---

## Step 5: Document Your Results

Create a test results document to include with your URA application:

### Test Results Template

| Test | Interface | Description | Result | Timestamp | Notes |
|------|-----------|-------------|--------|-----------|-------|
| 1 | T101 | Server Time | ✅ Pass | 2025-07-15 10:30 | Returns timestamp |
| 2 | T104 | AES Key Exchange | ✅ Pass | 2025-07-15 10:31 | 128-bit key fetched |
| 3 | T130 | Product Registration | ✅ Pass | 2025-07-15 10:32 | Soda registered |
| 4 | T109 | Invoice Upload | ✅ Pass | 2025-07-15 10:33 | Fiscal # SFDN-000123 |
| 5 | T106 | Invoice Query | ✅ Pass | 2025-07-15 10:34 | Invoice found |

### Screenshots to Take

1. **Settings page** showing sandbox credentials configured
2. **EFRIS tab** showing submitted invoice with fiscal number
3. **Edge function response** for each test (T101, T104, T130, T109, T106)
4. **Product registration** confirmation
5. **Invoice detail** with URA fiscal number and antifake code

---

## Step 6: Submit to URA

Once all tests pass:

1. Fill in the URA application document (`docs/ura-efris-application.md`)
2. Attach test results
3. Include screenshots
4. Submit to URA Nakawa or via the taxpayer portal

### What URA Will Verify

1. Your RSA keys work with their system
2. You can successfully submit invoices
3. Your crypto implementation matches their protocol
4. Your error handling is robust
5. Your data security practices are adequate

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `T104 failed: INVALID_TIN` | TIN not registered in sandbox | Contact URA for test TIN |
| `T104 failed: INVALID_CREDENTIALS` | Wrong username/password | Verify with URA |
| `RSA decrypt failed` | Key mismatch | Regenerate keys, re-register with URA |
| `GOODS_NOT_REGISTERED` | Product not in EFRIS | Run T130 first |
| `VERIFY_BUYER_TIN` | Buyer TIN required | Use walk-in (empty TIN) |
| `DUPLICATE_INVOICE` | Same invoice number | Use unique numbers |
| Network timeout | URA sandbox down | Try again later |
| `502 Bad Gateway` | Edge function error | Check Supabase logs |

---

## Quick Reference: All Test Commands

```bash
# Set these variables
SUPABASE_URL="https://ixntllvgntshbfocwuur.supabase.co"
ANON_KEY="<your_supabase_anon_key>"

# T101: Server Time
curl -X POST $SUPABASE_URL/functions/v1/efris-s2s \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{"action": "server_time"}'

# T104: Get AES Key
curl -X POST $SUPABASE_URL/functions/v1/efris-s2s \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{"action": "get_aes_key"}'

# T130: Register Product
curl -X POST $SUPABASE_URL/functions/v1/efris-s2s \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{"action": "upload_goods", "payload": [{"operationType":"101","goodsName":"Test Soda","goodsCode":"TEST-001","measureUnit":"101","unitPrice":"2000","currency":"101","commodityCategoryId":"22021000","haveExciseTax":"102","havePieceUnit":"102","haveCustomsUnit":"102","stockPrewarning":"10"}]}'

# T109: Submit Invoice (use the full payload from Step 4.4)
curl -X POST $SUPABASE_URL/functions/v1/efris-s2s \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{"action": "submit_invoice", "payload": {...}}'

# T106: Query Invoices
curl -X POST $SUPABASE_URL/functions/v1/efris-s2s \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{"action": "query_invoices", "payload": {"startDate":"2025-07-01","endDate":"2025-07-31"}}'
```
