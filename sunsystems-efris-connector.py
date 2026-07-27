"""
SunSystems → EFRIS Sandbox Connector
=====================================
Extracts invoices from Infor SunSystems (via ODBC) and submits them
to the Qwickpos EFRIS Sandbox API for testing.

Requirements:
    pip install requests pyodbc

Configuration:
    1. Set environment variables (or edit CONFIG below)
    2. Ensure SunSystems ODBC DSN is configured (SQL Server or Oracle)
    3. Run: python sunsystems-efris-connector.py

SunSystems Tables Used:
    SL_INVOICES        — Invoice header (invoice_no, customer, dates, totals)
    SL_INVOICE_DETAIL  — Invoice line items (item, qty, price, tax)
    SL_CUSTOMER        — Customer master (tin, name, address)
    SL_ITEMS           — Item master (code, name, category)
    SL_LEDGER_CODE     — Tax codes / VAT rates

This connector maps SunSystems data to the EFRIS Simplified invoice format:
    POST /{TIN}/generate-fiscal-invoice
    POST /{TIN}/register-good-or-service

Author: Qwickpos Team
License: MIT
"""

import os
import sys
import json
import time
import logging
import hashlib
from datetime import datetime, timedelta
from typing import Optional

import requests
import pyodbc

# ──────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ──────────────────────────────────────────────────────────────────────

CONFIG = {
    # Qwickpos EFRIS Sandbox
    "sandbox_base_url": os.getenv("EFRIS_SANDBOX_URL", "https://ixntllvgntshbfocwuur.supabase.co/functions/v1/efris-sandbox-api"),
    "api_key": os.getenv("EFRIS_SANDBOX_KEY", ""),

    # Business identity
    "seller_tin": os.getenv("SELLER_TIN", ""),          # e.g. "1000123456"
    "seller_name": os.getenv("SELLER_NAME", ""),        # e.g. "My Business Ltd"
    "device_no": os.getenv("DEVICE_NO", "SUN-POS-001"),
    "currency": os.getenv("CURRENCY", "UGX"),

    # SunSystems ODBC
    "odbc_dsn": os.getenv("SUNSYSTEMS_DSN", "SunSystems"),
    "odbc_user": os.getenv("SUNSYSTEMS_USER", "sa"),
    "odbc_pass": os.getenv("SUNSYSTEMS_PASS", ""),

    # Behavior
    "batch_size": int(os.getenv("BATCH_SIZE", "50")),
    "retry_attempts": 3,
    "retry_delay_sec": 2,
    "poll_interval_sec": int(os.getenv("POLL_INTERVAL", "300")),
    "dry_run": os.getenv("DRY_RUN", "false").lower() == "true",
    "log_file": os.getenv("LOG_FILE", "efris_connector.log"),
}

# ──────────────────────────────────────────────────────────────────────
# LOGGING
# ──────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(CONFIG["log_file"], encoding="utf-8"),
    ],
)
log = logging.getLogger("efris-connector")


# ──────────────────────────────────────────────────────────────────────
# SUNSYSTEMS DATABASE LAYER
# ──────────────────────────────────────────────────────────────────────

