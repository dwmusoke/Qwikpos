// =====================================================================
// QWICKPOS — HRM MODULE
// Employees, Departments, Attendance, Leave, Payroll
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
  fmtMoney,
  sanitizeCsvValue,
} from "./uganda-pos-core.js";
import { logAuditAction } from "./uganda-pos-view-audit.js";

let activeTab = "employees";
let employeesCache = [];
let departmentsCache = [];
let designationsCache = [];
let leaveTypesCache = [];

export async function renderHRM(root) {
  root.innerHTML = `<div class="empty-state">Loading HRM…</div>`;

  const [empRes, deptRes, desigRes, ltRes] = await Promise.all([
    supabase
      .from("employees")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("last_name"),
    supabase
      .from("departments")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("name"),
    supabase
      .from("designations")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("name"),
    supabase
      .from("leave_types")
      .select("*")
      .eq("business_id", STATE.business.id)
      .order("name"),
  ]);

  employeesCache = empRes.data || [];
  departmentsCache = deptRes.data || [];
  designationsCache = desigRes.data || [];
  leaveTypesCache = ltRes.data || [];

  const activeEmp = employeesCache.filter((e) => e.status === "active").length;

  root.innerHTML = `
    <div class="view-header">
      <div><h2 data-i18n="nav.hrm">Human Resource Management</h2><p class="sub">${activeEmp} active employees · ${departmentsCache.length} departments</p></div>
    </div>
    <div class="notif-filters" id="hrm-tabs">
      ${[
        ["employees", "👤 Employees"],
        ["departments", "🏢 Departments"],
        ["attendance", "📋 Attendance"],
        ["leave", "🏖️ Leave"],
        ["payroll", "💰 Payroll"],
        ["settings", "⚙️ Settings"],
      ]
        .map(
          ([k, l]) =>
            `<button class="chip ${activeTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`,
        )
        .join("")}
    </div>
    <div id="hrm-body"></div>
  `;

  root.querySelectorAll("#hrm-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root
        .querySelectorAll("#hrm-tabs .chip")
        .forEach((c) => c.classList.toggle("active", c === btn));
      renderHrmTab();
    });
  });

  renderHrmTab();
}

function renderHrmTab() {
  const body = $("hrm-body");
  if (!body) return;
  if (activeTab === "employees") renderEmployees(body);
  else if (activeTab === "departments") renderDepartments(body);
  else if (activeTab === "attendance") renderAttendance(body);
  else if (activeTab === "leave") renderLeave(body);
  else if (activeTab === "payroll") renderPayroll(body);
  else if (activeTab === "settings") renderHrmSettings(body);
}

function renderEmployees(body) {
  const active = employeesCache.filter((e) => e.status === "active").length;
  const onLeave = employeesCache.filter((e) => e.status === "on_leave").length;
  const terminated = employeesCache.filter(
    (e) => e.status === "terminated",
  ).length;
  const totalSalary = employeesCache
    .filter((e) => e.status === "active")
    .reduce((a, e) => a + Number(e.salary || 0), 0);

  body.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi-card"><div class="label">Active</div><div class="value" style="color:var(--brand);">${active}</div></div>
      <div class="kpi-card"><div class="label">On Leave</div><div class="value" style="color:var(--warning);">${onLeave}</div></div>
      <div class="kpi-card"><div class="label">Terminated</div><div class="value" style="color:var(--danger);">${terminated}</div></div>
      <div class="kpi-card"><div class="label">Monthly Payroll</div><div class="value">${fmtMoney(totalSalary)}</div></div>
    </div>
    <div class="card">
      <div class="card-title">
        <span>Employees</span>
        <button class="btn btn-primary btn-sm" id="hrm-add-emp">➕ Add Employee</button>
      </div>
      ${
        employeesCache.length
          ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Employee #</th><th>Department</th><th>Designation</th><th>Status</th><th>Salary</th><th>Actions</th></tr></thead>
          <tbody>
            ${employeesCache
              .map((e) => {
                const dept = departmentsCache.find(
                  (d) => d.id === e.department_id,
                );
                const desig = designationsCache.find(
                  (d) => d.id === e.designation_id,
                );
                return `
                <tr>
                  <td><b>${escapeHtml(e.first_name)} ${escapeHtml(e.last_name)}</b><br><span class="text-muted" style="font-size:11px;">${escapeHtml(e.email || e.phone || "")}</span></td>
                  <td>${escapeHtml(e.employee_number)}</td>
                  <td>${escapeHtml(dept?.name || "—")}</td>
                  <td>${escapeHtml(desig?.name || "—")}</td>
                  <td><span class="badge badge-${e.status === "active" ? "green" : e.status === "on_leave" ? "yellow" : "red"}">${e.status}</span></td>
                  <td>${fmtMoney(e.salary || 0)}</td>
                  <td>
                    <button class="btn btn-outline btn-xs" data-edit-emp="${e.id}">Edit</button>
                    <button class="btn btn-outline btn-xs" data-view-emp="${e.id}">View</button>
                  </td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table></div>
      `
          : '<div class="empty-state">No employees yet. Add your first team member.</div>'
      }
    </div>
  `;

  $("hrm-add-emp")?.addEventListener("click", () => showEmployeeModal(null));
  body.querySelectorAll("[data-edit-emp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emp = employeesCache.find((e) => e.id === btn.dataset.editEmp);
      if (emp) showEmployeeModal(emp);
    });
  });
  body.querySelectorAll("[data-view-emp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emp = employeesCache.find((e) => e.id === btn.dataset.viewEmp);
      if (emp) showEmployeeDetail(emp);
    });
  });
}

