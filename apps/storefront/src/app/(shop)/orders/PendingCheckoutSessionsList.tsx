import Link from 'next/link';
import { IconChevronRight, IconClock } from '@tabler/icons-react';
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
    <div className="max-w-xl mx-auto px-4 pt-6">
      <h2 className="text-lg font-bold text-gray-900 mb-1">En attente de paiement</h2>
      <p className="text-xs text-gray-400 mb-4">
        Ces demandes ne sont pas encore des commandes confirmées.
      </p>
      <div className="flex flex-col gap-3 mb-2">
        {sessions.map((session) => (
          <Link
            key={session.id}
            href={`/orders/en-attente/${session.id}`}
            className="flex items-center justify-between gap-3 bg-white rounded-2xl border border-amber-100 shadow-card px-4 py-3.5 hover:border-amber-200 transition-colors"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-gray-900 font-mono">
                  Demande #{session.id.slice(0, 8).toUpperCase()}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                  <IconClock size={12} /> En attente de confirmation
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {formatDate(session.createdAt)} · {session.itemCount} article{session.itemCount > 1 ? 's' : ''} · {paymentMethodLabel(session)}
              </p>
              <p className="text-sm font-bold mt-1" style={{ color: 'var(--color-primary)' }}>
                {formatPrice(session.total)}
              </p>
            </div>
            <IconChevronRight size={18} className="text-gray-300 flex-shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