class SunSystemsDB:
    """ODBC connection wrapper for SunSystems database."""

    def __init__(self):
        conn_str = (
            f"DSN={CONFIG['odbc_dsn']};"
            f"UID={CONFIG['odbc_user']};"
            f"PWD={CONFIG['odbc_pass']};"
        )
        log.info(f"Connecting to SunSystems via ODBC: DSN={CONFIG['odbc_dsn']}")
        self.conn = pyodbc.connect(conn_str)
        self.conn.autocommit = True

    def close(self):
        self.conn.close()

    def get_unsent_invoices(self, limit: int = 50) -> list[dict]:
        """
        Query SunSystems for invoices not yet submitted to EFRIS.

        Adjust the WHERE clause to match your SunSystems setup:
        - SL_INVOICES.STATUS = 'P' means posted/ finalized
        - You may have a custom EFRIS_SENT flag column
        - Or use a separate tracking table

        Table: SL_INVOICES
        Columns vary by SunSystems version (v5.x, v6.x, Cloud).
        This uses common v5/v6 column names.
        """
        sql = """
            SELECT TOP (?)
                i.INVOICE_NO,
                i.INVOICE_DATE,
                i.DUE_DATE,
                i.CUSTOMER_CODE,
                i.NET_TOTAL,
                i.TAX_TOTAL,
                i.GROSS_TOTAL,
                i.CURRENCY_CODE,
                i.TAX_RATE,
                i.LEDGER_CODE        AS tax_code,
                i.Narrative          AS reference,
                c.CUSTOMER_NAME,
                c.TAX_ID            AS customer_tin,
                c.ADDRESS_1,
                c.ADDRESS_2,
                c.CITY,
                c.COUNTRY
            FROM SL_INVOICES i
            LEFT JOIN SL_CUSTOMER c ON i.CUSTOMER_CODE = c.CUSTOMER_CODE
            WHERE i.STATUS = 'P'
              AND i.INVOICE_TYPE = 'INV'
              AND (i.EFRIS_SENT IS NULL OR i.EFRIS_SENT = 0)
            ORDER BY i.INVOICE_DATE ASC
        """
        cursor = self.conn.cursor()
        cursor.execute(sql, limit)
        columns = [desc[0].lower() for desc in cursor.description]
        rows = []
        for row in cursor.fetchall():
            rows.append(dict(zip(columns, [self._convert_val(v) for v in row])))
        return rows

    def get_invoice_items(self, invoice_no: str) -> list[dict]:
        """Get line items for a specific invoice."""
        sql = """
            SELECT
                d.ITEM_CODE,
                d.DESCRIPTION       AS item_name,
                d.QUANTITY,
                d.UNIT_PRICE,
                d.NET_AMOUNT,
                d.TAX_AMOUNT,
                d.GROSS_AMOUNT,
                d.TAX_RATE,
                d.LEDGER_CODE       AS tax_code,
                i.COMMODITY_CATEGORY AS category_id
            FROM SL_INVOICE_DETAIL d
            LEFT JOIN SL_ITEMS i ON d.ITEM_CODE = i.ITEM_CODE
            WHERE d.INVOICE_NO = ?
            ORDER BY d.LINE_NO ASC
        """
        cursor = self.conn.cursor()
        cursor.execute(sql, invoice_no)
        columns = [desc[0].lower() for desc in cursor.description]
        rows = []
        for row in cursor.fetchall():
            rows.append(dict(zip(columns, [self._convert_val(v) for v in row])))
        return rows

    def mark_as_sent(self, invoice_no: str, efris_invoice_id: str, fiscal_number: str):
        """
        Mark invoice as EFRIS-submitted in SunSystems.

        Option A: Update a custom column on SL_INVOICES
        Option B: Insert into a tracking table (recommended)
        """
        try:
            cursor = self.conn.cursor()
            # Option A — custom column (add EFRIS_SENT, EFRIS_FISCAL_NO to SL_INVOICES)
            cursor.execute("""
                UPDATE SL_INVOICES
                SET EFRIS_SENT = 1,
                    EFRIS_FISCAL_NO = ?,
                    EFRIS_SUBMITTED_AT = GETDATE()
                WHERE INVOICE_NO = ?
            """, fiscal_number, invoice_no)
            log.info(f"Marked {invoice_no} as sent (fiscal: {fiscal_number})")
        except pyodbc.Error as e:
            # If custom columns don't exist, fall back to tracking table
            log.warning(f"Custom columns not found, using tracking table: {e}")
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM SYS.TABLES WHERE NAME = 'EFRIS_SUBMISSIONS')
                BEGIN
                    CREATE TABLE EFRIS_SUBMISSIONS (
                        INVOICE_NO    NVARCHAR(50) PRIMARY KEY,
                        EFRIS_ID      NVARCHAR(100),
                        FISCAL_NO     NVARCHAR(50),
                        STATUS        NVARCHAR(20),
                        SUBMITTED_AT  DATETIME DEFAULT GETDATE()
                    )
                END
            """)
            cursor.execute("""
                INSERT INTO EFRIS_SUBMISSIONS (INVOICE_NO, EFRIS_ID, FISCAL_NO, STATUS)
                VALUES (?, ?, ?, 'accepted')
            """, invoice_no, efris_invoice_id, fiscal_number)

    @staticmethod
    def _convert_val(v):
        """Convert DB values to JSON-serializable types."""
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, bytes):
            return v.hex()
        return v


# ──────────────────────────────────────────────────────────────────────
# EFRIS SANDBOX CLIENT
# ──────────────────────────────────────────────────────────────────────

class EfrisSandboxClient:
    """HTTP client for the Qwickpos EFRIS Sandbox API."""

    def __init__(self):
        self.base_url = CONFIG["sandbox_base_url"].rstrip("/")
        self.api_key = CONFIG["api_key"]
        self.tin = CONFIG["seller_tin"]
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        })

    def health_check(self) -> dict:
        """GET / — verify connectivity and API key."""
        resp = self.session.get(f"{self.base_url}/")
        resp.raise_for_status()
        return resp.json()

    def register_product(self, product: dict) -> dict:
        """
        POST /{TIN}/register-good-or-service

        Product payload:
        {
            "goods": [{
                "goodsName": "Widget A",
                "goodsCode": "WID-001",
                "commodityCategoryId": "3",  // URA category: 1=Goods, 2=Services, 3=Both
                "unitPrice": 25000,
                "measurementUnit": "Unit"
            }]
        }
        """
        url = f"{self.base_url}/{self.tin}/register-good-or-service"
        resp = self.session.post(url, json=product)
        resp.raise_for_status()
        return resp.json()

    def submit_invoice(self, invoice_payload: dict, retries: int = 3) -> dict:
        """
        POST /{TIN}/generate-fiscal-invoice

        Returns:
            {"response": "OK", "data": {...}} on success
            {"response": "ERROR", "message": "..."} on failure
        """
        url = f"{self.base_url}/{self.tin}/generate-fiscal-invoice"

        for attempt in range(1, retries + 1):
            try:
                resp = self.session.post(url, json=invoice_payload, timeout=30)
                resp.raise_for_status()
                result = resp.json()

                if result.get("response") == "OK":
                    return result

                # Rejected by sandbox — don't retry validation errors
                log.warning(f"Sandbox rejected (attempt {attempt}): {result.get('message')}")
                if "missing" in result.get("message", "").lower() or "required" in result.get("message", "").lower():
                    return result  # Don't retry validation errors
                if attempt < retries:
                    time.sleep(CONFIG["retry_delay_sec"])
                    continue
                return result

            except requests.exceptions.RequestException as e:
                log.error(f"HTTP error (attempt {attempt}): {e}")
                if attempt < retries:
                    time.sleep(CONFIG["retry_delay_sec"])
                    continue
                raise

    def list_invoices(self, status: Optional[str] = None, limit: int = 50) -> dict:
        """GET /{TIN}/invoices — list submitted invoices."""
        url = f"{self.base_url}/{self.tin}/invoices"
        params = {"limit": limit}
        if status:
            params["status"] = status
        resp = self.session.get(url, params=params)
        resp.raise_for_status()
        return resp.json()


# ──────────────────────────────────────────────────────────────────────
# PAYLOAD TRANSFORMER
# ──────────────────────────────────────────────────────────────────────

# URA EFRIS Simplified commodity categories
# 1 = Goods, 2 = Services, 3 = Both
CATEGORY_MAP = {
    "GOODS": "1",
    "SERVICE": "2",
    "BOTH": "3",
    "PRODUCT": "1",
    "LABOR": "2",
    # Add your SunSystems category mappings here
}

# URA payment method codes
PAYMENT_METHOD_MAP = {
    "CASH": "1",
    "CARD": "2",
    "MOBILE": "3",
    "BANK_TRANSFER": "4",
    "CREDIT": "5",
    "CHEQUE": "6",
    "OTHER": "7",
}


def transform_invoice(sun_invoice: dict, items: list[dict]) -> dict:
    """
    Transform SunSystems invoice + items into EFRIS Simplified format.

    EFRIS Simplified payload structure:
    {
        "invoice": {
            "sellerDetails": { "tin", "legalName" },
            "buyerDetails": { "tin", "legalName" },
            "basicInformation": { "deviceNo", "invoiceType", "currency" },
            "goodsDetails": [ { "item", "itemCode", "qty", "unitPrice", ... } ],
            "taxDetails": [ { "taxCode", "taxableAmount", "taxAmount" } ],
            "paymentDetails": [ { "method", "amount" } ],
            "summary": { "grossAmount", "taxAmount", "netAmount" }
        }
    }
    """
    seller_tin = CONFIG["seller_tin"]
    seller_name = CONFIG["seller_name"]
    currency = CONFIG["currency"]

    # Buyer info
    buyer_tin = sun_invoice.get("customer_tin") or ""
    buyer_name = sun_invoice.get("customer_name") or "Walk-in Customer"

    # Build line items
    goods_details = []
    total_net = 0
    total_tax = 0
    total_gross = 0
    tax_details_map = {}  # tax_code -> { taxable, tax_amount }

    for item in items:
        qty = float(item.get("quantity", 1))
        unit_price = float(item.get("unit_price", 0))
        net = float(item.get("net_amount", qty * unit_price))
        tax = float(item.get("tax_amount", 0))
        gross = float(item.get("gross_amount", net + tax))
        tax_rate = float(item.get("tax_rate", 0))

        total_net += net
        total_tax += tax
        total_gross += gross

        # Group tax by code
        tax_code = item.get("tax_code") or f"VAT{int(tax_rate)}" if tax_rate else "EXEMPT"
        if tax_code not in tax_details_map:
            tax_details_map[tax_code] = {"taxable": 0, "tax_amount": 0}
        tax_details_map[tax_code]["taxable"] += net
        tax_details_map[tax_code]["tax_amount"] += tax

        # Commodity category
        raw_cat = (item.get("category_id") or "").upper()
        commodity_cat = CATEGORY_MAP.get(raw_cat, "1")  # Default: Goods

        goods_details.append({
            "item": str(item.get("item_name", item.get("item_code", "Item"))),
            "itemCode": str(item.get("item_code", "")),
            "qty": str(int(qty)) if qty == int(qty) else str(qty),
            "unitPrice": str(round(unit_price, 2)),
            "netAmount": str(round(net, 2)),
            "taxAmount": str(round(tax, 2)),
            "grossAmount": str(round(gross, 2)),
            "commodityCategoryId": commodity_cat,
            "measurementUnit": "Unit",
        })

    # Build tax details array
    tax_details = []
    for code, amounts in tax_details_map.items():
        tax_details.append({
            "taxCode": code,
            "taxableAmount": str(round(amounts["taxable"], 2)),
            "taxAmount": str(round(amounts["tax_amount"], 2)),
            "taxRate": code.replace("VAT", "") if code.startswith("VAT") else "0",
        })

    # Invoice type: 1 = Standard, 2 = Debit Note, 3 = Credit Note
    inv_type = "1"

    # Payment method — default to CASH, adjust based on SunSystems data
    payment_method = PAYMENT_METHOD_MAP.get(
        str(sun_invoice.get("payment_method", "CASH")).upper(), "1"
    )

    payload = {
        "invoice": {
            "sellerDetails": {
                "tin": seller_tin,
                "legalName": seller_name,
            },
            "buyerDetails": {
                "tin": buyer_tin,
                "legalName": buyer_name,
            },
            "basicInformation": {
                "deviceNo": CONFIG["device_no"],
                "invoiceType": inv_type,
                "currency": currency,
                "invoiceDate": sun_invoice.get("invoice_date", datetime.now().isoformat()),
                "invoiceNumber": str(sun_invoice.get("invoice_no", "")),
            },
            "goodsDetails": goods_details,
            "taxDetails": tax_details,
            "paymentDetails": [{
                "method": payment_method,
                "amount": str(round(total_gross, 2)),
            }],
            "summary": {
                "grossAmount": str(round(total_gross, 2)),
                "taxAmount": str(round(total_tax, 2)),
                "netAmount": str(round(total_net, 2)),
            },
        }
    }

    return payload


def transform_product(item: dict) -> dict:
    """Transform a SunSystems item into EFRIS product registration payload."""
    raw_cat = (item.get("category_id") or "").upper()
    commodity_cat = CATEGORY_MAP.get(raw_cat, "1")

    return {
        "goods": [{
            "goodsName": str(item.get("item_name", item.get("item_code", ""))),
            "goodsCode": str(item.get("item_code", "")),
            "commodityCategoryId": commodity_cat,
            "unitPrice": str(float(item.get("unit_price", 0))),
            "measurementUnit": "Unit",
        }]
    }


# ──────────────────────────────────────────────────────────────────────
# SYNC ENGINE
# ──────────────────────────────────────────────────────────────────────

class EfrisSyncEngine:
    """Orchestrates the SunSystems → EFRIS sync."""

    def __init__(self):
        self.db = SunSystemsDB()
        self.client = EfrisSandboxClient()
        self.stats = {
            "submitted": 0,
            "accepted": 0,
            "rejected": 0,
            "errors": 0,
            "skipped": 0,
        }

    def run_sync(self):
        """One-shot sync: pull unsent invoices and submit."""
        log.info("=" * 60)
        log.info("EFRIS Sync started")
        log.info(f"Seller TIN: {CONFIG['seller_tin']}")
        log.info(f"Dry run: {CONFIG['dry_run']}")
        log.info("=" * 60)

        # Health check
        try:
            health = self.client.health_check()
            log.info(f"Sandbox status: {health.get('status')} | Tier: {health.get('tier')}")
        except Exception as e:
            log.error(f"Sandbox health check failed: {e}")
            return

        # Pull invoices
        invoices = self.db.get_unsent_invoices(limit=CONFIG["batch_size"])
        log.info(f"Found {len(invoices)} unsent invoices")

        if not invoices:
            log.info("Nothing to sync.")
            return

        for inv in invoices:
            inv_no = inv.get("invoice_no", "?")
            try:
                self._process_invoice(inv)
            except Exception as e:
                log.error(f"Failed to process {inv_no}: {e}")
                self.stats["errors"] += 1

        # Summary
        log.info("=" * 60)
        log.info("Sync complete")
        log.info(f"  Submitted: {self.stats['submitted']}")
        log.info(f"  Accepted:  {self.stats['accepted']}")
        log.info(f"  Rejected:  {self.stats['rejected']}")
        log.info(f"  Errors:    {self.stats['errors']}")
        log.info(f"  Skipped:   {self.stats['skipped']}")
        log.info("=" * 60)

    def _process_invoice(self, inv: dict):
        """Submit a single invoice."""
        inv_no = inv.get("invoice_no", "")
        log.info(f"Processing invoice: {inv_no}")

        # Get line items
        items = self.db.get_invoice_items(inv_no)
        if not items:
            log.warning(f"No line items for {inv_no}, skipping")
            self.stats["skipped"] += 1
            return

        # Transform to EFRIS format
        payload = transform_invoice(inv, items)

        if CONFIG["dry_run"]:
            log.info(f"[DRY RUN] Would submit {inv_no} with {len(items)} items")
            log.debug(json.dumps(payload, indent=2))
            self.stats["submitted"] += 1
            return

        # Submit
        result = self.client.submit_invoice(payload, retries=CONFIG["retry_attempts"])
        self.stats["submitted"] += 1

        if result.get("response") == "OK":
            data = result.get("data", {})
            fiscal_no = data.get("basicInformation", {}).get("invoiceNo", "")
            efris_id = data.get("basicInformation", {}).get("invoiceId", "")
            log.info(f"  ✅ Accepted — Fiscal: {fiscal_no}")

            # Mark in SunSystems
            self.db.mark_as_sent(inv_no, efris_id, fiscal_no)
            self.stats["accepted"] += 1
        else:
            msg = result.get("message", "Unknown error")
            log.warning(f"  ❌ Rejected — {msg}")
            self.stats["rejected"] += 1

    def run_daemon(self):
        """Continuous polling loop."""
        log.info(f"Starting daemon mode (poll every {CONFIG['poll_interval_sec']}s)")
        while True:
            try:
                self.run_sync()
            except KeyboardInterrupt:
                log.info("Interrupted, shutting down")
                break
            except Exception as e:
                log.error(f"Sync cycle failed: {e}")

            log.info(f"Next sync in {CONFIG['poll_interval_sec']}s...")
            time.sleep(CONFIG["poll_interval_sec"])

    def close(self):
        self.db.close()


# ──────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="SunSystems → EFRIS Sandbox Connector")
    parser.add_argument("--once", action="store_true", help="Run single sync then exit")
    parser.add_argument("--daemon", action="store_true", help="Run continuously (default)")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually submit to sandbox")
    parser.add_argument("--health", action="store_true", help="Check sandbox connectivity only")
    parser.add_argument("--list", action="store_true", help="List previously submitted invoices")
    parser.add_argument("--batch", type=int, default=50, help="Max invoices per sync cycle")
    args = parser.parse_args()

    if args.dry_run:
        CONFIG["dry_run"] = True
    if args.batch:
        CONFIG["batch_size"] = args.batch

    # Validate config
    missing = []
    if not CONFIG["api_key"]:
        missing.append("EFRIS_SANDBOX_KEY")
    if not CONFIG["seller_tin"]:
        missing.append("SELLER_TIN")
    if not CONFIG["seller_name"]:
        missing.append("SELLER_NAME")
    if missing:
        log.error(f"Missing required config: {', '.join(missing)}")
        log.error("Set them as environment variables or edit CONFIG in the script")
        sys.exit(1)

    engine = EfrisSyncEngine()

    try:
        if args.health:
            health = engine.client.health_check()
            print(json.dumps(health, indent=2))
        elif args.list:
            result = engine.client.list_invoices(limit=20)
            print(json.dumps(result, indent=2))
        elif args.once:
            engine.run_sync()
        else:
            engine.run_daemon()
    finally:
        engine.close()


if __name__ == "__main__":
    main()
