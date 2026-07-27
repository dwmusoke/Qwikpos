# SunSystems ↔ EFRIS Integration Guide

**For SunSystems developers integrating with the Qwickpos EFRIS Sandbox API.**

---

## Overview

The Qwickpos EFRIS Sandbox API is a mock URA EFRIS endpoint that lets you test fiscal invoice submission from **any** accounting system — including Infor SunSystems — without needing a real URA account.

This guide covers:
1. API authentication and endpoints
2. Invoice payload format (EFRIS Simplified)
3. SunSystems data mapping
4. Python connector script usage
5. Going production (real URA EFRIS)

---

## 1. Getting Started

### Sign up for a Sandbox API Key

Visit **https://sandbox.qwickpos.ug** and register a vendor account. You'll receive:
- An **API key** (shown once — save it)
- A **tier** (Free: 100 req/hr, Starter: 500, Pro: 2000)

### Base URL

```
POST https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-sandbox-api
```

### Authentication

Every request requires a Bearer token:

```
Authorization: Bearer <your_api_key>
Content-Type: application/json
```

---

## 2. API Endpoints

### Health Check

```
GET /
```

Response:
```json
{
  "service": "EFRIS Sandbox API",
  "version": "1.0.0",
  "status": "operational",
  "tier": "free",
  "endpoints": [
    "POST /{TIN}/register-good-or-service",
    "POST /{TIN}/generate-fiscal-invoice",
    "GET  /{TIN}/invoices",
    "GET  /{TIN}/invoices/{id}"
  ]
}
```

### Register Product

```
POST /{TIN}/register-good-or-service
```

Register products before invoicing (optional in sandbox, required in production).

