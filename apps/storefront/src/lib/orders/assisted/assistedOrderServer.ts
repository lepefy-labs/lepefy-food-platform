import type { createServiceClient } from '@/lib/supabase/server';
import type {
  AssistedCartLine, AssistedShippingAddress, CheckoutSessionStatus, ManualPaymentMethod, SalesChannel, Tenant,
} from '@lepefy/types';
import { validateCheckoutItems } from '@/lib/checkout/validateCheckoutItems';
import { revalidateSessionShipping, verifyCheckoutShipping } from '@/lib/shipping/tariff/checkoutShipping';
import { resolveCheckoutAmbassadorDiscount } from '@/lib/ambassador/resolveCheckoutAmbassadorDiscount';
import { resolveOrCreateCustomer } from '@/lib/customers/resolveOrCreateCustomer';
import { normalizeCustomerEmail } from '@/lib/customers/normalizeCustomerIdentity';
import { getAdminWorkspaceUrls } from '@/lib/admin/workspace';
import { computePreorderTotals, effectivePreorderStatus, parseAssistedAddress } from './assistedOrderPolicy';
import { derivePayLinkToken, hashPayLinkToken, newPayLinkNonce } from './payLinkToken';

type ServiceClient = ReturnType<typeof createServiceClient>;

export type Failure = { ok: false; status: number; body: { error: string; code?: string; violations?: unknown } };

/** Ligne `checkout_sessions` d'une précommande assistée (colonnes utiles côté serveur). */
export interface AssistedSessionRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: AssistedShippingAddress | null;
  shipping_details: Record<string, unknown> | null;
  shipping_total: number;
  ambassador_discount_amount: number | null;
  items: AssistedCartLine[];
  status: CheckoutSessionStatus;
  payment_method: 'stripe' | 'external_link';
  external_payment_type: string | null;
  external_payment_label: string | null;
  external_payment_link: string | null;
  stripe_payment_intent_id: string | null;
  origin: 'storefront' | 'assisted';
  sales_channel: SalesChannel | null;
  created_by_admin_id: string | null;
  admin_note: string | null;
  notify_customer: boolean;
  pay_token_hash: string | null;
  pay_token_nonce: string | null;
  pay_token_issued_at: string | null;
  pay_link_version: number;
  declared_payment_at: string | null;
  declared_payment_reference: string | null;
  order_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function loadAssistedSession(supabase: ServiceClient, tenantId: string, id: string): Promise<AssistedSessionRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase
    .from('checkout_sessions')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('origin', 'assisted')
    .maybeSingle();
  if (error) throw error;
  return (data as AssistedSessionRow | null) ?? null;
}

/**
 * Expiration paresseuse (aucun cron requis) : un lien ouvert dont le délai est
 * écoulé passe en `expired` par une écriture conditionnelle idempotente.
 */
export async function expireIfDue(supabase: ServiceClient, session: AssistedSessionRow): Promise<AssistedSessionRow> {
  if (effectivePreorderStatus(session.status, session.expires_at) !== 'expired' || session.status !== 'open') return session;
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('checkout_sessions')
    .update({ status: 'expired', updated_at: nowIso })
    .eq('id', session.id)
    .eq('tenant_id', session.tenant_id)
    .eq('status', 'open')
    .lte('expires_at', nowIso)
    .select('*')
    .maybeSingle();
  return (data as AssistedSessionRow | null) ?? { ...session, status: 'expired' };
}

export function shopBaseUrl(tenant: Pick<Tenant, 'storefront_url'>): string {
  return getAdminWorkspaceUrls(tenant).shopBaseUrl ?? '';
}

export function payUrlFor(tenant: Pick<Tenant, 'storefront_url'>, token: string): string {
  return `${shopBaseUrl(tenant)}/pay/${token}`;
}

/** Lien courant (réaffichable par l'admin) — null si aucun lien actif. */
export function currentPayUrl(tenant: Pick<Tenant, 'storefront_url'>, session: Pick<AssistedSessionRow, 'id' | 'pay_token_hash' | 'pay_token_nonce' | 'status'>): string | null {
  if (!session.pay_token_hash || !session.pay_token_nonce) return null;
  if (!['open', 'awaiting_verification'].includes(session.status)) return null;
  const token = derivePayLinkToken(session.id, session.pay_token_nonce);
  if (!token || hashPayLinkToken(token) !== session.pay_token_hash) return null;
  return payUrlFor(tenant, token);
}

/** Nouveau lien : nouveau nonce (révoque l'ancien), hash de recherche, version +1. */
export function issuePayLinkFields(sessionId: string, currentVersion: number): {
  token: string; fields: Record<string, unknown>;
} | null {
  const nonce = newPayLinkNonce();
  const token = derivePayLinkToken(sessionId, nonce);
  if (!token) return null;
  return {
    token,
    fields: {
      pay_token_nonce: nonce,
      pay_token_hash: hashPayLinkToken(token),
      pay_token_issued_at: new Date().toISOString(),
      pay_link_version: currentVersion + 1,
    },
  };
}

