# Qwickpos — Getting Started Guide

A step-by-step guide for business owners, managers and cashiers to set up
Qwickpos and record their first sale.

---

## 1. Sign up (2 minutes)

1. Open your Qwickpos link (e.g. `https://qwickpos.ug`).
2. Click **Start your 14-day free trial**.
3. Pick a plan (Starter / Growth / Pro — you can upgrade later).
4. Fill in the signup form:

   | Field | What to enter |
   |-------|---------------|
   | **Business Name** | Your shop/company name |
   | **Your Full Name** | Owner or admin's name |
   | **Phone** | A contact number, e.g. `+2567xxxxxxxx` |
   | **Base Currency** | Usually **UGX — Uganda Shilling** |
   | **Business Type** | Retail, Food & Restaurant, Pharmacy, Wholesale, Services, Manufacturing |
   | **Email** | Used to log in |
   | **Password** | At least 8 characters, with a letter **and** a number |

5. Click **Start 14-Day Free Trial**.

> **After signup:** if you don't get logged in automatically, check your email
> for a confirmation link, click it, then log in with your email and password.

**Business type matters.** Choosing a type pre-fills categories and features:
- **Food** and **Pharmacy** turn on batch & expiry tracking automatically.
- **Services** marks the business as a service business (no stock needed).
- **Wholesale** enables quantity pricing.
- **Manufacturing** enables production / BOM tools.

---

## 2. Your first look at the app

The sidebar on the left is your main menu:

| Menu | What it's for |
|------|---------------|
| **Dashboard** | Today's sales, VAT summary, low-stock alerts |
| **POS** | Sell products / services (your daily workhorse) |
| **Orders / Sales History** | Past sales, returns, credit notes |
| **Inventory → Products / Stock** | Add products, manage quantities |
| **Customers** | Customer list, credit, statements |
| **Reports** | Sales & VAT reports, exports |
| **EFRIS** | URA e-invoice queue (see section 6) |
| **Settings** | Business profile, currency, EFRIS, team |

The **top bar** has quick buttons for the most common actions:
**New Sale**, **Product**, and **Customer**.

---

## 3. Set up your business profile

1. Go to **Settings** (bottom of sidebar).
2. Under **Business Profile**:
   - **Business Name** — as shown on receipts
   - **TIN** — your 10-digit Uganda TIN (needed for EFRIS later)
   - **Phone** and **Address**
   - **Base Currency** — your default selling currency
3. Click **Save Profile**.

---

## 4. Add your products (or services)

Go to **Inventory → Products** and click **Add Product** (or use the **Product**
button in the top bar).

Fill in the essentials:
- **Name** — e.g. "Coca-Cola 500ml"
- **Selling Price** — your retail price
- **Unit** — `pc`, `kg`, `bottle`, etc.
- **Category** — pick from the pre-seeded list for your business type
- **Stock** — how many you have in stock. **Leave 0 for services** (consulting,
  repairs, a haircut, etc.) — services don't need stock.
- **Tax** — default is **VAT (18%)**; use Exempt / Zero-rated if the item
  qualifies.
- **EFRIS Commodity Category ID / Measure Unit** — only if live EFRIS is enabled.

Click **Add Product**. Repeat for every item you sell.

> **Tip:** You can also create products while recording a purchase
> (Inventory → Purchases), which adds them to stock automatically.

---

## 5. Make your first sale (POS)

1. Click **POS** in the sidebar (or the **New Sale** button).
2. Tap the products the customer is buying — they appear in the cart on the right.
3. Adjust quantities if needed.
4. Apply a discount or coupon if applicable.
5. Click **Pay (amount)** to open the **Complete Order** screen.
6. Choose the **payment method** (Cash / Mobile Money / Card — mobile money and
   card are processed via Flutterwave if enabled). Use **Split Payment** if the
   customer pays with more than one method.
7. Click **Confirm & Create Order**.
8. A receipt is generated — print it (A4 or thermal) or send it by SMS/email.

The sale is now on your **Dashboard** and in **Sales History**.

> **Offline:** Qwickpos keeps working without internet. Sales made offline are
> stored on the device and synced automatically when you're back online.

---

## 6. EFRIS (URA e-invoicing) — 5 minute setup

Qwickpos can send fiscal invoices to Uganda's URA EFRIS system. Two modes:

### Sandbox mode (default, simulated)
No real invoices are sent — every sale is staged in the **EFRIS** tab with a
URA-shaped payload so you can inspect it. Great for getting familiar.

### Live mode (real invoices)
Requires your **TIN** and either:
- **Direct URA S2S** — URA-approved RSA credentials (sandbox + live endpoints),
  or
- **A provider account** — e.g. EFRIS Simplified or WEAF (paste the API key in
  Settings → EFRIS).

**To go live:**
1. In **Settings → EFRIS (URA) Configuration**, enter your **EFRIS Device
   Number** (issued by URA or your provider) and set mode to **Live**.
2. Under **Live EFRIS Provider**, pick your provider, paste the API key, and
   tick **Enable live EFRIS submission**.
3. In **Inventory → Products**, set each product's **EFRIS Commodity Category
   ID** and Measure Unit (default `101` = Pieces). Products are auto-registered
   on their first submitted invoice, or via the **Register** button.
4. Click **Save EFRIS Settings**.

Once live, the **EFRIS** tab's **Submit** button sends invoices to URA for real
and stores the fiscal invoice number, anti-fake code and QR code on acceptance.
Products missing a commodity category will prompt you before submitting.

---

## 7. Add your team

1. Go to **Settings → Team**.
2. Click **Add User**.
3. Enter name and email, pick a **role** (Admin / Cashier / Manager, etc.), and
   assign a **branch**.
4. The team member can then log in with that email.

> Admin can also deactivate users — a deactivated user can't log in.

---

## 8. Billing & upgrading

- Your **14-day free trial** starts at signup.
- To upgrade or see payment history, go to **Billing** (sidebar) and pick a plan.
- Pay online via **Flutterwave** (Mobile Money, card, or bank transfer).
- Payments are confirmed automatically and your plan is activated right away.

---

## 9. Handy tips

- **Multi-currency:** if you sell in USD or other currencies, set your rates in
  **Settings → Currencies** and switch currency at checkout. Non-native
  currencies (e.g. RWF) are auto-converted to UGX for EFRIS using URA's rate.
- **Install as an app:** Qwickpos is a PWA — on a phone/tablet, use your
  browser's **Add to Home Screen** to get an app icon.
- **Quotations:** create a quote from POS, then convert it to a sale later.
- **Low stock:** stock levels appear in Inventory; alerts fire on the dashboard.
- **Reports:** export sales/VAT data to CSV from **Reports**.
- **Get help:** see the README for developer/deployment details, or contact
  support (Settings → support contacts).

---

## 10. Next steps checklist

- [ ] Signed up and logged in
- [ ] Business profile saved (name, TIN, currency)
- [ ] Products/services added
- [ ] First sale completed in POS
- [ ] Receipt printed or sent
- [ ] (Optional) EFRIS configured — sandbox tested
- [ ] (Optional) Team members invited
- [ ] (Optional) Subscription upgraded after trial
