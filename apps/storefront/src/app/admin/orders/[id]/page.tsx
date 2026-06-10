import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { formatPrice, formatDate } from '@/lib/utils/format';
import OrderDetail from './OrderDetail';
import type { Order, OrderItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';

interface ShippingDetails {
  carrierName?:             string;
  serviceName?:             string;
  numParcels?:              number;
  totalWeightG?:            number;
  packlinkCost?:            number;
  vatAmount?:               number;
  vatSource?:               'packlink' | 'db';
  packagingSurchargeTotal?: number;
}

interface Props {
  params: { id: string };
}

export default async function AdminOrderPage({ params }: Props) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .single() as { data: Order | null };

  if (!order) notFound();

  const { data: items } = await (supabase as unknown as {
    from(t: 'order_items'): ReturnType<ReturnType<typeof createServiceClient>['from']>;
  }).from('order_items').select('*').eq('order_id', order.id) as { data: OrderItem[] | null };

  const details = order.shipping_details as ShippingDetails | null;
  const address = order.shipping_address;
  const isPickup = order.fulfillment_type === 'pickup';

  return (
    <div className="max-w-3xl">
      {/* Back */}
      <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1">
        ← Retour aux commandes
      </Link>

      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            Commande <span className="font-mono">{order.id.slice(0, 8).toUpperCase()}</span>
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{formatDate(order.created_at)}</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Section 1 — Informations */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Informations</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Client</dt>
              <dd className="font-medium text-gray-900">{order.full_name ?? '—'}</dd>
              <dd className="text-gray-500">{order.email}</dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Type</dt>
              <dd className="font-medium text-gray-900">
                {isPickup ? 'Click & Collect' : 'Livraison à domicile'}
              </dd>
            </div>
            {!isPickup && address && (
              <div className="col-span-2">
                <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Adresse de livraison</dt>
                <dd className="text-gray-700">
                  {address.line1}<br />
                  {address.postal_code} {address.city}
                  {address.country ? `, ${address.country}` : ''}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Section 2 — Produits */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Produits commandés</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="pb-2 text-left font-medium">Produit</th>
                <th className="pb-2 text-right font-medium">P.U.</th>
                <th className="pb-2 text-right font-medium">Qté</th>
                <th className="pb-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(items ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="py-2 text-gray-800">{item.name}</td>
                  <td className="py-2 text-right text-gray-500">{formatPrice(item.price, tenant.currency)}</td>
                  <td className="py-2 text-right text-gray-500">{item.quantity}</td>
                  <td className="py-2 text-right font-medium">{formatPrice(item.subtotal, tenant.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 mt-3 pt-3 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Sous-total produits</span>
              <span>{formatPrice(order.subtotal, tenant.currency)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Frais de livraison</span>
              <span>
                {order.shipping_cost === 0
                  ? <span className="text-green-600">Gratuit</span>
                  : formatPrice(order.shipping_cost, tenant.currency)
                }
              </span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-gray-100 pt-2">
              <span>Total</span>
              <span>{formatPrice(order.total, tenant.currency)}</span>
            </div>
          </div>
        </section>

        {/* Section 3 — Expédition */}
        {!isPickup && details && (
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Détails expédition</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {details.serviceName && (
                <div>
                  <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Service</dt>
                  <dd className="text-gray-800">{details.serviceName}</dd>
                </div>
              )}
              <div>
                <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Nb colis</dt>
                <dd className="text-gray-800">{details.numParcels ?? '—'}</dd>
              </div>
              {details.totalWeightG != null && (
                <div>
                  <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Poids total</dt>
                  <dd className="text-gray-800">{(details.totalWeightG / 1000).toFixed(2)} kg</dd>
                </div>
              )}
              {details.packlinkCost != null && (
                <div>
                  <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Coût transporteur</dt>
                  <dd className="text-gray-800">{formatPrice(details.packlinkCost, tenant.currency)}</dd>
                </div>
              )}
              {details.vatAmount != null && (
                <div>
                  <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">
                    TVA livraison {details.vatSource === 'packlink' ? '(Packlink)' : '(DB)'}
                  </dt>
                  <dd className="text-gray-800">{formatPrice(details.vatAmount, tenant.currency)}</dd>
                </div>
              )}
              {details.packagingSurchargeTotal != null && (
                <div>
                  <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Surplus emballage</dt>
                  <dd className="text-gray-800">{formatPrice(details.packagingSurchargeTotal, tenant.currency)}</dd>
                </div>
              )}
              <div className="col-span-2 border-t border-gray-100 pt-3">
                <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Total livraison facturé</dt>
                <dd className="font-semibold text-gray-900">{formatPrice(order.shipping_cost, tenant.currency)}</dd>
              </div>
            </dl>
          </section>
        )}

        {/* Section 4+5 — Update form + Print (client component) */}
        <OrderDetail order={order} currency={tenant.currency} />
      </div>
    </div>
  );
}