export const REVOKED_LINK_FIELDS = { pay_token_hash: null, pay_token_nonce: null } as const;

export interface AssistedCustomerInput {
  id?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ResolvedAssistedCustomer {
  customerId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Identité client : client CRM existant choisi par l'opérateur, ou résolution
 * centrale `resolveOrCreateCustomer` (e-mail puis téléphone, jamais le nom) —
 * aucun doublon créé, aucune adresse e-mail inventée.
 */
export async function resolveAssistedCustomer(
  supabase: ServiceClient,
  tenantId: string,
  raw: unknown,
): Promise<{ ok: true; customer: ResolvedAssistedCustomer } | Failure> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as AssistedCustomerInput;
  const fullName = typeof input.fullName === 'string' && input.fullName.trim() ? input.fullName.trim().slice(0, 160) : null;
  const email = typeof input.email === 'string' && input.email.trim() ? input.email.trim().slice(0, 200) : null;
  const phone = typeof input.phone === 'string' && input.phone.trim() ? input.phone.trim().slice(0, 40) : null;

  if (email && !EMAIL_PATTERN.test(email)) {
    return { ok: false, status: 400, body: { error: 'Adresse e-mail invalide.' } };
  }

  if (input.id) {
    if (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.id)) {
      return { ok: false, status: 400, body: { error: 'Client invalide.' } };
    }
    const { data, error } = await supabase
      .from('customers')
      .select('id, full_name, email, phone')
      .eq('id', input.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) return { ok: false, status: 500, body: { error: 'Erreur serveur.' } };
    if (!data) return { ok: false, status: 404, body: { error: 'Client introuvable.' } };
    const row = data as { id: string; full_name: string | null; email: string | null; phone: string | null };
    const customer = {
      customerId: row.id,
      fullName: fullName ?? row.full_name,
      email: normalizeCustomerEmail(email ?? row.email),
      phone: phone ?? row.phone,
    };
    if (!customer.email && !customer.phone) {
      return { ok: false, status: 400, body: { error: 'Renseignez au moins un téléphone ou un e-mail pour ce client.' } };
    }
    return { ok: true, customer };
  }

  if (!email && !phone) {
    return { ok: false, status: 400, body: { error: 'Renseignez au moins un téléphone ou un e-mail.' } };
  }
  if (!fullName) {
    return { ok: false, status: 400, body: { error: 'Renseignez le nom du client.' } };
  }

  try {
    const resolved = await resolveOrCreateCustomer({ tenantId, email, phone, fullName, source: 'admin', supabase });
    return { ok: true, customer: { customerId: resolved.id, fullName, email: normalizeCustomerEmail(email), phone } };
  } catch (identityError) {
    console.warn('[assisted-orders] customer resolution failed:', identityError);
    return {
      ok: false, status: 409, body: {
        error: 'Ces coordonnées correspondent à plusieurs fiches clients. Sélectionnez le client existant dans la recherche.',
        code: 'CUSTOMER_COLLISION',
      },
    };
  }
}

export interface PreparedAssistedCart {
  items: AssistedCartLine[];
  quantityByProduct: Map<string, number>;
  fulfillmentType: 'delivery' | 'pickup';
  shippingAddress: AssistedShippingAddress | null;
  shippingTotal: number;
  shippingDetails: Record<string, unknown> | null;
  ambassadorDiscount: number;
  subtotal: number;
  total: number;
  /** Livraison sans devis : autorisé pour un brouillon uniquement. */
  shippingPending: boolean;
}

/**
 * Autorité serveur unique du contenu d'une précommande : articles actifs du
 * tenant, prix catalogue, règles minimum/pas/groupes, stock
 * (`validateCheckoutItems`) et frais de livraison vérifiés via le devis signé
 * du tenant (`verifyCheckoutShipping`) — jamais les montants du navigateur.
 */
