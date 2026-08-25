import Link from 'next/link';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatDate, formatPrice } from '@/lib/utils/format';
import {
  IconArrowLeft,
  IconBuildingStore,
  IconCheck,
  IconCircleCheck,
  IconClipboardList,
  IconHome,
  IconLock,
  IconMapPin,
  IconPackage,
  IconTruck,
} from '@tabler/icons-react';
import {
  customerOrderStepIndex,
  customerOrderSteps,
  getCustomerOrderPresentation,
  type CustomerOrderStage,
  type FulfillmentKind,
} from '@/lib/orders/orderStatus';
import CopyButton from './CopyButton';

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
  email: string;
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
}

const CARRIER_URLS: Record<string, string> = {
  'poste italiane': 'https://www.poste.it/cerca/index.html#/risultati-ricerca-spedizioni/',
  poste: 'https://www.poste.it/cerca/index.html#/risultati-ricerca-spedizioni/',
  brt: 'https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numsped_par.hsm&Nspediz=',
  bartolini: 'https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numsped_par.hsm&Nspediz=',
  fedex: 'https://www.fedex.com/fedextrack/?trknbr=',
  tnt: 'https://www.tnt.com/express/it_it/site/tracking.html?searchType=CON&cons=',
  dhl: 'https://www.dhl.com/it-it/home/tracking.html?tracking-id=',
  sda: 'https://www.sda.it/wps/portal/Servizi-online/cerca-spedizione?barcode=',
  ups: 'https://www.ups.com/track?tracknum=',
};

function trackingBaseUrl(carrier: string | null) {
  if (!carrier) return null;
  return CARRIER_URLS[carrier.toLowerCase().trim()] ?? null;
}

