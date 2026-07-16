import { createServiceClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/utils/format';
import crypto from 'crypto';
import CopyButton from './CopyButton';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

type TrackingStatus = 'confirmed' | 'preparing' | 'shipped' | 'delivered';

interface ShippingAddress {
  full_name?:   string;
  line1?:       string;
  city?:        string;
  postal_code?: string;
  country?:     string;
}

interface ShippingDetails {
  trackingCode?:    string;
  trackingCarrier?: string;
  carrierName?:     string;
}

interface OrderItem {
  name:     string;
  quantity: number;
  subtotal: number;
}

interface OrderRow {
  id:               string;
  status:           string;
  created_at:       string;
  email:            string;
  full_name:        string | null;
  total:            number;
  shipping_cost:    number;
  tracking_code:    string | null;
  tracking_carrier: string | null;
  shipping_address: ShippingAddress | null;
  shipping_details: ShippingDetails | null;
}

// ─── Carrier tracking URLs ────────────────────────────────────────────────────

const CARRIER_URLS: Record<string, string> = {
  'Poste Italiane': 'https://www.poste.it/cerca/index.html#/risultati-ricerca-spedizioni/',
  'BRT':            'https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numsped_par.hsm&Nspediz=',
  'FedEx':          'https://www.fedex.com/fedextrack/?trknbr=',
  'TNT':            'https://www.tnt.com/express/it_it/site/tracking.html?searchType=CON&cons=',
  'DHL':            'https://www.dhl.com/it-it/home/tracking.html?tracking-id=',
  'SDA':            'https://www.sda.it/wps/portal/Servizi-online/cerca-spedizione?barcode=',
  'UPS':            'https://www.ups.com/track?tracknum=',
};

// ─── Token validation ─────────────────────────────────────────────────────────

function isValidToken(orderId: string, email: string, token: string): boolean {
  if (!process.env.TRACKING_SECRET || !token) return false;
  const expected = crypto
    .createHmac('sha256', process.env.TRACKING_SECRET)
    .update(orderId + email)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token,    'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

// ─── Timeline ────────────────────────────────────────────────────────────────

const STEPS: { key: TrackingStatus; icon: string; label: string }[] = [
  { key: 'confirmed',  icon: '✅', label: 'Confirmé'       },
  { key: 'preparing',  icon: '📦', label: 'En préparation' },
  { key: 'shipped',    icon: '🚚', label: 'Expédié'        },
  { key: 'delivered',  icon: '🏠', label: 'Livré'          },
];

function toTimelineStatus(dbStatus: string): TrackingStatus {
  const map: Record<string, TrackingStatus> = {
    new:              'confirmed',
    confirmed:        'confirmed',
    preparing:        'preparing',
    ready_for_pickup: 'preparing',
    shipped:          'shipped',
    delivered:        'delivered',
  };
  return map[dbStatus] ?? 'confirmed';
}

function stepIndex(status: TrackingStatus): number {
  return STEPS.findIndex((s) => s.key === status);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params:       { id: string };
  searchParams: { token?: string };
}

export default async function OrderTrackingPage({ params, searchParams }: PageProps) {
  const { id } = params;
  const token  = searchParams.token ?? '';

  // ── 1. Fetch order (service role — public page, auth via HMAC token) ──────
  const supabase = createServiceClient();

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, status, created_at, email, full_name, total, shipping_cost, ' +
      'tracking_code, tracking_carrier, shipping_address, shipping_details',
    )
    .eq('id', id)
    .maybeSingle() as { data: OrderRow | null };

  // ── 2. Validate HMAC token ───────────────────────────────────────────────
  const tokenValid = order ? isValidToken(id, order.email, token) : false;

  if (!order || !tokenValid) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4 text-2xl">
          🔒
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Lien invalide ou expiré</h1>
        <p className="text-sm text-gray-500">
          Ce lien de suivi n&apos;est pas valide. Vérifiez l&apos;email de confirmation ou contactez-nous.
        </p>
      </div>
    );
  }

  // ── 3. Fetch order items ─────────────────────────────────────────────────
  const { data: rawItems } = await (supabase as unknown as {
    from(t: 'order_items'): {
      select(cols: string): {
        eq(col: string, val: string): Promise<{ data: OrderItem[] | null }>;
      };
    };
  }).from('order_items').select('name, quantity, subtotal').eq('order_id', order.id);

  const orderItems: OrderItem[] = rawItems ?? [];

  // ── 4. Derive display data ───────────────────────────────────────────────
  const timelineStatus  = toTimelineStatus(order.status);
  const activeIdx       = stepIndex(timelineStatus);
  const isShipped       = activeIdx >= stepIndex('shipped');

  const sd              = (order.shipping_details ?? {}) as ShippingDetails;
  const trackingCode    = order.tracking_code    ?? sd.trackingCode    ?? null;
  const trackingCarrier = order.tracking_carrier ?? sd.trackingCarrier ?? sd.carrierName ?? null;
  const carrierUrl      = trackingCarrier ? (CARRIER_URLS[trackingCarrier] ?? null) : null;
  const addr            = order.shipping_address;
  const currency        = process.env.NEXT_PUBLIC_CURRENCY ?? 'eur';

  // Timeline progress bar width (desktop)
  const progressPct = STEPS.length > 1
    ? Math.round((activeIdx / (STEPS.length - 1)) * 100)
    : 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="text-center mb-8">
        <p className="text-xs text-gray-400 font-mono mb-1">
          Commande #{order.id.slice(0, 8).toUpperCase()}
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Suivi de votre commande</h1>
        {order.full_name && (
          <p className="text-sm text-gray-500">
            Bonjour {order.full_name.split(' ')[0]}&nbsp;👋
          </p>
        )}
      </div>

      {/* ── Timeline ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">

        {/* Desktop: horizontal */}
        <div className="hidden sm:flex items-start justify-between relative">
          {/* background track */}
          <div className="absolute top-[18px] left-8 right-8 h-0.5 bg-gray-200" />
          {/* filled progress */}
          <div
            className="absolute top-[18px] left-8 h-0.5 transition-all"
            style={{
              width:      `calc(${progressPct}% * (100% - 64px) / 100)`,
              background: 'var(--color-primary)',
            }}
          />
          {STEPS.map((step, i) => {
            const done    = i <= activeIdx;
            const current = i === activeIdx;
            return (
              <div key={step.key} className="flex flex-col items-center gap-2 z-10 flex-1">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-base border-2 transition-all"
                  style={{
                    background:  done ? (current ? 'var(--color-primary)' : 'var(--color-primary-light)') : '#F9FAFB',
                    borderColor: done ? 'var(--color-primary)' : '#E5E7EB',
                  }}
                >
                  {step.icon}
                </div>
                <span
                  className="text-xs font-medium text-center leading-tight"
                  style={{ color: done ? 'var(--color-primary-dark)' : '#9CA3AF' }}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Mobile: vertical */}
        <div className="flex flex-col sm:hidden">
          {STEPS.map((step, i) => {
            const done    = i <= activeIdx;
            const current = i === activeIdx;
            const last    = i === STEPS.length - 1;
            return (
              <div key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-base border-2 flex-shrink-0"
                    style={{
                      background:  done ? (current ? 'var(--color-primary)' : 'var(--color-primary-light)') : '#F9FAFB',
                      borderColor: done ? 'var(--color-primary)' : '#E5E7EB',
                    }}
                  >
                    {step.icon}
                  </div>
                  {!last && (
                    <div
                      className="w-0.5 my-1"
                      style={{
                        height:     24,
                        background: done && i < activeIdx ? 'var(--color-primary)' : '#E5E7EB',
                      }}
                    />
                  )}
                </div>
                <div className={`pt-1.5 ${last ? '' : 'pb-4'}`}>
                  <span
                    className="text-sm font-medium"
                    style={{ color: done ? 'var(--color-primary-dark)' : '#9CA3AF' }}
                  >
                    {step.label}
                  </span>
                  {current && (
                    <span
                      className="ml-2 text-xs px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}
                    >
                      En cours
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Tracking code (shipped / delivered only) ───────────────────── */}
      {isShipped && trackingCode && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">🚚 Informations de suivi</p>

          <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3 mb-3">
            <div className="min-w-0">
              {trackingCarrier && (
                <p className="text-xs text-gray-400 mb-0.5">{trackingCarrier}</p>
              )}
              <p className="font-mono text-sm font-semibold text-gray-900 break-all">
                {trackingCode}
              </p>
            </div>
            <CopyButton text={trackingCode} />
          </div>

          {carrierUrl && (
            <a
              href={`${carrierUrl}${encodeURIComponent(trackingCode)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Suivre sur le site {trackingCarrier}&nbsp;→
            </a>
          )}
        </div>
      )}

      {/* ── Order summary ──────────────────────────────────────────────── */}
      {orderItems.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">📋 Récapitulatif</p>
          <div className="space-y-1.5">
            {orderItems.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-600">{item.name} × {item.quantity}</span>
                <span className="font-medium">{formatPrice(item.subtotal, currency)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 mt-3 pt-3 space-y-1">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Livraison</span>
              <span>
                {order.shipping_cost === 0
                  ? <span className="text-green-600 font-medium">Gratuit</span>
                  : formatPrice(order.shipping_cost, currency)}
              </span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-gray-100 pt-2 mt-1">
              <span>Total</span>
              <span>{formatPrice(order.total, currency)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Delivery address ───────────────────────────────────────────── */}
      {addr && (
        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">📦 Adresse de livraison</p>
          {addr.full_name   && <p className="text-sm text-gray-700">{addr.full_name}</p>}
          {addr.line1       && <p className="text-sm text-gray-700">{addr.line1}</p>}
          {(addr.postal_code || addr.city) && (
            <p className="text-sm text-gray-700">
              {addr.postal_code} {addr.city}
              {addr.country ? `, ${addr.country}` : ''}
            </p>
          )}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <p className="text-xs text-gray-400 text-center mt-2">
        Des questions ? Répondez à l&apos;email de confirmation ou contactez-nous.
      </p>

    </div>
  );
}