function renderDepartments(body) {
  body.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>Departments & Designations</span>
        <div class="flex gap">
          <button class="btn btn-outline btn-sm" id="hrm-add-desig">➕ Designation</button>
          <button class="btn btn-primary btn-sm" id="hrm-add-dept">➕ Department</button>
        </div>
      </div>
      ${
        departmentsCache.length
          ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Department</th><th>Description</th><th>Employees</th><th>Actions</th></tr></thead>
          <tbody>
            ${departmentsCache
              .map((d) => {
                const empCount = employeesCache.filter(
                  (e) => e.department_id === d.id,
                ).length;
                return `
                <tr>
                  <td><b>${escapeHtml(d.name)}</b></td>
                  <td>${escapeHtml(d.description || "—")}</td>
                  <td>${empCount}</td>
                  <td><button class="btn btn-outline btn-xs" data-edit-dept="${d.id}">Edit</button></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table></div>
      `
          : '<div class="empty-state">No departments yet.</div>'
      }

      ${
        designationsCache.length
          ? `
        <div class="card-title" style="margin-top:20px;">Designations</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Designation</th><th>Department</th><th>Salary Range</th></tr></thead>
          <tbody>
            ${designationsCache
              .map((d) => {
                const dept = departmentsCache.find(
                  (x) => x.id === d.department_id,
                );
                return `
                <tr>
                  <td><b>${escapeHtml(d.name)}</b></td>
                  <td>${escapeHtml(dept?.name || "—")}</td>
                  <td>${fmtMoney(d.min_salary || 0)} — ${fmtMoney(d.max_salary || 0)}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table></div>
      `
          : ""
      }
    </div>
  `;

  $("hrm-add-dept")?.addEventListener("click", () => showDepartmentModal(null));
  $("hrm-add-desig")?.addEventListener("click", () =>
    showDesignationModal(null),
  );
  body.querySelectorAll("[data-edit-dept]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dept = departmentsCache.find((d) => d.id === btn.dataset.editDept);
      if (dept) showDepartmentModal(dept);
    });
  });
}

function renderAttendance(body) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  body.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>Attendance — This Week</span>
        <button class="btn btn-primary btn-sm" id="hrm-mark-attendance">📋 Mark Attendance</button>
      </div>
      <div class="empty-state">Load attendance data from the Attendance tab.</div>
    </div>
  `;

  $("hrm-mark-attendance")?.addEventListener("click", () =>
    showAttendanceModal(),
  );
}

function renderLeave(body) {
  body.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>Leave Requests</span>
        <button class="btn btn-primary btn-sm" id="hrm-request-leave">➕ Request Leave</button>
      </div>
      <div class="empty-state">Leave requests will appear here.</div>
    </div>
  `;

  $("hrm-request-leave")?.addEventListener("click", () =>
    showLeaveRequestModal(),
  );
}