export async function prepareAssistedCart(
  supabase: ServiceClient,
  tenant: Tenant,
  input: {
    items: unknown;
    fulfillmentType: unknown;
    shippingAddress: unknown;
    quoteToken: unknown;
    shippingDetails: unknown;
    customerId: string | null;
    allowPendingShipping: boolean;
  },
): Promise<{ ok: true; cart: PreparedAssistedCart } | Failure> {
  const fulfillmentType = input.fulfillmentType === 'pickup' ? 'pickup' : input.fulfillmentType === 'delivery' ? 'delivery' : null;
  if (!fulfillmentType) return { ok: false, status: 400, body: { error: 'Mode de remise invalide.' } };

  const rawItems = Array.isArray(input.items)
    ? input.items.map((item) => ({
        productId: typeof item?.productId === 'string' ? item.productId : null,
        quantity: Number(item?.quantity),
      }))
    : [];
  const validated = await validateCheckoutItems(supabase, tenant.id, rawItems);
  if (validated.ok === false) return { ok: false, status: validated.status, body: validated.body };

  const items = validated.items as AssistedCartLine[];
  const subtotal = computePreorderTotals(items, 0, 0).subtotal;

  let shippingAddress: AssistedShippingAddress | null = null;
  let shippingTotal = 0;
  let shippingDetails: Record<string, unknown> | null = null;
  let shippingPending = false;

  if (fulfillmentType === 'delivery') {
    shippingAddress = parseAssistedAddress(input.shippingAddress);
    if (!shippingAddress) return { ok: false, status: 400, body: { error: 'Adresse de livraison incomplète.' } };
    const quoteToken = typeof input.quoteToken === 'string' && input.quoteToken ? input.quoteToken : null;
    if (!quoteToken) {
      if (!input.allowPendingShipping) {
        return { ok: false, status: 400, body: { error: 'Calculez les frais de livraison avant de continuer.', code: 'SHIPPING_QUOTE_REQUIRED' } };
      }
      shippingPending = true;
      shippingDetails = { quotePending: true };
    }
  }

  if (!shippingPending) {
    const clientDetails = input.shippingDetails && typeof input.shippingDetails === 'object'
      ? input.shippingDetails as Record<string, unknown>
      : null;
    const shipping = await verifyCheckoutShipping({
      supabase,
      tenant,
      fulfillmentType,
      address: shippingAddress,
      quoteToken: typeof input.quoteToken === 'string' ? input.quoteToken : null,
      quantityByProduct: validated.quantityByProduct,
      subtotal,
      clientShippingDetails: clientDetails,
    });
    if (shipping.ok === false) return { ok: false, status: shipping.status, body: shipping.body };
    shippingTotal = shipping.shippingTotal;
    shippingDetails = shipping.shippingDetails;
  }

  const ambassadorDiscount = await resolveCheckoutAmbassadorDiscount({
    tenant: {
      id: tenant.id,
      ambassador_min_purchase_amount: tenant.ambassador_min_purchase_amount,
      ambassador_commission_mode: tenant.ambassador_commission_mode,
      ambassador_split_pool_amount: tenant.ambassador_split_pool_amount,
      ambassador_split_pool_ambassador_percent: tenant.ambassador_split_pool_ambassador_percent,
      ambassador_first_order_discount_type: tenant.ambassador_first_order_discount_type,
      ambassador_first_order_discount_value: tenant.ambassador_first_order_discount_value,
    },
    customerId: input.customerId,
    subtotal,
  });

  const totals = computePreorderTotals(items, shippingTotal, ambassadorDiscount);
  return {
    ok: true,
    cart: {
      items,
      quantityByProduct: validated.quantityByProduct,
      fulfillmentType,
      shippingAddress,
      shippingTotal: totals.shippingTotal,
      shippingDetails,
      ambassadorDiscount: totals.discount,
      subtotal: totals.subtotal,
      total: totals.total,
      shippingPending,
    },
  };
}

/**
 * Vérification finale avant d'accepter un paiement (lien public, PaymentIntent,
 * encaissement admin) : articles toujours actifs, règles et stock valides, frais
 * de livraison toujours applicables. Les prix enregistrés sont conservés
 * (garantis pendant la validité du lien) — jamais relus du navigateur.
 */
export async function revalidateAssistedSession(
  supabase: ServiceClient,
  tenant: Tenant,
  session: Pick<AssistedSessionRow, 'items' | 'fulfillment_type' | 'shipping_address' | 'shipping_details' | 'shipping_total'>,
): Promise<{ ok: true; quantityByProduct: Map<string, number> } | Failure> {
  if (session.shipping_details?.quotePending === true) {
    return { ok: false, status: 409, body: { error: 'Les frais de livraison doivent être calculés.', code: 'SHIPPING_QUOTE_REQUIRED' } };
  }
  const validated = await validateCheckoutItems(supabase, tenant.id, session.items);
  if (validated.ok === false) return { ok: false, status: validated.status === 400 ? 409 : validated.status, body: validated.body };
  const subtotal = computePreorderTotals(session.items, 0, 0).subtotal;
  const shipping = await revalidateSessionShipping({
    supabase,
    tenant,
    fulfillmentType: session.fulfillment_type,
    address: session.shipping_address,
    shippingDetails: session.shipping_details,
    shippingTotal: session.shipping_total ?? 0,
    quantityByProduct: validated.quantityByProduct,
    subtotal,
  });
  if (shipping.ok === false) return { ok: false, status: shipping.status, body: shipping.body };
  return { ok: true, quantityByProduct: validated.quantityByProduct };
}

export function manualMethodSnapshot(method: ManualPaymentMethod, label?: string | null) {
  return { external_payment_type: method, external_payment_label: label?.trim() || null };
}
