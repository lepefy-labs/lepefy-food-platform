import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

interface Props {
  params: { id: string };
}

interface ShippingAddress {
  full_name?: string;
  line1?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

interface OrderItemRow {
  id: string;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export default async function OrderConfirmationPage({ params }: Props) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (!order) notFound();

  const { data: orderItems } = await (supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => Promise<{ data: OrderItemRow[] | null }>;
      };
    };
  })
    .from('order_items')
    .select('*')
    .eq('order_id', order.id) as { data: OrderItemRow[] | null };

  const isPaid = order.payment_status === 'paid';
  const isPickup = order.fulfillment_type === 'pickup';
  const address = order.shipping_address as ShippingAddress | null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Status header */}
      <div className="text-center mb-8">
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl ${
            isPaid ? 'bg-green-100' : 'bg-yellow-100'
          }`}
        >
          {isPaid ? '✅' : '⏳'}
        </div>
        <h1 className="text-2xl font-bold mb-2">
          {isPaid ? 'Commande confirmée !' : 'Commande reçue'}
        </h1>
        <p className="text-gray-500 text-sm">
          {isPaid
            ? 'Merci pour votre achat. Votre paiement a bien été reçu.'
            : 'Votre commande est en attente de confirmation.'}
        </p>
        <p className="text-xs text-gray-400 mt-1 font-mono">
          N° {order.id.slice(0, 8).toUpperCase()}
        </p>
      </div>

      {/* Order lines */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Détail de la commande</p>
        {(orderItems ?? []).map((item) => (
          <div
            key={item.id}
            className="flex justify-between text-sm py-2 border-b border-gray-50 last:border-0"
          >
            <span className="text-gray-700 line-clamp-1 mr-2">
              {item.name} × {item.quantity}
            </span>
            <span className="font-medium flex-shrink-0">
              {formatPrice(item.subtotal, tenant.currency)}
            </span>
          </div>
        ))}
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
          <div className="flex justify-between text-sm text-gray-500">
            <span>Sous-total</span>
            <span>{formatPrice(order.subtotal, tenant.currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>Livraison</span>
            <span>
              {order.shipping_cost === 0 ? (
                <span className="text-green-600 font-medium">Gratuit</span>
              ) : (
                formatPrice(order.shipping_cost, tenant.currency)
              )}
            </span>
          </div>
          <div className="flex justify-between font-bold text-base border-t border-gray-100 pt-2">
            <span>Total</span>
            <span>{formatPrice(order.total, tenant.currency)}</span>
          </div>
        </div>
      </div>

      {/* Click & Collect instructions */}
      {isPickup && tenant.click_collect_address && (
        <div className="bg-blue-50 rounded-2xl p-4 mb-4">
          <p className="font-semibold text-sm text-blue-800 mb-2">
            📍 Instructions Click &amp; Collect
          </p>
          <p className="text-sm text-blue-700">
            Venez récupérer votre commande à l&apos;adresse suivante :
          </p>
          <p className="text-sm font-semibold text-blue-900 mt-1">
            {tenant.click_collect_address}
          </p>
          <p className="text-xs text-blue-600 mt-2">
            Nous vous contacterons par email pour confirmer les horaires de retrait.
          </p>
        </div>
      )}

      {/* Delivery address */}
      {!isPickup && address && (
        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="font-semibold text-sm text-gray-700 mb-2">📦 Adresse de livraison</p>
          {address.full_name && <p className="text-sm text-gray-700">{address.full_name}</p>}
          {address.line1 && <p className="text-sm text-gray-700">{address.line1}</p>}
          {(address.postal_code || address.city) && (
            <p className="text-sm text-gray-700">
              {address.postal_code} {address.city}
              {address.country ? `, ${address.country}` : ''}
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center mb-6">
        Un email de confirmation a été envoyé à {order.email}.
      </p>

      <div className="text-center">
        <Link
          href="/products"
          className="text-sm font-semibold"
          style={{ color: 'var(--color-primary)' }}
        >
          ← Continuer mes achats
        </Link>
      </div>
    </div>
  );
}
