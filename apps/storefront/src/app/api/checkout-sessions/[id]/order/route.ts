import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { isValidCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { getOrCreateOrderPublicTokens, orderPortalUrl } from '@/lib/orders/portal/orderPublicToken';
import {
  buildConfirmationOrderView,
  type ConfirmationOrderItemRow,
  type ConfirmationOrderRow,
  type ConfirmationResponse,
} from '@/lib/orders/confirmationView';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const NO_STORE = { 'Cache-Control': 'no-store' };
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SessionRow {
  id: string;
  email: string | null;
  customer_id: string | null;
  order_id: string | null;
}

/**
 * Page de confirmation : la commande issue d'une session de paiement, pour son
 * client. Autorisé par le jeton d'accès de la session (HMAC, aucun appel
 * Stripe) ou par le client connecté propriétaire. Tant que le webhook n'a pas
 * créé la commande : `pending`. Vue réduite (`buildConfirmationOrderView`),
 * jamais mise en cache. Même 404 pour une session inconnue ou un jeton faux.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const notFound = () => NextResponse.json({ error: 'Commande introuvable.' }, { status: 404, headers: NO_STORE });
  try {
    if (!SESSION_ID.test(params.id)) return notFound();
    const body: { accessToken?: unknown } = await req.json().catch(() => ({}));
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken : '';

    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const db = createServiceClient();
    const { data, error } = await db.from('checkout_sessions')
      .select('id, email, customer_id, order_id')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (error) {
      console.error('[checkout-sessions][order] lookup error:', error.code);
      return NextResponse.json({ error: 'Lecture impossible pour le moment.' }, { status: 500, headers: NO_STORE });
    }
    const session = data as SessionRow | null;
    if (!session) return notFound();

    const tokenValid = Boolean(accessToken && isValidCheckoutSessionAccessToken(session.id, session.email ?? '', accessToken));
    let allowed = tokenValid;
    if (!allowed && session.customer_id) {
      const customer = await getSessionCustomer(tenant.id);
      allowed = customer?.id === session.customer_id;
    }
    if (!allowed) return notFound();

    let orderQuery = db.from('orders')
      .select('id, email, fulfillment_type, payment_method, shipping_address, shipping_cost, subtotal, total')
      .eq('tenant_id', tenant.id);
    orderQuery = session.order_id ? orderQuery.eq('id', session.order_id) : orderQuery.eq('checkout_session_id', session.id);
    const { data: orderData } = await orderQuery.maybeSingle();
    const order = orderData as ConfirmationOrderRow | null;
    if (!order) {
      return NextResponse.json({ status: 'pending', email: session.email } satisfies ConfirmationResponse, { headers: NO_STORE });
    }

    const { data: itemData } = await db.from('order_items')
      .select('id, name, quantity, subtotal')
      .eq('order_id', order.id);

    // Lien « Suivre ma commande » : portail /o/[jeton] existant, créé à la demande.
    let trackingUrl: string | null = null;
    const base = tenant.storefront_url?.replace(/\/$/, '') || req.nextUrl.origin;
    try {
      const token = (await getOrCreateOrderPublicTokens(db, tenant.id, [order.id])).get(order.id);
      trackingUrl = token ? orderPortalUrl(base, token) : null;
    } catch {
      trackingUrl = null;
    }

    const view = buildConfirmationOrderView(order, (itemData ?? []) as ConfirmationOrderItemRow[], trackingUrl);
    return NextResponse.json({ status: 'ready', order: view } satisfies ConfirmationResponse, { headers: NO_STORE });
  } catch (err) {
    console.error('[checkout-sessions][order] unhandled error:', err);
    return NextResponse.json({ error: 'Lecture impossible pour le moment.' }, { status: 500, headers: NO_STORE });
  }
}
