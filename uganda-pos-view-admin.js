// =====================================================================
// QWICKPOS — SUPERADMIN CONSOLE (v2)
// Full platform management: vendors, users, branches, impersonation
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
  fmtDate,
  hasRole,
} from "./uganda-pos-core.js";

let _activeTab = "overview";

export async function renderAdmin(root) {
  root.innerHTML = `<div class="empty-state">Loading platform data…</div>`;

  const [
    { data: businesses },
    { data: subs },
    { data: users },
    { data: plans },
    { data: payments },
    { data: branches },
    { data: salesCount },
    { data: products },
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("subscriptions").select("*, plans(name, code, price_ugx)"),
    supabase
      .from("app_users")
      .select("id, business_id, full_name, role, is_active, phone, created_at"),
    supabase.from("plans").select("*").order("sort_order"),
    supabase
      .from("subscription_payments")
      .select("*, plans(name)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("branches").select("*"),
    supabase
      .from("sales")
      .select("id, grand_total_base, created_at, status, sale_type"),
    supabase.from("products").select("id, business_id, is_active"),
  ]);

  const subByBusiness = {};
  (subs || []).forEach((s) => {
    subByBusiness[s.business_id] = s;
  });
  const usersByBusiness = {};
  (users || []).forEach((u) => {
    (usersByBusiness[u.business_id] ||= []).push(u);
  });
  const branchesByBusiness = {};
  (branches || []).forEach((b) => {
    (branchesByBusiness[b.business_id] ||= []).push(b);
  });
  const businessById = {};
  (businesses || []).forEach((b) => {
    businessById[b.id] = b;
  });

  const now = new Date();
  const activeCount = (subs || []).filter((s) => isActive(s, now)).length;
  const trialCount = (subs || []).filter(
    (s) => s.status === "trialing" && isActive(s, now),
  ).length;
  const mrr = (subs || [])
    .filter((s) => s.status === "active" && isActive(s, now))
    .reduce((a, s) => a + Number(s.plans?.price_ugx || 0), 0);
  const totalSales = (salesCount || []).filter(
    (s) => s.status === "completed" && s.sale_type === "retail",
  ).length;
  const totalRevenue = (salesCount || [])
    .filter((s) => s.status === "completed" && s.sale_type === "retail")
    .reduce((a, s) => a + Number(s.grand_total_base || 0), 0);
  const totalProducts = (products || []).length;
  const totalUsers = (users || []).length;

  root.innerHTML = `
    <div class="view-header">
      <div><h2>Platform Admin</h2><p class="sub">Manage all vendors, users, and branches</p></div>
    </div>

    <div class="admin-tabs" id="admin-tabs">
      <button class="admin-tab ${_activeTab === "overview" ? "active" : ""}" data-tab="overview">Overview</button>
      <button class="admin-tab ${_activeTab === "vendors" ? "active" : ""}" data-tab="vendors">Vendors</button>
      <button class="admin-tab ${_activeTab === "users" ? "active" : ""}" data-tab="users">Users</button>
      <button class="admin-tab ${_activeTab === "branches" ? "active" : ""}" data-tab="branches">Branches</button>
      <button class="admin-tab ${_activeTab === "plans" ? "active" : ""}" data-tab="plans">Plans & Payments</button>
    </div>

    <div id="admin-tab-content"></div>
  `;

  qsa(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      _activeTab = tab.dataset.tab;
      qsa(".admin-tab").forEach((t) =>
        t.classList.toggle("active", t.dataset.tab === _activeTab),
      );
      renderTabContent();
    });
  });

  function renderTabContent() {
    const el = $("admin-tab-content");
    if (_activeTab === "overview")
      renderOverview(el, {
        businesses,
        subs,
        users,
        plans,
        payments,
        branches,
        salesCount,
        products,
        totalSales,
        totalRevenue,
        totalProducts,
        totalUsers,
        activeCount,
        trialCount,
        mrr,
        now,
        businessById,
        usersByBusiness,
        branchesByBusiness,
        subByBusiness,
      });
    else if (_activeTab === "vendors")
      renderVendors(el, {
        businesses,
        subs,
        users,
        branches,
        plans,
        businessById,
        usersByBusiness,
        branchesByBusiness,
        subByBusiness,
        now,
      });
    else if (_activeTab === "users")
      renderUsers(el, { users, businesses, businessById });
    else if (_activeTab === "branches")
      renderBranches(el, { branches, businesses, businessById });
    else if (_activeTab === "plans")
      renderPlans(el, {
        plans,
        payments,
        businesses,
        businessById,
        subByBusiness,
      });
  }

  renderTabContent();
}

