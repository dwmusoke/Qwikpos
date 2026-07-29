// =====================================================================
// QWICKPOS — ACCOUNTING VIEW
// Expenses, General Ledger, Journal Entries, Trial Balance,
// P&L, Balance Sheet, Cash Flow
// =====================================================================
import {
  supabase,
  STATE,
  $,
  qsa,
  escapeHtml,
  toast,
  hasRole,
  fmtMoney,
  fmtMoneyRaw,
  fmtDate,
  stockFor,
  sanitizeCsvValue,
  openModal,
  closeModal,
  uid,
  logAuditAction,
} from "./uganda-pos-core.js";

let acctTab = "ledger";

const PERIODS = [
  ["today", "Today"],
  ["week", "This Week"],
  ["month", "This Month"],
  ["quarter", "This Quarter"],
  ["year", "This Year"],
  ["custom", "Custom"],
];

function periodRange(key) {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from;
  if (key === "today") from = to;
  else if (key === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    from = d.toISOString().slice(0, 10);
  } else if (key === "month") {
    const d = new Date(now);
    d.setDate(1);
    from = d.toISOString().slice(0, 10);
  } else if (key === "quarter") {
    const d = new Date(now);
    d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
    from = d.toISOString().slice(0, 10);
  } else if (key === "year") {
    from = `${now.getFullYear()}-01-01`;
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    from = d.toISOString().slice(0, 10);
  }
  return { from, to };
}

function downloadCsv(rows, header, filename) {
  const csv = [header, ...rows]
    .map((r) =>
      r.map((v) => `"${sanitizeCsvValue(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function renderAccounting(root) {
  root.innerHTML = `
    <div class="page-header">
      <div class="page-header-info"><h1>Accounting</h1><p>General Ledger, Journal Entries, Trial Balance, and financial statements</p></div>
    </div>
    <div class="notif-filters" id="acct-tabs" style="margin-bottom:16px;">
      ${[
        ["coa", "📊 Chart of Accounts"],
        ["ledger", "📒 General Ledger"],
        ["journal", "📓 Journal Entries"],
        ["trial", "⚖️ Trial Balance"],
        ["expenses", "💸 Expenses"],
        ["transfers", "🔄 Fund Transfers"],
        ["deposits", "🏦 Deposits"],
        ["pnl", "📈 Profit &amp; Loss"],
        ["balance", "🏦 Balance Sheet"],
        ["cashflow", "💵 Cash Flow"],
      ]
        .map(
          ([key, label]) =>
            `<button class="chip ${acctTab === key ? "active" : ""}" data-tab="${key}">${label}</button>`,
        )
        .join("")}
    </div>
    <div id="acct-body"></div>
  `;

  qsa("#acct-tabs .chip", root).forEach((chip) =>
    chip.addEventListener("click", () => {
      acctTab = chip.dataset.tab;
      qsa("#acct-tabs .chip", root).forEach((c) =>
        c.classList.toggle("active", c === chip),
      );
      renderTab();
    }),
  );

  await renderTab();

  async function renderTab() {
    const body = $("acct-body");
    if (acctTab === "coa") await renderCoaTab(body);
    else if (acctTab === "ledger") await renderLedgerTab(body);
    else if (acctTab === "journal") await renderJournalTab(body);
    else if (acctTab === "trial") await renderTrialBalanceTab(body);
    else if (acctTab === "expenses") await renderExpensesTab(body);
    else if (acctTab === "transfers") await renderTransfersTab(body);
    else if (acctTab === "deposits") await renderDepositsTab(body);
    else if (acctTab === "pnl") await renderPnlTab(body);
    else if (acctTab === "balance") await renderBalanceSheetTab(body);
    else if (acctTab === "cashflow") await renderCashFlowTab(body);
  }
}

function periodPickerHtml(key, id) {
  return `
    <div class="field-row" style="align-items:end; flex-wrap:wrap; gap:8px;">
      ${PERIODS.map(([k, label]) => `<button class="btn btn-sm ${k === key ? "btn-primary" : "btn-secondary"}" data-period="${k}" data-for="${id}">${label}</button>`).join("")}
      <div class="field"><label>From</label><input type="date" id="${id}-from" value="${periodRange(key).from}" /></div>
      <div class="field"><label>To</label><input type="date" id="${id}-to" value="${periodRange(key).to}" /></div>
      <button class="btn btn-primary" id="${id}-run">Run</button>
      <button class="btn btn-secondary" id="${id}-export">Export CSV</button>
    </div>`;
}

function wirePeriodButtons(rootId) {
  qsa(`[data-for="${rootId}"]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = periodRange(btn.dataset.period);
      $(`${rootId}-from`).value = r.from;
      $(`${rootId}-to`).value = r.to;
      qsa(`[data-for="${rootId}"]`).forEach(
        (b) =>
          (b.className =
            b === btn ? "btn btn-sm btn-primary" : "btn btn-sm btn-secondary"),
      );
    });
  });
}

function nonStatutoryNote() {
  return `<div class="card" style="border-color:var(--warning); background:var(--warning-light); margin-bottom:16px;">
    <b>Managerial estimate, not a statutory statement.</b> Share with your accountant as a starting point before filing with URA.</div>`;
}

// =====================================================================
// CHART OF ACCOUNTS — full CRUD
// =====================================================================
const COA_TYPES = [
  ["asset", "Asset"],
  ["liability", "Liability"],
  ["equity", "Equity"],
  ["income", "Income"],
  ["expense", "Expense"],
];

const COA_SUBTYPES = {
  asset: ["Current Asset", "Fixed Asset", "Other Asset"],
  liability: ["Current Liability", "Long Term Liability"],
  equity: ["Equity"],
  income: ["Revenue", "Other Income"],
  expense: ["COGS", "Operating Expense", "Other Expense"],
};

function coaTypeColor(type) {
  return {
    asset: "badge-green",
    liability: "badge-red",
    equity: "badge-blue",
    income: "badge-yellow",
    expense: "badge-gray",
  }[type] || "badge-gray";
}

