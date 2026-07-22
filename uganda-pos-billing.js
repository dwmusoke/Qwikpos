// =====================================================================
// QWICKPOS — FLUTTERWAVE CLIENT INTEGRATION
//
// Collects subscription payments via Flutterwave Inline (mobile money —
// MTN/Airtel Uganda — plus card/USSD/bank as fallbacks). The inline
// checkout only tells the browser "the user completed a payment flow" —
// it is never trusted on its own. Every payment is re-verified server
// side by the verify-flutterwave-payment edge function (using your
// secret key) before a subscription is activated. See that function's
// header comment (uganda-pos-fn-verify-flutterwave-payment.ts) to deploy it.
// =====================================================================
import { supabase, STATE, FLW_PUBLIC_KEY, toast } from './uganda-pos-core.js';

let flwScriptPromise = null;

function loadFlutterwaveScript() {
  if (window.FlutterwaveCheckout) return Promise.resolve();
  if (flwScriptPromise) return flwScriptPromise;
  flwScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.flutterwave.com/v3.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Flutterwave checkout script'));
    document.head.appendChild(script);
  });
  return flwScriptPromise;
}

/**
 * Launches Flutterwave Inline Checkout for a subscription plan.
 * @param {object} plan - a row from `plans` (needs code, name, price_ugx)
 * @param {object} opts - { onSuccess(data), onClose() }
 */
export async function payForPlan(plan, { onSuccess, onClose } = {}) {
  if (!FLW_PUBLIC_KEY || FLW_PUBLIC_KEY.includes('YOUR-PUBLIC-KEY')) {
    toast('Flutterwave is not configured yet — set FLW_PUBLIC_KEY in uganda-pos-core.js', 'error', 6000);
    return;
  }

  try {
    await loadFlutterwaveScript();
  } catch (e) {
    toast('Could not reach Flutterwave — check your connection and try again.', 'error');
    return;
  }

  // Encodes business + plan into the reference so both the inline verify
  // call AND the async webhook can identify what was purchased without
  // trusting anything else from the client. See uganda-pos-fn-*.ts.
  const txRef = `SUB_${STATE.business.id}_${plan.code}_${Date.now()}`;
  const email = STATE.session?.user?.email || `${STATE.business.id}@billing.local`;

  window.FlutterwaveCheckout({
    public_key: FLW_PUBLIC_KEY,
    tx_ref: txRef,
    amount: Number(plan.price_ugx),
    currency: 'UGX',
    payment_options: 'mobilemoneyuganda, card, ussd, banktransfer',
    customer: {
      email,
      phone_number: STATE.appUser?.phone || '',
      name: STATE.appUser?.full_name || STATE.business?.name || 'Customer',
    },
    customizations: {
      title: 'Qwickpos Subscription',
      description: `${plan.name} plan — ${Number(plan.price_ugx).toLocaleString('en-UG')} UGX / month`,
      logo: `${location.origin}${location.pathname.replace(/[^/]+$/, '')}uganda-pos-icon.svg`,
    },
    callback: async (response) => {
      if (!response || (response.status !== 'successful' && response.status !== 'completed')) {
        toast('Payment was not completed.', 'error');
        return;
      }
      toast('Payment received — confirming with Flutterwave…', 'default', 5000);
      try {
        const { data, error } = await supabase.functions.invoke('verify-flutterwave-payment', {
          body: { transaction_id: response.transaction_id, tx_ref: response.tx_ref },
        });
        if (error || !data?.success) throw new Error(data?.error || error?.message || 'Verification failed');
        toast('Subscription activated 🎉', 'success', 5000);
        if (onSuccess) await onSuccess(data);
      } catch (err) {
        console.error(err);
        toast(
          'Payment received but we could not confirm it automatically. It will activate shortly via webhook, ' +
          'or contact support with reference: ' + response.tx_ref, 'error', 9000,
        );
      }
    },
    onclose: () => { if (onClose) onClose(); },
  });
}
