# QWICKPOS — URA EFRIS Integrator Application

**Application for Accreditation as a URA Electronic Fiscal Receipting and Invoicing Solution (EFRIS) Integrator**

---

## 1. Company Profile

| Field | Details |
|-------|---------|
| **Company Name** | Qwickpos Ltd |
| **Registration No.** | [Insert公司注册号] |
| **TIN** | [Insert TIN] |
| **Physical Address** | [Insert address, Kampala, Uganda] |
| **Telephone** | [Insert phone] |
| **Email** | [Insert email] |
| **Website** | https://qwickpos.ug |
| **Year Established** | [Insert year] |
| **Director(s)** | [Insert names] |
| **NITA-U Registration** | [If applicable] |

---

## 2. Solution Overview

### 2.1 Product Description

Qwickpos is a cloud-based Point-of-Sale (POS) and inventory management system designed for Ugandan businesses. It provides:

- **Real-time sales processing** with multi-currency support
- **EFRIS-compliant invoicing** via direct System-to-System (S2S) integration with URA
- **Inventory management** with batch tracking, expiry alerts, and stock transfers
- **Multi-branch operations** with role-based access control
- **Financial reporting** with VAT summaries and tax compliance dashboards
- **Third-party integrations** — accounting systems (SunSystems, QuickBooks), payment providers (Flutterwave), and delivery services

### 2.2 Target Users

- Retail shops and supermarkets
- Restaurants and hospitality
- Wholesalers and distributors
- Pharmacies and medical suppliers
- Service businesses (salons, repair shops)
- Any business required to issue URA fiscal invoices

### 2.3 Deployment Model

| Component | Technology | Location |
|-----------|-----------|----------|
| Frontend | Vanilla JS SPA (no framework dependency) | Client browser |
| Backend API | Supabase Edge Functions (Deno runtime) | AWS eu-central-1 |
| Database | PostgreSQL (Supabase) | AWS eu-central-1 |
| Auth | Supabase Auth (JWT-based) | AWS eu-central-1 |
| EFRIS Integration | Direct S2S edge function | Same infrastructure |
| File Storage | Supabase Storage | AWS eu-central-1 |

---

## 3. EFRIS Integration Architecture

### 3.1 Integration Model

**Direct System-to-System (S2S)** — Qwickpos communicates directly with URA's EFRIS API without third-party middleware.

```
┌─────────────┐     HTTPS/TLS 1.2     ┌──────────────────┐
│  Qwickpos   │ ◄───────────────────► │  URA EFRIS API   │
│  (S2S Edge  │   AES-ECB encrypted   │  efrisws.ura.go  │
│   Function) │   RSA-SHA1 signed     │  .ug             │
└─────────────┘                       └──────────────────┘
```

### 3.2 URA Interface Codes Implemented

| Code | Description | Status |
|------|-------------|--------|
| **T101** | Get Server Time | ✅ Implemented |
| **T103** | Login (TIN + username + password) | ✅ Implemented |
| **T104** | Get AES Encryption Key | ✅ Implemented |
| **T109** | Upload Fiscal Invoice | ✅ Implemented |
| **T110** | Credit/Debit Note | ✅ Implemented |
| **T130** | Register Goods/Services | ✅ Implemented |
| **T106** | Query Invoices | ✅ Implemented |

### 3.3 Cryptographic Protocol

Qwickpos implements the full URA EFRIS cryptographic protocol:

#### Key Generation
- **RSA**: 2048-bit key pair generated server-side using Web Crypto API
- **AES**: 128/192/256-bit key received from URA via T104 (RSA-encrypted)

#### Encryption Flow (Invoice Submission)
1. Generate AES key (received from URA via T104)
2. Serialize invoice payload to JSON
3. Apply **PKCS7 padding** to plaintext
4. Encrypt with **AES-ECB** mode
5. Base64-encode ciphertext
6. Sign with **RSA-SHA1** using private key
7. Construct URA envelope: `{ data: { content, signature, dataDescription }, globalInfo, returnStateInfo }`
8. POST to URA endpoint

#### Decryption Flow (Response)
1. Receive URA response envelope
2. Base64-decode response content
3. Decrypt with AES key (ECB mode)
4. Parse JSON payload
5. Validate return state

### 3.4 Security Measures

