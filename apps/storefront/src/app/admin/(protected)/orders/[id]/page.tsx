import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils/format';
import { formatDate } from '@/lib/utils/format';
import OrderDetail from '../../../orders/[id]/OrderDetail';
import PickingList from '../../../orders/[id]/PickingList';
import type { Order, OrderItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

// Matches ShippingDetails in OrderDetail.tsx — all fields optional here
// because we only cast from a jsonb column and can't guarantee presence
interface ShippingDetails {
  totalWeightG?:            number;
  numParcels?:              number;
  packlinkCost?:            number;
  serviceId?:               number;
  serviceName?:             string;
  carrierName?:             string;
  vatSource?:               'packlink' | 'db';
  vatRate?:                 number;
  vatAmount?:               number;
  surchargeMode?:           string;
  packagingSurchargeTotal?: number;
  boxDimensions?:           { length: number; width: number; height: number };
}

export default async function AdminOrderPage({ params }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const supabase   = createServiceClient();

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle() as { data: Order | null };

  if (!order) notFound();

  // Fetch all items for this order. We sort by warehouse_location in JS so
  // the query works even before migration 010 is applied in production.
  const { data: rawItems } = await (supabase as unknown as {
    from(t: 'order_items'): ReturnType<ReturnType<typeof createServiceClient>['from']>;
  }).from('order_items')
    .select('*')
    .eq('order_id', order.id) as { data: OrderItem[] | null };

  // Sort by warehouse_location (nulls last) — safe whether column exists or not.
  const items = (rawItems ?? []).sort((a, b) => {
    const la = a.warehouse_location ?? '';
    const lb = b.warehouse_location ?? '';
    if (!la && !lb) return 0;
    if (!la) return 1;
    if (!lb) return -1;
    return la.localeCompare(lb);
  });

  const { data: carriersRaw } = await supabase
    .from('carriers')
    .select('name')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('position', { ascending: true });

  const carriers        = (carriersRaw ?? []) as { name: string }[];
  const shippingDetails = (order.shipping_details ?? null) as ShippingDetails | null;
  const isPickup        = order.fulfillment_type === 'pickup';

  return (
    <>
    {/* no-print: hidden when @media print kicks in — only PickingList shows */}
    <div className="no-print min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Back */}
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
        >
          ← Retour aux commandes
        </Link>

        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h1 className="text-lg font-bold text-gray-900 font-mono">
                #{order.id.slice(0, 8).toUpperCase()}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">{formatDate(order.created_at, 'fr')}</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-gray-900">{formatPrice(order.total, tenant.currency)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {order.payment_method === 'in_store' ? '🏪 En boutique' : '💳 Stripe'}
              </p>
            </div>
          </div>

          {/* Customer */}
          <div className="border-t border-gray-100 pt-3 space-y-1">
            <p className="text-sm font-medium text-gray-800">{order.full_name ?? '—'}</p>
            <p className="text-xs text-gray-500">{order.email}</p>
            {order.shipping_address && !isPickup && (
              <div className="text-xs text-gray-500 mt-1">
                {(order.shipping_address as { line1?: string }).line1 && (
                  <p>{(order.shipping_address as { line1?: string }).line1}</p>
                )}
                <p>
                  {(order.shipping_address as { postal_code?: string }).postal_code}{' '}
                  {(order.shipping_address as { city?: string }).city}
                  {(order.shipping_address as { country?: string }).country
                    ? `, ${(order.shipping_address as { country?: string }).country}`
                    : ''}
                </p>
              </div>
            )}
            {isPickup && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold mt-1"
                style={{ background: '#EFF6FF', color: '#1E40AF', border: '0.5px solid #BFDBFE' }}
              >
                🏪 Click &amp; Collect
              </span>
            )}
          </div>
        </div>

        {/* Section 2 — Order items */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Produits commandés</h2>
          <div className="space-y-2">
            {(items ?? []).map((item) => (
              <div key={item.id} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-700">{item.name} × {item.quantity}</span>
                  {item.storage_type === 'frozen' && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: '#EFF6FF', color: '#1D4ED8', border: '0.5px solid #BFDBFE' }}
                    >
                      ❄ surgelé
                    </span>
                  )}
                  {item.storage_type === 'fresh' && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: '#F0FDF4', color: '#15803D', border: '0.5px solid #BBF7D0' }}
                    >
                      🌿 frais
                    </span>
                  )}
                </div>
                <span className="font-medium text-gray-900">
                  {formatPrice(item.subtotal, tenant.currency)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 mt-3 pt-3 space-y-1">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Sous-total</span>
              <span>{formatPrice(order.subtotal, tenant.currency)}</span>
            </div>
            {!isPickup && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>Livraison</span>
                <span>
                  {order.shipping_cost === 0
                    ? <span className="text-green-600">Gratuit</span>
                    : formatPrice(order.shipping_cost, tenant.currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-100 mt-1">
              <span>Total</span>
              <span>{formatPrice(order.total, tenant.currency)}</span>
            </div>
          </div>
        </section>

        {/* Sections 3-5 — interactive (shipping details + update form + print) */}
        <OrderDetail
          order={order}
          currency={tenant.currency}
          carriers={carriers}
          shippingDetails={shippingDetails}
          shippingProvider={tenant.shipping_provider ?? 'flat_rate'}
        />
      </div>
    </div>

    {/* Picking List — screen button visible, print content hidden until print */}
    <PickingList
      order={order}
      items={items ?? []}
      currency={tenant.currency}
    />
    </>
  );
}
