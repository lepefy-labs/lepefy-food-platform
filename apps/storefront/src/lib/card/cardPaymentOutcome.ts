/**
 * /card payment outcome, shared by the success screen (client) and the
 * customer confirmation email (server). Pure helpers: no Stripe call here.
 */

export type CardPaymentOutcome = 'succeeded' | 'processing' | 'failed';

export interface CardPaymentReceipt {
  amount: number;
  /** CP-XXXXXX, same as the confirmation email. */
  reference: string | null;
  email: string | null;
}

/** Customer-facing reference of a /card payment: short, stable, never the Stripe id. */
export function cardPaymentReference(quickPaymentId: string) {
  return `CP-${quickPaymentId.replace(/[^0-9a-z]/gi, '').slice(0, 6).toUpperCase()}`;
}

/** m•••@gmail.com: enough to recognise the address on a shared screen. */
export function maskEmail(email: string | null | undefined) {
  const value = email?.trim();
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at < 1) return null;
  return `${value[0]}•••${value.slice(at)}`;
}

/**
 * PaymentIntent status after a return from a redirect-based method or bank
 * authentication. "failed" only for states where nothing was charged.
 */
export function outcomeFromIntentStatus(status: string | null | undefined): CardPaymentOutcome | null {
  switch (status) {
    case 'succeeded': return 'succeeded';
    case 'processing':
    case 'requires_capture': return 'processing';
    case 'requires_payment_method':
    case 'requires_action':
    case 'requires_confirmation':
    case 'canceled': return 'failed';
    default: return null;
  }
}

/** pi_123_secret_abc → pi_123 */
export function paymentIntentIdFromSecret(clientSecret: string | null | undefined) {
  const id = clientSecret?.split('_secret_')[0];
  return id && id.startsWith('pi_') ? id : null;
}

const KEY = (paymentIntentId: string) => `lepefy-card-payment:${paymentIntentId}`;

/**
 * Kept for this browser tab only, so the success screen still shows the
 * reference and email after a redirect (e.g. bank app). Storage can be
 * unavailable (private mode): the screen then simply omits those rows.
 */
export function rememberCardPayment(paymentIntentId: string, receipt: CardPaymentReceipt, storage: Pick<Storage, 'setItem'> | null = safeSessionStorage()) {
  try { storage?.setItem(KEY(paymentIntentId), JSON.stringify(receipt)); } catch { /* storage full or blocked */ }
}

export function recallCardPayment(paymentIntentId: string, storage: Pick<Storage, 'getItem'> | null = safeSessionStorage()): CardPaymentReceipt | null {
  try {
    const raw = storage?.getItem(KEY(paymentIntentId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CardPaymentReceipt>;
    return {
      amount: typeof value.amount === 'number' ? value.amount : 0,
      reference: typeof value.reference === 'string' ? value.reference : null,
      email: typeof value.email === 'string' ? value.email : null,
    };
  } catch {
    return null;
  }
}

function safeSessionStorage() {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
