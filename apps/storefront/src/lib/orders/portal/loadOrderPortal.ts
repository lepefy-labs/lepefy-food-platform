import type { Tenant } from '@lepefy/types';
import type { createServiceClient } from '@/lib/supabase/server';
import { getAdminWorkspaceUrls } from '@/lib/admin/workspace';
import { canUseReviews } from '@/lib/entitlements/tenantEntitlements';
import { createReviewToken, hashReviewToken } from '@/lib/reviews/reviewInvites';
import { resolveOrderPublicToken } from './orderPublicToken';
import { buildOrderPortalViewModel, type OrderPortalViewModel, type PortalOrderRow } from './portalViewModel';
import { buildReorderProposal, type ReorderCatalogProduct, type ReorderProposal } from './reorderProposal';

/**
 * Lectures serveur du portail `/o/[token]` (service role, toujours filtrées par
 * le tenant du déploiement). Aucune table n'est lisible publiquement : la page
 * et ses routes sont la seule surface, et n'exposent que le view-model minimal.
 * Aucun appel transporteur live : uniquement l'instantané persisté.
 */
type ServiceClient = ReturnType<typeof createServiceClient>;

const PORTAL_ORDER_COLUMNS = 'id, created_at, status, fulfillment_type, payment_status, tracking_code, tracking_carrier, shipping_details, shipping_tracking_mode, shipping_normalized_status, shipping_tracking_url, shipping_estimated_delivery_at, shipping_tracking_events';
const LEGACY_PORTAL_ORDER_COLUMNS = 'id, created_at, status, fulfillment_type, payment_status, tracking_code, tracking_carrier, shipping_details';

type PortalOrder = PortalOrderRow & { payment_status: string };

async function loadPortalOrder(db: ServiceClient, tenantId: string, token: string): Promise<PortalOrder | null> {
  const resolved = await resolveOrderPublicToken(db, tenantId, token);
  if (!resolved) return null;
  let result = await db.from('orders').select(PORTAL_ORDER_COLUMNS).eq('tenant_id', tenantId).eq('id', resolved.orderId).maybeSingle();
  // Colonnes de suivi géré absentes (migration 111 non appliquée) : on lit le minimum.
  if (result.error) result = await db.from('orders').select(LEGACY_PORTAL_ORDER_COLUMNS).eq('tenant_id', tenantId).eq('id', resolved.orderId).maybeSingle() as typeof result;
  if (result.error || !result.data) return null;
  return result.data as unknown as PortalOrder;
}

interface ReviewInviteRow { id: string; expires_at: string; eligible_at: string; completed_at: string | null }

/** Invitation d'avis encore utilisable pour cette commande (ou null). */
async function usableReviewInvite(db: ServiceClient, tenantId: string, order: PortalOrder): Promise<ReviewInviteRow | null> {
  if (order.status !== 'delivered' || order.payment_status !== 'paid') return null;
  try {
    if (!(await canUseReviews(tenantId))) return null;
    const { data: invite } = await db.from('review_invites')
      .select('id, expires_at, eligible_at, completed_at')
      .eq('tenant_id', tenantId).eq('order_id', order.id).eq('review_type', 'service').maybeSingle();
    const row = invite as ReviewInviteRow | null;
    const now = Date.now();
    if (!row || row.completed_at || Date.parse(row.expires_at) <= now || Date.parse(row.eligible_at) > now) return null;
    const { data: existing } = await db.from('reviews').select('id').eq('tenant_id', tenantId).eq('order_id', order.id).eq('review_type', 'service').maybeSingle();
    return existing ? null : row;
  } catch {
    return null;
  }
}

export async function loadOrderPortal(db: ServiceClient, tenant: Tenant, token: string): Promise<OrderPortalViewModel | null> {
  const order = await loadPortalOrder(db, tenant.id, token);
  if (!order) return null;
  const [itemsResult, invite] = await Promise.all([
    db.from('order_items').select('name, quantity, product_id').eq('tenant_id', tenant.id).eq('order_id', order.id),
    usableReviewInvite(db, tenant.id, order),
  ]);
  const items = (itemsResult.data ?? []) as Array<{ name: string; quantity: number; product_id: string | null }>;
  return buildOrderPortalViewModel({
    order,
    items,
    tenant,
    shopBaseUrl: getAdminWorkspaceUrls(tenant).shopBaseUrl,
    reviewAvailable: Boolean(invite),
    reorderAvailable: items.some((item) => Boolean(item.product_id)),
  });
}

/** Proposition de riordino (lecture seule). */
export async function loadReorderProposal(db: ServiceClient, tenantId: string, token: string): Promise<ReorderProposal | null> {
  const resolved = await resolveOrderPublicToken(db, tenantId, token);
  if (!resolved) return null;
  const { data: items, error } = await db.from('order_items').select('product_id, name, quantity').eq('tenant_id', tenantId).eq('order_id', resolved.orderId);
  if (error) throw new Error('reorder_items_unavailable');
  const original = (items ?? []) as Array<{ product_id: string | null; name: string; quantity: number }>;
  const productIds = Array.from(new Set(original.map((item) => item.product_id).filter((id): id is string => Boolean(id))));
  let catalog: ReorderCatalogProduct[] = [];
  if (productIds.length > 0) {
    const { data, error: productError } = await db.from('products')
      .select('id, name, slug, price, image_url, weight_grams, stock, storage_type, min_order_quantity, order_quantity_step, active')
      .eq('tenant_id', tenantId).in('id', productIds);
    if (productError) throw new Error('reorder_products_unavailable');
    catalog = (data ?? []) as ReorderCatalogProduct[];
  }
  return buildReorderProposal(original, catalog);
}

/**
 * « Donner mon avis » : émet un jeton d'avis à usage unique pour l'invitation
 * existante de la commande, uniquement si elle est encore utilisable. Le jeton
 * portail ne donne aucun autre droit sur l'avis (le formulaire revalide tout).
 */
export async function issuePortalReviewToken(db: ServiceClient, tenantId: string, token: string): Promise<string | null> {
  const order = await loadPortalOrder(db, tenantId, token);
  if (!order) return null;
  const invite = await usableReviewInvite(db, tenantId, order);
  if (!invite) return null;
  const rawToken = createReviewToken();
  const { error } = await db.from('review_invite_tokens').insert({
    invite_id: invite.id,
    tenant_id: tenantId,
    token_hash: hashReviewToken(rawToken),
    purpose: 'qr_portal',
    expires_at: invite.expires_at,
  });
  return error ? null : rawToken;
}
