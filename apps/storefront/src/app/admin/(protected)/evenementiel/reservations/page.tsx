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
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700"><IconWallet size={16} /> À vérifier</div>
          <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{pending.length}</p>
          <p className="mt-1 text-xs text-gray-500">{formatPrice(pendingAmount, tenant.currency)} en attente</p>
        </div>
        <div className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><IconFileInvoice size={16} /> Réservations</div>
          <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{reservations.length}</p>
          <p className="mt-1 text-xs text-gray-500">50 dernières au maximum</p>
        </div>
        <div className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><IconCalendarEvent size={16} /> Événements</div>
          <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{rawEvents?.length ?? 0}</p>
          <p className="mt-1 text-xs text-gray-500">avec historique conservé</p>
        </div>
      </div>

      <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="font-bold text-gray-950 dark:text-white">Paiements à vérifier</h2>
            <p className="mt-1 text-sm text-gray-500">Aucune place n’est réservée avant confirmation manuelle du paiement externe.</p>
          </div>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-500">Aucun paiement externe à vérifier.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {pending.map((request) => {
              const event = eventById.get(request.event_id);
              return (
                <Link key={request.id} href={`/admin/evenementiel/paiements-en-attente/${request.id}`} className="grid gap-3 px-5 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-white/5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-950 dark:text-white">{request.customer_name || request.customer_email}</p>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{request.payment_method_label}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-gray-500">{event?.title ?? 'Événement'} · {request.customer_email}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-gray-400"><IconClock size={13} /> {elapsedLabel(request.created_at)}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-bold text-gray-950 dark:text-white">{formatPrice(request.amount, tenant.currency)}</p>
                    <p className="mt-1 text-xs font-semibold text-violet-700 dark:text-violet-300">Gérer →</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="font-bold text-gray-950 dark:text-white">Réservations récentes</h2>
          <p className="mt-1 text-sm text-gray-500">Historique tous événements confondus.</p>
        </div>
        {reservations.length === 0 ? <div className="px-5 py-8 text-center text-sm text-gray-500">Aucune réservation.</div> : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {reservations.map((reservation) => {
              const event = eventById.get(reservation.event_id);
              return (
                <Link key={reservation.id} href={`/admin/evenementiel/evenements/${reservation.event_id}?tab=reservations`} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-white/5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{reservation.customer_name}</p>
                    <p className="mt-1 truncate text-xs text-gray-500">{event?.title ?? 'Événement'} · {reservation.quantity_total} place{reservation.quantity_total > 1 ? 's' : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-gray-950 dark:text-white">{formatPrice(reservation.amount_paid, tenant.currency)}</p>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold ${reservation.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : reservation.status === 'refunded' ? 'bg-gray-100 text-gray-600' : 'bg-red-50 text-red-700'}`}>{reservation.status === 'confirmed' ? 'Confirmée' : reservation.status === 'refunded' ? 'Remboursée' : 'Annulée'}</span>
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
