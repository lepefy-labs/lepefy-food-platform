import Link from 'next/link';
import { IconArrowRight, IconClock, IconCreditCard, IconPackage } from '@tabler/icons-react';
import { formatDate, formatPrice } from '@/lib/utils/format';

export interface PendingSessionListItem {
  id: string;
  createdAt: string;
  itemCount: number;
  total: number;
  fulfillmentType: 'delivery' | 'pickup';
  paymentMethod: 'stripe' | 'external_link';
  externalPaymentLabel: string | null;
}

function paymentMethodLabel(session: PendingSessionListItem): string {
  return session.paymentMethod === 'stripe' ? 'Carte bancaire' : session.externalPaymentLabel ?? 'Lien externe';
}

export function PendingCheckoutSessionsList({ sessions }: { sessions: PendingSessionListItem[] }) {
  const session = sessions[0];
  if (!session) return null;

  return (
    <section className="mx-auto max-w-3xl px-4 pt-7 sm:px-6 sm:pt-9">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/75 p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-amber-700 shadow-sm">
                <IconClock size={13} /> Achat à finaliser
              </span>
              <span className="text-xs text-amber-900/60">{formatDate(session.createdAt)}</span>
            </div>
            <h2 className="mt-3 text-lg font-bold text-gray-950 sm:text-xl">Votre commande n&apos;est pas encore confirmée</h2>
            <p className="mt-1 text-sm leading-5 text-gray-600">
              Reprenez votre checkout là où vous l&apos;avez laissé. Les prix, le stock et la livraison seront validés avant le paiement.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-600 sm:text-sm">
              <span className="inline-flex items-center gap-1.5"><IconPackage size={15} />{session.itemCount} article{session.itemCount > 1 ? 's' : ''}</span>
              <span className="inline-flex items-center gap-1.5"><IconCreditCard size={15} />{paymentMethodLabel(session)}</span>
              <strong className="text-gray-950">{formatPrice(session.total)}</strong>
            </div>
          </div>
        </div>
        <Link
          href={`/checkout/reprendre/${session.id}`}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 sm:w-auto"
        >
          Finaliser mon achat <IconArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
