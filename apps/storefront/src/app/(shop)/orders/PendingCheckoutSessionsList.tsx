import Link from 'next/link';
import { IconAlertTriangle, IconChevronRight, IconClock, IconCreditCard, IconPackage } from '@tabler/icons-react';
import { formatDate, formatPrice } from '@/lib/utils/format';

// Section distincte de OrdersListClient (jamais un tableau unique mélangé) :
// une checkout_session pending n'est PAS une commande confirmée — badge et
// libellés volontairement différents de ORDER_STATUS_LABELS pour ne jamais
// laisser croire à l'utilisateur qu'il s'agit d'un statut de commande.

export interface PendingSessionListItem {
  id:                    string;
  createdAt:             string;
  itemCount:             number;
  total:                 number;
  fulfillmentType:       'delivery' | 'pickup';
  paymentMethod:         'stripe' | 'external_link';
  externalPaymentLabel:  string | null;
}

interface PendingCheckoutSessionsListProps {
  sessions: PendingSessionListItem[];
}

function paymentMethodLabel(session: PendingSessionListItem): string {
  return session.paymentMethod === 'stripe' ? 'Carte bancaire' : session.externalPaymentLabel ?? 'Lien externe';
}

export function PendingCheckoutSessionsList({ sessions }: PendingCheckoutSessionsListProps) {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-7 sm:px-6 sm:pt-9">
      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white text-amber-700 shadow-sm">
            <IconAlertTriangle size={18} />
          </span>
          <div>
            <h2 className="text-base font-bold text-gray-950 sm:text-lg">Paiement à finaliser</h2>
            <p className="mt-1 text-sm leading-5 text-amber-900/70">
              Ces demandes ne sont pas encore des commandes confirmées. Ouvrez-les pour vérifier ou terminer le paiement.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {sessions.map((session) => (
          <Link
            key={session.id}
            href={`/orders/en-attente/${session.id}`}
            className="group rounded-2xl border border-amber-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 sm:p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-gray-950">
                    Demande #{session.id.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    <IconClock size={13} /> En attente
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 sm:text-sm">
                  <span>{formatDate(session.createdAt)}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <IconPackage size={15} />
                    {session.itemCount} article{session.itemCount > 1 ? 's' : ''}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <IconCreditCard size={15} />
                    {paymentMethodLabel(session)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-3">
                <p className="text-base font-bold text-gray-950 sm:text-lg">{formatPrice(session.total)}</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600 transition group-hover:bg-amber-100">
                  <IconChevronRight size={18} />
                </span>
              </div>
            </div>

            <div className="mt-4 border-t border-amber-100 pt-3 text-xs font-semibold text-amber-700 sm:text-sm">
              Vérifier cette demande
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
