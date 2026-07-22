// =====================================================================
// QWICKPOS — SELF-SERVE SIGNUP (plan picker + registration)
//
// Runs before the user is fully authenticated, so it talks to Supabase
// as `anon`. `plans` is publicly readable (see uganda-pos-schema-billing.sql)
// so pricing can be shown before anyone logs in.
// =====================================================================
import { supabase, $, qsa, escapeHtml, toast } from "./uganda-pos-core.js";

const PENDING_KEY = "ugpos_pending_signup";
let selectedPlan = null;

export async function initSignupScreen() {
  const grid = $("signup-plans");
  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  grid.innerHTML = (plans || [])
    .map(
      (p) => `
    <div class="card" style="text-align:center;">
      <div class="card-title" style="justify-content:center;">${escapeHtml(p.name)}</div>
      <div style="font-size:24px; font-weight:800; margin:6px 0;">${Number(p.price_ugx).toLocaleString("en-UG")} <span style="font-size:12px; font-weight:500; color:var(--text-muted);">UGX/mo</span></div>
      <p class="help-text" style="min-height:32px;">${escapeHtml(p.description || "")}</p>
      <ul style="text-align:left; font-size:12.5px; color:var(--text-muted); padding-left:18px; margin:10px 0;">
        <li>${p.features?.max_branches >= 999 ? "Unlimited" : p.features?.max_branches || 1} branch(es)</li>
        <li>${p.features?.multi_currency ? "✅" : "—"} Multi-currency</li>
        <li>${p.features?.efris ? "✅" : "—"} EFRIS e-invoicing</li>
        <li>${p.features?.reports_export ? "✅" : "—"} Report exports</li>
      </ul>
      <button class="btn btn-primary btn-block" data-plan="${p.code}">Select ${escapeHtml(p.name)}</button>
    </div>
  `,
    )
    .join("");

  qsa("[data-plan]", grid).forEach((btn) =>
    btn.addEventListener("click", () => {
      selectedPlan = (plans || []).find((p) => p.code === btn.dataset.plan);
      $("signup-plan-code").value = selectedPlan?.code || "starter";
      grid.classList.add("hidden");
      $("signup-form").classList.remove("hidden");
    }),
  );

  $("signup-back-btn").addEventListener("click", () => {
    $("signup-form").classList.add("hidden");
    grid.classList.remove("hidden");
  });

  $("signup-form").addEventListener("submit", onSubmit);
}

async function onSubmit(e) {
  e.preventDefault();
  const errEl = $("signup-error");
  errEl.style.display = "none";
  const btn = $("signup-submit");

  const payload = {
    businessName: $("signup-business-name").value.trim(),
    fullName: $("signup-full-name").value.trim(),
    phone: $("signup-phone").value.trim(),
    currency: $("signup-currency").value,
    planCode: $("signup-plan-code").value || "starter",
    email: $("signup-email").value.trim(),
  };
  const password = $("signup-password").value;

  if (
    !payload.businessName ||
    !payload.fullName ||
    !payload.email ||
    password.length < 8 ||
    !/[0-9]/.test(password) ||
    !/[a-zA-Z]/.test(password)
  ) {
    errEl.textContent =
      "Please fill in all fields (password must be at least 8 characters with at least one letter and one number).";
    errEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Creating your account…";

  // Stashed so that if this Supabase project requires email confirmation,
  // we can finish creating the business the moment the user logs back in
  // (see finishPendingSignupIfAny(), called from uganda-pos-app.js on boot).
  localStorage.setItem(PENDING_KEY, JSON.stringify(payload));

  const { data, error } = await supabase.auth.signUp({
    email: payload.email,
    password,
  });
  if (error) {
    errEl.textContent = error.message;
    errEl.style.display = "block";
    btn.disabled = false;
    btn.textContent = "Start 14-Day Free Trial";
    return;
  }

  if (data.session) {
    const result = await finishPendingSignupIfAny();
    btn.disabled = false;
    btn.textContent = "Start 14-Day Free Trial";
    if (result.ok) {
      window.location.reload();
    } else {
      errEl.textContent = result.error;
      errEl.style.display = "block";
    }
  } else {
    toast(
      "Check your email to confirm your account, then sign in to finish setup.",
      "success",
      8000,
    );
    $("signup-screen").classList.add("hidden");
    $("login-screen").classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Start 14-Day Free Trial";
  }
}

// Called after a successful login when this device previously started a
// signup that needed email confirmation first.
export async function finishPendingSignupIfAny() {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return { ok: true, skipped: true };
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    localStorage.removeItem(PENDING_KEY);
    return {
      ok: false,
      error: "Corrupted signup data — please sign up again.",
    };
  }

  const { error } = await supabase.rpc("create_business_and_owner", {
    p_business_name: payload.businessName,
    p_full_name: payload.fullName,
    p_phone: payload.phone,
    p_base_currency: payload.currency,
    p_plan_code: payload.planCode,
  });

  if (error && !error.message?.includes("already linked")) {
    return { ok: false, error: error.message };
  }
  localStorage.removeItem(PENDING_KEY);
  return { ok: true };
}