// ---------------------------------------------------------------------
// OVERVIEW TAB
// ---------------------------------------------------------------------
function renderOverview(el, d) {
  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="label">Vendors</div><div class="value">${d.businesses?.length || 0}</div></div>
      <div class="kpi-card"><div class="label">On Trial</div><div class="value">${d.trialCount}</div></div>
      <div class="kpi-card"><div class="label">Active Paid</div><div class="value">${Math.max(0, d.activeCount - d.trialCount)}</div></div>
      <div class="kpi-card"><div class="label">Est. MRR</div><div class="value">UGX ${d.mrr.toLocaleString("en-UG")}</div></div>
      <div class="kpi-card"><div class="label">Total Users</div><div class="value">${d.totalUsers}</div></div>
      <div class="kpi-card"><div class="label">Total Products</div><div class="value">${d.totalProducts}</div></div>
      <div class="kpi-card"><div class="label">Total Sales</div><div class="value">${d.totalSales}</div></div>
      <div class="kpi-card"><div class="label">Total Revenue</div><div class="value">UGX ${Math.round(d.totalRevenue).toLocaleString("en-UG")}</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Recent Vendors</div>
        ${
          (d.businesses || [])
            .slice(0, 5)
            .map((b) => {
              const sub = d.subByBusiness[b.id];
              const users = d.usersByBusiness[b.id] || [];
              return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="width:36px;height:36px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${(b.name || "?")[0].toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px">${escapeHtml(b.name)}</div>
              <div style="font-size:12px;color:var(--text-muted)">${users.length} users · ${sub?.plans?.name || "No plan"}</div>
            </div>
            ${vendorStatusBadge(sub, d.now)}
          </div>`;
            })
            .join("") || '<div class="empty-state">No vendors yet</div>'
        }
      </div>

      <div class="card">
        <div class="card-title">Recent Payments</div>
        ${
          (d.payments || [])
            .slice(0, 5)
            .map(
              (p) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-weight:600;font-size:13px">${escapeHtml(d.businessById[p.business_id]?.name || "—")}</div>
              <div style="font-size:11px;color:var(--text-muted)">${fmtDate(p.created_at)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700">${Number(p.amount).toLocaleString("en-UG")} ${escapeHtml(p.currency)}</div>
              <span class="badge ${p.status === "successful" ? "badge-green" : p.status === "failed" ? "badge-red" : "badge-gray"}" style="font-size:10px">${escapeHtml(p.status)}</span>
            </div>
          </div>
        `,
            )
            .join("") || '<div class="empty-state">No payments yet</div>'
        }
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// VENDORS TAB
// ---------------------------------------------------------------------
function renderVendors(el, d) {
  el.innerHTML = `
    <div class="card">
      <div class="card-title">All Vendor Businesses</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Business</th><th>Owner</th><th>Plan</th><th>Status</th><th>Branches</th><th>Users</th><th>Products</th><th></th></tr></thead>
          <tbody>
            ${
              (d.businesses || [])
                .map((b) => {
                  const sub = d.subByBusiness[b.id];
                  const owner =
                    (d.usersByBusiness[b.id] || []).find(
                      (u) => u.role === "admin",
                    ) || (d.usersByBusiness[b.id] || [])[0];
                  const branchCount = (d.branchesByBusiness[b.id] || []).length;
                  const userCount = (d.usersByBusiness[b.id] || []).length;
                  return `
                <tr>
                  <td><b>${escapeHtml(b.name)}</b><br/><span class="text-muted" style="font-size:11px">TIN: ${escapeHtml(b.tin || "none")}</span></td>
                  <td>${escapeHtml(owner?.full_name || "—")}</td>
                  <td>${escapeHtml(sub?.plans?.name || "—")}</td>
                  <td>${vendorStatusBadge(sub, d.now)}</td>
                  <td>${branchCount}</td>
                  <td>${userCount}</td>
                  <td>—</td>
                  <td style="display:flex;gap:4px">
                    <button class="btn btn-outline btn-sm" data-manage="${b.id}">Manage</button>
                    <button class="btn btn-sm btn-primary" data-impersonate="${b.id}" title="Log in as this vendor's admin">👁 Impersonate</button>
                  </td>
                </tr>`;
                })
                .join("") ||
              '<tr><td colspan="8"><div class="empty-state">No vendors yet</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  qsa("[data-manage]", el).forEach((btn) =>
    btn.addEventListener("click", () =>
      openManageModal(
        d.businessById[btn.dataset.manage],
        d.subByBusiness[btn.dataset.manage],
        d.plans,
        d.branchesByBusiness[btn.dataset.manage] || [],
        d.usersByBusiness[btn.dataset.manage] || [],
      ),
    ),
  );

  qsa("[data-impersonate]", el).forEach((btn) =>
    btn.addEventListener("click", () =>
      impersonateVendor(btn.dataset.impersonate, d),
    ),
  );
}

async function impersonateVendor(businessId, d) {
  const business = d.businessById[businessId];
  const users = d.usersByBusiness[businessId] || [];
  const adminUser = users.find((u) => u.role === "admin") || users[0];

  if (!adminUser) {
    toast("This vendor has no users to impersonate", "error");
    return;
  }

  openModal(
    `
    <div class="modal-title-row"><h3>Impersonate Vendor</h3></div>
    <p>You are about to log in as <b>${escapeHtml(adminUser.full_name)}</b> (${escapeHtml(business.name)}).</p>
    <p class="help-text">You will see the app exactly as they do. A banner at the top will let you return to the admin console.</p>
    <div class="field">
      <label>Login as</label>
      <select id="imp-target">
        ${users.map((u) => `<option value="${u.id}" ${u.id === adminUser.id ? "selected" : ""}>${escapeHtml(u.full_name)} (${u.role})</option>`).join("")}
      </select>
    </div>
    <div class="flex gap" style="margin-top:14px">
      <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-block" id="imp-confirm">Start Impersonation</button>
    </div>
  `,
    {
      onMount: () => {
        $("imp-confirm").addEventListener("click", async () => {
          const targetUserId = $("imp-target").value;
          const targetUser = users.find((u) => u.id === targetUserId);
          closeModal();

          // Store impersonation state
          STATE._impersonate = {
            originalUser: STATE.appUser,
            originalBusiness: STATE.business,
            originalBranch: STATE.branch,
            targetUserId,
            targetBusinessId: businessId,
          };

          // Override STATE to show vendor's data
          STATE.business = business;
          STATE.appUser = targetUser;
          STATE.branch = (d.branchesByBusiness[businessId] || [])[0] || null;

          toast(
            `Now viewing as ${targetUser.full_name} (${business.name})`,
            "success",
            5000,
          );
          // Reload the app to the dashboard
          window._impersonating = true;
          document.querySelector('[data-route="dashboard"]')?.click();
        });
      },
    },
  );
}

function openManageModal(business, sub, plans, branches, users) {
  openModal(
    `
    <div class="modal-title-row"><h3>Manage — ${escapeHtml(business.name)}</h3></div>

    <div class="admin-modal-tabs" style="display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:8px">
      <button class="btn btn-sm btn-primary" data-mtab="subscription">Subscription</button>
      <button class="btn btn-sm btn-outline" data-mtab="branches">Branches (${branches.length})</button>
      <button class="btn btn-sm btn-outline" data-mtab="users">Users (${users.length})</button>
    </div>

    <div id="mg-tab-subscription">
      <div class="field-row">
        <div class="field"><label>Plan</label>
          <select id="mg-plan">${(plans || []).map((p) => `<option value="${p.id}" ${sub?.plan_id === p.id ? "selected" : ""}>${escapeHtml(p.name)} — UGX ${Number(p.price_ugx).toLocaleString("en-UG")}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Status</label>
          <select id="mg-status">
            ${["trialing", "active", "past_due", "cancelled", "expired"].map((s) => `<option value="${s}" ${sub?.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field"><label>Period / Trial End Date</label><input type="date" id="mg-date" value="${(sub?.current_period_end || sub?.trial_ends_at || "").slice(0, 10)}" /></div>
      <div class="field-row">
        <div class="field"><label>Business Name</label><input id="mg-biz-name" value="${escapeHtml(business.name)}" /></div>
        <div class="field"><label>TIN</label><input id="mg-biz-tin" value="${escapeHtml(business.tin || "")}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Phone</label><input id="mg-biz-phone" value="${escapeHtml(business.phone || "")}" /></div>
        <div class="field"><label>Email</label><input id="mg-biz-email" value="${escapeHtml(business.email || "")}" /></div>
      </div>
      <div class="flex gap" style="margin-top:14px">
        <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-block" id="mg-save-btn">Save Changes</button>
      </div>
    </div>

    <div id="mg-tab-branches" style="display:none">
      <div id="mg-branches-list">
        ${
          branches
            .map(
              (br) => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1">
              <b>${escapeHtml(br.name)}</b>
              ${br.is_main ? '<span class="badge badge-green" style="margin-left:6px">Main</span>' : ""}
              <br><span class="text-muted" style="font-size:11px">${escapeHtml(br.address || "No address")}</span>
            </div>
            <button class="btn btn-sm btn-outline" data-edit-branch="${br.id}">Edit</button>
            ${!br.is_main ? `<button class="btn btn-sm btn-danger" data-del-branch="${br.id}">Delete</button>` : ""}
          </div>
        `,
            )
            .join("") || '<div class="empty-state">No branches</div>'
        }
      </div>
      <button class="btn btn-sm btn-primary" id="mg-add-branch" style="margin-top:10px">+ Add Branch</button>
    </div>

    <div id="mg-tab-users" style="display:none">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${
              users
                .map(
                  (u) => `
              <tr>
                <td>${escapeHtml(u.full_name)}</td>
                <td>
                  <select data-user-role="${u.id}" style="padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
                    ${["admin", "manager", "cashier", "inventory_clerk", "accountant", "superadmin"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r.replace("_", " ")}</option>`).join("")}
                  </select>
                </td>
                <td><span class="badge ${u.is_active ? "badge-green" : "badge-red"}">${u.is_active ? "active" : "inactive"}</span></td>
                <td>
                  <button class="btn btn-sm btn-outline" data-toggle-user="${u.id}">${u.is_active ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            `,
                )
                .join("") ||
              '<tr><td colspan="4"><div class="empty-state">No users</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
    {
      large: true,
      onMount: () => {
        // Tab switching
        qsa("[data-mtab]", $("modal-root")).forEach((btn) => {
          btn.addEventListener("click", () => {
            qsa("[data-mtab]", $("modal-root")).forEach((b) => {
              b.className =
                b.dataset.mtab === btn.dataset.mtab
                  ? "btn btn-sm btn-primary"
                  : "btn btn-sm btn-outline";
            });
            ["subscription", "branches", "users"].forEach((t) => {
              const panel = $(`mg-tab-${t}`);
              if (panel)
                panel.style.display = t === btn.dataset.mtab ? "" : "none";
            });
          });
        });

        // Save subscription + business
        $("mg-save-btn")?.addEventListener("click", async () => {
          const planId = $("mg-plan").value;
          const status = $("mg-status").value;
          const dateVal = $("mg-date").value
            ? new Date($("mg-date").value).toISOString()
            : null;

          const subRecord = {
            business_id: business.id,
            plan_id: planId,
            status,
            trial_ends_at:
              status === "trialing" ? dateVal : sub?.trial_ends_at || null,
            current_period_end:
              status === "active" ? dateVal : sub?.current_period_end || null,
            current_period_start:
              sub?.current_period_start || new Date().toISOString(),
          };

          const subErr = (
            await supabase
              .from("subscriptions")
              .upsert(subRecord, { onConflict: "business_id" })
          ).error;
          const bizErr = (
            await supabase
              .from("businesses")
              .update({
                name: $("mg-biz-name").value.trim(),
                tin: $("mg-biz-tin").value.trim() || null,
                phone: $("mg-biz-phone").value.trim() || null,
                email: $("mg-biz-email").value.trim() || null,
              })
              .eq("id", business.id)
          ).error;

          if (subErr || bizErr) {
            toast("Failed: " + (subErr?.message || bizErr?.message), "error");
            return;
          }
          toast("Vendor updated", "success");
          closeModal();
          document.querySelector('[data-route="admin"]')?.click();
        });

        // Add branch
        $("mg-add-branch")?.addEventListener("click", async () => {
          const name = prompt("Branch name:");
          if (!name?.trim()) return;
          const { error } = await supabase.from("branches").insert({
            business_id: business.id,
            name: name.trim(),
            is_main: branches.length === 0,
          });
          if (error) {
            toast("Failed: " + error.message, "error");
            return;
          }
          toast("Branch added", "success");
          closeModal();
          document.querySelector('[data-route="admin"]')?.click();
        });

        // Edit branch
        qsa("[data-edit-branch]", $("modal-root")).forEach((btn) => {
          btn.addEventListener("click", async () => {
            const brId = btn.dataset.editBranch;
            const br = branches.find((b) => b.id === brId);
            const newName = prompt("Branch name:", br?.name);
            if (!newName?.trim()) return;
            const newAddr = prompt("Address:", br?.address || "");
            const { error } = await supabase
              .from("branches")
              .update({
                name: newName.trim(),
                address: newAddr?.trim() || null,
              })
              .eq("id", brId);
            if (error) {
              toast("Failed: " + error.message, "error");
              return;
            }
            toast("Branch updated", "success");
            closeModal();
            document.querySelector('[data-route="admin"]')?.click();
          });
        });

        // Delete branch
        qsa("[data-del-branch]", $("modal-root")).forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("Delete this branch? This cannot be undone.")) return;
            const { error } = await supabase
              .from("branches")
              .delete()
              .eq("id", btn.dataset.delBranch);
            if (error) {
              toast("Failed: " + error.message, "error");
              return;
            }
            toast("Branch deleted", "success");
            closeModal();
            document.querySelector('[data-route="admin"]')?.click();
          });
        });

        // Toggle user active
        qsa("[data-toggle-user]", $("modal-root")).forEach((btn) => {
          btn.addEventListener("click", async () => {
            const u = users.find((u) => u.id === btn.dataset.toggleUser);
            if (!u) return;
            const { error } = await supabase
              .from("app_users")
              .update({ is_active: !u.is_active })
              .eq("id", u.id);
            if (error) {
              toast("Failed: " + error.message, "error");
              return;
            }
            toast(
              `User ${u.is_active ? "deactivated" : "activated"}`,
              "success",
            );
            closeModal();
            document.querySelector('[data-route="admin"]')?.click();
          });
        });

        // Change user role
        qsa("[data-user-role]", $("modal-root")).forEach((sel) => {
          sel.addEventListener("change", async () => {
            const { error } = await supabase
              .from("app_users")
              .update({ role: sel.value })
              .eq("id", sel.dataset.userRole);
            if (error) {
              toast("Failed: " + error.message, "error");
              return;
            }
            toast("Role updated", "success");
          });
        });
      },
    },
  );
}

// ---------------------------------------------------------------------
// USERS TAB
// ---------------------------------------------------------------------
function renderUsers(el, d) {
  el.innerHTML = `
    <div class="card">
      <div class="card-title">All Users (${(d.users || []).length})</div>
      <div class="table-wrap" style="max-height:600px;overflow-y:auto">
        <table>
          <thead><tr><th>Name</th><th>Business</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            ${
              (d.users || [])
                .map(
                  (u) => `
              <tr>
                <td><b>${escapeHtml(u.full_name)}</b></td>
                <td>${escapeHtml(d.businessById[u.business_id]?.name || "—")}</td>
                <td><span class="badge badge-blue">${escapeHtml(u.role.replace("_", " "))}</span></td>
                <td><span class="badge ${u.is_active ? "badge-green" : "badge-red"}">${u.is_active ? "active" : "inactive"}</span></td>
                <td>${u.created_at ? fmtDate(u.created_at) : "—"}</td>
                <td>
                  <button class="btn btn-sm btn-outline" data-user-manage="${u.id}">Manage</button>
                </td>
              </tr>
            `,
                )
                .join("") ||
              '<tr><td colspan="6"><div class="empty-state">No users</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  qsa("[data-user-manage]", el).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = (d.users || []).find((u) => u.id === btn.dataset.userManage);
      if (!u) return;
      openModal(
        `
        <div class="modal-title-row"><h3>Manage User — ${escapeHtml(u.full_name)}</h3></div>
        <div class="field"><label>Role</label>
          <select id="um-role">${["admin", "manager", "cashier", "inventory_clerk", "accountant", "superadmin"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r.replace("_", " ")}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Status</label>
          <select id="um-active"><option value="true" ${u.is_active ? "selected" : ""}>Active</option><option value="false" ${!u.is_active ? "selected" : ""}>Inactive</option></select>
        </div>
        <div class="flex gap" style="margin-top:14px">
          <button class="btn btn-outline btn-block" data-close-modal>Cancel</button>
          <button class="btn btn-primary btn-block" id="um-save">Save</button>
        </div>
      `,
        {
          onMount: () => {
            $("um-save").addEventListener("click", async () => {
              const { error } = await supabase
                .from("app_users")
                .update({
                  role: $("um-role").value,
                  is_active: $("um-active").value === "true",
                })
                .eq("id", u.id);
              if (error) {
                toast("Failed: " + error.message, "error");
                return;
              }
              toast("User updated", "success");
              closeModal();
              document.querySelector('[data-route="admin"]')?.click();
            });
          },
        },
      );
    });
  });
}

// ---------------------------------------------------------------------
// BRANCHES TAB
// ---------------------------------------------------------------------
function renderBranches(el, d) {
  const allBranches = (d.branches || []).map((br) => ({
    ...br,
    _bizName: d.businessById[br.business_id]?.name || "—",
  }));

  el.innerHTML = `
    <div class="card">
      <div class="card-title">All Branches (${allBranches.length})</div>
      <div class="table-wrap" style="max-height:600px;overflow-y:auto">
        <table>
          <thead><tr><th>Branch</th><th>Business</th><th>Main?</th><th>Address</th><th>Phone</th><th></th></tr></thead>
          <tbody>
            ${
              allBranches
                .map(
                  (br) => `
              <tr>
                <td><b>${escapeHtml(br.name)}</b></td>
                <td>${escapeHtml(br._bizName)}</td>
                <td>${br.is_main ? '<span class="badge badge-green">Main</span>' : ""}</td>
                <td>${escapeHtml(br.address || "—")}</td>
                <td>${escapeHtml(br.phone || "—")}</td>
                <td>
                  <button class="btn btn-sm btn-outline" data-branch-edit="${br.id}">Edit</button>
                  ${!br.is_main ? `<button class="btn btn-sm btn-danger" data-branch-del="${br.id}">Delete</button>` : ""}
                </td>
              </tr>
            `,
                )
                .join("") ||
              '<tr><td colspan="6"><div class="empty-state">No branches</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  qsa("[data-branch-edit]", el).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const br = allBranches.find((b) => b.id === btn.dataset.branchEdit);
      const name = prompt("Branch name:", br?.name);
      if (!name?.trim()) return;
      const addr = prompt("Address:", br?.address || "");
      const phone = prompt("Phone:", br?.phone || "");
      const { error } = await supabase
        .from("branches")
        .update({
          name: name.trim(),
          address: addr?.trim() || null,
          phone: phone?.trim() || null,
        })
        .eq("id", br.id);
      if (error) {
        toast("Failed: " + error.message, "error");
        return;
      }
      toast("Branch updated", "success");
      document.querySelector('[data-route="admin"]')?.click();
    });
  });

  qsa("[data-branch-del]", el).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this branch? This cannot be undone.")) return;
      const { error } = await supabase
        .from("branches")
        .delete()
        .eq("id", btn.dataset.branchDel);
      if (error) {
        toast("Failed: " + error.message, "error");
        return;
      }
      toast("Branch deleted", "success");
      document.querySelector('[data-route="admin"]')?.click();
    });
  });
}

