import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { IconAlertTriangle, IconArrowLeft, IconClock, IconPackage, IconUser, IconWallet } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { generateCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { formatPrice } from '@/lib/utils/format';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import PaymentRecoveryActions from './PaymentRecoveryActions';
import PaymentRecoveryDetails from './PaymentRecoveryDetails';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const FIRST_REMINDER_DELAY_MS = 2 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface SessionItem {
  name: string;
  price: number;
  quantity: number;
}

interface ShippingAddress {
  full_name?: string | null;
  line1?: string | null;
  line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
}

interface ReminderLog {
  created_at: string;
  detail: Record<string, unknown> | null;
}

function elapsedLabel(createdAt: string) {
  const diffMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return 'depuis moins d’une heure';
  if (hours < 24) return `depuis ${hours} h`;
  const days = Math.floor(hours / 24);
  return `depuis ${days} j`;
}

function statusPresentation(status: string) {
  if (status === 'awaiting_verification') {
    return {
      label: 'Réception à vérifier',
      description: 'Le client a été redirigé vers un paiement externe. Sa réception n’est pas encore confirmée.',
      tone: 'border-tone-warning-border bg-tone-warning-bg text-tone-warning-fg',
    };
  }
  if (status === 'open') {
    return {
      label: 'Achat non finalisé',
      description: 'La session est encore récupérable et aucun paiement n’est confirmé.',
      tone: 'border-tone-info-border bg-tone-info-bg text-tone-info-fg',
    };
  }
  return {
    label: 'Session expirée',
    description: 'Le paiement externe peut toujours nécessiter une vérification manuelle, mais la reprise client n’est plus disponible.',
    tone: 'border-a-border bg-a-surface-2 text-a-text-2',
  };
}

export default async function PendingPaymentManagementPage({ params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canManageSession = Boolean(access && canAdmin(access, 'orders.manage'));
  const canConfirmPayment = Boolean(access && canAdmin(access, 'shop_payments.confirm'));
  const supabase = createServiceClient();

  const { data: rawSession } = await supabase
    .from('checkout_sessions')
    .select('id, email, full_name, phone, fulfillment_type, shipping_address, items, shipping_total, ambassador_discount_amount, status, expires_at, payment_method, external_payment_type, external_payment_label, external_payment_link, order_id, created_at, origin')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link')
    .in('status', ['open', 'expired', 'awaiting_verification'])
    .is('order_id', null)
    .maybeSingle();

  if (!rawSession) notFound();
  // Précommande assistée : gérée (confirmation tracée, remise en attente, lien) dans sa fiche dédiée.
  if ((rawSession as { origin?: string }).origin === 'assisted') redirect(`/admin/orders/precommandes/${params.id}`);

  const session = rawSession as {
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    fulfillment_type: 'delivery' | 'pickup';
    shipping_address: ShippingAddress | null;
    items: SessionItem[];
    shipping_total: number;
    ambassador_discount_amount: number | null;
    status: 'open' | 'expired' | 'awaiting_verification';
    expires_at: string;
    payment_method: 'external_link';
    external_payment_type: string | null;
    external_payment_label: string | null;
    external_payment_link: string | null;
    order_id: string | null;
    created_at: string;
  };

  const { data: rawReminderLogs } = await supabase
    .from('payment_funnel_logs')
    .select('created_at, detail')
    .eq('tenant_id', tenant.id)
    .eq('module', 'shop')
    .eq('reference_id', session.id)
    .eq('event_type', 'checkout_reused')
    .order('created_at', { ascending: false })
    .limit(30);

  const reminders = ((rawReminderLogs ?? []) as ReminderLog[])
    .filter((log) => log.detail?.kind === 'payment_reminder_sent');
  const lastReminderAt = reminders[0]?.created_at ?? null;
  const nextReminderAt = lastReminderAt && reminders.length < 2
    ? new Date(new Date(lastReminderAt).getTime() + REMINDER_COOLDOWN_MS).toISOString()
    : null;
  const firstReminderAt = new Date(new Date(session.created_at).getTime() + FIRST_REMINDER_DELAY_MS).toISOString();

  const canResume = session.status === 'awaiting_verification'
    || (session.status === 'open' && new Date(session.expires_at).getTime() > Date.now());
  const accessToken = canResume && process.env.TRACKING_SECRET
    ? generateCheckoutSessionAccessToken(session.id, session.email)
    : null;
  const storefrontUrl = tenant.storefront_url?.replace(/\/$/, '')
    ?? tenant.legal_website?.replace(/\/$/, '')
    ?? process.env.NEXT_PUBLIC_STOREFRONT_URL?.replace(/\/$/, '')
    ?? '';
  const resumeLink = accessToken && storefrontUrl
    ? `${storefrontUrl}/checkout/reprendre/${session.id}?token=${encodeURIComponent(accessToken)}`
    : null;

  const subtotal = (session.items ?? []).reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0,
  );
  const discountTotal = Number(session.ambassador_discount_amount ?? 0);
  const shippingTotal = Number(session.shipping_total ?? 0);
  const total = Number((subtotal + shippingTotal - discountTotal).toFixed(2));
  const status = statusPresentation(session.status);
  const customerLabel = session.full_name ?? session.email;
  const paymentLabel = session.external_payment_label ?? session.external_payment_type ?? 'Paiement externe';
  const reference = `#${session.id.slice(0, 8).toUpperCase()}`;

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <Link href="/admin" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-a-text-3 hover:text-a-text">
        <IconArrowLeft size={16} /> Commandes
      </Link>

      <AdminPageHeader
        title="Gérer le paiement"
        description="Vérifiez la situation avant de relancer le client, confirmer la réception ou annuler la demande."
        meta={reference}
        actions={(
          <PaymentRecoveryDetails
            customer={{ name: customerLabel, email: session.email, phone: session.phone }}
            payment={{ reference, method: paymentLabel }}
            fulfillmentType={session.fulfillment_type}
            shippingAddress={session.shipping_address}
            items={session.items}
            subtotal={subtotal}
            shippingTotal={shippingTotal}
            discountTotal={discountTotal}
            total={total}
            currency={tenant.currency}
          />
        )}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconUser size={15} /> Client</div><p className="mt-2 truncate text-sm font-bold text-a-text">{customerLabel}</p><p className="mt-1 truncate text-xs text-a-text-3">{session.email}</p>{session.phone && <p className="mt-1 truncate text-xs text-a-text-3">{session.phone}</p>}</div>
        <div className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconWallet size={15} /> Paiement</div><p className="mt-2 text-sm font-bold text-a-text">{paymentLabel}</p><p className="mt-1 text-xl font-bold text-a-text">{formatPrice(total, tenant.currency)}</p></div>
        <div className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconClock size={15} /> Ancienneté</div><p className="mt-2 text-sm font-bold text-a-text">{elapsedLabel(session.created_at)}</p><p className="mt-1 text-xs text-a-text-3">Créé le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(session.created_at))}</p></div>
        <div className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconPackage size={15} /> Articles</div><p className="mt-2 text-sm font-bold text-a-text">{session.items.reduce((sum, item) => sum + item.quantity, 0)} unité(s)</p><p className="mt-1 line-clamp-2 text-xs text-a-text-3">{session.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</p></div>
      </div>

      <div className={`mb-5 rounded-2xl border p-4 ${status.tone}`}>
        <div className="flex items-start gap-2"><IconAlertTriangle size={19} className="mt-0.5 shrink-0" /><div><p className="font-bold">{status.label}</p><p className="mt-1 text-sm leading-6 opacity-90">{status.description}</p><p className="mt-1 text-xs font-semibold">Aucun stock n’est réservé tant que le paiement n’est pas confirmé.</p></div></div>
      </div>

      <PaymentRecoveryActions
        sessionId={session.id}
        customerLabel={customerLabel}
        resumeLink={resumeLink}
        initialReminderCount={reminders.length}
        initialLastReminderAt={lastReminderAt}
        initialNextReminderAt={nextReminderAt}
        firstReminderAt={firstReminderAt}
        canResume={canResume && Boolean(resumeLink)}
        canManageSession={canManageSession}
        canConfirmPayment={canConfirmPayment}
      />
    </div>
  );
}
