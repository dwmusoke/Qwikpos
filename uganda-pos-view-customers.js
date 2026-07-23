// =====================================================================
// QWICKPOS — CUSTOMERS (CRM) VIEW
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
  fmtMoney,
  refreshCustomers,
  fmtDate,
  printHtml,
  emptyStateHtml,
} from "./uganda-pos-core.js";
import { logAuditAction } from "./uganda-pos-view-audit.js";

export async function renderCustomers(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Customers</h2><p class="sub">${STATE.customers.length} customers on file</p></div>
      <button class="btn btn-primary" id="add-customer-btn">+ Add Customer</button>
      <button class="btn btn-outline" id="import-customers-btn">📥 Import CSV</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>TIN</th><th>Credit Limit</th><th>Balance</th><th></th></tr></thead>
        <tbody id="cust-table-body"></tbody>
      </table>
    </div>
  `;
  renderTable();
  $("add-customer-btn").addEventListener("click", () => openCustomerModal());
  $("import-customers-btn")?.addEventListener("click", () => openCustomerImportModal());
}

function renderTable() {
  const tbody = $("cust-table-body");
  if (!STATE.customers.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      ${emptyStateHtml("👥", "No Customers Yet", "Add your first customer or import them from a CSV file to start tracking sales and statements.", "+ Add Customer", () => openCustomerModal())}
      <div style="text-align:center;margin-bottom:14px;"><button class="btn btn-outline btn-sm" onclick="document.getElementById('import-customers-btn')?.click()">📥 Import from CSV</button></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.customers
    .map(
      (c) => `
    <tr>
      <td><b>${escapeHtml(c.name)}</b></td>
      <td>${escapeHtml(c.phone || "—")}</td>
      <td>${escapeHtml(c.tin || "—")}</td>
      <td>${fmtMoney(c.credit_limit || 0)}</td>
      <td><span class="badge ${Number(c.balance) > 0 ? "badge-yellow" : "badge-green"}">${fmtMoney(c.balance || 0)}</span></td>
      <td class="flex gap">
        <button class="btn btn-outline btn-sm" data-edit="${c.id}">Edit</button>
        <button class="btn btn-outline btn-sm" data-statement="${c.id}">Statement</button>
      </td>
    </tr>`,
    )
    .join("");

  qsa("[data-edit]", tbody).forEach((b) =>
    b.addEventListener("click", () => openCustomerModal(b.dataset.edit)),
  );
  qsa("[data-statement]", tbody).forEach((b) =>
    b.addEventListener("click", () => openStatementModal(b.dataset.statement)),
  );
}

function openCustomerModal(customerId) {
  const editing = !!customerId;
  const c = editing ? STATE.customers.find((x) => x.id === customerId) : {};
  openModal(
    `
    <div class="modal-title-row"><h3>${editing ? "Edit" : "Add"} Customer</h3></div>
    <div class="field"><label>Full Name *</label><input id="cf-name" value="${escapeHtml(c.name || "")}" /></div>
    <div class="field-row">
      <div class="field"><label>Phone</label><input id="cf-phone" value="${escapeHtml(c.phone || "")}" /></div>
      <div class="field"><label>Email</label><input id="cf-email" value="${escapeHtml(c.email || "")}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>TIN (for EFRIS B2B invoices)</label><input id="cf-tin" value="${escapeHtml(c.tin || "")}" /></div>
      <div class="field"><label>Credit Limit (UGX)</label><input type="number" step="0.01" id="cf-credit" value="${c.credit_limit ?? 0}" /></div>
    </div>
    <div class="field"><label>Address</label><input id="cf-address" value="${escapeHtml(c.address || "")}" /></div>
    <div class="flex gap" style="margin-top:14px;">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="save-customer-btn">${editing ? "Save Changes" : "Add Customer"}</button>
    </div>
  `,
    {
      onMount: () => {
        $("save-customer-btn").addEventListener("click", async () => {
          const name = $("cf-name").value.trim();
          if (!name) {
            toast("Customer name is required", "error");
            return;
          }
          const record = {
            business_id: STATE.business.id,
            name,
            phone: $("cf-phone").value.trim() || null,
            email: $("cf-email").value.trim() || null,
            tin: $("cf-tin").value.trim() || null,
            credit_limit: parseFloat($("cf-credit").value) || 0,
            address: $("cf-address").value.trim() || null,
          };
          const query = editing
            ? supabase.from("customers").update(record).eq("id", customerId)
            : supabase.from("customers").insert(record);
          const { error } = await query;
          if (error) {
            toast("Save failed: " + error.message, "error");
            return;
          }
          toast(editing ? "Customer updated" : "Customer added", "success");
          logAuditAction({ action: editing ? 'update' : 'create', entityType: 'customer', entityId: editing ? customerId : null, entityName: name, newValue: record });
          closeModal();
          await refreshCustomers();
          renderTable();
        });
      },
    },
  );
}

async function openStatementModal(customerId) {
  const c = STATE.customers.find((x) => x.id === customerId);
  openModal(
    `<div class="modal-title-row"><h3>Statement — ${escapeHtml(c.name)}</h3></div><div class="empty-state">Loading…</div>`,
    { large: true },
  );

  const { data: sales } = await supabase
    .from("sales")
    .select("*")
    .eq("customer_id", customerId)
    .neq("status", "voided")
    .order("created_at", { ascending: false })
    .limit(50);
  // Quotations aren't purchases yet — leave them out of the statement/lifetime total.
  const rows = (sales || []).filter((s) => s.sale_type !== "quotation");
  const total = rows.reduce((a, s) => a + Number(s.grand_total_base || 0), 0);

  openModal(
    `
    <div class="modal-title-row"><h3>Statement — ${escapeHtml(c.name)}</h3></div>
    <div class="summary-row"><span>Current Balance</span><span><b>${fmtMoney(c.balance || 0)}</b></span></div>
    <div class="summary-row"><span>Lifetime Purchases</span><span>${fmtMoney(total)}</span></div>
    <div class="table-wrap" style="margin-top:12px; max-height:340px; overflow-y:auto;">
      <table>
        <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Total</th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (s) => `
            <tr><td>${escapeHtml(s.sale_number)}</td><td>${fmtDate(s.created_at)}</td>
            <td><span class="badge ${s.payment_status === "paid" ? "badge-green" : "badge-yellow"}">${s.payment_status}</span></td>
            <td>${fmtMoney(s.grand_total_base)}</td></tr>
          `,
                  )
                  .join("")
              : '<tr><td colspan="4"><div class="empty-state">No purchases yet.</div></td></tr>'
          }
        </tbody>
      </table>
    </div>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:14px;">Close</button>
    <button class="btn btn-primary btn-block" id="print-stmt-btn" style="margin-top:8px;">🖨️ Print Statement</button>
    `,
    { large: true },
  );

  // Print statement handler
  const printBtn = document.getElementById("print-stmt-btn");
  if (printBtn) {
    printBtn.addEventListener("click", () => {
      const stmtHtml = `
        <div style="font-family:sans-serif; max-width:600px; margin:0 auto; padding:20px;">
          <div style="text-align:center; border-bottom:2px solid #333; padding-bottom:12px; margin-bottom:16px;">
            <h1 style="margin:0; font-size:20px;">${escapeHtml(STATE.business?.name || "Qwickpos")}</h1>
            <p style="margin:4px 0 0; color:#666; font-size:12px;">Customer Statement</p>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:16px;">
            <div><b>Customer:</b> ${escapeHtml(c.name)}<br><b>Phone:</b> ${escapeHtml(c.phone || "—")}</div>
            <div style="text-align:right;"><b>Balance:</b> ${fmtMoney(c.balance || 0)}<br><b>Date:</b> ${new Date().toLocaleDateString()}</div>
          </div>
          <div style="margin-bottom:12px;"><b>Lifetime Purchases:</b> ${fmtMoney(total)}</div>
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead><tr style="background:#f4f4f4;"><th style="padding:8px; text-align:left; border-bottom:1px solid #ddd;">Invoice</th><th style="padding:8px; text-align:left; border-bottom:1px solid #ddd;">Date</th><th style="padding:8px; text-align:left; border-bottom:1px solid #ddd;">Status</th><th style="padding:8px; text-align:right; border-bottom:1px solid #ddd;">Total</th></tr></thead>
            <tbody>
              ${rows.map((s) => `<tr><td style="padding:6px 8px; border-bottom:1px solid #eee;">${escapeHtml(s.sale_number)}</td><td style="padding:6px 8px; border-bottom:1px solid #eee;">${fmtDate(s.created_at)}</td><td style="padding:6px 8px; border-bottom:1px solid #eee;">${s.payment_status}</td><td style="padding:6px 8px; border-bottom:1px solid #eee; text-align:right;">${fmtMoney(s.grand_total_base)}</td></tr>`).join("")}
            </tbody>
          </table>
          <div style="margin-top:24px; text-align:center; color:#999; font-size:11px;">Generated by Qwickpos</div>
        </div>`;
      printHtml(stmtHtml, `Statement — ${c.name}`);
    });
  }
}

function openCustomerImportModal() {
  const csvSample = 'name,phone,email,address,opening_balance\n' +
    'John Mukasa,+256772123456,john@example.com,Kampala Rd 12,0\n' +
    'Sarah Nabatanzi,+256701234567,sarah@example.com,Entebbe Rd 45,50000\n' +
    'Peter Okello,+256751234567,peter@example.com,Gulu Town,0';
  openModal(`
    <div class="modal-title-row"><h3>Import Customers from CSV</h3></div>
    <p class="help-text" style="margin-bottom:12px;">Download the sample template to see the expected format, then upload your file.</p>
    <div class="flex gap" style="margin-bottom:14px;">
      <button class="btn btn-outline" id="cust-dl-sample">📄 Download Sample CSV</button>
    </div>
    <div class="field"><label>CSV File</label><input type="file" id="cust-import-file" accept=".csv" /></div>
    <div class="field"><label>Default Balance (if not in CSV)</label><input type="number" id="cust-default-balance" value="0" /></div>
    <button class="btn btn-primary btn-block" id="cust-import-run" style="margin-top:14px;">Import</button>
  `, { onMount: () => {
    $('cust-dl-sample').addEventListener('click', () => {
      const blob = new Blob([csvSample], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'qwickpos-customer-import-sample.csv'; a.click();
      URL.revokeObjectURL(url);
    });
    $('cust-import-run').addEventListener('click', async () => {
      const file = $('cust-import-file').files[0];
      if (!file) { toast('Select a CSV file', 'error'); return; }
      const text = await file.text();
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) { toast('CSV is empty', 'error'); return; }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const nameIdx = headers.indexOf('name');
      if (nameIdx < 0) { toast('CSV must have a name column', 'error'); return; }
      const phoneIdx = headers.indexOf('phone');
      const emailIdx = headers.indexOf('email');
      const addressIdx = headers.indexOf('address');
      const balanceIdx = headers.indexOf('opening_balance');
      const defaultBalance = parseFloat($('cust-default-balance').value) || 0;
      let count = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const name = cols[nameIdx]?.trim();
        if (!name) continue;
        const { error } = await supabase.from('customers').insert({
          business_id: STATE.business.id, name,
          phone: cols[phoneIdx]?.trim() || null,
          email: cols[emailIdx]?.trim() || null,
          address: cols[addressIdx]?.trim() || null,
          balance: parseFloat(cols[balanceIdx]) || defaultBalance,
        });
        if (!error) count++;
      }
      toast(`Imported ${count} customers`, 'success');
      await refreshCustomers();
      closeModal();
      renderTable();
    });
  }});
}
