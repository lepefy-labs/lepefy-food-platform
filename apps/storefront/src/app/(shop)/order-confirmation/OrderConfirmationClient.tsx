'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  IconClock,
  IconCircleCheck,
  IconBuildingStore,
  IconMapPin,
  IconCreditCard,
  IconPackage,
  IconRefresh,
  IconTruckDelivery,
} from '@tabler/icons-react';
import { createClient } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/utils/format';
import { readConfirmationAccess, type ConfirmationAccess } from '@/lib/checkout/confirmationAccess';
import { orderReference, type ConfirmationOrderView, type ConfirmationResponse } from '@/lib/orders/confirmationView';

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
  email:            string | null;
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

/** Ce que la page affiche, quelle que soit la source (vue serveur ou lecture connectée). */
interface DisplayOrder {
  reference:        string;
  email:            string | null;
  isPickup:         boolean;
  isInStorePayment: boolean;
  items:            Array<{ id: string; name: string; quantity: number; subtotal: number }>;
  subtotal:         number;
  shippingCost:     number;
  total:            number;
  addressLines:     string[];
  trackingUrl:      string | null;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 30000;

interface Props {
  tenant:          TenantProps;
  paymentIntentId?: string | null;
  preloadedOrder?: (Order & { order_items: OrderItem[] }) | null;
  isInStore?:      boolean;
}

function fromLegacyOrder(order: Order): DisplayOrder {
  const address = order.shipping_address;
  const addressLines = address ? [
    address.full_name ?? '',
    address.line1 ?? '',
    [[address.postal_code, address.city].filter(Boolean).join(' '), address.country].filter(Boolean).join(', '),
  ].filter(Boolean) : [];
  return {
    reference:        orderReference(order.id),
    email:            order.email,
    isPickup:         order.fulfillment_type === 'pickup',
    isInStorePayment: order.payment_method === 'in_store',
    items:            (order.order_items ?? []).map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, subtotal: Number(item.subtotal) })),
    subtotal:         Number(order.subtotal),
    shippingCost:     Number(order.shipping_cost),
    total:            Number(order.total),
    addressLines,
    trackingUrl:      null,
  };
}

function fromConfirmationView(order: ConfirmationOrderView): DisplayOrder {
  return {
    reference:        order.reference,
    email:            order.email,
    isPickup:         order.fulfillmentType === 'pickup',
    isInStorePayment: false,
    items:            order.items,
    subtotal:         order.subtotal,
    shippingCost:     order.shippingCost,
    total:            order.total,
    addressLines:     order.deliveryPlace ? [order.deliveryPlace] : [],
    trackingUrl:      order.trackingUrl,
  };
}

type Mode = 'checking' | 'session' | 'legacy';