function renderPayroll(body) {
  body.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>Payroll</span>
        <button class="btn btn-primary btn-sm" id="hrm-run-payroll">💰 Run Payroll</button>
      </div>
      <div class="empty-state">Payroll records will appear here.</div>
    </div>
  `;

  $("hrm-run-payroll")?.addEventListener("click", () => showPayrollModal());
}

function renderHrmSettings(body) {
  body.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Leave Types</div>
        <button class="btn btn-outline btn-sm" id="hrm-add-leave-type" style="margin-bottom:12px;">➕ Add Leave Type</button>
        ${
          leaveTypesCache
            .map(
              (lt) => `
          <div class="summary-row">
            <span>${escapeHtml(lt.name)} (${lt.days_per_year} days/year)</span>
            <span class="badge badge-${lt.is_paid ? "green" : "gray"}">${lt.is_paid ? "Paid" : "Unpaid"}</span>
          </div>
        `,
            )
            .join("") ||
          '<div class="empty-state">No leave types configured.</div>'
        }
      </div>
      <div class="card">
        <div class="card-title">HRM Info</div>
        <p style="font-size:13px; color:var(--text-muted);">
          Configure departments, designations, and leave types here. 
          Employees can be assigned to departments and designations for organizational structure.
        </p>
      </div>
    </div>
  `;

  $("hrm-add-leave-type")?.addEventListener("click", () =>
    showLeaveTypeModal(),
  );
}