**Request:**
```json
{
  "goods": [
    {
      "goodsName": "Office Paper A4",
      "goodsCode": "ITEM-001",
      "commodityCategoryId": "1",
      "unitPrice": "25000",
      "measurementUnit": "Ream"
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `goodsName` | Yes | Product/service name |
| `goodsCode` | Yes | Your internal SKU/item code |
| `commodityCategoryId` | Yes | `1` = Goods, `2` = Services, `3` = Both |
| `unitPrice` | No | Default unit price (string) |
| `measurementUnit` | No | e.g. "Unit", "Kg", "Ream" |

**Response (success):**
```json
{ "response": "OK", "message": "Product registered successfully" }
```

**Response (error):**
```json
{ "response": "ERROR", "message": "goodsName is required" }
```

### Submit Fiscal Invoice

```
POST /{TIN}/generate-fiscal-invoice
```

The main endpoint. Submit an invoice for fiscalisation.

**Request:**
```json
{
  "invoice": {
    "sellerDetails": {
      "tin": "1000123456",
      "legalName": "My Business Ltd"
    },
    "buyerDetails": {
      "tin": "",
      "legalName": "Walk-in Customer"
    },
    "basicInformation": {
      "deviceNo": "SUN-POS-001",
      "invoiceType": "1",
      "currency": "UGX",
      "invoiceDate": "2025-07-15T10:30:00",
      "invoiceNumber": "INV-2025-001234"
    },
    "goodsDetails": [
      {
        "item": "Office Paper A4",
        "itemCode": "ITEM-001",
        "qty": "5",
        "unitPrice": "25000",
        "netAmount": "125000",
        "taxAmount": "22500",
        "grossAmount": "147500",
        "commodityCategoryId": "1",
        "measurementUnit": "Ream"
      },
      {
        "item": "Toner Cartridge",
        "itemCode": "ITEM-002",
        "qty": "2",
        "unitPrice": "150000",
        "netAmount": "300000",
        "taxAmount": "54000",
        "grossAmount": "354000",
        "commodityCategoryId": "1",
        "measurementUnit": "Unit"
      }
    ],
    "taxDetails": [
      {
        "taxCode": "VAT18",
        "taxableAmount": "425000",
        "taxAmount": "76500",
        "taxRate": "18"
      }
    ],
    "paymentDetails": [
      {
        "method": "1",
        "amount": "501500"
      }
    ],
    "summary": {
      "grossAmount": "501500",
      "taxAmount": "76500",
      "netAmount": "425000"
    }
  }
}
```

#### Field Reference

##### sellerDetails
| Field | Required | Description |
|-------|----------|-------------|
| `tin` | Yes | Your URA TIN (10 digits) |
| `legalName` | Yes | Registered business name |

##### buyerDetails
| Field | Required | Description |
|-------|----------|-------------|
| `tin` | No | Buyer's TIN (empty string for walk-in) |
| `legalName` | No | Buyer name (defaults to "Walk-in Customer") |

##### basicInformation
| Field | Required | Description |
|-------|----------|-------------|
| `deviceNo` | Yes | Your POS/device identifier |
| `invoiceType` | Yes | `1` = Standard, `2` = Debit Note, `3` = Credit Note |
| `currency` | Yes | ISO 4217 code: `UGX`, `USD`, `KES`, `GBP`, `EUR` |
| `invoiceDate` | No | ISO 8601 datetime |
| `invoiceNumber` | No | Your internal invoice number |

##### goodsDetails[]
| Field | Required | Description |
|-------|----------|-------------|
| `item` | Yes | Product/service name |
| `itemCode` | No | Your SKU code |
| `qty` | Yes | Quantity (string, > 0) |
| `unitPrice` | Yes | Unit price (string, > 0) |
| `netAmount` | No | qty × unitPrice |
| `taxAmount` | No | Tax on this line |
| `grossAmount` | No | netAmount + taxAmount |
| `commodityCategoryId` | No | `1` = Goods, `2` = Services, `3` = Both |
| `measurementUnit` | No | "Unit", "Kg", "Litre", etc. |

##### taxDetails[]
| Field | Required | Description |
|-------|----------|-------------|
| `taxCode` | Yes | e.g. "VAT18", "EXEMPT", "ZERO" |
| `taxableAmount` | Yes | Amount subject to this tax rate |
| `taxAmount` | Yes | Tax amount |
| `taxRate` | No | Rate as string, e.g. "18" |

##### paymentDetails[]
| Field | Required | Description |
|-------|----------|-------------|
| `method` | Yes | `1`=Cash, `2`=Card, `3`=Mobile, `4`=Bank, `5`=Credit, `6`=Cheque, `7`=Other |
| `amount` | Yes | Payment amount (can split across methods) |

##### summary
| Field | Required | Description |
|-------|----------|-------------|
| `grossAmount` | Yes | Total (must be > 0) |
| `taxAmount` | Yes | Total tax |
| `netAmount` | Yes | Total before tax |

**Response (success):**
```json
{
  "response": "OK",
  "data": {
    "basicInformation": {
      "invoiceNo": "SFDN-000123",
      "antifakeCode": "SAFXXXXXXXXXX",
      "invoiceId": "uuid-string"
    },
    "summary": {
      "qrCode": "data:text/plain;base64,VVJB..."
    }
  }
}
```

The `invoiceNo` is the URA fiscal invoice number. The `qrCode` contains the fiscal data for printing on receipts.

**Response (rejected):**
```json
{
  "response": "ERROR",
  "message": "Simulated rejection: verify buyer TIN and retry"
}
```

> **Note:** The sandbox simulates ~5% random rejection for realism. Handle retries in production.

### List Invoices

```
GET /{TIN}/invoices?limit=50&offset=0&status=accepted
```

| Param | Description |
|-------|-------------|
| `limit` | Max results (default 50, max 200) |
| `offset` | Pagination offset |
| `status` | Filter: `accepted`, `rejected` |

### Get Invoice Detail

```
GET /{TIN}/invoices/{invoice_id}
```

Returns the full invoice record stored in the sandbox.

---

## 3. SunSystems Data Mapping

### Table Mapping

| SunSystems Table | EFRIS Field |
|------------------|-------------|
| `SL_INVOICES.INVOICE_NO` | `basicInformation.invoiceNumber` |
| `SL_INVOICES.INVOICE_DATE` | `basicInformation.invoiceDate` |
| `SL_INVOICES.GROSS_TOTAL` | `summary.grossAmount` |
| `SL_INVOICES.TAX_TOTAL` | `summary.taxAmount` |
| `SL_INVOICES.NET_TOTAL` | `summary.netAmount` |
| `SL_INVOICES.CURRENCY_CODE` | `basicInformation.currency` |
| `SL_CUSTOMER.TAX_ID` | `buyerDetails.tin` |
| `SL_CUSTOMER.CUSTOMER_NAME` | `buyerDetails.legalName` |
| `SL_INVOICE_DETAIL.ITEM_CODE` | `goodsDetails[].itemCode` |
| `SL_INVOICE_DETAIL.DESCRIPTION` | `goodsDetails[].item` |
| `SL_INVOICE_DETAIL.QUANTITY` | `goodsDetails[].qty` |
| `SL_INVOICE_DETAIL.UNIT_PRICE` | `goodsDetails[].unitPrice` |
| `SL_INVOICE_DETAIL.NET_AMOUNT` | `goodsDetails[].netAmount` |
| `SL_INVOICE_DETAIL.TAX_AMOUNT` | `goodsDetails[].taxAmount` |
| `SL_INVOICE_DETAIL.TAX_RATE` | Used to compute `taxDetails[].taxRate` |

### SunSystems v5 vs v6 vs Cloud

Column names may vary by version. Common differences:

| Field | v5.x | v6.x / Cloud |
|-------|------|-------------|
| Customer TIN | `SL_CUSTOMER.TAX_ID` | `SL_CUSTOMER.TAX_REG_NO` |
| Item category | `SL_ITEMS.COMMODITY_CATEGORY` | `SL_ITEMS.ITEM_GROUP` |
| Tax code | `SL_INVOICE_DETAIL.LEDGER_CODE` | `SL_INVOICE_DETAIL.TAX_CODE` |
| Invoice status | `SL_INVOICES.STATUS` = 'P' | `SL_INVOICES.POSTED_FLAG` = 'Y' |

Check your SunSystems data dictionary (`Help → Data Dictionary` in the SunSys desktop) for exact column names.

### Currency Mapping

SunSystems stores currency as ISO 4217 codes, which maps directly to EFRIS:

| SunSystems | EFRIS |
|-----------|-------|
| `UGX` | `UGX` |
| `USD` | `USD` |
| `KES` | `KES` |

> **Note:** EFRIS requires amounts in the local currency. If SunSystems stores USD, you'll need to apply the exchange rate before submitting.

### Tax Code Mapping

| SunSystems Tax Code | EFRIS taxCode |
|---------------------|---------------|
| `VAT18` or `S18` | `VAT18` |
| `VAT0` or `EXEMPT` | `EXEMPT` |
| `ZERO` | `ZERO` |

---

## 4. Python Connector

### Prerequisites

```bash
pip install requests pyodbc
```

### Configure

Set environment variables:

```bash
export EFRIS_SANDBOX_KEY="your_api_key_here"
export EFRIS_SANDBOX_URL="https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-sandbox-api"
export SELLER_TIN="1000123456"
export SELLER_NAME="My Business Ltd"
export DEVICE_NO="SUN-POS-001"
export CURRENCY="UGX"

