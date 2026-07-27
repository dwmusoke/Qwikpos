# EFRIS Integrator Sandbox Access Request Letter

---

**[YOUR COMPANY NAME]**
[Company Address Line 1]
[Company Address Line 2]
[City, Uganda]
Tel: [Your Phone Number]
Email: [Your Email]
TIN: [Your Company TIN]

**Date:** ___________________

**The Commissioner,**
**Uganda Revenue Authority,**
**EFRIS Integration Division,**
**Nakawa, Kampala, Uganda.**

---

**RE: REQUEST FOR EFRIS SANDBOX / TEST ENVIRONMENT ACCESS — SYSTEM-TO-SYSTEM (S2S) INTEGRATION**

---

Dear Sir/Madam,

We, **[YOUR COMPANY NAME]**, a registered tax agent and certified EFRIS integrator applicant, write to respectfully request for **sandbox (test) environment access** to the Uganda Revenue Authority Electronic Fiscal Receipt and Invoicing System (EFRIS) for the purpose of testing our System-to-System (S2S) integration prior to production deployment.

### 1. ABOUT THE APPLICANT

| Field | Details |
|---|---|
| Company Name | [YOUR COMPANY NAME] |
| TIN | [YOUR 10-DIGIT TIN] |
| Registration No. | [COMPANY REGISTRATION NUMBER] |
| Authorized Signatory | [NAME OF DIRECTOR/AUTHORIZED PERSON] |
| National ID No. | [NATIONAL ID NUMBER] |
| Contact Phone | [PHONE NUMBER] |
| Email Address | [EMAIL ADDRESS] |

### 2. INTEGRATION OVERVIEW

Our platform, **QwickPOS**, is a cloud-based Point-of-Sale system designed for Ugandan businesses. We are seeking EFRIS integrator approval to enable our clients to:

- Generate and submit electronic fiscal invoices directly to URA
- Register products and commodity codes via the EFRIS product registration interface
- Query invoice status and fiscal numbers in real-time
- Issue credit notes and manage invoice corrections
- Comply fully with the VAT Electronic Fiscal Receipting and Invoicing regulations

### 3. TECHNICAL ARCHITECTURE

| Component | Details |
|---|---|
| Integration Type | **Direct System-to-System (S2S)** — No third-party middleware |
| Endpoint | `https://efristest.ura.go.ug/efrisws/ws/taapp/getInformation` (sandbox) |
| Authentication | RSA-2048 key pair with AES-256 encryption |
| Digital Signature | RSA-SHA1 |
| Protocol | SOAP/XML over HTTPS |
| Platform | Supabase Edge Functions (Deno runtime) |
| Interface Codes | T101 (Server Time), T104 (AES Key), T106 (Query), T109 (Submit Invoice), T130 (Product Registration) |

### 4. WHAT WE ARE REQUESTING

We kindly request URA to provide the following for sandbox testing:

1. **Test TIN** — A sandbox taxpayer identification number for test transactions
2. **Test Device Number** — A registered device number for the sandbox environment
3. **Sandbox Digital Certificate** — So that URA can recognize and validate our RSA public key
4. **Sandbox API Credentials** — Username and password for authentication with the test endpoint

### 5. TEST PLAN

Upon receiving sandbox access, we will execute the following test sequence:

| Step | Interface Code | Description |
|---|---|---|
| 1 | T101 | Verify connectivity — obtain server time |
| 2 | T104 | Obtain and decrypt AES encryption key using our RSA private key |
| 3 | T130 | Register a test product (UOM, commodity code, tax category) |
| 4 | T109 | Submit a test invoice with fiscal data |
| 5 | T106 | Query invoice status and retrieve fiscal number |
| 6 | T110 | Issue a credit note against the test invoice |
| 7 | T108 | Retrieve invoice details |

### 6. COMPLIANCE & SECURITY

- All RSA private keys are stored server-side and **never exposed to client browsers**
- AES encryption follows the URA-specified ECB mode with PKCS7 padding
- Digital signatures are applied to all outbound requests using RSA-SHA1
- All communication is over HTTPS with TLS 1.2+
- We comply with the **Data Protection and Privacy Act, 2019** of Uganda
- Our system supports both sandbox and production modes with a single configuration switch

### 7. DOCUMENTS ATTACHED

1. Certificate of Incorporation
2. TIN Certificate
3. National ID / Passport of Authorized Signatory
4. Technical Integration Document (EFRIS S2S Architecture)
5. This request letter

---

We are committed to full compliance with URA's EFRIS requirements and look forward to a successful integration. We are available for any technical discussions or demonstrations as required.

Thank you for your consideration.

---

**Yours faithfully,**

___________________________
**[AUTHORIZED SIGNATORY NAME]**
[Title / Position]
[YOUR COMPANY NAME]

---

**For URA Use Only**

| Field | Details |
|---|---|
| Received by | |
| Date received | |
| Sandbox TIN assigned | |
| Device Number assigned | |
| Certificate issued | ☐ Yes  ☐ No |
| Remarks | |

---

*This document was prepared for submission to Uganda Revenue Authority, Nakawa office.*
*For questions, contact: [YOUR PHONE NUMBER] / [YOUR EMAIL]*