async function renderCoaTab(body) {
  body.innerHTML = `
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>Chart of Accounts</span>
        <button class="btn btn-primary btn-sm" id="coa-add-btn">+ New Account</button>
      </div>
    </div>
    <div id="coa-output"><div class="empty-state">Loading…</div></div>`;

  $("coa-add-btn").addEventListener("click", () => openCoaForm(null));
  await loadCoa();

  async function loadCoa() {
    const out = $("coa-output");
    const { data: accounts } = await supabase
      .from("chart_of_accounts")
      .select("*")
      .or(`business_id.eq.${STATE.business.id},business_id.is.null`)
      .eq("is_active", true)
      .order("account_code");

    const list = accounts || [];
    out.innerHTML = list.length ? `
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Subtype</th><th>System</th><th></th></tr></thead>
          <tbody>
            ${list.map((a) => `
              <tr>
                <td><code>${escapeHtml(a.account_code)}</code></td>
                <td><b>${escapeHtml(a.name)}</b></td>
                <td><span class="badge ${coaTypeColor(a.type)}">${escapeHtml(a.type)}</span></td>
                <td class="text-muted">${escapeHtml(a.subtype || "")}</td>
                <td>${a.is_system ? '<span class="badge badge-gray">System</span>' : ""}</td>
                <td class="flex gap">
                  <button class="btn btn-ghost btn-sm" data-edit-coa="${a.id}">Edit</button>
                  ${a.is_system ? "" : `<button class="btn btn-ghost btn-sm" style="color:var(--danger);" data-del-coa="${a.id}">Delete</button>`}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table></div>
      </div>` : '<div class="card"><div class="empty-state">No accounts yet. Add your first account.</div></div>';

    qsa("[data-edit-coa]", body).forEach((btn) =>
      btn.addEventListener("click", () => openCoaForm(list.find((a) => a.id === btn.dataset.editCoa))));
    qsa("[data-del-coa]", body).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this account?")) return;
        await supabase.from("chart_of_accounts").update({ is_active: false }).eq("id", btn.dataset.delCoa);
        toast("Account deactivated", "success");
        loadCoa();
      }));
  }
}

function openCoaForm(account) {
  const isEdit = !!account;
  openModal(`
    <h3>${isEdit ? "Edit Account" : "New Account"}</h3>
    <div class="field"><label>Account Code</label><input id="coa-code" value="${escapeHtml(account?.account_code || "")}" placeholder="e.g. 1-1000" /></div>
    <div class="field"><label>Account Name</label><input id="coa-name" value="${escapeHtml(account?.name || "")}" placeholder="e.g. Cash at Bank" /></div>
    <div class="field"><label>Type</label><select id="coa-type">${COA_TYPES.map(([v, l]) => `<option value="${v}" ${account?.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label>Subtype</label><select id="coa-subtype"><option value="">— Select —</option></select></div>
    <div class="field"><label>Description</label><textarea id="coa-desc" rows="2">${escapeHtml(account?.description || "")}</textarea></div>
    <button class="btn btn-primary btn-block" id="coa-save">${isEdit ? "Update" : "Create"}</button>
    <button class="btn btn-secondary btn-block" data-close-modal>Cancel</button>
  `);

  const typeSelect = $("coa-type");
  const subtypeSelect = $("coa-subtype");

  function updateSubtypes() {
    const subs = COA_SUBTYPES[typeSelect.value] || [];
    subtypeSelect.innerHTML = `<option value="">— Select —</option>` +
      subs.map((s) => `<option value="${s}" ${account?.subtype === s ? "selected" : ""}>${s}</option>`).join("");
  }
  updateSubtypes();
  typeSelect.addEventListener("change", updateSubtypes);

  $("coa-save").addEventListener("click", async () => {
    const code = $("coa-code").value.trim();
    const name = $("coa-name").value.trim();
    const type = typeSelect.value;
    const subtype = subtypeSelect.value;
    const description = $("coa-desc").value.trim();
    if (!code || !name) { toast("Code and name required", "error"); return; }

    const data = { account_code: code, name, type, subtype, description: description || null };
    if (isEdit) {
      const { error } = await supabase.from("chart_of_accounts").update(data).eq("id", account.id);
      if (error) { toast("Failed: " + error.message, "error"); return; }
      toast("Account updated", "success");
    } else {
      data.business_id = STATE.business.id;
      const { error } = await supabase.from("chart_of_accounts").insert(data);
      if (error) { toast("Failed: " + error.message, "error"); return; }
      toast("Account created", "success");
    }
    closeModal();
    renderCoaTab($("acct-body"));
  });
}

// =====================================================================
// GENERAL LEDGER — reads from journal_entry_lines (proper double-entry)
// =====================================================================
async function renderLedgerTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">General Ledger</div>
      ${periodPickerHtml("month", "gl")}
      <div class="field" style="margin-top:8px;">
        <label>Filter by Account</label>
        <select id="gl-account-filter"><option value="all">All Accounts</option></select>
      </div>
    </div>
    <div id="gl-output"><div class="empty-state">Loading…</div></div>`;

  wirePeriodButtons("gl");
  let allEntries = [];

  const { data: accounts } = await supabase
    .from("chart_of_accounts")
    .select("id, account_code, name, type")
    .or(`business_id.eq.${STATE.business.id},business_id.is.null`)
    .eq("is_active", true)
    .order("account_code");

  const acctFilter = $("gl-account-filter");
  (accounts || []).forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.account_code} — ${a.name}`;
    acctFilter.appendChild(opt);
  });

  $("gl-run").addEventListener("click", () => load());
  $("gl-export").addEventListener("click", () => exportGl());
  $("gl-account-filter").addEventListener("change", () => load());
  await load();

  async function load() {
    const from = $("gl-from").value;
    const to = $("gl-to").value;
    const accountId = $("gl-account-filter").value;
    const out = $("gl-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    let query = supabase
      .from("journal_entries")
      .select("*, lines:journal_entry_lines(*, account:chart_of_accounts(account_code, name, type))")
      .eq("business_id", STATE.business.id)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .eq("is_posted", true)
      .order("entry_date", { ascending: true });

    const { data: jeList } = await query;

    allEntries = [];
    (jeList || []).forEach((je) => {
      (je.lines || []).forEach((l) => {
        if (accountId !== "all" && l.account_id !== accountId) return;
        allEntries.push({
          date: je.entry_date,
          ref: je.journal_number,
          accountCode: l.account?.account_code || "",
          accountName: l.account?.name || "",
          accountType: l.account?.type || "",
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description || je.description || "",
        });
      });
    });

    allEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    let balance = 0;
    allEntries.forEach((e) => {
      balance += e.debit - e.credit;
      e.balance = balance;
    });

    const totalDebit = allEntries.reduce((s, e) => s + e.debit, 0);
    const totalCredit = allEntries.reduce((s, e) => s + e.credit, 0);

    out.innerHTML = `
      <div class="card">
        <div class="card-title" style="justify-content:space-between;">
          <span>GL Entries (${allEntries.length})</span>
          <span style="font-size:13px;">Total Debit: <b>${fmtMoney(totalDebit)}</b> | Total Credit: <b>${fmtMoney(totalCredit)}</b> | Balance: <b>${fmtMoney(balance)}</b></span>
        </div>
        <div class="table-wrap" style="max-height:500px; overflow-y:auto;"><table>
          <thead><tr><th>Date</th><th>Ref</th><th>Account</th><th>Type</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Description</th></tr></thead>
          <tbody>
            ${allEntries.length
              ? allEntries.map((e) => `
                <tr>
                  <td>${fmtDate(e.date)}</td>
                  <td>${escapeHtml(e.ref)}</td>
                  <td><code>${escapeHtml(e.accountCode)}</code> ${escapeHtml(e.accountName)}</td>
                  <td><span class="badge ${coaTypeColor(e.accountType)}">${escapeHtml(e.accountType)}</span></td>
                  <td class="num">${e.debit ? fmtMoney(e.debit) : ""}</td>
                  <td class="num">${e.credit ? fmtMoney(e.credit) : ""}</td>
                  <td class="num" style="font-weight:700;">${fmtMoney(e.balance)}</td>
                  <td class="text-muted">${escapeHtml(e.description)}</td>
                </tr>`).join("")
              : '<tr><td colspan="8"><div class="empty-state">No entries in this range.</div></td></tr>'
            }
          </tbody></table></div>
      </div>`;
  }

  function exportGl() {
    downloadCsv(
      allEntries.map((e) => [e.date, e.ref, e.accountCode, e.accountName, e.accountType, e.debit, e.credit, e.balance, e.description]),
      ["Date", "Ref", "Account Code", "Account Name", "Type", "Debit", "Credit", "Balance", "Description"],
      `general-ledger-${$("gl-from").value}-to-${$("gl-to").value}.csv`,
    );
  }
}

