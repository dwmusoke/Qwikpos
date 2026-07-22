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
} from "./uganda-pos-core.js";

export async function renderCustomers(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Customers</h2><p class="sub">${STATE.customers.length} customers on file</p></div>
      <button class="btn btn-primary" id="add-customer-btn">+ Add Customer</button>
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
}

function renderTable() {
  const tbody = $("cust-table-body");
  if (!STATE.customers.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No customers yet.</div></td></tr>`;
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
  `,
    { large: true },
  );
}
