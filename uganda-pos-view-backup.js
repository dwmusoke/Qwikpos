// =====================================================================
// QWICKPOS — DATABASE BACKUP & RESTORE
// Export/import business data as JSON, download/upload backups
// =====================================================================
import {
  supabase,
  STATE,
  $,
  escapeHtml,
  toast,
  openModal,
  closeModal,
  fmtDate,
} from "./uganda-pos-core.js";

const BACKUP_TABLES = [
  "products",
  "categories",
  "tax_categories",
  "brands",
  "units",
  "customers",
  "suppliers",
  "sales",
  "sale_items",
  "payments",
  "purchase_orders",
  "purchase_order_items",
  "supplier_payments",
  "product_stock",
  "stock_movements",
  "stock_counts",
  "stock_count_items",
  "expenses",
  "expense_categories",
  "quotations",
  "quotation_items",
  "efris_invoices",
  "leads",
  "lead_activities",
  "deliveries",
  "delivery_items",
  "delivery_status_log",
  "employees",
  "departments",
  "designations",
  "attendance",
  "leave_requests",
  "payroll",
  "leave_types",
  "notification_templates",
  "notification_log",
  "audit_logs",
];

export async function renderBackupRestore(root) {
  root.innerHTML = `
    <div class="view-header">
      <div><h2>Database Backup & Restore</h2><p class="sub">Export your business data or restore from a backup</p></div>
    </div>

    <div class="grid-2" style="gap:24px;">
      <div class="card">
        <div class="card-title">📤 Export Backup</div>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
          Downloads a JSON file containing all your business data. Store it safely — this is your data insurance.
        </p>
        <div class="field">
          <label>What to export</label>
          <select id="backup-scope">
            <option value="all">All data (full backup)</option>
            <option value="core">Core only (products, sales, customers, suppliers)</option>
            <option value="accounting">Accounting only (journal, ledger, expenses)</option>
          </select>
        </div>
        <div id="backup-progress" style="display:none; margin:12px 0;">
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
            <span id="backup-status">Exporting…</span>
            <span id="backup-count">0/0</span>
          </div>
          <div style="height:6px; background:var(--bg); border-radius:3px; overflow:hidden;">
            <div id="backup-bar" style="height:100%; background:var(--brand); width:0%; transition:width 0.3s;"></div>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="backup-export-btn">📤 Download Backup</button>
      </div>

      <div class="card">
        <div class="card-title">📥 Restore from Backup</div>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
          Upload a previously exported JSON backup file. This will <b>add</b> data to your business (existing records are not overwritten).
        </p>
        <div class="field">
          <label>Backup file (JSON)</label>
          <input type="file" id="backup-file" accept=".json" />
        </div>
        <div class="field">
          <label>Conflict handling</label>
          <select id="backup-conflict">
            <option value="skip">Skip if exists (safer)</option>
            <option value="update">Update if name matches</option>
          </select>
        </div>
        <div id="restore-progress" style="display:none; margin:12px 0;">
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
            <span id="restore-status">Restoring…</span>
            <span id="restore-count">0/0</span>
          </div>
          <div style="height:6px; background:var(--bg); border-radius:3px; overflow:hidden;">
            <div id="restore-bar" style="height:100%; background:var(--brand); width:0%; transition:width 0.3s;"></div>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="backup-import-btn">📥 Restore Backup</button>
      </div>
    </div>

    <div class="card" style="margin-top:24px;">
      <div class="card-title">📋 Recent Backups</div>
      <div id="backup-history">
        <div class="empty-state">Backup history is stored locally in your browser.</div>
      </div>
    </div>
  `;

  renderBackupHistory();

  // Export
  $("backup-export-btn").addEventListener("click", exportBackup);

  // Import
  $("backup-import-btn").addEventListener("click", importBackup);
}