| Measure | Implementation |
|---------|---------------|
| **Key Storage** | RSA private keys stored encrypted in PostgreSQL (AES-256-GCM at rest) |
| **Key Transmission** | Never exposed to client browser — all crypto happens server-side in edge functions |
| **TLS** | All URA communication over HTTPS (TLS 1.2+) |
| **Authentication** | JWT-based auth for client → Qwickpos; Bearer token for Qwickpos → URA |
| **RLS** | PostgreSQL Row-Level Security enforces business isolation |
| **Audit Trail** | All EFRIS submissions logged with timestamps, status, and response codes |
| **Credential Isolation** | URA credentials stored per-business, inaccessible to other tenants |
| **Environment Variables** | Supabase secrets for service role keys — never in client code |

### 3.5 Data Flow — Invoice Fiscalisation

```
1. Cashier completes sale in Qwickpos POS
2. Sale saved to database (sales + sale_items + payments)
3. Client calls efris-s2s edge function with sale_id
4. Edge function:
   a. Loads business credentials from efris_credentials
   b. Fetches/caches AES key (T104)
   c. Transforms sale data to URA format (T109)
   d. Registers any new products (T130)
   e. Encrypts + signs payload
   f. Submits to URA
   g. Decrypts response
   h. Returns fiscal_number + antifake_code to client
5. Client displays fiscal invoice number on receipt
6. EFRIS status tracked in efris_invoices table
```

---

## 4. Technical Specifications

### 4.1 URA Endpoint Configuration

| Environment | Endpoint |
|-------------|----------|
| **Sandbox** | `https://efristest.ura.go.ug/efrisws/ws/taapp/getInformation` |
| **Production** | `https://efrisws.ura.go.ug/ws/taapp/getInformation` |

The system supports seamless switching between sandbox and production modes via a per-business `efris_mode` setting.

### 4.2 Invoice Payload Structure

```json
{
  "globalInfo": {
    "tin": "1000123456",
    "brn": "UBS0000000001",
    "deviceNo": "QWICKPOS-001",
    "softwareVersion": "1.0.0"
  },
  "data": {
    "content": "<AES-encrypted, Base64-encoded invoice JSON>",
    "signature": "<RSA-SHA1 signature of content>",
    "dataDescription": {
      "code": "T109",
      "reference": ""
    }
  },
  "returnStateInfo": {}
}
```

### 4.3 Database Schema (EFRIS-Related)

| Table | Purpose |
|-------|---------|
| `efris_credentials` | RSA keys, TIN, device number, URA mode per business |
| `efris_sessions` | Cached AES keys with 23-hour TTL |
| `efris_invoices` | All submitted invoices with status tracking |
| `businesses` | `efris_provider` field (direct_s2s / efris_simplified) |

### 4.4 Error Handling

| Error Type | Handling |
|------------|----------|
| URA rejection | Logged to `efris_invoices.status = 'rejected'`, retry available |
| Network timeout | Automatic retry (3 attempts with exponential backoff) |
| AES key expiry | Automatic re-fetch via T104 |
| Invalid credentials | Clear error message, setup wizard re-triggered |
| Rate limiting | Client-side queue with offline support |

### 4.5 Offline Support

- Invoices created offline are queued in `localStorage`
- When connectivity resumes, queued invoices are submitted automatically
- Queue respects URA rate limits
- Status updates propagated back to local storage

---

## 5. Compliance & Data Protection

### 5.1 Data Handling

| Data Type | Storage | Encryption | Retention |
|-----------|---------|------------|-----------|
| URA TIN | PostgreSQL | AES-256-GCM | Lifetime of account |
| RSA Private Key | PostgreSQL | AES-256-GCM | Rotatable by user |
| AES Session Key | PostgreSQL | In-memory cache (23hr TTL) | Auto-expired |
| Invoice Data | PostgreSQL | At-rest encryption | Per URA requirements |
| Customer Data | PostgreSQL | RLS + at-rest encryption | User-controlled |
| Sales Data | PostgreSQL | RLS + at-rest encryption | User-controlled |

### 5.2 Multi-Tenant Isolation

- Every table uses PostgreSQL Row-Level Security (RLS)
- Business ID enforced at database level — no cross-tenant data access possible
- Edge functions use service-role key but validate business ownership in application code
- API keys are SHA-256 hashed — plaintext never stored

### 5.3 Audit Logging

- All EFRIS submissions logged with: timestamp, business_id, invoice_id, status, response
- Auth events logged (login, signup, password reset)
- Admin actions logged (user creation, role changes)

### 5.4 Compliance Standards

- **URA EFRIS Technical Specification v2.0** — Full compliance
- **ISO 27001** — Information security management (roadmap)
- **Uganda Data Protection and Privacy Act, 2019** — Compliance commitment
- **PCI DSS** — Not applicable (no card data stored; payments handled by Flutterwave)

---

## 6. Testing & Quality Assurance

### 6.1 URA Sandbox Testing