function showEmployeeModal(existing) {
  const isEdit = !!existing;
  openModal(
    `
    <h3>${isEdit ? "Edit" : "Add"} Employee</h3>
    <div class="field-row">
      <div class="field"><label>First Name *</label><input id="emp-first" value="${escapeHtml(existing?.first_name || "")}" /></div>
      <div class="field"><label>Last Name *</label><input id="emp-last" value="${escapeHtml(existing?.last_name || "")}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Email</label><input id="emp-email" type="email" value="${escapeHtml(existing?.email || "")}" /></div>
      <div class="field"><label>Phone</label><input id="emp-phone" value="${escapeHtml(existing?.phone || "")}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Employee # *</label><input id="emp-number" value="${escapeHtml(existing?.employee_number || "")}" /></div>
      <div class="field"><label>Hire Date *</label><input id="emp-hire" type="date" value="${existing?.hire_date || new Date().toISOString().slice(0, 10)}" /></div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Department</label>
        <select id="emp-dept">
          <option value="">— None —</option>
          ${departmentsCache.map((d) => `<option value="${d.id}" ${existing?.department_id === d.id ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Designation</label>
        <select id="emp-desig">
          <option value="">— None —</option>
          ${designationsCache.map((d) => `<option value="${d.id}" ${existing?.designation_id === d.id ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Employment Type</label>
        <select id="emp-type">
          ${["full_time", "part_time", "contract", "intern"].map((t) => `<option value="${t}" ${existing?.employment_type === t ? "selected" : ""}>${t.replace("_", " ")}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="emp-status">
          ${["active", "on_leave", "terminated"].map((s) => `<option value="${s}" ${existing?.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Salary</label><input id="emp-salary" type="number" value="${existing?.salary || 0}" /></div>
      <div class="field">
        <label>Salary Type</label>
        <select id="emp-salary-type">
          ${["monthly", "weekly", "hourly"].map((t) => `<option value="${t}" ${existing?.salary_type === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="field"><label>Address</label><textarea id="emp-address" rows="2">${escapeHtml(existing?.address || "")}</textarea></div>
    <button class="btn btn-primary btn-block" id="emp-save">${isEdit ? "Update" : "Add"} Employee</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `,
    { large: true },
  );

  $("emp-save")?.addEventListener("click", async () => {
    const firstName = $("emp-first")?.value.trim();
    const lastName = $("emp-last")?.value.trim();
    const empNumber = $("emp-number")?.value.trim();
    if (!firstName || !lastName || !empNumber) {
      toast("First name, last name, and employee number are required", "error");
      return;
    }

    const payload = {
      first_name: firstName,
      last_name: lastName,
      employee_number: empNumber,
      email: $("emp-email")?.value.trim(),
      phone: $("emp-phone")?.value.trim(),
      hire_date: $("emp-hire")?.value,
      department_id: $("emp-dept")?.value || null,
      designation_id: $("emp-desig")?.value || null,
      employment_type: $("emp-type")?.value,
      status: $("emp-status")?.value,
      salary: Number($("emp-salary")?.value || 0),
      salary_type: $("emp-salary-type")?.value,
      address: $("emp-address")?.value.trim(),
      business_id: STATE.business.id,
      branch_id: STATE.branch?.id,
    };

    if (isEdit) {
      await supabase.from("employees").update(payload).eq("id", existing.id);
      logAuditAction({
        action: "update",
        entityType: "employee",
        entityId: existing.id,
        entityName: `${firstName} ${lastName}`,
        newValue: payload,
      });
    } else {
      const { data, error } = await supabase
        .from("employees")
        .insert(payload)
        .select()
        .single();
      logAuditAction({
        action: "create",
        entityType: "employee",
        entityId: data?.id,
        entityName: `${firstName} ${lastName}`,
        newValue: payload,
      });
    }
    toast(`Employee ${isEdit ? "updated" : "added"}`, "success");
    closeModal();
  });
}

function showDepartmentModal(existing) {
  const isEdit = !!existing;
  openModal(`
    <h3>${isEdit ? "Edit" : "Add"} Department</h3>
    <div class="field"><label>Name *</label><input id="dept-name" value="${escapeHtml(existing?.name || "")}" /></div>
    <div class="field"><label>Description</label><textarea id="dept-desc" rows="2">${escapeHtml(existing?.description || "")}</textarea></div>
    <button class="btn btn-primary btn-block" id="dept-save">${isEdit ? "Update" : "Create"}</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("dept-save")?.addEventListener("click", async () => {
    const name = $("dept-name")?.value.trim();
    if (!name) {
      toast("Name is required", "error");
      return;
    }
    const payload = {
      name,
      description: $("dept-desc")?.value.trim(),
      business_id: STATE.business.id,
    };
    if (isEdit) {
      await supabase.from("departments").update(payload).eq("id", existing.id);
      logAuditAction({
        action: "update",
        entityType: "department",
        entityId: existing.id,
        entityName: name,
        newValue: payload,
      });
    } else {
      const { data, error } = await supabase
        .from("departments")
        .insert(payload)
        .select()
        .single();
      logAuditAction({
        action: "create",
        entityType: "department",
        entityId: data?.id,
        entityName: name,
        newValue: payload,
      });
    }
    toast(`Department ${isEdit ? "updated" : "created"}`, "success");
    closeModal();
  });
}

function showDesignationModal(existing) {
  const isEdit = !!existing;
  openModal(`
    <h3>${isEdit ? "Edit" : "Add"} Designation</h3>
    <div class="field"><label>Name *</label><input id="desig-name" value="${escapeHtml(existing?.name || "")}" /></div>
    <div class="field">
      <label>Department</label>
      <select id="desig-dept">
        <option value="">— None —</option>
        ${departmentsCache.map((d) => `<option value="${d.id}" ${existing?.department_id === d.id ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field-row">
      <div class="field"><label>Min Salary</label><input id="desig-min" type="number" value="${existing?.min_salary || 0}" /></div>
      <div class="field"><label>Max Salary</label><input id="desig-max" type="number" value="${existing?.max_salary || 0}" /></div>
    </div>
    <button class="btn btn-primary btn-block" id="desig-save">${isEdit ? "Update" : "Create"}</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("desig-save")?.addEventListener("click", async () => {
    const name = $("desig-name")?.value.trim();
    if (!name) {
      toast("Name is required", "error");
      return;
    }
    const payload = {
      name,
      department_id: $("desig-dept")?.value || null,
      min_salary: Number($("desig-min")?.value || 0),
      max_salary: Number($("desig-max")?.value || 0),
      business_id: STATE.business.id,
    };
    if (isEdit) {
      await supabase.from("designations").update(payload).eq("id", existing.id);
      logAuditAction({
        action: "update",
        entityType: "designation",
        entityId: existing.id,
        entityName: name,
        newValue: payload,
      });
    } else {
      const { data, error } = await supabase
        .from("designations")
        .insert(payload)
        .select()
        .single();
      logAuditAction({
        action: "create",
        entityType: "designation",
        entityId: data?.id,
        entityName: name,
        newValue: payload,
      });
    }
    toast(`Designation ${isEdit ? "updated" : "created"}`, "success");
    closeModal();
  });
}

function showAttendanceModal() {
  openModal(`
    <h3>Mark Attendance</h3>
    <div class="field"><label>Date</label><input id="att-date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
    <div class="field">
      <label>Employee</label>
      <select id="att-emp">
        ${employeesCache
          .filter((e) => e.status === "active")
          .map(
            (e) =>
              `<option value="${e.id}">${escapeHtml(e.first_name)} ${escapeHtml(e.last_name)}</option>`,
          )
          .join("")}
      </select>
    </div>
    <div class="field-row">
      <div class="field"><label>Clock In</label><input id="att-in" type="time" value="09:00" /></div>
      <div class="field"><label>Clock Out</label><input id="att-out" type="time" value="17:00" /></div>
    </div>
    <div class="field">
      <label>Status</label>
      <select id="att-status">
        <option value="present">Present</option>
        <option value="absent">Absent</option>
        <option value="half_day">Half Day</option>
        <option value="late">Late</option>
      </select>
    </div>
    <div class="field"><label>Notes</label><input id="att-notes" /></div>
    <button class="btn btn-primary btn-block" id="att-save">Save Attendance</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("att-save")?.addEventListener("click", async () => {
    const date = $("att-date")?.value;
    const employeeId = $("att-emp")?.value;
    if (!date || !employeeId) {
      toast("Date and employee required", "error");
      return;
    }
    const attPayload = {
      business_id: STATE.business.id,
      employee_id: employeeId,
      date,
      clock_in: `${date}T${$("att-in")?.value}:00`,
      clock_out: `${date}T${$("att-out")?.value}:00`,
      status: $("att-status")?.value,
      notes: $("att-notes")?.value.trim(),
    };
    await supabase.from("attendance").insert(attPayload);
    const attEmp = employeesCache.find((e) => e.id === employeeId);
    logAuditAction({
      action: "create",
      entityType: "attendance",
      entityName: `${attEmp?.first_name || ""} ${attEmp?.last_name || ""} — ${date}`,
      newValue: attPayload,
    });
    toast("Attendance recorded", "success");
    closeModal();
  });
}

function showLeaveRequestModal() {
  openModal(`
    <h3>Request Leave</h3>
    <div class="field">
      <label>Employee</label>
      <select id="leave-emp">
        ${employeesCache
          .filter((e) => e.status === "active")
          .map(
            (e) =>
              `<option value="${e.id}">${escapeHtml(e.first_name)} ${escapeHtml(e.last_name)}</option>`,
          )
          .join("")}
      </select>
    </div>
    <div class="field">
      <label>Leave Type</label>
      <select id="leave-type">
        ${leaveTypesCache.map((lt) => `<option value="${lt.id}">${escapeHtml(lt.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field-row">
      <div class="field"><label>Start Date *</label><input id="leave-start" type="date" /></div>
      <div class="field"><label>End Date *</label><input id="leave-end" type="date" /></div>
    </div>
    <div class="field"><label>Reason</label><textarea id="leave-reason" rows="2"></textarea></div>
    <button class="btn btn-primary btn-block" id="leave-save">Submit Request</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("leave-save")?.addEventListener("click", async () => {
    const start = $("leave-start")?.value;
    const end = $("leave-end")?.value;
    if (!start || !end) {
      toast("Dates required", "error");
      return;
    }
    const days =
      Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
    const leaveEmpId = $("leave-emp")?.value;
    const leavePayload = {
      business_id: STATE.business.id,
      employee_id: leaveEmpId,
      leave_type_id: $("leave-type")?.value,
      start_date: start,
      end_date: end,
      days,
      reason: $("leave-reason")?.value.trim(),
    };
    await supabase.from("leave_requests").insert(leavePayload);
    const leaveEmp = employeesCache.find((e) => e.id === leaveEmpId);
    logAuditAction({
      action: "create",
      entityType: "leave_request",
      entityName: `${leaveEmp?.first_name || ""} ${leaveEmp?.last_name || ""} — ${start} to ${end}`,
      newValue: leavePayload,
    });
    toast("Leave request submitted", "success");
    closeModal();
  });
}

function showPayrollModal() {
  openModal(`
    <h3>Run Payroll</h3>
    <div class="field-row">
      <div class="field"><label>Period Start *</label><input id="pay-start" type="date" /></div>
      <div class="field"><label>Period End *</label><input id="pay-end" type="date" /></div>
    </div>
    <p style="font-size:13px; color:var(--text-muted); margin:12px 0;">
      This will create payroll records for all active employees based on their configured salary.
    </p>
    <button class="btn btn-primary btn-block" id="pay-run">💰 Generate Payroll</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("pay-run")?.addEventListener("click", async () => {
    const start = $("pay-start")?.value;
    const end = $("pay-end")?.value;
    if (!start || !end) {
      toast("Period dates required", "error");
      return;
    }

    const activeEmps = employeesCache.filter((e) => e.status === "active");
    const records = activeEmps.map((e) => ({
      business_id: STATE.business.id,
      employee_id: e.id,
      period_start: start,
      period_end: end,
      base_salary: e.salary || 0,
      net_pay: e.salary || 0,
      status: "draft",
    }));

    const { error } = await supabase.from("payroll").insert(records);
    if (error) {
      toast("Payroll generation failed: " + error.message, "error");
    } else {
      logAuditAction({
        action: "create",
        entityType: "payroll",
        entityName: `Payroll ${start} to ${end} (${records.length} employees)`,
        newValue: {
          period_start: start,
          period_end: end,
          employee_count: records.length,
        },
      });
      toast(`Payroll generated for ${records.length} employees`, "success");
      closeModal();
    }
  });
}

function showLeaveTypeModal() {
  openModal(`
    <h3>Add Leave Type</h3>
    <div class="field"><label>Name *</label><input id="lt-name" placeholder="e.g. Annual Leave" /></div>
    <div class="field-row">
      <div class="field"><label>Days per Year</label><input id="lt-days" type="number" value="21" /></div>
      <div class="field">
        <label>Paid?</label>
        <select id="lt-paid"><option value="true">Yes</option><option value="false">No</option></select>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="lt-save">Create</button>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:8px;">Cancel</button>
  `);

  $("lt-save")?.addEventListener("click", async () => {
    const name = $("lt-name")?.value.trim();
    if (!name) {
      toast("Name required", "error");
      return;
    }
    const ltPayload = {
      name,
      days_per_year: Number($("lt-days")?.value || 0),
      is_paid: $("lt-paid")?.value === "true",
      business_id: STATE.business.id,
    };
    await supabase.from("leave_types").insert(ltPayload);
    logAuditAction({
      action: "create",
      entityType: "leave_type",
      entityName: name,
      newValue: ltPayload,
    });
    toast("Leave type created", "success");
    closeModal();
  });
}

function showEmployeeDetail(emp) {
  const dept = departmentsCache.find((d) => d.id === emp.department_id);
  const desig = designationsCache.find((d) => d.id === emp.designation_id);

  openModal(
    `
    <h3>${escapeHtml(emp.first_name)} ${escapeHtml(emp.last_name)}</h3>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0;">
      <div><b>Employee #:</b> ${escapeHtml(emp.employee_number)}</div>
      <div><b>Status:</b> <span class="badge badge-${emp.status === "active" ? "green" : emp.status === "on_leave" ? "yellow" : "red"}">${emp.status}</span></div>
      <div><b>Department:</b> ${escapeHtml(dept?.name || "—")}</div>
      <div><b>Designation:</b> ${escapeHtml(desig?.name || "—")}</div>
      <div><b>Email:</b> ${escapeHtml(emp.email || "—")}</div>
      <div><b>Phone:</b> ${escapeHtml(emp.phone || "—")}</div>
      <div><b>Hire Date:</b> ${emp.hire_date || "—"}</div>
      <div><b>Salary:</b> ${fmtMoney(emp.salary || 0)} / ${emp.salary_type}</div>
      <div><b>Type:</b> ${(emp.employment_type || "").replace("_", " ")}</div>
      <div><b>Address:</b> ${escapeHtml(emp.address || "—")}</div>
    </div>
    <button class="btn btn-outline btn-block" data-close-modal style="margin-top:16px;">Close</button>
  `,
    { large: true },
  );
}