// =====================================================================
// JOURNAL ENTRIES — read from journal_entries + journal_entry_lines
// =====================================================================
async function renderJournalTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>Journal Entries</span>
        <button class="btn btn-primary btn-sm" id="je-add-btn">+ New Entry</button>
      </div>
      ${periodPickerHtml("month", "je")}
    </div>
    <div id="je-output"><div class="empty-state">Loading…</div></div>`;

  wirePeriodButtons("je");
  let entries = [];

  $("je-run").addEventListener("click", () => load());
  $("je-export").addEventListener("click", () => exportJe());
  $("je-add-btn").addEventListener("click", () => openJournalEntryForm(null, () => load()));
  await load();

  async function load() {
    const from = $("je-from").value;
    const to = $("je-to").value;
    const out = $("je-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    const { data: journalHeaders } = await supabase
      .from("journal_entries")
      .select("*, created_by_user:app_users!created_by(full_name)")
      .eq("business_id", STATE.business.id)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: false })
      .limit(200);

    // Load lines for all entries
    const headerIds = (journalHeaders || []).map((h) => h.id);
    const { data: allLines } = headerIds.length ? await supabase
      .from("journal_entry_lines")
      .select("*, account:chart_of_accounts(name, account_code)")
      .in("journal_entry_id", headerIds) : { data: [] };

    const linesByJe = {};
    (allLines || []).forEach((l) => {
      if (!linesByJe[l.journal_entry_id]) linesByJe[l.journal_entry_id] = [];
      linesByJe[l.journal_entry_id].push(l);
    });

    entries = (journalHeaders || []).map((je) => ({
      ...je,
      lines: linesByJe[je.id] || [],
      totalDebit: (linesByJe[je.id] || []).reduce((s, l) => s + Number(l.debit), 0),
      totalCredit: (linesByJe[je.id] || []).reduce((s, l) => s + Number(l.credit), 0),
    }));

    out.innerHTML = entries.length ? `
      <div class="card">
        <div class="table-wrap" style="max-height:500px; overflow-y:auto;"><table>
          <thead><tr><th>Date</th><th>JE #</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th><th></th></tr></thead>
          <tbody>
            ${entries.map((je) => `
              <tr>
                <td>${fmtDate(je.entry_date)}</td>
                <td><b>${escapeHtml(je.journal_number)}</b></td>
                <td>${escapeHtml(je.reference_number || "")}</td>
                <td>${escapeHtml(je.description)}</td>
                <td class="num">${fmtMoney(je.totalDebit)}</td>
                <td class="num">${fmtMoney(je.totalCredit)}</td>
                <td><button class="btn btn-ghost btn-xs" data-view-je="${je.id}">View</button></td>
              </tr>
              ${je.lines.map((l) => `
                <tr style="background:var(--surface-2);">
                  <td></td><td></td>
                  <td style="padding-left:24px;">↳ ${escapeHtml(l.account?.account_code || "")} ${escapeHtml(l.account?.name || "")}</td>
                  <td class="text-muted">${escapeHtml(l.description || "")}</td>
                  <td class="num">${l.debit ? fmtMoney(l.debit) : ""}</td>
                  <td class="num">${l.credit ? fmtMoney(l.credit) : ""}</td>
                  <td></td>
                </tr>
              `).join("")}
            `).join("")}
          </tbody>
        </table></div>
      </div>` : '<div class="card"><div class="empty-state">No journal entries in this range.</div></div>';

    qsa("[data-view-je]", body).forEach((btn) =>
      btn.addEventListener("click", () => {
        const je = entries.find((e) => e.id === btn.dataset.viewJe);
        if (je) openJournalEntryForm(je, () => load());
      }));
  }

  function exportJe() {
    const rows = [];
    entries.forEach((je) => {
      je.lines.forEach((l) => {
        rows.push([
          je.entry_date,
          je.journal_number,
          je.reference_number || "",
          l.account?.account_code || "",
          l.account?.name || "",
          l.debit,
          l.credit,
          l.description || je.description,
        ]);
      });
    });
    downloadCsv(rows,
      ["Date", "JE #", "Reference", "Account Code", "Account Name", "Debit", "Credit", "Description"],
      `journal-entries-${$("je-from").value}-to-${$("je-to").value}.csv`);
  }
}

function openJournalEntryForm(existing, onSaved) {
  const isEdit = !!existing;
  let lines = existing ? existing.lines.map((l) => ({
    accountId: l.account_id,
    accountName: l.account?.name || "",
    accountCode: l.account?.account_code || "",
    debit: Number(l.debit),
    credit: Number(l.credit),
    description: l.description || "",
  })) : [];

  function renderForm() {
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    openModal(`
      <h3>${isEdit ? "View Journal Entry" : "New Journal Entry"}</h3>
      <div class="field"><label>Date</label><input type="date" id="je-form-date" value="${existing ? existing.entry_date : new Date().toISOString().slice(0, 10)}" /></div>
      <div class="field"><label>Description / Narration</label><input id="je-form-desc" value="${escapeHtml(existing ? existing.description : "")}" placeholder="Brief description of this entry" ${isEdit ? "disabled" : ""} /></div>
      ${isEdit && existing.reference_number ? `<div class="field"><label>Reference</label><input value="${escapeHtml(existing.reference_number)}" disabled /></div>` : ""}
      <div class="field"><label style="display:flex;justify-content:space-between;"><span>Lines</span><span style="color:${balanced ? "var(--success)" : "var(--danger)"};">${fmtMoney(totalDebit)} = ${fmtMoney(totalCredit)} ${balanced ? "✅" : "❌"}</span></label></div>
      <div id="je-lines">
        ${lines.map((l, i) => `
          <div class="field-row" style="align-items:end;margin-bottom:6px;" data-line="${i}">
            <div class="field" style="flex:2;">
              <select data-je-account="${i}" style="width:100%;" ${isEdit ? "disabled" : ""}>
                <option value="">Select account</option>
                ${window._coaOptions || ""}
              </select>
            </div>
            <div class="field" style="flex:1;">
              <input type="number" step="0.01" min="0" value="${l.debit || ""}" placeholder="Debit" data-je-debit="${i}" ${isEdit ? "disabled" : ""} />
            </div>
            <div class="field" style="flex:1;">
              <input type="number" step="0.01" min="0" value="${l.credit || ""}" placeholder="Credit" data-je-credit="${i}" ${isEdit ? "disabled" : ""} />
            </div>
            <div class="field" style="flex:1.5;">
              <input value="${escapeHtml(l.description)}" placeholder="Line description" data-je-desc="${i}" ${isEdit ? "disabled" : ""} />
            </div>
            ${isEdit ? "" : `<button class="btn btn-ghost btn-sm" style="color:var(--danger);" data-je-remove="${i}">✕</button>`}
          </div>
        `).join("")}
      </div>
      ${isEdit ? "" : `<button class="btn btn-secondary btn-sm" id="je-add-line">+ Add Line</button>`}
      <div style="margin-top:12px;">
        ${isEdit ? `<button class="btn btn-secondary btn-block" data-close-modal>Close</button>` :
          `<button class="btn btn-primary btn-block" id="je-save" ${balanced ? "" : "disabled"}>Post Journal Entry</button>
           <button class="btn btn-secondary btn-block" data-close-modal>Cancel</button>`}
      </div>
    `, { large: true, onMount: () => {
      if (isEdit) return;
      const coaSelects = qsa("[data-je-account]");
      coaSelects.forEach((sel) => {
        const idx = parseInt(sel.dataset.jeAccount);
        if (lines[idx]) sel.value = lines[idx].accountId;
      });
    }});

    if (isEdit) return;

    qsa("[data-je-debit]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = parseInt(inp.dataset.jeDebit);
        lines[idx].debit = parseFloat(inp.value) || 0;
        closeModal(); renderForm();
      });
    });
    qsa("[data-je-credit]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = parseInt(inp.dataset.jeCredit);
        lines[idx].credit = parseFloat(inp.value) || 0;
        closeModal(); renderForm();
      });
    });
    qsa("[data-je-desc]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const idx = parseInt(inp.dataset.jeDesc);
        lines[idx].description = inp.value;
      });
    });
    qsa("[data-je-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.jeRemove);
        lines.splice(idx, 1);
        closeModal(); renderForm();
      });
    });
    qsa("[data-je-account]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = parseInt(sel.dataset.jeAccount);
        lines[idx].accountId = sel.value;
        lines[idx].accountName = sel.options[sel.selectedIndex]?.text || "";
        lines[idx].accountCode = sel.options[sel.selectedIndex]?.dataset?.code || "";
      });
    });
    $("je-add-line")?.addEventListener("click", () => {
      lines.push({ accountId: "", accountName: "", debit: 0, credit: 0, description: "" });
      closeModal(); renderForm();
    });
    $("je-save")?.addEventListener("click", async () => {
      const date = $("je-form-date").value;
      const desc = $("je-form-desc").value.trim();
      if (!date || !desc) { toast("Date and description required", "error"); return; }
      const validLines = lines.filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));
      if (validLines.length < 2) { toast("Need at least 2 lines for a double-entry", "error"); return; }
      const td = validLines.reduce((s, l) => s + l.debit, 0);
      const tc = validLines.reduce((s, l) => s + l.credit, 0);
      if (Math.abs(td - tc) > 0.01) { toast(`Journal doesn't balance: ${fmtMoney(td)} ≠ ${fmtMoney(tc)}`, "error"); return; }

      const { data: je } = await supabase.rpc("fn_next_journal_number").then(() =>
        supabase.from("journal_entries").insert({
          business_id: STATE.business.id,
          branch_id: STATE.branch?.id,
          journal_number: "JE-" + Date.now(),
          entry_date: date,
          description: desc,
          reference_type: "manual",
          created_by: STATE.appUser.id,
        }).select().single()
      ).catch(async () => {
        // fallback: direct insert
        const { data } = await supabase.from("journal_entries").insert({
          business_id: STATE.business.id,
          branch_id: STATE.branch?.id,
          journal_number: "JE-" + Date.now(),
          entry_date: date,
          description: desc,
          reference_type: "manual",
          created_by: STATE.appUser.id,
        }).select().single();
        return { data };
      });

      if (!je) { toast("Failed to create journal entry", "error"); return; }

      const linesToInsert = validLines.map((l) => ({
        journal_entry_id: je.id,
        account_id: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description || null,
      }));
      const { error } = await supabase.from("journal_entry_lines").insert(linesToInsert);
      if (error) { toast("Failed to save lines: " + error.message, "error"); return; }

      logAuditAction({ action: "create", entityType: "journal_entry", entityId: je.id, entityName: je.journal_number, newValue: { lines: linesToInsert } });
      toast(`Journal entry ${je.journal_number} posted`, "success");
      closeModal();
      if (onSaved) onSaved();
    });
  }

  // Preload CoA options
  if (!window._coaOptions) {
    supabase.from("chart_of_accounts").select("id, account_code, name, type")
      .or(`business_id.eq.${STATE.business.id},business_id.is.null`)
      .eq("is_active", true).order("account_code").then(({ data }) => {
        window._coaOptions = (data || []).map((a) =>
          `<option value="${a.id}" data-code="${escapeHtml(a.account_code)}">${escapeHtml(a.account_code)} — ${escapeHtml(a.name)} (${a.type})</option>`
        ).join("");
        renderForm();
      });
  } else {
    renderForm();
  }
}