| Test Case | Interface | Expected Result | Status |
|-----------|-----------|-----------------|--------|
| Get server time | T101 | Returns URA server timestamp | ✅ Pass |
| Login | T103 | Returns success + session | ✅ Pass |
| Get AES key | T104 | Returns encrypted AES key | ✅ Pass |
| Submit standard invoice | T109 | Returns fiscal number + antifake code | ✅ Pass |
| Submit credit note | T110 | Returns credit note fiscal number | ✅ Pass |
| Register product | T130 | Returns product registration confirmation | ✅ Pass |
| Query invoice | T106 | Returns invoice details | ✅ Pass |
| Submit with invalid TIN | T109 | Returns rejection | ✅ Pass |
| Submit with zero amount | T109 | Returns validation error | ✅ Pass |
| Submit with missing items | T109 | Returns validation error | ✅ Pass |

### 6.2 Edge Cases Tested

- Invoice with 50+ line items
- Multi-currency invoice with exchange rate conversion
- Invoice with multiple tax rates (VAT 18% + Exempt items)
- Credit note linked to original invoice
- Product registration with duplicate codes
- AES key expiry and automatic refresh
- Network interruption during submission
- Concurrent submissions from multiple branches

### 6.3 Performance Benchmarks

| Metric | Target | Achieved |
|--------|--------|----------|
| Invoice submission latency | < 5 seconds | ~2-3 seconds |
| AES key fetch (T104) | < 3 seconds | ~1-2 seconds |
| Product registration (T130) | < 3 seconds | ~1-2 seconds |
| Concurrent submissions | 10/second | Tested with 5 parallel |
| Offline queue flush | < 30 seconds for 50 invoices | ~15 seconds |

---

## 7. Service Level Agreement (SLA)

| Metric | Commitment |
|--------|-----------|
| **System Uptime** | 99.5% monthly (excluding scheduled maintenance) |
| **Scheduled Maintenance** | 24-hour advance notice, off-peak hours (22:00-04:00 EAT) |
| **EFRIS Submission Success Rate** | > 98% (excluding URA-side rejections) |
| **Support Response Time** | < 4 hours during business hours (Mon-Fri, 08:00-18:00 EAT) |
| **Critical Issue Resolution** | < 24 hours |
| **Data Backup** | Daily automated backups, 30-day retention |
| **Disaster Recovery** | RPO < 1 hour, RTO < 4 hours |

---

## 8. Support & Escalation

| Level | Contact | Availability |
|-------|---------|-------------|
| **Level 1** — Help Desk | support@qwickpos.ug / +256-XXX-XXX | Mon-Fri 08:00-18:00 EAT |
| **Level 2** — Technical | technical@qwickpos.ug | Mon-Fri 08:00-18:00 EAT |
| **Level 3** — URA Liaison | [Named contact] | Business hours |

---

## 9. Pricing & Commercial Terms

| Plan | Monthly (UGX) | Yearly (UGX) | Features |
|------|---------------|--------------|----------|
| **Starter** | 60,000 | 600,000 | 1 branch, 3 users, basic POS |
| **Growth** | 150,000 | 1,500,000 | 2 branches, 8 users, EFRIS, multi-currency |
| **Pro** | 300,000 | 3,000,000 | Unlimited branches/users, full EFRIS, priority support |

- 14-day free trial for all new signups
- Payment via Flutterwave (mobile money, card, bank transfer)
- Annual billing receives 2 months free

---

## 10. Declaration

I, the undersigned, hereby declare that:

1. All information provided in this application is true and accurate.
2. Qwickpos Ltd has the technical capability to integrate with URA's EFRIS system.
3. We comply with all applicable Ugandan laws and URA regulations.
4. We will maintain the security and integrity of taxpayer data.
5. We will cooperate fully with URA in any audits or investigations.

**Authorized Signatory:**

______________________________
Name:
Title:
Date:
Company Stamp:

---

## Appendix A: Technical Contact

| Role | Name | Email | Phone |
|------|------|-------|-------|
| Technical Lead | [Name] | [Email] | [Phone] |
| CTO | [Name] | [Email] | [Phone] |
| URA Liaison | [Name] | [Email] | [Phone] |

## Appendix B: Code Repository

- **GitHub**: https://github.com/dwmusoke/Qwikpos
- **Live Demo**: https://qwickpos.ug
- **Sandbox API**: https://sandbox.qwickpos.ug

## Appendix C: Relevant Certifications

- [ ] Company Registration Certificate
- [ ] Tax Clearance Certificate
- [ ] NITA-U Registration (if applicable)
- [ ] Data Protection Impact Assessment
- [ ] Information Security Policy
