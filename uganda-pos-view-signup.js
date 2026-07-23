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

// ---------------------------------------------------------------------
// Create Business Screen (for users who logged in via password reset
// or otherwise have auth but no app_users row)
// ---------------------------------------------------------------------
const CREATE_BUSINESS_KEY = "ugpos_create_business";

export function initCreateBusinessScreen() {
  // This is called from app.js init, but we don't need to do anything
  // here since the screen is shown dynamically by boot()
}

export async function showCreateBusinessScreen() {
  $("login-screen").classList.add("hidden");
  $("signup-screen").classList.add("hidden");
  $("reset-screen").classList.add("hidden");
  $("app-shell").classList.add("hidden");

  let createCard = $("create-business-screen");
  if (!createCard) {
    createCard = document.createElement("div");
    createCard.id = "create-business-screen";
    createCard.className = "login-wrap";
    createCard.innerHTML = `
      <div class="login-card" style="max-width: 520px">
        <div class="flag-strip"></div>
        <div class="login-logo">
          <img src="./uganda-pos-icon.svg" alt="Qwickpos" />
          <h1>Create Your Business</h1>
          <p>
            You're logged in but haven't set up a business yet.
            Fill in the details to start your 14-day free trial.
          </p>
        </div>
        <form id="create-business-form">
          <div class="field">
            <label for="cb-business-name">Business Name</label>
            <input id="cb-business-name" required placeholder="e.g. My Shop" />
          </div>
          <div class="field-row">
            <div class="field">
              <label for="cb-full-name">Your Full Name</label>
              <input id="cb-full-name" required placeholder="John Doe" />
            </div>
            <div class="field">
              <label for="cb-phone">Phone</label>
              <input id="cb-phone" placeholder="+2567xxxxxxxx" />
            </div>
          </div>
          <div class="field">
            <label for="cb-currency">Base Currency</label>
            <select id="cb-currency">
              <option value="UGX">UGX — Uganda Shilling</option>
              <option value="USD">USD — US Dollar</option>
              <option value="KES">KES — Kenyan Shilling</option>
            </select>
          </div>
          <button class="btn btn-primary btn-block" type="submit" id="cb-submit">
            Create Business & Start Trial
          </button>
          <p
            id="cb-error"
            class="help-text"
            style="color: var(--danger); display: none; margin-top: 10px"
          ></p>
        </form>
        <p class="help-text" style="text-align: center; margin-top: 16px">
          <a href="#" id="cb-cancel">Cancel</a>
        </p>
      </div>
    `;
    document.body.appendChild(createCard);
  } else {
    createCard.classList.remove("hidden");
  }

  // Wire form
  const form = $("create-business-form");
  const submitBtn = $("cb-submit");
  const errEl = $("cb-error");
  const cancelLink = $("cb-cancel");

  // Clean up any old listeners
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  // Re-get references after clone
  const freshForm = $("create-business-form");
  const freshBtn = $("cb-submit");
  const freshErr = $("cb-error");
  const freshCancel = $("cb-cancel");

  freshCancel.addEventListener("click", (e) => {
    e.preventDefault();
    showLoginScreen();
  });

  freshForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    freshErr.style.display = "none";

    const businessName = $("cb-business-name").value.trim();
    const fullName = $("cb-full-name").value.trim();
    const phone = $("cb-phone").value.trim();
    const currency = $("cb-currency").value;

    if (!businessName || !fullName) {
      freshErr.textContent = "Business name and your name are required.";
      freshErr.style.display = "block";
      return;
    }

    freshBtn.disabled = true;
    freshBtn.textContent = "Creating…";

    // Try RPC first (schema v1-v8)
    let rpcFailed = false;
    const { error: rpcErr } = await supabase.rpc("create_business_and_owner", {
      p_business_name: businessName,
      p_full_name: fullName,
      p_phone: phone,
      p_base_currency: currency,
      p_plan_code: "starter",
    });

    if (rpcErr) {
      rpcFailed = true;
      console.warn(
        "create_business_and_owner RPC failed, using fallback:",
        rpcErr.message,
      );
    }

    // Fallback: direct inserts if RPC failed or doesn't exist
    if (rpcFailed) {
      try {
        const { data: plan } = await supabase
          .from("plans")
          .select("*")
          .eq("code", "starter")
          .eq("is_active", true)
          .single();

        if (!plan) throw new Error("Starter plan not found");

        // Create business
        const { data: business, error: bizErr } = await supabase
          .from("businesses")
          .insert({
            name: businessName,
            base_currency: currency,
            primary_phone: phone || null,
          })
          .select()
          .single();

        if (bizErr) throw bizErr;

        // Create default branch
        const { data: branch, error: branchErr } = await supabase
          .from("branches")
          .insert({ business_id: business.id, name: "Main Branch" })
          .select()
          .single();

        if (branchErr) throw branchErr;

        // Link current auth user to the business as admin
        const { error: userErr } = await supabase.from("app_users").insert({
          id: STATE.session.user.id,
          business_id: business.id,
          branch_id: branch.id,
          full_name: fullName,
          phone: phone || null,
          role: "admin",
          is_active: true,
        });

        if (userErr) throw userErr;

        // Create subscription (14-day trial)
        const trialEnds = new Date();
        trialEnds.setDate(trialEnds.getDate() + 14);
        const { error: subErr } = await supabase.from("subscriptions").insert({
          business_id: business.id,
          plan_id: plan.id,
          status: "trialing",
          trial_ends_at: trialEnds.toISOString(),
          current_period_end: trialEnds.toISOString(),
        });

        if (subErr) throw subErr;
      } catch (fallbackErr) {
        freshBtn.disabled = false;
        freshBtn.textContent = "Create Business & Start Trial";
        freshErr.textContent =
          fallbackErr.message || "Failed to create business";
        freshErr.style.display = "block";
        console.error("Fallback create business failed:", fallbackErr);
        return;
      }
    }

    freshBtn.disabled = false;
    freshBtn.textContent = "Create Business & Start Trial";

    freshErr.style.display = "none";
    // Business created — reload bootstrap
    createCard.classList.add("hidden");
    await boot();
  });
}
