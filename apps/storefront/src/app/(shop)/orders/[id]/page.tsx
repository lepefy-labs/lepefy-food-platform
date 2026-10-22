import Link from 'next/link';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatPrice } from '@/lib/utils/format';
import { IconLock } from '@tabler/icons-react';
import type { FulfillmentKind } from '@/lib/orders/orderStatus';
import type { NormalizedShipmentStatus, ShipmentTrackingEvent } from '@lepefy/types';
import { buildOrderTrackingView } from '@/lib/orders/tracking/orderTrackingView';
import { buildSupportChannels } from '@/lib/orders/portal/supportChannels';
import OrderTrackingEssentiel, { type TrackingAddress, type TrackingSummary } from './OrderTrackingEssentiel';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface ShippingAddress {
  full_name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

interface ShippingDetails {
  trackingCode?: string;
  trackingCarrier?: string;
  carrierName?: string;
  serviceName?: string;
}

interface OrderItem {
  name: string;
  quantity: number;
  subtotal: number;
}

interface OrderRow {
  id: string;
  tenant_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  email: string | null;
  full_name: string | null;
  total: number;
  shipping_cost: number;
  fulfillment_type: FulfillmentKind;
  tracking_code: string | null;
  tracking_carrier: string | null;
  shipped_at: string | null;
  picking_started_at: string | null;
  shipping_address: ShippingAddress | null;
  shipping_details: ShippingDetails | null;
  shipping_tracking_mode?: 'managed' | 'manual' | null;
  shipping_provider_reference?: string | null;
  shipping_normalized_status?: NormalizedShipmentStatus | null;
  shipping_tracking_url?: string | null;
  shipping_estimated_delivery_at?: string | null;
  shipping_tracking_events?: ShipmentTrackingEvent[] | null;
}

function isValidToken(orderId: string, email: string | null, token: string): boolean {
  if (!process.env.TRACKING_SECRET || !token) return false;
  const expected = crypto
    .createHmac('sha256', process.env.TRACKING_SECRET)
    .update(orderId + (email ?? ''))
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function countryName(code: string | null | undefined): string | null {
  const value = code?.trim();
  if (!value) return null;
  if (!/^[A-Za-z]{2}$/.test(value)) return value;
  try {
    return new Intl.DisplayNames(['fr'], { type: 'region' }).of(value.toUpperCase()) ?? value;
  } catch {
    return value;
  }
}

interface PageProps {
  params: { id: string };
  searchParams: { token?: string };
}

export default async function OrderTrackingPage({ params, searchParams }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const token = searchParams.token ?? '';
  const supabase = createServiceClient();

  const { data: order } = await supabase
    .from('orders')
    // Additive fields remain optional until migration 111; legacy/manual tracking still loads.
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle() as { data: OrderRow | null };

  const tokenValid = order ? isValidToken(order.id, order.email, token) : false;
  if (!order || !tokenValid) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <IconLock size={28} className="text-red-600" />
        </div>
        <h1 className="mb-2 text-xl font-bold text-gray-900">Lien de suivi invalide</h1>
        <p className="text-sm text-gray-500">Vérifiez le lien reçu avec votre commande ou ouvrez votre historique depuis votre compte.</p>
        <Link href="/orders" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">
          Mes commandes
        </Link>
      </div>
    );
  }

  const { data: rawItems } = await (supabase as unknown as {
    from(t: 'order_items'): {
      select(cols: string): {
        eq(col: string, val: string): {
          eq(col2: string, val2: string): Promise<{ data: OrderItem[] | null }>;
        };
      };
    };
  }).from('order_items').select('name, quantity, subtotal').eq('order_id', order.id).eq('tenant_id', tenant.id);

  const orderItems = rawItems ?? [];
  const view = buildOrderTrackingView(order, new Date());
  const currency = tenant.currency || 'EUR';
  const itemsTotal = orderItems.reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0);
  const shipping = order.fulfillment_type === 'delivery' ? Number(order.shipping_cost ?? 0) : 0;
  const total = Number(order.total ?? itemsTotal + shipping);
  const lines = [{ label: 'Articles', value: formatPrice(itemsTotal, currency) }];
  if (order.fulfillment_type === 'delivery') lines.push({ label: 'Livraison', value: shipping === 0 ? 'Offerte' : formatPrice(shipping, currency) });
  const reduction = Math.round((itemsTotal + shipping - total) * 100) / 100;
  if (reduction > 0) lines.push({ label: 'Réductions', value: `−${formatPrice(reduction, currency)}` });
  const summary: TrackingSummary = {
    items: orderItems.map((item) => ({ name: item.name, quantity: item.quantity, amount: formatPrice(Number(item.subtotal), currency) })),
    lines,
    total: formatPrice(total, currency),
  };

  // Full delivery address with the recipient's name, as on the previous version of this page.
  const address = order.shipping_address;
  const cityLine = [address?.postal_code, address?.city].filter(Boolean).join(' ').trim();
  const addressLines = [address?.full_name, address?.line1, address?.line2, cityLine, countryName(address?.country)]
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line));
  const trackingAddress: TrackingAddress | null = addressLines.length ? { lines: addressLines } : null;

  return (
    <OrderTrackingEssentiel
      view={view}
      summary={summary}
      address={trackingAddress}
      support={buildSupportChannels(tenant, view.ref, null)}
      tenantName={tenant.name}
    />
  );
}
