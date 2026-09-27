import type { TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';

export const ORDER_STOCK_CONFLICT_WEBHOOK = '/webhook/order-stock-conflict';

export interface OrderStockConflictInput {
  orderId: string;
  orderNumber: string;
  email: string | null;
  fullName: string;
  fulfillmentType: string | null;
  total: number;
  reason: string | null;
  refundSucceeded: boolean | null;
  manualRefundRequired: boolean;
  adminOrderLink: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function refundLine(input: OrderStockConflictInput) {
  if (input.manualRefundRequired) return 'Paiement hors Stripe : remboursement manuel à effectuer.';
  if (input.refundSucceeded === true) return 'Le client a été remboursé automatiquement via Stripe.';
  if (input.refundSucceeded === false) return 'Le remboursement Stripe automatique a ÉCHOUÉ : remboursement manuel requis.';
  return 'Statut du remboursement inconnu : vérifier dans Stripe.';
}

/**
 * Admin alert for a paid order that could not reserve stock. The email is
 * rendered here (escaped) and n8n only delivers it to `recipients`.
 */
export function buildOrderStockConflictNotification(
  context: TenantNotificationContext,
  recipients: string[],
  input: OrderStockConflictInput,
) {
  const tenant = escapeHtml(context.tenantName);
  const locale = context.locale || 'fr-FR';
  const total = new Intl.NumberFormat(locale, { style: 'currency', currency: context.currency || 'EUR' }).format(input.total);
  const urgentRefund = input.manualRefundRequired || input.refundSucceeded !== true;
  const subject = `[Action requise] Conflit de stock · commande ${input.orderNumber} · ${context.tenantName}`;
  const safeLink = /^https?:\/\//.test(input.adminOrderLink) ? escapeHtml(input.adminOrderLink) : null;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#25222b;line-height:1.6">
    <h1 style="font-size:22px;color:#b42318">Conflit de stock sur une commande payée</h1>
    <p>La commande <strong>${escapeHtml(input.orderNumber)}</strong> de <strong>${tenant}</strong> a été payée, mais le stock n’était plus disponible au moment de la validation.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#6b6475">Client</td><td>${escapeHtml(input.fullName || '—')}${input.email ? ` · ${escapeHtml(input.email)}` : ''}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b6475">Montant</td><td>${escapeHtml(total)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b6475">Mode</td><td>${input.fulfillmentType === 'pickup' ? 'Retrait' : 'Livraison'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b6475">Motif</td><td>${escapeHtml(input.reason ?? 'non précisé')}</td></tr>
    </table>
    <p style="padding:12px;border-radius:8px;background:${urgentRefund ? '#fef3f2' : '#ecfdf3'}"><strong>${escapeHtml(refundLine(input))}</strong></p>
    <p>Aucune confirmation de commande n’a été envoyée au client. Contactez-le pour proposer un remplacement ou confirmer le remboursement.</p>
    ${safeLink ? `<p><a href="${safeLink}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#b42318;color:#fff;text-decoration:none">Ouvrir la commande →</a></p>` : ''}
  </div>`;
  return {
    ...context,
    ...input,
    notificationType: 'order_stock_conflict',
    recipients,
    subject,
    html,
    idempotencyKey: `order-stock-conflict:${input.orderId}`,
  };
}