// ---------------------------------------------------------------------
// PLANS & PAYMENTS TAB
// ---------------------------------------------------------------------
function renderPlans(el, d) {
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Plans</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Plan</th><th>Price (UGX/mo)</th><th>Features</th><th>Active</th><th></th></tr></thead>
          <tbody>
            ${(d.plans || [])
              .map(
                (p) => `
              <tr>
                <td><b>${escapeHtml(p.name)}</b> <span class="text-muted">(${escapeHtml(p.code)})</span></td>
                <td><input type="number" step="1000" data-plan-price="${p.id}" value="${p.price_ugx}" style="width:120px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)" /></td>
                <td style="font-size:12px;max-width:300px;word-break:break-word">${Object.entries(
                  p.features || {},
                )
                  .map(
                    ([k, v]) =>
                      `<span class="badge ${v ? "badge-green" : "badge-gray"}" style="margin:1px">${k}: ${v}</span>`,
                  )
                  .join(" ")}</td>
                <td><input type="checkbox" data-plan-active="${p.id}" ${p.is_active ? "checked" : ""} /></td>
                <td><button class="btn btn-outline btn-sm" data-save-plan="${p.id}">Save</button></td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">All Payments (${(d.payments || []).length})</div>
      <div class="table-wrap" style="max-height:400px;overflow-y:auto">
        <table>
          <thead><tr><th>Date</th><th>Business</th><th>Plan</th><th>Amount</th><th>Status</th><th>Ref</th></tr></thead>
          <tbody>
            ${
              (d.payments || []).length
                ? d.payments
                    .map(
                      (p) => `
              <tr>
                <td>${fmtDate(p.created_at)}</td>
                <td>${escapeHtml(d.businessById[p.business_id]?.name || "—")}</td>
                <td>${escapeHtml(p.plans?.name || "—")}</td>
                <td>${Number(p.amount).toLocaleString("en-UG")} ${escapeHtml(p.currency)}</td>
                <td><span class="badge ${p.status === "successful" ? "badge-green" : p.status === "failed" ? "badge-red" : "badge-gray"}">${escapeHtml(p.status)}</span></td>
                <td style="font-family:monospace;font-size:11px">${escapeHtml(p.flw_tx_ref)}</td>
              </tr>
            `,
                    )
                    .join("")
                : '<tr><td colspan="6"><div class="empty-state">No payments recorded yet.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  qsa("[data-save-plan]", el).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.dataset.savePlan;
      const price = parseFloat(qsa(`[data-plan-price="${id}"]`)[0].value);
      const active = qsa(`[data-plan-active="${id}"]`)[0].checked;
      const { error } = await supabase
        .from("plans")
        .update({ price_ugx: price, is_active: active })
        .eq("id", id);
      if (error) {
        toast("Failed: " + error.message, "error");
        return;
      }
      toast("Plan updated", "success");
    }),
  );
}

// ---------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------
function isActive(sub, now) {
  if (!sub) return false;
  if (sub.status === "trialing")
    return !sub.trial_ends_at || new Date(sub.trial_ends_at) > now;
  if (sub.status === "active")
    return !sub.current_period_end || new Date(sub.current_period_end) > now;
  return false;
}

function vendorStatusBadge(sub, now) {
  if (!sub) return '<span class="badge badge-gray">none</span>';
  const active = isActive(sub, now);
  if (sub.status === "trialing")
    return `<span class="badge ${active ? "badge-blue" : "badge-red"}">${active ? "trial" : "trial ended"}</span>`;
  if (sub.status === "active")
    return `<span class="badge ${active ? "badge-green" : "badge-red"}">${active ? "active" : "lapsed"}</span>`;
  const map = {
    past_due: "badge-yellow",
    cancelled: "badge-red",
    expired: "badge-red",
  };
  return `<span class="badge ${map[sub.status] || "badge-gray"}">${escapeHtml(sub.status)}</span>`;
}
