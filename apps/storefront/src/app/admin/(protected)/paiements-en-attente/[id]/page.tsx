import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconAlertTriangle, IconArrowLeft, IconClock, IconPackage, IconUser, IconWallet } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { generateCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { formatPrice } from '@/lib/utils/format';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import PaymentRecoveryActions from './PaymentRecoveryActions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const FIRST_REMINDER_DELAY_MS = 2 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface SessionItem {
  name: string;
  price: number;
  quantity: number;
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
      description: 'Le client a été envoyé vers un paiement externe. La réception n’est pas encore confirmée dans Lepefy.',
      tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200',
    };
  }
  if (status === 'open') {
    return {
      label: 'Achat non finalisé',
      description: 'La session est encore récupérable et aucun paiement n’est confirmé.',
      tone: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200',
    };
  }
  return {
    label: 'Session expirée',
    description: 'Le paiement externe peut toujours nécessiter une vérification manuelle, mais la reprise client n’est plus disponible.',
    tone: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300',
  };
}

export default async function PendingPaymentManagementPage({ params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();

  const { data: rawSession } = await supabase
    .from('checkout_sessions')
    .select('id, email, full_name, items, shipping_total, ambassador_discount_amount, status, expires_at, payment_method, external_payment_type, external_payment_label, external_payment_link, order_id, created_at')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link')
    .in('status', ['open', 'expired', 'awaiting_verification'])
    .is('order_id', null)
    .maybeSingle();

  if (!rawSession) notFound();

  const session = rawSession as {
    id: string;
    email: string;
    full_name: string | null;
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
  const total = Number((subtotal + Number(session.shipping_total ?? 0) - Number(session.ambassador_discount_amount ?? 0)).toFixed(2));
  const status = statusPresentation(session.status);
  const customerLabel = session.full_name ?? session.email;

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <Link href="/admin" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <IconArrowLeft size={16} /> Commandes
      </Link>

      <AdminPageHeader
        title="Gérer le paiement"
        description="Vérifiez la situation avant de relancer le client, confirmer la réception ou annuler la demande."
        meta={`#${session.id.slice(0, 8).toUpperCase()}`}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><IconUser size={15} /> Client</div>
          <p className="mt-2 truncate text-sm font-bold text-gray-950 dark:text-white">{customerLabel}</p>
          <p className="mt-1 truncate text-xs text-gray-500">{session.email}</p>
        </div>
        <div className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><IconWallet size={15} /> Paiement</div>
          <p className="mt-2 text-sm font-bold text-gray-950 dark:text-white">{session.external_payment_label ?? session.external_payment_type ?? 'Paiement externe'}</p>
          <p className="mt-1 text-xl font-bold text-gray-950 dark:text-white">{formatPrice(total, tenant.currency)}</p>
        </div>
        <div className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><IconClock size={15} /> Ancienneté</div>
          <p className="mt-2 text-sm font-bold text-gray-950 dark:text-white">{elapsedLabel(session.created_at)}</p>
          <p className="mt-1 text-xs text-gray-500">Créé le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(session.created_at))}</p>
        </div>
        <div className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><IconPackage size={15} /> Articles</div>
          <p className="mt-2 text-sm font-bold text-gray-950 dark:text-white">{session.items.reduce((sum, item) => sum + item.quantity, 0)} unité(s)</p>
          <p className="mt-1 line-clamp-2 text-xs text-gray-500">{session.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</p>
        </div>
      </div>

      <div className={`mb-5 rounded-2xl border p-4 ${status.tone}`}>
        <div className="flex items-start gap-2">
          <IconAlertTriangle size={19} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">{status.label}</p>
            <p className="mt-1 text-sm leading-6 opacity-90">{status.description}</p>
            <p className="mt-1 text-xs font-semibold">Aucun stock n’est réservé tant que le paiement n’est pas confirmé.</p>
          </div>
        </div>
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
      />
    </div>
  );
}
