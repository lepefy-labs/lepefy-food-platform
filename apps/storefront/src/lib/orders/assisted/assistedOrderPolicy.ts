/**
 * Politique métier des commandes assistées — module pur (aucun accès réseau/DB),
 * partagé par les routes admin, la page publique /pay/[token] et l'UI.
 *
 * Lifecycle (checkout_sessions.status, origin = 'assisted') :
 *
 *   draft ──lien──▶ open ──paiement Stripe (webhook)──▶ completed
 *     │               │ └─client déclare un paiement externe─▶ awaiting_verification
 *     │               │                                          ├─admin confirme─▶ completed
 *     │               │                                          └─admin remet en attente─▶ open
 *     │               └─TTL écoulé─▶ expired ──nouveau lien──▶ open
 *     └─(draft | open | expired | awaiting_verification) ──annuler──▶ cancelled
 *
 * « Déjà payé » crée la session puis la convertit immédiatement (admin_recorded).
 */
import type {
  AssistedShippingAddress, CheckoutSessionStatus, ManualPaymentMethod, SalesChannel,
} from '@lepefy/types';
import { MANUAL_PAYMENT_METHOD_LABELS, SALES_CHANNEL_LABELS } from '@lepefy/types';

/** Durée de validité d'un lien de paiement : prix et frais garantis pendant ce délai. */
export const ASSISTED_PAY_LINK_TTL_HOURS = 72;
/** Un brouillon n'est jamais payable ; `expires_at` sert seulement de borne de rétention. */
export const ASSISTED_DRAFT_RETENTION_DAYS = 30;

export const SALES_CHANNELS = Object.keys(SALES_CHANNEL_LABELS) as SalesChannel[];
export const MANUAL_PAYMENT_METHODS = Object.keys(MANUAL_PAYMENT_METHOD_LABELS) as ManualPaymentMethod[];

export function isSalesChannel(value: unknown): value is SalesChannel {
  return typeof value === 'string' && (SALES_CHANNELS as string[]).includes(value);
}

export function isManualPaymentMethod(value: unknown): value is ManualPaymentMethod {
  return typeof value === 'string' && (MANUAL_PAYMENT_METHODS as string[]).includes(value);
}

export function payLinkExpiryFromNow(now = new Date()): string {
  return new Date(now.getTime() + ASSISTED_PAY_LINK_TTL_HOURS * 3_600_000).toISOString();
}

export function draftExpiryFromNow(now = new Date()): string {
  return new Date(now.getTime() + ASSISTED_DRAFT_RETENTION_DAYS * 86_400_000).toISOString();
}