function isValidToken(orderId: string, email: string, token: string): boolean {
  if (!process.env.TRACKING_SECRET || !token) return false;
  const expected = crypto
    .createHmac('sha256', process.env.TRACKING_SECRET)
    .update(orderId + email)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

type StepIcon = typeof IconCircleCheck;

function stepMeta(stage: CustomerOrderStage, fulfillmentType: FulfillmentKind): { label: string; icon: StepIcon } {
  if (stage === 'confirmed') return { label: 'Confirmée', icon: IconCircleCheck };
  if (stage === 'preparing') return { label: 'En préparation', icon: IconPackage };
  if (stage === 'ready_for_pickup') return { label: 'Prête au retrait', icon: IconBuildingStore };
  if (stage === 'shipped') return { label: 'Expédiée', icon: IconTruck };
  return { label: fulfillmentType === 'pickup' ? 'Retirée' : 'Livrée', icon: IconHome };
}

function stepTimestamp(stage: CustomerOrderStage, order: OrderRow) {
  if (stage === 'confirmed') return order.created_at;
  if (stage === 'preparing') return order.picking_started_at;
  if (stage === 'shipped') return order.shipped_at;
  if (stage === 'delivered' && order.status === 'delivered') return order.updated_at;
  if (stage === 'ready_for_pickup' && order.status === 'ready_for_pickup') return order.updated_at;
  return null;
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
    .select(
      'id, tenant_id, status, created_at, updated_at, email, full_name, total, shipping_cost, fulfillment_type, ' +
      'tracking_code, tracking_carrier, shipped_at, picking_started_at, shipping_address, shipping_details',
    )
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
  const presentation = getCustomerOrderPresentation(order.status, order.fulfillment_type);
  const steps = customerOrderSteps(order.fulfillment_type);
  const activeIdx = customerOrderStepIndex(presentation.stage, order.fulfillment_type);
  const isCancelled = presentation.stage === 'cancelled';
  const isPickup = order.fulfillment_type === 'pickup';
  const sd = (order.shipping_details ?? {}) as ShippingDetails;
  const trackingCode = order.tracking_code ?? sd.trackingCode ?? null;
  const trackingCarrier = order.tracking_carrier ?? sd.trackingCarrier ?? sd.carrierName ?? null;
  const carrierUrl = trackingBaseUrl(trackingCarrier);
  const showTracking = !isPickup && (presentation.stage === 'shipped' || presentation.stage === 'delivered') && Boolean(trackingCode);
  const address = order.shipping_address;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-10 pt-5 sm:px-6 sm:pt-8">
      <Link href="/orders" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900">
        <IconArrowLeft size={17} /> Mes commandes
      </Link>

      <header className="mb-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-gray-400">Commande #{order.id.slice(0, 8).toUpperCase()}</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">{presentation.title}</h1>
            <p className="mt-2 max-w-lg text-sm leading-6 text-gray-500">{presentation.description}</p>
          </div>
          <span
            className={`inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${isCancelled ? 'bg-red-50 text-red-700' : ''}`}
            style={isCancelled ? undefined : { background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}
          >
            {presentation.label}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-gray-100 pt-4 text-xs text-gray-500 sm:text-sm">
          <span>{formatDate(order.created_at)}</span>
          <span className="inline-flex items-center gap-1.5">
            {isPickup ? <IconBuildingStore size={15} /> : <IconTruck size={15} />}
            {isPickup ? 'Retrait en boutique' : 'Livraison'}
          </span>
          <span className="font-semibold text-gray-900">{formatPrice(order.total, tenant.currency)}</span>
        </div>
      </header>

      {!isCancelled && (
        <section className="mb-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Avancement</p>
            <h2 className="mt-1 text-base font-semibold text-gray-900">Où en est ma commande ?</h2>
          </div>

          <div className="space-y-0">
            {steps.map((stage, index) => {
              const meta = stepMeta(stage, order.fulfillment_type);
              const done = activeIdx >= index;
              const current = activeIdx === index;
              const timestamp = stepTimestamp(stage, order);
              const Icon = meta.icon;
              return (
                <div key={stage} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2"
                      style={{
                        borderColor: done ? 'var(--color-primary)' : '#E5E7EB',
                        background: current ? 'var(--color-primary)' : done ? 'var(--color-primary-light)' : '#F9FAFB',
                        color: current ? 'white' : done ? 'var(--color-primary-dark)' : '#9CA3AF',
                      }}
                    >
                      {done && !current ? <IconCheck size={18} /> : <Icon size={18} />}
                    </span>
                    {index < steps.length - 1 && <span className={`h-10 w-0.5 ${activeIdx > index ? 'bg-[var(--color-primary)]' : 'bg-gray-200'}`} />}
                  </div>
                  <div className="min-w-0 flex-1 pb-5 pt-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={`text-sm font-semibold ${done ? 'text-gray-900' : 'text-gray-400'}`}>{meta.label}</p>
                      {timestamp && <span className="text-xs text-gray-400">{formatDate(timestamp)}</span>}
                    </div>
                    {current && <p className="mt-1 text-xs leading-5 text-gray-500">{presentation.description}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {showTracking && trackingCode && (
        <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-emerald-700"><IconTruck size={18} /></span>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Suivre mon colis</h2>
              <p className="text-xs text-gray-500">{trackingCarrier ?? 'Transporteur'}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3">
            <p className="min-w-0 break-all font-mono text-sm font-semibold text-gray-900">{trackingCode}</p>
            <CopyButton text={trackingCode} />
          </div>
          {carrierUrl && (
            <a
              href={`${carrierUrl}${encodeURIComponent(trackingCode)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Ouvrir le suivi {trackingCarrier ? `· ${trackingCarrier}` : ''}
            </a>
          )}
          {!carrierUrl && <p className="mt-3 text-xs text-gray-500">Copiez le numéro ci-dessus pour le consulter sur le site du transporteur.</p>}
        </section>
      )}

      {isPickup && presentation.stage === 'ready_for_pickup' && (
        <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700"><IconBuildingStore size={19} /></span>
            <div>
              <h2 className="text-sm font-bold text-emerald-900">Votre commande vous attend</h2>
              <p className="mt-1 text-sm leading-6 text-emerald-800">Elle est prête à être retirée en boutique. Présentez simplement votre numéro de commande.</p>
            </div>
          </div>
        </section>
      )}

      {orderItems.length > 0 && (
        <section className="mb-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900"><IconClipboardList size={17} /> Récapitulatif</h2>
          <div className="space-y-3">
            {orderItems.map((item, index) => (
              <div key={`${item.name}-${index}`} className="flex items-start justify-between gap-4 text-sm">
                <span className="min-w-0 text-gray-600"><span className="font-semibold text-gray-900">{item.quantity}×</span> {item.name}</span>
                <span className="shrink-0 font-medium text-gray-900">{formatPrice(item.subtotal, tenant.currency)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
            {!isPickup && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>Livraison</span>
                <span>{order.shipping_cost === 0 ? 'Gratuite' : formatPrice(order.shipping_cost, tenant.currency)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-bold text-gray-950"><span>Total</span><span>{formatPrice(order.total, tenant.currency)}</span></div>
          </div>
        </section>
      )}

      {!isPickup && address && (
        <section className="mb-4 rounded-2xl bg-gray-50 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800"><IconMapPin size={17} /> Adresse de livraison</h2>
          {address.full_name && <p className="text-sm text-gray-700">{address.full_name}</p>}
          {address.line1 && <p className="text-sm text-gray-700">{address.line1}</p>}
          {address.line2 && <p className="text-sm text-gray-700">{address.line2}</p>}
          {(address.postal_code || address.city) && <p className="text-sm text-gray-700">{address.postal_code} {address.city}{address.country ? `, ${address.country}` : ''}</p>}
        </section>
      )}

      <p className="mt-5 text-center text-xs leading-5 text-gray-400">Des questions ? Répondez à l&apos;email de confirmation ou contactez-nous en indiquant votre numéro de commande.</p>
    </div>
  );
}
