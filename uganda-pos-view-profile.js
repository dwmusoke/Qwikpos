import { supabase, STATE, $, escapeHtml, toast, openModal, closeModal, fmtMoney, fmtDate } from "./uganda-pos-core.js";

export async function renderProfile(root) {
  const u = STATE.appUser;
  const initials = (u.full_name || "U").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const [{ count: salesCount }, { data: recentSales }] = await Promise.all([
    supabase.from("sales").select("id", { count: "exact", head: true }).eq("business_id", STATE.business.id).eq("created_by", u.id),
    supabase.from("sales").select("grand_total_base, created_at").eq("business_id", STATE.business.id).eq("created_by", u.id).order("created_at", { ascending: false }).limit(100),
  ]);

  const totalSales = (recentSales || []).reduce((a, s) => a + Number(s.grand_total_base || 0), 0);

  root.innerHTML = `
    <div class="view-header">
      <div><h2>My Profile</h2><p class="sub">Manage your account information</p></div>
    </div>

    <div class="profile-header">
      <div class="profile-avatar-lg">${initials}</div>
      <div class="profile-info">
        <h2>${escapeHtml(u.full_name)}</h2>
        <div class="profile-role">${u.role.replace("_", " ")}</div>
        <div class="profile-business">${escapeHtml(STATE.business?.name || "")} · ${escapeHtml(STATE.branch?.name || "")}</div>
      </div>
    </div>

    <div class="profile-stats">
      <div class="profile-stat">
        <div class="stat-value">${salesCount || 0}</div>
        <div class="stat-label">Sales Made</div>
      </div>
      <div class="profile-stat">
        <div class="stat-value">${fmtMoney(totalSales)}</div>
        <div class="stat-label">Total Sales Value</div>
      </div>
      <div class="profile-stat">
        <div class="stat-value">${u.phone ? escapeHtml(u.phone) : "—"}</div>
        <div class="stat-label">Phone</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Account Information</div>
      <form id="profile-form">
        <div class="field-row">
          <div class="field"><label>Full Name</label><input id="pf-name" value="${escapeHtml(u.full_name || "")}" /></div>
          <div class="field"><label>Phone</label><input id="pf-phone" value="${escapeHtml(u.phone || "")}" /></div>
        </div>
        <button class="btn btn-primary" type="submit">Save Changes</button>
      </form>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-title">Change Password</div>
      <form id="password-form">
        <div class="field"><label>New Password</label><input id="pf-pw" type="password" minlength="8" placeholder="At least 8 characters" /></div>
        <div class="field"><label>Confirm Password</label><input id="pf-pw2" type="password" minlength="8" placeholder="Repeat password" /></div>
        <button class="btn btn-primary" type="submit">Update Password</button>
      </form>
    </div>
  `;

  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("pf-name").value.trim();
    const phone = $("pf-phone").value.trim();
    if (!name) { toast("Name is required", "error"); return; }
    const { error } = await supabase.from("app_users").update({ full_name: name, phone }).eq("id", u.id);
    if (error) { toast(error.message, "error"); return; }
    STATE.appUser.full_name = name;
    STATE.appUser.phone = phone;
    toast("Profile updated", "success");
  });

  $("password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("pf-pw").value;
    const pw2 = $("pf-pw2").value;
    if (pw.length < 8) { toast("Password must be at least 8 characters", "error"); return; }
    if (pw !== pw2) { toast("Passwords do not match", "error"); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { toast(error.message, "error"); return; }
    toast("Password updated", "success");
    $("pf-pw").value = "";
    $("pf-pw2").value = "";
  });
}