/** Référence lisible partagée avec le client (et reprise dans les virements). */
export function preorderReference(sessionId: string): string {
  return `P-${sessionId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Statut réellement applicable : un lien ouvert dont le délai est écoulé est expiré. */
export function effectivePreorderStatus(
  status: CheckoutSessionStatus,
  expiresAt: string | null,
  now = Date.now(),
): CheckoutSessionStatus {
  if (status === 'open' && expiresAt && new Date(expiresAt).getTime() <= now) return 'expired';
  return status;
}

export type PreorderAction =
  | 'edit' | 'issue_link' | 'share_link' | 'confirm_payment' | 'record_payment'
  | 'reopen' | 'cancel' | 'open_order';

/**
 * Actions admin autorisées selon le statut effectif. Le serveur applique les
 * mêmes règles (conditions SQL sur le statut) : l'UI ne fait que les refléter.
 */
export function allowedPreorderActions(status: CheckoutSessionStatus, hasActiveLink: boolean): PreorderAction[] {
  switch (status) {
    case 'draft':
      return ['edit', 'issue_link', 'record_payment', 'cancel'];
    case 'open':
      return [
        'edit', ...(hasActiveLink ? ['share_link' as const] : []), 'issue_link', 'record_payment', 'cancel',
      ];
    case 'expired':
      return ['edit', 'issue_link', 'cancel'];
    case 'awaiting_verification':
      return ['confirm_payment', 'reopen', 'cancel'];
    case 'completed':
      return ['open_order'];
    case 'cancelled':
    default:
      return [];
  }
}

/** Statuts dans lesquels le contenu (articles, montants, livraison) peut encore changer. */
export const EDITABLE_PREORDER_STATUSES: CheckoutSessionStatus[] = ['draft', 'open', 'expired'];
/** Statuts depuis lesquels un lien peut être (ré)émis. */
export const LINKABLE_PREORDER_STATUSES: CheckoutSessionStatus[] = ['draft', 'open', 'expired'];
/** Statuts annulables sans commande. */
export const CANCELLABLE_PREORDER_STATUSES: CheckoutSessionStatus[] = ['draft', 'open', 'expired', 'awaiting_verification'];

export interface PreorderTotals {
  subtotal: number;
  shippingTotal: number;
  discount: number;
  total: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Même formule que la conversion SQL et le PaymentIntent (au centime près). */
export function computePreorderTotals(
  items: ReadonlyArray<{ price: number; quantity: number }>,
  shippingTotal: number | null | undefined,
  discount: number | null | undefined,
): PreorderTotals {
  const subtotal = round2(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const shipping = round2(shippingTotal ?? 0);
  const discountValue = round2(discount ?? 0);
  return { subtotal, shippingTotal: shipping, discount: discountValue, total: round2(subtotal + shipping - discountValue) };
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Lien de partage WhatsApp (wa.me). Aucun indicatif n'est inventé : un numéro
 * sans préfixe international ouvre simplement le sélecteur de conversation.
 */
export function buildWhatsAppShareUrl(phone: string | null | undefined, message: string): string {
  const raw = (phone ?? '').trim();
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  const international = digits.startsWith('+') ? digits.slice(1) : '';
  const target = /^\d{8,15}$/.test(international) ? international : '';
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}

export function buildPayLinkMessage({
  customerName, reference, totalLabel, url, tenantName,
}: {
  customerName: string | null | undefined;
  reference: string;
  totalLabel: string;
  url: string;
  tenantName: string;
}): string {
  const greeting = customerName?.trim() ? `Bonjour ${customerName.trim().split(/\s+/)[0]},` : 'Bonjour,';
  return `${greeting} voici le lien pour régler votre précommande ${reference} chez ${tenantName} (${totalLabel}) : ${url}`;
}

export function buildTrackingShareMessage({
  customerName, orderNumber, url, tenantName,
}: {
  customerName: string | null | undefined;
  orderNumber: string;
  url: string;
  tenantName: string;
}): string {
  const greeting = customerName?.trim() ? `Bonjour ${customerName.trim().split(/\s+/)[0]},` : 'Bonjour,';
  return `${greeting} votre commande ${orderNumber} chez ${tenantName} est confirmée. Suivez-la ici : ${url}`;
}

/** Validation stricte d'une adresse de livraison saisie par l'opérateur. */
export function parseAssistedAddress(raw: unknown): AssistedShippingAddress | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const text = (key: string, max = 200) => {
    const v = value[key];
    return typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null;
  };
  const fullName = text('full_name');
  const line1 = text('line1');
  const city = text('city', 120);
  const postalCode = text('postal_code', 20);
  const country = text('country', 2)?.toUpperCase() ?? null;
  if (!fullName || !line1 || !city || !postalCode || !country || !/^[A-Z]{2}$/.test(country)) return null;
  const line2 = typeof value.line2 === 'string' && value.line2.trim() ? value.line2.trim().slice(0, 200) : null;
  return { full_name: fullName, line1, line2, city, postal_code: postalCode, country };
}

/** Date d'encaissement : ISO valide, jamais dans le futur (tolérance 5 min), sinon maintenant. */
export function normalizeReceivedAt(raw: unknown, now = Date.now()): string | null {
  if (raw === undefined || raw === null || raw === '') return new Date(now).toISOString();
  if (typeof raw !== 'string') return null;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time) || time > now + 5 * 60_000) return null;
  return new Date(time).toISOString();
}

export function cleanOptionalText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