# SunSystems ODBC
export SUNSYSTEMS_DSN="SunSystems"
export SUNSYSTEMS_USER="sa"
export SUNSYSTEMS_PASS="password"
```

### Run

```bash
# Single sync
python sunsystems-efris-connector.py --once

# Dry run (no actual submission)
python sunsystems-efris-connector.py --once --dry-run

# Continuous daemon (polls every 5 min)
python sunsystems-efris-connector.py --daemon

# Check sandbox connectivity
python sunsystems-efris-connector.py --health

# List submitted invoices
python sunsystems-efris-connector.py --list
```

### How It Works

1. Queries `SL_INVOICES` for posted invoices not yet marked as EFRIS-sent
2. Fetches line items from `SL_INVOICE_DETAIL`
3. Transforms data into EFRIS Simplified JSON format
4. POSTs to the sandbox API
5. On success: marks the invoice in SunSystems (custom column or tracking table)
6. Logs all activity to `efris_connector.log`

### Customization Points

- **ODBC queries** — Adjust SQL to match your SunSystems table/column names
- **Category mapping** — Edit `CATEGORY_MAP` for your product categories
- **Payment methods** — Edit `PAYMENT_METHOD_MAP` for your payment types
- **Marking as sent** — The `mark_as_sent()` method tries a custom column first, falls back to a tracking table
- **Polling interval** — Set `POLL_INTERVAL` env var (default 300 seconds)

---

## 5. Production (Real URA EFRIS)

When ready to go live with real URA EFRIS:

### What Changes

| Feature | Sandbox | Production |
|---------|---------|------------|
| Endpoint | Qwickpos sandbox | `efrisws.ura.go.ug` (prod) |
| Auth | API key | T103 login + T104 AES key exchange |
| Crypto | None | RSA-2048 + AES-ECB + RSA-SHA1 signing |
| Registration | Mock | Real URA product registration (T130) |
| Invoices | Simulated | Real URA fiscalisation (T109) |
| Rejection rate | ~5% random | Real validation |

### Qwickpos Direct S2S

Qwickpos offers a **Direct S2S** integration that handles all URA crypto:

1. Generate RSA key pair (via `efris-setup` edge function)
2. Register with URA (T103 login)
3. Submit invoices via `efris-s2s` edge function (handles T104, T109, signing, encryption)

Your SunSystems connector can target the production edge functions instead of the sandbox:

```python
# Switch to production by changing the base URL
CONFIG["sandbox_base_url"] = "https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-s2s"
```

The payload format is identical — the edge function handles the URA transformation internally.

### Getting a URA EFRIS Account

1. Register at **https://efris.ura.go.ug**
2. Obtain your TIN and device number
3. Generate RSA keys (Qwickpos can do this for you)
4. Complete URA's EFRIS enrollment process

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Missing Authorization header` | No API key | Add `Authorization: Bearer <key>` header |
| `401 Invalid or inactive API key` | Wrong key or account inactive | Check key at sandbox.qwickpos.ug |
| `429 Rate limit exceeded` | Too many requests | Upgrade tier or slow down |
| `400 goodsDetails must be non-empty` | Empty items array | Add at least one line item |
| `400 summary.grossAmount must be > 0` | Zero total | Check invoice amounts |
| `Simulated rejection` | Sandbox randomness | Retry — happens ~5% of the time |
| ODBC connection failed | DSN not configured | Check ODBC Data Sources in Windows |
| `Column not found: EFRIS_SENT` | Custom column missing | Connector auto-creates tracking table |

---

## Support

- **Sandbox issues**: https://sandbox.qwickpos.ug
- **URA EFRIS help**: https://efris.ura.go.ug
- **Qwickpos support**: https://qwickpos.ug/support