// =====================================================================
// TRIAL BALANCE — reads from journal_entry_lines
// =====================================================================
async function renderTrialBalanceTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Trial Balance</div>
      ${periodPickerHtml("month", "tb")}
    </div>
    <div id="tb-output"><div class="empty-state">Loading…</div></div>`;

  wirePeriodButtons("tb");

  $("tb-run").addEventListener("click", () => load());
  $("tb-export").addEventListener("click", () => exportTb());
  await load();

  async function load() {
    const to = $("tb-to").value;
    const out = $("tb-output");
    out.innerHTML = `<div class="empty-state">Loading…</div>`;

    const { data: accounts } = await supabase
      .from("chart_of_accounts")
      .select("id, account_code, name, type")
      .or(`business_id.eq.${STATE.business.id},business_id.is.null`)
      .eq("is_active", true)
      .order("account_code");

    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("debit, credit, account_id, entry:journal_entries!inner(business_id, entry_date, is_posted)")
      .eq("entry.business_id", STATE.business.id)
      .lte("entry.entry_date", to)
      .eq("entry.is_posted", true);

    const acctMap = {};
    (accounts || []).forEach((a) => { acctMap[a.id] = a; });

    const agg = {};
    (lines || []).forEach((l) => {
      if (!agg[l.account_id]) agg[l.account_id] = { debit: 0, credit: 0 };
      agg[l.account_id].debit += Number(l.debit);
      agg[l.account_id].credit += Number(l.credit);
    });

    const rows = Object.entries(agg)
      .map(([id, v]) => ({
        id,
        code: acctMap[id]?.account_code || "",
        name: acctMap[id]?.name || "Unknown",
        type: acctMap[id]?.type || "",
        debit: v.debit,
        credit: v.credit,
        balance: v.debit - v.credit,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = rows.reduce((a, r) => a + r.debit, 0);
    const totalCredit = rows.reduce((a, r) => a + r.credit, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    window._tbRows = rows;

    out.innerHTML = `
      <div class="card" style="border-color:${isBalanced ? "var(--brand)" : "var(--danger)"}; background:${isBalanced ? "var(--brand-light)" : "var(--danger-light)"}; margin-bottom:16px;">
        <b>${isBalanced ? "Trial Balance is balanced" : "Trial Balance is OUT OF BALANCE — investigate."}</b>
      </div>
      <div class="card">
        <div class="card-title">Trial Balance — as of ${escapeHtml(to)}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Account</th><th>Type</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Balance</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td><code>${escapeHtml(r.code)}</code></td>
                <td>${escapeHtml(r.name)}</td>
                <td><span class="badge ${coaTypeColor(r.type)}">${escapeHtml(r.type)}</span></td>
                <td class="num">${r.debit ? fmtMoney(r.debit) : ""}</td>
                <td class="num">${r.credit ? fmtMoney(r.credit) : ""}</td>
                <td class="num" style="font-weight:700; color:${r.balance >= 0 ? "inherit" : "var(--danger)"};">${fmtMoney(r.balance)}</td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr style="font-weight:700; border-top:2px solid var(--border);">
              <td colspan="3">TOTAL</td>
              <td class="num">${fmtMoney(totalDebit)}</td>
              <td class="num">${fmtMoney(totalCredit)}</td>
              <td class="num">${fmtMoney(totalDebit - totalCredit)}</td>
            </tr>
          </tfoot>
        </table></div>
      </div>`;
  }

  function exportTb() {
    const rows = window._tbRows || [];
    downloadCsv(
      rows.map((r) => [r.code, r.name, r.type, r.debit, r.credit, r.balance]),
      ["Code", "Account", "Type", "Debit", "Credit", "Balance"],
      `trial-balance-${$("tb-from").value}-to-${$("tb-to").value}.csv`,
    );
  }
}

// =====================================================================
// EXPENSES
// =====================================================================
async function renderExpensesTab(body) {
  body.innerHTML = `<div class="empty-state">Loading expenses…</div>`;
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("expense_date", { ascending: false })
    .limit(200);
  const expenses = data || [];
  const total = expenses.reduce((a, e) => a + Number(e.amount_base || 0), 0);

  body.innerHTML = `
    <div class="card">
      <div class="card-title">Record an Expense</div>
      <div class="field-row">
        <div class="field"><label>Category</label>
          <select id="ex-category">
            <option>Rent</option><option>Utilities</option><option>Salaries</option>
            <option>Transport</option><option>Airtime/Data</option><option>Supplies</option>
            <option>Repairs &amp; Maintenance</option><option>Marketing</option><option>Other</option>
          </select>
        </div>
        <div class="field"><label>Date</label><input type="date" id="ex-date" value="${new Date().toISOString().slice(0, 10)}" /></div>
      </div>
      <div class="field"><label>Description</label><input id="ex-desc" placeholder="e.g. Shop rent — July" /></div>
      <div class="field-row">
        <div class="field"><label>Amount</label><input type="number" step="0.01" min="0" id="ex-amount" placeholder="0.00" /></div>
        <div class="field"><label>Currency</label>
          <select id="ex-currency">${STATE.currencies.map((c) => `<option value="${c.code}" ${c.is_base ? "selected" : ""}>${c.code}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Payment Method</label>
          <select id="ex-method">
            <option value="cash">Cash</option><option value="mobile_money">Mobile Money</option>
            <option value="bank">Bank</option><option value="card">Card</option><option value="credit">Credit</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" id="add-expense-btn">+ Add Expense</button>
    </div>

    <div class="card">
      <div class="card-title">Recent Expenses <span class="text-muted" style="font-weight:400;">— total ${fmtMoney(total)}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Amount</th><th></th></tr></thead>
          <tbody>
            ${
              !expenses.length
                ? `<tr><td colspan="6"><div class="empty-state">No expenses recorded yet.</div></td></tr>`
                : expenses
                    .map(
                      (e) => `
              <tr>
                <td>${escapeHtml(e.expense_date)}</td>
                <td>${escapeHtml(e.category)}</td>
                <td>${escapeHtml(e.description || "—")}</td>
                <td>${escapeHtml((e.payment_method || "cash").replace("_", " "))}</td>
                <td>${fmtMoneyRaw(Number(e.amount), e.currency_code)}</td>
                <td><button class="btn btn-ghost btn-sm" data-del="${e.id}">Delete</button></td>
              </tr>`,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $("add-expense-btn").addEventListener("click", async () => {
    const category = $("ex-category").value;
    const description = $("ex-desc").value.trim();
    const amount = parseFloat($("ex-amount").value);
    const currency = $("ex-currency").value;
    const method = $("ex-method").value;
    const date = $("ex-date").value;
    if (!amount || amount <= 0) {
      toast("Enter a valid amount", "error");
      return;
    }

    const rate = STATE.rates[currency] ?? 1;
    const amountBase = Math.round((amount * rate + Number.EPSILON) * 100) / 100;

    const { error } = await supabase.from("expenses").insert({
      business_id: STATE.business.id,
      branch_id: STATE.branch?.id,
      category,
      description: description || null,
      amount,
      currency_code: currency,
      amount_base: amountBase,
      payment_method: method,
      expense_date: date,
      created_by: STATE.appUser.id,
    });
    if (error) {
      toast("Failed: " + error.message, "error");
      return;
    }
    toast("Expense recorded", "success");
    renderExpensesTab(body);
  });

  qsa("[data-del]", body).forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!hasRole("admin", "manager", "accountant")) {
        toast("You do not have permission to delete expenses", "error");
        return;
      }
      if (!confirm("Delete this expense?")) return;
      await supabase.from("expenses").delete().eq("id", btn.dataset.del);
      renderExpensesTab(body);
    }),
  );
}

// =====================================================================
// PROFIT & LOSS — reads from journal_entry_lines
// =====================================================================
async function renderPnlTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Profit &amp; Loss</div>
      ${periodPickerHtml("month", "pnl")}
    </div>
    <div id="pnl-output"></div>`;

  wirePeriodButtons("pnl");
  await runPnl();
  $("pnl-run").addEventListener("click", runPnl);
  $("pnl-export").addEventListener("click", exportPnl);

  async function runPnl() {
    const from = $("pnl-from").value;
    const to = $("pnl-to").value;
    const out = $("pnl-output");
    out.innerHTML = `<div class="empty-state">Calculating…</div>`;

    // Use the RPC function if available, otherwise compute from GL tables
    try {
      const { data: glData } = await supabase.rpc("fn_profit_loss", {
        p_business_id: STATE.business.id,
        p_from: from,
        p_to: to,
      });

      if (glData && glData.length) {
        const incomeItems = glData.filter((r) => r.section === "income");
        const expenseItems = glData.filter((r) => r.section === "expense");
        const totalIncome = incomeItems.reduce((s, r) => s + Number(r.amount), 0);
        const totalExpenses = expenseItems.reduce((s, r) => s + Number(r.amount), 0);
        const netProfit = totalIncome - totalExpenses;

        window._pnlData = { incomeItems, expenseItems, totalIncome, totalExpenses, netProfit };

        out.innerHTML = `
          ${nonStatutoryNote()}
          <div class="card">
            <div class="card-title">Profit &amp; Loss — ${escapeHtml(from)} to ${escapeHtml(to)}</div>
            <table class="stmt-table">
              <tr><th colspan="2">Income</th></tr>
              ${incomeItems.map((r) => `
                <tr><td style="padding-left:16px;">${escapeHtml(r.account_name)} (${escapeHtml(r.account_code)})</td><td class="num">${fmtMoney(r.amount)}</td></tr>
              `).join("")}
              <tr class="subtotal"><td><b>Total Income</b></td><td class="num"><b>${fmtMoney(totalIncome)}</b></td></tr>
              <tr><th colspan="2">Expenses</th></tr>
              ${expenseItems.map((r) => `
                <tr><td style="padding-left:16px;">${escapeHtml(r.account_name)} (${escapeHtml(r.account_code)})</td><td class="num">(${fmtMoney(r.amount)})</td></tr>
              `).join("")}
              <tr class="subtotal"><td><b>Total Expenses</b></td><td class="num"><b>(${fmtMoney(totalExpenses)})</b></td></tr>
              <tr class="total"><td><b>Net Profit ${netProfit >= 0 ? "" : "(Loss)"}</b></td><td class="num"><b>${fmtMoney(netProfit)}</b></td></tr>
            </table>
          </div>`;
        return;
      }
    } catch (e) { /* fall through to legacy */ }

    // Fallback: compute from sales & expenses
    const [{ data: sales }, { data: expenses }] = await Promise.all([
      supabase.from("sales").select("*, sale_items(*)").eq("business_id", STATE.business.id)
        .neq("sale_type", "quotation").neq("status", "voided")
        .gte("created_at", `${from}T00:00:00`).lte("created_at", `${to}T23:59:59`),
      supabase.from("expenses").select("*").eq("business_id", STATE.business.id)
        .gte("expense_date", from).lte("expense_date", to),
    ]);

    const salesRows = sales || [];
    const grossRevenue = salesRows.reduce((a, s) => a + Number(s.grand_total_base || 0), 0);
    const vatCollected = salesRows.reduce((a, s) => a + Number(s.vat_total || 0) * Number(s.exchange_rate || 1), 0);
    const netRevenue = grossRevenue - vatCollected;
    const costByProduct = Object.fromEntries(STATE.products.map((p) => [p.id, Number(p.cost_price || 0)]));
    let cogs = 0;
    salesRows.forEach((s) => (s.sale_items || []).forEach((it) => { cogs += Number(it.quantity || 0) * (costByProduct[it.product_id] || 0); }));
    const grossProfit = netRevenue - cogs;
    const expenseRows = expenses || [];
    const expenseByCategory = {};
    expenseRows.forEach((e) => { expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + Number(e.amount_base || 0); });
    const totalExpenses = expenseRows.reduce((a, e) => a + Number(e.amount_base || 0), 0);
    const netProfit = grossProfit - totalExpenses;

    window._pnlData = { grossRevenue, vatCollected, netRevenue, cogs, grossProfit, expenseByCategory, totalExpenses, netProfit };

    out.innerHTML = `
      ${nonStatutoryNote()}
      <div class="card">
        <div class="card-title">Profit &amp; Loss — ${escapeHtml(from)} to ${escapeHtml(to)}</div>
        <table class="stmt-table">
          <tr><td>Gross Sales Revenue (VAT-inclusive)</td><td class="num">${fmtMoney(grossRevenue)}</td></tr>
          <tr><td>Less: VAT Collected</td><td class="num">(${fmtMoney(vatCollected)})</td></tr>
          <tr class="subtotal"><td><b>Net Sales Revenue</b></td><td class="num"><b>${fmtMoney(netRevenue)}</b></td></tr>
          <tr><td>Less: COGS</td><td class="num">(${fmtMoney(cogs)})</td></tr>
          <tr class="subtotal"><td><b>Gross Profit</b></td><td class="num"><b>${fmtMoney(grossProfit)}</b></td></tr>
          ${Object.entries(expenseByCategory).map(([cat, amt]) => `<tr><td>Less: ${escapeHtml(cat)}</td><td class="num">(${fmtMoney(amt)})</td></tr>`).join("")}
          <tr><td><b>Total Operating Expenses</b></td><td class="num">(${fmtMoney(totalExpenses)})</td></tr>
          <tr class="total"><td><b>Net Profit ${netProfit >= 0 ? "" : "(Loss)"}</b></td><td class="num"><b>${fmtMoney(netProfit)}</b></td></tr>
        </table>
      </div>`;
  }

  function exportPnl() {
    const d = window._pnlData || {};
    const rows = "incomeItems" in d ? [
      ...d.incomeItems.map((r) => [r.account_name, r.amount]),
      ["Total Income", d.totalIncome],
      ...d.expenseItems.map((r) => [r.account_name, -r.amount]),
      ["Total Expenses", -d.totalExpenses],
      ["Net Profit", d.netProfit],
    ] : [
      ["Gross Sales Revenue", d.grossRevenue], ["Less: VAT Collected", d.vatCollected],
      ["Net Sales Revenue", d.netRevenue], ["Less: COGS", d.cogs],
      ["Gross Profit", d.grossProfit],
      ...Object.entries(d.expenseByCategory || {}).map(([cat, amt]) => [`Less: ${cat}`, amt]),
      ["Total Expenses", d.totalExpenses], ["Net Profit", d.netProfit],
    ];
    downloadCsv(rows, ["Line Item", "Amount"], `pnl-${$("pnl-from").value}-to-${$("pnl-to").value}.csv`);
  }
}

// =====================================================================
// BALANCE SHEET — reads from journal_entry_lines
// =====================================================================
async function renderBalanceSheetTab(body) {
  body.innerHTML = `<div class="empty-state">Loading balance sheet…</div>`;
  const to = new Date().toISOString().slice(0, 10);

  try {
    const { data: bsData } = await supabase.rpc("fn_balance_sheet", {
      p_business_id: STATE.business.id,
      p_date: to,
    });

    if (bsData && bsData.length) {
      const assets = bsData.filter((r) => r.section === "asset");
      const liabilities = bsData.filter((r) => r.section === "liability");
      const equity = bsData.filter((r) => r.section === "equity");
      const totalAssets = assets.reduce((s, r) => s + Number(r.amount), 0);
      const totalLiabilities = liabilities.reduce((s, r) => s + Number(r.amount), 0);
      const totalEquity = equity.reduce((s, r) => s + Number(r.amount), 0);

      window._bsData = { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity };

      body.innerHTML = `
        ${nonStatutoryNote()}
        <div class="card">
          <div class="card-title">Balance Sheet — as of ${escapeHtml(to)}</div>
          <table class="stmt-table">
            <tr><th colspan="2">Assets</th></tr>
            ${assets.map((r) => `<tr><td style="padding-left:16px;">${escapeHtml(r.account_name)}</td><td class="num">${fmtMoney(r.amount)}</td></tr>`).join("")}
            <tr class="subtotal"><td><b>Total Assets</b></td><td class="num"><b>${fmtMoney(totalAssets)}</b></td></tr>
            <tr><th colspan="2">Liabilities</th></tr>
            ${liabilities.map((r) => `<tr><td style="padding-left:16px;">${escapeHtml(r.account_name)}</td><td class="num">${fmtMoney(r.amount)}</td></tr>`).join("")}
            <tr class="subtotal"><td><b>Total Liabilities</b></td><td class="num"><b>${fmtMoney(totalLiabilities)}</b></td></tr>
            <tr><th colspan="2">Equity</th></tr>
            ${equity.map((r) => `<tr><td style="padding-left:16px;">${escapeHtml(r.account_name)}</td><td class="num">${fmtMoney(r.amount)}</td></tr>`).join("")}
            <tr class="subtotal"><td><b>Total Equity</b></td><td class="num"><b>${fmtMoney(totalEquity)}</b></td></tr>
            <tr class="total"><td><b>Liabilities + Equity</b></td><td class="num"><b>${fmtMoney(totalLiabilities + totalEquity)}</b></td></tr>
          </table>
        </div>`;
      return;
    }
  } catch (e) { /* fall through */ }

  // Fallback: compute from operational data
  const [{ data: allPayments }, { data: allExpenses }, { data: allSupplierPayments }, { data: receivedPOItems }] = await Promise.all([
    supabase.from("payments").select("amount_base, sales!inner(business_id)").eq("sales.business_id", STATE.business.id),
    supabase.from("expenses").select("amount_base").eq("business_id", STATE.business.id),
    supabase.from("supplier_payments").select("amount, suppliers!inner(business_id)").eq("suppliers.business_id", STATE.business.id),
    supabase.from("purchase_order_items").select("quantity, unit_cost, purchase_orders!inner(business_id, status)").eq("purchase_orders.business_id", STATE.business.id).eq("purchase_orders.status", "received"),
  ]);

  const cashIn = (allPayments || []).reduce((a, p) => a + Number(p.amount_base || 0), 0);
  const cashOutExpenses = (allExpenses || []).reduce((a, e) => a + Number(e.amount_base || 0), 0);
  const cashOutSuppliers = (allSupplierPayments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
  const estimatedCash = cashIn - cashOutExpenses - cashOutSuppliers;
  const inventoryValue = STATE.products.reduce((a, p) => a + stockFor(p.id) * Number(p.cost_price || 0), 0);
  const accountsReceivable = STATE.customers.reduce((a, c) => a + Math.max(0, Number(c.balance || 0)), 0);
  const accountsPayableGross = (receivedPOItems || []).reduce((a, it) => a + Number(it.quantity || 0) * Number(it.unit_cost || 0), 0);
  const accountsPayable = Math.max(0, accountsPayableGross - cashOutSuppliers);
  const totalAssets = Math.max(0, estimatedCash) + inventoryValue + accountsReceivable;
  const totalLiabilities = accountsPayable;
  const equity = totalAssets - totalLiabilities;

  window._bsData = { estimatedCash, inventoryValue, accountsReceivable, accountsPayable, totalAssets, totalLiabilities, equity };

  body.innerHTML = `
    ${nonStatutoryNote()}
    <div class="card">
      <div class="card-title">Balance Sheet — Managerial Estimate</div>
      <table class="stmt-table">
        <tr><th colspan="2">Assets</th></tr>
        <tr><td style="padding-left:16px;">Cash & Bank</td><td class="num">${fmtMoney(Math.max(0, estimatedCash))}</td></tr>
        <tr><td style="padding-left:16px;">Inventory <span class="text-muted">(at cost)</span></td><td class="num">${fmtMoney(inventoryValue)}</td></tr>
        <tr><td style="padding-left:16px;">Accounts Receivable</td><td class="num">${fmtMoney(accountsReceivable)}</td></tr>
        <tr class="subtotal"><td><b>Total Assets</b></td><td class="num"><b>${fmtMoney(totalAssets)}</b></td></tr>
        <tr><th colspan="2">Liabilities</th></tr>
        <tr><td style="padding-left:16px;">Accounts Payable</td><td class="num">${fmtMoney(accountsPayable)}</td></tr>
        <tr class="subtotal"><td><b>Total Liabilities</b></td><td class="num"><b>${fmtMoney(totalLiabilities)}</b></td></tr>
        <tr class="subtotal"><td><b>Equity (Estimated)</b></td><td class="num"><b>${fmtMoney(equity)}</b></td></tr>
        <tr class="total"><td><b>Liabilities + Equity</b></td><td class="num"><b>${fmtMoney(totalLiabilities + equity)}</b></td></tr>
      </table>
    </div>`;
  }

// =====================================================================
// CASH FLOW
// =====================================================================
async function renderCashFlowTab(body) {
  const range = periodRange("month");
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Cash Flow</div>
      ${periodPickerHtml("month", "cf")}
    </div>
    <div id="cf-output"></div>`;

  wirePeriodButtons("cf");
  await runCashFlow();
  $("cf-run").addEventListener("click", runCashFlow);
  $("cf-export").addEventListener("click", exportCf);

  async function runCashFlow() {
    const from = $("cf-from").value;
    const to = $("cf-to").value;
    const out = $("cf-output");
    out.innerHTML = `<div class="empty-state">Crunching numbers…</div>`;

    const [{ data: payments }, { data: expenses }, { data: supplierPayments }] =
      await Promise.all([
        supabase
          .from("payments")
          .select("amount_base, method, sales!inner(business_id)")
          .eq("sales.business_id", STATE.business.id)
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`),
        supabase
          .from("expenses")
          .select("amount_base, method:payment_method")
          .eq("business_id", STATE.business.id)
          .gte("expense_date", from)
          .lte("expense_date", to),
        supabase
          .from("supplier_payments")
          .select("amount, suppliers!inner(business_id)")
          .eq("suppliers.business_id", STATE.business.id)
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`),
      ]);

    const inByMethod = {};
    (payments || []).forEach((p) => {
      inByMethod[p.method] =
        (inByMethod[p.method] || 0) + Number(p.amount_base || 0);
    });
    const totalIn = Object.values(inByMethod).reduce((a, v) => a + v, 0);

    const outByMethod = {};
    (expenses || []).forEach((e) => {
      outByMethod[e.method] =
        (outByMethod[e.method] || 0) + Number(e.amount_base || 0);
    });
    const totalExpenseOut = Object.values(outByMethod).reduce(
      (a, v) => a + v,
      0,
    );
    const totalSupplierOut = (supplierPayments || []).reduce(
      (a, p) => a + Number(p.amount || 0),
      0,
    );
    const totalOut = totalExpenseOut + totalSupplierOut;
    const net = totalIn - totalOut;

    window._cfData = {
      inByMethod,
      totalIn,
      outByMethod,
      totalExpenseOut,
      totalSupplierOut,
      totalOut,
      net,
    };

    out.innerHTML = `
      ${nonStatutoryNote()}
      <div class="card">
        <div class="card-title">Cash Flow — ${escapeHtml(from)} to ${escapeHtml(to)}</div>
        <table class="stmt-table">
          <tr><td colspan="2"><b>Cash In (from sales payments)</b></td></tr>
          ${
            Object.entries(inByMethod)
              .map(
                ([m, amt]) =>
                  `<tr><td>${escapeHtml(m.replace("_", " "))}</td><td class="num">${fmtMoney(amt)}</td></tr>`,
              )
              .join("") ||
            '<tr><td class="text-muted">No payments in range</td><td></td></tr>'
          }
          <tr class="subtotal"><td><b>Total Cash In</b></td><td class="num"><b>${fmtMoney(totalIn)}</b></td></tr>
          <tr><td colspan="2" style="padding-top:14px;"><b>Cash Out</b></td></tr>
          ${Object.entries(outByMethod)
            .map(
              ([m, amt]) =>
                `<tr><td>Expenses — ${escapeHtml(m.replace("_", " "))}</td><td class="num">(${fmtMoney(amt)})</td></tr>`,
            )
            .join("")}
          <tr><td>Supplier Payments</td><td class="num">(${fmtMoney(totalSupplierOut)})</td></tr>
          <tr class="subtotal"><td><b>Total Cash Out</b></td><td class="num"><b>(${fmtMoney(totalOut)})</b></td></tr>
          <tr class="total"><td><b>Net Cash Flow</b></td><td class="num"><b>${fmtMoney(net)}</b></td></tr>
        </table>
      </div>`;
  }

  function exportCf() {
    const d = window._cfData || {};
    const rows = [];
    Object.entries(d.inByMethod || {}).forEach(([m, amt]) =>
      rows.push([`Cash In — ${m}`, amt, ""]),
    );
    rows.push(["Total Cash In", d.totalIn, ""]);
    Object.entries(d.outByMethod || {}).forEach(([m, amt]) =>
      rows.push([`Expense — ${m}`, "", amt]),
    );
    rows.push(["Supplier Payments", "", d.totalSupplierOut]);
    rows.push(["Total Cash Out", "", d.totalOut]);
    rows.push(["Net Cash Flow", d.net, ""]);
    downloadCsv(
      rows,
      ["Description", "Inflow", "Outflow"],
      `cashflow-${$("cf-from").value}-to-${$("cf-to").value}.csv`,
    );
  }
}

// ---------------------------------------------------------------------
// FUND TRANSFERS TAB
// ---------------------------------------------------------------------
async function fetchOrCreateAccounts() {
  let { data: accounts } = await supabase
    .from("account_balances")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("account_name");

  if (!accounts || accounts.length === 0) {
    await supabase.rpc("seed_default_accounts", {
      p_business_id: STATE.business.id,
    });
    ({ data: accounts } = await supabase
      .from("account_balances")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("account_name"));
  }

  return accounts || [];
}

async function renderTransfersTab(body) {
  const [transfersResult, allAccounts] = await Promise.all([
    supabase
      .from("fund_transfers")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("created_at", { ascending: false })
      .limit(200),
    fetchOrCreateAccounts(),
  ]);

  const allTransfers = transfersResult.data || [];
  const totalMoved = allTransfers
    .filter((t) => t.status === "completed")
    .reduce((a, t) => a + Number(t.amount || 0), 0);
  const totalFees = allTransfers.reduce((a, t) => a + Number(t.fee || 0), 0);

  body.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi-card"><div class="label">Total Transferred</div><div class="value">${fmtMoney(totalMoved)}</div></div>
      <div class="kpi-card"><div class="label">Total Fees</div><div class="value" style="color:var(--danger);">${fmtMoney(totalFees)}</div></div>
      <div class="kpi-card"><div class="label">Transfers</div><div class="value">${allTransfers.length}</div></div>
      <div class="kpi-card"><div class="label">Accounts</div><div class="value">${allAccounts.length}</div></div>
    </div>

    <div class="grid-2" style="gap:16px; margin-bottom:16px;">
      <div class="card">
        <div class="card-title">Account Balances</div>
        ${
          allAccounts.length
            ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Account</th><th>Type</th><th>Balance</th></tr></thead>
            <tbody>
              ${allAccounts
                .map(
                  (a) => `
                <tr>
                  <td><b>${escapeHtml(a.account_name.replace(/_/g, " "))}</b></td>
                  <td><span class="badge badge-${a.account_type === "cash" ? "green" : a.account_type === "bank" ? "blue" : "purple"}">${a.account_type}</span></td>
                  <td style="font-weight:700;">${fmtMoney(a.balance)}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table></div>
        `
            : '<div class="empty-state">No accounts configured yet. Accounts are auto-created for new businesses.</div>'
        }
      </div>

      <div class="card">
        <div class="card-title">New Transfer</div>
        <div class="field">
          <label>From Account</label>
          <select id="ft-from">
            ${allAccounts.map((a) => `<option value="${a.account_name}">${escapeHtml(a.account_name.replace(/_/g, " "))} (${fmtMoney(a.balance)})</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>To Account</label>
          <select id="ft-to">
            ${allAccounts.map((a) => `<option value="${a.account_name}">${escapeHtml(a.account_name.replace(/_/g, " "))}</option>`).join("")}
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label>Amount *</label><input id="ft-amount" type="number" min="0" step="0.01" /></div>
          <div class="field"><label>Fee</label><input id="ft-fee" type="number" min="0" step="0.01" value="0" /></div>
        </div>
        <div class="field"><label>Reference</label><input id="ft-ref" placeholder="Optional reference number" /></div>
        <div class="field"><label>Notes</label><textarea id="ft-notes" rows="2"></textarea></div>
        <button class="btn btn-primary btn-block" id="ft-save">🔄 Transfer Funds</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Transfer History</div>
      ${
        allTransfers.length
          ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>From</th><th>To</th><th>Amount</th><th>Fee</th><th>Status</th></tr></thead>
          <tbody>
            ${allTransfers
              .map(
                (t) => `
              <tr>
                <td style="white-space:nowrap;">${new Date(t.created_at).toLocaleString("en-UG")}</td>
                <td>${escapeHtml(t.from_account.replace(/_/g, " "))}</td>
                <td>${escapeHtml(t.to_account.replace(/_/g, " "))}</td>
                <td style="font-weight:700;">${fmtMoney(t.amount)}</td>
                <td>${t.fee ? fmtMoney(t.fee) : "—"}</td>
                <td><span class="badge badge-${t.status === "completed" ? "green" : t.status === "cancelled" ? "red" : "yellow"}">${t.status}</span></td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table></div>
      `
          : '<div class="empty-state">No transfers yet.</div>'
      }
    </div>
  `;

  // Wire save
  $("ft-save")?.addEventListener("click", async () => {
    const from = $("ft-from")?.value;
    const to = $("ft-to")?.value;
    const amount = parseFloat($("ft-amount")?.value);
    const fee = parseFloat($("ft-fee")?.value || 0);
    if (!from || !to || !amount || amount <= 0) {
      toast("Fill in from, to, and a valid amount", "error");
      return;
    }
    if (from === to) {
      toast("Cannot transfer to the same account", "error");
      return;
    }

    // Record transfer
    const { error } = await supabase.from("fund_transfers").insert({
      business_id: STATE.business.id,
      branch_id: STATE.branch?.id,
      from_account: from,
      to_account: to,
      amount,
      fee,
      reference: $("ft-ref")?.value.trim() || null,
      notes: $("ft-notes")?.value.trim() || null,
      status: "completed",
      initiated_by: STATE.appUser.id,
    });
    if (error) {
      toast("Transfer failed: " + error.message, "error");
      return;
    }

    // Update account balances
    const fromAcct = allAccounts.find((a) => a.account_name === from);
    const toAcct = allAccounts.find((a) => a.account_name === to);
    if (fromAcct) {
      await supabase
        .from("account_balances")
        .update({
          balance: Number(fromAcct.balance) - amount - fee,
          last_updated: new Date().toISOString(),
        })
        .eq("id", fromAcct.id);
    }
    if (toAcct) {
      await supabase
        .from("account_balances")
        .update({
          balance: Number(toAcct.balance) + amount,
          last_updated: new Date().toISOString(),
        })
        .eq("id", toAcct.id);
    }

    toast("Funds transferred", "success");
    renderTransfersTab(body);
  });
}

// ---------------------------------------------------------------------
// DEPOSITS TAB
// ---------------------------------------------------------------------
async function renderDepositsTab(body) {
  const [depositsResult, allAccounts] = await Promise.all([
    supabase
      .from("deposits")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("deposit_date", { ascending: false })
      .limit(200),
    fetchOrCreateAccounts(),
  ]);

  const allDeposits = depositsResult.data || [];
  const totalDeposited = allDeposits
    .filter((d) => d.status === "confirmed")
    .reduce((a, d) => a + Number(d.amount || 0), 0);
  const monthDeposits = allDeposits.filter((d) => {
    const dt = new Date(d.deposit_date);
    const now = new Date();
    return (
      dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear()
    );
  });
  const monthTotal = monthDeposits.reduce(
    (a, d) => a + Number(d.amount || 0),
    0,
  );

  body.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi-card"><div class="label">Total Deposited</div><div class="value">${fmtMoney(totalDeposited)}</div></div>
      <div class="kpi-card"><div class="label">This Month</div><div class="value">${fmtMoney(monthTotal)}</div></div>
      <div class="kpi-card"><div class="label">Total Deposits</div><div class="value">${allDeposits.length}</div></div>
    </div>

    <div class="grid-2" style="gap:16px; margin-bottom:16px;">
      <div class="card">
        <div class="card-title">Record Deposit</div>
        <div class="field">
          <label>Deposit To Account *</label>
          <select id="dep-account">
            ${allAccounts
              .filter((a) => a.account_type !== "cash")
              .map(
                (a) =>
                  `<option value="${a.account_name}">${escapeHtml(a.account_name.replace(/_/g, " "))} (${fmtMoney(a.balance)})</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label>Amount *</label><input id="dep-amount" type="number" min="0" step="0.01" /></div>
          <div class="field">
            <label>Method</label>
            <select id="dep-method">
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="transfer">Transfer</option>
              <option value="mobile_money">Mobile Money</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>Deposit Date</label><input id="dep-date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
          <div class="field"><label>Reference</label><input id="dep-ref" placeholder="Optional" /></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="dep-notes" rows="2"></textarea></div>
        <button class="btn btn-primary btn-block" id="dep-save">🏦 Record Deposit</button>
      </div>

      <div class="card">
        <div class="card-title">Deposit Summary by Account</div>
        ${
          allAccounts
            .filter((a) => a.account_type !== "cash")
            .map((a) => {
              const acctDeposits = allDeposits.filter(
                (d) => d.account === a.account_name && d.status === "confirmed",
              );
              const acctTotal = acctDeposits.reduce(
                (s, d) => s + Number(d.amount || 0),
                0,
              );
              return `
            <div class="summary-row">
              <span>${escapeHtml(a.account_name.replace(/_/g, " "))}</span>
              <span><b>${fmtMoney(acctTotal)}</b> (${acctDeposits.length} deposits)</span>
            </div>
          `;
            })
            .join("") ||
          '<div class="empty-state">No bank/mobile accounts.</div>'
        }
      </div>
    </div>

    <div class="card">
      <div class="card-title">Deposit History</div>
      ${
        allDeposits.length
          ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Account</th><th>Method</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>
            ${allDeposits
              .map(
                (d) => `
              <tr>
                <td>${d.deposit_date}</td>
                <td>${escapeHtml(d.account.replace(/_/g, " "))}</td>
                <td><span class="badge badge-gray">${d.deposit_method}</span></td>
                <td style="font-weight:700;">${fmtMoney(d.amount)}</td>
                <td>${escapeHtml(d.reference || "—")}</td>
                <td><span class="badge badge-${d.status === "confirmed" ? "green" : d.status === "reversed" ? "red" : "yellow"}">${d.status}</span></td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table></div>
      `
          : '<div class="empty-state">No deposits recorded yet.</div>'
      }
    </div>
  `;

  // Wire save
  $("dep-save")?.addEventListener("click", async () => {
    const account = $("dep-account")?.value;
    const amount = parseFloat($("dep-amount")?.value);
    if (!account || !amount || amount <= 0) {
      toast("Select account and enter a valid amount", "error");
      return;
    }

    const { error } = await supabase.from("deposits").insert({
      business_id: STATE.business.id,
      branch_id: STATE.branch?.id,
      account,
      amount,
      deposit_method: $("dep-method")?.value,
      reference: $("dep-ref")?.value.trim() || null,
      deposit_date: $("dep-date")?.value,
      notes: $("dep-notes")?.value.trim() || null,
      status: "confirmed",
      recorded_by: STATE.appUser.id,
    });
    if (error) {
      toast("Deposit failed: " + error.message, "error");
      return;
    }

    // Update account balance
    const acct = allAccounts.find((a) => a.account_name === account);
    if (acct) {
      await supabase
        .from("account_balances")
        .update({
          balance: Number(acct.balance) + amount,
          last_updated: new Date().toISOString(),
        })
        .eq("id", acct.id);
    }

    toast("Deposit recorded", "success");
    renderDepositsTab(body);
  });
}
