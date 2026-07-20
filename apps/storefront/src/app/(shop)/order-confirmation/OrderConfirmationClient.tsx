'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  IconClock,
  IconCircleCheck,
  IconBuildingStore,
  IconMapPin,
  IconCreditCard,
  IconPackage,
} from '@tabler/icons-react';
import { createClient } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/utils/format';

interface ShippingAddress {
  full_name?:   string;
  line1?:       string;
  city?:        string;
  postal_code?: string;
  country?:     string;
}

interface OrderItem {
  id:       string;
  name:     string;
  quantity: number;
  price:    number;
  subtotal: number;
}

interface Order {
  id:               string;
  email:            string;
  fulfillment_type: 'delivery' | 'pickup';
  payment_method:   string | null;
  payment_status:   string;
  shipping_address: ShippingAddress | null;
  shipping_cost:    number;
  subtotal:         number;
  total:            number;
  order_items:      OrderItem[];
}

interface TenantProps {
  id:                    string;
  currency:              string;
  click_collect_address: string | null;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 30000;

interface Props {
  tenant:          TenantProps;
  paymentIntentId?: string | null;
  preloadedOrder?: (Order & { order_items: OrderItem[] }) | null;
  isInStore?:      boolean;
}

export default function OrderConfirmationClient({
  tenant,
  paymentIntentId,
  preloadedOrder,
  isInStore,
}: Props) {
  const [order, setOrder]       = useState<Order | null>(preloadedOrder ?? null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    // No polling needed if order is already loaded (in_store flow)
    if (preloadedOrder || !paymentIntentId) return;

    const supabase = createClient();

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('orders')
        .select(
          'id, email, fulfillment_type, payment_method, payment_status, shipping_address, ' +
          'shipping_cost, subtotal, total, order_items(id, name, quantity, subtotal)',
        )
        .eq('stripe_payment_intent_id', paymentIntentId)
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      if (data) {
        setOrder(data as Order);
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setTimedOut(true);
    }, POLL_TIMEOUT_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [paymentIntentId, tenant.id, preloadedOrder]);

  // ── In-store: order not found (shouldn't happen, but handle gracefully) ──
  if (isInStore && !order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
          <IconClock size={28} className="text-yellow-700" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Commande en cours de création…</h1>
        <p className="text-gray-500 text-sm mb-6">
          Votre commande est en cours d&apos;enregistrement. Vérifiez votre email pour la confirmation.
        </p>
        <Link href="/products" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    );
  }

  // ── No payment_intent param ──────────────────────────────────────────────
  if (!paymentIntentId && !isInStore) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
          <IconClock size={28} className="text-yellow-700" />
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

  // ── Stripe: timeout before order appeared ────────────────────────────────
  if (timedOut && !order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <IconCircleCheck size={28} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Merci pour votre commande !</h1>
        <p className="text-gray-500 text-sm mb-2">
          Votre commande a bien été reçue. Vérifiez votre email pour la confirmation.
        </p>
        <Link href="/products" className="text-sm font-semibold mt-6 inline-block" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    );
  }

  // ── Stripe: polling in progress ──────────────────────────────────────────
  if (!order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <IconClock size={28} className="text-yellow-700" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Paiement reçu — commande en cours</h1>
        <p className="text-gray-500 text-sm">
          Votre paiement a bien été effectué. Votre commande est en cours de création…
        </p>
      </div>
    );
  }

  // ── Order found — full confirmation display ──────────────────────────────
  const isPickup   = order.fulfillment_type === 'pickup';
  const isInStorePayment = order.payment_method === 'in_store';
  const address    = order.shipping_address;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Status header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <IconCircleCheck size={28} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-bold mb-2">
          {isInStorePayment ? 'Commande enregistrée !' : 'Commande confirmée !'}
        </h1>
        <p className="text-gray-500 text-sm">
          {isInStorePayment
            ? 'Votre commande est prête à être retirée. Présentez-vous en boutique pour régler.'
            : 'Merci pour votre achat. Votre paiement a bien été reçu.'
          }
        </p>
        <p className="text-xs text-gray-400 mt-1 font-mono">
          N° {order.id.slice(0, 8).toUpperCase()}
        </p>
        {isInStorePayment && (
          <span
            className="text-xs font-semibold mt-2"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 20,
              background: '#FEF3C7', color: '#92400E', border: '0.5px solid #FDE68A',
            }}
          >
            <IconBuildingStore size={14} /> Paiement en boutique
          </span>
        )}
      </div>

      {/* Order lines */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Détail de la commande</p>
        {(order.order_items ?? []).map((item) => (
          <div
            key={item.id}
            className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0"
          >
            <span className="text-gray-600">{item.name} × {item.quantity}</span>
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

      {/* Click & Collect */}
      {isPickup && tenant.click_collect_address && (
        <div className="bg-blue-50 rounded-2xl p-4 mb-4">
          <p className="font-semibold text-sm text-blue-800 mb-2 flex items-center gap-1.5">
            <IconMapPin size={16} /> {isInStorePayment ? 'Retrait et paiement en boutique' : 'Instructions Click & Collect'}
          </p>
          <p className="text-sm text-blue-700">
            Venez récupérer votre commande à l&apos;adresse suivante :
          </p>
          <p className="text-sm font-semibold text-blue-900 mt-1">{tenant.click_collect_address}</p>
          {isInStorePayment && (
            <p className="text-xs text-amber-700 mt-2 font-medium flex items-center gap-1.5">
              <IconCreditCard size={14} /> Le paiement sera effectué lors du retrait en boutique.
            </p>
          )}
        </div>
      )}

      {/* Delivery address */}
      {!isPickup && address && (
        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-1.5">
            <IconPackage size={16} /> Adresse de livraison
          </p>
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
        <Link href="/products" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    </div>
  );
}
