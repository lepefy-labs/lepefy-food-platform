import type { createServiceClient } from '@/lib/supabase/server';
import type { CheckoutSessionStatus, Tenant, TenantPaymentMethod } from '@lepefy/types';
import { PAYMENT_METHOD_REGISTRY } from '@lepefy/types';
import { computePreorderTotals, effectivePreorderStatus, preorderReference } from './assistedOrderPolicy';
import { expireIfDue, type AssistedSessionRow } from './assistedOrderServer';
import { hashPayLinkToken, isWellFormedPayLinkToken } from './payLinkToken';
import { buildOrderTrackingLink } from '@/lib/orders/convertCheckoutSessionToOrder';
import { shopBaseUrl } from './assistedOrderServer';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Résolution d'un lien public : jeton bien formé → SHA-256 → session assistée
 * du tenant courant uniquement. Un jeton révoqué (hash remplacé ou effacé),
 * inconnu ou d'un autre tenant donne le même résultat : introuvable.
 */
export async function loadSessionByPayToken(
  supabase: ServiceClient,
  tenantId: string,
  token: string,
): Promise<AssistedSessionRow | null> {
  if (!isWellFormedPayLinkToken(token)) return null;
  const { data, error } = await supabase
    .from('checkout_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('origin', 'assisted')
    .eq('pay_token_hash', hashPayLinkToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return expireIfDue(supabase, data as AssistedSessionRow);
}

export type PublicPaymentMethodKind = 'link' | 'transfer' | 'instructions';

export interface PublicPaymentMethod {
  id: string;
  method: TenantPaymentMethod['method'];
  label: string;
  kind: PublicPaymentMethodKind;
  /** IBAN / identifiant à afficher (virement, Satispay sans lien). */
  value: string | null;
  beneficiary: string | null;
  bic: string | null;
}

/**
 * Moyens externes réellement actifs pour la boutique. Carte et Apple Pay
 * passent par Stripe ; les espèces n'ont pas de sens pour un paiement à distance.
 */
export function publicExternalMethods(methods: TenantPaymentMethod[]): PublicPaymentMethod[] {
  return methods
    .filter((method) => method.active && method.enabled_modules.includes('shop'))
    .filter((method) => !['card', 'apple_pay', 'cash'].includes(method.method))
    .map((method): PublicPaymentMethod | null => {
      const label = method.label?.trim() || PAYMENT_METHOD_REGISTRY[method.method]?.label || method.method;
      if (method.method === 'bank_transfer') {
        if (!method.value) return null;
        return {
          id: method.id, method: method.method, label, kind: 'transfer', value: method.value,
          beneficiary: method.extra?.beneficiary ?? null, bic: method.extra?.bic ?? null,
        };
      }
      if (method.extra?.link) {
        return { id: method.id, method: method.method, label, kind: 'link', value: null, beneficiary: null, bic: null };
      }
      if (method.value) {
        return { id: method.id, method: method.method, label, kind: 'instructions', value: method.value, beneficiary: null, bic: null };
      }
      return null;
    })
    .filter((method): method is PublicPaymentMethod => method !== null);
}

/** Lien externe final (montant ajouté pour PayPal.me, comme le checkout storefront). */
export function externalPaymentLink(method: TenantPaymentMethod, total: number, currency: string): string | null {
  const link = method.extra?.link;
  if (!link) return null;
  return method.method === 'paypal'
    ? `${link.replace(/\/+$/, '')}/${total.toFixed(2)}${currency.toUpperCase()}`
    : link;
}

export interface PublicPreorderView {
  reference: string;
  status: CheckoutSessionStatus;
  expiresAt: string | null;
  customerName: string | null;
  fulfillmentType: 'delivery' | 'pickup';
  shippingAddress: { full_name: string; line1: string; line2?: string | null; postal_code: string; city: string; country: string } | null;
  items: Array<{ name: string; quantity: number; price: number; lineTotal: number; imageUrl: string | null }>;
  totals: ReturnType<typeof computePreorderTotals>;
  currency: string;
  card: boolean;
  externalMethods: PublicPaymentMethod[];
  declaredPayment: { label: string | null; reference: string | null; link: string | null } | null;
  trackingLink: string | null;
}

/**
 * Vue publique minimale : uniquement ce qui est nécessaire au paiement.
 * Jamais : note interne, identifiants client/admin, e-mail, téléphone,
 * historique, intent Stripe, autres sessions.
 */
export async function buildPublicPreorderView(
  supabase: ServiceClient,
  tenant: Tenant,
  session: AssistedSessionRow,
  methods: TenantPaymentMethod[],
): Promise<PublicPreorderView> {
  const status = effectivePreorderStatus(session.status, session.expires_at);
  const productIds = (session.items ?? []).map((item) => item.productId).filter(Boolean);
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id, image_url').eq('tenant_id', tenant.id).in('id', productIds)
    : { data: [] as Array<{ id: string; image_url: string | null }> };
  const imageById = new Map(((products ?? []) as Array<{ id: string; image_url: string | null }>).map((p) => [p.id, p.image_url]));

  let trackingLink: string | null = null;
  if (status === 'completed' && session.order_id) {
    const { data: order } = await supabase.from('orders').select('id, email').eq('id', session.order_id).eq('tenant_id', tenant.id).maybeSingle();
    if (order) trackingLink = buildOrderTrackingLink(order.id as string, (order as { email: string | null }).email, shopBaseUrl(tenant));
  }

  const payable = status === 'open';
  return {
    reference: preorderReference(session.id),
    status,
    expiresAt: payable ? session.expires_at : null,
    customerName: session.full_name,
    fulfillmentType: session.fulfillment_type,
    shippingAddress: session.fulfillment_type === 'delivery' ? session.shipping_address : null,
    items: (session.items ?? []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      lineTotal: Math.round(item.price * item.quantity * 100) / 100,
      imageUrl: imageById.get(item.productId) ?? null,
    })),
    totals: computePreorderTotals(session.items ?? [], session.shipping_total, session.ambassador_discount_amount),
    currency: tenant.currency ?? 'EUR',
    card: payable,
    externalMethods: payable ? publicExternalMethods(methods) : [],
    declaredPayment: status === 'awaiting_verification'
      ? {
          label: session.external_payment_label,
          reference: session.declared_payment_reference,
          link: session.external_payment_link,
        }
      : null,
    trackingLink,
  };
}
