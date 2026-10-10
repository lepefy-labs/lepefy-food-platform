import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconAlertTriangle, IconArrowLeft, IconCalendarEvent, IconClock, IconExternalLink, IconUser, IconWallet } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { formatPrice } from '@/lib/utils/format';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import EventPendingPaymentActions from './EventPendingPaymentActions';
import type { EventReservationRequest, EventTicketType } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function elapsedLabel(createdAt: string) {
  const diff = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'depuis moins d’une heure';
  if (hours < 24) return `depuis ${hours} h`;
  return `depuis ${Math.floor(hours / 24)} j`;
}

export default async function EventPendingPaymentPage({ params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canConfirmPayment = Boolean(access && canAdmin(access, 'event_payments.confirm'));
  const canCancelPayment = Boolean(access && canAdmin(access, 'event_payments.cancel'));
  const supabase = createServiceClient();

  const { data: rawRequest } = await supabase
    .from('event_reservation_requests')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!rawRequest) notFound();
  const request = rawRequest as EventReservationRequest;

  const [{ data: event }, { data: rawTicketTypes }] = await Promise.all([
    supabase.from('events').select('id, title, date_start, location').eq('id', request.event_id).eq('tenant_id', tenant.id).maybeSingle(),
    supabase.from('event_ticket_types').select('*').eq('event_id', request.event_id).eq('tenant_id', tenant.id),
  ]);
  if (!event) notFound();

  const ticketTypes = (rawTicketTypes ?? []) as EventTicketType[];
  const ticketById = new Map(ticketTypes.map((ticket) => [ticket.id, ticket]));
  const reference = `#${request.id.slice(0, 8).toUpperCase()}`;
  const itemCount = request.items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const status = request.status === 'pending'
    ? { label: 'Réception à vérifier', tone: 'border-tone-warning-border bg-tone-warning-bg text-tone-warning-fg', text: 'Le paiement externe doit être contrôlé avant toute création de réservation.' }
    : request.status === 'confirmed'
      ? { label: 'Paiement confirmé', tone: 'border-tone-success-border bg-tone-success-bg text-tone-success-fg', text: 'Cette demande a déjà créé une réservation.' }
      : request.status === 'cancelled'
        ? { label: 'Demande annulée', tone: 'border-a-border bg-a-surface-2 text-a-text-2', text: 'Aucune réservation n’a été créée depuis cette demande.' }
        : { label: 'Conflit de capacité', tone: 'border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg', text: 'La capacité était insuffisante au moment de la confirmation. Vérifiez le remboursement externe avec le client.' };

  return (
    <div className="mx-auto w-full max-w-5xl pb-12">
      <Link href="/admin/evenementiel/reservations" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-a-text-3 hover:text-a-text"><IconArrowLeft size={16} /> Réservations / Paiements</Link>

      <AdminPageHeader title="Gérer le paiement événement" description="Vérifiez la demande complète avant de confirmer la réception du paiement externe." meta={reference} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconUser size={15} /> Client</div><p className="mt-2 truncate text-sm font-bold text-a-text">{request.customer_name}</p><p className="mt-1 truncate text-xs text-a-text-3">{request.customer_email}</p>{request.customer_phone && <p className="mt-1 truncate text-xs text-a-text-3">{request.customer_phone}</p>}</div>
        <div className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconWallet size={15} /> Paiement</div><p className="mt-2 text-sm font-bold text-a-text">{request.payment_method_label}</p><p className="mt-1 text-xl font-bold text-a-text">{formatPrice(request.amount, tenant.currency)}</p></div>
        <div className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconClock size={15} /> Ancienneté</div><p className="mt-2 text-sm font-bold text-a-text">{elapsedLabel(request.created_at)}</p><p className="mt-1 text-xs text-a-text-3">{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(request.created_at))}</p></div>
        <div className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconCalendarEvent size={15} /> Réservation</div><p className="mt-2 truncate text-sm font-bold text-a-text">{event.title}</p><p className="mt-1 text-xs text-a-text-3">{itemCount} place{itemCount > 1 ? 's' : ''}</p></div>
      </div>

      <div className={`mb-5 rounded-2xl border p-4 ${status.tone}`}><div className="flex items-start gap-2"><IconAlertTriangle size={19} className="mt-0.5 shrink-0" /><div><p className="font-bold">{status.label}</p><p className="mt-1 text-sm leading-6 opacity-90">{status.text}</p>{request.status === 'pending' && <p className="mt-1 text-xs font-semibold">Les places ne sont pas réservées tant que le paiement n’est pas confirmé.</p>}</div></div></div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,.8fr)]">
        <section className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
          <div className="border-b border-a-border px-5 py-4"><h2 className="font-bold text-a-text">Détail de la demande</h2><p className="mt-1 text-sm text-a-text-3">Formules demandées avant confirmation du paiement.</p></div>
          <div className="divide-y divide-a-border">
            {request.items.map((item) => {
              const ticket = ticketById.get(item.ticket_type_id);
              return <div key={item.ticket_type_id} className="flex items-center justify-between gap-4 px-5 py-4"><div><p className="text-sm font-semibold text-a-text">{ticket?.label ?? 'Formule'}</p><p className="mt-1 text-xs text-a-text-3">Quantité {item.quantity}</p></div><p className="text-sm font-bold text-a-text">{ticket ? formatPrice(Number(ticket.price) * Number(item.quantity), tenant.currency) : '—'}</p></div>;
            })}
          </div>
          <div className="flex items-center justify-between border-t border-a-border px-5 py-4"><span className="font-semibold text-a-text-2">Total attendu</span><strong className="text-lg text-a-text">{formatPrice(request.amount, tenant.currency)}</strong></div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm"><h2 className="font-bold text-a-text">Événement</h2><p className="mt-3 text-sm font-semibold text-a-text">{event.title}</p><p className="mt-1 text-xs text-a-text-3">{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.date_start))}</p>{event.location && <p className="mt-1 text-xs text-a-text-3">{event.location}</p>}<Link href={`/admin/evenementiel/evenements/${event.id}`} className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-a-brand-fg">Voir l’événement →</Link></section>
          <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm"><h2 className="font-bold text-a-text">Prestataire externe</h2><p className="mt-2 text-sm text-a-text-3">Lepefy ne peut pas vérifier automatiquement ce paiement. Contrôlez le prestataire avant toute confirmation.</p><a href={request.payment_link} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-a-border-strong px-4 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2">Ouvrir {request.payment_method_label} <IconExternalLink size={16} /></a></section>
        </aside>
      </div>

      {request.status === 'pending' && (
        <div className="space-y-4">
          <EventPendingPaymentActions
            requestId={request.id}
            customerLabel={request.customer_name || request.customer_email}
            canConfirm={canConfirmPayment}
            canCancel={canCancelPayment}
          />
        </div>
      )}
      {request.status !== 'pending' && <div className="rounded-2xl border border-a-border bg-a-surface p-5 text-sm text-a-text-3">Cette demande n’est plus actionnable. Consultez la réservation ou l’événement pour poursuivre le suivi.</div>}
    </div>
  );
}
