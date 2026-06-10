import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

interface ShippingAddress {
  full_name?:  string;
  line1?:      string;
  city?:       string;
  postal_code?: string;
  country?:    string;
}

interface OrderItemRow {
  id:       string;
  name:     string;
  quantity: number;
  price:    number;
  subtotal: number;
}

interface PageProps {
  searchParams: { payment_intent?: string };
}

export default async function OrderConfirmationPage({ searchParams }: PageProps) {
  const paymentIntentId = searchParams.payment_intent;
  const tenantSlug      = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant          = await getTenant(tenantSlug);
  const supabase        = createServiceClient();

  // No payment_intent param — user landed here directly
  if (!paymentIntentId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4 text-2xl">
          ⏳
        </div>
        <h1 className="text-2xl font-bold mb-2">Commande en cours de traitement</h1>
        <p className="text-gray-500 text-sm mb-6">
          Votre paiement est en cours de confirmation. Vous recevrez un email dès que votre commande sera validée.
        </p>
        <Link href="/products" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    );
  }

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  // Race condition: webhook may not have created the order yet
  if (!order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4 text-2xl">
          ⏳
        </div>
        <h1 className="text-2xl font-bold mb-2">Paiement reçu — commande en cours</h1>
        <p className="text-gray-500 text-sm mb-4">
          Votre paiement a bien été effectué. Votre commande est en cours de création, cela prend quelques instants.
        </p>
        <p className="text-gray-400 text-xs mb-6">
          Si cette page ne se met pas à jour, rafraîchissez dans quelques secondes ou attendez votre email de confirmation.
        </p>
        <Link href="/products" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    );
  }

  const { data: orderItems } = await (supabase as unknown as {
    from(table: 'order_items'): ReturnType<ReturnType<typeof createServiceClient>['from']>;
  }).from('order_items').select('*').eq('order_id', order.id) as { data: OrderItemRow[] | null };

  const isPickup = order.fulfillment_type === 'pickup';
  const address  = order.shipping_address as ShippingAddress | null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Status header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4 text-2xl">
          ✅
        </div>
        <h1 className="text-2xl font-bold mb-2">Commande confirmée !</h1>
        <p className="text-gray-500 text-sm">
          Merci pour votre achat. Votre paiement a bien été reçu.
        </p>
        <p className="text-xs text-gray-400 mt-1 font-mono">
          N° {order.id.slice(0, 8).toUpperCase()}
        </p>
      </div>

      {/* Order lines */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Détail de la commande</p>
        {(orderItems ?? []).map((item) => (
          <div key={item.id} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-gray-600">
              {item.name} × {item.quantity}
            </span>
            <span className="font-medium">{formatPrice(item.subtotal, tenant.currency)}</span>
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
          <p className="text-sm font-semibold text-blue-900 mt-1">{tenant.click_collect_address}</p>
          <p className="text-xs text-blue-600 mt-2">
            Nous vous contacterons par email pour confirmer les horaires de retrait.
          </p>
        </div>
      )}

      {/* Delivery address */}
      {!isPickup && address && (
        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="font-semibold text-sm text-gray-700 mb-2">📦 Adresse de livraison</p>
          {address.full_name   && <p className="text-sm text-gray-700">{address.full_name}</p>}
          {address.line1       && <p className="text-sm text-gray-700">{address.line1}</p>}
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