export default function OrderConfirmationClient({
  tenant,
  paymentIntentId,
  preloadedOrder,
  isInStore,
}: Props) {
  const [order, setOrder]         = useState<DisplayOrder | null>(preloadedOrder ? fromLegacyOrder(preloadedOrder) : null);
  const [timedOut, setTimedOut]   = useState(false);
  const [mode, setMode]           = useState<Mode>('checking');
  const [access, setAccess]       = useState<ConfirmationAccess | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pollRound, setPollRound] = useState(0);

  // Accès gardé par le checkout dans cet onglet (lu après le montage : sessionStorage).
  useEffect(() => {
    if (preloadedOrder || !paymentIntentId) return;
    const stored = readConfirmationAccess(paymentIntentId);
    setAccess(stored);
    setMode(stored ? 'session' : 'legacy');
  }, [paymentIntentId, preloadedOrder]);

  const fetchFromSession = useCallback(async (current: ConfirmationAccess): Promise<'ready' | 'pending' | 'denied'> => {
    try {
      const response = await fetch(`/api/checkout-sessions/${current.sessionId}/order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ accessToken: current.accessToken }),
      });
      if (response.status === 404) return 'denied';
      if (!response.ok) return 'pending';
      const result = await response.json() as ConfirmationResponse;
      if (result.status === 'ready') {
        setOrder(fromConfirmationView(result.order));
        return 'ready';
      }
      setPendingEmail(result.email ?? null);
      return 'pending';
    } catch {
      return 'pending';
    }
  }, []);

  // Client avec accès de session : lecture immédiate, puis toutes les 2 s pendant 30 s.
  useEffect(() => {
    if (mode !== 'session' || !access || order) return;
    let stopped = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      const outcome = await fetchFromSession(access);
      if (stopped) return;
      if (outcome === 'ready') stop();
      if (outcome === 'denied') { stop(); setMode('legacy'); }
    };
    const stop = () => {
      stopped = true;
      if (interval) clearInterval(interval);
    };
    void tick();
    interval = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    const timeout = setTimeout(() => { stop(); setTimedOut(true); }, POLL_TIMEOUT_MS);
    return () => { stop(); clearTimeout(timeout); };
  }, [mode, access, order, pollRound, fetchFromSession]);

  // Sans accès de session (autre onglet, stockage indisponible) : lecture du client connecté.
  useEffect(() => {
    if (mode !== 'legacy' || order || !paymentIntentId) return;

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
        setOrder(fromLegacyOrder(data as Order));
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
  }, [mode, order, paymentIntentId, tenant.id]);

  function refresh() {
    setTimedOut(false);
    setPollRound((round) => round + 1);
  }

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
        <Link href="/" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
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
        <Link href="/" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    );
  }

  // ── Stripe, accès de session : paiement sûr, commande pas encore lisible ──
  if (timedOut && !order && mode === 'session') {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <IconCircleCheck size={28} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Paiement reçu</h1>
        <p className="text-gray-600 text-sm">
          Votre commande est en cours d&apos;enregistrement.
          {pendingEmail
            ? <> Vous recevrez la confirmation à <strong className="text-gray-900 break-all">{pendingEmail}</strong>.</>
            : ' Vous recevrez la confirmation par email.'}
        </p>
        <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
          Ne payez pas une seconde fois. Si rien n&apos;arrive d&apos;ici quelques minutes, contactez la boutique.
        </p>
        <button
          type="button"
          onClick={refresh}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white px-5 text-sm font-bold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
        >
          <IconRefresh size={18} aria-hidden="true" /> Actualiser
        </button>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    );
  }

  // ── Stripe, sans accès de session : timeout before order appeared ────────
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
        <Link href="/" className="text-sm font-semibold mt-6 inline-block" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    );
  }

  // ── Stripe: en attente du webhook ────────────────────────────────────────
  if (!order) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center" role="status" aria-live="polite">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--color-primary-light, #E3EFFB)' }}>
          <span
            className="h-7 w-7 rounded-full border-[3px] border-white/70 motion-safe:animate-spin"
            style={{ borderTopColor: 'var(--color-primary)' }}
            aria-hidden="true"
          />
        </div>
        <h1 className="text-2xl font-bold mb-2">Paiement reçu</h1>
        <p className="text-gray-600 text-sm">
          Nous enregistrons votre commande. Cela prend quelques secondes, restez sur cette page.
        </p>
        <div className="mt-6 grid gap-2 rounded-2xl border border-gray-100 p-4" aria-hidden="true">
          <span className="h-2.5 w-3/5 rounded bg-gray-100" />
          <span className="h-2.5 w-4/5 rounded bg-gray-100" />
          <span className="h-2.5 w-2/5 rounded bg-gray-100" />
        </div>
        <p className="mt-4 text-sm text-gray-600">Aucun montant ne sera débité une seconde fois.</p>
      </div>
    );
  }

  // ── Order found — full confirmation display ──────────────────────────────
  const { isPickup, isInStorePayment } = order;

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
        <p className="text-gray-600 text-sm">
          {isInStorePayment
            ? 'Nous préparons votre commande. Vous paierez en boutique au moment du retrait. Nous vous prévenons quand elle est prête.'
            : 'Merci pour votre achat. Votre paiement a bien été reçu.'
          }
        </p>
        <p className="text-xs text-gray-400 mt-1 font-mono">
          N° {order.reference}
        </p>
        {order.email && (
          <p className="text-sm text-gray-600 mt-2">
            Confirmation envoyée à <strong className="text-gray-900 break-all">{order.email}</strong>
          </p>
        )}
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
        {order.items.map((item) => (
          <div
            key={item.id}
            className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0"
          >
            <span className="text-gray-600">{item.name} × {item.quantity}</span>
            <span className="font-medium">{formatPrice(item.subtotal, tenant.currency)}</span>
          </div>
        ))}
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Prix des produits</span>
            <span>{formatPrice(order.subtotal, tenant.currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>{isPickup ? 'Retrait en boutique' : 'Prix de livraison'}</span>
            <span>
              {order.shippingCost === 0 ? (
                <span className="text-green-700 font-medium">{isPickup ? 'Gratuit' : 'Gratuite'}</span>
              ) : (
                formatPrice(order.shippingCost, tenant.currency)
              )}
            </span>
          </div>
          <div className="flex justify-between font-bold text-base border-t border-gray-100 pt-2">
            <span>{isInStorePayment ? 'Total à payer au retrait' : 'Total payé'} <span className="block text-xs font-normal text-gray-600">TVA incluse</span></span>
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
      {!isPickup && order.addressLines.length > 0 && (
        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-1.5">
            <IconPackage size={16} /> {order.addressLines.length === 1 ? 'Livraison à' : 'Adresse de livraison'}
          </p>
          {order.addressLines.map((line) => <p key={line} className="text-sm text-gray-700">{line}</p>)}
        </div>
      )}

      {order.trackingUrl && (
        <a
          href={order.trackingUrl}
          className="mb-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <IconTruckDelivery size={18} aria-hidden="true" /> Suivre ma commande
        </a>
      )}

      <div className="text-center">
        <Link href="/" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Continuer mes achats
        </Link>
      </div>
    </div>
  );
}