async function exportBackup() {
  const scope = $("backup-scope")?.value || "all";
  const btn = $("backup-export-btn");
  const progress = $("backup-progress");
  const statusEl = $("backup-status");
  const countEl = $("backup-count");
  const bar = $("backup-bar");

  let tables = [...BACKUP_TABLES];
  if (scope === "core") {
    tables = [
      "products",
      "categories",
      "tax_categories",
      "brands",
      "units",
      "customers",
      "suppliers",
      "sales",
      "sale_items",
      "payments",
      "product_stock",
      "stock_movements",
    ];
  } else if (scope === "accounting") {
    tables = [
      "expenses",
      "expense_categories",
      "payments",
      "supplier_payments",
      "audit_logs",
    ];
  }

  btn.disabled = true;
  progress.style.display = "block";
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    businessId: STATE.business?.id,
    businessName: STATE.business?.name,
    scope,
    tables: {},
  };

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    statusEl.textContent = `Exporting ${table}…`;
    countEl.textContent = `${i + 1}/${tables.length}`;
    bar.style.width = `${((i + 1) / tables.length) * 100}%`;

    try {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("business_id", STATE.business.id)
        .limit(10000);
      if (!error && data) {
        backup.tables[table] = data;
      }
    } catch (e) {
      console.warn(`Backup export failed for ${table}:`, e);
    }
  }

  // Download
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qwickpos-backup-${STATE.business?.name?.replace(/\s+/g, "-") || "business"}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  // Save to history
  const history = JSON.parse(
    localStorage.getItem("ugpos_backup_history") || "[]",
  );
  history.unshift({
    date: new Date().toISOString(),
    scope,
    size: json.length,
    tables: Object.keys(backup.tables).length,
  });
  localStorage.setItem(
    "ugpos_backup_history",
    JSON.stringify(history.slice(0, 20)),
  );

  btn.disabled = false;
  statusEl.textContent = "Export complete!";
  bar.style.width = "100%";
  toast(`Backup exported (${(json.length / 1024).toFixed(1)} KB)`, "success");
  setTimeout(() => {
    progress.style.display = "none";
  }, 2000);
  renderBackupHistory();
}

async function importBackup() {
  const fileInput = $("backup-file");
  const conflict = $("backup-conflict")?.value || "skip";
  const btn = $("backup-import-btn");
  const progress = $("restore-progress");
  const statusEl = $("restore-status");
  const countEl = $("restore-count");
  const bar = $("restore-bar");

  if (!fileInput?.files?.length) {
    toast("Select a backup file first", "error");
    return;
  }

  const file = fileInput.files[0];
  let backup;
  try {
    const text = await file.text();
    backup = JSON.parse(text);
  } catch (e) {
    toast("Invalid backup file", "error");
    return;
  }

  if (!backup.tables || !backup.version) {
    toast("Invalid backup format", "error");
    return;
  }

  const tableNames = Object.keys(backup.tables);
  if (!tableNames.length) {
    toast("Backup contains no data", "error");
    return;
  }

  if (
    !confirm(
      `Restore ${tableNames.length} tables from backup?\n\nThis will ADD data to your existing records.`,
    )
  ) {
    return;
  }

  btn.disabled = true;
  progress.style.display = "block";
  let totalInserted = 0;
  let totalSkipped = 0;

  for (let i = 0; i < tableNames.length; i++) {
    const table = tableNames[i];
    const rows = backup.tables[table];
    if (!rows?.length) continue;

    statusEl.textContent = `Restoring ${table}…`;
    countEl.textContent = `${i + 1}/${tableNames.length}`;
    bar.style.width = `${((i + 1) / tableNames.length) * 100}%`;

    try {
      // Remove business_id from rows and add current business_id
      const cleanRows = rows.map((r) => {
        const { id, created_at, updated_at, ...rest } = r;
        return { ...rest, business_id: STATE.business.id };
      });

      if (conflict === "skip") {
        const { data: existing } = await supabase
          .from(table)
          .select("id")
          .eq("business_id", STATE.business.id)
          .limit(1);
        if (existing?.length) {
          totalSkipped += rows.length;
          continue;
        }
      }

      // Batch insert (100 at a time)
      for (let j = 0; j < cleanRows.length; j += 100) {
        const batch = cleanRows.slice(j, j + 100);
        const { error } = await supabase
          .from(table)
          .insert(batch, { onConflict: "id" });
        if (!error) totalInserted += batch.length;
      }
    } catch (e) {
      console.warn(`Restore failed for ${table}:`, e);
    }
  }

  btn.disabled = false;
  statusEl.textContent = "Restore complete!";
  bar.style.width = "100%";
  toast(`Restored ${totalInserted} rows (${totalSkipped} skipped)`, "success");
  setTimeout(() => {
    progress.style.display = "none";
  }, 2000);
}

function renderBackupHistory() {
  const history = JSON.parse(
    localStorage.getItem("ugpos_backup_history") || "[]",
  );
  const el = $("backup-history");
  if (!el) return;

  if (!history.length) {
    el.innerHTML =
      '<div class="empty-state">No backups yet. Create your first backup above.</div>';
    return;
  }

  el.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Scope</th><th>Size</th><th>Tables</th></tr></thead>
      <tbody>
        ${history
          .map(
            (h) => `
          <tr>
            <td>${fmtDate(h.date)}</td>
            <td><span class="badge badge-${h.scope === "all" ? "green" : h.scope === "core" ? "blue" : "gray"}">${h.scope}</span></td>
            <td>${(h.size / 1024).toFixed(1)} KB</td>
            <td>${h.tables}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table></div>
  `;
}
