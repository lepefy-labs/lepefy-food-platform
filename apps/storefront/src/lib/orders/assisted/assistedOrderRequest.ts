import type { createServiceClient } from '@/lib/supabase/server';
import type { SalesChannel, Tenant } from '@lepefy/types';
import { cleanOptionalText, isSalesChannel } from './assistedOrderPolicy';
import {
  prepareAssistedCart, resolveAssistedCustomer,
  type Failure, type PreparedAssistedCart, type ResolvedAssistedCustomer,
} from './assistedOrderServer';

type ServiceClient = ReturnType<typeof createServiceClient>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRequestKey(raw: unknown): string | null {
  return typeof raw === 'string' && UUID_PATTERN.test(raw) ? raw.toLowerCase() : null;
}

export interface ParsedAssistedContent {
  salesChannel: SalesChannel;
  adminNote: string | null;
  customer: ResolvedAssistedCustomer;
  cart: PreparedAssistedCart;
}

/**
 * Lecture commune (création / modification / « Déjà payé ») du contenu d'une
 * précommande. Aucune valeur monétaire ni aucun tenant n'est lu du corps :
 * seuls identifiants produit, quantités, contact, adresse et jeton de devis.
 */
export async function parseAssistedContent(
  supabase: ServiceClient,
  tenant: Tenant,
  body: Record<string, unknown>,
  { allowPendingShipping }: { allowPendingShipping: boolean },
): Promise<{ ok: true; content: ParsedAssistedContent } | Failure> {
  if (!isSalesChannel(body.salesChannel)) {
    return { ok: false, status: 400, body: { error: 'Choisissez l\'origine de la commande.' } };
  }
  const customer = await resolveAssistedCustomer(supabase, tenant.id, body.customer);
  if (customer.ok === false) return customer;

  const cart = await prepareAssistedCart(supabase, tenant, {
    items: body.items,
    fulfillmentType: body.fulfillmentType,
    shippingAddress: body.shippingAddress,
    quoteToken: body.quoteToken,
    shippingDetails: body.shippingDetails,
    customerId: customer.customer.customerId,
    allowPendingShipping,
  });
  if (cart.ok === false) return cart;

  return {
    ok: true,
    content: {
      salesChannel: body.salesChannel,
      adminNote: cleanOptionalText(body.adminNote, 1000),
      customer: customer.customer,
      cart: cart.cart,
    },
  };
}

/** Colonnes `checkout_sessions` décrivant le contenu (hors statut/paiement/lien). */
export function sessionContentColumns(content: ParsedAssistedContent): Record<string, unknown> {
  const { customer, cart } = content;
  return {
    customer_id: customer.customerId,
    email: customer.email,
    full_name: customer.fullName,
    phone: customer.phone,
    fulfillment_type: cart.fulfillmentType,
    shipping_address: cart.shippingAddress,
    shipping_details: cart.shippingDetails,
    shipping_total: cart.shippingTotal,
    ambassador_discount_amount: cart.ambassadorDiscount,
    items: cart.items,
    sales_channel: content.salesChannel,
    admin_note: content.adminNote,
  };
}
