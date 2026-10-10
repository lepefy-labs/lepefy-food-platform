import Link from 'next/link';
import { IconCalendarEvent, IconClock, IconFileInvoice, IconWallet } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatPrice } from '@/lib/utils/format';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import type { EventReservationRequest } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function elapsedLabel(createdAt: string) {
  const diff = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'moins d’une heure';
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

export default async function EventReservationsPaymentsPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();

  const [{ data: rawPending }, { data: rawReservations }, { data: rawEvents }] = await Promise.all([
    supabase
      .from('event_reservation_requests')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    supabase
      .from('event_reservations')
      .select('id, event_id, customer_name, customer_email, quantity_total, amount_paid, status, created_at')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('events')
      .select('id, title, date_start')
      .eq('tenant_id', tenant.id),
  ]);

  const pending = (rawPending ?? []) as EventReservationRequest[];
  const reservations = rawReservations ?? [];
  const eventById = new Map((rawEvents ?? []).map((event) => [event.id, event]));
  const pendingAmount = pending.reduce((sum, request) => sum + Number(request.amount || 0), 0);

  return (
    <div className="mx-auto w-full max-w-6xl pb-12">
      <AdminPageHeader
        title="Réservations / Paiements"
        description="Suivez les réservations confirmées et traitez séparément les paiements externes à vérifier."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-tone-warning-border bg-tone-warning-bg p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tone-warning-fg"><IconWallet size={16} /> À vérifier</div>
          <p className="mt-2 text-2xl font-bold text-a-text">{pending.length}</p>
          <p className="mt-1 text-xs text-a-text-3">{formatPrice(pendingAmount, tenant.currency)} en attente</p>
        </div>
        <div className="rounded-2xl border border-a-border bg-a-surface p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconFileInvoice size={16} /> Réservations</div>
          <p className="mt-2 text-2xl font-bold text-a-text">{reservations.length}</p>
          <p className="mt-1 text-xs text-a-text-3">50 dernières au maximum</p>
        </div>
        <div className="rounded-2xl border border-a-border bg-a-surface p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconCalendarEvent size={16} /> Événements</div>
          <p className="mt-2 text-2xl font-bold text-a-text">{rawEvents?.length ?? 0}</p>
          <p className="mt-1 text-xs text-a-text-3">avec historique conservé</p>
        </div>
      </div>

      <section className="mb-6 overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-a-border px-5 py-4">
          <div>
            <h2 className="font-bold text-a-text">Paiements à vérifier</h2>
            <p className="mt-1 text-sm text-a-text-3">Aucune place n’est réservée avant confirmation manuelle du paiement externe.</p>
          </div>
          <span className="rounded-full bg-tone-warning-bg px-2.5 py-1 text-xs font-semibold text-tone-warning-fg">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-a-text-3">Aucun paiement externe à vérifier.</div>
        ) : (
          <div className="divide-y divide-a-border">
            {pending.map((request) => {
              const event = eventById.get(request.event_id);
              return (
                <Link key={request.id} href={`/admin/evenementiel/paiements-en-attente/${request.id}`} className="grid gap-3 px-5 py-4 transition-colors hover:bg-a-surface-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-a-text">{request.customer_name || request.customer_email}</p>
                      <span className="rounded-full bg-tone-warning-bg px-2 py-0.5 text-xs font-semibold text-tone-warning-fg">{request.payment_method_label}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-a-text-3">{event?.title ?? 'Événement'} · {request.customer_email}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-a-text-3"><IconClock size={13} /> {elapsedLabel(request.created_at)}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-bold text-a-text">{formatPrice(request.amount, tenant.currency)}</p>
                    <p className="mt-1 text-xs font-semibold text-a-brand-fg">Gérer →</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
        <div className="border-b border-a-border px-5 py-4">
          <h2 className="font-bold text-a-text">Réservations récentes</h2>
          <p className="mt-1 text-sm text-a-text-3">Historique tous événements confondus.</p>
        </div>
        {reservations.length === 0 ? <div className="px-5 py-8 text-center text-sm text-a-text-3">Aucune réservation.</div> : (
          <div className="divide-y divide-a-border">
            {reservations.map((reservation) => {
              const event = eventById.get(reservation.event_id);
              return (
                <Link key={reservation.id} href={`/admin/evenementiel/evenements/${reservation.event_id}?tab=reservations`} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-a-surface-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-a-text">{reservation.customer_name}</p>
                    <p className="mt-1 truncate text-xs text-a-text-3">{event?.title ?? 'Événement'} · {reservation.quantity_total} place{reservation.quantity_total > 1 ? 's' : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-a-text">{formatPrice(reservation.amount_paid, tenant.currency)}</p>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${reservation.status === 'confirmed' ? 'bg-tone-success-bg text-tone-success-fg' : reservation.status === 'refunded' ? 'bg-a-hover text-a-text-2' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{reservation.status === 'confirmed' ? 'Confirmée' : reservation.status === 'refunded' ? 'Remboursée' : 'Annulée'}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
