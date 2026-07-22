# Qwickpos — Multi-Vendor SaaS POS with EFRIS Readiness & Flutterwave Billing

An installable, offline-capable Point of Sale web app for Ugandan retail
businesses — now a self-serve **multi-vendor SaaS**: any shop can sign up,
run a 14-day free trial, and pay monthly via **Flutterwave** (mobile money,
card, bank) to unlock their plan. Multi-currency checkout, inventory, CRM,
suppliers, reports, and an EFRIS (URA e-invoicing) staging layer are all
included — no build tools, no framework, just static files +
[Supabase](https://supabase.com) as the backend.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | **Deploy entry point** — app shell (login, signup, sidebar/topbar layout). Netlify/Vercel/etc. serve this automatically at `/` because of its name. |
| `uganda-pos-index.html` | Identical copy, kept as the original working file — not needed for deployment |
| `uganda-pos-styles.css` | Full visual theme (light/dark) |
| `uganda-pos-app.js` | Bootstrap: auth, router, sidebar wiring, subscription gating |
| `uganda-pos-core.js` | Supabase client, shared state, currency/EFRIS/subscription helpers |
| `uganda-pos-billing.js` | Flutterwave Inline checkout integration |
| `uganda-pos-view-signup.js` | Public plan picker + self-serve business registration |
| `uganda-pos-view-billing.js` | Plan management, payment history, paywall screen |
| `uganda-pos-view-admin.js` | Super-admin console (all vendors, plans, payments) |
| `uganda-pos-view-dashboard.js` | KPIs, VAT summary, low stock, top products |
| `uganda-pos-view-pos.js` | Product grid, cart, Sale/Quotation mode, multi-currency checkout, receipts |
| `uganda-pos-view-quotations.js` | Quotations list, print, convert-to-sale |
| `uganda-pos-view-inventory.js` | Products, stock in/out/adjust, categories, EFRIS registration, barcode labels |
| `uganda-pos-view-customers.js` | CRM, credit, statements |
| `uganda-pos-view-suppliers.js` | Supplier ledger & payments |
| `uganda-pos-view-efris.js` | EFRIS invoice queue, payload viewer, live/simulated submit flow |
| `uganda-pos-view-reports.js` | Sales/VAT reports, cashier performance leaderboard, CSV export |
| `uganda-pos-view-accounting.js` | Expenses + simplified managerial P&L / Balance Sheet / Cash Flow |
| `uganda-pos-view-settings.js` | Business profile, currencies/rates, EFRIS config, notifications, team |
| `uganda-pos-sw.js` | Service worker — offline app shell caching |
| `uganda-pos-manifest.json` | PWA manifest (installable on phones/tablets) |
| `uganda-pos-icon.svg` | App icon |
| `uganda-pos-schema.sql` | Core Supabase/Postgres schema (single business) |
| `uganda-pos-seed.sql` | Optional demo business/branch/currencies (skip for real multi-vendor use) |
| `uganda-pos-schema-billing.sql` | Plans, subscriptions, superadmin, self-serve signup RPC |
| `uganda-pos-schema-v2.sql` | **Run this too** — live EFRIS credentials, expenses, quotations, RLS hardening |
| `uganda-pos-fn-verify-flutterwave-payment.ts` | Edge function: confirms inline payments, activates subscriptions |
| `uganda-pos-fn-flutterwave-webhook.ts` | Edge function: Flutterwave's async webhook (source of truth) |
| `uganda-pos-fn-efris-register-product.ts` | Edge function: registers a product with your live EFRIS provider |
| `uganda-pos-fn-efris-submit-invoice.ts` | Edge function: fiscalises a staged invoice with your live EFRIS provider |
| `uganda-pos-fn-daily-summary.ts` | Edge function: SMS daily sales summary (Africa's Talking), run on a schedule |

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project (free tier is enough to start).
2. Open **SQL Editor** and run, **in this order**:
   1. `uganda-pos-schema.sql`
   2. `uganda-pos-schema-billing.sql` (adds plans/subscriptions/superadmin/self-serve signup)
   3. `uganda-pos-schema-v2.sql` (live EFRIS credentials, expenses, quotations linkage, RLS hardening — see §9 and §13)
   - Skip `uganda-pos-seed.sql` for a real multi-vendor deployment — vendors create their own
     business by signing up in the app. It's only useful if you want one demo/manual business.
3. Go to **Project Settings → API** and copy your **Project URL** and **anon public key**.

## 2. Connect the app to your project

Open `uganda-pos-core.js` and replace the placeholders near the top:

```js
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-SUPABASE-ANON-KEY';
export const FLW_PUBLIC_KEY = 'FLWPUBK-YOUR-PUBLIC-KEY-X'; // Flutterwave Dashboard > Settings > API
```

## 3. Run it

Because the app uses native ES modules, opening `index.html` directly as a
`file://` URL will not work in most browsers — serve it over HTTP:

- **Quickest:** `npx serve .` (or `python3 -m http.server`) inside this folder, then visit the printed `localhost` URL.
- **To share with vendors / install on phones:** deploy the whole folder as-is
  to any static host — Netlify, Vercel, Cloudflare Pages, or GitHub Pages all work
  with zero configuration since there's no build step.

**Netlify specifically:** drag-and-drop (or connect the repo to) the folder
that directly contains `index.html` and all the `uganda-pos-*` files — that's
this whole folder, as one flat directory, with no build command and no
publish-directory subfolder needed (leave "Build command" blank and "Publish
directory" as `.` / the repo root). Netlify serves `index.html` automatically
at `/`; every other file (`uganda-pos-core.js`, `uganda-pos-styles.css`, etc.)
is loaded relative to it, so nothing else needs configuring.
`uganda-pos-index.html` is kept alongside it as the original working copy —
harmless to include, but `index.html` is the one Netlify actually serves.

Once deployed over HTTPS, anyone can open the link and click **"Start your
14-day free trial"** to create their own business — no manual database work
needed per vendor anymore.

## 4. How multi-vendor signup works

1. A visitor picks a plan on the signup screen (reads live from the public
   `plans` table) and fills in business name, their name, email/password.
2. The app calls `supabase.auth.signUp()`, then the `create_business_and_owner()`
   Postgres function (see `uganda-pos-schema-billing.sql`) — this creates their
   `businesses` row, a "Main Branch", links them as `admin` in `app_users`, sets
   up their chosen base currency, and starts a 14-day `trialing` subscription.
3. If your Supabase project requires email confirmation (the default), the
   business isn't created until they click the confirmation link and log in —
   the app finishes the setup automatically at that point
   (`finishPendingSignupIfAny()` in `uganda-pos-view-signup.js`).
4. Every vendor's data is isolated by Postgres Row Level Security — see the
   `auth_business_id()` policies in both schema files.

## 5. Plans, trials & feature gating

Three plans are seeded in `uganda-pos-schema-billing.sql` — **Starter**
(UGX 60,000/mo), **Growth** (UGX 150,000/mo), **Pro** (UGX 300,000/mo). Each
plan's `features` jsonb controls what a business can use:

| Feature key | Effect when off |
|---|---|
| `multi_currency` | Currency picker + POS currency selector locked to the business's base currency |
| `efris` | EFRIS nav item redirects to Billing with an upgrade prompt |
| `reports_export` | Reports nav item redirects to Billing with an upgrade prompt |
| `accounting` | Accounting nav item (expenses + statements) redirects to Billing with an upgrade prompt |
| `max_branches` / `max_users` | Shown on the pricing/plan cards today; not yet hard-enforced in the UI — a natural next step if you want server-side limits |

Edit prices/features any time from the **Platform Admin → Plans** table (only
visible to a superadmin), or directly in the `plans` table.

Every business gets a 14-day trial (`subscriptions.status = 'trialing'`).
Once `trial_ends_at` passes without a successful payment, `isSubscriptionActive()`
(`uganda-pos-core.js`) returns false and the whole app redirects to the
**Billing** screen (paywall) until they pay.

## 6. Flutterwave setup (mobile money billing)

1. Create a [Flutterwave](https://flutterwave.com) merchant account (Uganda).
2. Dashboard → **Settings → API** → copy your **Public Key** and **Secret Key**.
   - Public key goes in `uganda-pos-core.js` (`FLW_PUBLIC_KEY`) — safe for the browser.
   - Secret key goes **only** into the edge functions' environment (next section) — never in client code.
3. Dashboard → **Settings → Webhooks** → set the URL to your deployed
   `flutterwave-webhook` function (see below) and set a **secret hash** —
   a random string you also store as `FLW_WEBHOOK_HASH`.

The POS collects payment with **Flutterwave Inline Checkout**
(`payment_options: 'mobilemoneyuganda, card, ussd, banktransfer'`), so
customers pay by MTN MoMo, Airtel Money, card, USSD, or bank transfer from
one popup. See `uganda-pos-billing.js`.

### Deploying the two edge functions

These run the parts that require your Flutterwave **secret** key and must
never live in the browser: verifying a payment really succeeded before
activating a subscription. You need the
[Supabase CLI](https://supabase.com/docs/guides/cli) installed locally.

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF

mkdir -p supabase/functions/verify-flutterwave-payment
cp uganda-pos-fn-verify-flutterwave-payment.ts supabase/functions/verify-flutterwave-payment/index.ts

mkdir -p supabase/functions/flutterwave-webhook
cp uganda-pos-fn-flutterwave-webhook.ts supabase/functions/flutterwave-webhook/index.ts

supabase secrets set FLW_SECRET_KEY=FLWSECK-xxxxxxxx FLW_WEBHOOK_HASH=some-long-random-string

supabase functions deploy verify-flutterwave-payment
supabase functions deploy flutterwave-webhook --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
already available to edge functions automatically — you don't need to set
those yourself. Put the webhook URL Supabase prints
(`https://<project-ref>.functions.supabase.co/flutterwave-webhook`) into the
Flutterwave webhook setting from step 3 above.

**Why two functions?** The inline checkout's success callback fires in the
customer's browser and could be closed, blocked, or spoofed — so
`verify-flutterwave-payment` re-checks the transaction with Flutterwave
directly before touching the database, and the `flutterwave-webhook` is a
second, server-to-server confirmation that fires even if the customer never
returns to the tab. Both are idempotent (checked via `flw_tx_ref`), so
whichever arrives first wins and the second is a safe no-op.

## 7. Becoming a superadmin (platform owner)

1. Sign up for a normal account through the app once (any business name — you
   can ignore/delete it later, or just reuse it).
2. In Supabase **SQL Editor**, run (replace the email):

```sql
update app_users set role = 'superadmin', business_id = null, branch_id = null
where id = (select id from auth.users where email = 'you@yourcompany.com');
```

3. Log back in — you'll land straight in **Platform Admin**: every vendor,
   their plan/trial status, editable plan pricing, and a combined payments
   feed. Use **Manage** on any vendor to hand-activate a subscription for
   support cases (e.g. a bank transfer paid outside Flutterwave).

## 8. Multi-currency

- `businesses.base_currency` (chosen at signup) is the currency all product
  prices and reports are stored in internally.
- Add more currencies and set/update exchange rates any time in
  **Settings → Currencies & Exchange Rates** (Growth/Pro plans only — Starter
  is locked to its base currency). Rates are stored as "1 unit of currency =
  X base currency" and are versioned — every update adds a new row to
  `exchange_rates`, so historical sales keep the rate active at the time.
- Cashiers pick the sale currency per transaction in the POS screen; the
  receipt, VAT, and reports all convert consistently back to the base currency.

## 9. EFRIS (URA e-invoicing) — sandbox and live

Uganda's EFRIS normally requires a **registered device** with URA and a
signed integration to their API. Rather than the raw URA RSA/AES protocol,
this app integrates through a third-party middleware —
[EFRIS Simplified](https://efrissimplified.com) (WEAF is also supported) —
which exposes it as a plain REST API. You can run in sandbox indefinitely, or
connect a provider account to submit real invoices.

**Sandbox mode (default).** Every completed sale automatically stages a
fiscal invoice in `efris_invoices` with a URA-shaped payload — see
`buildEfrisPayload()` in `uganda-pos-core.js`. The **EFRIS tab** shows this
queue with statuses (`pending → queued → accepted/rejected`), lets you
inspect the exact payload, and its **Submit** button *simulates* URA's
response locally — nothing leaves the browser.

**Going live:**

1. Sign up with [EFRIS Simplified](https://efrissimplified.com) (or WEAF) and
   get your API key + confirm your business TIN with them.
2. In **Settings → EFRIS (URA) Configuration → Live EFRIS Provider**, pick the
   provider, paste the API key (write-only — stored in
   `efris_provider_credentials`, readable only by edge functions, never by
   the browser again), and tick **Enable live EFRIS submission**.
3. On each product in **Inventory**, set an **EFRIS Commodity Category ID**
   (from your provider's dictionary) and Measure Unit (`101` = Pieces covers
   most retail goods). Products are auto-registered with EFRIS the first time
   they appear on a submitted invoice if you don't register them manually
   first via the **Register** button.
4. Deploy the two live-mode edge functions:

```bash
mkdir -p supabase/functions/efris-register-product
cp uganda-pos-fn-efris-register-product.ts supabase/functions/efris-register-product/index.ts
supabase functions deploy efris-register-product

mkdir -p supabase/functions/efris-submit-invoice
cp uganda-pos-fn-efris-submit-invoice.ts supabase/functions/efris-submit-invoice/index.ts
supabase functions deploy efris-submit-invoice
```

No extra secrets needed for these two — the EFRIS API key is read from
`efris_provider_credentials` per business (every vendor has their own EFRIS
account/TIN), not from a shared edge function secret.

Once live mode is on, the EFRIS tab's **Submit** button calls
`efris-submit-invoice` for real instead of simulating, and stores URA's
actual FDN, anti-fake code and QR code on acceptance.

Uganda's standard VAT rate (18%) is seeded in `tax_categories`, along with
Zero-rated, Exempt and Deemed categories.

## 10. Quotations

The **POS** screen has a **Sale / Quotation** toggle above the cart. In
Quotation mode, "Charge" becomes **Save Quotation** — it skips payment
collection and EFRIS staging entirely and just snapshots the cart as a price
quote (`sales.sale_type = 'quotation'`), with an optional "Valid Until" date.

The **Quotations** tab lists them (Open / Converted / Expired / Voided) and
lets you:

- **Print** a QUOTATION-labelled document (same receipt layout, different heading).
- **Convert to Sale** — collects payment like a normal checkout, then creates
  a brand-new `sale_type='retail'` sale from the quoted items. This is a
  *separate* sale row on purpose: it's what makes stock deduction and EFRIS
  staging fire exactly like any other checkout, with zero special-casing.
  The original quotation is linked via `converted_sale_id` and marked
  `status='converted'`.
- **Void** an open quotation the customer didn't take up.

Quotations never touch stock or EFRIS, and are excluded from Dashboard,
Reports, Accounting and customer statement totals — see the `sale_type !==
'quotation'` filters throughout those views.

## 11. Accounting (expenses + simplified statements)

The **Accounting** tab (Growth/Pro plans) has two parts:

- **Expenses** — record operating costs by category (rent, salaries,
  transport, etc.) with a currency, payment method and date; backed by the
  `expenses` table.
- **Profit & Loss / Balance Sheet / Cash Flow** — built entirely from data the
  POS already has: sales, payments, expenses, current stock and cost prices.

**These are managerial estimates, clearly labelled as such on every screen —
not statutory financial statements.** There's no full double-entry ledger, no
accruals, and Cost of Goods Sold uses *today's* cost price rather than the
historical cost at the time of each sale (sale line items don't snapshot
cost). Treat it as a fast operational read, and hand it to a real accountant
before filing anything with URA.

## 12. Barcode labels & cashier performance

- **Inventory → Print Labels** (bulk) or the per-row **Label** button prints
  Code128 barcode labels via [JsBarcode](https://github.com/lindell/JsBarcode)
  (loaded from CDN only inside the print popup — no bundling needed). Labels
  use the product's barcode, falling back to SKU, then its internal ID if
  neither is set.
- **Reports → Cashier Performance** ranks cashiers by revenue over the
  selected date range (transactions, items sold, total sales, average sale) —
  useful for shift performance conversations and spotting your top sellers.

## 13. WhatsApp/SMS daily summary

`uganda-pos-fn-daily-summary.ts` is a scheduled edge function that, once a
day, sends every opted-in business an SMS with yesterday's sales total,
transaction count, top-selling product and low-stock count.

1. Toggle it on per business in **Settings → Notifications** (phone number in
   E.164 format, e.g. `+256772123456`).
2. Get Africa's Talking credentials from
   [account.africastalking.com](https://account.africastalking.com) (use
   `sandbox` as the username while testing).
3. Deploy and schedule it:

```bash
mkdir -p supabase/functions/daily-summary
cp uganda-pos-fn-daily-summary.ts supabase/functions/daily-summary/index.ts
supabase functions deploy daily-summary --no-verify-jwt
supabase secrets set AT_USERNAME=your_at_username AT_API_KEY=your_at_api_key CRON_SECRET=some-long-random-string
```

Then, in the Supabase **SQL Editor** (enable the `pg_cron` and `pg_net`
extensions first, under Database → Extensions):

```sql
select cron.schedule(
  'uganda-pos-daily-summary',
  '0 5 * * *',  -- 05:00 UTC = 08:00 Kampala time (EAT, UTC+3)
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/daily-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'SAME-VALUE-AS-THE-CRON_SECRET-SECRET-ABOVE'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

It's deployed with `--no-verify-jwt` because pg_cron calls it server-to-server
with no user session — the `x-cron-secret` header (checked inside the
function) is what stops anyone else from triggering it if they find the URL.

**Swapping in WhatsApp:** the Settings toggle already has an SMS/WhatsApp
channel selector — the WhatsApp path currently logs a no-op. Wire up
[Twilio's WhatsApp API](https://www.twilio.com/docs/whatsapp/api) (or Africa's
Talking's own WhatsApp product) inside `uganda-pos-fn-daily-summary.ts` where
that comment points; the message text (`buildMessage()`) doesn't need to change.

## 14. Offline behavior

The service worker caches the app shell so the interface still loads with no
connection. If a cashier completes a sale while offline, it's queued in the
browser's local storage and automatically pushed to Supabase the moment the
connection returns (see `flushOfflineQueue` in `uganda-pos-core.js`).
Quotations always require a connection (there's nothing time-sensitive about
saving one offline, so it's kept simple).

## 15. Extending it

- **Hard plan limits** — `max_branches`/`max_users` are on the plan cards but
  not yet enforced with a server-side check; add a trigger or edge function
  check if you want to hard-block over-limit usage instead of relying on the UI.
- **Manufacturing/BOM and field sales modules** — deliberately out of scope
  for this build; the schema (products, stock_movements) is a reasonable
  foundation if you want to add them later.
- **Row Level Security** — business isolation + superadmin bypass now covers
  every tenant-scoped table, including branches, categories, suppliers,
  stock, purchase orders and supplier payments (`uganda-pos-schema-v2.sql`
  §8). `currencies`, `exchange_rates` and `tax_categories` stay unscoped on
  purpose — they're shared reference data, not per-tenant.
- **Historical COGS** — Accounting's P&L uses today's cost price for COGS
  since `sale_items` doesn't snapshot cost at sale time; add a `cost_price`
  column to `sale_items` (set at checkout) if you want it to be exact.
- **Annual billing / proration / dunning emails** — the current billing model
  is simple monthly Flutterwave charges; a recurring "renew" reminder (e.g. a
  scheduled edge function that emails vendors a few days before
  `current_period_end`) is a good next addition.

## Uganda business types this fits out of the box

Retail shops, pharmacies, hardware stores, supermarkets, electronics shops,
and wholesalers — the tax categories, multi-currency pricing, and low-stock
alerts are general-purpose. Restaurants/bars would benefit from an
order/table layer on top of the same schema.
