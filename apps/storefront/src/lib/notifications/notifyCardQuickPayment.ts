import { cardQuickPaymentCustomerEmail, cardQuickPaymentEmail } from '@/lib/notifications/customerEmails';
import { sendTenantEmail } from '@/lib/notifications/sendEmail';

export interface PaidCardQuickPayment {
  id: string;
  tenant_id: string;
  amount: number;
  currency: string;
  customer_name: string | null;
  customer_email: string | null;
}

/**
 * Side effects of a /card payment already marked paid by the Stripe webhook:
 * the tenant alert, then the optional customer confirmation. Each email has
 * its own ledger idempotency key (a Stripe retry never sends either twice) and
 * a failure of one never affects the other, the payment row or the webhook.
 */
export async function notifyCardQuickPaymentPaid(
  input: { payment: PaidCardQuickPayment; paymentIntentId: string; paidAt: string; tenantRecipients: string[] },
  send: typeof sendTenantEmail = sendTenantEmail,
): Promise<{ tenant: boolean; customer: boolean | 'skipped' }> {
  const { payment, paymentIntentId, paidAt } = input;

  const tenant = await safely(paymentIntentId, 'tenant', () => send({
    tenantId:         payment.tenant_id,
    notificationType: 'card_quick_payment',
    idempotencyKey:   `card-quick-payment:${paymentIntentId}`,
    recipients:       input.tenantRecipients,
    render: (context) => cardQuickPaymentEmail(context, {
      amount:          payment.amount,
      currency:        payment.currency,
      customerName:    payment.customer_name,
      customerEmail:   payment.customer_email,
      paidAt,
      paymentIntentId,
    }),
  }));

  const customerEmail = payment.customer_email?.trim();
  if (!customerEmail) return { tenant, customer: 'skipped' };

  const customer = await safely(paymentIntentId, 'customer', () => send({
    tenantId:         payment.tenant_id,
    notificationType: 'card_quick_payment_customer',
    idempotencyKey:   `card-quick-payment-customer:${paymentIntentId}`,
    recipients:       [customerEmail],
    render: (context) => cardQuickPaymentCustomerEmail(context, {
      quickPaymentId: payment.id,
      amount:         payment.amount,
      currency:       payment.currency,
      customerName:   payment.customer_name,
      paidAt,
    }),
  }));
  if (!customer) console.error('[card-quick-payment] customer confirmation not accepted — intent:', paymentIntentId, '— payment:', payment.id);

  return { tenant, customer };
}

async function safely(paymentIntentId: string, audience: string, run: () => Promise<boolean>) {
  try {
    return await run();
  } catch (error) {
    console.error(`[card-quick-payment] ${audience} email failed — intent:`, paymentIntentId, error);
    return false;
  }
}
